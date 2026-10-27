"""Build deterministic synthesized examples from WJazzD's note export."""
from __future__ import annotations

import gzip
import json
import math
import struct
import wave
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "static/catalog/listen"
OUTPUT = ROOT / "static/listen/examples"
RATE = 22050
SOLO_ID = 346
START_NOTE = 133
COUNT = 16


def find_solo() -> dict:
    for shard in sorted(SOURCE.glob("shard-*.json.gz")):
        with gzip.open(shard, "rt", encoding="utf-8") as stream:
            data = json.load(stream)
        for solo in data["solos"]:
            if solo["id"] == SOLO_ID:
                return solo
    raise ValueError("Example solo is absent from the complete note corpus")


def synth(solo: dict, *, pitch_shift: int, time_scale: float) -> tuple[bytes, float]:
    first = solo["onsetsSeconds"][START_NOTE]
    end = (solo["onsetsSeconds"][START_NOTE + COUNT - 1] - first) * time_scale + 1
    samples = [0.0] * math.ceil(end * RATE)
    for k in range(COUNT):
        index = START_NOTE + k
        at = (solo["onsetsSeconds"][index] - first) * time_scale
        next_at = ((solo["onsetsSeconds"][index + 1] - first) * time_scale
                   if k < COUNT - 1 else end)
        duration = max(0.06, min(solo["durationsSeconds"][index] * time_scale,
                                 next_at - at - 0.045, end - at, 0.6))
        frequency = 440 * 2 ** ((solo["pitches"][index] + pitch_shift - 69) / 12)
        base = round(at * RATE)
        for i in range(math.floor(duration * RATE)):
            envelope = min(1, i / (RATE * 0.014)) * min(
                1, (duration * RATE - i) / (RATE * 0.05))
            samples[base + i] += 0.22 * envelope * math.sin(2 * math.pi * frequency * i / RATE)
    pcm = b"".join(struct.pack("<h", max(-32768, min(32767, round(x * 32767))))
                   for x in samples)
    return pcm, end


def write_wave(path: Path, pcm: bytes) -> None:
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(pcm)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    solo = find_solo()
    examples = []
    for name, shift, scale in (("clear", 0, 1), ("transposed", 7, 1.25)):
        pcm, duration = synth(solo, pitch_shift=shift, time_scale=scale)
        write_wave(OUTPUT / f"{name}.wav", pcm)
        examples.append({"name": name, "file": f"{name}.wav", "soloId": SOLO_ID,
                         "startNote": START_NOTE, "noteCount": COUNT,
                         "pitchShift": shift, "timeScale": scale,
                         "durationSeconds": round(duration, 3)})
    write_wave(OUTPUT / "silence.wav", b"\0\0" * (5 * RATE))
    examples.append({"name": "silence", "file": "silence.wav", "expected": "no clear sound"})
    (OUTPUT / "manifest.json").write_text(json.dumps({
        "source": "WJazzD v2.1 note data; synthesized locally, no source audio",
        "sourceLicense": "See static/DATA_LICENSE.txt", "examples": examples,
    }, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(examples)} listening examples to {OUTPUT}")


if __name__ == "__main__":
    main()
