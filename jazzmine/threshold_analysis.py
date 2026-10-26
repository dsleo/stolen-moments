"""Measure the complete joint-search distribution and static export sizes.

Run `python3 -m jazzmine.threshold_analysis`. Reads the experimental index and
WJazzD corpus; never changes either database.
"""
from __future__ import annotations

import gzip
import json
import math
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from .corpus import ROOT, load_corpus, source_checksum
from .joint_search import Settings, _bounded, wjazzd_beat_durations


THRESHOLDS = (0.0, 0.70, 0.75, 0.78, 0.80, 0.82, 0.83, 0.84,
              0.85, 0.86, 0.87, 0.88, 0.90, 0.92, 0.95)
STORE = ROOT / "data" / "joint-search.db"
OUTPUT = ROOT / "data" / "joint-threshold-analysis.json"
DETAIL_SHARD_SIZE = 1024


@dataclass
class Summary:
    count: int = 0
    paired_sum: int = 0
    gaps_sum: int = 0
    with_gap: int = 0
    at_least_12: int = 0
    at_least_16: int = 0
    at_least_24: int = 0
    same_performer: int = 0
    same_composition: int = 0
    cross_performer_distinct_composition: int = 0
    cost_sum: float = 0.0
    pitch_cost_sum: float = 0.0
    onset_cost_sum: float = 0.0
    duration_cost_sum: float = 0.0
    skip_cost_sum: float = 0.0
    paired_histogram: Counter = field(default_factory=Counter)
    solo_ids: set[int] = field(default_factory=set)
    solo_pairs: set[tuple[int, int]] = field(default_factory=set)

    def add(self, row, components, solos) -> None:
        ai, bi, paired, gaps, cost = row[0], row[1], row[6], row[7], row[8]
        self.count += 1
        self.paired_sum += paired
        self.gaps_sum += gaps
        self.with_gap += gaps > 0
        self.at_least_12 += paired >= 12
        self.at_least_16 += paired >= 16
        self.at_least_24 += paired >= 24
        self.cost_sum += cost
        self.pitch_cost_sum += components[0]
        self.onset_cost_sum += components[1]
        self.duration_cost_sum += components[2]
        self.skip_cost_sum += components[3]
        same_perf = solos[ai].performer.casefold() == solos[bi].performer.casefold()
        same_comp = solos[ai].composition_id == solos[bi].composition_id
        self.same_performer += same_perf
        self.same_composition += same_comp
        self.cross_performer_distinct_composition += not same_perf and not same_comp
        self.paired_histogram[paired] += 1
        self.solo_ids.update((ai, bi))
        self.solo_pairs.add((ai, bi))

    def as_dict(self) -> dict:
        n = max(1, self.count)
        def percentile(fraction: float) -> int | None:
            if not self.count:
                return None
            target = math.ceil(fraction * self.count)
            running = 0
            for length, amount in sorted(self.paired_histogram.items()):
                running += amount
                if running >= target:
                    return length
            return None
        return {
            "results": self.count,
            "mean_paired": round(self.paired_sum / n, 2),
            "median_paired": percentile(.5), "p90_paired": percentile(.9),
            "with_gap_pct": round(100 * self.with_gap / n, 2),
            "mean_gaps": round(self.gaps_sum / n, 3),
            "paired_at_least_12": self.at_least_12,
            "paired_at_least_16": self.at_least_16,
            "paired_at_least_24": self.at_least_24,
            "same_performer_pct": round(100 * self.same_performer / n, 2),
            "same_composition_pct": round(100 * self.same_composition / n, 2),
            "cross_performer_distinct_composition": self.cross_performer_distinct_composition,
            "unique_solos": len(self.solo_ids),
            "unique_solo_pairs": len(self.solo_pairs),
            "mean_cost": round(self.cost_sum / n, 3),
            "cost_share_pct": {
                "pitch": round(100 * self.pitch_cost_sum / max(1e-9, self.cost_sum), 2),
                "onset": round(100 * self.onset_cost_sum / max(1e-9, self.cost_sum), 2),
                "duration": round(100 * self.duration_cost_sum / max(1e-9, self.cost_sum), 2),
                "skips": round(100 * self.skip_cost_sum / max(1e-9, self.cost_sum), 2),
            },
        }


def _cost_components(row, solos, beat_durations, settings: Settings) -> tuple[float, float, float, float]:
    ai, bi, _, _, _, _, _, gaps, cost, _, _, transposition, alignment_json = row
    a, b = solos[ai], solos[bi]
    da, db = beat_durations[ai], beat_durations[bi]
    pitch = onset = duration = skipped = 0.0
    previous = None
    alignment = json.loads(alignment_json)
    for i, j in alignment:
        if i < 0 or j < 0:
            skipped += 1.0
            continue
        pitch += 0.5 * min(1.0, abs(a.pitches[i] + transposition - b.pitches[j]) / settings.pitch_scale)
        duration += 0.25 * _bounded(abs(da[i] - db[j]), settings.duration_tolerance,
                                    settings.duration_scale)
        if previous is not None:
            pi, pj = previous
            diff = abs((a.beat_positions[i] - a.beat_positions[pi]) -
                       (b.beat_positions[j] - b.beat_positions[pj]))
            onset += 0.25 * _bounded(diff, settings.onset_tolerance, settings.onset_scale)
        previous = (i, j)
    if skipped != gaps or abs(pitch + onset + duration + skipped - cost) > 1e-6:
        raise ValueError(f"Stored alignment/cost mismatch for {ai}:{bi}:{row[2]}:{row[4]}")
    return pitch, onset, duration, skipped


def _gz_size(value) -> tuple[int, int]:
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return len(raw), len(gzip.compress(raw, compresslevel=6, mtime=0))


def _solo_metadata(solo) -> list:
    return [solo.performer, solo.title, solo.album, solo.album_artist,
            solo.instrument, solo.year, solo.composition_id, solo.solo_start,
            solo.source_url]


def _notes(solo) -> list:
    return [[p, round(t, 3), round(d, 3), round(beat, 3), event, phrase, chord]
            for p, t, d, beat, event, phrase, chord in zip(
                solo.pitches, solo.onsets, solo.durations, solo.beat_positions,
                solo.eventids, solo.phrase_ids, solo.chords)]


def _static_sizes(db, threshold: float, solos, note_sizes: dict[int, tuple[int, int]]) -> dict:
    """Measure actual compact JSON and gzip, with lazy note/detail files."""
    summaries = []
    used = set()
    detail_raw = detail_gz = 0
    detail_shard_gz = []
    shard = []
    rows = db.execute("""SELECT a_id,b_id,a_start,a_end,b_start,b_end,paired,gaps,
                                cost,similarity,evidence,transposition,alignment
                         FROM candidate WHERE similarity>=? ORDER BY evidence DESC""", (threshold,))
    for row in rows:
        ai, bi, a0, a1, b0, b1, paired, gaps, cost, sim, evidence, transposition, alignment = row
        used.update((ai, bi))
        a, b = solos[ai], solos[bi]
        summaries.append([ai, bi, a0, a1, b0, b1, paired, gaps,
                          round(sim, 4), round(evidence, 3),
                          round(a.solo_start + a.onsets[a0], 3),
                          round(b.solo_start + b.onsets[b0], 3)])
        shard.append([transposition, json.loads(alignment)])
        if len(shard) == DETAIL_SHARD_SIZE:
            raw, compressed = _gz_size(shard)
            detail_raw += raw
            detail_gz += compressed
            detail_shard_gz.append(compressed)
            shard = []
    if shard:
        raw, compressed = _gz_size(shard)
        detail_raw += raw
        detail_gz += compressed
        detail_shard_gz.append(compressed)
    metadata = {str(mid): _solo_metadata(solos[mid]) for mid in sorted(used)}
    index_raw, index_gz = _gz_size({"solos": metadata, "rows": summaries})
    notes_raw = sum(note_sizes[mid][0] for mid in used)
    notes_gz = sum(note_sizes[mid][1] for mid in used)
    return {
        "search_index_raw_bytes": index_raw,
        "search_index_gzip_bytes": index_gz,
        "detail_shards": len(detail_shard_gz),
        "detail_shards_raw_bytes": detail_raw,
        "detail_shards_gzip_bytes": detail_gz,
        "median_detail_shard_gzip_bytes": sorted(detail_shard_gz)[len(detail_shard_gz)//2] if detail_shard_gz else 0,
        "solo_note_files": len(used),
        "solo_note_files_raw_bytes": notes_raw,
        "solo_note_files_gzip_bytes": notes_gz,
        "all_content_gzip_bytes": index_gz + detail_gz + notes_gz,
    }


def _baseline_top_coverage(db, threshold: float) -> dict:
    old = sqlite3.connect(f"file:{(ROOT / 'data' / 'workbench.db').resolve()}?mode=ro", uri=True)
    reference = old.execute("""SELECT a_melid,b_melid,a_start,a_end,b_start,b_end
                               FROM candidate WHERE a_melid<1000000 AND b_melid<1000000
                               ORDER BY heuristic_score DESC LIMIT 1000""").fetchall()
    old.close()
    new_by_pair = defaultdict(list)
    for row in db.execute("""SELECT a_id,b_id,a_start,a_end,b_start,b_end FROM candidate
                             WHERE similarity>=?""", (threshold,)):
        new_by_pair[row[:2]].append(row)
    def close(oldrow, newrow):
        overlap_a = max(0, min(oldrow[3], newrow[3]) - max(oldrow[2], newrow[2]))
        overlap_b = max(0, min(oldrow[5], newrow[5]) - max(oldrow[4], newrow[4]))
        return (overlap_a >= .65 * min(oldrow[3]-oldrow[2], newrow[3]-newrow[2]) and
                overlap_b >= .65 * min(oldrow[5]-oldrow[4], newrow[5]-newrow[4]))
    hits = [any(close(r, candidate) for candidate in new_by_pair.get(r[:2], ()))
            for r in reference]
    return {"top_100": sum(hits[:100]), "top_500": sum(hits[:500]),
            "top_1000": sum(hits)}


def analyze(store: Path = STORE) -> dict:
    db = sqlite3.connect(f"file:{store.resolve()}?mode=ro", uri=True)
    meta = dict(db.execute("SELECT key,value FROM meta"))
    if meta.get("complete") != "True" or meta.get("source_sha256") != source_checksum():
        raise ValueError("The joint index is incomplete or does not match WJazzD")
    settings = Settings(**json.loads(meta["settings"]))
    solos = load_corpus()
    beat_durations = wjazzd_beat_durations(solos)
    summaries = {threshold: Summary() for threshold in THRESHOLDS}
    rows = db.execute("""SELECT a_id,b_id,a_start,a_end,b_start,b_end,paired,gaps,
                                cost,similarity,evidence,transposition,alignment
                         FROM candidate""")
    for row in rows:
        components = _cost_components(row, solos, beat_durations, settings)
        for threshold in THRESHOLDS:
            if row[9] >= threshold:
                summaries[threshold].add(row, components, solos)
    note_sizes = {mid: _gz_size(_notes(solo)) for mid, solo in solos.items()}
    result = {"scope": "complete WJazzD experimental joint index",
              "source_sha256": meta["source_sha256"],
              "settings": json.loads(meta["settings"]),
              "full_sqlite_bytes": store.stat().st_size,
              "static_format": "compact JSON search index; 1024-result alignment shards; one full note file per used solo; gzip level 6; no artwork, audio, video metadata, or reviews",
              "thresholds": {f"{threshold:.2f}": {
                  **summaries[threshold].as_dict(),
                  "sizes": _static_sizes(db, threshold, solos, note_sizes),
                  "current_top_overlap": _baseline_top_coverage(db, threshold),
              } for threshold in THRESHOLDS}}
    db.close()
    return result


def main() -> None:
    result = analyze()
    OUTPUT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT}")
    for threshold, item in result["thresholds"].items():
        size = item["sizes"]
        print(threshold, item["results"], round(size["search_index_gzip_bytes"] / 2**20, 3),
              round(size["all_content_gzip_bytes"] / 2**20, 3),
              item["current_top_overlap"]["top_100"])


if __name__ == "__main__":
    main()
