"""Download the public DTL1000 note tracks shown on solo-detail pages.

The project publishes metadata as CSV and the corresponding pitches, onsets,
and durations as HTML data attributes for its MIDI player. No audio is fetched.
"""
from __future__ import annotations

import csv
import io
import json
import re
import sqlite3
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote

from .corpus import ROOT


DTL_SOURCE = ROOT / "data" / "dtl1000.db"
METADATA_CACHE = ROOT / "data" / "dtl_metadata_v0.9.csv"
BASE = "https://dig-that-lick.hfm-weimar.de"
METADATA_URL = BASE + "/static/similarity_search/csv/dtl_metadata_v0.9.csv"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"}


class _MidiParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.attributes: dict[str, str] | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "button":
            values = dict(attrs)
            if values.get("id") == "playMidiButton":
                self.attributes = values


def detail_id(solo_id: str) -> str:
    # Metadata stores six fractional digits; detail pages use five after
    # stripping the leading zero from each start/end fraction.
    return re.sub(r"(?<=\.)0(?=\d+(?:-|$))", "", solo_id)


def detail_url(solo_id: str) -> str:
    return BASE + "/similarity_search/details?melid=" + quote(detail_id(solo_id), safe="_-.")


def _get(url: str) -> bytes:
    import requests
    response = requests.get(url, headers=HEADERS, timeout=30)
    response.raise_for_status()
    return response.content


def _fetch_notes(row: dict) -> tuple[str, list[int], list[float], list[float]]:
    solo_id = row["solo_id"]
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            parser = _MidiParser()
            parser.feed(_get(detail_url(solo_id)).decode("utf-8"))
            data = parser.attributes
            if not data:
                raise ValueError("MIDI note data was absent from detail page")
            pitches = [int(n) for n in data["data-midi-pitches"].split(",") if n]
            onsets = [float(n) for n in data["data-midi-onsets"].split(",") if n]
            durations = [float(n) for n in data["data-midi-durations"].split(",") if n]
            if not pitches or not len(pitches) == len(onsets) == len(durations):
                raise ValueError("MIDI arrays were empty or had unequal lengths")
            if any(p < 0 or p > 127 for p in pitches) or any(d <= 0 for d in durations):
                raise ValueError("MIDI notes contain invalid pitches or durations")
            if any(a > b for a, b in zip(onsets, onsets[1:])):
                raise ValueError("MIDI onsets are out of order")
            return solo_id, pitches, onsets, durations
        except Exception as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (403, 429):
                raise PermissionError(f"DTL1000 site paused access ({status}); stop and resume later") from exc
            last_error = exc
            time.sleep(0.5 * (attempt + 1))
    raise ValueError(f"{solo_id}: {last_error}")


def download_dtl(path: Path = DTL_SOURCE, progress=print, delay_seconds: float = 10.0) -> dict:
    path.parent.mkdir(parents=True, exist_ok=True)
    if METADATA_CACHE.exists():
        metadata = METADATA_CACHE.read_text(encoding="utf-8-sig")
    else:
        metadata = _get(METADATA_URL).decode("utf-8-sig")
        METADATA_CACHE.write_text(metadata, encoding="utf-8")
    rows = list(csv.DictReader(io.StringIO(metadata), delimiter=";"))
    if not rows or len({r["solo_id"] for r in rows}) != len(rows):
        raise ValueError("DTL1000 metadata is empty or contains duplicate solo IDs")
    db = sqlite3.connect(path)
    db.execute("""CREATE TABLE IF NOT EXISTS solo (
        solo_id TEXT PRIMARY KEY, metadata TEXT NOT NULL, pitches TEXT NOT NULL,
        onsets TEXT NOT NULL, durations TEXT NOT NULL, source_url TEXT NOT NULL
    )""")
    db.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    present = {r[0] for r in db.execute("SELECT solo_id FROM solo")}
    pending = [r for r in rows if r["solo_id"] not in present]
    progress(f"DTL1000 metadata lists {len(rows)} solos; {len(pending)} note tracks to fetch")
    failures = []
    completed = 0
    try:
        with db:
            db.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", ("metadata_url", METADATA_URL))
            db.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", ("metadata_count", str(len(rows))))
        for row in pending:
            try:
                solo_id, pitches, onsets, durations = _fetch_notes(row)
                db.execute("INSERT OR REPLACE INTO solo VALUES (?,?,?,?,?,?)", (
                    solo_id, json.dumps(row, ensure_ascii=False), json.dumps(pitches),
                    json.dumps(onsets), json.dumps(durations), detail_url(solo_id)))
                completed += 1
                if completed % 25 == 0:
                    db.commit()
                if completed % 100 == 0:
                    progress(f"Fetched {completed}/{len(pending)} DTL1000 note tracks")
            except PermissionError:
                db.commit()
                progress("DTL1000 site paused access; the completed notes are saved for a later resume")
                break
            except Exception as exc:
                failures.append(str(exc))
            time.sleep(max(0, delay_seconds))
        db.commit()
        count, notes = db.execute("SELECT COUNT(*), SUM(json_array_length(pitches)) FROM solo").fetchone()
    finally:
        db.close()
    return {"metadata_solos": len(rows), "downloaded_solos": count, "notes": notes or 0,
            "failures": failures[:20], "missing": len(rows) - count, "path": str(path)}
