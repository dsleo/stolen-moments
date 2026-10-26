from __future__ import annotations

import unittest
from types import SimpleNamespace

from jazzmine.static_export import recording


SOLO = SimpleNamespace(
    melid=42, trackid=7, solo_start=20.0,
    onsets=[0.0, 10.0, 20.0], durations=[1.0, 1.0, 1.0],
)


class RecordingExportTests(unittest.TestCase):
    def test_jazztube_uses_published_solo_bounds_at_passage_onset(self):
        aligned = {"42": {"video_id": "abc12345678", "solo_start_sec": 100.0,
                          "solo_end_sec": 121.0}}
        self.assertEqual(recording(SOLO, 30.0, {}, aligned, {}),
                         {"video_id": "abc12345678", "second": 110, "kind": "aligned"})

    def test_verified_track_mapping_takes_priority(self):
        manual = {"7": {"video_id": "verified123", "performance_verified": 1,
                        "speed_ratio": 1.1, "offset_seconds": 40}}
        aligned = {"42": {"video_id": "abc12345678", "solo_start_sec": 100,
                          "solo_end_sec": 121}}
        self.assertEqual(recording(SOLO, 30, manual, aligned, {})["second"], 73)

    def test_unverified_manual_link_has_no_guessed_timestamp(self):
        manual = {"7": {"video_id": "candidate12", "performance_verified": 0}}
        self.assertEqual(recording(SOLO, 30, manual, {}, {})["second"], None)

    def test_likely_video_uses_source_track_time_only_within_duration(self):
        auto = {"7": {"video_id": "likely12345", "video_duration": 60}}
        self.assertEqual(recording(SOLO, 30, {}, {}, auto)["second"], 30)
        self.assertIsNone(recording(SOLO, 60, {}, {}, auto))


if __name__ == "__main__":
    unittest.main()
