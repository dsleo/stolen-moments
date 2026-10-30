import { ALGORITHM_VERSION, SETTINGS, validateCorpusSolo, validateQuery } from './contracts.mjs';

const EPS = 1e-9;
const cmp = (a, b) => a - b;
const overlap = (a, b) => Math.max(0, Math.min(a.endNote, b.endNote) - Math.max(a.startNote, b.startNote) + 1);
const overlapRatio = (a, b) => overlap(a, b) / Math.min(a.endNote - a.startNote + 1, b.endNote - b.startNote + 1);
const median = values => {
  const sorted = values.filter(v => Number.isFinite(v) && v > 0).sort(cmp);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** All subsequence interval endpoints; no exact seed is required. */
export function intervalCandidates(query, solo) {
  const q = query.notes;
  const p = solo.pitches;
  if (q.length < 2 || p.length < 2) return [];
  const m = q.length - 1;
  const n = p.length - 1;
  let prev = Float32Array.from({ length: n + 1 }, () => 0);
  let current = new Float32Array(n + 1);
  let prevStart = Int32Array.from({ length: n + 1 }, (_, j) => j);
  let currentStart = new Int32Array(n + 1);
  for (let i = 1; i <= m; i++) {
    current[0] = i * 0.8;
    currentStart[0] = 0;
    const qi = q[i].pitch - q[i - 1].pitch;
    for (let j = 1; j <= n; j++) {
      const cj = p[j] - p[j - 1];
      let cost = prev[j - 1] + Math.min(Math.abs(qi - cj) / 3, 1);
      let start = i === 1 ? j - 1 : prevStart[j - 1];
      const deleted = prev[j] + 0.8;
      if (deleted < cost - EPS) { cost = deleted; start = prevStart[j]; }
      const inserted = current[j - 1] + 0.8;
      if (inserted < cost - EPS) { cost = inserted; start = currentStart[j - 1]; }
      current[j] = cost;
      currentStart[j] = start;
    }
    [prev, current] = [current, prev];
    [prevStart, currentStart] = [currentStart, prevStart];
  }
  const candidates = [];
  for (let end = 1; end <= n; end++) {
    const start = prevStart[end];
    const span = end - start + 1;
    if (span < q.length * SETTINGS.minCandidateRatio || span > q.length * SETTINGS.maxCandidateRatio) continue;
    candidates.push({ solo, soloId: solo.id, startNote: start, endNote: end, coarseCost: prev[end] / m });
  }
  candidates.sort((a, b) => a.coarseCost - b.coarseCost || a.startNote - b.startNote || a.endNote - b.endNote);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.every(old => overlapRatio(old, candidate) < 0.8)) selected.push(candidate);
    if (selected.length >= 12) break;
  }
  return selected;
}

export function selectCandidatesFromPool(candidates, limit = SETTINGS.candidateLimit) {
  candidates.sort((a, b) => a.coarseCost - b.coarseCost || a.soloId - b.soloId || a.startNote - b.startNote || a.endNote - b.endNote);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.every(old => old.soloId !== candidate.soloId || overlapRatio(old, candidate) < 0.8)) selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function selectCandidates(query, solos, limit = SETTINGS.candidateLimit) {
  const candidates = [];
  for (const solo of solos) candidates.push(...intervalCandidates(query, solo));
  return selectCandidatesFromPool(candidates, limit);
}

function trialShifts(query, solo, start, end) {
  const histogram = new Map();
  const q = query.notes;
  const span = end - start;
  for (let i = 0; i < q.length; i++) {
    const expected = start + Math.round(i * span / Math.max(1, q.length - 1));
    for (let delta = -1; delta <= 1; delta++) {
      const j = expected + delta;
      if (j >= start && j <= end) {
        const shift = solo.pitches[j] - q[i].pitch;
        histogram.set(shift, (histogram.get(shift) || 0) + 1);
      }
    }
  }
  return [...histogram].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]) || a[0] - b[0]).slice(0, 3).map(v => v[0]);
}

function trialScales(query, solo, start, end) {
  const q = query.notes;
  const qDiffs = q.slice(1).map((note, i) => note.onsetSeconds - q[i].onsetSeconds);
  const sDiffs = solo.onsetsSeconds.slice(start + 1, end + 1).map((time, i) => time - solo.onsetsSeconds[start + i]);
  const qMedian = median(qDiffs) || 0.2;
  const sMedian = median(sDiffs) || 0.2;
  const base = sMedian / qMedian;
  return [0.8, 0.9, 1, 1.1, 1.25].map(x => base * x).filter(v => Number.isFinite(v) && v > 0);
}

const bounded = value => Math.min(1, Math.max(0, value - 0.125) / 0.5);
function pairCost(query, solo, i, j, previousI, previousJ, shift, scale, beatsPerSecond) {
  const q = query.notes[i];
  const pitch = Math.min(Math.abs(q.pitch + shift - solo.pitches[j]) / 2, 1);
  const duration = bounded(Math.abs(q.durationSeconds * scale - solo.durationsSeconds[j]) * beatsPerSecond);
  let timing = 0;
  if (previousI >= 0) {
    const qGapBeats = (q.onsetSeconds - query.notes[previousI].onsetSeconds) * scale * beatsPerSecond;
    const cGapBeats = solo.beatPositions[j] - solo.beatPositions[previousJ];
    timing = bounded(Math.abs(cGapBeats - qGapBeats));
  }
  return 0.5 * pitch + 0.25 * timing + 0.25 * duration;
}

function fastCost(query, solo, start, end, shift, scale) {
  const q = query.notes;
  const cn = end - start + 1;
  let prev = new Float32Array(cn + 1);
  let curr = new Float32Array(cn + 1);
  for (let i = 1; i <= q.length; i++) {
    curr[0] = i * 0.8;
    for (let j = 1; j <= cn; j++) {
      const c = start + j - 1;
      const pitch = Math.min(Math.abs(q[i - 1].pitch + shift - solo.pitches[c]) / 2, 1);
      const duration = Math.min(Math.abs(Math.log2(Math.max(0.02, solo.durationsSeconds[c]) /
        (Math.max(0.02, q[i - 1].durationSeconds) * scale))), 1);
      const timing = i > 1 && j > 1 ? Math.min(Math.abs(Math.log2(
        Math.max(0.02, solo.onsetsSeconds[c] - solo.onsetsSeconds[c - 1]) /
        (Math.max(0.02, q[i - 1].onsetSeconds - q[i - 2].onsetSeconds) * scale))), 1) : 0;
      curr[j] = Math.min(prev[j - 1] + 0.65 * pitch + 0.25 * timing + 0.10 * duration,
        prev[j] + 0.8, curr[j - 1] + 0.8);
    }
    [prev, curr] = [curr, prev];
  }
  let best = Infinity;
  for (let j = 1; j <= cn; j++) best = Math.min(best, prev[j]);
  return best;
}

export function fastCandidateCost(query, candidate) {
  const solo = candidate.solo;
  const start = Math.max(0, candidate.startNote - 2);
  const end = Math.min(solo.pitches.length - 1, candidate.endNote + 2);
  const shifts = trialShifts(query, solo, start, end);
  const scales = trialScales(query, solo, start, end);
  let best = Infinity;
  for (const shift of shifts) for (const scale of scales) best = Math.min(best, fastCost(query, solo, start, end, shift, scale));
  return best / query.notes.length;
}

/** Beam alignment retaining last paired indices, needed for timing after skips. */
export function alignCandidate(query, solo, start, end, shift, scale) {
  const qn = query.notes.length;
  const cn = end - start + 1;
  if (!cn) return null;
  const seconds = solo.onsetsSeconds[end] - solo.onsetsSeconds[start];
  const beats = solo.beatPositions[end] - solo.beatPositions[start];
  const beatsPerSecond = seconds > 0 && beats > 0 ? beats / seconds : 2;
  const rows = Array.from({ length: qn + 1 }, () => Array.from({ length: cn + 1 }, () => []));
  for (let j = 0; j < Math.min(cn, 3); j++) rows[0][j].push({ i: 0, j, lastI: -1, lastJ: -1, skipQ: 0, skipC: 0, cost: 0, paired: 0, alignment: [] });
  const add = (i, j, state) => {
    if (i > qn || j > cn) return;
    const bucket = rows[i][j];
    const key = `${state.lastI},${state.lastJ},${state.skipQ},${state.skipC}`;
    const at = bucket.findIndex(old => old.key === key);
    state.key = key;
    if (at >= 0) {
      if (bucket[at].cost <= state.cost + EPS) return;
      bucket.splice(at, 1);
    }
    bucket.push(state);
    bucket.sort((a, b) => a.cost - b.cost || b.paired - a.paired);
    if (bucket.length > 6) bucket.length = 6;
  };
  for (let i = 0; i <= qn; i++) for (let j = 0; j <= cn; j++) {
    const states = rows[i][j];
    for (const s of states) {
      if (i < qn && j < cn) {
        const absolute = start + j;
        add(i + 1, j + 1, { lastI: i, lastJ: absolute, skipQ: 0, skipC: 0,
          cost: s.cost + pairCost(query, solo, i, absolute, s.lastI, s.lastJ, shift, scale, beatsPerSecond),
          paired: s.paired + 1, alignment: [...s.alignment, [i, absolute]] });
      }
      if (i < qn && s.skipQ < 2) add(i + 1, j, { ...s, skipQ: s.skipQ + 1, skipC: 0,
        cost: s.cost + 1, alignment: [...s.alignment, [i, -1]] });
      if (j < cn && i > 0 && s.skipC < 2) add(i, j + 1, { ...s, skipC: s.skipC + 1, skipQ: 0,
        cost: s.cost + 1, alignment: [...s.alignment, [-1, start + j]] });
    }
  }
  const finals = [];
  for (let j = 0; j <= cn; j++) finals.push(...rows[qn][j]);
  finals.sort((a, b) => a.cost - b.cost || b.paired - a.paired || a.alignment.length - b.alignment.length);
  const winner = finals[0];
  if (!winner || !winner.paired) return null;
  const paired = winner.alignment.filter(([qi, cj]) => qi >= 0 && cj >= 0);
  const gaps = winner.alignment.length - winner.paired;
  return { cost: winner.cost, pairedNotes: winner.paired, alignment: winner.alignment,
    startNote: paired[0][1], endNote: paired.at(-1)[1],
    queryCoverage: winner.paired / qn, gaps, score: Math.max(0, 1 - winner.cost / (winner.paired + gaps)),
    transpositionSemitones: shift, tempoScale: scale };
}

export function rerankCandidate(query, candidate) {
  const solo = candidate.solo;
  const start = Math.max(0, candidate.startNote - 2);
  const end = Math.min(solo.pitches.length - 1, candidate.endNote + 2);
  const shifts = trialShifts(query, solo, start, end);
  const scales = trialScales(query, solo, start, end);
  let best = null;
  for (const shift of shifts) for (const scale of scales) {
    const aligned = alignCandidate(query, solo, start, end, shift, scale);
    if (aligned && (!best || aligned.cost < best.cost - EPS ||
        (Math.abs(aligned.cost - best.cost) < EPS && aligned.pairedNotes > best.pairedNotes))) best = aligned;
  }
  if (!best) return null;
  const notes = [];
  const offset = solo.onsetsSeconds[best.startNote];
  for (let i = best.startNote; i <= best.endNote; i++) notes.push({
    index: i, pitch: solo.pitches[i], onsetSeconds: solo.onsetsSeconds[i] - offset,
    durationSeconds: solo.durationsSeconds[i],
  });
  return { soloId: solo.id, ...best, performer: solo.performer, title: solo.title,
    album: solo.album, instrument: solo.instrument, year: solo.year, notes,
    recording: solo.recording || null,
    recordingTimeSeconds: solo.recordingTimes[best.startNote] ?? null };
}

export function selectResults(ranked) {
  ranked = ranked.filter(result => result && result.pairedNotes >= SETTINGS.minPaired &&
    result.queryCoverage >= SETTINGS.minCoverage && result.score >= SETTINGS.minScore);
  ranked.sort((a, b) => b.score - a.score || b.pairedNotes - a.pairedNotes || a.soloId - b.soloId || a.startNote - b.startNote);
  const results = [];
  for (const result of ranked) {
    if (results.every(old => old.soloId !== result.soloId || overlapRatio(old, result) < 0.5)) results.push(result);
    if (results.length === SETTINGS.maxResults) break;
  }
  return results;
}

export function searchCorpus(query, solos, { candidateLimit = SETTINGS.candidateLimit } = {}) {
  validateQuery(query);
  for (const solo of solos) validateCorpusSolo(solo);
  const started = performance.now();
  const candidates = selectCandidates(query, solos, candidateLimit);
  const retrievedAt = performance.now();
  const fastRanked = candidates.map(candidate => ({ candidate, cost: fastCandidateCost(query, candidate) }))
    .sort((a, b) => a.cost - b.cost || a.candidate.coarseCost - b.candidate.coarseCost ||
      a.candidate.soloId - b.candidate.soloId || a.candidate.startNote - b.candidate.startNote);
  const fullLimit = fastRanked[0]?.cost <= 0.1 ? 12 : 24;
  const ranked = fastRanked.slice(0, fullLimit).map(({ candidate }) => rerankCandidate(query, candidate));
  const results = selectResults(ranked);
  return { algorithmVersion: ALGORITHM_VERSION, queryNoteCount: query.notes.length,
    candidateCount: candidates.length,
    timings: { candidateMs: retrievedAt - started, rerankMs: performance.now() - retrievedAt }, results };
}
