"""Publish every WJazzD note track for browser-side Listen & Find search.

This export is intentionally independent of the precomputed pair catalog: solos
without a pair match still need to be searchable from an incoming phrase.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path

from .corpus import ROOT, SOURCE, Solo, load_corpus
from .static_export import MEDIA_STORE, media_maps, recording


OUTPUT = ROOT / "static" / "catalog" / "listen"
SCHEMA_VERSION = 1
ALGORITHM_VERSION = "listen-v1"
TARGET_NOTES_PER_SHARD = 25_000


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"),
                      sort_keys=True, allow_nan=False).encode("utf-8")


def _recording_metadata(solo: Solo, link: dict | None, manual: dict,
                        aligned: dict, automatic: dict) -> dict | None:
    if not link:
        return None
    result = {"videoId": link["video_id"], "kind": link["kind"]}
    if link["kind"] == "aligned":
        result["sourceUrl"] = (
            f"http://mir.audiolabs.uni-erlangen.de/jazztube/solos/solo/{solo.melid}"
        )
    elif link["kind"] == "estimated":
        row = automatic.get(str(solo.trackid), {})
        result["title"] = row.get("title")
        result["channel"] = row.get("channel")
    elif link["kind"] == "verified":
        row = manual.get(str(solo.trackid), {})
        result["verifier"] = row.get("verifier")
        result["evidence"] = row.get("evidence")
    return result


def _solo_record(solo: Solo, manual: dict, aligned: dict,
                 automatic: dict) -> dict:
    times = []
    for onset in solo.onsets:
        link = recording(solo, solo.solo_start + onset, manual, aligned, automatic)
        times.append(link["second"] if link else None)
    first = recording(solo, solo.solo_start + solo.onsets[0],
                      manual, aligned, automatic) if solo.onsets else None
    return {
        "id": solo.melid,
        "melid": solo.melid,
        "trackid": solo.trackid,
        "performer": solo.performer,
        "title": solo.title,
        "album": solo.album,
        "albumArtist": solo.album_artist,
        "instrument": solo.instrument,
        "year": solo.year,
        "compositionId": solo.composition_id,
        "soloStartSeconds": solo.solo_start,
        "sourceUrl": solo.source_url,
        "pitches": solo.pitches,
        "onsetsSeconds": solo.onsets,
        "durationsSeconds": solo.durations,
        "beatPositions": solo.beat_positions,
        "recordingTimes": times,
        "recording": _recording_metadata(solo, first, manual, aligned, automatic),
    }


def export(source: Path = SOURCE, output: Path = OUTPUT,
           media_store: Path = MEDIA_STORE, *,
           solos: dict[int, Solo] | None = None,
           media: tuple[dict, dict, dict] | None = None,
           target_notes_per_shard: int = TARGET_NOTES_PER_SHARD) -> dict:
    """Build and validate a deterministic, complete static WJazzD note index."""
    if target_notes_per_shard < 1:
        raise ValueError("target_notes_per_shard must be positive")
    source = Path(source)
    output = Path(output)
    if not source.is_file():
        raise FileNotFoundError(f"WJazzD source is missing: {source}")
    source_hash = _sha256(source.read_bytes())
    if solos is None:
        solos = load_corpus(source)
    if media is None:
        media = media_maps(media_store) if Path(media_store).is_file() else ({}, {}, {})
    manual, aligned, automatic = media
    output.mkdir(parents=True, exist_ok=True)
    shards: list[dict] = []
    records: list[dict] = []
    note_count = 0

    def flush() -> None:
        nonlocal records, note_count
        if not records:
            return
        name = f"shard-{len(shards):03d}.json.gz"
        data = gzip.compress(_json_bytes({"schemaVersion": SCHEMA_VERSION,
                                          "solos": records}),
                             compresslevel=6, mtime=0)
        (output / name).write_bytes(data)
        shards.append({"path": name, "sha256": _sha256(data), "bytes": len(data),
                       "soloCount": len(records), "noteCount": note_count})
        records = []
        note_count = 0

    for mid in sorted(solos):
        solo = solos[mid]
        if not solo.pitches:
            raise ValueError(f"Solo {mid} has no notes")
        if records and note_count >= target_notes_per_shard:
            flush()
        records.append(_solo_record(solo, manual, aligned, automatic))
        note_count += len(solo.pitches)
    flush()
    if not shards:
        raise ValueError("Source contains no solos")

    model_assets = []
    asset_manifest = ROOT / "static" / "listen" / "assets" / "assets.json"
    if output.resolve() == OUTPUT.resolve() and asset_manifest.is_file():
        for name, details in sorted(json.loads(asset_manifest.read_text()).items()):
            if Path(name).name != name:
                raise ValueError("Unsafe model asset name")
            model_assets.append({"path": f"../../listen/assets/{name}",
                                 "bytes": details["bytes"], "sha256": details["sha256"]})

    manifest = {"schemaVersion": SCHEMA_VERSION,
                "algorithmVersion": ALGORITHM_VERSION,
                "sourceSha256": source_hash,
                "soloCount": len(solos),
                "noteCount": sum(shard["noteCount"] for shard in shards),
                "shards": shards,
                "modelAssets": model_assets,
                "settingsVersion": ALGORITHM_VERSION}
    (output / "manifest.json").write_bytes(_json_bytes(manifest) + b"\n")
    # Remove leftovers from an older export with a different number of shards.
    valid = {s["path"] for s in shards}
    for stale in output.glob("shard-*.json.gz"):
        if stale.name not in valid:
            stale.unlink()
    from .listen_validate import validate
    validate(output, source=source)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--media-store", type=Path, default=MEDIA_STORE)
    args = parser.parse_args()
    manifest = export(args.source, args.output, args.media_store)
    print(f"Exported {manifest['soloCount']} solos and {manifest['noteCount']} notes "
          f"in {len(manifest['shards'])} shards to {args.output}")


if __name__ == "__main__":
    main()
