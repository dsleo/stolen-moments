"""Import a balanced pilot from the public Jazz Trio Database annotations."""
from __future__ import annotations

import hashlib
import io
import json
import math
import sqlite3
import zipfile
from collections import defaultdict
from pathlib import Path

from mido import MidiFile, merge_tracks, tick2second

from .corpus import ROOT, _stable_external_id

JTD_SOURCE = ROOT / "data" / "jtd.db"
JTD_URL = "https://github.com/HuwCheston/Jazz-Trio-Database/releases/download/v02-zenodo/jazz-trio-database-v02.zip"
PILOT_LIMIT = 120


def _seconds(timestamp: str) -> float:
    parts = [int(x) for x in timestamp.split(":")]
    return float(parts[-1] + 60 * parts[-2] + (3600 * parts[-3] if len(parts) == 3 else 0))


def _notes_from_midi(blob: bytes) -> list[tuple[float, float, int]]:
    midi = MidiFile(file=io.BytesIO(blob))
    tempo = 500_000
    last_tick = 0
    elapsed = 0.0
    active: dict[tuple[int, int], list[float]] = defaultdict(list)
    notes = []
    for msg in merge_tracks(midi.tracks):
        elapsed += tick2second(msg.time, midi.ticks_per_beat, tempo)
        if msg.type == "set_tempo":
            tempo = msg.tempo
        elif msg.type == "note_on" and msg.velocity:
            active[(msg.channel, msg.note)].append(elapsed)
        elif msg.type == "note_off" or (msg.type == "note_on" and not msg.velocity):
            key = (msg.channel, msg.note)
            if active[key]:
                start = active[key].pop(0)
                if elapsed > start:
                    notes.append((start, elapsed, msg.note))
        last_tick += msg.time
    return sorted(notes)


def _top_line(notes: list[tuple[float, float, int]]) -> tuple[list[int], list[float], list[float]]:
    """Choose the highest MIDI pitch for each simultaneous piano onset."""
    groups: dict[float, list[tuple[float, int]]] = defaultdict(list)
    for start, end, pitch in notes:
        if end > start:
            groups[round(start, 4)].append((end, pitch))
    pitches, onsets, durations = [], [], []
    for onset in sorted(groups):
        end, pitch = max(groups[onset], key=lambda x: (x[1], x[0]))
        if pitches and pitch == pitches[-1] and onset - onsets[-1] < .06:
            if end - onset > durations[-1]:
                durations[-1] = end - onsets[-1]
            continue
        pitches.append(pitch)
        onsets.append(onset)
        durations.append(end - onset)
    return pitches, onsets, durations


def import_pilot(archive: Path, path: Path = JTD_SOURCE,
                 limit: int = PILOT_LIMIT) -> dict:
    if limit < 1 or limit > 500:
        raise ValueError("Pilot limit must be between 1 and 500")
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    with zipfile.ZipFile(archive) as zf:
        metadata_paths = sorted(n for n in zf.namelist() if n.endswith("/metadata.json"))
        candidates = []
        for name in metadata_paths:
            meta = json.loads(zf.read(name))
            if not meta.get("musicians", {}).get("pianist"):
                continue
            folder = name.rsplit("/", 1)[0]
            midi_path = folder + "/piano_midi.mid"
            if midi_path not in zf.namelist():
                continue
            candidates.append((meta, folder, midi_path, name))

        # Balance the pilot across pianists, ranking each pianist's recordings
        # by available piano transcription quality and solo length.
        ranked = defaultdict(list)
        for meta, folder, midi_path, name in candidates:
            quality = meta.get("rating_piano_detection")
            quality = float(quality) if isinstance(quality, (int, float)) and math.isfinite(quality) else 0.0
            length = _seconds(meta["timestamps"]["end"]) - _seconds(meta["timestamps"]["start"])
            ranked[meta["musicians"]["pianist"]].append((quality, length, folder, meta, midi_path, name))
        for pianist in ranked:
            ranked[pianist].sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
        selected = []
        depth = 0
        pianists = sorted(ranked)
        while len(selected) < limit:
            added = False
            for pianist in pianists:
                if depth < len(ranked[pianist]) and len(selected) < limit:
                    selected.append(ranked[pianist][depth])
                    added = True
            if not added:
                break
            depth += 1

        path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(path)
        db.executescript("""
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS solo (
                solo_id TEXT PRIMARY KEY, track_id TEXT NOT NULL,
                pianist TEXT NOT NULL, title TEXT NOT NULL, album TEXT NOT NULL,
                bandleader TEXT NOT NULL, year TEXT NOT NULL, solo_start REAL NOT NULL,
                duration REAL NOT NULL, tempo REAL NOT NULL, time_signature INTEGER NOT NULL,
                musicbrainz_id TEXT, pitches TEXT NOT NULL, onsets TEXT NOT NULL,
                durations TEXT NOT NULL, beat_positions TEXT NOT NULL,
                source_url TEXT NOT NULL, pitch_policy TEXT NOT NULL
            );
        """)
        with db:
            db.execute("DELETE FROM solo")
            db.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", ("archive_sha256", checksum))
            db.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", ("archive_url", JTD_URL))
            db.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", ("pilot_limit", str(limit)))
            for quality, length, folder, meta, midi_path, name in selected:
                midi_notes = _notes_from_midi(zf.read(midi_path))
                pitches, onsets, durations = _top_line(midi_notes)
                if len(pitches) < 16:
                    continue
                solo_id = folder.rsplit("/", 1)[-1]
                track_id = solo_id
                track_start = _seconds(meta["timestamps"]["start"])
                source_url = (meta.get("links", {}).get("external") or [""])[0]
                if not source_url:
                    source_url = "https://github.com/HuwCheston/Jazz-Trio-Database"
                beat_times = []
                beats_path = folder + "/beats.csv"
                if beats_path in zf.namelist():
                    import csv
                    reader = csv.DictReader(io.StringIO(zf.read(beats_path).decode("utf-8-sig")))
                    for row in reader:
                        try:
                            beat_times.append(float(row["beat"]))
                        except (ValueError, KeyError):
                            continue
                beat_positions = []
                for onset in onsets:
                    before = [i for i, beat in enumerate(beat_times) if beat <= onset]
                    beat_positions.append(float(before[-1]) if before else onset * float(meta.get("tempo", 120)) / 60)
                db.execute("INSERT INTO solo VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                    solo_id, track_id, meta["musicians"]["pianist"], meta["track_name"],
                    meta["album_name"], meta["bandleader"], str(meta.get("recording_year") or ""),
                    track_start, length, float(meta.get("tempo") or 120),
                    int(meta.get("time_signature") or 4), meta.get("mbz_id"),
                    json.dumps(pitches), json.dumps(onsets), json.dumps(durations),
                    json.dumps(beat_positions), source_url, "highest pitch at simultaneous piano onsets"))
        saved, notes, performer_counts = db.execute(
            "SELECT COUNT(*), SUM(json_array_length(pitches)), COUNT(DISTINCT pianist) FROM solo").fetchone()
        db.close()
    return {"archive": str(archive), "archive_sha256": checksum, "archive_tracks": len(metadata_paths),
            "selected_for_pilot": len(selected), "imported_performances": saved,
            "pianists": performer_counts, "notes_in_top_line": notes or 0,
            "database": str(path), "source_url": JTD_URL,
            "pitch_policy": "highest pitch at simultaneous piano onsets"}
