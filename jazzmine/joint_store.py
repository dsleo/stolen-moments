"""Build a separate experimental database; never overwrite the app index."""
from __future__ import annotations

import argparse
import json
import sqlite3
import time
from dataclasses import asdict
from pathlib import Path

from .corpus import ROOT, load_corpus, validate_corpus
from .joint_search import Settings, anchors, extend, wjazzd_beat_durations


DEFAULT_STORE = ROOT / "data" / "joint-search.db"


def build(path: Path = DEFAULT_STORE, settings: Settings = Settings(),
          limit: int | None = None, progress=print) -> dict:
    if path.resolve() == (ROOT / "data" / "workbench.db").resolve():
        raise ValueError("The experimental search must not overwrite the app index")
    solos = load_corpus()
    report = validate_corpus(solos)
    if report["issues"]:
        raise ValueError(report["issues"][:5])
    durations = wjazzd_beat_durations(solos)
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS candidate (
            a_id INTEGER NOT NULL, b_id INTEGER NOT NULL,
            a_start INTEGER NOT NULL, a_end INTEGER NOT NULL,
            b_start INTEGER NOT NULL, b_end INTEGER NOT NULL,
            paired INTEGER NOT NULL, gaps INTEGER NOT NULL,
            cost REAL NOT NULL, similarity REAL NOT NULL,
            evidence REAL NOT NULL, transposition INTEGER NOT NULL,
            alignment TEXT NOT NULL,
            PRIMARY KEY (a_id,b_id,a_start,b_start)
        );
        CREATE INDEX IF NOT EXISTS candidate_rank ON candidate(evidence DESC);
        CREATE INDEX IF NOT EXISTS candidate_solos ON candidate(a_id,b_id);
    """)
    db.execute("DELETE FROM candidate")
    db.execute("INSERT OR REPLACE INTO meta VALUES ('complete','False')")
    db.commit()
    count = found = states = 0
    started = time.perf_counter()
    batch = []
    for ai, bi, i, j in anchors(solos, settings):
        if limit is not None and count >= limit:
            break
        count += 1
        p, visited = extend(solos[ai], solos[bi], i, j, settings,
                            durations[ai], durations[bi])
        states += visited
        if p is None:
            continue
        found += 1
        batch.append((p.a_id, p.b_id, p.a_start, p.a_end, p.b_start, p.b_end,
                      p.paired, p.gaps, p.cost, p.similarity, p.paired - p.cost,
                      p.transposition, json.dumps(p.alignment, separators=(",", ":"))))
        if len(batch) >= 1000:
            db.executemany("INSERT OR REPLACE INTO candidate VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
            db.commit()
            batch.clear()
        if count % 100000 == 0:
            progress(f"Processed {count:,} anchors, found {found:,} windows")
    if batch:
        db.executemany("INSERT OR REPLACE INTO candidate VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
        db.commit()
    search_seconds = time.perf_counter() - started

    # Containment is checked only within one ordered solo pair.  This keeps
    # crossing passages, which could be different meaningful starting points.
    contained = []
    pair = None
    frontier = []
    for row in db.execute("""SELECT rowid,a_id,b_id,a_start,a_end,b_start,b_end
                             FROM candidate ORDER BY a_id,b_id,a_start,b_start,a_end DESC,b_end DESC"""):
        rowid, ai, bi, a0, a1, b0, b1 = row
        if (ai, bi) != pair:
            pair, frontier = (ai, bi), []
        if any(x0 <= a0 and x1 >= a1 and y0 <= b0 and y1 >= b1
               for x0, x1, y0, y1 in frontier):
            contained.append((rowid,))
        else:
            frontier = [(x0, x1, y0, y1) for x0, x1, y0, y1 in frontier
                        if not (a0 <= x0 and a1 >= x1 and b0 <= y0 and b1 >= y1)]
            frontier.append((a0, a1, b0, b1))
    if contained:
        db.executemany("DELETE FROM candidate WHERE rowid=?", contained)
    with db:
        db.executemany("INSERT OR REPLACE INTO meta VALUES (?,?)", [
            ("pipeline", "joint-seed-5-right-v1"),
            ("source_sha256", report["source_sha256"]),
            ("settings", json.dumps(asdict(settings))),
            ("eligible_anchors_processed", str(count)),
            ("complete", str(limit is None)),
        ])
    kept = db.execute("SELECT COUNT(*) FROM candidate").fetchone()[0]
    db.close()
    return {"database": str(path), "anchors": count, "found": found,
            "after_containment": kept, "states": states,
            "search_seconds": round(search_seconds, 3), "complete": limit is None,
            "settings": asdict(settings)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_STORE)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--total-budget", type=float, default=6.0)
    parser.add_argument("--run-budget", type=float, default=2.0)
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    if args.total_budget <= 0 or args.run_budget <= 0:
        parser.error("budgets must be positive")
    print(json.dumps(build(args.output,
                           Settings(total_budget=args.total_budget,
                                    run_budget=args.run_budget), args.limit), indent=2))


if __name__ == "__main__":
    main()
