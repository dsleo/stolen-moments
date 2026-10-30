import test from 'node:test';
import assert from 'node:assert/strict';
import { validateQuery } from '../../static/listen/contracts.mjs';
import { intervalCandidates, searchCorpus, alignCandidate } from '../../static/listen/retrieval.mjs';

const base = [60, 62, 65, 64, 67, 72, 69, 71, 74, 76, 72, 70, 68, 71, 73];
function solo(pitches = base, id = 1) {
  const onsetsSeconds = pitches.map((_, i) => i * 0.25);
  return { id, performer: 'Test Player', title: 'Test Solo', album: 'Test', instrument: 'ts', year: 1950,
    pitches, onsetsSeconds, durationsSeconds: pitches.map(() => 0.2),
    beatPositions: pitches.map((_, i) => i * 0.5), recordingTimes: pitches.map(() => null), recording: null };
}
function query(pitches = base.slice(2, 12), scale = 1, transpose = 0) {
  return { schemaVersion: 1, requestId: 1, source: 'example', audioDurationSeconds: (pitches.length + 1) * 0.25 * scale,
    notes: pitches.map((pitch, i) => ({ pitch: pitch + transpose, onsetSeconds: i * 0.25 * scale, durationSeconds: 0.2 * scale })) };
}

test('query validation rejects invalid pitch, duration and short phrases', () => {
  assert.throws(() => validateQuery(query(base.slice(0, 7))), /8/);
  const bad = query(); bad.notes[2].pitch = 128;
  assert.throws(() => validateQuery(bad), /invalid/);
  const late = query(); late.notes[9].durationSeconds = 10;
  assert.throws(() => validateQuery(late), /invalid/);
});

test('interval candidates retrieve a transposed embedded phrase', () => {
  const q = query(base.slice(2, 12), 0.75, 7);
  const candidates = intervalCandidates(q, solo());
  assert.ok(candidates.some(candidate => candidate.startNote <= 2 && candidate.endNote >= 11));
});

test('search returns the correct slice and signed transposition', () => {
  const result = searchCorpus(query(base.slice(2, 12), 0.75, 7), [solo()]);
  assert.ok(result.results.length);
  const first = result.results[0];
  assert.equal(first.soloId, 1);
  assert.equal(first.startNote, 2);
  assert.equal(first.endNote, 11);
  assert.equal(first.transpositionSemitones, -7);
  assert.ok(first.score >= 0.7);
  assert.equal(first.notes[0].onsetSeconds, 0);
  assert.equal(first.recordingTimeSeconds, null);
});

test('alignment tolerates a missing note and never reports out of-range indices', () => {
  const q = query(base.slice(2, 12).filter((_, i) => i !== 5));
  const result = alignCandidate(q, solo(), 0, base.length - 1, 0, 1);
  assert.ok(result);
  assert.ok(result.pairedNotes >= 8);
  assert.ok(result.alignment.every(([i, j]) => (i === -1 || (i >= 0 && i < q.notes.length)) && (j === -1 || (j >= 0 && j < base.length))));
  assert.equal(result.gaps, result.alignment.length - result.pairedNotes);
  assert.ok(Math.abs(result.score - (1 - result.cost / (result.pairedNotes + result.gaps))) < 1e-9);
});

test('different solos remain independent and ties are deterministic', () => {
  const result = searchCorpus(query(), [solo(base, 2), solo(base, 1)]);
  assert.equal(result.results[0].soloId, 1);
  assert.equal(result.results[1].soloId, 2);
});
