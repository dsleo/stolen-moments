export const SCHEMA_VERSION = 1;
export const ALGORITHM_VERSION = 'listen-v1';
export const SETTINGS = Object.freeze({
  candidateLimit: 200,
  minCandidateRatio: 0.5,
  maxCandidateRatio: 1.5,
  maxResults: 5,
  minPaired: 8,
  minCoverage: 0.75,
  minScore: 0.70,
  maxNotes: 64,
  minNotes: 8,
});

const finite = value => typeof value === 'number' && Number.isFinite(value);

export function validateNotes(notes, audioDurationSeconds) {
  if (!Array.isArray(notes) || notes.length < SETTINGS.minNotes || notes.length > SETTINGS.maxNotes) {
    throw new Error(`Search needs ${SETTINGS.minNotes}–${SETTINGS.maxNotes} detected notes.`);
  }
  if (!finite(audioDurationSeconds) || audioDurationSeconds <= 0 || audioDurationSeconds > 120) {
    throw new Error('Invalid recording duration.');
  }
  let previous = -1;
  for (const note of notes) {
    if (!note || !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127 ||
        !finite(note.onsetSeconds) || note.onsetSeconds < 0 || note.onsetSeconds < previous ||
        !finite(note.durationSeconds) || note.durationSeconds <= 0 ||
        note.onsetSeconds + note.durationSeconds > audioDurationSeconds + 1 / 8000 ||
        (note.confidence != null && (!finite(note.confidence) || note.confidence < 0 || note.confidence > 1))) {
      throw new Error('Detected notes are invalid or outside the recording.');
    }
    previous = note.onsetSeconds;
  }
  return notes;
}

export function validateQuery(query) {
  if (!query || query.schemaVersion !== SCHEMA_VERSION ||
      !Number.isSafeInteger(query.requestId) || query.requestId < 0 ||
      !['microphone', 'upload', 'example'].includes(query.source)) {
    throw new Error('Unsupported listen search request.');
  }
  validateNotes(query.notes, query.audioDurationSeconds);
  return query;
}

export function validateCorpusSolo(solo) {
  if (!solo || !Number.isSafeInteger(solo.id) || solo.id < 0) throw new Error('Invalid corpus solo ID.');
  const arrays = ['pitches', 'onsetsSeconds', 'durationsSeconds', 'beatPositions', 'recordingTimes'];
  const n = solo.pitches?.length;
  if (!Number.isInteger(n) || n < 1 || arrays.some(name => !Array.isArray(solo[name]) || solo[name].length !== n)) {
    throw new Error(`Invalid note arrays for solo ${solo.id}.`);
  }
  let previous = -1;
  for (let i = 0; i < n; i++) {
    if (!Number.isInteger(solo.pitches[i]) || solo.pitches[i] < 0 || solo.pitches[i] > 127 ||
        !finite(solo.onsetsSeconds[i]) || solo.onsetsSeconds[i] < previous ||
        !finite(solo.durationsSeconds[i]) || solo.durationsSeconds[i] <= 0 ||
        !finite(solo.beatPositions[i]) ||
        (solo.recordingTimes[i] !== null && (!finite(solo.recordingTimes[i]) || solo.recordingTimes[i] < 0))) {
      throw new Error(`Invalid note ${i} in solo ${solo.id}.`);
    }
    previous = solo.onsetsSeconds[i];
  }
  return solo;
}
