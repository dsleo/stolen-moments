import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeNotes, inspectPCM, resamplePCM} from '../../static/listen/note-normalize.mjs';

test('keeps distinct repeated attacks and chooses the stronger simultaneous pitch', () => {
  const notes = normalizeNotes([
    {pitchMidi: 60, startTimeSeconds: 0, durationSeconds: 0.4, amplitude: 0.4},
    {pitchMidi: 64, startTimeSeconds: 0.01, durationSeconds: 0.4, amplitude: 0.8},
    {pitchMidi: 64, startTimeSeconds: 0.5, durationSeconds: 0.3, amplitude: 0.7},
  ], 1);
  assert.deepEqual(notes.map(note => note.pitch), [64, 64]);
  assert.ok(notes[0].durationSeconds <= 0.5);
  assert.ok(notes[0].onsetSeconds < notes[1].onsetSeconds);
});

test('drops malformed, tiny and out-of-buffer notes', () => {
  const notes = normalizeNotes([
    {pitchMidi: 128, startTimeSeconds: 0, durationSeconds: 0.2},
    {pitchMidi: 60, startTimeSeconds: 0, durationSeconds: 0.02},
    {pitchMidi: 60, startTimeSeconds: 3, durationSeconds: 0.2},
    {pitchMidi: 61, startTimeSeconds: 0.1, durationSeconds: 0.2},
  ], 1);
  assert.deepEqual(notes.map(note => note.pitch), [61]);
});

test('joins Basic Pitch fragments but preserves a repeated attack after a rest', () => {
  const notes = normalizeNotes([
    {pitchMidi: 63, startTimeSeconds: 0, durationSeconds: 0.22, amplitude: 0.8},
    {pitchMidi: 63, startTimeSeconds: 0.22, durationSeconds: 0.07, amplitude: 0.7},
    {pitchMidi: 63, startTimeSeconds: 0.34, durationSeconds: 0.12, amplitude: 0.8},
  ], 1);
  assert.equal(notes.length, 2);
  assert.ok(Math.abs(notes[0].durationSeconds - 0.29) < 0.001);
  assert.equal(notes[1].onsetSeconds, 0.34);
});

test('reports silence and clipping from PCM', () => {
  assert.equal(inspectPCM(new Float32Array(100)).silent, true);
  const signal = new Float32Array(100);
  signal.fill(1);
  assert.equal(inspectPCM(signal).silent, false);
  assert.equal(inspectPCM(signal).clippedFraction, 1);
  assert.throws(() => inspectPCM(new Float32Array([NaN])));
});

test('resampling preserves tone frequency and suppresses out-of-band input', () => {
  const sr = 48000, length = sr;
  const low = new Float32Array(length);
  const high = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    low[i] = Math.sin(2 * Math.PI * 440 * i / sr);
    high[i] = Math.sin(2 * Math.PI * 15000 * i / sr);
  }
  const output = resamplePCM(low, sr);
  assert.equal(output.length, 22050);
  let error = 0;
  for (let i = 100; i < 21950; i++) error += Math.abs(output[i] - Math.sin(2 * Math.PI * 440 * i / 22050));
  assert.ok(error / 21850 < 0.01);
  const alias = resamplePCM(high, sr);
  let power = 0;
  for (const x of alias) power += x * x;
  assert.ok(Math.sqrt(power / alias.length) < 0.05);
});
