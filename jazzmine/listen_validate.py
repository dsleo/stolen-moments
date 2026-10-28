"""Validate the committed Listen & Find corpus without requiring source data."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path

from .corpus import ROOT


CATALOG = ROOT / "static" / "catalog" / "listen"
HEX = set("0123456789abcdef")


def _hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _digest(value: object) -> bool:
    return isinstance(value, str) and len(value) == 64 and set(value) <= HEX


def _finite(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _fail(message: str) -> None:
    raise ValueError(message)


def _check_solo(row: object) -> int:
    if not isinstance(row, dict):
        _fail("Invalid solo record")
    mid = row.get("id")
    if not _int(mid) or mid < 0 or row.get("melid") != mid:
        _fail(f"Invalid solo identity: {mid!r}")
    for key in ("trackid", "compositionId"):
        if not _int(row.get(key)):
            _fail(f"Solo {mid} has invalid {key}")
    for key in ("performer", "title", "album", "albumArtist", "instrument", "sourceUrl"):
        if not isinstance(row.get(key), str):
            _fail(f"Solo {mid} has invalid {key}")
    if row.get("year") is not None and not _int(row["year"]):
        _fail(f"Solo {mid} has invalid year")
    # WJazzD uses -1 for unknown solo start on some otherwise valid note tracks.
    if not _finite(row.get("soloStartSeconds")) or row["soloStartSeconds"] < -1:
        _fail(f"Solo {mid} has invalid solo start")
    keys = ("pitches", "onsetsSeconds", "durationsSeconds", "beatPositions", "recordingTimes")
    values = [row.get(key) for key in keys]
    if any(not isinstance(v, list) for v in values):
        _fail(f"Solo {mid} has missing note arrays")
    pitches, onsets, durations, beats, times = values
    n = len(pitches)
    if n == 0 or any(len(v) != n for v in values):
        _fail(f"Solo {mid} note array lengths differ or are empty")
    if any(not _int(p) or not 0 <= p <= 127 for p in pitches):
        _fail(f"Solo {mid} has invalid MIDI pitches")
    if any(not _finite(x) or x < 0 for x in onsets):
        _fail(f"Solo {mid} has invalid onsets")
    if any(b < a for a, b in zip(onsets, onsets[1:])):
        _fail(f"Solo {mid} has backwards onsets")
    if any(not _finite(x) or x <= 0 for x in durations):
        _fail(f"Solo {mid} has invalid durations")
    if any(not _finite(x) for x in beats):
        _fail(f"Solo {mid} has invalid beats")
    if any(b < a for a, b in zip(beats, beats[1:])):
        _fail(f"Solo {mid} has backwards beats")
    if any(t is not None and (not _int(t) or t < 0) for t in times):
        _fail(f"Solo {mid} has invalid recording time")
    known_times = [t for t in times if t is not None]
    if any(b < a for a, b in zip(known_times, known_times[1:])):
        _fail(f"Solo {mid} has backwards recording times")
    recording = row.get("recording")
    if recording is not None:
        if not isinstance(recording, dict) or not isinstance(recording.get("videoId"), str) or not recording["videoId"]:
            _fail(f"Solo {mid} has invalid recording metadata")
        if recording.get("kind") not in ("verified", "aligned", "estimated", "candidate"):
            _fail(f"Solo {mid} has invalid recording provenance")
        if recording["kind"] == "candidate" and any(t is not None for t in times):
            _fail(f"Solo {mid} candidate recording has invented timestamps")
    elif any(t is not None for t in times):
        _fail(f"Solo {mid} has recording times without recording metadata")
    return n


def validate(catalog: Path = CATALOG, *, source: Path | None = None) -> dict:
    catalog = Path(catalog)
    try:
        manifest = json.loads((catalog / "manifest.json").read_text("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Missing or invalid Listen & Find manifest") from exc
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != 1:
        _fail("Unsupported Listen & Find catalog version")
    if not isinstance(manifest.get("algorithmVersion"), str) or not manifest["algorithmVersion"]:
        _fail("Missing algorithm version")
    if manifest.get("settingsVersion") != manifest["algorithmVersion"]:
        _fail("Settings version does not match algorithm version")
    if not _digest(manifest.get("sourceSha256")):
        _fail("Invalid source hash")
    if source is not None and _hash(Path(source).read_bytes()) != manifest["sourceSha256"]:
        _fail("Source checksum does not match manifest")
    if not isinstance(manifest.get("modelAssets"), list):
        _fail("Invalid model asset list")
    for asset in manifest["modelAssets"]:
        if (not isinstance(asset, dict) or
                not isinstance(asset.get("path"), str) or
                not _digest(asset.get("sha256")) or
                not _int(asset.get("bytes"))):
            _fail("Invalid model asset metadata")
        asset_path = (catalog / asset["path"]).resolve()
        allowed_bundle = (ROOT / "static" / "listen" / "assets").resolve()
        named_bundle_asset = (catalog.resolve() == CATALOG.resolve() and
                              asset["path"].startswith("../../listen/assets/") and
                              asset_path.is_relative_to(allowed_bundle))
        if not (asset_path.is_relative_to(catalog.resolve()) or named_bundle_asset) or not asset_path.is_file():
            _fail("Missing or unsafe model asset")
        data = asset_path.read_bytes()
        if len(data) != asset["bytes"] or _hash(data) != asset["sha256"]:
            _fail("Model asset checksum mismatch")
    shards = manifest.get("shards")
    if not isinstance(shards, list) or not shards:
        _fail("No search shards")
    solo_count = note_count = 0
    ids: set[int] = set()
    paths: set[str] = set()
    for shard in shards:
        if not isinstance(shard, dict):
            _fail("Invalid shard metadata")
        path = shard.get("path")
        if not isinstance(path, str) or not path.startswith("shard-") or not path.endswith(".json.gz") or "/" in path or "\\" in path or path in paths:
            _fail("Invalid or duplicate shard path")
        paths.add(path)
        if not _digest(shard.get("sha256")) or not _int(shard.get("bytes")) or shard["bytes"] < 1:
            _fail(f"Invalid hash or byte count for {path}")
        if not _int(shard.get("soloCount")) or not _int(shard.get("noteCount")):
            _fail(f"Invalid counts for {path}")
        try:
            data = (catalog / path).read_bytes()
            if len(data) != shard["bytes"] or _hash(data) != shard["sha256"]:
                _fail(f"Checksum mismatch for {path}")
            decoded = json.loads(gzip.decompress(data))
        except (OSError, EOFError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"Missing or invalid shard {path}") from exc
        if not isinstance(decoded, dict) or decoded.get("schemaVersion") != 1 or not isinstance(decoded.get("solos"), list):
            _fail(f"Invalid shard schema for {path}")
        local_notes = 0
        for row in decoded["solos"]:
            if not isinstance(row, dict):
                _fail(f"Invalid solo in {path}")
            mid = row.get("id")
            if mid in ids:
                _fail(f"Duplicate solo ID {mid}")
            ids.add(mid)
            local_notes += _check_solo(row)
        if len(decoded["solos"]) != shard["soloCount"] or local_notes != shard["noteCount"]:
            _fail(f"Count mismatch for {path}")
        solo_count += len(decoded["solos"])
        note_count += local_notes
    if not _int(manifest.get("soloCount")) or manifest["soloCount"] != solo_count:
        _fail("Total solo count mismatch")
    if not _int(manifest.get("noteCount")) or manifest["noteCount"] != note_count:
        _fail("Total note count mismatch")
    return {"solos": solo_count, "notes": note_count,
            "shards": len(shards), "sourceSha256": manifest["sourceSha256"]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=CATALOG)
    parser.add_argument("--source", type=Path)
    args = parser.parse_args()
    result = validate(args.catalog, source=args.source)
    print(f"Validated {result['solos']} solos, {result['notes']} notes "
          f"in {result['shards']} shards")


if __name__ == "__main__":
    main()
