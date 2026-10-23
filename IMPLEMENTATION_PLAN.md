# Jazz solo motif reuse: implementation plan

## 1. Purpose and claims

Build a reproducible system that **finds and ranks candidate passages reused between transcribed jazz solos**, then gives a researcher enough evidence to listen and decide what the relationship is. The first release searches the 456 solos in the Weimar Jazz Database (WJazzD) v2.1. It does not infer a musician's intent, prove influence, or identify quotations of tunes absent from the reference corpus.

Use these labels throughout the product:

- **Exact melodic reuse:** a contiguous interval sequence recurs, possibly transposed.
- **Variant reuse:** a strongly similar sequence with limited note edits and/or rhythmic variation.
- **Shared vocabulary / composition-related:** recurrence plausibly explained by a common idiom, tune, harmonic setting, or repeated take.
- **Possible quotation:** a human reviewer recognizes a specific referenced melody and records the evidence.
- **Uncertain / rejected:** insufficient evidence or a bad match.

Treat every machine output as a **candidate**, never as a confirmed quotation, self-citation, or percentage probability of intentional reuse. Date order can identify the earlier *recording in this corpus* where dates are reliable; it cannot establish who originated a motif.

## 2. Findings that change the draft specification

1. **Use the released database schema.** The note table is `melody`, not `note_info`. `melody.onset` and `beats.onset` are already in seconds relative to the solo excerpt. `transcription_info.solostart_sec` supplies the solo's offset in its source track. `solo_info`, `track_info`, `record_info`, `sections`, and `transcription_info` carry the needed context. The `recordingdate` field exists but has mixed formats and uncertainty.
2. **The first corpus is modest, not “large-scale” in the engineering sense.** The official release has 456 solos. Inspection of the released SQLite file found 200,809 note events, 78 performers, and 344 tracks. This supports a simple local, auditable search before adding vector infrastructure.
3. **Reuse existing research as a baseline.** Jazzomat's `melpat` already supports interval-pattern mining, occurrence filtering, and scale/arpeggio filters. The Dig That Lick work used it to build a pattern explorer over this corpus. Reproduce a small baseline with it, then document what the new system improves: paired evidence, variant matching, calibrated ranking, and verified links.
4. **YouTube matching is a separate evidence problem.** A MusicBrainz identifier identifies a catalog entity, not a YouTube video or a synchronized audio master. A title match cannot justify a timestamp. Every external recording needs an explicit link to the *same performance*, plus a checked time offset or alignment.
5. **Audio chroma is not the primary matcher for short jazz solos.** Polyphonic accompaniment can dominate pitch-class features and obscure a brief improvised line. Reserve audio analysis for a gated extension or for aligning a verified recording to the transcription. Licensed or otherwise authorized audio access is a prerequisite.
6. **The illustrative Miles Davis scores and links in the original draft are unverified examples.** Remove them from any scientific output and generate examples only from reviewed detections.

## 3. Scope and deliverables

### First release

Search all pairs of WJazzD solo passages; group results into the same-performer, cross-performer, same-composition, and distinct-composition views. Provide:

- Exact and near-exact transposition-invariant matching, with note-level alignment and separate pitch/rhythm evidence.
- A ranked review queue with both solo identifiers, performer, track, recording date as recorded, instrument, tune, matched notes, phrase/chord context, and score components.
- Source-track times calculated from WJazzD, and external listening links only when the recording and alignment have been verified.
- Reviewer labels, comments, provenance, and export to CSV/JSON/Markdown.
- Reproducible evaluation against an expert-reviewed sample.

### Outside the first release

Audio-only discovery, automated intent classification, exhaustive detection of quotes from standards or songs outside WJazzD, and a public production service. Each needs new source material or a separate validation study.

## 4. Architecture

Use a small Python package with an immutable copy of the source WJazzD SQLite file and a separate derived SQLite database for indexes, candidates, media mappings, and reviews. Keep the original database version and checksum in every run. Use batch commands for import, exact search, variant search, ranking, and export; add a lightweight local review interface once the candidate format is stable. A single machine should be sufficient for the first corpus. Add PostgreSQL, FAISS, or distributed workers only after a measured workload requires them.

Core records:

| Record | Essential fields |
| --- | --- |
| `solo` | WJazzD `melid`, `trackid`, performer, instrument, composition, raw recording date and parsed date range, `solostart_sec`, source version |
| `note` | `melid`, ordered `eventid`, pitch, relative onset/duration, beat/phrase/chord context |
| `occurrence` | Solo, first/last note IDs, note count, solo-relative start/end, track-relative start/end |
| `candidate` | Two occurrences, transposition, exact/variant method, alignment path, component scores, deduplication group, pipeline version |
| `media_link` | Track, platform/ID, edition/performance verification status, transform between source-track and media time, reviewer, evidence |
| `review` | Candidate ID, label, confidence, notes, reviewer, timestamp, adjudication state |

Keep machine candidates and human decisions as separate records. Persist parameter settings and software/data versions so scores can be reproduced.

## 5. Data ingestion and time model

1. Download the official WJazzD SQLite release; record URL, version, checksum, and `db_info.license`. Respect its ODbL/database-contents terms, include the requested academic citation, and assess redistribution obligations before publishing a derived dataset.
2. Read only `melody_type.type = 'SOLO'` entries. Join notes and context by `melid`; retain source `eventid` and sorted order. Confirm note onsets and beat grids are monotonic; report missing metadata, unusual pitches/durations, duplicated IDs, and conflicting joins. Keep raw values rather than silently repairing them.
3. Parse `track_info.recordingdate` into an optional date **range** and precision flag. Preserve the original text: the release contains exact dates, years, and ranges. Do not substitute release date for recording date.
4. Define `t_track = transcription_info.solostart_sec + melody.onset`. WJazzD's note onset is solo-relative. A media link requires a checked mapping `t_media = a × t_track + b`, where `b` covers intros/edits and `a` covers a measured speed difference. Use `a = 1` unless evidence says otherwise. Store two listening anchors when possible; otherwise mark time confidence as low. Start links a few seconds before the note.
5. Handle multiple solos from one track and repeated issues/takes explicitly. Never equate the same composition with the same recording.

**Ingestion acceptance:** all 456 solos and their ordered note events are importable; every matched note maps back to a WJazzD `eventid` and solo-relative onset; validation reports any exception rather than losing it.

## 6. Retrieval and ranking

### 6.1 Exact candidate generation

Represent each note sequence with signed successive pitch intervals, retaining the original pitches. An interval window of length `k` corresponds to `k + 1` notes. Start with configurable seeds of 5–7 intervals, index them in an inverted map from interval tuple to `(melid, start_note_index)`, and compare occurrences in distinct solos. Merge overlapping seed hits and extend both sides to the maximal exact interval match. Remove symmetric duplicates, contained matches, and many-to-many overlaps that represent one passage pair. Keep same-track and same-composition results, but put them in separate strata.

Use raw MIDI semitone intervals for the primary channel. If the source contains microtonal or transcription variants in future releases, introduce a separately versioned quantization policy; never mix raw and quantized values in one index.

### 6.2 Variant candidate generation

Run a constrained local alignment only around exact seed hits or another measured high-recall shortlist. Allow a small number of interval substitutions and insertions/deletions, with an explicit gap penalty and bounds on total edits, note span, and pitch contour. Require enough aligned notes and a minimum coverage on both sides so a common three-note cell does not expand into a spurious long match. Keep the full alignment path for inspection.

Use **inter-onset intervals** in beats as the main rhythmic comparison, because note spacing is more stable than performed note duration. Interpolate from the supplied beat grid, normalize locally, and compare with tolerance for swing and expressive timing. Treat note duration and metrical placement as supporting evidence, not hard identity constraints. Permit phrase-boundary crossing but mark it and optionally penalize it. Keep pitch-only and pitch-plus-rhythm result sets for ablation.

### 6.3 Distinctiveness and rank

Compute document frequency by **solo** for short interval seeds, with additional counts by performer, composition, and style. Penalize motifs that are common across many independent solos, plain scalar/arpeggiated runs, and candidate pairs from the same track or same composition. Do not use raw TF–IDF as the sole score: long exact n-grams are almost all rare, and rarity by itself does not imply a quote.

Rank using a transparent feature table: aligned note count, edit/gap cost, pitch interval agreement, rhythm agreement, phrase coverage, corpus prevalence, and contextual flags. Fit weights only after labels exist. Until then use an explicitly named **heuristic rank**, not a “96.4% match probability.” To estimate how surprising a pattern is, compare against controls matched for solo length, performer/style, and local interval statistics (for example, constrained shuffles or first-order Markov surrogates). Report the control method and uncertainty.

## 7. Recording and listening workflow

1. Use WJazzD track metadata and MusicBrainz IDs to disambiguate performer, session, take, release, and track; cache responses, identify the client, and keep below MusicBrainz's one-request-per-second limit.
2. Build a small curated `media_link` table for high-ranked candidates first. A reviewer must confirm the external item is the same performance and choose one or more anchor events. Automated search may propose videos, but it must not publish links before this check. Keep unavailable/unmatched as a valid state.
3. Calculate links only from a verified mapping. Store the raw WJazzD track time, transformed media time, offset/scale, and a confidence grade. Recheck links periodically because videos can disappear or be replaced.
4. The review interface should play A and B from a few seconds before the matched onset, show the aligned notes and context, and let a researcher mark “same performance,” “correct timestamp,” and the musical relationship independently.

If authorized audio files are available, test lightweight audio alignment on a small set of confirmed recordings to estimate `a` and `b`. Use audio-to-audio motif search only after the symbolic system has a reliable benchmark and the audio rights/source issue is settled. Treat chroma/Sub-DTW as experiments to compare, not guaranteed production components.

## 8. Evaluation and decision gates

Create a blinded, stratified review set covering same performer and cross performer, same and different compositions, several match lengths, styles, dates, high/medium/low scores, and hard negatives. Have two musically qualified reviewers label independently; adjudicate disagreements and retain the raw votes. Define “musically meaningful reuse” separately from “quotation” and “evidence of influence.” A positive example from a known analysis is useful, but do not treat it as exhaustive ground truth.

Measure:

- **Precision at review budget** (top 20/50/100), separately by result stratum and label type.
- **Retrieval sensitivity** on planted transposed and lightly edited passages, plus any externally documented examples. Call this synthetic/known-example recall, not corpus-wide recall.
- **Reviewer agreement** and error categories; inspect whether disagreements reflect ambiguous music rather than a retrieval bug.
- **Candidate yield and diversity:** reviewed positives per hour, unique solo pairs/performers, and duplicate rate.
- **Time-link accuracy:** absolute error at checked anchors and fraction of top candidates with verified listening links.
- **Runtime and reproducibility:** index/search time, memory, identical output from the same source version and parameters.

Proposed pilot gates, to revise after a first label round: at least 80% of the top 50 *distinct-composition* candidates judged musically meaningful after adjudication; at least 90% retrieval of planted 8–12-note transposed/one-edit examples; at least 90% of verified media links within 3 seconds of the intended passage; and no unverified media links shown as verified. These are project targets, not claims about present performance. If the first gate fails, improve ranking and controls before expanding to audio or more infrastructure.

Split evaluation by recording/performer groups when tuning weights so near-duplicate takes and common artist vocabulary do not leak into both tuning and held-out review sets. Publish the label definitions, sample construction, thresholds, and failure cases with results.

## 9. Implementation sequence

| Phase | Work | Reviewable result / gate |
| --- | --- | --- |
| 0 — Data and baseline | Freeze WJazzD version; inspect schema/license; reproduce `melpat` examples; generate corpus quality report. | Source manifest, data validation report, small baseline candidate file. |
| 1 — Exact symbolic search | Build loader, interval index, maximal-match extension, deduplication, separate result strata, and note/time provenance. | Deterministic CLI export; hand-inspect 20 results and trace every note/time to WJazzD. |
| 2 — Variant and ranking | Add bounded local alignment, beat-based rhythm, prevalence/context features, and heuristic ranking. | Pitch-only versus pitch-plus-rhythm comparison; compact review queue. |
| 3 — Human evaluation | Label stratified sample, adjudicate, tune on development groups, and freeze a held-out test. | Evaluation report with precision, known-example sensitivity, reviewer agreement, and error analysis. |
| 4 — Listening links and interface | Curate same-performance media mappings and anchors; add local review UI and exports. | Verified two-sided links for a prioritized set; timestamp error report. |
| 5 — Expansion decision | Compare remaining false negatives and research value against cost of new reference melodies or authorized audio. | Written go/no-go decision for external quote corpus and audio experiments. |

Keep each phase independently useful. Do not make YouTube availability, Discogs access, or an audio corpus a prerequisite for symbolic retrieval.

## 10. Main risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Common jazz vocabulary overwhelms distinctive matches | Separate same-composition/track results; prevalence counts; musical-form controls; expert labels and ranking evaluation. |
| A similar phrase is mislabeled as intentional quotation or influence | Candidate-only machine language; reviewer evidence fields; uncertain labels; no causal claim from dates. |
| WJazzD covers solos but not every quoted theme | State corpus boundaries; add licensed/curated reference melodies as a separate future source. |
| Metadata dates or recording identities are ambiguous | Preserve raw values and precision; verify take/edition; avoid a forced chronology. |
| Video audio begins at a different time or uses a different edit | Verify performance and anchor mapping; suppress unverified deep links. |
| Research output or media use creates rights issues | Track source and license; link to external media instead of copying it; assess redistribution and audio access before publication. |

## References checked for this plan

- [WJazzD official download and license](https://jazzomat.hfm-weimar.de/download/download.html)
- [WJazzD database schema](https://jazzomat.hfm-weimar.de/dbformat/dbformat.html)
- [Jazzomat `melpat` pattern mining documentation](https://jazzomat.hfm-weimar.de/commandline_tools/melpat/melpat.html)
- [Frieler et al., *Two Web Applications for Exploring Melodic Patterns in Jazz Solos* (ISMIR 2018)](https://archives.ismir.net/ismir2018/paper/000177.pdf)
- [MusicBrainz API guidance](https://musicbrainz.org/doc/MusicBrainz_API)
- [YouTube Data API overview](https://developers.google.com/youtube/data/getting-started)
