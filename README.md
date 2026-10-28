# Stolen Moments

**Live site: <https://dsleo.github.io/stolen-moments/>**

A read-only web app for discovering shared phrases in the 456 solo transcriptions of the Weimar Jazz Database (WJazzD) v2.1. Pick a pair of solos, hear both, see the notes line up, and jump to the recording at that moment. The whole archive is **precomputed**, so the published site is plain static files: no server, database or build step at view time. See [STATIC_SITE.md](STATIC_SITE.md) for hosting details.

## Quick start

Browsing the existing site needs only a static file server:

```sh
python3 -m http.server 8766 -d static
```

Open [http://127.0.0.1:8766](http://127.0.0.1:8766). It cannot be opened as `file://`, because the browser has to fetch compressed data files.

`python3 -m jazzmine serve --port 8766` also works. It serves the same `static/` folder.

## What the app does

- **Crate:** one sleeve per passage pair, with album art, the two musicians, similarity and note count. The filter button narrows by decade, instrument or musician (searchable) and by minimum paired notes. The sort button offers *Best matches*, *Longest passages* and *Most similar*. Active filters show as removable tags.
- **Passage view:** two score excerpts, a synthesized rendering of each (the database notes, not the original audio), and links into the source recordings.
- **Pair links:** opening a passage gives it a shareable `?pair=` URL in the address bar, based on source solo IDs and starting note positions. A ranking reorder does not change these links; a pair removed by a future catalog rebuild cannot be reopened.
- **Echoes:** a timeline of musicians and the strongest connections between them. Select a musician to trace who echoes whom.
- **Listen & Find (feature branch):** record a single melodic instrument, upload a short audio file, or try a built-in example to search every WJazzD solo for similar note passages. A separate continuous mode updates suggestions as notes arrive. Audio is processed in the browser. See [the browser checklist](docs/listen/BROWSER_CHECKLIST.md) and [the model spike](docs/listen/MODEL_SPIKE.md) for tested behavior and limits.

Scores are heuristics for listening, not evidence of quotation or influence.

## Deployment

Pushing to `main` runs `.github/workflows/pages.yml`, which publishes the `static/` folder to GitHub Pages. Rebuild and commit `static/catalog/` first when the data changes.

## How it is built

```sh
python3 -m jazzmine download                 # WJazzD SQLite source -> data/wjazzd.db
python3 -m jazzmine sync-jazztube            # YouTube links with solo alignments
python3 -m jazzmine.joint_store              # joint search -> data/joint-search.db (about 1 minute)
python3 -m jazzmine.static_export            # -> static/catalog/
npm ci && npm run build:listen                # -> static/listen/assets/ (local model)
python3 -m jazzmine.listen_export            # -> static/catalog/listen/ (complete note corpus)
```

The databases in `data/` stay on your computer and are excluded from Git; `static/catalog/` is the generated output that the site serves. Rebuild and re-export whenever the source, search settings or recording links change.

## How matching works

The current search is a **joint pitch-and-rhythm alignment** seeded by pitch intervals. [JOINT_SEARCH_REPORT.md](JOINT_SEARCH_REPORT.md) has the full specification and benchmarks, and [JOINT_THRESHOLD_ANALYSIS.md](JOINT_THRESHOLD_ANALYSIS.md) explains the similarity floor.

1. **Seeds.** Every run of 5 consecutive pitch intervals (in semitones, so transposed phrases match) goes into an inverted index. Seeds that occur more than 80 times are discarded as stock patterns. Two occurrences in *different solos* form an anchor.
2. **Alignment.** From each anchor the match extends to the right note by note. Each step pairs two notes, or skips a note on one side. A paired note costs up to 0.5 for pitch difference, 0.25 for onset spacing in beats and 0.25 for duration in beats; a skipped note costs 1. Total cost may not exceed 6, and cost since the last perfect pair may not exceed 2.
3. **Endpoint.** The longest reachable passage is kept, with at least 8 paired notes.
4. **Similarity** is `1 - cost / (paired + skipped notes)`. The site shows passages at **80% or above**. *Best matches* orders by paired notes minus cost.
5. **Clean-up.** Windows contained in another window for the same pair of solos are removed, then overlapping windows are merged (see below).

Pitch intervals alone create candidates; rhythm only scores them. Dates come from WJazzD and do not establish influence or authorship.

## Recording links

Links open YouTube at the calculated passage onset. Priority: a manually verified track mapping, then [JazzTube](http://mir.audiolabs.uni-erlangen.de/jazztube/downloads)'s solo alignment (`sync-jazztube`, or `--csv /path/to/csv_youtube.csv` for a local copy), then a duration-matched likely recording found with `discover-videos` (needs `yt-dlp` and network access, one MusicBrainz request per second). `python3 -m jazzmine.video_audit` re-checks (over the network, and rewrites `data/joint-video-audit.json`) that the linked videos still exist; unavailable ones are replaced from `data/joint-video-replacements.json` or dropped at export. Video discovery never downloads or redistributes audio.

Score excerpts are rendered locally with a bundled copy of abcjs 6.7.2 (MIT license in `static/vendor/abcjs-LICENSE.md`).

## Checks

```sh
python3 -m jazzmine validate
python3 -m pytest
```

`validate` checks ingestion of the source (456 solos, 200,809 note events).

## Near-duplicate passages (joint search)

**Issue.** In the joint pitch-and-rhythm search every 5-interval seed inside a long shared phrase extends to almost the same window, shifted by a few notes. Dropping only windows *contained* in another left these overlapping variants, so one real match appeared several times with start times a second apart (for example Steve Coleman's "The Oracle" against Steve Lacy's "Skippy": five 25-26 note windows starting at notes 514, 516, 519, 522 and 525).

**Fix.** `consolidate()` in `jazzmine/joint_store.py` runs at the end of every build (pipeline `joint-seed-5-right-v3`). The aligner now retains the longest endpoint that still meets the 80% export floor, then consolidates overlapping windows within each ordered solo pair. Windows that overlap a stronger one by at least 50% of the shorter range on **both** solos are treated as the same passage; the highest-evidence window is kept. To rebuild and publish: `python3 -m jazzmine.joint_store`, then `python3 -m jazzmine.static_export`.

**Current catalog** (27 October 2026, similarity ≥ 0.8):

| Measure | Count |
| --- | ---: |
| Passages in the static catalog | 215,084 |
| Crate results (different compositions) | 213,870 |
| Source solos represented | 456 |

The endpoint change increased the catalog because qualifying prefixes survive a poorer continuation. The 50% overlap threshold remains a judgement call and has not been tuned against listener labels.

**Still open.**
- About 1,500 pairs of kept windows overlap by 25-50% on both solos. Nearly all sit on different diagonals (a different alignment of a repeated motif), so they are treated as distinct passages. Only a few dozen share a diagonal.
- Alternate takes of one tune by the same performer (for example two "The Oracle" solos) are separate solos and can each match the same other solo at the same notes. About 140 such take pairs exist; they are different recordings and are not merged.
- The 50% threshold is a judgement call, not tuned against labels.

## Limitations

- **Common seeds are skipped.** A phrase built only from seeds seen more than 80 times is never found.
- **Exact core required.** Every match starts from 5 identical intervals (6 notes) and ends up at least 8 paired notes long. Shorter motifs, and heavily reworked quotations, are out of scope.
- **Pitch creates candidates; rhythm does not.** Octave displacement and contour-preserving variants with different interval sizes are not matched.
- **Rightward extension only.** The alignment starts at the seed and grows right, so a passage may begin a few notes after its true start; neighbouring seeds are merged by the clean-up above.
- **Different solos only.** A phrase repeated inside one solo is not reported, though the same performer across two solos is.
- **Single collection.** Only WJazzD (456 solos) is in the site. DTL1000 and the Jazz Trio Database pilot are prepared but not included (below).
- **Scoring is a heuristic** with hand-set weights, not calibrated against expert labels.
- **Recording links are approximate.** Timestamps are interpolated from JazzTube's solo alignment and rounded down to the second; a particular upload may need manual correction, and 114,813 of the 430,168 passage sides in the current catalog have no matched video.
- **Everything loads in the browser.** The compact index is about 5.4 MB compressed; passage details and notes are fetched on demand, while filtering and graph calculations run in a Web Worker.

## Other collections

### DTL1000 note tracks

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

## Boundaries

The first release searches WJazzD solo transcriptions, not every song a soloist might quote. Candidate matches can reflect common jazz vocabulary, a shared composition, or chance. See the limitations above: the search skips very common seeds and its variant matcher is anchored on exact runs of four or five intervals, so it can miss heavily transformed quotations. Dates are presented as recorded by WJazzD; they do not establish influence or authorship. Media links require manual performance verification.

The suggested [Jazz-Ml-Dataset](https://github.com/SaiKayala/Jazz-Ml-Dataset) is a collection of song MIDI files and a derived note CSV, with many full arrangements and non-jazz songs. Its files do not identify real solo performances or their audio timestamps. We inspected the archive: only 84 labeled melody tracks were nearly monophonic by a basic overlap check, often with doubled parts. It is a possible future **composition melody reference** after tune identity and duplicate checks, but it is not interchangeable with the WJazzD solo corpus and has not been added to the quotation ranking.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the research rationale and future audio/reference-corpus phases.

## Data and attribution

WJazzD is published by the Jazzomat Research Project under the Open Database License (ODbL) 1.0, with individual contents under the Database Contents License. The static catalog is a derived database and is offered under the same ODbL terms with the required attribution; see [static/DATA_LICENSE.txt](static/DATA_LICENSE.txt), which is also linked from the site footer. Third-party material (album covers, YouTube videos, portraits) is not covered by that licence.

See the [official download and license page](https://jazzomat.hfm-weimar.de/download/download.html), the [schema](https://jazzomat.hfm-weimar.de/dbformat/dbformat.html), and the citation requested by the project: Pfleiderer, Frieler, Abeßer, Zaddach & Burkhart (eds.), *Inside the Jazzomat: New Perspectives for Jazz Research* (2017).
