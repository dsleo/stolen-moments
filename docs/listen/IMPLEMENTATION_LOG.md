# Listen & Find implementation record

27 October 2026, branch `codex/live-solo-search`. Base commit `058aa70`.
This document records measured evidence and remaining verification, not user
acceptance. The user checklist is in `BROWSER_CHECKLIST.md`.

## Delivered

- Complete deterministic static corpus of 456 WJazzD solos and 200,809 notes,
  including solos absent from precomputed pair rows. Eight compressed shards total
  about 3.8 MB. Source SHA-256:
  `af6a0d9debf042c3581565bd75baad591d32e166cd2ec7298519883de614bf12`.
- Static corpus and model-asset validators, with checksums and recording-link
  provenance/timing. Model/runtime assets are local and version pinned.
- Browser microphone/file recording, Basic Pitch transcription, conversion to
  note arrays, search against every source solo, ranked passage inspection,
  synthesis, recording links, JSON/MIDI download and cancellation.
- A separate lightweight monophonic pitch tracker was built and tested during
  the pilot. The continuous listening control was removed from the interface
  after user review; phrase recording is the available microphone flow. Audio
  is not uploaded.
- Clear, transposed/slower and silence WAV examples generated deterministically
  from WJazzD notes. No source recording audio is redistributed.
- Dedicated branch/PR CI checks; deployment remains on `main` only.

## Checks run locally

| Check | Result |
| --- | --- |
| `python -m jazzmine.listen_validate` | 456 solos, 200,809 notes, 8 shards; passed |
| `npm run verify:listen` | 5 local model/runtime assets; passed |
| `npm run build:listen` then corpus validation | Passed; asset hashes consistent |
| `python -m pytest -q` | 35 passed |
| `npm run test:listen:unit` | 17 passed |
| `npm run test:browser` | 15 passed, including actual model, upload, fake microphone, live tracker, subpath, keyboard/a11y and old archive smoke |
| Focused debug-panel browser test | 1 passed |
| Browser real-model examples | Clear and +7 semitone/1.25× slower both found Paul Desmond, “Alianca” |
| Browser live tracker + corpus | Known synthetic phrase recovered |
| Browser upload and `/stolen-moments/` subpath | Passed in a later focused run |
| Symbolic pilot, `npm run benchmark:listen -- --count=12` | 60/60 positive variant cases, 0/12 random negative matches; search p95 933 ms on darwin/arm64 |

The symbolic pilot report and case-level data are in `benchmark.md` and
`benchmark.json`. These test queries use known corpus notes; they do not estimate
accuracy on instrument recordings. The built-in WAV examples use a synthesizer
and exercise the actual Basic Pitch model in a browser.

## Follow-up design audit, 28 October 2026

- Cleared the previous phrase, score, ranked results and downloads as soon as a
  new recording, upload or example begins. A cancelled first score render cannot
  repopulate the next phrase.
- Exposed model loading, transcription percentage and archive search in the
  dialog. The model remains CPU-bound; the progress display does not claim a
  shorter processing time.
- Kept a compact detected-phrase player above the results, with an expandable
  score, pitch names and note timings. Explained rhythmic rounding and MIDI
  omissions. Relabeled rankings as pattern similarity and expanded instrument
  abbreviations.
- Added visible Record and Upload captions, scroll cues, larger touch targets,
  and dialog-scoped color tokens.
- Made every note player in Listen and the catalog pair view change to Pause
  while playing and Resume while paused. Switching players or closing a dialog
  stops the previous rendition.
- Local follow-up verification: 15/15 browser tests, 17/17 Listen unit tests,
  model asset verification and a visual check at desktop and 390-pixel width.

## Measured limitations and unfinished evidence

- Basic Pitch runs on the TF.js CPU backend in a browser Worker. On this Mac,
  one warmed 10-second synthetic clip took about 17 seconds and a 15-second clip
  about 32 seconds. The plan's 5-second transcription target is not met. The
  faster continuous tracker is used for live mode; its real-instrument quality
  remains unmeasured. See `MODEL_SPIKE.md`.
- No 40-clip, permission-cleared saxophone/trumpet set was available, so the
  plan's held-out real-audio recall and false-positive gates remain unverified.
- Physical Chrome/Safari microphone checks remain for a human device run.
  Headless Chromium on macOS stalled during
  AudioWorklet initialization, so capture now falls back to ScriptProcessor.
  The fake-microphone browser test records and identifies the built-in phrase
  locally on macOS. The Linux CI rerun is pending.
- Firefox and WebKit real-model inference, cross-device p95 latency, and PR CI
  on the remote host have not yet been observed.

Do not present those missing measurements as passes. The browser checklist makes
them directly checkable from the local preview. If instrument accuracy is poor,
collect consented audio with reference notes and tune transcription/search
settings on validation clips before claiming release readiness.
