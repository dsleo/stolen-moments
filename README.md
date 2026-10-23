# Motif Atlas

A local web app for exploring melodic reuse in the 456 solo transcriptions of the Weimar Jazz Database (WJazzD) v2.1. It finds transposed interval matches and bounded variants, then lets a musician adjust thresholds, compare score excerpts, hear a synthesized rendering, and find a source-recording link.

## DTL1000 note tracks

The [current DTL1000 metadata export](https://dig-that-lick.hfm-weimar.de/similarity_search/documentation) lists 1,685 solos. Its solo-detail pages expose pitches, onsets, and durations for MIDI playback, so audio files are not needed for motif search. A local importer and cross-collection search support are prepared, but the site blocked bulk requests after 750 note tracks were fetched; its [robots rules](https://dig-that-lick.hfm-weimar.de/robots.txt) also disallow automated crawling. The app deliberately continues to show only the complete WJazzD index. Completing the DTL1000 import requires an authorized note-track export or permission from the project. DTL1000 notes are automatic transcriptions and have no annotated beat or harmony grid.

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
- **Distinctiveness:** how uncommon the seed is across different WJazzD solos.
- **Performers / composition:** explore self-reuse, cross-performer reuse, same tune, or different tunes.

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

## Boundaries

The first release searches WJazzD solo transcriptions, not every song a soloist might quote. Candidate matches can reflect common jazz vocabulary, a shared composition, or chance. The search skips extremely common short seeds, and its variant matcher is anchored on exact runs of four or five intervals. It can miss heavily transformed quotations. Dates are presented as recorded by WJazzD; they do not establish influence or authorship. Media links require manual performance verification.

The suggested [Jazz-Ml-Dataset](https://github.com/SaiKayala/Jazz-Ml-Dataset) is a collection of song MIDI files and a derived note CSV, with many full arrangements and non-jazz songs. Its files do not identify real solo performances or their audio timestamps. We inspected the archive: only 84 labeled melody tracks were nearly monophonic by a basic overlap check, often with doubled parts. It is a possible future **composition melody reference** after tune identity and duplicate checks, but it is not interchangeable with the WJazzD solo corpus and has not been added to the quotation ranking.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the research rationale and future audio/reference-corpus phases.

## Data and attribution

WJazzD is published by the Jazzomat Research Project under the Open Database License, with individual database contents under the Database Contents License. See the [official download and license page](https://jazzomat.hfm-weimar.de/download/download.html), the [schema](https://jazzomat.hfm-weimar.de/dbformat/dbformat.html), and the citation requested by the project: Pfleiderer, Frieler, Abeßer, Zaddach & Burkhart (eds.), *Inside the Jazzomat: New Perspectives for Jazz Research* (2017). Assess redistribution obligations before publishing derived data.
