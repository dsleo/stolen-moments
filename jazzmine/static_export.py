"""Publish the joint WJazzD search as a self-contained, read-only static site.

The compact index carries every passage and its solo metadata. Alignments and
source notes are fetched only when a listener opens a passage. Recording maps
are copied from the existing workbench and retain its timing conventions.
"""
from __future__ import annotations

import argparse
import gzip
import json
import shutil
import sqlite3
from collections import Counter
from pathlib import Path

from . import covers
from .corpus import ROOT, load_corpus, source_checksum
from .joint_store import DEFAULT_STORE, PIPELINE


OUTPUT = ROOT / "static" / "catalog"
MEDIA_STORE = ROOT / "data" / "workbench.db"
SHARD_SIZE = 1024
ALBUM_ART_MAP = ROOT / "data" / "album-art-map.json"
VIDEO_AUDIT = ROOT / "data" / "joint-video-audit.json"
VIDEO_REPLACEMENTS = ROOT / "data" / "joint-video-replacements.json"


def write_gzip(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    path.write_bytes(gzip.compress(data, compresslevel=6, mtime=0))


def media_maps(path: Path) -> tuple[dict, dict, dict]:
    db = sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    try:
        manual = {str(r["trackid"]): dict(r) for r in db.execute("SELECT * FROM media_link")}
        aligned = {}
        for r in db.execute("SELECT * FROM jazztube_video ORDER BY melid,rank"):
            aligned.setdefault(str(r["melid"]), dict(r))
        automatic = {str(r["trackid"]): dict(r) for r in db.execute("SELECT * FROM video_match")}
        if VIDEO_AUDIT.exists():
            audit = json.loads(VIDEO_AUDIT.read_text())
            unavailable = {v["id"] for v in audit.get("videos", []) if v["status"] == "unavailable"}
            replacements = json.loads(VIDEO_REPLACEMENTS.read_text()) if VIDEO_REPLACEMENTS.exists() else {}
            for melid, match in list(aligned.items()):
                if match["video_id"] in unavailable:
                    replacement = replacements.get(melid)
                    if replacement and replacement["replaces"] == match["video_id"]:
                        aligned[melid] = {**match, **replacement}
                    else:
                        del aligned[melid]
            manual = {key: row for key, row in manual.items() if row["video_id"] not in unavailable}
            automatic = {key: row for key, row in automatic.items() if row["video_id"] not in unavailable}
        return manual, aligned, automatic
    finally:
        db.close()


def recording(solo, track_time: float, manual: dict, aligned: dict, automatic: dict) -> dict | None:
    """Link to the passage onset, using the same source priority as App._recording."""
    row = manual.get(str(solo.trackid))
    match = aligned.get(str(solo.melid))
    auto = automatic.get(str(solo.trackid))
    if row and row["performance_verified"]:
        second = max(0, int(row["speed_ratio"] * track_time + row["offset_seconds"]))
        return {"video_id": row["video_id"], "second": second, "kind": "verified"}
    if match:
        source_duration = max(o + d for o, d in zip(solo.onsets, solo.durations))
        video_duration = match["solo_end_sec"] - match["solo_start_sec"]
        ratio = video_duration / source_duration if source_duration > 0 else 1.0
        if not .8 <= ratio <= 1.2:
            ratio = 1.0
        passage_offset = max(0, track_time - solo.solo_start)
        second = max(0, int(match["solo_start_sec"] + passage_offset * ratio))
        return {"video_id": match["video_id"], "second": second, "kind": "aligned"}
    if row:
        return {"video_id": row["video_id"], "second": None, "kind": "candidate"}
    if auto and track_time < auto["video_duration"]:
        second = max(0, int(track_time))
        return {"video_id": auto["video_id"], "second": second, "kind": "estimated"}
    return None


def solo_metadata(solo) -> dict:
    return {k: getattr(solo, k) for k in (
        "melid", "trackid", "performer", "title", "album", "album_artist", "instrument",
        "recording_date", "year", "composition_id", "solo_start", "musicbrainz_id",
        "source", "source_id", "source_url")}


def export(store: Path = DEFAULT_STORE, output: Path = OUTPUT,
           media_store: Path = MEDIA_STORE, floor: float = .8) -> dict:
    db = sqlite3.connect(f"file:{store.resolve()}?mode=ro", uri=True)
    try:
        meta = dict(db.execute("SELECT key,value FROM meta"))
        if meta.get("complete") != "True" or meta.get("source_sha256") != source_checksum():
            raise ValueError("Build the complete joint WJazzD index before exporting")
        if meta.get("pipeline") != PIPELINE:
            raise ValueError("Rebuild the joint WJazzD index with the current pipeline before exporting")
        settings = json.loads(meta["settings"])
        if abs(float(settings.get("min_similarity", -1)) - floor) > 1e-9:
            raise ValueError("The export floor must match the endpoint floor used to build the joint index")
        solos = load_corpus()
        manual, aligned, automatic = media_maps(media_store)
        album_art = json.loads(ALBUM_ART_MAP.read_text()) if ALBUM_ART_MAP.exists() else {}
        output.mkdir(parents=True, exist_ok=True)
        detail_dir = output / "detail"
        note_dir = output / "notes"
        cover_dir = output / "covers"
        for directory in (detail_dir, note_dir, cover_dir):
            if directory.exists():
                shutil.rmtree(directory)
            directory.mkdir()

        rows = []
        detail_shard = []
        used = set()
        coverage = Counter()
        for r in db.execute("""SELECT a_id,b_id,a_start,a_end,b_start,b_end,paired,gaps,
                                   cost,similarity,evidence,transposition,alignment
                            FROM candidate WHERE similarity>=?
                            ORDER BY evidence DESC,a_id,b_id,a_start,b_start""", (floor,)):
            ai, bi, a0, a1, b0, b1, paired, gaps, cost, similarity, evidence, transposition, alignment = r
            a, b = solos[ai], solos[bi]
            used.update((ai, bi))
            ta_raw = a.solo_start + a.onsets[a0]
            tb_raw = b.solo_start + b.onsets[b0]
            ta, tb = round(ta_raw, 3), round(tb_raw, 3)
            ra = recording(a, ta_raw, manual, aligned, automatic)
            rb = recording(b, tb_raw, manual, aligned, automatic)
            for link in (ra, rb):
                coverage[link["kind"] if link else "none"] += 1
            # Row ID is its position in this stable evidence-sorted array.
            # The two video seconds are calculated once from source timing.
            rows.append([ai, bi, a0, a1, b0, b1, paired, gaps,
                         round(similarity, 8), round(evidence, 3), ta, tb,
                         ra["second"] if ra else None, rb["second"] if rb else None])
            detail_shard.append([transposition, json.loads(alignment)])
            if len(detail_shard) == SHARD_SIZE:
                write_gzip(detail_dir / f"{(len(rows)-1)//SHARD_SIZE:04d}.json.gz", detail_shard)
                detail_shard = []
        if detail_shard:
            write_gzip(detail_dir / f"{(len(rows)-1)//SHARD_SIZE:04d}.json.gz", detail_shard)

        metadata = {}
        covers_copied = 0
        resolved_covers = 0
        for mid in sorted(used):
            solo = solos[mid]
            item = solo_metadata(solo)
            link = recording(solo, solo.solo_start + solo.onsets[0], manual, aligned, automatic)
            if link:
                item["video_id"] = link["video_id"]
                item["video_kind"] = link["kind"]
                if link["kind"] == "aligned":
                    item["video_source_url"] = f"http://mir.audiolabs.uni-erlangen.de/jazztube/solos/solo/{mid}"
                if link["kind"] == "estimated":
                    item["video_title"] = automatic[str(solo.trackid)]["title"]
                    item["video_channel"] = automatic[str(solo.trackid)]["channel"]
                if link["kind"] == "verified":
                    item["video_verifier"] = manual[str(solo.trackid)]["verifier"]
                    item["video_evidence"] = manual[str(solo.trackid)]["evidence"]
            key = covers._key(solo.performer, solo.album or solo.title, solo.title)
            for ext in covers.MIME:
                src = covers.CACHE / f"{key}{ext}"
                if src.exists():
                    shutil.copy2(src, cover_dir / f"{key}{ext}")
                    item["cover"] = f"catalog/covers/{key}{ext}"
                    covers_copied += 1
                    break
            if not item.get("cover"):
                key = f"{solo.album_artist}\0{solo.album}"
                resolved = album_art.get(key, {})
                src = ROOT / resolved["path"] if resolved.get("path") else None
                if src is not None and src.is_file():
                    shutil.copy2(src, cover_dir / src.name)
                    item["cover"] = f"catalog/covers/{src.name}"
                    item["cover_source"] = resolved.get("source")
                    item["cover_release_title"] = resolved.get("release_title")
                    resolved_covers += 1
            metadata[str(mid)] = item
            write_gzip(note_dir / f"{mid}.json.gz", [
                [solo.eventids[i], solo.pitches[i], round(solo.onsets[i], 3),
                 round(solo.durations[i], 3), round(solo.beat_positions[i], 3),
                 solo.phrase_ids[i], solo.chords[i]]
                for i in range(len(solo.pitches))])

        write_gzip(output / "index.json.gz", {"version": 1, "floor": floor,
                   "shard_size": SHARD_SIZE, "source_sha256": meta["source_sha256"],
                   "settings": settings,
                   "solos": metadata, "rows": rows})
        report = {"passages": len(rows), "solos": len(used), "floor": floor,
                  "recording_sides": dict(coverage), "cached_covers": covers_copied,
                  "resolved_covers": resolved_covers,
                  "index_bytes": (output / "index.json.gz").stat().st_size,
                  "total_bytes": sum(p.stat().st_size for p in output.rglob("*") if p.is_file())}
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        return report
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", type=Path, default=DEFAULT_STORE)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--media-store", type=Path, default=MEDIA_STORE)
    parser.add_argument("--floor", type=float, default=.8)
    args = parser.parse_args()
    print(json.dumps(export(args.store, args.output, args.media_store, args.floor), indent=2))


if __name__ == "__main__":
    main()
