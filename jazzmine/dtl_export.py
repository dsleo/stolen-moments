"""Reconcile published DTL metadata with the saved notes without inventing gaps.

This is a staging export, not an index import. It never changes the source DB.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import sqlite3
from pathlib import Path

from .corpus import _time_seconds
from .dtl import DTL_SOURCE, METADATA_CACHE, detail_url

SOLOS_KEY = "solo_#metadata_full_compressed_v7_csv"


def _note_issues(pitches, onsets, durations):
    if not all(isinstance(v, list) for v in (pitches, onsets, durations)):
        return ["Note arrays must be lists"]
    issues = []
    if not pitches or not len(pitches) == len(onsets) == len(durations):
        issues.append("Empty or unequal note arrays")
    if any(type(p) is not int or not 0 <= p <= 127 for p in pitches):
        issues.append("Invalid MIDI pitches")
    valid_times = all(type(v) in (int, float) and math.isfinite(v)
                      for v in onsets + durations)
    if not valid_times:
        issues.append("Invalid note times")
    else:
        if any(v < 0 for v in onsets) or any(v <= 0 for v in durations):
            issues.append("Negative onset or nonpositive duration")
        if any(a > b for a, b in zip(onsets, onsets[1:])):
            issues.append("Unsorted note onsets")
    return issues


def reconcile(archive_path: Path, metadata_path: Path = METADATA_CACHE,
              notes_path: Path = DTL_SOURCE) -> dict:
    tracks = json.loads(archive_path.read_text(encoding="utf-8-sig"))
    by_track = {t["file"]: t for t in tracks}
    if len(by_track) != len(tracks):
        raise ValueError("Duplicate archive track IDs")
    archive_solos = {}
    for track in tracks:
        for solo in track.get(SOLOS_KEY, []):
            sid = solo["solo_id"]
            if sid in archive_solos:
                raise ValueError(f"Duplicate archive solo ID: {sid}")
            if sid.rsplit("_", 1)[0] != track["file"]:
                raise ValueError(f"Archive solo belongs to another track: {sid}")
            archive_solos[sid] = solo
    with metadata_path.open(encoding="utf-8-sig", newline="") as fh:
        catalog = list(csv.DictReader(fh, delimiter=";"))
    catalog_ids = {r["solo_id"] for r in catalog}
    if not catalog or len(catalog_ids) != len(catalog):
        raise ValueError("Empty catalog or duplicate solo IDs")
    notes = {}
    if notes_path.exists():
        db = sqlite3.connect(f"{notes_path.resolve().as_uri()}?mode=ro", uri=True)
        db.row_factory = sqlite3.Row
        try:
            notes = {r["solo_id"]: dict(r) for r in db.execute("SELECT * FROM solo")}
        finally:
            db.close()
    solos, missing, invalid, timestamp_differences, duration_warnings = [], [], [], [], []
    total_notes = 0
    for meta in catalog:
        sid = meta["solo_id"]
        tid = sid.rsplit("_", 1)[0]
        original = archive_solos.get(sid)
        timing = None
        if original is not None:
            start, duration = original["onset"], original["duration"]
            if not all(type(v) in (int, float) and math.isfinite(v) for v in (start, duration)) or start < 0 or duration <= 0:
                raise ValueError(f"Invalid archive timing: {sid}")
            timing = {"start_seconds": start, "duration_seconds": duration,
                      "source": "archive_numeric_onset_and_duration"}
            if abs(start - _time_seconds(meta["solo_start"])) > .00001:
                timestamp_differences.append(sid)
        saved = notes.get(sid)
        note_data = None
        issues = []
        if saved is None:
            missing.append(sid)
        else:
            try:
                p, o, d = (json.loads(saved[k]) for k in ("pitches", "onsets", "durations"))
                issues = _note_issues(p, o, d)
            except (ValueError, TypeError) as exc:
                issues = [f"Cannot parse notes: {exc}"]
            if issues:
                invalid.append({"solo_id": sid, "issues": issues})
            else:
                total_notes += len(p)
                note_data = {"pitches": p, "onsets": o, "durations": d,
                             "source_url": saved["source_url"],
                             "timing_reference": "website_player; absolute first-note offset unverified"}
                if timing and max(a + b for a, b in zip(o, d)) > timing["duration_seconds"] + .1:
                    duration_warnings.append(sid)
        solos.append({"solo_id": sid, "track_id": tid, "metadata": meta,
                      "archive_solo": original, "timing": timing,
                      "notes": note_data, "note_issues": issues,
                      "source_url": detail_url(sid)})
    report = {
        "archive_tracks": len(tracks), "archive_solos": len(archive_solos),
        "catalog_solos": len(catalog), "catalog_tracks": len({s["track_id"] for s in solos}),
        "catalog_tracks_missing_from_archive": sorted({s["track_id"] for s in solos} - by_track.keys()),
        "exact_archive_solo_matches": sum(s["archive_solo"] is not None for s in solos),
        "catalog_solos_missing_from_archive": sorted(catalog_ids - archive_solos.keys()),
        "archive_solos_outside_catalog": sorted(archive_solos.keys() - catalog_ids),
        "available_note_solos": sum(s["notes"] is not None for s in solos),
        "available_notes": total_notes, "missing_note_solos": missing,
        "invalid_note_solos": invalid,
        "cached_solos_outside_catalog": sorted(notes.keys() - catalog_ids),
        "csv_start_time_disagrees_with_archive": timestamp_differences,
        "note_span_exceeds_archive_duration_by_over_100ms": duration_warnings,
        "named_soloist_missing": sum(not r["solo_performer_name"] for r in catalog),
        "complete_notes": not missing and not invalid,
        "ready_for_app_import": False,
        "timing_review_required": "Verify website player onset origin before using absolute recording timestamps.",
    }
    return {"schema_version": 1, "collection": "DTL1000", "status": "staging",
            "sources": {"archive_url": "https://osf.io/6jm8x/",
                        "archive_sha256": hashlib.sha256(archive_path.read_bytes()).hexdigest(),
                        "catalog_sha256": hashlib.sha256(metadata_path.read_bytes()).hexdigest(),
                        "notes_sha256": hashlib.sha256(notes_path.read_bytes()).hexdigest() if notes_path.exists() else None},
            "report": report, "tracks": tracks, "solos": solos}
