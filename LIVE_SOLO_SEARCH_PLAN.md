# Listen & Find: implementation and verification plan

Prepared 27 October 2026. Status: implementation specification, not an implemented feature.
Target branch: `codex/live-solo-search`. Do not implement this feature on `main`.

## 1. Outcome and scope

A visitor opens Listen & Find, allows microphone access, plays a single melodic
instrument, and receives ranked, playable passages from WJazzD. Transposition and
moderate tempo changes should preserve retrieval. A result is a musical similarity
suggestion, not proof of quotation or a probability of identification.

Deliver in two independently testable milestones on the same feature branch:

1. **M1, record and search:** record 5–15 seconds, stop, transcribe, search, inspect
   the top five matches. Also accept an audio file and provide bundled examples.
2. **M2, continuous listening:** while recording, search successive overlapping
   windows, update stable suggestions, and stop cleanly on demand. M2 is required
   for the complete live feature; M1 alone must be described as a preview.

Initial supported input: one exposed melodic instrument, with saxophone and
trumpet as the primary evaluation targets. Humming, guitar and single-note piano
are exploratory until separately evaluated. Accompanied recordings, automatic
instrument separation, polyphonic piano reduction, automatic tune identification,
and server inference are outside this branch's release scope.

All audio processing and search run locally. Keep GitHub Pages deployment. No
account, upload endpoint, API key, or external model CDN is needed at runtime.
Do not train a model in this project. No MIDI file is required internally; provide
an optional MIDI download for inspection, alongside JSON note export.

## 2. Repository facts and integration boundaries

- `jazzmine/corpus.py`: `Solo` contains MIDI pitches, onsets/durations in seconds,
  beat positions and metadata. `load_corpus()` is the WJazzD source loader.
- `jazzmine/joint_search.py`: existing pair miner uses exact five-interval anchors
  and beat-based rhythm costs. Preserve its behavior and published scores.
- `jazzmine/static_export.py`: exports passage pairs and notes for the `used` solo
  set. Do not use the pair catalog as the new feature's search space.
- `static/search-worker.js` and `static/catalog.js`: filter the existing catalog;
  they do not search arbitrary note queries. Keep new search in a separate worker.
- `static/app.js`: owns dialogs, score rendering and synthesized note playback.
  Extract small shared rendering/playback helpers if needed; avoid a framework
  migration or a broad rewrite.
- `static/index.html`, styles and `.impeccable.md`: preserve the paper-and-ink
  visual language, keyboard navigation, reduced motion and narrow-screen layout.
- `browser-tests/release-smoke.spec.js` and `playwright.config.js`: existing
  Chromium browser gate. Keep these tests and extend coverage separately.
- `.github/workflows/pages.yml`: currently validates and publishes main. Add
  branch/PR validation without enabling feature-branch production deployment.

Export **all WJazzD solos directly from the source**, even a solo with no existing
pair result. Derive counts from the source; the current expected reference is 456
solos / 200,809 notes. Pin the source checksum in the generated manifest and test
report. Do not silently include the JTD pilot or incomplete DTL material.

## 3. Agent execution contract

1. Read applicable `AGENTS.md`, `RTK.md` and this document. Use `rtk` for shell
   commands. Inspect the worktree and preserve unrelated changes.
2. Record base commit and source checksum. Create/switch to
   `codex/live-solo-search`, or reuse it if it already contains this work. Never
   reset an existing branch to make the plan fit.
3. Finish the technical spike in section 4 before committing to a model/backend.
4. Implement stages in section 11 in dependency order. Parallel agents may own
   non-overlapping modules only after shared schemas and fixtures are committed.
   One integration agent owns `app.js`, package scripts and CI to avoid conflicts.
5. Every stage produces working code, tests, and a short evidence entry in
   `docs/listen/IMPLEMENTATION_LOG.md`. Record commands, outcomes and limitations;
   never label a mocked transcription test as a real-model test.
6. A missing dataset, browser or device is a visible missing gate, not a pass.
   Do not weaken a threshold, remove failing fixtures or substitute synthetic
   audio for real recordings to claim completion.
7. Keep the branch reviewable. Do not merge or deploy production as part of this
   plan. End with the branch, commit, test report, preview URL and manual checklist.

Proposed ownership if multiple agents are used: A = exporter and validation;
B = audio/model adapter; C = retrieval and benchmarks; integration agent = UI,
continuous scheduling, browser tests and CI. A/B/C share the frozen contracts below.

## 4. Mandatory technical spike and decision gate

Start with Spotify Basic Pitch's TypeScript implementation. Its documented API
includes `BasicPitch.evaluateModel`, `outputToNotesPoly` and `noteFramesToTime`.
It produces timed notes and works best on one instrument at a time. Its upstream
README is not a browser latency or saxophone-accuracy guarantee.

References checked for this plan:

- https://github.com/spotify/basic-pitch-ts
- https://github.com/spotify/basic-pitch-ts/blob/main/src/inference.ts
- https://github.com/spotify/basic-pitch-ts/blob/main/src/toMidi.ts
- Alternative monophonic benchmark: https://github.com/maxrmorrison/torchcrepe

Spike deliverable: `docs/listen/MODEL_SPIKE.md`, runnable browser harness, and the
first real-inference test. Verify all of the following before implementing UI:

- Select and lock an actual published package version; do not pin upstream's
  `0.0.0-development` placeholder. Record model origin, license, SHA-256, runtime
  dependencies, compressed asset sizes and build command.
- Load model assets from the site's own relative base path, including under
  `/stolen-moments/`. Copy required licenses and notices.
- Prove execution inside a dedicated Worker with transferable mono PCM. The
  library may expect an AudioBuffer-like input: inspect the pinned implementation
  and adapt its required interface explicitly. Do not assume browser AudioBuffer
  is transferable or available in workers.
- Benchmark available TensorFlow.js worker backends. Prefer a tested WASM backend
  with locally served binaries; use another backend only with recorded support
  evidence. Prove operation without cross-origin isolation on a plain static
  server. No main-thread inference fallback that freezes the UI.
- Measure model load, first inference, warmed inference, memory behavior and
  transcription on the same 5-, 10- and 15-second clips.
- Test desktop Chromium, Firefox and WebKit. Playwright WebKit is not a substitute
  for the later physical Safari microphone test.
- Verify model output units, confidence/activation semantics, sample-rate
  expectations, padding behavior and cancellation by worker termination.

If this path cannot meet M1 gates, document the measured blocker and compare a
second browser-compatible approach. Do not quietly introduce a server. If M1
passes but rolling inference cannot meet M2 budgets, deliver M1 as preview and
record M2 as incomplete with the measured latency; do not call it fully live.

## 5. Files and contracts

Proposed new files; minor renames are allowed if the log maps them explicitly:

| Path | Responsibility |
| --- | --- |
| `jazzmine/listen_export.py` | Dedicated complete-corpus export; reuse recording-link logic |
| `jazzmine/listen_validate.py` | Offline schema, bounds, checksum and asset validation |
| `static/listen/listen.js` | Controller and explicit UI state machine |
| `static/listen/listen.css` | Feature styles |
| `static/listen/audio-capture.js` | Permission, AudioContext, capture lifecycle |
| `static/listen/pcm-worklet.js` | AudioWorklet PCM batching, no inference |
| `static/listen/transcription-worker.js` | Model load, PCM inference and timed notes |
| `static/listen/note-normalize.mjs` | Pure note filtering and query validation |
| `static/listen/retrieval.mjs` | Pure candidate generation/alignment/ranking |
| `static/listen/retrieval-worker.js` | Corpus ownership and cancellable search jobs |
| `static/listen/contracts.mjs` | Schema guards, version constants, default settings |
| `static/listen/assets/` | Built runtime, model weights and license notices |
| `static/catalog/listen/` | Manifest and complete-corpus data |
| `tests/listen/`, `tests-js/listen/` | Python and JS tests plus test-only fixtures |
| `browser-tests/listen-*.spec.js` | Browser integration, model and live tests |
| `static/listen/examples/` | Three small, licensed public demo clips and manifest |
| `docs/listen/` | Spike, evaluation, browser checklist and implementation log |

Keep runtime source small and separable from generated vendor bundles. Introduce
a narrowly scoped pinned bundler for the model integration if required; existing
static pages must still run without a development server. Commit generated assets
according to the existing static-hosting convention and verify reproducible builds.

### Corpus format, version 1

`manifest.json`: `schemaVersion`, `algorithmVersion`, `sourceSha256`, `soloCount`,
`noteCount`, ordered shard entries (`path`, `sha256`, `bytes`, `soloCount`,
`noteCount`), model asset metadata and settings version. Hash stored file bytes.
Use deterministic gzip (fixed timestamp) and stable ordering.

Each shard contains complete solos; never split a solo between shards. Target
about 25,000 notes per shard, finishing the last solo even if that exceeds target.
Each solo has `id`, metadata, `pitches`, `onsetsSeconds`, `durationsSeconds`,
`beatPositions`, `recordingTimes` and recording-link metadata. Parallel arrays
have identical lengths. `recordingTimes[i]` is the existing `recording(...)` helper's
resolved source-video time for that note, or null. Preserve verified/aligned/
estimated/candidate labels; null timing must not turn into an invented timestamp.
This explicit per-note timing avoids assuming a constant video offset.
Render the returned corpus slice with onset/duration values relative to its first
note; keep source-relative times separately for recording links. Never play the
leading silence from the beginning of the whole solo.

### Query format, version 1

```json
{
  "schemaVersion": 1,
  "requestId": 17,
  "source": "microphone",
  "audioDurationSeconds": 10.0,
  "notes": [
    {"pitch": 60, "onsetSeconds": 0.0, "durationSeconds": 0.24, "confidence": 0.8}
  ]
}
```

The example shows structure only; one note is not a valid search. Confidence is
nullable and is not a calibrated probability. Require finite numbers, integer
pitch 0–127, nonnegative increasing onset times and positive durations within the
captured buffer (allow at most one sample of rounding). Query range: 8–64 notes.
M1 selects the latest 64 if a longer phrase is transcribed, with a visible message;
M2 always uses the latest eligible phrase window. Preserve original note indices
when trimming so highlighting and debug exports remain correct.

Store real onset seconds. Do not insert fake beat annotations into a live query.
If existing score rendering requires beats, use a separate display-only tempo
estimate and label the score approximate; it must not contaminate retrieval data.

### Worker protocol

Messages: `{type, requestId, sessionId, payload}`. Replies:
`{type: 'progress'|'result'|'error', requestId, sessionId, payload}`.
Validate both directions. Transcription request payload holds mono Float32 PCM
and sample rate. Transfer a copy if the capture buffer must remain reusable.
Search replies include `algorithmVersion`, timings, query note count and results.

Each result: `soloId`, zero-based inclusive `startNote`/`endNote`, alignment pairs
`[queryIndex, corpusIndex]` with `-1` for gaps, heuristic `score` in [0,1],
`pairedNotes`, `queryCoverage`, `transpositionSemitones` (corpus minus query),
`tempoScale` (corpus seconds / query seconds), and recording link/provenance.
Do not invent a pair-catalog ID for a live result.

Older request/session replies never update the UI. Cancel terminates model work
if cooperative cancellation is unavailable. A replacement worker reloads safely.
Corpus worker checks cancellation between solos and yields to its event loop.

## 6. Audio capture, transcription and lifecycle

Request microphone only after a user action, over HTTPS or localhost. Ask for
mono input and disable echo cancellation, noise suppression and automatic gain
where supported; these are preferences, not required constraints. Show the
actual capture failure in friendly language, with retry and file-upload options.

Use AudioWorklet PCM capture rather than depending on MediaRecorder codecs.
Batch roughly 100 ms per message, downmix to mono, preserve actual sample rate,
and resample with an anti-aliasing implementation to the model's verified rate.
Never relabel a 48 kHz buffer as 22.05 kHz. No audible input monitoring by default.

M1: minimum accepted clip 2 seconds, recommended 5–15 seconds, hard maximum 20
seconds, automatic stop at the limit. File size maximum 20 MiB; check before
decode. Reject decoded files over 20 seconds rather than silently truncating.
WAV is the guaranteed test format; other formats depend on successful browser
decode, with a clear unsupported-file message.

Preflight silence: if peak < 0.003 and RMS < 0.001, show “No clear sound detected”
without inference. These are initial tunable constants; test quiet instrument
examples to avoid accidentally rejecting valid audio. Clipping above 1% of samples
at |sample| >= 0.99 shows a warning without automatic rejection.

Note postprocessing defaults: retain model-native onset boundaries; filter notes
shorter than 50 ms; use the pinned model's documented decoder thresholds, recorded
in settings; discard nonfinite and out-of-range events. Preserve repeated notes
with separate attacks. Do not merge all repeated pitches or quantize rhythms.
For overlapping note hypotheses, select the strongest activation at near-equal
onsets (within 30 ms), with deterministic tie-breaking by lower pitch; clamp a
note's end to the next accepted onset. If sustained polyphony remains substantial
(overlap > 20% of voiced time before reduction), show “Try one instrument at a
time.” Report raw and retained event counts in debug exports.

Bends/vibrato map to the model's discrete note pitch for matching; retain bend
data only for optional MIDI export if supported. Do not split one held vibrato
note into many semitone events. Instrument-specific quality gates decide whether
this default postprocessing is adequate.

Stopping, cancelling, closing the dialog, navigating away or hiding the page
stops every MediaStreamTrack, disconnects worklet nodes, closes the capture context,
clears timers, and invalidates the session. Late permission resolution must stop
newly obtained tracks if its session was cancelled while the prompt was open.
M1 Stop keeps the captured buffer only for the pending search. Clear removes
audio, notes, object URLs and results. Never persist microphone data to storage.

Use one playback controller so query playback, result playback and existing
archive playback cannot overlap. Recording stops playback first.

## 7. Retrieval baseline: precise, independent of the pair miner

Implement and benchmark a deterministic two-stage baseline. It searches all
solos; it does not require any exact five-interval seed. No embedding service.
The rules below are starting parameters, frozen before held-out evaluation.

### A. Candidate retrieval

For query and corpus, form consecutive semitone intervals. For each solo run
subsequence edit-distance DP, with query intervals as rows and corpus intervals
as columns. Initialize `D[0,j]=0`, `D[i,0]=i`. Substitution cost:
`min(abs(queryInterval - corpusInterval) / 3, 1)`; insertion/deletion cost 0.8.
Recurrence is the minimum of diagonal+substitution, above+deletion and
left+insertion. Never cross solo boundaries. Track traceback/start positions.

Rank endpoints by `D[m,j]/m`; deterministic ties: smaller solo ID, then earlier
start and end. Convert interval spans to enclosing note spans. Retain the best
200 nonredundant candidates globally: suppress candidates from the same solo
whose note ranges overlap by >=80% of the shorter range. Require candidate spans
between 0.5 and 1.5 times query note count. Expand by two notes on either side,
clamped to solo bounds, for reranking. Use typed arrays and bounded traceback
storage per solo. Deduplication must not erase distinct non-overlapping repeats.

### B. Pitch-and-time reranking

For each candidate, derive the three most frequent pitch differences from the
coarse matched-note pairs; ties prefer smaller absolute shift, then signed value.
These are trial transpositions. Estimate initial seconds scale as the median of
positive corpus/query onset-gap ratios between coarse matched pairs. Try that
scale multiplied by `[0.8, 0.9, 1.0, 1.1, 1.25]`. If no valid ratio exists, use
candidate/query median inter-onset interval ratio. Reject invalid/nonpositive
scale values, not the whole job.

For each hypothesis run a bounded monotone alignment over notes. States retain
the previous paired indices so timing uses the distance between matched notes,
including across skips. Paired cost is:

- 0.65 * `min(abs(queryPitch + shift - corpusPitch)/2, 1)`;
- 0.25 * `min(abs(log2(corpusGap/(queryGap*scale)))/1, 1)`;
- 0.10 * `min(abs(log2(corpusDuration/(queryDuration*scale)))/1, 1)`.

The first pair has timing cost zero. Clamp time values to >=0.02 seconds for
division/logarithms. Skipped query or corpus note costs 0.8. Allow at most two
consecutive skipped notes on either side; retain previous-match state in the DP
key so paths with different timing histories are not incorrectly merged. Corpus
prefix/suffix are free; unmatched query notes, including query prefix/suffix,
are penalized. Count those query gaps in coverage and score.

Select lowest total cost per query note, breaking ties by more pairs, then fewer
gaps, then earlier start. `score = max(0, 1 - totalCost/queryNoteCount)`. Initial
eligibility: >=8 paired notes, >=75% query coverage, score >=0.70. These are new
listen-search scores; do not reuse the archive's 80% label or call them confidence.
Rank eligible results by score, paired notes, solo ID, start. Suppress overlapping
results at >=50% of the shorter span within the same solo; return at most five.
If no eligible result, show “No convincing match found.”

Save all thresholds in one versioned settings object. Changes require a new
algorithm/settings version and a benchmark comparison. Use validation data for
tuning, then freeze settings before testing the held-out set.

This is approximate retrieval: the coarse cap can miss the global best result.
Measure candidate recall separately. If recall/performance fails, optimize or
replace the candidate stage with documented evidence; do not market exact nearest
neighbor search. Unit-test reranking against exhaustive enumeration on tiny
sequences to verify the state pruning/DP implementation independently.

## 8. UI and continuous listening

Add a clearly labeled Listen & Find entry point. A dedicated dialog contains:
Record a phrase, Listen continuously, Upload audio, Try an example; a level meter,
elapsed time, Stop/Cancel, status text, detected-note preview, and result list.
Explain before recording: “Play one instrument. Audio stays in your browser.”
Lazy-load model/corpus only when needed, not on the ordinary archive landing page.

Explicit states: idle -> loading -> requesting-permission -> recording ->
transcribing -> searching -> results/empty/error. File and example routes skip
permission. Cancellation from every active state returns to idle. Continuous
mode has a separate recording flag while inference/search status changes; it
must not disable Stop while a worker is busy.

Each result shows musician, title, passage time, matched-note count, transposition,
and “Similarity” (never probability). Include Play my phrase, Play database phrase,
Compare notes, and source recording link when available. Query synthesis is
explicitly the detected notes; optional original-capture playback is separately
labeled. Match passages can be outside any existing archive pair.

Diagnostics behind `?listenDebug=1`: model/settings versions, timing breakdown,
note count, backend, candidate count, current session/request ID, JSON download
and MIDI download. Never expose debug injection on production merely because this
parameter is present; test dependency injection belongs to a test harness.

### M2 scheduling

- Ring buffer holds latest 15 seconds. Start inference after 5 seconds, then
  attempt a new window every 3 seconds. Window duration grows to 15 seconds.
- At most one inference/search chain in flight. Coalesce pending requests to the
  newest window; never queue every tick. Skip unchanged/silent windows.
- Keep capture active while inference executes. Include window start/end sample
  offsets and session ID, so result age and note timestamps are correct.
- Show “Listening — gathering a phrase” until at least eight notes are available.
- A top suggestion becomes stable after two consecutive completed windows report
  the same solo and overlapping matched passage (>=50% shorter-span overlap).
  Other results can be displayed as provisional. Clear stable suggestions after
  10 seconds without supporting eligible results; show “Previous match” while
  waiting rather than presenting an old result as current.
- Stop immediately ends capture, invalidates pending jobs and keeps the latest
  displayed results. Search the final window only through an explicit action.
- Hidden tab pauses/stops capture with a visible explanation on return. Do not
  auto-resume the microphone. Hard session limit: 5 minutes with a restart button.

## 9. Test data and measurable acceptance gates

Maintain a fixture manifest with ID, origin/license, SHA-256, sample rate, length,
instrument, ground-truth notes, expected solo/range or negative classification,
and split (`development`, `validation`, `held-out`). Never add copyrighted source
recordings without redistribution permission. Human-performed test phrases must
have documented permission; local-only fixtures cannot stand in for public CI.

Dataset layers:

1. **Symbolic:** 60 deterministic corpus excerpts, 8–32 notes, spread over >=20
   solos. Store the selection seed and positions. Include all declared equivalent
   occurrences if a phrase repeats, rather than marking a musically identical
   occurrence wrong. Use separate hand-authored tiny corpora for exact DP tests.
2. **Synthetic audio:** at least 24 reproducibly generated clips from those notes,
   with two distinct timbres, varied tempo/register, silence and noise variants.
   Run through the real model. Synthetic success is an integration gate only.
3. **Real audio:** 40 permission-cleared monophonic sax/trumpet performances of
   known corpus phrases, 10 per instrument for validation and 10 per instrument
   held out. Include two performers or recording setups per instrument, articulated
   repeats, vibrato, rests, fast passages and quieter attacks. Reference notes
   describe the actual performance, not just the target transcription.
4. **Negatives:** >=20 silence/noise/speech/chordal or unrelated-melody clips,
   separated by type in reports. Confirm unrelated symbolic melodies have no
   eligible match under the reference matcher before labeling false positives.
5. **Public examples:** one clear positive, one transposed/slower version, one
   silence/noise negative. They use the actual transcription/search path, with
   expected result metadata stored only in the test/demo manifest.

Match correctness: an allowed solo ID and returned interval overlaps >=50% of
the annotated target interval. Also report onset error; broad windows must not
game overlap. Gate median start error <=3 notes on correct positives.

| Gate | Required result |
| --- | --- |
| Clean symbolic excerpts | 100% expected occurrence in top five |
| Pure transposition (-12,-5,+7,+12) and tempo (0.75,1.25,1.5) | Same correctness as unmodified query |
| Symbolic corruption: separately 10% deleted notes, added notes, or +/-1 semitone errors | >=90% recall@5, with seed and denominator reported |
| Candidate stage | >=98% recall@200 on clean/transformed symbolic queries |
| Synthetic real-model positives | >=90% recall@5 |
| Held-out real sax/trumpet | >=80% recall@5 overall and >=70% for each instrument |
| Silence/noise subset | Zero convincing matches |
| All validated negative clips | <=10% convincing matches, counts broken down by type |
| Repeatability | Identical symbolic results across repeated runs and browser engines |

Report note precision/recall/F1 against manually annotated audio using pitch exact,
onset tolerance 50 ms, one-to-one event matching; separately report offset accuracy
within max(50 ms,20% reference duration). Retrieval gates are primary because
the product must find passages even when note transcription is imperfect.

Performance targets are release gates to measure, not promises already verified:
on a named reference laptop, warmed 10-second clip transcription <=5 seconds p95;
search <=1 second p95; Stop/cancel UI response <=200 ms. M2 warmed 15-second
inference+search <=3 seconds p95 for its 3-second cadence. Measure >=20 warmed
runs and report cold load separately with actual connection and asset bytes.
Set a 60-second initialization/inference timeout with retry; do not spin forever.
Model+runtime transfer budget <=25 MiB, listen corpus <=10 MiB compressed. If a
budget fails, record it as a failed gate and an explicit scope/architecture decision.
CI hardware reports timings separately; do not compare it blindly to laptop gates.

## 10. Full test suite

### Python: `tests/listen/test_export.py`, `test_validate.py`

- Tiny synthetic source contains a solo absent from pair results: it must export.
- Deterministic bytes/hashes; complete counts; stable order; no solo split.
- Reject mismatched arrays, NaN, invalid pitches, backwards onsets, nonpositive
  durations, unsupported schema, missing shard, bad checksum, stale source hash.
- Round-trip seconds and beats within export precision; source IDs preserved.
- Per-note recording times cover verified offset/scale, JazzTube interpolation,
  estimated out-of-bounds, candidate with null timing and missing recording.
- Full generated corpus validates without local databases or network access.

### JS unit: `tests-js/listen/*.test.mjs` using Node's test runner

- Query/worker schema validation and stable serialization, including empty/huge
  arrays, nonfinite values, unexpected message types and stale versions.
- Note normalization: repeats with attacks, held vibrato, rests, overlap, confidence
  ties, tiny/invalid events, 64-note truncation with original-index mapping.
- Resampling duration/pitch preservation at 44.1/48 kHz and stereo downmix;
  compare frequency against independently generated sine references.
- Candidate DP against hand-computed/exhaustive short cases; last-note indexing,
  free corpus prefix, no cross-solo matches, deduplication, deterministic ties.
- Reranker vs exhaustive tiny alignments; insertion/deletion in the middle,
  transposition sign, tempo scale direction, query coverage and all gap costs.
- No exact seed survives but a one-error phrase is retrieved; unrelated query
  rejected; repeated-pitch phrase and zero-gap timing handled without NaN.
- Fake-clock continuous scheduler: single in-flight request, latest pending wins,
  age expiry, two-window stability, stop during inference and 5-minute limit.
- MIDI export round-trip with an independent parser: pitch/onset/duration retained
  within 10 ms; no inference confidence misrepresented as MIDI velocity certainty.

### Browser: deterministic UI tests (model double allowed here only)

`listen-ui.spec.js`: open/close/keyboard focus; each state; denied permission,
missing device, insecure context/capability error, cancelled permission request,
quiet input, clipping warning, file limits and decode failure; retry after failed
model/shard fetch; timeout; stale reply; repeated Start; clear during processing;
no-result state; result inspection/playback; correct provenance and absent link.

Test tracks end after Stop, Cancel, close, pagehide/visibility change and exceptions.
Verify cancellation remains clickable during inference. Spy on browser track state
and actual permission behavior where possible, not just controller booleans.

### Browser: actual model integration, no model stubs

`listen-model.spec.js`: upload bundled WAV through visible file input; load actual
local weights; verify detected notes and expected top-five passage; test transposed
example and negative example; select different results and hear synthesized notes.
Do not assert exact floating point model output across backends; assert tolerances
and retrieval gates. Collect console errors and failed requests.

`listen-microphone.spec.js`: launch Chromium with fake-device and fake-audio-capture
WAV flags and microphone permission. Press Record, allow the actual AudioWorklet
to receive samples, Stop, assert real-model retrieval and stopped track. This test
must not inject note arrays in place of capture/inference. Keep file inference
tests separate so a broken microphone route cannot hide behind upload success.

`listen-live.spec.js`: use a long fixture with phrase A, silence, phrase B. Verify
window timestamps, provisional/stable state, eventual switch to B, stale-match
expiry, no backlog, responsive controls and stopped tracks. Run 60 seconds in CI;
perform the full five-minute session on the reference laptop before release.

### Browser: cross-browser, accessibility and regressions

- Chromium, Firefox and WebKit: file/example path, actual model, cancellation,
  UI and worker capability tests. Native microphone in physical Chrome and Safari.
- 320/390/768/1280 px: no page overflow, results usable, >=44px primary controls.
- Axe WCAG 2.2 AA checks in idle, recording, processing, results and error states;
  keyboard-only flow, focus restoration, visible focus, non-color-only statuses,
  reduced motion and screen-reader-friendly progress (no announcements every frame).
- Serve under both `/` and `/stolen-moments/`; test model/shard/worker/worklet URLs.
- No model requests on normal landing. During recording/inference, allow only
  same-origin static asset GETs; fail if any request transmits captured audio,
  including fetch/XHR/beacon/WebSocket. Inspect browser storage for audio remnants.
- Run existing release smoke suite unchanged: Crate, Echoes, filters, pair deep
  links, scores, synthesis and recording links. Verify switching between archive
  playback and Listen does not create overlapping audio or trap focus.
- Network failure midway through loading; gzip files served raw and decompressed
  by Content-Encoding; corrupted model, bad shard, worker crash and retry.
- Ten start/stop cycles and five-minute live run: track/context/worker/tensor counts
  return to expected baseline; memory plateaus rather than growing per window.
  Capture measured memory where supported and resource counts everywhere.

### Commands to implement and document

These scripts are requirements for the implementation; they do not exist yet.

```sh
rtk npm ci
rtk npm run build:listen
rtk python -m jazzmine.listen_export
rtk python -m jazzmine.listen_validate
rtk python -m pytest -q tests/listen tests/test_joint_search.py tests/test_static_export.py tests/test_dtl_export.py
rtk npm run test:listen:unit
rtk npm run test:listen:browser
rtk npm run test:listen:model
rtk npm run test:listen:live
rtk npm run benchmark:listen
rtk npm run test:browser
```

`benchmark:listen` writes machine-readable JSON and Markdown with dataset/model/
algorithm/source hashes, platform, fixture failures, top-k recall, false positives,
note metrics, timings and asset sizes. Support `--split validation|held-out`.
Do not let benchmark code read expected result IDs into the production matcher.

CI runs on PRs and feature-branch pushes: install pinned dependencies/browsers,
build assets, validate committed corpus, unit tests, UI/model/microphone/live tests,
and original regression tests. Tiny exporter tests need no private database.
Full corpus regeneration is a local release check; CI verifies committed hashes.
Publish traces, screenshots, benchmark JSON and logs as CI artifacts on failure.
Use separate Playwright configs/projects so existing tests do not accidentally
run fake-microphone settings or acquire browser-wide permissions.

Do not require localhost to hold the private WJazzD database just to preview the
finished feature. A clean clone with committed assets must be sufficient.

## 11. Implementation sequence and exit criteria

| Stage | Work | Exit evidence |
| --- | --- | --- |
| 0 | Branch, base record, fixture inventory, model worker spike | Real browser inference; pinned model/backend; spike report |
| 1 | Contracts, complete-corpus exporter, validator | Tiny and full export validation; reproducible assets |
| 2 | Retrieval module and benchmark harness | Symbolic gates, exhaustive tiny oracle, timing baseline |
| 3 | Capture, resampling, normalization and model adapter | Actual fake-microphone test; cleanup and inference tests |
| 4 | M1 dialog, examples, upload, results, playback and diagnostics | User can reproduce demo; M1 automated gates pass |
| 5 | Real recording validation and tuning | Frozen settings; held-out report; limitations stated |
| 6 | M2 rolling windows, scheduler and stable suggestions | Phrase A-to-B live test; latency and resource gates |
| 7 | Cross-browser/a11y/regression/CI and documentation | All automated gates, physical-device checklist, ready preview |

Do not wait until stage 5 to obtain real clips: gather them during stages 0–2.
If they are unavailable, implementation may proceed but instrument accuracy and
release readiness remain explicitly unverified. Keep held-out fixtures unseen by
the tuning process until settings freeze. Any subsequent tuning needs a new
held-out set or an explicitly labeled reused-test result.

## 12. User's browser acceptance checklist

Implementing agent must create `docs/listen/BROWSER_CHECKLIST.md` with exact
commands, actual example names/expected results, tested device/browser versions,
and a pass/fail column. Provide a running local preview, normally:

```sh
rtk python -m http.server 8766 --bind 127.0.0.1 --directory static
```

Open http://127.0.0.1:8766/ . If port is occupied by another project, choose a free
port and report the real URL. Open it in the app browser when delivering the work.
Use a normal browser window for physical microphone checks if the embedded browser
does not support microphone access. No production deployment is needed.

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Browse archive before opening Listen | Existing UI works; no model download yet |
| 2 | Open Listen, choose clear example | Visible loading, actual transcription, named expected match in top five |
| 3 | Choose transposed/slower example | Same reference passage; appropriate shift and playable comparison |
| 4 | Choose silence/noise example | Clear no-sound/no-match state, no confident-looking suggestion |
| 5 | Play query and database phrase; compare notes | Both playback paths work, alignment is readable, playback is exclusive |
| 6 | Record yourself playing the provided reference phrase for 5–15 seconds | Meter moves; Stop ends mic capture; corresponding passage appears in top five |
| 7 | Play a different phrase | Results reflect new input, never stale previous request |
| 8 | Deny microphone, then use upload | Useful recovery message; upload still works |
| 9 | Start continuous listening and play reference phrase A twice | Progress remains responsive; stable suggestion appears after two completed windows |
| 10 | Pause, then play reference phrase B | Prior match becomes stale/expires; results eventually move to B |
| 11 | Stop/close while processing | Mic indicator turns off; late responses do not reopen/update dialog |
| 12 | Clear and reopen | No recording retained; fresh session works |
| 13 | Try mobile width and keyboard-only navigation | No overflow, accessible controls and sensible focus |
| 14 | Open source recording | Correct source/provenance; timestamp when known, clear absence when unknown |
| 15 | Run continuously for five minutes | No accumulating delay; automatic session stop and working restart |

The real-instrument checklist cannot guarantee an arbitrary improvised phrase has
a meaningful counterpart in this finite collection. Use supplied reference notes
for the positive check, then improvise to assess usefulness and no-match behavior.

## 13. Definition of done and handoff

Full feature is done only when M1 and M2 code, all required automated gates,
held-out accuracy report, physical Chrome/Safari microphone checks, full-duration
resource test, existing regressions and static-subpath preview pass. Distinguish
agent-verified checks from user checks still pending. Do not claim user acceptance
before the user performs it. Keep the preview available for their inspection.

Final handoff contains:

- Branch and commit; concise changed-behavior summary.
- Actual clickable preview URL and `BROWSER_CHECKLIST.md` link.
- Test totals and failures/skips, supported devices, accuracy and timing results.
- Known limitations and any incomplete gate; no unqualified “all tests pass” if
  real audio was replaced by mocks or relevant device checks were not run.
- Rebuild commands and pinned dependency/model/source versions.

Suggested task prompt for the implementation agents:

> Implement LIVE_SOLO_SEARCH_PLAN.md on codex/live-solo-search, starting with the
> model-worker spike and frozen contracts. Deliver both the record-and-search
> milestone and continuous listening, preserving the existing archive. Complete
> the specified automated suite and benchmark reports, keep missing real-device
> or real-audio evidence explicit, and provide a running browser preview plus the
> manual acceptance checklist. Do not merge or publish production. Do not stop
> after scaffolding or mocked demonstrations.
