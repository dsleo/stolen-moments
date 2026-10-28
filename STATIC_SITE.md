# Static joint-search site

The public app now reads a precomputed WJazzD catalog. Search, facets, the
musician connections view, score excerpts, synthesis, and timestamped recording
links run in the browser. A Python process or database is not needed to serve it.

Build the catalog after building the complete joint index and syncing any new
recording links in `data/workbench.db`:

```sh
python3 -m jazzmine.joint_store
python3 -m jazzmine.static_export
npm ci && npm run build:listen
python3 -m jazzmine.listen_export
python3 scripts/generate-listen-examples.py
python3 -m http.server 8766 -d static
```

Open `http://127.0.0.1:8766`. The `static/` directory can be deployed as-is on
any static host. It cannot be opened as `file://` because browsers restrict
loading the compressed data files. Hosts must serve `.json.gz` files as stored;
the app decompresses them in the browser.

Listen & Find reads `static/catalog/listen/`, which contains every WJazzD solo,
and loads a local transcription model from `static/listen/assets/`. Both are
committed static files. Microphone capture requires HTTPS or localhost. Captured
audio remains in the browser. Validate them with
`python3 -m jazzmine.listen_validate` and `npm run verify:listen`.

The export includes every passage with joint similarity at least 0.80. It
stores all source-solo metadata in the search index, precomputes each passage's
source-track and YouTube start times, and loads alignment and note files on
demand. Known album covers from the local cache are copied into the static site.
`static/catalog/report.json` gives counts and sizes for the exact export.

Recording priority is the same as in the former local app: manually verified
track mapping, then JazzTube solo alignment, then an unverified manual candidate,
then a duration-matched likely recording. The first two and the likely recording
get a `t=` timestamp at the computed passage onset, rounded down to a whole second. A
manual candidate without verified timing opens at the start of the video.
JazzTube times are interpolated from its published solo bounds; they are
calculated deterministically but are not guaranteed to be frame-accurate for
every upload. YouTube can also seek to a nearby keyframe. A passage with no
known link shows “No matched video.”

The static app is read-only. Shared reviews and live YouTube discovery remain
future backend features. This catalog currently covers WJazzD only; the JTD
pilot needs a corrected beat representation before joint rhythm matching, and
the DTL1000 note collection is incomplete.
