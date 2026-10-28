from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from jazzmine.listen_export import export
from jazzmine.listen_validate import validate


def solo(mid: int, *, start: float = 0.0):
    return SimpleNamespace(
        melid=mid, trackid=mid + 100, performer=f"Player {mid}", title="A phrase",
        album="Record", album_artist="Leader", instrument="ts", year=1958,
        composition_id=9, solo_start=start,
        source_url=f"https://example.org/solo/{mid}",
        pitches=[60, 62, 64], onsets=[0.0, .5, 1.0],
        durations=[.4, .4, .4], beat_positions=[0.0, 1.0, 2.0],
    )


class ListenExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source.db"
        self.source.write_bytes(b"fixture source checksum")
        self.output = self.root / "listen"

    def build(self, solos=None, media=None, shard_notes=3):
        return export(self.source, self.output, solos=solos or {1: solo(1), 2: solo(2)},
                      media=media or ({}, {}, {}), target_notes_per_shard=shard_notes)

    def shard(self, manifest, index=0):
        return json.loads(gzip.decompress((self.output / manifest["shards"][index]["path"]).read_bytes()))

    def test_every_solo_is_exported_independently_of_pair_catalog(self):
        manifest = self.build()
        self.assertEqual((manifest["soloCount"], manifest["noteCount"]), (2, 6))
        self.assertEqual(len(manifest["shards"]), 2)
        self.assertEqual([self.shard(manifest, i)["solos"][0]["id"] for i in range(2)], [1, 2])
        self.assertEqual(validate(self.output, source=self.source)["notes"], 6)
        row = self.shard(manifest)["solos"][0]
        self.assertEqual(row["onsetsSeconds"], [0.0, .5, 1.0])
        self.assertEqual(row["durationsSeconds"], [.4, .4, .4])
        self.assertEqual(row["beatPositions"], [0.0, 1.0, 2.0])

    def test_deterministic_export_and_stale_shard_removal(self):
        manifest = self.build()
        before = [(p.name, p.read_bytes()) for p in sorted(self.output.iterdir())]
        self.build()
        self.assertEqual(before, [(p.name, p.read_bytes()) for p in sorted(self.output.iterdir())])
        self.build(shard_notes=10)
        self.assertEqual(len(list(self.output.glob("shard-*.json.gz"))), 1)
        self.assertEqual(validate(self.output)["solos"], 2)

    def test_per_note_verified_recording_times_and_metadata(self):
        media = ({"101": {"video_id": "abc", "performance_verified": 1,
                          "speed_ratio": 2.0, "offset_seconds": 10.0,
                          "verifier": "listener", "evidence": "manual"}}, {}, {})
        manifest = self.build(solos={1: solo(1, start=3.0)}, media=media)
        row = self.shard(manifest)["solos"][0]
        self.assertEqual(row["recordingTimes"], [16, 17, 18])
        self.assertEqual(row["recording"]["kind"], "verified")
        self.assertEqual(row["recording"]["verifier"], "listener")

    def test_unknown_start_and_candidate_have_no_invented_timestamp(self):
        media = ({"101": {"video_id": "candidate", "performance_verified": 0}}, {}, {})
        manifest = self.build(solos={1: solo(1, start=-1.0)}, media=media)
        row = self.shard(manifest)["solos"][0]
        self.assertEqual(row["soloStartSeconds"], -1.0)
        self.assertEqual(row["recordingTimes"], [None, None, None])
        self.assertEqual(row["recording"]["kind"], "candidate")

    def test_aligned_times_use_existing_interpolation(self):
        media = ({}, {"1": {"video_id": "aligned", "solo_start_sec": 10.0,
                            "solo_end_sec": 11.4}}, {})
        manifest = self.build(solos={1: solo(1)}, media=media)
        row = self.shard(manifest)["solos"][0]
        self.assertEqual(row["recordingTimes"], [10, 10, 11])
        self.assertEqual(row["recording"]["kind"], "aligned")

    def test_validator_rejects_tampering_and_bad_source(self):
        manifest = self.build()
        path = self.output / manifest["shards"][0]["path"]
        data = path.read_bytes()
        path.write_bytes(data[:-1] + bytes([data[-1] ^ 1]))
        with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
            validate(self.output)
        path.write_bytes(data)
        self.source.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "Source checksum"):
            validate(self.output, source=self.source)

    def test_validator_rejects_invalid_note_arrays_even_with_rehashed_shard(self):
        manifest = self.build()
        path = self.output / manifest["shards"][0]["path"]
        data = self.shard(manifest)
        data["solos"][0]["durationsSeconds"][0] = -1
        encoded = gzip.compress(json.dumps(data).encode(), mtime=0)
        path.write_bytes(encoded)
        manifest["shards"][0]["sha256"] = hashlib.sha256(encoded).hexdigest()
        manifest["shards"][0]["bytes"] = len(encoded)
        (self.output / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "invalid durations"):
            validate(self.output)

    def test_validator_rejects_missing_or_unsafe_shard(self):
        manifest = self.build()
        (self.output / manifest["shards"][0]["path"]).unlink()
        with self.assertRaisesRegex(ValueError, "Missing or invalid shard"):
            validate(self.output)
        manifest["shards"][0]["path"] = "../outside.json.gz"
        (self.output / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "Invalid or duplicate shard path"):
            validate(self.output)

    def test_validator_rejects_unsupported_version(self):
        manifest = self.build()
        manifest["schemaVersion"] = 2
        (self.output / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            validate(self.output)


if __name__ == "__main__":
    unittest.main()
