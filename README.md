# Stolen Moments

**Current app:** the joint pitch-and-rhythm search is published as a read-only,
fully static WJazzD site. See [STATIC_SITE.md](STATIC_SITE.md) for the build,
hosting, recording-link behavior, and current collection coverage. The older
server and search notes below describe the previous local workbench.

A local web app for exploring melodic reuse in the 456 solo transcriptions of the Weimar Jazz Database (WJazzD) v2.1. It finds transposed interval matches and bounded variants, then lets a musician adjust thresholds, compare score excerpts, hear a synthesized rendering, and find a source-recording link.

## DTL1000 note tracks

The [current DTL1000 metadata export](https://dig-that-lick.hfm-weimar.de/similarity_search/documentation) lists 1,685 solos. Its solo-detail pages expose pitches, onsets, and durations for MIDI playback, so audio files are not needed for motif search. A local importer and cross-collection search support are prepared, but the site blocked bulk requests after 750 note tracks were fetched; its [robots rules](https://dig-that-lick.hfm-weimar.de/robots.txt) also disallow automated crawling. The app deliberately continues to show only the complete WJazzD index. Completing the DTL1000 import requires an authorized note-track export or permission from the project. DTL1000 notes are automatic transcriptions and have no annotated beat or harmony grid.

The [23 October reconciliation](data/DTL_STATUS.md) verifies the original archive,
lists the 935 missing note tracks, and documents timestamp discrepancies between
the JSON and CSV. Run `python3 -m jazzmine export-dtl /path/to/dtl_1000.json` to
produce a staging JSON with available notes, original metadata, and a gap report.

### Jazz Trio Database pilot

A balanced pilot of 120 performances from the [Jazz Trio Database](https://github.com/HuwCheston/Jazz-Trio-Database)
is available in the local index. Its chordal piano MIDI is represented by a
provisional highest-note line, so motif matches are exploratory. The imported
annotation data is MIT-licensed; linked recordings retain their own terms. To
rebuild the local pilot database from the official release archive, run
`python3 -m jazzmine import-jtd-pilot /path/to/jazz-trio-database-v02.zip`.
The app currently combines WJazzD with this pilot; use **Jazz Trio Database
only** to inspect its internal matches.
The [pilot report](data/JTD_PILOT.md) records source details, extraction method,
and initial match counts.

## Start

Requires Python 3.11 or newer. The application has no third-party Python dependencies.

```sh
python3 -m jazzmine download
python3 -m jazzmine build
python3 -m jazzmine sync-jazztube
python3 -m jazzmine serve --port 8766
```

Open [http://127.0.0.1:8766](http://127.0.0.1:8766). `download` fetches the official 42 MB SQLite database to `data/wjazzd.db`; `build` creates a local search index in `data/workbench.db`. Both databases stay on your computer and are excluded from Git. The build takes roughly a minute on a recent laptop. On this machine it produced 86,736 passage pairs.

The workspace already contains the downloaded source and built index, so starting the server is enough here.

## Use the controls

- **Matched notes:** minimum aligned phrase length (8–24 notes).
- **Pitch agreement:** fraction of aligned intervals that match exactly. Transposition is allowed.
- **Pitch edits:** zero, one, or two substitutions/short gaps around an exact seed.
- **Rhythm agreement:** similarity of inter-onset spacing measured in beats.
- **Distinctiveness:** how uncommon the seed is across different solos in the indexed collections.
- **Musician:** type a name and choose an archive suggestion to limit results to passages involving that musician.
- **All-data search:** searches always span every collection, performer relationship, and composition currently in the index. Decade and instrument browsing remain available from the crate shelf.

The count and score distribution update after every control change. Open a passage to inspect source note IDs, track times, two staff-notation extracts, component scores, and the two synthesized transcriptions. The notation uses stored MIDI pitches and note spacing in beats, quantized to sixteenths; it is an approximate rhythmic sketch rather than an edited publication score. The **ranking score is a heuristic**, not a probability of quotation, intent, or influence. Repeated short cells are penalized because long loops can otherwise dominate the ranking.

**Export CSV** downloads the currently filtered results.

## Recording links

Each result shows both source-track timestamps. [JazzTube](http://mir.audiolabs.uni-erlangen.de/jazztube/downloads) publishes YouTube IDs and video start/end times for 329 WJazzD solos. `sync-jazztube` imports its CSV (988 video entries), checks each candidate against YouTube, and keeps the first currently available video for each solo. On this machine that yielded 297 linked solos. The app maps passage positions into the corresponding video. These links open actual YouTube video IDs with timestamps. The timestamp is approximate: it interpolates between JazzTube's solo bounds and the WJazzD note extent, and video availability can change later. Open the JazzTube alignment link in a passage to inspect its source. A manually verified track/video mapping takes precedence.

For other solos, the app can still find a likely video using artist, tune, album, and near-identical duration against the source's MusicBrainz recording. Those positions are estimated from source-track time. Open a passage and choose **Check for a video** to search a track that has not been matched yet. Expanded passages also show the album, official WJazzD transcription, and MusicBrainz recording record when available. To import a local copy of JazzTube's CSV, use `python3 -m jazzmine sync-jazztube --csv /path/to/csv_youtube.csv`.

Automatic discovery requires `yt-dlp` on the local machine and network access. `python3 -m jazzmine discover-videos --limit 50` checks the tracks most prominent in current default results and caches strong metadata matches. MusicBrainz permits at most one request per second, so this may take several minutes. The video discovery process does not download or redistribute audio.

The **Hear the transcription** buttons synthesize the database notes in the browser. They are useful for comparison, but they are not original recording audio.

Score excerpts are rendered locally with a bundled copy of abcjs 6.7.2 (MIT license in `static/vendor/abcjs-LICENSE.md`), so they remain available without a third-party page load.

## Validation and evaluation

```sh
python3 -m jazzmine validate
python3 -m jazzmine evaluate
python3 -m unittest discover -s tests
```

`evaluate` reports sensitivity on planted 8–12-note transposed passages with one changed interval, plus current human-review coverage. The planted check is **not** a real-world recall estimate. Human-review shares are descriptive until a blinded, stratified expert set is labeled. The local source passed ingestion validation with 456 solos and 200,809 note events.

## How matching works

Search is **seed-and-extend over a prebuilt index**, not a sliding window over every pair of solos. `python3 -m jazzmine build` does it once; the UI only filters the result.

1. **Intervals.** Each solo becomes its list of pitch intervals in semitones, so a transposed phrase matches itself. Rhythm and octave are not part of this step.
2. **Seed index.** Every run of 5 consecutive intervals is stored in an inverted index (seed → solo, position). A second pass indexes runs of 4, but keeps only matches whose exact run is shorter than 7 intervals, to recover short motifs.
3. **Pairing.** Two positions that share a seed, in **different solos**, form a candidate. Each exact run is generated once, from its leftmost seed.
4. **Extension.** The match grows outward from the exact run. A mismatch is allowed only if an exact interval follows it: a substitution, or a gap of one interval on either side. At most **2 edits in total**, and at most **8 intervals beyond the exact run on each side**.
5. **Filtering at build time.** Candidates under **8 notes** are dropped. Overlapping windows for the same pair of solos (65% overlap on both sides) collapse to the longest, best-scored one.
6. **Scoring.** `score = 100 × (0.35 pitch + 0.22 rhythm + 0.25 distinctiveness + 0.18 length)`, minus penalties for the same tune (12), the same track (24) and looping cells (up to 28). Pitch is the exact share of aligned intervals; rhythm compares inter-onset spacing in beats (in seconds, tempo-normalised, when DTL1000 is involved); distinctiveness falls with the number of solos containing the seed.

### Which settings can the UI change?

| Setting | Where | Can the UI change it? |
| --- | --- | --- |
| Matched notes and sort order | Crate result-settings menu | Yes, instantly. They filter or reorder the stored candidates. |
| Pitch/rhythm/distinctiveness thresholds, pitch edits (0–2), musician | Search drawer | Yes, instantly. They filter the stored candidates while searching all indexed collections. |
| Decade and instrument | Crate shelf | Yes, instantly. They filter the stored candidates. |
| Seed length (5, and 4 for short motifs) | `INDEX_INTERVALS` in `jazzmine/mining.py` | No. Needs a rebuild. |
| Common-seed cutoff (80 occurrences; 30 in the length-4 pass) | `MAX_POSTINGS` in `jazzmine/mining.py` | No. Needs a rebuild. |
| Minimum notes at build time (8), edit budget (2), extension length (8) | `mining.py` | No. The UI can tighten these, never loosen them: a "Matched notes" below 8 or more than two pitch edits cannot reveal candidates that were never built. |

After changing a constant, run `python3 -m jazzmine build` again. The index records its pipeline version in the `meta` table.

## Near-duplicate passages (joint search)

**Issue.** In the joint pitch-and-rhythm search every 5-interval seed inside a long shared phrase extends to almost the same window, shifted by a few notes. Dropping only windows *contained* in another left these overlapping variants, so one real match appeared several times with start times a second apart (for example Steve Coleman's "The Oracle" against Steve Lacy's "Skippy": five 25-26 note windows starting at notes 514, 516, 519, 522 and 525).

**Fix.** `consolidate()` in `jazzmine/joint_store.py` runs at the end of every build (pipeline `joint-seed-5-right-v2`). Within one ordered solo pair, windows that overlap a stronger one by at least 50% of the shorter range on **both** solos are the same passage; only the highest-evidence one is kept. To apply it to an existing store without rebuilding: `python3 -m jazzmine.joint_store --consolidate-only`, then `python3 -m jazzmine.static_export`.

**Measured on the current store** (similarity ≥ 0.8):

| | Before | After |
| --- | --- | --- |
| All candidates | 360,578 | 342,129 (18,449 merged, 5.1%) |
| Passages in the static catalog | 131,822 | 126,524 (5,298 merged, 4.0%) |
| Crate count (distinct songs only) | 131,054 | about 125,800 |
| Solo pairs with a merged passage | | 3,244 of 42,558 |

Most affected solo pairs lost one passage (2,370); the rest lost two to eight.

**Still open.**
- About 1,500 pairs of kept windows overlap by 25-50% on both solos. Nearly all sit on different diagonals (a different alignment of a repeated motif), so they are treated as distinct passages. Only a few dozen share a diagonal.
- Alternate takes of one tune by the same performer (for example two "The Oracle" solos) are separate solos and can each match the same other solo at the same notes. About 140 such take pairs exist; they are different recordings and are not merged.
- The 50% threshold is a judgement call, not tuned against labels.

## Limitations of the current approach

- **Common seeds are skipped.** A seed seen more than 80 times (30 in the length-4 pass) is discarded entirely. This removes scales, arpeggios and stock patterns, but it also removes a genuinely common lick, and a phrase built only from such seeds is never found. The number of skipped seeds is reported by `build`.
- **Variants are shallow.** There are at most 2 edits in total, each a single-interval substitution or gap, and each must be followed by an exact interval. The matcher finds a phrase with a changed or dropped note. It does not find a phrase with several changes in a row, a reordered phrase, an ornamented phrase with extra passing notes, or one with a stretched or compressed rhythm.
- **Every match needs an exact core** of 4 or 5 intervals (so 5 or 6 notes) and ends up at least 8 notes long. Shorter motifs are out of scope.
- **Pitch only in retrieval.** Rhythm is scored after a candidate is found and never creates one. Octave displacement or contour-preserving variants (same shape, different interval sizes) are not matched.
- **Different solos only.** A phrase repeated inside one solo is not reported, though the same performer across two solos is.
- **Distinctiveness is relative to the corpus.** It is computed against the indexed solos (456 for WJazzD alone), so it shifts if the corpus changes.
- **The score is a heuristic** with hand-set weights. It orders listening; it is not calibrated against expert labels.
- **Small corpus.** Only WJazzD (456 solos, 78 performers) is indexed. DTL1000 support exists in the code but is not in the index (see above).
- **Index and server load everything in memory.** All 86,736 candidates are scanned in Python per request, which is fine at this size but would need SQL-side filtering for a much larger corpus.

## Boundaries

The first release searches WJazzD solo transcriptions, not every song a soloist might quote. Candidate matches can reflect common jazz vocabulary, a shared composition, or chance. See the limitations above: the search skips very common seeds and its variant matcher is anchored on exact runs of four or five intervals, so it can miss heavily transformed quotations. Dates are presented as recorded by WJazzD; they do not establish influence or authorship. Media links require manual performance verification.

The suggested [Jazz-Ml-Dataset](https://github.com/SaiKayala/Jazz-Ml-Dataset) is a collection of song MIDI files and a derived note CSV, with many full arrangements and non-jazz songs. Its files do not identify real solo performances or their audio timestamps. We inspected the archive: only 84 labeled melody tracks were nearly monophonic by a basic overlap check, often with doubled parts. It is a possible future **composition melody reference** after tune identity and duplicate checks, but it is not interchangeable with the WJazzD solo corpus and has not been added to the quotation ranking.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the research rationale and future audio/reference-corpus phases.

## Data and attribution

WJazzD is published by the Jazzomat Research Project under the Open Database License, with individual database contents under the Database Contents License. See the [official download and license page](https://jazzomat.hfm-weimar.de/download/download.html), the [schema](https://jazzomat.hfm-weimar.de/dbformat/dbformat.html), and the citation requested by the project: Pfleiderer, Frieler, Abeßer, Zaddach & Burkhart (eds.), *Inside the Jazzomat: New Perspectives for Jazz Research* (2017). Assess redistribution obligations before publishing derived data.
