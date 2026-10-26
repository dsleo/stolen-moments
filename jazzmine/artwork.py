"""Resolve recording-specific album covers, with auditable MusicBrainz provenance."""
from __future__ import annotations

import gzip
import hashlib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from difflib import SequenceMatcher
from pathlib import Path

from .corpus import ROOT


CATALOG = ROOT / "static" / "catalog" / "index.json.gz"
MAP = ROOT / "data" / "album-art-map.json"
CACHE = ROOT / "data" / "covers"
HEADERS = {"User-Agent": "StolenMoments/0.2 (https://github.com/openai)",
           "Accept": "application/json"}
_last_mb_request = 0.0


def normalized(value: str) -> str:
    value = value.casefold().replace("compelete", "complete")
    value = re.sub(r"\b(?:cd|disc|disk|volume|vol)\s*\d+\b", "", value)
    value = re.sub(r"\b(?:remastered|remaster|expanded|edition|the)\b", "", value)
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def title_score(wanted: str, found: str) -> float:
    a, b = normalized(wanted), normalized(found)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    tokens_a, tokens_b = set(a.split()), set(b.split())
    overlap = len(tokens_a & tokens_b) / max(1, len(tokens_a | tokens_b))
    return max(SequenceMatcher(None, a, b).ratio(), overlap)


def _json(url: str) -> dict:
    global _last_mb_request
    if urllib.parse.urlparse(url).hostname == "musicbrainz.org":
        wait = 1.1 - (time.monotonic() - _last_mb_request)
        if wait > 0:
            time.sleep(wait)
        _last_mb_request = time.monotonic()
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=15) as r:
                return json.load(r)
        except urllib.error.HTTPError as exc:
            if exc.code in (404, 400):
                return {}
            if exc.code not in (429, 503) or attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
    return {}


def releases_for(solo: dict) -> list[dict]:
    mbid = solo.get("musicbrainz_id")
    if mbid and re.fullmatch(r"[0-9a-f-]{36}", mbid):
        url = f"https://musicbrainz.org/ws/2/recording/{mbid}?inc=releases&fmt=json"
        releases = _json(url).get("releases", [])
        close = [r for r in releases if title_score(solo["album"], r["title"]) >= .76]
        if close:
            return sorted(close, key=lambda r: title_score(solo["album"], r["title"]), reverse=True)
    query = f'release:"{solo["album"]}"'
    if solo.get("album_artist"):
        query += f' AND artist:"{solo["album_artist"].split("/")[0].strip()}"'
    url = "https://musicbrainz.org/ws/2/release/?" + urllib.parse.urlencode({
        "query": query, "fmt": "json", "limit": 10})
    releases = _json(url).get("releases", [])
    return sorted((r for r in releases if title_score(solo["album"], r["title"]) >= .82),
                  key=lambda r: title_score(solo["album"], r["title"]), reverse=True)


def _cover(release_id: str) -> str | None:
    url = f"https://coverartarchive.org/release/{release_id}/front-250"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={
                "User-Agent": HEADERS["User-Agent"]}), timeout=18) as response:
            mime = response.headers.get_content_type()
            data = response.read(2_000_001)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
        return None
    if not data or len(data) > 2_000_000 or mime not in ("image/jpeg", "image/png", "image/webp"):
        return None
    extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[mime]
    path = CACHE / f"album-{release_id}{extension}"
    path.write_bytes(data)
    return str(path.relative_to(ROOT))


def itunes_cover(solo: dict) -> dict | None:
    """Accept only a close album-title and album-artist match."""
    album, artist = solo["album"], solo["album_artist"] or solo["performer"]
    cleaned = normalized(album)
    queries = [f"{artist} {album}", f"{artist} {cleaned}"]
    candidates = {}
    for query in queries:
        url = "https://itunes.apple.com/search?" + urllib.parse.urlencode({
            "term": query, "entity": "album", "limit": 25})
        try:
            for row in _json(url).get("results", []):
                if row.get("artworkUrl100") and row.get("collectionId"):
                    candidates[row["collectionId"]] = row
        except (urllib.error.URLError, TimeoutError, ValueError):
            continue
        if candidates:
            break
    scored = sorted(((title_score(album, row.get("collectionName", "")),
                      title_score(artist, row.get("artistName", "")), row)
                     for row in candidates.values()), reverse=True, key=lambda item: (item[0], item[1]))
    for album_score, artist_score, row in scored:
        if album_score < .73 or artist_score < .55:
            continue
        wanted_tokens = set(normalized(album).split())
        found_tokens = set(normalized(row["collectionName"]).split())
        artist_tokens = set(normalized(artist).split())
        if wanted_tokens - found_tokens - artist_tokens:
            continue
        url = re.sub(r"/100x100(?:bb)?\.", "/600x600bb.", row["artworkUrl100"])
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={
                    "User-Agent": HEADERS["User-Agent"]}), timeout=15) as response:
                mime, data = response.headers.get_content_type(), response.read(2_000_001)
        except (urllib.error.URLError, TimeoutError):
            continue
        if not data or len(data) > 2_000_000 or mime not in ("image/jpeg", "image/png", "image/webp"):
            continue
        extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[mime]
        key = hashlib.sha1(str(row["collectionId"]).encode()).hexdigest()[:12]
        path = CACHE / f"album-itunes-{key}{extension}"
        path.write_bytes(data)
        return {"path": str(path.relative_to(ROOT)), "source": "itunes",
                "collection_id": row["collectionId"], "release_title": row["collectionName"],
                "artist": row["artistName"], "match_score": round(album_score, 3)}
    return None


def resolve(catalog: Path = CATALOG, output: Path = MAP) -> dict:
    solos = list(json.loads(gzip.decompress(catalog.read_bytes()))["solos"].values())
    groups = {}
    for solo in solos:
        if not solo.get("cover") and solo.get("album"):
            key = f"{solo['album_artist']}\0{solo['album']}"
            groups.setdefault(key, []).append(solo)
    results = json.loads(output.read_text()) if output.exists() else {}
    for index, (key, members) in enumerate(groups.items(), 1):
        if key in results and results[key].get("path") and (ROOT / results[key]["path"]).is_file():
            continue
        # Use the first recording with an MBID so a release is tied to this music.
        sample = next((s for s in members if s.get("musicbrainz_id")), members[0])
        chosen = itunes_cover(sample)
        try:
            if not chosen:
                for release in releases_for(sample)[:8]:
                    image = _cover(release["id"])
                    if image:
                        chosen = {"path": image, "release_id": release["id"],
                                  "release_title": release["title"], "source": "cover-art-archive",
                                  "match_score": round(title_score(sample["album"], release["title"]), 3)}
                        break
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            print(f"Artwork lookup failed for {sample['album']}: {exc}", flush=True)
        results[key] = chosen or {"path": None, "source": "not-found"}
        output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
        if index % 10 == 0:
            found = sum(bool(r.get("path")) for r in results.values())
            print(f"Album art: {index}/{len(groups)} groups, {found} found", flush=True)
    return {"groups": len(groups), "found": sum(bool(results.get(k, {}).get("path")) for k in groups),
            "missing": sum(not results.get(k, {}).get("path") for k in groups), "output": str(output)}


if __name__ == "__main__":
    print(json.dumps(resolve(), indent=2))
