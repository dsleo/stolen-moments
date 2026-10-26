# DTL1000 reconciliation — 23 October 2026

The missing note data could not be recovered on this retry. A reproducible staging
export is available locally as `data/dtl-reconciled.json`, with the exact missing
IDs and discrepancies in `data/dtl-reconciled-report.json`. The app still uses
WJazzD only.

## What was verified

The supplied Desktop `dtl_1000.json` is byte-for-byte the official
[OSF JSON](https://osf.io/6jm8x/). SHA-256:
`0c64b697bb931f209f6d135bdb8afa0af9abd578487bf7a3f9146d7e52884e5d`.
This was checked against the hash in the
[public archive inventory](https://api.osf.io/v2/nodes/bwg42/files/osfstorage/).
The JSON has 1,060 tracks and 1,711 solo records, but no note transcriptions.

The locally cached web catalog has 1,685 solos from 622 tracks. All 622 tracks
join to the original JSON. 1,667 solo IDs join exactly; 18 catalog solos have no
exact archive match, and 44 archive solos are absent from the catalog. These are
different snapshots, so an approximate title or time match is not silently used.

The saved note database contains 750 solos and 91,664 notes. All pass checks for
array length, finite timing, ordered nonnegative onsets, positive durations, and
integer MIDI pitches in range. **935 catalog solos still lack notes.** These
checks establish structural validity, not transcription accuracy.

## Problems found before integration

- Audio fingerprints can contain underscores. The corpus loader now splits the
  solo ID at its final underscore, preserving the complete track fingerprint.
- 1,654 of the 1,667 matched solos have a CSV start time that disagrees with the
  original JSON's numeric onset. For example, Stan Getz's *Tootsie Roll* starts
  at `46.4399` seconds in the JSON but `46.043990` in the CSV. The staging export
  preserves both values and explicitly identifies the numeric archive timing;
  unmatched solos get no invented timing.
- The website-player onset origin still needs verification. 38 cached note
  sequences extend more than 100 ms beyond the archive solo duration. Notes are
  preserved without trimming or shifting; no absolute playback alignment is
  asserted.
- 510 catalog entries lack a definite soloist name. Possible performers are
  retained as possibilities rather than promoted to confirmed soloists.

## Sources checked on this retry

- The project documentation endpoint returned HTTP 403, `Access denied`.
  No bulk crawl was restarted.
- The public OSF API lists four files for DTL1000: `metadataErrors.txt`,
  `dtl1000.ttl`, `dtl_1000.json`, and `DTL_1000_segmentations.csv`. No separate
  note-track export is listed. Related metadata components and the project's
  [GitHub repository](https://github.com/ppquadrat/DigThatLick) were checked.
- The [UK Data Service record](https://reshare.ukdataservice.ac.uk/854781/)
  links back to the same JSON; it has no downloadable files of its own.
- [LinkedMusic's ingestion workflow](https://github.com/DDMAL/linkedmusic-datalake/blob/main/dtl/doc/workflow.md)
  uses the metadata CSV, not a separate transcription collection.

## Reproduce the export

```sh
python3 -m jazzmine export-dtl /path/to/dtl_1000.json
```

The command uses local files only and leaves the original JSON, note database,
and search index unchanged. It writes the reconciled JSON and a report beside
it. The JSON preserves all original track records, catalog metadata, available
note arrays, source links, and input hashes. Missing notes are `null`.
`ready_for_app_import` intentionally remains false pending timing review.

To finish, obtain the project's note-level export keyed by solo ID, with pitches,
onsets, durations, and a definition of the onset time origin. A CSV, JSON, or
SQLite export is sufficient; audio is unnecessary. The UK Data Service record
lists Simon Dixon (`s.e.dixon@qmul.ac.uk`) as the dataset contact. No message has
been sent.
