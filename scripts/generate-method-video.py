"""Render an illustrated listening film for the How it works page.

Illustrations live in static/media/illustrations. The featured phrases are
synthesized from WJazzD note data; no recordings or portraits are included.
Requires Pillow, NumPy, and ffmpeg.
"""

from __future__ import annotations

import gzip
import json
import math
import subprocess
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "static/media"
ART = MEDIA / "illustrations"
W, H, FPS, LENGTH = 1280, 720, 18, 42
INK = (35, 37, 31)
MUTED = (65, 69, 54)
PAPER = (248, 239, 218)
SERIF = ImageFont.truetype("/System/Library/Fonts/Supplemental/Georgia.ttf", 76)
SERIF_BIG = ImageFont.truetype("/System/Library/Fonts/Supplemental/Georgia.ttf", 92)
SERIF_TITLE = ImageFont.truetype("/System/Library/Fonts/Supplemental/Georgia.ttf", 105)
SANS = ImageFont.truetype("/System/Library/Fonts/Avenir Next.ttc", 28)
SANS_SMALL = ImageFont.truetype("/System/Library/Fonts/Avenir Next.ttc", 19)


def phrase_notes():
    with gzip.open(ROOT / "static/catalog/index.json.gz", "rt") as file:
        index = json.load(file)
    pair_id, row = next((i, r) for i, r in enumerate(index["rows"])
                        if r[0] == 87 and r[1] == 200 and r[2] == 562 and r[4] == 283)
    assert row[6] == 38 and row[7] == 1
    shard_size = index["shard_size"]
    with gzip.open(ROOT / f"static/catalog/detail/{pair_id // shard_size:04d}.json.gz", "rt") as file:
        alignment = json.load(file)[pair_id % shard_size][1]
    assert len(alignment) == 39 and sum(a < 0 or b < 0 for a, b in alignment) == 1
    result = {}
    for mid, start, end in ((87, row[2], row[3]), (200, row[4], row[5])):
        with gzip.open(ROOT / f"static/catalog/notes/{mid}.json.gz", "rt") as file:
            result[mid] = json.load(file)[start:end]
    return result, alignment


NOTES, ALIGNMENT = phrase_notes()


def ease(value):
    p = min(1, max(0, value))
    return p * p * (3 - 2 * p)


def opacity(t, begin, end, fade=0.55):
    return ease((t - begin) / fade) * (1 - ease((t - (end - fade)) / fade))


def plate(name):
    image = Image.open(ART / f"{name}.webp").convert("RGB")
    return ImageOps.fit(image, (1360, 765), method=Image.Resampling.LANCZOS)


PLATES = {name: plate(name) for name in ("trumpeter", "saxophonist", "melodic-ribbons")}


def crop(name, p):
    image = PLATES[name]
    shift = ease(p)
    if name == "trumpeter":
        x, y = round(60 * shift), round(16 * shift)
    elif name == "saxophonist":
        x, y = round(80 - 60 * shift), round(16 * (1 - shift))
    else:
        x, y = round(30 + 24 * math.sin(p * math.pi)), round(15 + 10 * shift)
    return image.crop((x, y, x + W, y + H))


def make_duet():
    sax = Image.open(ART / "saxophonist.webp").convert("RGB")
    horn = Image.open(ART / "trumpeter.webp").convert("RGB")
    left = ImageOps.fit(sax.crop((0, 0, 850, 941)), (640, H), method=Image.Resampling.LANCZOS)
    right = ImageOps.fit(horn.crop((822, 0, 1672, 941)), (640, H), method=Image.Resampling.LANCZOS)
    image = Image.new("RGB", (W, H), PAPER)
    image.paste(left, (0, 0))
    image.paste(right, (640, 0))
    return image


DUET = make_duet()


def scene_image(t):
    if t < 5.0:
        return crop("trumpeter", t / 5)
    if t < 5.8:
        return Image.blend(crop("trumpeter", 1), crop("saxophonist", 0), ease((t - 5) / 0.8))
    if t < 9.5:
        return crop("saxophonist", (t - 5.8) / 3.7)
    if t < 10.3:
        return Image.blend(crop("saxophonist", 1), crop("melodic-ribbons", 0), ease((t - 9.5) / 0.8))
    if t < 33:
        return crop("melodic-ribbons", (t - 10.3) / 22.7)
    if t < 33.8:
        return Image.blend(crop("melodic-ribbons", 1), DUET, ease((t - 33) / 0.8))
    if t < 38:
        return DUET.copy()
    if t < 38.8:
        return Image.blend(DUET, crop("melodic-ribbons", 0), ease((t - 38) / 0.8))
    return crop("melodic-ribbons", (t - 38.8) / 3.2)


def text_layer(lines, sub, x, y, align="left", size="normal", wash=None, sub_y=None):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    face = SERIF_TITLE if size == "title" else SERIF_BIG if size == "big" else SERIF
    anchor = "ma" if align == "center" else "la"
    if wash:
        draw.rounded_rectangle(wash, radius=8, fill=(*PAPER, 220))
    for i, line in enumerate(lines):
        draw.text((x, y + i * (face.size + 10)), line, font=face, fill=(*INK, 255), anchor=anchor)
    if sub:
        sy = sub_y if sub_y is not None else y + len(lines) * (face.size + 10) + 15
        draw.text((x, sy), sub, font=SANS, fill=(*MUTED, 255), anchor=anchor)
    return layer


def duet_message_layer():
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for y in range(390, H):
        alpha = round(172 * ease((y - 390) / (H - 390)))
        draw.line((0, y, W, y), fill=(21, 22, 18, alpha))
    for line, y in (("Listen to both and", 445), ("judge for yourself!", 535)):
        draw.text((640, y), line, font=SERIF, fill=(252, 243, 224, 255),
                  stroke_width=2, stroke_fill=(30, 28, 22, 170), anchor="ma")
    return layer


LAYERS = {
    "first": text_layer(["A solo", "begins."], "A musician shapes a phrase.", 92, 205),
    "second": text_layer(["Another", "solo."], "A different musician, years later.", 725, 205),
    "notes": text_layer(["We start with", "a transcription."], "Each note has a pitch, a beat position, and a length.", 640, 27, "center", sub_y=616),
    "steps": text_layer(["We compare", "the pitch steps."], "Five matching steps start the search, even in another key.", 640, 27, "center", sub_y=616),
    "align": text_layer(["Then we line up", "the passages."], "The shared run grows into a note-by-note comparison.", 640, 27, "center", sub_y=616),
    "score": text_layer(["Small differences", "still matter."], "An extra note may be skipped. Pitch and rhythm shape the score.", 640, 27, "center", sub_y=616),
    "duet": duet_message_layer(),
    "end": text_layer(["Stolen Moments"], None, 640, 66, "center", "title"),
}


def lay(image, key, strength):
    if strength <= 0:
        return image
    layer = LAYERS[key].copy()
    alpha = layer.getchannel("A").point(lambda value: round(value * strength))
    layer.putalpha(alpha)
    return Image.alpha_composite(image.convert("RGBA"), layer).convert("RGB")


def diagram_paper(draw):
    """A loose paper layer that makes the instructional marks part of the art."""
    draw.polygon([(67, 259), (235, 244), (483, 254), (750, 240), (1002, 251), (1209, 239),
                  (1215, 550), (1020, 560), (742, 553), (472, 568), (223, 558), (64, 570)],
                 fill=(*PAPER, 232))
    draw.line([(76, 260), (335, 250), (626, 257), (910, 246), (1195, 250)], fill=(87, 77, 58, 85), width=3)


def composite_diagram(image, paint, strength):
    if strength <= 0:
        return image
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    diagram_paper(draw)
    paint(draw)
    layer.putalpha(layer.getchannel("A").point(lambda value: round(value * strength)))
    return Image.alpha_composite(image.convert("RGBA"), layer).convert("RGB")


def note_representation(draw, progress):
    notes = NOTES[87][:12]
    first_beat, last_beat = notes[0][4], notes[-1][4]
    beat_span = last_beat - first_beat
    seconds_per_beat = (notes[-1][2] - notes[0][2]) / beat_span
    count = max(0, min(len(notes), round(ease(progress) * len(notes))))
    draw.text((104, 277), "PITCH", font=SANS_SMALL, fill=(*INK, 235))
    draw.text((922, 277), "NOTE LENGTH", font=SANS_SMALL, fill=(*INK, 235))
    draw.text((475, 517), "POSITION IN THE BEAT", font=SANS_SMALL, fill=(*INK, 235))
    draw.line((150, 478, 1120, 478), fill=(74, 76, 60, 155), width=3)
    for i, note in enumerate(notes):
        x = 174 + (note[4] - first_beat) / beat_span * 920
        y = 388 + (69 - note[1]) * 13
        draw.line((x, 473, x, 481), fill=(70, 72, 58, 140), width=2)
        if i >= count:
            continue
        length = max(19, (note[3] / seconds_per_beat) / beat_span * 920)
        draw.line((x, y, x + length, y), fill=(150, 66, 34, 210), width=7)
        draw.ellipse((x - 9, y - 7, x + 9, y + 7), fill=(133, 53, 29, 245))
    draw.line((153, 306, 174, 388 + (69 - notes[0][1]) * 13), fill=(60, 64, 50, 175), width=2)
    draw.line((1014, 305, 1002, 370), fill=(60, 64, 50, 175), width=2)


def interval_representation(draw, progress):
    xs = [255 + 154 * i for i in range(6)]
    solo_a = NOTES[87][:6]
    solo_b = NOTES[200][:6]
    steps = [solo_a[i+1][1] - solo_a[i][1] for i in range(5)]
    count = max(0, min(6, round(ease(progress) * 6)))
    for label, notes, middle, color in (("SOLO A", solo_a, 347, (145, 61, 33, 230)),
                                         ("SOLO B", solo_b, 490, (76, 96, 57, 230))):
        draw.text((93, middle - 18), label, font=SANS_SMALL, fill=(*INK, 235))
        points = [(x, middle + (69 - note[1]) * 9) for x, note in zip(xs, notes)]
        if count > 1:
            draw.line(points[:count], fill=color, width=5)
        for x, y in points[:count]:
            draw.ellipse((x-11, y-9, x+11, y+9), fill=color)
    if count >= 6:
        for i, value in enumerate(steps):
            draw.text(((xs[i] + xs[i+1]) / 2, 413), f"{value:+d}", font=SANS_SMALL,
                      fill=(*INK, 245), anchor="ma")


def aligned_passages(draw, progress, show_gap):
    columns = len(ALIGNMENT)
    visible = max(0, min(columns, round(ease(progress) * columns)))
    draw.text((91, 301), "SOLO A", font=SANS_SMALL, fill=(122, 49, 26, 245))
    draw.text((91, 512), "SOLO B", font=SANS_SMALL, fill=(66, 84, 49, 245))
    gap_center = None
    for i, (a, b) in enumerate(ALIGNMENT[:visible]):
        x = 177 + i * 26
        ya = 343 + (69 - NOTES[87][a - 562][1]) * 4.3 if a >= 0 else None
        yb = 475 + (69 - NOTES[200][b - 283][1]) * 4.3 if b >= 0 else None
        if ya is not None and yb is not None:
            draw.line((x, ya + 6, x, yb - 6), fill=(74, 72, 60, 70), width=2)
        if ya is not None:
            draw.ellipse((x-6, ya-6, x+6, ya+6), fill=(145, 61, 33, 235))
        if yb is not None:
            draw.ellipse((x-6, yb-6, x+6, yb+6), fill=(76, 96, 57, 235))
        if a < 0 and yb is not None:
            gap_center = (x, yb)
    if show_gap and gap_center:
        x, y = gap_center
        draw.ellipse((x-18, y-18, x+18, y+18), outline=(156, 66, 35, 240), width=3)
        draw.text((x+29, y+20), "ONE EXTRA NOTE", font=SANS_SMALL, fill=(122, 49, 26, 235))


def render_frame(t):
    image = scene_image(t)
    if 10.3 <= t < 16:
        image = composite_diagram(image, lambda d: note_representation(d, (t - 10.6) / 3.4),
                                  opacity(t, 10.3, 16.1, 0.55))
    if 16 <= t < 23:
        image = composite_diagram(image, lambda d: interval_representation(d, (t - 16.4) / 3.0),
                                  opacity(t, 16, 23.1, 0.55))
    if 23 <= t < 33.1:
        image = composite_diagram(image, lambda d: aligned_passages(d, (t - 23.2) / 4.6, t >= 28),
                                  opacity(t, 23, 33.2, 0.55))
    for key, start, end in (("first", 0.25, 5.2), ("second", 5.75, 9.65),
                            ("notes", 10.3, 16.1), ("steps", 16.05, 23.0),
                            ("align", 23.0, 28.0), ("score", 28.0, 33.1),
                            ("duet", 33.75, 38.1), ("end", 38.75, 43.5)):
        image = lay(image, key, opacity(t, start, end))
    return image


def make_audio():
    rate = 44100
    signal = np.zeros(rate * LENGTH, dtype=np.float64)

    def tone(at, pitch, duration, amp=0.20):
        begin = int(at * rate)
        count = min(int(duration * rate), len(signal) - begin)
        if count <= 0:
            return
        t = np.arange(count) / rate
        frequency = 440 * 2 ** ((pitch - 69) / 12)
        phase = 2 * np.pi * frequency * t
        triangle = 2 / np.pi * np.arcsin(np.sin(phase))
        wave_ = 0.8 * triangle + 0.2 * np.sin(phase)
        envelope = np.minimum(1, t / 0.018) * np.minimum(1, (duration - t) / 0.035)
        signal[begin:begin+count] += amp * wave_ * envelope

    for mid, start in ((87, 0.50), (200, 5.95)):
        notes = NOTES[mid]
        origin = notes[0][2]
        for note in notes:
            tone(start + note[2] - origin, note[1], max(0.07, min(note[3], 0.8)))
    signal = np.tanh(signal * 1.6) / 1.6
    path = MEDIA / "how-it-works-audio.wav"
    with wave.open(str(path), "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(rate)
        file.writeframes((np.clip(signal, -1, 1) * 32767).astype("<i2").tobytes())
    return path


def main():
    MEDIA.mkdir(exist_ok=True)
    render_frame(2.3).save(MEDIA / "how-it-works-poster.webp", "WEBP", quality=86)
    audio_path = make_audio()
    temp = MEDIA / "how-it-works-video.tmp.mp4"
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgb24",
               "-video_size", f"{W}x{H}", "-framerate", str(FPS), "-i", "-", "-i", str(audio_path),
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-b:a", "128k", "-t", str(LENGTH), "-movflags", "+faststart", str(temp)]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    assert process.stdin
    try:
        for index in range(FPS * LENGTH):
            process.stdin.write(render_frame(index / FPS).tobytes())
    finally:
        process.stdin.close()
    if process.wait():
        raise RuntimeError("Video encoding failed")
    temp.replace(MEDIA / "how-it-works.mp4")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(MEDIA / "how-it-works.mp4"),
                    "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "31", "-deadline", "realtime", "-cpu-used", "5",
                    "-row-mt", "1", "-c:a", "libopus", "-b:a", "96k", str(MEDIA / "how-it-works.webm")], check=True)
    audio_path.unlink()


if __name__ == "__main__":
    main()
