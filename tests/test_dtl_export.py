import csv
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from jazzmine.corpus import load_dtl_corpus
from jazzmine.dtl_export import SOLOS_KEY, reconcile


class DtlExportTests(unittest.TestCase):
    def test_reconciliation_preserves_gaps_and_numeric_archive_timing(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            ids = [f"finger_print_{i}_0.00.46.043990-0.01.25.005469" for i in range(3)]
            archive, catalog, cache = root / "archive.json", root / "catalog.csv", root / "notes.db"
            archive.write_text(json.dumps([
                {"file": f"finger_print_{i}", SOLOS_KEY: [
                    {"solo_id": sid, "onset": 46.4399, "duration": 38.61479}]
                 if i < 2 else []} for i, sid in enumerate(ids)]))
            metadata = [{"solo_id": sid, "solo_start": "0:00:46.043990",
                         "solo_performer_name": "Artist"} for sid in ids]
            with catalog.open("w", newline="") as fh:
                writer = csv.DictWriter(fh, fieldnames=metadata[0].keys(), delimiter=";")
                writer.writeheader()
                writer.writerows(metadata)
            with sqlite3.connect(cache) as db:
                db.execute("CREATE TABLE solo (solo_id TEXT, metadata TEXT, pitches TEXT, onsets TEXT, durations TEXT, source_url TEXT)")
                for i in range(2):
                    db.execute("INSERT INTO solo VALUES (?,?,?,?,?,?)", (
                        ids[i], json.dumps(metadata[i]), "[60, 62]", "[0, 0.2]",
                        "[0.1, 0.1]", "https://example.org/notes"))
            before = cache.read_bytes()
            result = reconcile(archive, catalog, cache)
            self.assertEqual(before, cache.read_bytes())
            self.assertEqual(result["solos"][0]["track_id"], "finger_print_0")
            self.assertEqual(result["solos"][0]["timing"]["start_seconds"], 46.4399)
            self.assertEqual(result["solos"][0]["metadata"]["solo_start"], "0:00:46.043990")
            self.assertIsNone(result["solos"][2]["timing"])
            self.assertIsNone(result["solos"][2]["notes"])
            self.assertEqual(result["report"]["missing_note_solos"], [ids[2]])
            self.assertEqual(result["report"]["available_notes"], 4)
            self.assertFalse(result["report"]["complete_notes"])
            self.assertEqual(len({s.trackid for s in load_dtl_corpus(cache).values()}), 2)
            with sqlite3.connect(cache) as db:
                db.execute("UPDATE solo SET onsets='[0, NaN]' WHERE solo_id=?", (ids[0],))
            result = reconcile(archive, catalog, cache)
            self.assertEqual(result["report"]["available_note_solos"], 1)
            self.assertEqual(result["report"]["invalid_note_solos"][0]["solo_id"], ids[0])
            self.assertIsNone(result["solos"][0]["notes"])


if __name__ == "__main__":
    unittest.main()
