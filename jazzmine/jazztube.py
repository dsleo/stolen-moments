"""Import JazzTube's published WJazzD-to-YouTube solo alignments."""

from __future__ import annotations

import csv
import io
import math
import re
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlencode

from .corpus import ROOT
from .mining import connect_store


SOURCE_URL = "http://mir.audiolabs.uni-erlangen.de/jazztube/static/csv_youtube.csv"
SOURCE = ROOT / "data" / "jazztube_youtube.csv"
VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}\Z")


def parse_alignments(content: bytes, valid_melids: set[int]) -> list[tuple]:
    reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig")))
    required = {"melid", "youtube_id", "solo_start_sec", "solo_end_sec"}
    if not required.issubset(reader.fieldnames or []):
        raise ValueError("JazzTube video CSV is missing required columns")
    seen: set[tuple[int, str]] = set()
    ranks: dict[int, int] = {}
    rows = []
    for row in reader:
        try:
            melid = int(row["melid"])
            video_id = row["youtube_id"].strip()
            start = float(row["solo_start_sec"])
            end = float(row["solo_end_sec"])
            median = float(row["mf_median"]) if row.get("mf_median") else None
            minimum = float(row["mf_min"]) if row.get("mf_min") else None
        except (ValueError, TypeError, KeyError):
            continue
        if (melid not in valid_melids or not VIDEO_ID.fullmatch(video_id)
                or not all(math.isfinite(x) for x in (start, end))
                or start < 0 or end <= start or (melid, video_id) in seen):
            continue
        seen.add((melid, video_id))
        rank = ranks.get(melid, 0)
        rows.append((melid, rank, video_id, start, end, median, minimum))
        ranks[melid] = rank + 1
    if len(ranks) < 300:
        raise ValueError("JazzTube video CSV contains too few valid solo links")
    return rows


def _video_available(video_id: str) -> bool:
    url = "https://www.youtube.com/oembed?" + urlencode({
        "url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=12) as response:
            return response.status == 200
    except Exception:
        return False


def choose_available(rows: list[tuple]) -> list[tuple]:
    by_solo: dict[int, list[tuple]] = defaultdict(list)
    for row in rows:
        by_solo[row[0]].append(row)

    def first_available(options: list[tuple]) -> tuple | None:
        for row in options:
            if _video_available(row[2]):
                return row
        return None

    with ThreadPoolExecutor(max_workers=8) as pool:
        chosen = list(pool.map(first_available, by_solo.values()))
    return [row for row in chosen if row is not None]


def sync(store_path: Path, valid_melids: set[int], csv_path: Path | None = None,
         check_availability: bool = True) -> dict:
    if csv_path is None:
        with urllib.request.urlopen(SOURCE_URL, timeout=30) as response:
            content = response.read()
    else:
        content = csv_path.read_bytes()
    rows = parse_alignments(content, valid_melids)
    selected = choose_available(rows) if check_availability else [row for row in rows if row[1] == 0]
    if check_availability and not selected:
        raise ValueError("Could not verify any JazzTube videos on YouTube; existing links were preserved")
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    SOURCE.write_bytes(content)
    db = connect_store(store_path)
    with db:
        db.execute("DELETE FROM jazztube_video")
        db.executemany("""INSERT INTO jazztube_video
            (melid,rank,video_id,solo_start_sec,solo_end_sec,mf_median,mf_min)
            VALUES (?,?,?,?,?,?,?)""", selected)
    db.close()
    return {"source_solos": len({r[0] for r in rows}), "source_videos": len(rows),
            "available_solos": len(selected), "source": SOURCE_URL}
