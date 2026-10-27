# Joint pitch-and-rhythm search: experimental comparison

> **Historical results:** this report benchmarks the v2 endpoint rule. The
> published catalog now uses v3, which keeps qualifying prefixes when a longer
> continuation falls below the export floor. Counts and threshold comparisons
> below do not describe the current catalog; see the current figures in
> [README.md](README.md).

This branch adds an experimental, read-only replacement for the present motif
miner. It writes `data/joint-search.db` and never changes `data/workbench.db` or
the app's ranking. The database and benchmarks were built from the 456 WJazzD
solos (200,809 notes; source SHA-256
`af6a0d9debf042c3581565bd75baad591d32e166cd2ec7298519883de614bf12`).

## Method

Index every sequence of **five consecutive pitch intervals**. Pair occurrences
from different solos when their keys are identical, excluding keys with more
than 80 postings. Each hit gives a six-note transposition-invariant anchor.
Starting at each anchor independently, align notes **to the right only**.
Possible operations are pair, skip a note in A, or skip a note in B. No notes
may be inserted inside the anchor. Search retains nondominated states and has
no fixed passage-length limit. A later anchor gets a fresh budget. Finally,
remove a result only if another result for the same solo pair contains its
entire window in both solos.

For paired notes `i,j`, with one transposition `k` per anchor pair:

```
P = min(1, abs(pA[i] + k - pB[j]) / 2)
T = min(1, max(0, abs((beatA[i]-beatA[previous paired i])
                       -(beatB[j]-beatB[previous paired j])) - 0.125) / 0.5)
U = min(1, max(0, abs(durationA[i]-durationB[j]) - 0.125) / 0.5)
c(i,j) = 0.5 P + 0.25 T + 0.25 U
```

The first paired note has `T=0`. A skip costs 1. The accumulated cost `D` may
not exceed 6. The cost since the most recent zero-cost pair may not exceed 2.
Zero-cost pairs reset that local streak. For each seed, choose the endpoint
that maximizes the shorter of the two rightward spans; break ties by more
paired notes and then lower cost. Its simple similarity is `S = 1 - D/(M+G)`, where `M` is paired
notes and `G` is gaps. The experimental database also stores `M-D` as an
unvalidated ranking value. All thresholds and weights are provisional.

WJazzD note onsets and durations use the actual beat grid. The JTD pilot is
excluded because its existing import floors note onsets to whole beats, and
DTL1000 still lacks a complete authorized note export. This is deliberately a
WJazzD comparison, not a claim about cross-collection quality.

## Measured performance

The full WJazzD inverted index produced **662,700 eligible cross-solo anchor
pairs**. On this machine, searching all of them took **28.1 s** in an
in-memory comparison; the current greedy extension took **10.2 s** on exactly
those same seeds. A separate full build of the experimental SQLite database
took **60 s wall time**, including writing and containment removal, with
**121 MB peak resident memory**. The in-memory comparison used **907 MB**
because it retained every baseline and new result at once. The experimental
database is about **91 MB**. At 100,000 sampled seeds, median explored states
was 7, the 90th percentile was 20, and the maximum was 1,007. This supports
offline scalability for WJazzD, although the new extension is roughly 2.7×
slower than the old extension on identical seeds.

| Same-seed measure | Current extension | Joint extension |
| --- | ---: | ---: |
| Windows with at least eight notes/pairs before final deduplication | 301,240 | 441,357 |
| Median passage size | 9 notes | 9 paired notes |
| 90th percentile passage size | 11 notes | 11 paired notes |
| Search time | 10.2 s | 28.1 s |

Strict containment leaves **360,578** joint windows, versus **79,869** WJazzD
windows in the current app database. Those counts are **not** directly
comparable as relevance: the current build also has a four-interval pass,
extends left and right, and collapses nearby windows using a 65% overlap
rule. The new volume is nonetheless too large for the current app's
load-every-candidate-in-memory design.

On a fixed random sample of 100,000 anchors, applying a similarity cutoff
*after* strict containment gave 24,292 windows at `S >= 0.80` and only 1,798
at `S >= 0.85`; requiring at least 10 paired notes gave 9,750 and 1,244
respectively. On the complete experimental database, 131,822 windows have
`S >= 0.80`, 8,436 have `S >= 0.85`, and 269 have `S >= 0.90`. A small change
in the threshold therefore changes output volume dramatically; it should not
be set from counts alone.

## Coverage and interpretation

Using at least 65% overlap in each solo as a location match, the new database
overlaps **32,069 of 79,869** current WJazzD result windows (40%). However,
it overlaps **99 of the current top 100**, **477 of the top 500**, and **941 of
the top 1,000** by the current heuristic score. Only **37,278** current WJazzD
windows contain any exact five-interval anchor within their windows at all;
the rest cannot be retrieved under the chosen index rule. All top 100 do
contain one. This is the main recall tradeoff of the simpler anchor.

In a planted two-note-ornament test, the new alignment skips both added notes
and recovers the clean continuation, while the current greedy extension does
not produce a qualifying result. Other tests cover transposition, long exact
extension, budget enforcement, and strict containment. These are correctness
tests, **not** estimates of musical precision or recall. The current database
has **zero listener reviews**, so no threshold or ranking value can yet be
declared better. Some top joint results are several shifted windows of the
same solo pair; strict containment alone does not solve presentation-level
duplication.

The budget sweep on 10,000 fixed sampled anchors found:

| Total / consecutive cost budget | Windows found | 90th percentile pairs | Extension time |
| --- | ---: | ---: | ---: |
| 2 / 1 | 2,038 | 10 | 0.15 s |
| 2 / 2 | 6,342 | 10 | 0.44 s |
| 4 / 2 | 6,709 | 11 | 0.54 s |
| 6 / 2 | 6,709 | 11 | 0.43 s |
| 8 / 2 | 6,709 | 11 | 0.60 s |
| 6 / 3 | 9,375 | 14 | 1.42 s |
| 6 / 4 | 9,897 | 15 | 3.60 s |

The consecutive-cost limit dominates this sample; increasing the total from
4 to 6 with local limit 2 changes no sampled outputs. Raising the local limit
greatly increases candidate volume and work. These runs were not controlled
for CPU contention, so compare counts and broad time scale, not small timing
differences.

## Decision before app rollout

The engine is fast enough for an offline build and has a much simpler,
explainable note cost. It is **not ready to replace the live ranking**: its
eight-note threshold admits hundreds of thousands of windows, no listener
labels exist, and the JTD beat import needs repair and reimport before
cross-collection rhythm comparisons. Review a stratified set of passages
across similarity, length, and baseline/new-only categories, then choose a
minimum quality threshold and presentation deduplication rule from those
judgments. Only then should the app read the new index.

`data/search-review-sample.csv` contains 60 cross-performer,
different-composition joint results: four random candidates in each of 15
similarity-by-length strata, selected with seed 41. It includes source links,
note locations, and blank listener-label and endpoint columns. It samples the
joint results only; a separate baseline-only sample would be needed to assess
what the new five-interval anchor loses.

## Reproduce

```
python3 -m unittest discover -s tests -v
python3 -m jazzmine.compare_search --sample 100000 --output data/search-comparison-100000.json
python3 -m jazzmine.compare_search --sample 662700 --output data/search-comparison-full.json
python3 -m jazzmine.joint_store --output data/joint-search.db
```

`data/search-comparison-100000.json` and `data/search-comparison-full.json`
contain the recorded benchmark output. The generated SQLite file is ignored
by Git and can be rebuilt. Existing uncommitted project work was left alone.
