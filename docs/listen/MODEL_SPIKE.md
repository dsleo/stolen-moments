# Browser transcription spike

27 October 2026; branch `codex/live-solo-search`; baseline commit `058aa70`.

## Runtime selected

- `@spotify/basic-pitch` 1.0.1, Apache-2.0, using its documented
  `BasicPitch.evaluateModel`, `outputToNotesPoly`, and `noteFramesToTime` APIs.
- Transcription runs in a classic dedicated Web Worker bundled with esbuild
  0.25.12. The model JSON, weight shard and runtime bundle are self-hosted in
  `static/listen/assets/`. A plain Python static server can load all assets.
- TensorFlow.js 3.21.0 CPU backend is the working backend in Chromium. This is
  explicitly identified as CPU in returned diagnostics.
- The worker takes mono Float32 PCM at its true sample rate. Its windowed-sinc
  resampler converts to Basic Pitch's required 22,050 Hz before inference.
- Microphone capture uses an AudioWorklet when available and falls back to
  ScriptProcessor when worklet startup fails. Audio is not sent to a server;
  the asset fetches are GETs for locally hosted model files.

Model weight SHA-256: `b142a95737a52e1e412d5f92e73d8bb80dfe8d04941acc0702f11f4524fb377c`.
Model JSON SHA-256: `1ed1aaee3409ec1dc098c8b01f430c0911f6fe9412e7af8086750f9e8f302f68`.
The generated `static/listen/assets/assets.json` records every asset hash and
size; `npm run verify:listen` checks them. Runtime bundle hash may change with
implementation edits and should be read from that manifest.

## Browser observations

The model loaded and transcribed a 3-second A440 synthetic tone in headless
Chromium: one MIDI 69 note at approximately 0.023–2.97 seconds. A 10-second
sequence of synthetic tones produced ten notes; a 15-second sequence produced
fifteen. These tests exercised the built worker, local model files, TF.js, PCM
transfer, inference and note conversion on a local HTTP static server.

The browser WASM backend initialized and loaded the model, but inference failed
with `Unknown dtype undefined` from a TF.js WASM kernel. The worker WebGL backend
could not initialize in a Chromium Worker. CPU is therefore the tested path.
No working WASM/WebGL performance claims are made.

Continuous mode uses a separate local monophonic pitch tracker in a module
Worker. A three-second 48 kHz synthetic melody took about 157 ms in Chromium.
This is a single synthetic measurement, not a real-instrument latency result.
Basic Pitch remains the record/upload transcription model.

| Input | CPU inference measured in fresh Chromium context |
| --- | ---: |
| 3-second A440 tone | ~4.0 seconds |
| 10-second synthetic sequence | ~17.0 seconds |
| 15-second synthetic sequence | ~32.2 seconds |

These numbers are from a single local macOS host, after model load, with one run
per duration. They are not p95 latency or a cross-device benchmark. They exceed
the plan's 5-second 10-second-clip target. Reprocessing a 15-second window every
3 seconds is infeasible on this backend. Continuous mode instead processes new
short chunks with the monophonic tracker, merges their absolute-timed notes and
searches a rolling note window. Its actual microphone cadence still needs
measured verification; do not call it real-time solely because the UI refreshes.

## Outstanding gates

- A genuine instrument fixture benchmark, held-out sax/trumpet recall and
  negative clips. Synthetic tones only prove integration.
- Firefox/WebKit model inference, physical Chrome/Safari microphone checks and
  memory stability over a five-minute session.
- p95 load/inference measurements and resource budgets on a named reference
  laptop, especially continuous chunk latency.
- Check model note boundaries on vibrato, breathy attacks and repeated notes.

Sources: [Basic Pitch TypeScript](https://github.com/spotify/basic-pitch-ts),
[TensorFlow.js](https://github.com/tensorflow/tfjs).
