"""Reproducible, read-only comparison of old and experimental search.

Run: python3 -m jazzmine.compare_search --sample 2000 --output data/search-comparison.json
The existing workbench database is never changed.
"""
from __future__ import annotations

import argparse
import json
import random
import time
from dataclasses import asdict
from pathlib import Path

from .corpus import load_corpus, validate_corpus
from .joint_search import Settings, anchors, extend, remove_contained, wjazzd_beat_durations
from .mining import _record


def _percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[min(len(ordered) - 1, int(fraction * len(ordered)))], 4)


def run(sample: int = 2000, seed: int = 41, settings: Settings = Settings()) -> dict:
    solos = load_corpus()
    corpus = validate_corpus(solos)
    rng = random.Random(seed)
    selected = []
    total_anchors = 0
    index_start = time.perf_counter()
    for anchor in anchors(solos, settings):
        total_anchors += 1
        if len(selected) < sample:
            selected.append(anchor)
        else:
            z = rng.randrange(total_anchors)
            if z < sample:
                selected[z] = anchor
    index_seconds = time.perf_counter() - index_start
    durations = wjazzd_beat_durations(solos)
    baseline_rows = []
    baseline_start = time.perf_counter()
    for ai, bi, i, j in selected:
        a, b = solos[ai], solos[bi]
        exact = settings.seed_intervals
        while (i + exact < len(a.intervals) and j + exact < len(b.intervals) and
               a.intervals[i + exact] == b.intervals[j + exact]):
            exact += 1
        baseline_rows.append(_record(a, b, i, j, exact, 1, len(solos)))
    baseline_seconds = time.perf_counter() - baseline_start
    new_rows = []
    explored = []
    new_start = time.perf_counter()
    for ai, bi, i, j in selected:
        row, states = extend(solos[ai], solos[bi], i, j, settings,
                             durations[ai], durations[bi])
        new_rows.append(row)
        explored.append(states)
    new_seconds = time.perf_counter() - new_start
    found = [r for r in new_rows if r]
    old = [r for r in baseline_rows if r]
    new_kept = remove_contained(found)
    paired = [(old, new) for old, new in zip(baseline_rows, new_rows) if old and new]
    cutoffs = {}
    for notes in (8, 10, 12):
        for similarity in (0.75, 0.8, 0.85, 0.9):
            cutoffs[f"pairs>={notes},similarity>={similarity}"] = sum(
                r.paired >= notes and r.similarity >= similarity for r in new_kept)
    return {
        "scope": "WJazzD only; sampled five-interval seeds before production deduplication",
        "corpus": {"solos": corpus["solos"], "notes": corpus["notes"],
                   "source_sha256": corpus["source_sha256"]},
        "settings": asdict(settings), "random_seed": seed,
        "seeds": {"eligible": total_anchors, "sampled": len(selected),
                  "index_seconds": round(index_seconds, 3)},
        "baseline": {"found": len(old), "sample_seconds": round(baseline_seconds, 3),
                     "median_notes": _percentile([r[6] for r in old], .5),
                     "p90_notes": _percentile([r[6] for r in old], .9)},
        "joint": {"found": len(found), "sample_seconds": round(new_seconds, 3),
                  "median_pairs": _percentile([r.paired for r in found], .5),
                  "p90_pairs": _percentile([r.paired for r in found], .9),
                  "median_similarity": _percentile([r.similarity for r in found], .5),
                  "median_cost": _percentile([r.cost for r in found], .5),
                  "after_containment": len(new_kept),
                  "after_cutoffs": cutoffs,
                  "explored_states_median": _percentile(explored, .5),
                  "explored_states_p90": _percentile(explored, .9),
                  "explored_states_max": max(explored, default=0)},
        "same_seed": {"both_found": len(paired),
                      "joint_longer": sum(n.paired > o[6] for o, n in paired),
                      "baseline_longer": sum(o[6] > n.paired for o, n in paired),
                      "equal_pairs": sum(o[6] == n.paired for o, n in paired),
                      "joint_further_right_in_both": sum(n.a_end > o[3] and n.b_end > o[5]
                                                         for o, n in paired),
                      "baseline_further_right_in_both": sum(o[3] > n.a_end and o[5] > n.b_end
                                                            for o, n in paired)},
        "caution": "No listener labels exist. Detection, length, and runtime do not measure musical relevance. The baseline also extends left and uses a second four-interval pass in its full build.",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", type=int, default=2000)
    parser.add_argument("--seed", type=int, default=41)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--total-budget", type=float, default=6.0)
    parser.add_argument("--run-budget", type=float, default=2.0)
    args = parser.parse_args()
    if args.sample < 1:
        parser.error("--sample must be positive")
    if args.total_budget <= 0 or args.run_budget <= 0:
        parser.error("budgets must be positive")
    result = run(args.sample, args.seed,
                 Settings(total_budget=args.total_budget, run_budget=args.run_budget))
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
