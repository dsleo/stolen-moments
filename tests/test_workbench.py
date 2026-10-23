import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from jazzmine.corpus import load_corpus, load_dtl_corpus, source_checksum, validate_corpus
from jazzmine.dtl import detail_id
from jazzmine.evaluation import synthetic_sensitivity
from jazzmine.jazztube import SOURCE as JAZZTUBE_SOURCE, choose_available, parse_alignments
from jazzmine.mining import _periodicity, connect_store
from jazzmine.server import App
from jazzmine.videos import discover


class WorkbenchTests(unittest.TestCase):
    def test_released_corpus_imports_without_losing_notes(self):
        report = validate_corpus(load_corpus())
        self.assertEqual((report["solos"], report["notes"]), (456, 200809))
        self.assertEqual(report["issues"], [])

    def test_planted_variant_sensitivity(self):
        result = synthetic_sensitivity()
        self.assertGreaterEqual(result["sensitivity"], .9)

    def test_dtl_detail_id_and_note_import(self):
        import json
        import sqlite3
        identifier = "AQAD-EqXKIqegOmiDWIyCXeWCecPP0cR_0.00.46.043990-0.01.25.005469"
        self.assertEqual(detail_id(identifier),
                         "AQAD-EqXKIqegOmiDWIyCXeWCecPP0cR_0.00.46.43990-0.01.25.05469")
        self.assertEqual(detail_id("X_0.01.01.0579-0.02.01.0034"), "X_0.01.01.579-0.02.01.034")
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "dtl.db"
            db = sqlite3.connect(path)
            db.execute("CREATE TABLE solo (solo_id TEXT, metadata TEXT, pitches TEXT, onsets TEXT, durations TEXT, source_url TEXT)")
            db.execute("INSERT INTO solo VALUES (?,?,?,?,?,?)", (identifier,
                       json.dumps({"solo_performer_name": "Stan Getz", "track_title": "Tootsie Roll",
                                   "solo_start": "0:00:46.043990", "session_date": "1950-12-10"}),
                       "[60,62,64]", "[0,0.2,0.4]", "[0.15,0.15,0.15]", "https://example.org/detail"))
            db.commit(); db.close()
            solos = load_dtl_corpus(path)
            self.assertEqual(len(solos), 1)
            solo = next(iter(solos.values()))
            self.assertEqual((solo.source, solo.pitches, round(solo.solo_start, 6)),
                             ("DTL1000", [60, 62, 64], 46.04399))

    def test_short_loops_are_detected_for_ranking(self):
        self.assertGreater(_periodicity([2, -5, 3] * 7), .75)
        self.assertLess(_periodicity([2, 1, 3, -2, 4, -5, 2, 2, 1, -3, 4]), .5)

    def test_external_link_requires_verified_performance_and_anchor(self):
        with tempfile.TemporaryDirectory() as folder:
            store = Path(folder) / "test.db"
            db = connect_store(store)
            db.execute("INSERT INTO meta(key,value) VALUES('source_sha256',?)", (source_checksum(),))
            db.commit()
            db.close()
            app = App(store)
            track = next(iter(app.solos.values())).trackid
            data = {"trackid": track, "video_id": "https://www.youtube.com/watch?v=ABCDEFGHIJK", "verifier": "test",
                    "evidence": "fixture", "anchor_track_seconds": 100, "anchor_video_seconds": 110}
            app.save_media({"trackid": track, "video_id": data["video_id"],
                            "verifier": "test", "performance_verified": False})
            self.assertIsNone(app._media(track, 100))
            self.assertEqual(app._recording(track, 100), {
                "url": "https://www.youtube.com/watch?v=ABCDEFGHIJK",
                "verified": False, "time_seconds": None, "estimated": False})
            with self.assertRaises(ValueError):
                app.save_media({"trackid": track, "video_id": "ABCDEFGHIJK", "verifier": "test",
                                "evidence": "fixture", "performance_verified": True})
            app.save_media(data | {"performance_verified": True,
                                   "second_anchor_track_seconds": 200,
                                   "second_anchor_video_seconds": 210})
            self.assertEqual(app._media(track, 150)["time_seconds"], 157)
            self.assertEqual(app._recording(track, 150)["url"],
                             "https://www.youtube.com/watch?v=ABCDEFGHIJK&t=157s")
            app.db.close()

    def test_video_discovery_requires_matching_recording_metadata(self):
        solo = next(s for s in load_corpus().values() if s.melid == 107)
        listing = [{"id": "ABCDEFGHIJK", "title": "Milestones", "channel": "Dave Liebman Quartet - Topic", "duration": 347}]
        details = {"id": "ABCDEFGHIJK", "title": "Milestones", "track": "Milestones",
                   "artist": "Dave Liebman Quartet", "album": "Setting The Standard", "duration": 347}
        with patch("jazzmine.videos.reference_duration", return_value=346.8), \
             patch("jazzmine.videos.youtube_info", return_value=listing), \
             patch("jazzmine.videos.full_video", return_value=details):
            self.assertEqual(discover(solo)["video_id"], "ABCDEFGHIJK")
            details["album"] = "Another Album"
            self.assertIsNone(discover(solo))

    def test_metadata_match_links_directly_near_source_time(self):
        with tempfile.TemporaryDirectory() as folder:
            store = Path(folder) / "test.db"
            db = connect_store(store)
            db.execute("INSERT INTO meta(key,value) VALUES('source_sha256',?)", (source_checksum(),))
            db.execute("""INSERT INTO video_match
                (trackid,video_id,title,channel,video_duration,reference_duration,album)
                VALUES(100,'z2nWM_ZKt-E','Milestones','Dave Liebman Quartet - Topic',347,346.8,'Setting The Standard')""")
            db.commit()
            db.close()
            app = App(store)
            self.assertEqual(app._recording(100, 197.654)["url"],
                             "https://www.youtube.com/watch?v=z2nWM_ZKt-E&t=194s")
            self.assertIsNone(app._recording(100, 350))
            app.db.close()

    def test_jazztube_alignment_maps_a_solo_offset_to_the_video(self):
        solos = load_corpus()
        solo = solos[10]
        with tempfile.TemporaryDirectory() as folder:
            store = Path(folder) / "test.db"
            db = connect_store(store)
            db.execute("INSERT INTO meta(key,value) VALUES('source_sha256',?)", (source_checksum(),))
            db.execute("""INSERT INTO jazztube_video
                (melid,rank,video_id,solo_start_sec,solo_end_sec)
                VALUES (10,0,'8B3W29P7lD8',118,240.8)""")
            db.commit(); db.close()
            app = App(store)
            at_start = app._recording(solo.trackid, solo.solo_start, solo)
            self.assertTrue(at_start["aligned"])
            self.assertEqual(at_start["url"], "https://www.youtube.com/watch?v=8B3W29P7lD8&t=115s")
            later = app._recording(solo.trackid, solo.solo_start + 30, solo)
            self.assertGreater(later["time_seconds"], at_start["time_seconds"] + 25)
            with app.db:
                app.db.execute("""INSERT INTO media_link
                    (trackid,video_id,performance_verified,verifier,evidence)
                    VALUES (?,'AAAAAAAAAAA',0,'test','')""", (solo.trackid,))
            self.assertEqual(app._recording(solo.trackid, solo.solo_start, solo)["url"], at_start["url"])
            app.db.close()

    def test_published_jazztube_csv_covers_existing_solos(self):
        rows = parse_alignments(JAZZTUBE_SOURCE.read_bytes(), set(load_corpus()))
        self.assertEqual(len({row[0] for row in rows}), 329)
        self.assertEqual(len(rows), 988)

    def test_jazztube_prefers_first_available_candidate(self):
        with patch("jazzmine.jazztube._video_available", side_effect=lambda video_id: video_id == "BBBBBBBBBBB"):
            chosen = choose_available([(10, 0, "AAAAAAAAAAA", 10, 30, None, None),
                                       (10, 1, "BBBBBBBBBBB", 12, 32, None, None)])
        self.assertEqual(chosen[0][1:3], (1, "BBBBBBBBBBB"))


if __name__ == "__main__":
    unittest.main()
