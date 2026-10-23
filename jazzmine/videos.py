"""Find likely copies of source recordings using public video metadata.

Only exact title, artist, album, and near-identical duration matches are saved.
This cannot prove sample-accurate alignment; links remain marked as estimated.
"""
from __future__ import annotations

import json
import re
import subprocess
import time
from difflib import SequenceMatcher
from urllib.request import Request, urlopen

from .corpus import Solo


USER_AGENT = "MotifAtlas/0.1 (local jazz research; contact: https://github.com/metabrainz/musicbrainz-server)"


def norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").casefold()).strip()


def similar(a: str, b: str) -> float:
    return SequenceMatcher(None, norm(a), norm(b)).ratio()


def reference_duration(solo: Solo) -> float | None:
    if not solo.musicbrainz_id or not re.fullmatch(r"[a-f0-9-]{36}", solo.musicbrainz_id):
        return None
    url = f"https://musicbrainz.org/ws/2/recording/{solo.musicbrainz_id}?fmt=json"
    request = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=12) as response:
            length = json.load(response).get("length")
        return float(length) / 1000 if length else None
    except Exception:
        return None


def youtube_info(target: str, timeout: int = 25) -> list[dict]:
    try:
        process = subprocess.run(
            ["yt-dlp", "--no-warnings", "--flat-playlist", "--dump-json", target],
            capture_output=True, text=True, timeout=timeout, check=False)
        return [json.loads(line) for line in process.stdout.splitlines() if line.startswith("{")]
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return []


def full_video(video_id: str) -> dict | None:
    try:
        process = subprocess.run(
            ["yt-dlp", "--no-warnings", "--dump-json", f"https://www.youtube.com/watch?v={video_id}"],
            capture_output=True, text=True, timeout=25, check=False)
        return json.loads(process.stdout) if process.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return None


def discover(solo: Solo) -> dict | None:
    reference = reference_duration(solo)
    if reference is None:
        return None
    artist = solo.album_artist or solo.performer
    searches = [f"ytsearch6:{artist} {solo.title} {solo.album.split('/')[0]}",
                f"ytsearch6:{artist} {solo.title}"]
    seen = set()
    for target in searches:
        for item in youtube_info(target):
            video_id = item.get("id")
            if not isinstance(video_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id) or video_id in seen:
                continue
            seen.add(video_id)
            duration = item.get("duration")
            if duration is None or abs(float(duration) - reference) > 3.5:
                continue
            if similar(item.get("title", ""), solo.title) < .7:
                continue
            channel = item.get("channel") or ""
            details = full_video(video_id)
            if not details:
                continue
            if abs(float(details.get("duration") or 0) - reference) > 3.5:
                continue
            if "- Topic" not in channel and not (details.get("description") or "").startswith("Provided to YouTube by"):
                continue
            if similar(details.get("track") or details.get("title") or "", solo.title) < .85:
                continue
            video_artist = details.get("artist") or channel.removesuffix(" - Topic")
            artist_tokens = set(norm(artist).split())
            if not artist_tokens.issubset(set(norm(video_artist).split())):
                continue
            video_album = details.get("album") or ""
            if not solo.album or not video_album or similar(video_album, solo.album) < .74:
                continue
            return {"trackid": solo.trackid, "video_id": video_id,
                    "title": details.get("title") or solo.title, "channel": channel,
                    "video_duration": int(details["duration"]),
                    "reference_duration": reference, "album": video_album}
    return None


def populate(app, limit: int = 50) -> dict:
    ranked = app.filtered(app.parameters({"composition": ["distinct"]}))
    seen = set()
    tracks = []
    for row in ranked:
        for key in ("a_melid", "b_melid"):
            solo = app.solos[row[key]]
            if solo.trackid not in seen:
                seen.add(solo.trackid)
                tracks.append(solo)
        if len(tracks) >= limit:
            break
    found = 0
    checked = 0
    for solo in tracks[:limit]:
        with app.db_lock:
            existing = app.db.execute("SELECT 1 FROM video_match WHERE trackid=?", (solo.trackid,)).fetchone()
            manual = app.db.execute("SELECT 1 FROM media_link WHERE trackid=?", (solo.trackid,)).fetchone()
        if existing or manual:
            continue
        result = discover(solo)
        checked += 1
        if result:
            with app.db_lock, app.db:
                app.db.execute("""INSERT OR REPLACE INTO video_match
                    (trackid,video_id,title,channel,video_duration,reference_duration,album)
                    VALUES(:trackid,:video_id,:title,:channel,:video_duration,:reference_duration,:album)""", result)
            found += 1
            print(f"MATCH {solo.trackid}: {solo.performer} / {solo.title} -> {result['video_id']}", flush=True)
        else:
            print(f"NO MATCH {solo.trackid}: {solo.performer} / {solo.title}", flush=True)
        time.sleep(1.1)  # MusicBrainz permits at most one call per second.
    return {"checked": checked, "found": found}
