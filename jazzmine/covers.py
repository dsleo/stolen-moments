"""Album covers resolved through iTunes search, cached on disk (hits and misses)."""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .corpus import ROOT

CACHE = ROOT / "data" / "covers"
MISS_TTL = 7 * 86400
EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MIME = {v: k for k, v in EXT.items()}
HEADERS = {"User-Agent": "MotifAtlas/0.1"}
_outbound = threading.Semaphore(4)
_locks = [threading.Lock() for _ in range(64)]  # striped so one cover is only fetched once at a time


def _key(performer: str, album: str, title: str) -> str:
    raw = "\0".join(s.strip().lower() for s in (performer, album, title))
    return hashlib.sha1(raw.encode()).hexdigest()[:20]


def _cached(key: str):
    """(bytes, mime) for a hit, False for a fresh miss, None when unknown."""
    for ext, mime in MIME.items():
        path = CACHE / f"{key}{ext}"
        if path.exists():
            return path.read_bytes(), mime
    miss = CACHE / f"{key}.miss"
    if miss.exists() and time.time() - miss.stat().st_mtime < MISS_TTL:
        return False
    return None


def _json(url: str) -> list[dict]:
    with urlopen(Request(url, headers=HEADERS), timeout=8) as response:
        return json.load(response).get("results", [])


def _find_artwork(performer: str, album: str, title: str) -> str | None:
    compact = lambda value: re.sub(r"[^a-z0-9]+", "", str(value or "").lower())
    surname = compact(performer.split()[-1])
    query = urlencode({"term": f"{performer} {album}", "entity": "album", "limit": "20"})
    results = _json(f"https://itunes.apple.com/search?{query}")
    wanted = compact(album)
    cover = next((i for i in results if surname in compact(i.get("artistName")) and wanted in compact(i.get("collectionName"))), None)
    cover = cover or next((i for i in results if surname in compact(i.get("artistName"))), None)
    if not cover and title:
        query = urlencode({"term": f"{performer} {title}", "entity": "song", "limit": "20"})
        wanted = compact(title)
        cover = next((i for i in _json(f"https://itunes.apple.com/search?{query}")
                      if surname in compact(i.get("artistName")) and wanted in compact(i.get("trackName"))), None)
    image = cover.get("artworkUrl100") if cover else None
    return re.sub(r"/100x100(?:bb)?\.", "/600x600bb.", image) if image else None


def get(performer: str, album: str, title: str = "") -> tuple[bytes, str] | None:
    """Cover bytes and mime type, or None when no cover exists. Network only on a cold cache."""
    if not performer.strip() or not album.strip():
        return None
    key = _key(performer, album, title)
    hit = _cached(key)
    if hit is not None:
        return hit or None
    with _locks[int(key, 16) % len(_locks)]:
        hit = _cached(key)
        if hit is not None:
            return hit or None
        CACHE.mkdir(parents=True, exist_ok=True)
        try:
            with _outbound:
                url = _find_artwork(performer, album, title)
                if not url:
                    raise LookupError("no artwork")
                with urlopen(Request(url, headers=HEADERS), timeout=12) as response:
                    content, mime = response.read(), response.headers.get_content_type()
            if not content or mime not in EXT:
                raise ValueError("not an image")
        except LookupError:
            (CACHE / f"{key}.miss").touch()  # definitive miss: remember it
            return None
        except Exception:
            return None  # network trouble: don't cache, try again next time
        tmp = CACHE / f"{key}.tmp"
        tmp.write_bytes(content)
        tmp.replace(CACHE / f"{key}{EXT[mime]}")
        (CACHE / f"{key}.miss").unlink(missing_ok=True)
        return content, mime
