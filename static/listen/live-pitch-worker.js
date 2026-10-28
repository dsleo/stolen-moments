import {trackMonophonicNotes} from './live-pitch.mjs';

self.onmessage = event => {
  const {type, requestId, sessionId, payload} = event.data || {};
  if (!Number.isInteger(requestId) || !Number.isInteger(sessionId) || type !== 'transcribe') return;
  try {
    const result = trackMonophonicNotes(payload?.pcm, payload?.sampleRate,
      {windowStartSeconds: payload?.windowStartSeconds ?? 0});
    self.postMessage({type: 'result', requestId, sessionId, payload: {
      ...result, rawNoteCount: result.notes.length,
      retainedNoteCount: result.notes.length,
      timings: {},
    }});
  } catch (error) {
    self.postMessage({type: 'error', requestId, sessionId,
      payload: {message: error.message || String(error)}});
  }
};
