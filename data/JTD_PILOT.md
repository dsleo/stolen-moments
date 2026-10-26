# Jazz Trio Database pilot

The app now includes a 120-performance pilot from the public Jazz Trio Database
(JTD), spread across all 34 pianists in its annotation archive. The archive
contains 1,294 MIDI piano solos. The pilot archive is stored locally at
`.qa/datasets/jazz-trio-database-v02.zip`; the imported, regenerable SQLite
database is `data/jtd.db`.

## How the pilot is represented

JTD provides chordal piano MIDI rather than a single monophonic lead line. For
each simultaneous note onset, this pilot keeps the highest pitch and its MIDI
duration. This simple projection yielded 285,883 notes across 120 performances.
It is a provisional way to find candidate motifs, and can mistake chord voicings
for melodic notes. Each solo is labelled **piano · top-note projection** in the
app so the source is visible alongside matches.

The source MIDI timing is local to the piano solo excerpt. JTD's published start
time places the passage in the original track; both are retained for result
links. Metadata identifies the pianist, album, track, date, meter and linked
recording when supplied.

## Pilot results

The rebuilt index contains 576 performances: 456 WJazzD and 120 JTD. It found
89,535 candidate pairs in total. With strict filters (at least 12 notes, no
interval edits, pitch similarity at least 0.9, rhythm at least 0.5), the app
shows 2 JTD-only pairs and 11 WJazzD-to-JTD pairs. Examples include Clifford
Brown's “I'll Remember April” matched with Bobby Timmons's “Walking Death”, and
Milt Jackson's “Softly as in a Morning Sunrise” matched with Hank Jones's
“Confirmation”. These are listening leads, not confirmed quotations; common
patterns and the approximate piano melody extraction can both create matches.

## Sources and rebuild

- JTD annotation/MIDI release: [GitHub release](https://github.com/HuwCheston/Jazz-Trio-Database/releases/tag/v02-zenodo)
- JTD dataset and terms: [project README](https://github.com/HuwCheston/Jazz-Trio-Database)
- Paper: [Jazz Trio Database, TISMIR](https://doi.org/10.5334/tismir.186)
- The dataset annotations are MIT-licensed. The license does not cover the
  linked YouTube recordings.
- Downloaded annotation archive SHA-256:
  `42c3df0700e0cd6e73231b9ed111283600750305e2e9cf451f80664d1ec90025`

Recreate the 120-performance pilot with:

```sh
python3 -m jazzmine import-jtd-pilot /path/to/jazz-trio-database-v02.zip
python3 -m jazzmine build
```

The importer selects up to three highest-rated performances per pianist first,
then fills any remaining slots by available piano-detection rating and solo
length. Raise `--limit` to expand after reviewing pilot matches.
