from __future__ import annotations

import json
import math
import sqlite3
import hashlib
from collections import defaultdict
from pathlib import Path
from statistics import median

from .corpus import STORE, Solo, combined_source_checksum, load_combined_corpus, validate_corpus


INDEX_INTERVALS = 5
MAX_POSTINGS = 80
MIN_EXACT_NOTES = 8
PIPELINE = "interval-seed-5-4-v3-dtl1000"


def connect_store(path: Path = STORE) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA busy_timeout=5000")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS candidate (
            id INTEGER PRIMARY KEY,
            a_melid INTEGER NOT NULL, b_melid INTEGER NOT NULL,
            a_start INTEGER NOT NULL, a_end INTEGER NOT NULL,
            b_start INTEGER NOT NULL, b_end INTEGER NOT NULL,
            notes INTEGER NOT NULL, exact_intervals INTEGER NOT NULL, edits INTEGER NOT NULL,
            pitch_similarity REAL NOT NULL, rhythm_similarity REAL NOT NULL,
            distinctiveness REAL NOT NULL, periodicity REAL NOT NULL DEFAULT 0, heuristic_score REAL NOT NULL,
            document_frequency INTEGER NOT NULL, transposition INTEGER NOT NULL,
            same_performer INTEGER NOT NULL, same_composition INTEGER NOT NULL, same_track INTEGER NOT NULL,
            a_track_time REAL NOT NULL, b_track_time REAL NOT NULL,
            alignment TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS candidate_rank ON candidate(heuristic_score DESC);
        CREATE INDEX IF NOT EXISTS candidate_scope ON candidate(same_performer,same_composition,same_track);
        CREATE INDEX IF NOT EXISTS candidate_solos ON candidate(a_melid,b_melid);
        CREATE TABLE IF NOT EXISTS review (
            candidate_id INTEGER NOT NULL, reviewer TEXT NOT NULL, label TEXT NOT NULL,
            confidence INTEGER NOT NULL, note TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(candidate_id,reviewer)
        );
        CREATE TABLE IF NOT EXISTS media_link (
            trackid INTEGER PRIMARY KEY, video_id TEXT NOT NULL,
            performance_verified INTEGER NOT NULL DEFAULT 0,
            offset_seconds REAL NOT NULL DEFAULT 0,
            speed_ratio REAL NOT NULL DEFAULT 1,
            anchor_track_seconds REAL, anchor_video_seconds REAL,
            second_anchor_track_seconds REAL, second_anchor_video_seconds REAL,
            verifier TEXT NOT NULL, evidence TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS video_match (
            trackid INTEGER PRIMARY KEY, video_id TEXT NOT NULL,
            title TEXT NOT NULL, channel TEXT NOT NULL,
            video_duration INTEGER NOT NULL, reference_duration REAL NOT NULL,
            album TEXT NOT NULL, checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS jazztube_video (
            melid INTEGER NOT NULL, rank INTEGER NOT NULL,
            video_id TEXT NOT NULL, solo_start_sec REAL NOT NULL,
            solo_end_sec REAL NOT NULL, mf_median REAL, mf_min REAL,
            PRIMARY KEY(melid,rank)
        );
    """)
    columns = {r[1] for r in db.execute("PRAGMA table_info(candidate)")}
    if "periodicity" not in columns:
        db.execute("ALTER TABLE candidate ADD COLUMN periodicity REAL NOT NULL DEFAULT 0")
    return db


def _extension(int_a: list[int], int_b: list[int], ia: int, ib: int, direction: int,
               budget: int = 2, limit: int = 8) -> tuple[list[tuple[int, int, str]], int]:
    """Extend a seed flank with bounded substitutions and single-interval gaps.

    An edit is accepted only if an exact interval follows within one step.
    This intentionally prioritizes interpretable variants around a long exact core.
    """
    out: list[tuple[int, int, str]] = []
    edits = 0
    while len(out) < limit and 0 <= ia < len(int_a) and 0 <= ib < len(int_b):
        if int_a[ia] == int_b[ib]:
            out.append((ia, ib, "match"))
            ia += direction
            ib += direction
            continue
        if edits >= budget:
            break
        choices = []
        na, nb = ia + direction, ib + direction
        if 0 <= na < len(int_a) and 0 <= nb < len(int_b) and int_a[na] == int_b[nb]:
            choices.append(("sub", ia + direction, ib + direction, 1))
        if 0 <= na < len(int_a) and int_a[na] == int_b[ib]:
            choices.append(("gap_b", na, ib, 1))
        if 0 <= nb < len(int_b) and int_a[ia] == int_b[nb]:
            choices.append(("gap_a", ia, nb, 1))
        if not choices:
            break
        # Prefer a substitution over a gap in otherwise equivalent continuations.
        op, next_a, next_b, cost = choices[0]
        if op == "sub":
            out.append((ia, ib, "sub"))
        elif op == "gap_b":
            out.append((ia, -1, "gap_b"))
        else:
            out.append((-1, ib, "gap_a"))
        edits += cost
        ia, ib = next_a, next_b
    return out, edits


def _rhythm_similarity(a: Solo, b: Solo, aligned: list[tuple[int, int, str]]) -> float:
    # DTL1000 exposes note timing but no beat grid. Compare the shapes of
    # onset sequences after local tempo normalization when it is involved.
    if a.source == b.source == "WJazzD":
        xs, ys = a.ioi_beats, b.ioi_beats
    else:
        xs, ys = a.ioi_seconds, b.ioi_seconds
    pairs = [(xs[i], ys[j]) for i, j, op in aligned
             if i >= 0 and j >= 0 and op not in ("gap_a", "gap_b")
             and i < len(xs) and j < len(ys) and xs[i] > .025 and ys[j] > .025]
    if len(pairs) < 3:
        return 0.0
    scale_a = median(x for x, _ in pairs) if a.source != "WJazzD" or b.source != "WJazzD" else 1
    scale_b = median(y for _, y in pairs) if a.source != "WJazzD" or b.source != "WJazzD" else 1
    diffs = []
    for x, y in pairs:
        diffs.append(abs(math.log((x / scale_a) / (y / scale_b))))
    # The median makes a single swung or ornamented note less disruptive.
    return max(0.0, min(1.0, math.exp(-1.6 * median(diffs))))


def _periodicity(intervals: list[int]) -> float:
    if len(intervals) < 8:
        return 0.0
    # Share of the passage explained by a cell of one to four intervals.
    return max((sum(intervals[i] == intervals[i-p] for i in range(p, len(intervals)))
                / len(intervals) for p in range(1, min(4, len(intervals)-1) + 1)), default=0.0)


def _record(a: Solo, b: Solo, i: int, j: int, exact_len: int,
            df: int, corpus_size: int = 456) -> tuple | None:
    xa, xb = a.intervals, b.intervals
    left, left_edits = _extension(xa, xb, i - 1, j - 1, -1)
    right, right_edits = _extension(xa, xb, i + exact_len, j + exact_len, 1,
                                    budget=max(0, 2 - left_edits))
    aligned = list(reversed(left)) + [(i + z, j + z, "match") for z in range(exact_len)] + right
    positions_a = [x for x, _, _ in aligned if x >= 0]
    positions_b = [y for _, y, _ in aligned if y >= 0]
    a_start, a_end = min(positions_a), max(positions_a) + 1
    b_start, b_end = min(positions_b), max(positions_b) + 1
    edits = left_edits + right_edits
    exact = sum(op == "match" for _, _, op in aligned)
    notes = exact + sum(op == "sub" for _, _, op in aligned) + 1
    if notes < MIN_EXACT_NOTES or a_end >= len(a.pitches) or b_end >= len(b.pitches):
        return None
    pitch_sim = exact / max(1, exact + edits)
    rhythm_sim = _rhythm_similarity(a, b, aligned)
    distinct = max(0.0, min(1.0, 1 - math.log1p(df - 1) / math.log(max(2, corpus_size))))
    periodicity = max(_periodicity(xa[a_start:a_end]), _periodicity(xb[b_start:b_end]))
    same_performer = int(a.performer.casefold() == b.performer.casefold()
                         and not a.performer.startswith("Possible: ")
                         and a.performer != "Unknown soloist")
    if a.source == b.source == "WJazzD":
        same_composition = int(a.composition_id == b.composition_id)
    else:
        title_a = "".join(c for c in a.title.casefold() if c.isalnum())
        title_b = "".join(c for c in b.title.casefold() if c.isalnum())
        same_composition = int(len(title_a) >= 5 and title_a == title_b)
    same_track = int(a.trackid == b.trackid)
    length_score = min(1.0, max(0.0, (notes - 7) / 13))
    score = 100 * (0.35 * pitch_sim + 0.22 * rhythm_sim + 0.25 * distinct + 0.18 * length_score)
    score -= 12 * same_composition + 24 * same_track
    score -= 28 * max(0, (periodicity - 0.5) / 0.5)
    score = round(max(0, min(100, score)), 1)
    return (a.melid, b.melid, a_start, a_end, b_start, b_end, notes, exact, edits,
            round(pitch_sim, 4), round(rhythm_sim, 4), round(distinct, 4), round(periodicity, 4), score,
            df, b.pitches[b_start] - a.pitches[a_start], same_performer,
            same_composition, same_track,
            round(a.solo_start + a.onsets[a_start], 3),
            round(b.solo_start + b.onsets[b_start], 3), json.dumps(aligned))


def build_index(progress=print) -> dict:
    solos = load_combined_corpus()
    report = validate_corpus(solos, combined_source_checksum())
    if report["issues"]:
        raise ValueError(f"Source validation failed: {report['issues'][:5]}")
    progress(f"Loaded {report['solos']} solos and {report['notes']:,} notes")
    intervals = {mid: solo.intervals for mid, solo in solos.items()}
    # Keep the strongest evidence for each pair of overlapping passage windows.
    found: dict[tuple[int, int, int, int], tuple] = {}
    skipped_common = 0
    for seed_len, posting_cap, short_only in ((INDEX_INTERVALS, MAX_POSTINGS, False), (4, 30, True)):
        postings: dict[tuple[int, ...], list[tuple[int, int]]] = defaultdict(list)
        for mid, ints in intervals.items():
            for i in range(len(ints) - seed_len + 1):
                postings[tuple(ints[i:i + seed_len])].append((mid, i))
        progress(f"Indexed {len(postings):,} interval seeds of length {seed_len}")
        for locations in postings.values():
            if len(locations) > posting_cap:
                skipped_common += 1
                continue
            df = len({mid for mid, _ in locations})
            for z, (a_id, i) in enumerate(locations):
                xa = intervals[a_id]
                for b_id, j in locations[z + 1:]:
                    if a_id == b_id:
                        continue
                    xb = intervals[b_id]
                    # Every exact run is generated once at its leftmost seed.
                    if i and j and xa[i - 1] == xb[j - 1]:
                        continue
                    exact_len = seed_len
                    while i + exact_len < len(xa) and j + exact_len < len(xb) and xa[i + exact_len] == xb[j + exact_len]:
                        exact_len += 1
                    if short_only and exact_len >= 7:
                        continue
                    if not short_only and exact_len + 1 < MIN_EXACT_NOTES:
                        continue
                    row = _record(solos[a_id], solos[b_id], i, j, exact_len, df, len(solos))
                    if row is None:
                        continue
                    # Region bucketing collapses many seed origins for one approximate passage.
                    key = (a_id, b_id, row[2] // 3, row[4] // 3)
                    old = found.get(key)
                    if old is None or (row[6], row[13]) > (old[6], old[13]):
                        found[key] = row
        progress(f"Candidate windows after length {seed_len}: {len(found):,}")
    # Collapse near-identical windows that represent the same local passage pair.
    by_pair: dict[tuple[int, int], list[tuple]] = defaultdict(list)
    for row in found.values():
        by_pair[(row[0], row[1])].append(row)
    collapsed = []
    for group in by_pair.values():
        kept = []
        for row in sorted(group, key=lambda x: (x[6], x[13]), reverse=True):
            duplicate = False
            for old in kept:
                oa = max(0, min(row[3], old[3]) - max(row[2], old[2]))
                ob = max(0, min(row[5], old[5]) - max(row[4], old[4]))
                min_a = min(row[3] - row[2], old[3] - old[2])
                min_b = min(row[5] - row[4], old[5] - old[4])
                if oa >= .65 * min_a and ob >= .65 * min_b:
                    duplicate = True
                    break
            if not duplicate:
                kept.append(row)
        collapsed.extend(kept)
    progress(f"Generated {len(collapsed):,} passage pairs; skipped {skipped_common} very common seeds")
    db = connect_store()
    def stable_row_id(row: tuple) -> int:
        identity = ":".join(str(row[n]) for n in (0, 1, 2, 3, 4, 5))
        # Keep IDs exactly representable by JavaScript numbers in the browser.
        return int.from_bytes(hashlib.blake2b(identity.encode(), digest_size=8).digest(), "big") & ((1 << 53) - 1)

    with db:
        db.execute("DELETE FROM candidate")
        db.executemany("""
            INSERT INTO candidate(
                id,a_melid,b_melid,a_start,a_end,b_start,b_end,notes,exact_intervals,edits,
                pitch_similarity,rhythm_similarity,distinctiveness,periodicity,heuristic_score,
                document_frequency,transposition,same_performer,same_composition,same_track,
                a_track_time,b_track_time,alignment
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, ((stable_row_id(row), *row) for row in collapsed))
        db.executemany("INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)", [
            ("source_sha256", report["source_sha256"]),
            ("pipeline", PIPELINE),
            ("corpus_report", json.dumps(report)),
            ("candidate_count", str(len(collapsed))),
        ])
    db.close()
    return {**report, "candidates": len(collapsed), "skipped_common_seeds": skipped_common,
            "pipeline": PIPELINE}
