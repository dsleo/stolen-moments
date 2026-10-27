from __future__ import annotations

import json
import wave
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
EXAMPLES = ROOT / "static/listen/examples"


def test_bundled_examples_are_valid_mono_wav_and_declared():
    manifest = json.loads((EXAMPLES / "manifest.json").read_text())
    assert {entry["name"] for entry in manifest["examples"]} == {
        "clear", "transposed", "silence"
    }
    for entry in manifest["examples"]:
        with wave.open(str(EXAMPLES / entry["file"]), "rb") as recording:
            assert recording.getnchannels() == 1
            assert recording.getsampwidth() == 2
            assert recording.getframerate() == 22050
            assert 2 <= recording.getnframes() / recording.getframerate() <= 20
    for entry in manifest["examples"][:2]:
        assert entry["soloId"] == 346
        assert entry["startNote"] == 133
        assert entry["noteCount"] == 16
