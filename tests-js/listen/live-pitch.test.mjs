import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {trackMonophonicNotes} from '../../static/listen/live-pitch.mjs';

function render(events, seconds, sampleRate = 22050, harmonic = 0, vibrato = 0) {
  const samples = new Float32Array(Math.ceil(seconds * sampleRate));
  for (const {pitch, start, length} of events) {
    let phase = 0;
    for (let i = 0; i < Math.round(length * sampleRate); i++) {
      const at = Math.round(start * sampleRate) + i;
      if (at >= samples.length) break;
      const t = i / sampleRate;
      const hz = 440 * 2 ** ((pitch - 69 + vibrato * Math.sin(2 * Math.PI * 5 * t)) / 12);
      phase += 2 * Math.PI * hz / sampleRate;
      const envelope = Math.min(1, i / (0.015 * sampleRate),
        (length * sampleRate - i) / (0.03 * sampleRate));
      samples[at] += 0.3 * envelope * (Math.sin(phase) + harmonic * Math.sin(2 * phase));
    }
  }
  return samples;
}

test('tracks a short melodic line with source-relative absolute onsets', () => {
  const events = [69, 72, 76, 74, 71, 69, 67, 64]
    .map((pitch, i) => ({pitch, start: i * 0.36, length: 0.29}));
  const result = trackMonophonicNotes(render(events, 3), 22050, {windowStartSeconds: 10});
  assert.deepEqual(result.notes.map(note => note.pitch), events.map(event => event.pitch));
  assert.ok(result.notes[0].onsetSeconds >= 10);
  assert.ok(result.notes.at(-1).onsetSeconds < 13);
  assert.equal(result.backend, 'yin');
});

test('harmonics and moderate vibrato do not split a held note', () => {
  const events = [{pitch: 69, start: 0, length: 1.2}];
  const result = trackMonophonicNotes(render(events, 1.3, 22050, 0.45, 0.3), 22050);
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].pitch, 69);
  assert.ok(result.notes[0].durationSeconds > 1);
});

test('rest separates repeated attacks at the same pitch', () => {
  const events = [{pitch: 60, start: 0, length: 0.4},
    {pitch: 60, start: 0.6, length: 0.4}];
  const result = trackMonophonicNotes(render(events, 1.2), 22050);
  assert.deepEqual(result.notes.map(note => note.pitch), [60, 60]);
  assert.ok(result.notes[1].onsetSeconds - result.notes[0].onsetSeconds > 0.4);
});

test('silence and invalid windows return no notes or raise clear errors', () => {
  assert.deepEqual(trackMonophonicNotes(new Float32Array(22050), 22050).notes, []);
  assert.throws(() => trackMonophonicNotes(new Float32Array(22050 * 7), 22050), RangeError);
});

test('three-second live window completes quickly on this host', () => {
  const signal = render([{pitch: 69, start: 0, length: 3}], 3, 48000);
  const start = performance.now();
  const result = trackMonophonicNotes(signal, 48000);
  const elapsed = performance.now() - start;
  assert.equal(result.notes[0]?.pitch, 69);
  // Loose CI bound; measured results are recorded separately in the spike.
  assert.ok(elapsed < 3000, `live tracker took ${elapsed.toFixed(0)} ms`);
});
