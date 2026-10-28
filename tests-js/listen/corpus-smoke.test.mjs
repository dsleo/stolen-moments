import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { searchCorpus } from '../../static/listen/retrieval.mjs';

const catalog = new URL('../../static/catalog/listen/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', catalog)));
const solos = manifest.shards.flatMap(shard =>
  JSON.parse(gunzipSync(readFileSync(new URL(shard.path, catalog)))).solos);

test('complete WJazzD corpus yields its own transposed, time-scaled phrases', () => {
  for (const minimumId of [1, 30, 100, 200, 300, 450]) {
    const solo = solos.find(item => item.id >= minimumId && item.pitches.length >= 60);
    assert.ok(solo);
    const start = 20, count = 24, origin = solo.onsetsSeconds[start];
    const notes = solo.pitches.slice(start, start + count).map((pitch, i) => ({
      pitch: pitch + 7, onsetSeconds: (solo.onsetsSeconds[start + i] - origin) * 0.8,
      durationSeconds: solo.durationsSeconds[start + i] * 0.8,
    }));
    const query = { schemaVersion: 1, requestId: minimumId, source: 'example',
      audioDurationSeconds: notes.at(-1).onsetSeconds + notes.at(-1).durationSeconds + 0.1, notes };
    const result = searchCorpus(query, solos);
    assert.ok(result.results.some(found => found.soloId === solo.id &&
      found.startNote <= start + 2 && found.endNote >= start + count - 3),
      `solo ${solo.id} not found in top five`);
  }
});

test('one phrase remains findable with deleted, inserted or wrong notes', () => {
  const solo = solos.find(item => item.pitches.length >= 60);
  const start = 20, count = 24, origin = solo.onsetsSeconds[start];
  const base = solo.pitches.slice(start, start + count).map((pitch, i) => ({
    pitch, onsetSeconds: solo.onsetsSeconds[start + i] - origin,
    durationSeconds: solo.durationsSeconds[start + i],
  }));
  for (const kind of ['delete', 'insert', 'pitch']) {
    const notes = base.map(note => ({ ...note }));
    if (kind === 'delete') notes.splice(7, 2);
    if (kind === 'insert') {
      for (const at of [6, 15]) notes.push({ pitch: notes[at].pitch + 1,
        onsetSeconds: (notes[at].onsetSeconds + notes[at + 1].onsetSeconds) / 2,
        durationSeconds: 0.08 });
      notes.sort((a, b) => a.onsetSeconds - b.onsetSeconds);
    }
    if (kind === 'pitch') { notes[7].pitch += 1; notes[15].pitch -= 1; }
    const query = { schemaVersion: 1, requestId: 40, source: 'example',
      audioDurationSeconds: Math.max(...notes.map(note => note.onsetSeconds + note.durationSeconds)) + 0.1, notes };
    const result = searchCorpus(query, solos);
    assert.ok(result.results.some(found => found.soloId === solo.id && found.startNote <= start + 3),
      `${kind} prevented retrieval`);
  }
});
