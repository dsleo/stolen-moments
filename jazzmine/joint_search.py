"""Experimental five-interval seed search with joint note alignment.

This module is deliberately separate from the production candidate table.  Its
parameters and output can be compared with the current miner before rollout.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import bisect
import sqlite3

from .corpus import SOURCE, Solo


@dataclass(frozen=True)
class Settings:
    seed_intervals: int = 5
    max_postings: int = 80
    min_similarity: float = 0.8
    total_budget: float = 6.0
    run_budget: float = 2.0
    onset_tolerance: float = 0.125
    duration_tolerance: float = 0.125
    pitch_scale: float = 2.0
    onset_scale: float = 0.5
    duration_scale: float = 0.5
    min_pairs: int = 8


@dataclass(frozen=True)
class Passage:
    a_id: int
    b_id: int
    a_start: int
    a_end: int
    b_start: int
    b_end: int
    paired: int
    gaps: int
    cost: float
    transposition: int
    alignment: tuple[tuple[int, int], ...]

    @property
    def similarity(self) -> float:
        return 1 - self.cost / (self.paired + self.gaps)


@dataclass(slots=True)
class _State:
    i: int
    j: int
    last_i: int
    last_j: int
    cost: float
    run: float
    paired: int
    gaps: int
    parent: "_State | None"
    step: tuple[int, int] | None
    active: bool = True


def _bounded(value: float, tolerance: float, scale: float) -> float:
    return min(1.0, max(0.0, value - tolerance) / scale)


def _duration_beats(solo: Solo, at: int) -> float:
    """Estimate duration from the local seconds/beat slope.

    WJazzD onsets have interpolated beat positions.  The exact beat grid is
    used by its import; this slope is only for note duration.
    """
    n = len(solo.pitches)
    for delta in (1, 2, 3, 4):
        lo, hi = max(0, at - delta), min(n - 1, at + delta)
        seconds = solo.onsets[hi] - solo.onsets[lo]
        beats = solo.beat_positions[hi] - solo.beat_positions[lo]
        if seconds > 1e-6 and beats > 0:
            return solo.durations[at] * beats / seconds
    return solo.durations[at] * 2.0


def wjazzd_beat_durations(solos: dict[int, Solo]) -> dict[int, list[float]]:
    """Read the real WJazzD beat grid once for exact note durations in beats."""
    db = sqlite3.connect(f"file:{SOURCE.resolve()}?mode=ro", uri=True)
    beat_times: dict[int, list[float]] = defaultdict(list)
    for mid, onset in db.execute("SELECT melid,onset FROM beats ORDER BY melid,onset"):
        if mid in solos:
            beat_times[mid].append(float(onset))
    db.close()

    def position(seconds: float, beats: list[float]) -> float:
        if len(beats) < 2:
            return seconds
        j = max(0, min(bisect.bisect_right(beats, seconds) - 1, len(beats) - 2))
        width = beats[j + 1] - beats[j]
        return j + (seconds - beats[j]) / width if width > 0 else float(j)

    return {mid: [position(t + d, beat_times[mid]) - position(t, beat_times[mid])
                  for t, d in zip(solo.onsets, solo.durations)]
            for mid, solo in solos.items()}


def note_cost(a: Solo, b: Solo, i: int, j: int, previous_i: int | None,
              previous_j: int | None, transposition: int, settings: Settings,
              durations_a: list[float], durations_b: list[float]) -> float:
    pitch = min(1.0, abs(a.pitches[i] + transposition - b.pitches[j]) / settings.pitch_scale)
    duration = _bounded(abs(durations_a[i] - durations_b[j]),
                        settings.duration_tolerance, settings.duration_scale)
    timing = 0.0
    if previous_i is not None and previous_j is not None:
        gap_a = a.beat_positions[i] - a.beat_positions[previous_i]
        gap_b = b.beat_positions[j] - b.beat_positions[previous_j]
        timing = _bounded(abs(gap_a - gap_b), settings.onset_tolerance, settings.onset_scale)
    return 0.5 * pitch + 0.25 * timing + 0.25 * duration


def extend(a: Solo, b: Solo, i: int, j: int, settings: Settings = Settings(),
           durations_a: list[float] | None = None,
           durations_b: list[float] | None = None) -> tuple[Passage | None, int]:
    """Align rightward from one exact interval seed; return best reachable end.

    For each state, keep only nondominated (cost, consecutive cost, pairs)
    labels.  The search has no arbitrary note-length limit.
    """
    n = settings.seed_intervals + 1
    if a.intervals[i:i + n - 1] != b.intervals[j:j + n - 1]:
        raise ValueError("The anchor must share all five pitch intervals")
    da = durations_a if durations_a is not None else [_duration_beats(a, x) for x in range(len(a.pitches))]
    db = durations_b if durations_b is not None else [_duration_beats(b, x) for x in range(len(b.pitches))]
    transpose = b.pitches[j] - a.pitches[i]
    seed_cost = 0.0
    run = 0.0
    for z in range(n):
        c = note_cost(a, b, i + z, j + z, i + z - 1 if z else None,
                      j + z - 1 if z else None, transpose, settings, da, db)
        seed_cost += c
        run = run + c if c > 1e-9 else 0.0
        if seed_cost > settings.total_budget + 1e-9 or run > settings.run_budget + 1e-9:
            return None, 0
    start = _State(i + n, j + n, i + n - 1, j + n - 1,
                   seed_cost, run, n, 0, None, None)
    stack = [start]
    labels: dict[tuple[int, int, int, int], list[_State]] = defaultdict(list)
    labels[(start.i, start.j, start.last_i, start.last_j)].append(start)
    def qualifies(s: _State) -> bool:
        return (s.paired >= settings.min_pairs and
                1 - s.cost / (s.paired + s.gaps) >= settings.min_similarity - 1e-9)

    best: _State | None = start if qualifies(start) else None
    explored = 0

    def end_key(s: _State) -> tuple:
        # A maximal rightward passage, then the least-cost explanation of it.
        return (min(s.last_i - i, s.last_j - j), s.paired, -s.cost)

    while stack:
        s = stack.pop()
        if not s.active:
            continue
        explored += 1
        if (qualifies(s) and
                (s.step is None or s.step[0] >= 0 and s.step[1] >= 0) and
                (best is None or end_key(s) > end_key(best))):
            best = s

        def add(ni: int, nj: int, li: int, lj: int, increment: float,
                paired: int, gaps: int, step: tuple[int, int]) -> None:
            total = s.cost + increment
            streak = s.run + increment if increment > 1e-9 else 0.0
            if total > settings.total_budget + 1e-9 or streak > settings.run_budget + 1e-9:
                return
            key = (ni, nj, li, lj)
            bucket = labels[key]
            for old in bucket:
                if old.active and old.cost <= total + 1e-9 and old.run <= streak + 1e-9 and old.paired >= paired:
                    return
            for old in bucket:
                if old.active and total <= old.cost + 1e-9 and streak <= old.run + 1e-9 and paired >= old.paired:
                    old.active = False
            new = _State(ni, nj, li, lj, total, streak, paired, gaps, s, step)
            bucket.append(new)
            stack.append(new)

        if s.i < len(a.pitches) and s.j < len(b.pitches):
            c = note_cost(a, b, s.i, s.j, s.last_i, s.last_j, transpose, settings, da, db)
            add(s.i + 1, s.j + 1, s.i, s.j, c, s.paired + 1, s.gaps, (s.i, s.j))
        if s.i < len(a.pitches) and s.j < len(b.pitches):
            add(s.i + 1, s.j, s.last_i, s.last_j, 1.0, s.paired, s.gaps + 1, (s.i, -1))
        if s.i < len(a.pitches) and s.j < len(b.pitches):
            add(s.i, s.j + 1, s.last_i, s.last_j, 1.0, s.paired, s.gaps + 1, (-1, s.j))

    if best is None:
        return None, explored
    tail = []
    s = best
    while s.parent is not None:
        tail.append(s.step)
        s = s.parent
    alignment = tuple((i + z, j + z) for z in range(n)) + tuple(reversed(tail))
    ai = [x for x, _ in alignment if x >= 0]
    bj = [y for _, y in alignment if y >= 0]
    return Passage(a.melid, b.melid, i, max(ai) + 1, j, max(bj) + 1,
                   best.paired, best.gaps, best.cost, transpose, alignment), explored


def anchors(solos: dict[int, Solo], settings: Settings = Settings()):
    postings = defaultdict(list)
    for mid, solo in solos.items():
        intervals = solo.intervals
        for i in range(len(intervals) - settings.seed_intervals + 1):
            postings[tuple(intervals[i:i + settings.seed_intervals])].append((mid, i))
    for locations in postings.values():
        if len(locations) > settings.max_postings:
            continue
        for z, (a_id, i) in enumerate(locations):
            for b_id, j in locations[z + 1:]:
                if a_id != b_id:
                    yield a_id, b_id, i, j


def remove_contained(passages: list[Passage]) -> list[Passage]:
    """Remove only pairs strictly contained in both solo coordinates."""
    by_pair = defaultdict(list)
    for p in passages:
        by_pair[(p.a_id, p.b_id)].append(p)
    kept = []
    for group in by_pair.values():
        frontier = []
        for p in sorted(group, key=lambda p: (p.a_start, p.b_start, -p.a_end, -p.b_end, p.cost)):
            if any(q.a_start <= p.a_start and q.a_end >= p.a_end and
                   q.b_start <= p.b_start and q.b_end >= p.b_end for q in frontier):
                continue
            frontier = [q for q in frontier if not (p.a_start <= q.a_start and
                        p.a_end >= q.a_end and p.b_start <= q.b_start and p.b_end >= q.b_end)]
            frontier.append(p)
        kept.extend(frontier)
    return kept
