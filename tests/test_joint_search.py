import unittest

from jazzmine.evaluation import _synthetic_solo
from jazzmine.joint_search import Settings, anchors, extend, remove_contained
from jazzmine.mining import _record


BASE = [2, 2, 1, 2, 2, -3, 4, -2, 1, 3, -1, 2, -4, 3, 1]


class JointSearchTests(unittest.TestCase):
    def test_transposition_and_unbounded_clean_extension(self):
        a = _synthetic_solo(1, BASE * 4)
        b = _synthetic_solo(2, BASE * 4, 5)
        result, explored = extend(a, b, 0, 0)
        self.assertEqual((result.paired, result.gaps, result.cost), (61, 0, 0))
        self.assertEqual(result.transposition, 5)
        self.assertGreater(explored, 0)

    def test_extra_note_after_anchor_restores_clean_alignment(self):
        a = _synthetic_solo(1, BASE)
        b = _synthetic_solo(2, BASE, 5)
        # One extra note between the six-note anchor and its continuation.
        b.pitches.insert(6, b.pitches[5] + 1)
        b.onsets = [x * .25 for x in range(len(b.pitches))]
        b.beat_positions = [x * .5 for x in range(len(b.pitches))]
        b.durations.insert(6, .2)
        b._intervals = None
        result, _ = extend(a, b, 0, 0)
        self.assertIn((-1, 6), result.alignment)
        self.assertEqual(result.paired, len(a.pitches))
        self.assertEqual(result.gaps, 1)

    def test_two_note_ornament_is_recovered_beyond_old_greedy_extension(self):
        a = _synthetic_solo(1, BASE)
        b = _synthetic_solo(2, BASE, 5)
        # Put two short ornament notes between anchor note 5 and note 6.
        b.pitches[6:6] = [b.pitches[5] + 1, b.pitches[5] + 2]
        b.onsets[6:6] = [1.3, 1.4]
        b.beat_positions[6:6] = [2.6, 2.8]
        b.durations[6:6] = [.08, .08]
        b._intervals = None
        new, _ = extend(a, b, 0, 0)
        old = _record(a, b, 0, 0, 5, 1)
        self.assertEqual(new.paired, len(a.pitches))
        self.assertEqual(new.gaps, 2)
        self.assertIsNone(old)

    def test_anchor_is_exact_and_only_five_intervals_are_indexed(self):
        a = _synthetic_solo(1, BASE)
        b = _synthetic_solo(2, BASE, 3)
        self.assertIn((1, 2, 0, 0), set(anchors({1: a, 2: b})))
        b.pitches[2] += 1
        b._intervals = None
        with self.assertRaises(ValueError):
            extend(a, b, 0, 0)

    def test_total_budget_and_consecutive_budget(self):
        a = _synthetic_solo(1, BASE)
        b = _synthetic_solo(2, BASE, 4)
        b.pitches[6] += 4
        b.pitches[7] += 4
        b._intervals = None
        strict, _ = extend(a, b, 0, 0, Settings(run_budget=.5))
        loose, _ = extend(a, b, 0, 0, Settings(run_budget=2))
        self.assertIsNone(strict)
        self.assertIsNotNone(loose)

    def test_containment_does_not_remove_crossing_overlaps(self):
        from jazzmine.joint_search import Passage
        def p(a0, a1, b0, b1):
            return Passage(1, 2, a0, a1, b0, b1, 8, 0, 0, 0, ())
        outer = p(0, 15, 0, 15)
        inner = p(2, 10, 2, 10)
        crossing = p(8, 20, 8, 20)
        self.assertEqual(set(remove_contained([outer, inner, crossing])), {outer, crossing})

if __name__ == "__main__":
    unittest.main()


def test_consolidate_merges_shifted_windows_only():
    import sqlite3
    from jazzmine.joint_store import consolidate
    db = sqlite3.connect(":memory:")
    db.execute("""CREATE TABLE candidate (a_id,b_id,a_start,a_end,b_start,b_end,evidence)""")
    db.executemany("INSERT INTO candidate VALUES (1,2,?,?,?,?,?)", [
        (514, 539, 369, 394, 22.0), (516, 542, 368, 394, 23.3), (519, 545, 368, 394, 23.3),
        (66, 74, 117, 125, 6.1), (460, 468, 49, 57, 6.5)])
    assert consolidate(db) == 2
    assert db.execute("SELECT COUNT(*) FROM candidate").fetchone()[0] == 3
