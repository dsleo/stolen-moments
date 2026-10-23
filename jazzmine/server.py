from __future__ import annotations

import csv
import gzip
import io
import json
import re
import sqlite3
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

from . import VERSION
from .corpus import ROOT, STORE, Solo, combined_source_checksum, load_combined_corpus, load_corpus, source_checksum
from .mining import connect_store


STATIC = ROOT / "static"
LABELS = {"exact", "variant", "shared vocabulary", "possible quotation", "uncertain", "rejected"}
MIME = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
        ".png": "image/png", ".webp": "image/webp", ".avif": "image/avif", ".woff2": "font/woff2"}
COMPRESSIBLE = ("text/", "application/json", "image/svg+xml")


class App:
    def __init__(self, store_path: Path = STORE):
        if not store_path.exists():
            raise FileNotFoundError("Search index is missing. Run `python3 -m jazzmine build` first.")
        self.db = connect_store(store_path)
        self.rows = [dict(row) for row in self.db.execute("SELECT * FROM candidate")]
        self.by_id = {r["id"]: r for r in self.rows}
        self.db_lock = threading.RLock()
        self.discovery_lock = threading.Lock()
        self.cover_cache: dict[tuple[str, str, str], str | None] = {}
        self.cover_image_cache: dict[tuple[str, str, str], tuple[bytes, str] | None] = {}
        self.meta = {r["key"]: r["value"] for r in self.db.execute("SELECT key,value FROM meta")}
        self.solos = (load_combined_corpus() if self.meta.get("source_sha256") == combined_source_checksum()
                      else load_corpus())
        if self.meta.get("source_sha256") not in {source_checksum(), combined_source_checksum()}:
            raise ValueError("The source database changed after indexing. Run `python3 -m jazzmine build`.")

    def solo_summary(self, solo: Solo) -> dict:
        return {"melid": solo.melid, "trackid": solo.trackid, "performer": solo.performer,
                "title": solo.title, "album": solo.album, "album_artist": solo.album_artist,
                "instrument": solo.instrument, "recording_date": solo.recording_date,
                "year": solo.year, "musicbrainz_id": solo.musicbrainz_id,
                "source": solo.source, "source_id": solo.source_id, "source_url": solo.source_url}

    def album_cover(self, performer: str, album: str, title: str = "") -> str | None:
        """Resolve a cover server-side so the local-file UI never depends on browser CORS."""
        key = (performer.strip().lower(), album.strip().lower(), title.strip().lower())
        if key in self.cover_cache:
            return self.cover_cache[key]
        if not performer.strip() or not album.strip():
            self.cover_cache[key] = None
            return None
        try:
            query = urlencode({"term": f"{performer} {album}", "entity": "album", "limit": "20"})
            request = Request(f"https://itunes.apple.com/search?{query}", headers={"User-Agent": "MotifAtlas/0.1"})
            with urlopen(request, timeout=8) as response:
                results = json.load(response).get("results", [])
            compact = lambda value: re.sub(r"[^a-z0-9]+", "", str(value or "").lower())
            wanted_album, surname = compact(album), compact(performer.split()[-1])
            cover = next((item for item in results
                          if surname in compact(item.get("artistName")) and wanted_album in compact(item.get("collectionName"))), None)
            cover = cover or next((item for item in results if surname in compact(item.get("artistName"))), None)
            if not cover and title:
                recording_query = urlencode({"term": f"{performer} {title}", "entity": "song", "limit": "20"})
                request = Request(f"https://itunes.apple.com/search?{recording_query}", headers={"User-Agent": "MotifAtlas/0.1"})
                with urlopen(request, timeout=8) as response:
                    recordings = json.load(response).get("results", [])
                compact_title = compact(title)
                cover = next((item for item in recordings
                              if surname in compact(item.get("artistName")) and compact_title in compact(item.get("trackName"))), None)
            image = cover.get("artworkUrl100") if cover else None
            if image:
                image = re.sub(r"/100x100(?:bb)?\.", "/600x600bb.", image)
            self.cover_cache[key] = image
            return image
        except Exception:
            self.cover_cache[key] = None
            return None

    def album_cover_image(self, performer: str, album: str, title: str = "") -> tuple[bytes, str] | None:
        key = (performer.strip().lower(), album.strip().lower(), title.strip().lower())
        if key in self.cover_image_cache:
            return self.cover_image_cache[key]
        url = self.album_cover(performer, album, title)
        if not url:
            self.cover_image_cache[key] = None
            return None
        try:
            request = Request(url, headers={"User-Agent": "MotifAtlas/0.1"})
            with urlopen(request, timeout=12) as response:
                content = response.read()
                mime = response.headers.get_content_type() or "image/jpeg"
            if not content or not mime.startswith("image/"):
                raise ValueError("Cover source did not return an image")
            result = (content, mime)
            self.cover_image_cache[key] = result
            return result
        except Exception:
            self.cover_image_cache[key] = None
            return None

    def parameters(self, query: dict[str, list[str]]) -> dict:
        def num(name, default, low, high, integral=False):
            try:
                v = float(query.get(name, [default])[0])
            except (ValueError, TypeError):
                v = default
            v = max(low, min(high, v))
            return int(v) if integral else v
        return {
            "min_notes": num("min_notes", 9, 8, 30, True),
            "max_edits": num("max_edits", 1, 0, 2, True),
            "min_pitch": num("min_pitch", 0.8, 0, 1),
            "min_rhythm": num("min_rhythm", 0.45, 0, 1),
            "min_distinct": num("min_distinct", 0.4, 0, 1),
            "min_score": num("min_score", 0, 0, 100),
            "scope": query.get("scope", ["all"])[0],
            "composition": query.get("composition", ["distinct"])[0],
            "performer": query.get("performer", [""])[0].strip(),
            "sort": query.get("sort", ["score"])[0],
            "collection": query.get("collection", ["all"])[0],
            "limit": num("limit", 50, 1, 200, True),
            "offset": num("offset", 0, 0, 1000000, True),
        }

    def filtered(self, p: dict) -> list[dict]:
        out = []
        for r in self.rows:
            source_a = self.solos[r["a_melid"]].source
            source_b = self.solos[r["b_melid"]].source
            if p["collection"] == "wjazzd" and (source_a != "WJazzD" or source_b != "WJazzD"):
                continue
            if p["collection"] == "dtl" and (source_a != "DTL1000" or source_b != "DTL1000"):
                continue
            if p["collection"] == "cross" and source_a == source_b:
                continue
            if r["notes"] < p["min_notes"] or r["edits"] > p["max_edits"]:
                continue
            if r["pitch_similarity"] < p["min_pitch"] or r["rhythm_similarity"] < p["min_rhythm"]:
                continue
            if r["distinctiveness"] < p["min_distinct"] or r["heuristic_score"] < p["min_score"]:
                continue
            if p["scope"] == "same" and not r["same_performer"]:
                continue
            if p["scope"] == "cross" and r["same_performer"]:
                continue
            if p["composition"] == "distinct" and r["same_composition"]:
                continue
            if p["composition"] == "same" and not r["same_composition"]:
                continue
            if p["composition"] != "all" and r["same_track"]:
                continue
            if p["performer"]:
                name = p["performer"].casefold()
                if name not in (self.solos[r["a_melid"]].performer.casefold(),
                                self.solos[r["b_melid"]].performer.casefold()):
                    continue
            out.append(r)
        sorts = {"score": ("heuristic_score", "notes"), "length": ("notes", "heuristic_score"),
                 "rhythm": ("rhythm_similarity", "heuristic_score"),
                 "rare": ("distinctiveness", "heuristic_score")}
        first, second = sorts.get(p["sort"], sorts["score"])
        out.sort(key=lambda r: (r[first], r[second], -r["id"]), reverse=True)
        return out

    def _media(self, trackid: int, track_time: float) -> dict | None:
        with self.db_lock:
            row = self.db.execute("SELECT * FROM media_link WHERE trackid=?", (trackid,)).fetchone()
        if not row or not row["performance_verified"]:
            return None
        t = max(0, int(row["speed_ratio"] * track_time + row["offset_seconds"] - 3))
        return {"url": f"https://www.youtube.com/watch?v={row['video_id']}&t={t}s",
                "video_id": row["video_id"], "time_seconds": t,
                "verified_by": row["verifier"], "evidence": row["evidence"]}

    def _recording(self, trackid: int, track_time: float, solo: Solo | None = None) -> dict | None:
        with self.db_lock:
            row = self.db.execute("SELECT * FROM media_link WHERE trackid=?", (trackid,)).fetchone()
            aligned = (self.db.execute("SELECT * FROM jazztube_video WHERE melid=? ORDER BY rank LIMIT 1", (solo.melid,)).fetchone()
                       if solo is not None and solo.source == "WJazzD" else None)
            auto = self.db.execute("SELECT * FROM video_match WHERE trackid=?", (trackid,)).fetchone()
        if row and row["performance_verified"]:
            video_time = max(0, int(row["speed_ratio"] * track_time + row["offset_seconds"] - 3))
            url = f"https://www.youtube.com/watch?v={row['video_id']}"
            url += f"&t={video_time}s"
            return {"url": url, "verified": True, "time_seconds": video_time,
                    "estimated": False}
        if aligned and solo is not None:
            source_duration = max(o + d for o, d in zip(solo.onsets, solo.durations))
            video_duration = aligned["solo_end_sec"] - aligned["solo_start_sec"]
            ratio = video_duration / source_duration if source_duration > 0 else 1.0
            # Use both published video anchors unless the source note extent is anomalous.
            if not .8 <= ratio <= 1.2:
                ratio = 1.0
            passage_offset = max(0, track_time - solo.solo_start)
            video_time = max(0, int(aligned["solo_start_sec"] + passage_offset * ratio - 3))
            return {"url": f"https://www.youtube.com/watch?v={aligned['video_id']}&t={video_time}s",
                    "verified": False, "aligned": True, "estimated": False,
                    "time_seconds": video_time, "source_url":
                    f"http://mir.audiolabs.uni-erlangen.de/jazztube/solos/solo/{solo.melid}"}
        if row:
            return {"url": f"https://www.youtube.com/watch?v={row['video_id']}",
                    "verified": False, "time_seconds": None, "estimated": False}
        if auto and track_time < auto["video_duration"]:
            video_time = max(0, int(track_time - 3))
            return {"url": f"https://www.youtube.com/watch?v={auto['video_id']}&t={video_time}s",
                    "verified": False, "estimated": True, "time_seconds": video_time,
                    "title": auto["title"], "channel": auto["channel"]}
        return None

    def compact(self, r: dict) -> dict:
        a, b = self.solos[r["a_melid"]], self.solos[r["b_melid"]]
        return {k: r[k] for k in (
            "id", "notes", "exact_intervals", "edits", "pitch_similarity", "rhythm_similarity",
            "distinctiveness", "periodicity", "heuristic_score", "document_frequency", "transposition",
            "same_performer", "same_composition", "same_track", "a_track_time", "b_track_time"
        )} | {"a": self.solo_summary(a), "b": self.solo_summary(b),
             "media_a": self._media(a.trackid, r["a_track_time"]),
             "media_b": self._media(b.trackid, r["b_track_time"]),
             "recording_a": self._recording(a.trackid, r["a_track_time"], a),
             "recording_b": self._recording(b.trackid, r["b_track_time"], b)}

    def list_matches(self, query: dict[str, list[str]]) -> dict:
        p = self.parameters(query)
        rows = self.filtered(p)
        total = len(rows)
        buckets = [0] * 10
        for r in rows:
            buckets[min(9, int(r["heuristic_score"] // 10))] += 1
        page = rows[p["offset"]:p["offset"] + p["limit"]]
        return {"total": total, "unfiltered_total": len(self.rows), "parameters": p,
                "histogram": buckets, "items": [self.compact(r) for r in page],
                "next_offset": p["offset"] + len(page) if p["offset"] + len(page) < total else None}

    def detail(self, match_id: int) -> dict | None:
        r = self.by_id.get(match_id)
        if not r:
            return None
        a, b = self.solos[r["a_melid"]], self.solos[r["b_melid"]]
        def excerpt(s: Solo, start: int, end: int):
            return [{"index": z, "eventid": s.eventids[z], "pitch": s.pitches[z],
                     "onset": round(s.onsets[z], 3), "track_time": round(s.solo_start+s.onsets[z], 3),
                     "duration": round(s.durations[z], 3), "beat": round(s.beat_positions[z], 3),
                     "phrase": s.phrase_ids[z], "chord": s.chords[z]}
                    for z in range(start, min(end + 1, len(s.pitches)))]
        with self.db_lock:
            reviews = [dict(row) for row in self.db.execute(
                "SELECT reviewer,label,confidence,note,updated_at FROM review WHERE candidate_id=? ORDER BY updated_at DESC", (match_id,))]
        return self.compact(r) | {"a_notes": excerpt(a, r["a_start"], r["a_end"]),
                                  "b_notes": excerpt(b, r["b_start"], r["b_end"]),
                                  "media_record_a": self.get_media(a.trackid),
                                  "media_record_b": self.get_media(b.trackid),
                                  "alignment": json.loads(r["alignment"]), "reviews": reviews}

    def save_review(self, data: dict) -> dict:
        mid = int(data.get("candidate_id", 0))
        reviewer = str(data.get("reviewer", "")).strip()[:80]
        label = str(data.get("label", "")).strip()
        note = str(data.get("note", "")).strip()[:2000]
        confidence = int(data.get("confidence", 3))
        if mid not in self.by_id or not reviewer or label not in LABELS or not 1 <= confidence <= 5:
            raise ValueError("Provide a valid match, reviewer, label, and confidence from 1 to 5.")
        with self.db_lock, self.db:
            self.db.execute("""INSERT INTO review(candidate_id,reviewer,label,confidence,note)
                VALUES(?,?,?,?,?) ON CONFLICT(candidate_id,reviewer) DO UPDATE SET
                label=excluded.label,confidence=excluded.confidence,note=excluded.note,updated_at=CURRENT_TIMESTAMP""",
                (mid, reviewer, label, confidence, note))
        return {"saved": True, "candidate_id": mid}

    def save_media(self, data: dict) -> dict:
        trackid = int(data.get("trackid", 0))
        video_id = str(data.get("video_id", "")).strip()
        if "://" in video_id:
            parsed = urlparse(video_id)
            host = (parsed.hostname or "").casefold()
            if host in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
                video_id = parse_qs(parsed.query).get("v", [""])[0] if parsed.path == "/watch" else (
                    parsed.path.split("/")[2] if parsed.path.startswith(("/shorts/", "/embed/")) and len(parsed.path.split("/")) > 2 else "")
            elif host in {"youtu.be", "www.youtu.be"}:
                video_id = parsed.path.strip("/").split("/")[0]
            else:
                video_id = ""
        verifier = str(data.get("verifier", "")).strip()[:80]
        evidence = str(data.get("evidence", "")).strip()[:1000]
        verified = bool(data.get("performance_verified", False))
        def anchor(name):
            v = data.get(name)
            return None if v is None or v == "" else float(v)
        t1, v1 = anchor("anchor_track_seconds"), anchor("anchor_video_seconds")
        t2, v2 = anchor("second_anchor_track_seconds"), anchor("second_anchor_video_seconds")
        if (t1 is None) != (v1 is None) or (t2 is None) != (v2 is None):
            raise ValueError("Each timing anchor needs both source-track and video seconds.")
        if verified and (t1 is None or v1 is None):
            raise ValueError("A verified link needs at least one checked timing anchor.")
        if t2 is not None and t1 is None:
            raise ValueError("Enter the first anchor before the second.")
        if t2 is not None and abs(t2 - t1) < 5:
            raise ValueError("Place the two anchors at least five seconds apart.")
        if any(x is not None and x < 0 for x in (t1, v1, t2, v2)):
            raise ValueError("Anchor times must be nonnegative.")
        speed = (v2 - v1) / (t2 - t1) if t2 is not None else 1.0
        offset = v1 - speed * t1 if t1 is not None else 0.0
        if trackid not in {s.trackid for s in self.solos.values()} or not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            raise ValueError("Enter a valid WJazzD track and 11-character YouTube video ID.")
        if not verifier or (verified and not evidence) or not -3600 <= offset <= 3600 or not .8 <= speed <= 1.2:
            raise ValueError("Enter a verifier, evidence for verified links, and a valid time mapping.")
        with self.db_lock, self.db:
            self.db.execute("""INSERT INTO media_link(trackid,video_id,performance_verified,offset_seconds,speed_ratio,
                anchor_track_seconds,anchor_video_seconds,second_anchor_track_seconds,second_anchor_video_seconds,verifier,evidence)
                VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(trackid) DO UPDATE SET video_id=excluded.video_id,
                performance_verified=excluded.performance_verified,offset_seconds=excluded.offset_seconds,
                speed_ratio=excluded.speed_ratio,anchor_track_seconds=excluded.anchor_track_seconds,
                anchor_video_seconds=excluded.anchor_video_seconds,
                second_anchor_track_seconds=excluded.second_anchor_track_seconds,
                second_anchor_video_seconds=excluded.second_anchor_video_seconds,
                verifier=excluded.verifier,evidence=excluded.evidence,
                updated_at=CURRENT_TIMESTAMP""", (trackid, video_id, int(verified), offset, speed,
                t1, v1, t2, v2, verifier, evidence))
        return {"saved": True, "trackid": trackid, "verified": verified}

    def get_media(self, trackid: int) -> dict | None:
        with self.db_lock:
            row = self.db.execute("SELECT * FROM media_link WHERE trackid=?", (trackid,)).fetchone()
        return dict(row) if row else None

    def discover_video(self, trackid: int) -> dict:
        solo = next((s for s in self.solos.values() if s.trackid == trackid and s.source == "WJazzD"), None)
        if solo is None:
            raise ValueError("Unknown source track")
        with self.discovery_lock:
            with self.db_lock:
                existing = self.db.execute("SELECT * FROM video_match WHERE trackid=?", (trackid,)).fetchone()
            if existing:
                return {"found": True, "trackid": trackid}
            from .videos import discover
            result = discover(solo)
            if not result:
                return {"found": False, "trackid": trackid}
            with self.db_lock, self.db:
                self.db.execute("""INSERT OR REPLACE INTO video_match
                    (trackid,video_id,title,channel,video_duration,reference_duration,album)
                    VALUES(:trackid,:video_id,:title,:channel,:video_duration,:reference_duration,:album)""", result)
            return {"found": True, "trackid": trackid}


def serve(host: str = "127.0.0.1", port: int = 8766):
    app = App()
    class Handler(BaseHTTPRequestHandler):
        def _reply(self, content: bytes, status=200, mime="application/json; charset=utf-8", cache="no-store", etag=None):
            if etag and self.headers.get("If-None-Match") == etag:
                content, status = b"", 304
            self.send_response(status)
            self.send_header("Content-Type", mime)
            if len(content) > 1024 and mime.startswith(COMPRESSIBLE) and "gzip" in self.headers.get("Accept-Encoding", ""):
                content = gzip.compress(content, 5)
                self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", cache)
            if etag:
                self.send_header("ETag", etag)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            self.wfile.write(content)

        def _json(self, obj, status=200):
            self._reply(json.dumps(obj, ensure_ascii=False).encode(), status)

        def _body(self):
            length = int(self.headers.get("Content-Length", "0"))
            if length > 200_000:
                raise ValueError("Request too large")
            return json.loads(self.rfile.read(length) or b"{}")

        def do_GET(self):
            url = urlparse(self.path)
            q = parse_qs(url.query)
            try:
                if url.path == "/api/bootstrap":
                    self._json({"version": VERSION, "corpus": json.loads(app.meta["corpus_report"]),
                                "candidates": len(app.rows), "performers": sorted({s.performer for s in app.solos.values()}),
                                "pipeline": app.meta.get("pipeline")})
                elif url.path == "/api/cover-image":
                    performer = q.get("performer", [""])[0]
                    album = q.get("album", [""])[0]
                    title = q.get("title", [""])[0]
                    image = app.album_cover_image(performer, album, title)
                    if image:
                        self._reply(image[0], mime=image[1])
                    else:
                        self._json({"error": "Album cover not found"}, 404)
                elif url.path == "/api/cover":
                    performer = q.get("performer", [""])[0]
                    album = q.get("album", [""])[0]
                    title = q.get("title", [""])[0]
                    self._json({"url": app.album_cover(performer, album, title)})
                elif url.path == "/api/matches":
                    self._json(app.list_matches(q))
                elif re.fullmatch(r"/api/matches/\d+", url.path):
                    data = app.detail(int(url.path.rsplit("/", 1)[1]))
                    self._json(data if data else {"error": "Match not found"}, 200 if data else 404)
                elif re.fullmatch(r"/api/media/\d+", url.path):
                    self._json({"media": app.get_media(int(url.path.rsplit("/", 1)[1]))})
                elif url.path == "/api/export.csv":
                    p = app.parameters(q)
                    rows = app.filtered(p)
                    out = io.StringIO()
                    writer = csv.writer(out)
                    writer.writerow(["match_id", "score", "notes", "edits", "pitch_similarity", "rhythm_similarity",
                                     "distinctiveness", "performer_a", "title_a", "track_time_a", "performer_b",
                                     "title_b", "track_time_b", "transposition", "same_composition"])
                    for r in rows:
                        a,b = app.solos[r["a_melid"]],app.solos[r["b_melid"]]
                        writer.writerow([r["id"],r["heuristic_score"],r["notes"],r["edits"],r["pitch_similarity"],
                                         r["rhythm_similarity"],r["distinctiveness"],a.performer,a.title,r["a_track_time"],
                                         b.performer,b.title,r["b_track_time"],r["transposition"],r["same_composition"]])
                    self._reply(out.getvalue().encode(), mime="text/csv; charset=utf-8")
                else:
                    rel = "index.html" if url.path == "/" else url.path.lstrip("/")
                    path = (STATIC / rel).resolve()
                    if not path.is_relative_to(STATIC.resolve()) or not path.is_file():
                        self._json({"error": "Not found"}, 404)
                    else:
                        stat = path.stat()
                        # Revalidate code every load (304 when unchanged); big media can sit in cache for a day.
                        cache = "public, max-age=86400" if rel.startswith(("assets/", "vendor/")) else "no-cache"
                        self._reply(path.read_bytes(), mime=MIME.get(path.suffix, "application/octet-stream"),
                                    cache=cache, etag=f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"')
            except Exception as exc:
                self._json({"error": str(exc)}, 400)

        def do_OPTIONS(self):
            self._reply(b"", status=204)

        def do_POST(self):
            try:
                if self.path == "/api/reviews":
                    self._json(app.save_review(self._body()))
                elif self.path == "/api/media":
                    self._json(app.save_media(self._body()))
                elif self.path == "/api/discover-video":
                    self._json(app.discover_video(int(self._body().get("trackid", 0))))
                else:
                    self._json({"error": "Not found"}, 404)
            except (ValueError, TypeError, sqlite3.Error) as exc:
                self._json({"error": str(exc)}, 400)

    print(f"Jazz Motif Atlas: http://{host}:{port}", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
