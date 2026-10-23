from __future__ import annotations

import json
from collections import Counter, defaultdict

from .corpus import Solo
from .mining import _record
from .server import App


def _synthetic_solo(melid: int, intervals: list[int], transpose: int = 0) -> Solo:
    pitches = [60 + transpose]
    for step in intervals:
        pitches.append(pitches[-1] + step)
    size = len(pitches)
    return Solo(melid=melid, trackid=melid, performer=str(melid), title="Synthetic",
                album="", album_artist="", instrument="piano", recording_date="",
                year=None, composition_id=melid, solo_start=0, musicbrainz_id=None,
                pitches=pitches, onsets=[i * .25 for i in range(size)],
                durations=[.2] * size, eventids=list(range(size)),
                beat_positions=[i * .5 for i in range(size)],
                phrase_ids=[1] * size, chords=[None] * size)


def synthetic_sensitivity() -> dict:
    """Check seeded retrieval on planted transpositions and one-interval edits.

    This is a unit-level sensitivity check, not an estimate of real-world recall.
    """
    base = [2, 1, 3, -2, 4, -5, 2, 2, 1, -3, 4]
    tried = 0
    found = 0
    misses = []
    for note_count in range(8, 13):
        source = _synthetic_solo(1, base[:note_count - 1])
        for edit_at in range(1, note_count - 2):
            altered = base[:note_count - 1]
            altered[edit_at] += 1
            target = _synthetic_solo(2, altered, 5)
            tried += 1
            hit = False
            for seed_len in (5, 4):
                for i in range(len(source.intervals) - seed_len + 1):
                    for j in range(len(target.intervals) - seed_len + 1):
                        if source.intervals[i:i + seed_len] != target.intervals[j:j + seed_len]:
                            continue
                        candidate = _record(source, target, i, j, seed_len, 1)
                        if candidate and candidate[8] <= 1:
                            hit = True
                            break
                    if hit:
                        break
                if hit:
                    break
            found += int(hit)
            if not hit:
                misses.append({"notes": note_count, "edit_at_interval": edit_at})
    return {"found": found, "tried": tried, "sensitivity": round(found / tried, 3),
            "misses": misses, "note": "Planted synthetic passages; does not measure corpus recall."}


def review_summary(app: App) -> dict:
    rows = [dict(r) for r in app.db.execute("SELECT candidate_id,reviewer,label,confidence FROM review")]
    by_candidate = defaultdict(list)
    for row in rows:
        if row["candidate_id"] in app.by_id:
            by_candidate[row["candidate_id"]].append(row["label"])
    labels = Counter(r["label"] for r in rows)
    ranked = app.filtered(app.parameters({"composition": ["distinct"], "limit": [100]}))
    meaningful = {"exact", "variant", "possible quotation"}
    top = {}
    for k in (20, 50, 100):
        subset = ranked[:k]
        reviewed = [by_candidate[r["id"]] for r in subset if r["id"] in by_candidate]
        agreed_positive = sum(1 for votes in reviewed if votes and all(v in meaningful for v in votes))
        top[str(k)] = {"reviewed": len(reviewed), "review_coverage": round(len(reviewed) / max(1, len(subset)), 3),
                       "agreed_positive_among_reviewed": agreed_positive,
                       "positive_share_among_reviewed": round(agreed_positive / len(reviewed), 3) if reviewed else None}
    return {"total_reviews": len(rows), "reviewed_candidates": len(by_candidate), "labels": dict(labels),
            "top_distinct_composition": top,
            "note": "Positive shares include only reviewed candidates and are not unbiased precision estimates."}


def evaluate() -> dict:
    app = App()
    return {"synthetic": synthetic_sensitivity(), "human_review": review_summary(app)}
