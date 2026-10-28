# Listen & Find browser check

This checklist is for the `codex/live-solo-search` branch. The feature runs from
committed static files. Start a local preview from the repository root:

```sh
rtk python -m http.server 8766 --bind 127.0.0.1 --directory static
```

Open http://127.0.0.1:8766/ in Chrome, Firefox or Safari. If port 8766 is busy,
use another port and open that URL. Allow the microphone only when you try the
recording steps. A built-in example can be used without a microphone.

Mark each row yourself. The expected reference for the clear and transposed
examples is **Paul Desmond, “Alianca”**. These examples synthesize a phrase from
the archive; they are integration checks, not evidence about saxophone accuracy.

| Check | Action | Expected result | Your result |
| --- | --- | --- | --- |
| Archive | Lift the lid; browse Crate, Echoes, filters and a pair | Existing archive responds as before | ☐ |
| Open | Select Listen & Find | Dialog opens and explains that audio stays in browser | ☐ |
| Clear example | Select Clear melody, then Try example | Detected notes and Paul Desmond passage in top five | ☐ |
| Changed key/tempo | Select Higher and slower, then Try example | Same passage appears; shift is shown | ☐ |
| Quiet example | Select Quiet recording, then Try example | Clear no-sound message, no confident match | ☐ |
| Comparison | Play your notes, pause and resume, then play the passage | The active button changes to Pause, then Resume; switching passages stops the earlier playback | ☐ |
| Microphone | Record a supplied/known 8–16 note phrase, then Stop | Level moves, mic indicator ends, results reflect new notes | ☐ |
| Permission | Deny microphone, then choose a short WAV | Recovery message; file still works | ☐ |
| Stop | Stop or close during processing | Mic indicator turns off, no stale result appears later | ☐ |
| Reset | Find the clear example, then try Quiet recording | Earlier results, score and downloads disappear immediately; no-sound message replaces them | ☐ |
| Accessibility | Use keyboard only, then narrow browser to mobile width | Controls remain reachable, focus visible, no sideways scroll | ☐ |
| Source | Open a source recording when offered | Recording link/provenance shown; timestamp only when known | ☐ |
| Detected phrase | After recording, play the detected notes above the matches, then open Detected score | The MIDI rendition plays; the score, note names and timings are available above the matches | ☐ |
| Pair view | Open a result's comparison | Your phrase and the archive passage appear as two scores with separate play controls | ☐ |
| Progress | Run the clear example | Preparation, model loading, transcription percentage and archive search appear during processing | ☐ |
| Score labels | Read the score and match notes | Rounded rhythm and MIDI limitations are explained; the ranking says pattern similarity | ☐ |

An arbitrary improvised melody may have no close counterpart in this finite
collection. Use the supplied example or a known archive phrase for a positive
check. Please note browser/device versions and any failed step when reporting
feedback.

Implementation agents should record their own measured results separately in
`docs/listen/IMPLEMENTATION_LOG.md`; these boxes represent the user's check, not
an automated pass.
