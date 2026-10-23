from __future__ import annotations

import bisect
import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "wjazzd.db"
STORE = ROOT / "data" / "workbench.db"


@dataclass(slots=True)
class Solo:
    melid: int
    trackid: int
    performer: str
    title: str
    album: str
    album_artist: str
    instrument: str
    recording_date: str
    year: int | None
    composition_id: int
    solo_start: float
    musicbrainz_id: str | None
    pitches: list[int]
    onsets: list[float]
    durations: list[float]
    eventids: list[int]
    beat_positions: list[float]
    phrase_ids: list[int | None]
    chords: list[str | None]
    source: str = "WJazzD"
    source_id: str = ""
    source_url: str = ""
    _intervals: list[int] | None = field(default=None, init=False, repr=False)
    _ioi_beats: list[float] | None = field(default=None, init=False, repr=False)
    _ioi_seconds: list[float] | None = field(default=None, init=False, repr=False)

    @property
    def intervals(self) -> list[int]:
        if self._intervals is None:
            self._intervals = [b - a for a, b in zip(self.pitches, self.pitches[1:])]
        return self._intervals

    @property
    def ioi_beats(self) -> list[float]:
        if self._ioi_beats is None:
            self._ioi_beats = [b - a for a, b in zip(self.beat_positions, self.beat_positions[1:])]
        return self._ioi_beats

    @property
    def ioi_seconds(self) -> list[float]:
        if self._ioi_seconds is None:
            self._ioi_seconds = [b - a for a, b in zip(self.onsets, self.onsets[1:])]
        return self._ioi_seconds


def source_checksum() -> str:
    h = hashlib.sha256()
    with SOURCE.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def combined_source_checksum() -> str:
    """Identify the exact WJazzD and optional DTL1000 data used for an index."""
    from .dtl import DTL_SOURCE
    if not _dtl_complete(DTL_SOURCE):
        return source_checksum()
    h = hashlib.sha256()
    for path in (SOURCE, DTL_SOURCE):
        h.update(path.name.encode())
        with path.open("rb") as fh:
            for block in iter(lambda: fh.read(1024 * 1024), b""):
                h.update(block)
    return h.hexdigest()


def year_from_text(value: str | None) -> int | None:
    # Dates in WJazzD include ISO dates, years, and day/month ranges.
    hits = re.findall(r"(?<!\d)(?:18|19|20)\d{2}(?!\d)", value or "")
    return int(hits[0]) if hits else None


def _beat_position(onset: float, beats: list[float]) -> float:
    if len(beats) < 2:
        return onset
    j = bisect.bisect_right(beats, onset) - 1
    j = max(0, min(j, len(beats) - 2))
    width = beats[j + 1] - beats[j]
    return j + (onset - beats[j]) / width if width > 0 else float(j)


def load_corpus(path: Path = SOURCE) -> dict[int, Solo]:
    if not path.exists():
        raise FileNotFoundError(f"WJazzD source is missing: {path}. Run `python3 -m jazzmine download`.")
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    rows = db.execute("""
        SELECT s.melid, s.trackid, s.performer, s.title, s.instrument,
               s.compid, t.recordingdate, t.mbzid, r.recordtitle AS album,
               r.artist AS album_artist,
               x.solostart_sec
        FROM solo_info s
        JOIN melody_type mt ON mt.melid=s.melid AND mt.type='SOLO'
        JOIN track_info t ON t.trackid=s.trackid
        LEFT JOIN record_info r ON r.recordid=s.recordid
        JOIN transcription_info x ON x.melid=s.melid
        ORDER BY s.melid
    """).fetchall()
    solos: dict[int, Solo] = {}
    for r in rows:
        mid = int(r["melid"])
        note_rows = db.execute("""
            SELECT eventid, onset, duration, pitch FROM melody
            WHERE melid=? ORDER BY onset,eventid
        """, (mid,)).fetchall()
        beat_rows = db.execute("SELECT onset, chord FROM beats WHERE melid=? ORDER BY onset", (mid,)).fetchall()
        beat_times = [float(b["onset"]) for b in beat_rows]
        phrase_rows = db.execute("SELECT start,end,value FROM sections WHERE melid=? AND type='PHRASE'", (mid,)).fetchall()
        phrases: list[int | None] = [None] * len(note_rows)
        for p in phrase_rows:
            # `sections.start/end` are note indices relative to the melody, not eventids.
            try:
                val = int(p["value"])
            except (ValueError, TypeError):
                val = None
            for n in range(max(0, int(p["start"])), min(len(phrases), int(p["end"]) + 1)):
                phrases[n] = val
        onsets = [float(n["onset"]) for n in note_rows]
        chords = []
        for onset in onsets:
            bi = bisect.bisect_right(beat_times, onset) - 1
            chords.append(beat_rows[bi]["chord"] if bi >= 0 else None)
        solos[mid] = Solo(
            melid=mid, trackid=int(r["trackid"]), performer=r["performer"] or "Unknown",
            title=r["title"] or "Untitled", album=r["album"] or "",
            album_artist=r["album_artist"] or "", instrument=r["instrument"] or "",
            recording_date=r["recordingdate"] or "", year=year_from_text(r["recordingdate"]),
            composition_id=int(r["compid"]), solo_start=float(r["solostart_sec"] or 0),
            musicbrainz_id=r["mbzid"], pitches=[round(float(n["pitch"])) for n in note_rows],
            onsets=onsets, durations=[float(n["duration"]) for n in note_rows],
            eventids=[int(n["eventid"]) for n in note_rows],
            beat_positions=[_beat_position(x, beat_times) for x in onsets],
            phrase_ids=phrases, chords=chords,
            source_id=str(mid), source_url=f"https://jazzomat.hfm-weimar.de/dbformat/synopsis/solo{mid}.html",
        )
    db.close()
    return solos


def _time_seconds(value: str) -> float:
    hours, minutes, seconds = value.split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def _stable_external_id(value: str, prefix: int) -> int:
    return prefix + int.from_bytes(hashlib.blake2b(value.encode(), digest_size=6).digest(), "big")


def _dtl_complete(path: Path) -> bool:
    if not path.exists():
        return False
    db = None
    try:
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        expected = db.execute("SELECT value FROM meta WHERE key='metadata_count'").fetchone()
        count = db.execute("SELECT COUNT(*) FROM solo").fetchone()[0]
        return expected is not None and count == int(expected[0])
    except (sqlite3.Error, ValueError):
        return False
    finally:
        if db is not None:
            db.close()


def load_dtl_corpus(path: Path | None = None, require_complete: bool = False) -> dict[int, Solo]:
    from .dtl import DTL_SOURCE
    path = path or DTL_SOURCE
    if not path.exists():
        return {}
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    solos = {}
    try:
        if require_complete:
            try:
                expected = db.execute("SELECT value FROM meta WHERE key='metadata_count'").fetchone()
            except sqlite3.OperationalError:
                expected = None
            count = db.execute("SELECT COUNT(*) FROM solo").fetchone()[0]
            if expected is None or count != int(expected[0]):
                raise ValueError(f"DTL1000 note data is incomplete ({count} solos); a complete authorized export is needed before indexing it.")
        for r in db.execute("SELECT * FROM solo ORDER BY solo_id"):
            meta = json.loads(r["metadata"])
            pitches = json.loads(r["pitches"])
            onsets = json.loads(r["onsets"])
            durations = json.loads(r["durations"])
            if not pitches:
                continue
            solo_id = r["solo_id"]
            track_id = solo_id.split("_", 1)[0]
            mid = _stable_external_id(solo_id, 1_000_000)
            tid = _stable_external_id(track_id, 2_000_000)
            if mid in solos:
                raise ValueError(f"DTL1000 solo ID collision: {solo_id}")
            name = meta.get("solo_performer_name") or (
                "Possible: " + meta["possible_solo_performer_names"] if meta.get("possible_solo_performer_names")
                else "Unknown soloist")
            title = meta.get("track_title") or "Untitled"
            solos[mid] = Solo(
                melid=mid, trackid=tid, performer=name.strip(), title=title.strip(),
                album=(meta.get("medium_title") or meta.get("disk_title") or "").strip(),
                album_artist=(meta.get("band_name") or meta.get("leader_name") or "").strip(),
                instrument=(meta.get("instrument_label") or "").strip(),
                recording_date=(meta.get("session_date") or "").strip(),
                year=year_from_text(meta.get("session_date")), composition_id=-tid,
                solo_start=_time_seconds(meta["solo_start"]), musicbrainz_id=None,
                pitches=pitches, onsets=onsets, durations=durations,
                eventids=list(range(1, len(pitches) + 1)),
                beat_positions=[x / .5 for x in onsets],
                phrase_ids=[None] * len(pitches), chords=[None] * len(pitches),
                source="DTL1000", source_id=solo_id, source_url=r["source_url"],
            )
    finally:
        db.close()
    return solos


def load_combined_corpus(require_dtl: bool = False) -> dict[int, Solo]:
    from .dtl import DTL_SOURCE
    solos = load_corpus()
    if not _dtl_complete(DTL_SOURCE):
        if require_dtl:
            raise ValueError("A complete DTL1000 note-track export is needed before indexing it.")
        return solos
    external = load_dtl_corpus(require_complete=True)
    if set(solos) & set(external):
        raise ValueError("WJazzD and DTL1000 solo IDs overlap")
    solos.update(external)
    return solos


def validate_corpus(solos: dict[int, Solo], checksum: str | None = None) -> dict:
    issues = []
    notes = 0
    for solo in solos.values():
        notes += len(solo.pitches)
        if len(set(solo.eventids)) != len(solo.eventids):
            issues.append(f"Solo {solo.melid}: duplicate note IDs")
        if any(b < a for a, b in zip(solo.onsets, solo.onsets[1:])):
            issues.append(f"Solo {solo.melid}: note onsets out of order")
        if any(d <= 0 for d in solo.durations):
            issues.append(f"Solo {solo.melid}: nonpositive note duration")
        if any(p < 0 or p > 127 for p in solo.pitches):
            issues.append(f"Solo {solo.melid}: unusual MIDI pitch")
    return {"solos": len(solos), "notes": notes, "collections": {
                name: sum(s.source == name for s in solos.values()) for name in {s.source for s in solos.values()}},
            "performers": len({s.performer for s in solos.values()}),
            "tracks": len({s.trackid for s in solos.values()}), "issues": issues,
            "source_sha256": checksum or source_checksum()}
