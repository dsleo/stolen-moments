import * as tf from '@tensorflow/tfjs';
import {BasicPitch, outputToNotesPoly, noteFramesToTime} from '@spotify/basic-pitch';
import {normalizeNotes, inspectPCM, resamplePCM} from './note-normalize.mjs';

const MODEL_RATE = 22050;
let modelPromise;
let backendName;

function send(type, requestId, sessionId, payload) {
  self.postMessage({type, requestId, sessionId, payload});
}

async function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      await tf.setBackend('cpu');
      await tf.ready();
      backendName = tf.getBackend();
      if (backendName !== 'cpu') throw new Error('Local audio model backend could not start.');
      const model = new BasicPitch(new URL('./model.json', self.location.href).href);
      await model.model;
      return model;
    })().catch(error => { modelPromise = null; throw error; });
  }
  return modelPromise;
}

async function transcribe(requestId, sessionId, payload) {
  const pcm = payload?.pcm;
  const sampleRate = payload?.sampleRate;
  const windowStartSeconds = payload?.windowStartSeconds ?? 0;
  if (!(pcm instanceof Float32Array) || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000 ||
      pcm.length / sampleRate < 2 || pcm.length / sampleRate > 20.05 ||
      !Number.isFinite(windowStartSeconds) || windowStartSeconds < 0)
    throw new Error('Record or upload between 2 and 20 seconds of audio.');
  const duration = pcm.length / sampleRate;
  const signal = inspectPCM(pcm);
  if (signal.silent) {
    send('result', requestId, sessionId, {notes: [], rawNoteCount: 0, retainedNoteCount: 0,
      windowStartSeconds, windowEndSeconds: windowStartSeconds + duration,
      silent: true, clipping: false, backend: null, timings: {resampleMs: 0, inferenceMs: 0}});
    return;
  }
  send('progress', requestId, sessionId, {stage: 'loading', fraction: 0});
  const model = await loadModel();
  const t0 = performance.now();
  const resampled = resamplePCM(pcm, sampleRate, MODEL_RATE);
  const t1 = performance.now();
  send('progress', requestId, sessionId, {stage: 'transcribing', fraction: 0});
  const frames = [], onsets = [];
  tf.engine().startScope();
  try {
    await model.evaluateModel(resampled,
      (f, o) => { frames.push(...f); onsets.push(...o); },
      progress => send('progress', requestId, sessionId,
        {stage: 'transcribing', fraction: Math.max(0, Math.min(1, progress))}));
  } finally {
    tf.engine().endScope();
  }
  // Pitch bends do not influence interval search; skipping contour conversion
  // avoids retaining its large tensor output in memory.
  const raw = noteFramesToTime(outputToNotesPoly(frames, onsets, 0.25, 0.25, 5));
  const notes = normalizeNotes(raw, duration).map(note => ({...note,
    onsetSeconds: note.onsetSeconds + windowStartSeconds}));
  send('result', requestId, sessionId, {
    notes, rawNoteCount: raw.length, retainedNoteCount: notes.length,
    windowStartSeconds, windowEndSeconds: windowStartSeconds + duration,
    silent: false, clipping: signal.clippedFraction > 0.01,
    backend: backendName,
    timings: {resampleMs: Math.round(t1 - t0), inferenceMs: Math.round(performance.now() - t1)},
  });
}

self.onmessage = event => {
  const {type, requestId, sessionId, payload} = event.data || {};
  if (!Number.isInteger(requestId) || !Number.isInteger(sessionId)) return;
  if (type === 'load') {
    loadModel().then(() => send('result', requestId, sessionId,
      {loaded: true, backend: backendName})).catch(error =>
      send('error', requestId, sessionId, {message: error.message || String(error), stack: error.stack}));
  } else if (type === 'transcribe') {
    transcribe(requestId, sessionId, payload).catch(error =>
      send('error', requestId, sessionId, {message: error.message || String(error), stack: error.stack}));
  }
};
