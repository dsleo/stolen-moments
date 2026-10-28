import {resamplePCM, inspectPCM} from './note-normalize.mjs';

const ANALYSIS_RATE = 11025;
const FRAME = 1024;
const HOP = 128;
const MIN_HZ = 90;
const MAX_HZ = 1100;

function yinFrequency(samples, offset) {
  const tauMin = Math.floor(ANALYSIS_RATE / MAX_HZ);
  const tauMax = Math.ceil(ANALYSIS_RATE / MIN_HZ);
  const difference = new Float32Array(tauMax + 1);
  for (let tau = tauMin; tau <= tauMax; tau++) {
    let total = 0;
    for (let j = 0; j < FRAME - tau; j++) {
      const delta = samples[offset + j] - samples[offset + j + tau];
      total += delta * delta;
    }
    difference[tau] = total;
  }
  let cumulative = 0;
  let bestTau = 0, bestValue = Infinity;
  const normalized = new Float32Array(tauMax + 1);
  for (let tau = tauMin; tau <= tauMax; tau++) {
    cumulative += difference[tau];
    const value = cumulative > 0 ? difference[tau] * (tau - tauMin + 1) / cumulative : 1;
    normalized[tau] = value;
    if (value < bestValue) { bestValue = value; bestTau = tau; }
    if (tau > tauMin && normalized[tau - 1] < 0.16 && normalized[tau - 1] <= value) {
      bestTau = tau - 1;
      bestValue = normalized[bestTau];
      break;
    }
  }
  if (!bestTau || bestValue > 0.23) return null;
  const left = normalized[Math.max(tauMin, bestTau - 1)];
  const middle = normalized[bestTau];
  const right = normalized[Math.min(tauMax, bestTau + 1)];
  const denominator = left - 2 * middle + right;
  const delta = Math.abs(denominator) > 1e-6 ?
    Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / denominator)) : 0;
  const hz = ANALYSIS_RATE / (bestTau + delta);
  return {hz, clarity: Math.max(0, Math.min(1, 1 - bestValue))};
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Fast monophonic tracker for short live chunks. Times are relative to capture. */
export function trackMonophonicNotes(pcm, sampleRate, {windowStartSeconds = 0} = {}) {
  if (!(pcm instanceof Float32Array) || !Number.isFinite(sampleRate) || sampleRate < 8000 ||
      sampleRate > 192000 || !Number.isFinite(windowStartSeconds) || windowStartSeconds < 0)
    throw new TypeError('Invalid live audio window.');
  if (pcm.length / sampleRate > 6) throw new RangeError('Live windows must be at most six seconds.');
  const duration = pcm.length / sampleRate;
  const signal = inspectPCM(pcm);
  if (signal.silent || duration < 0.25) return {notes: [], silent: true,
    windowStartSeconds, windowEndSeconds: windowStartSeconds + duration};
  const input = resamplePCM(pcm, sampleRate, ANALYSIS_RATE);
  const frames = [];
  for (let offset = 0; offset + FRAME <= input.length; offset += HOP) {
    let power = 0;
    for (let j = 0; j < FRAME; j++) power += input[offset + j] ** 2;
    const rms = Math.sqrt(power / FRAME);
    const pitch = rms >= 0.008 ? yinFrequency(input, offset) : null;
    frames.push({time: (offset + FRAME / 2) / ANALYSIS_RATE,
      pitch: pitch ? 69 + 12 * Math.log2(pitch.hz / 440) : null,
      clarity: pitch?.clarity ?? 0, rms});
  }
  // A three-frame median removes isolated octave jumps while leaving clear
  // note transitions within about 35 ms.
  for (let i = 0; i < frames.length; i++) {
    const neighbors = frames.slice(Math.max(0, i - 1), Math.min(frames.length, i + 2))
      .map(frame => frame.pitch).filter(Number.isFinite);
    frames[i].smoothed = neighbors.length >= 2 ? median(neighbors) : frames[i].pitch;
  }
  const notes = [];
  let run = null;
  const endRun = time => {
    if (!run) return;
    const length = time - run.start;
    if (length >= 0.075) notes.push({pitch: run.pitch,
      onsetSeconds: Math.max(windowStartSeconds, windowStartSeconds + run.start - FRAME / ANALYSIS_RATE / 2),
      durationSeconds: length,
      confidence: Math.min(1, run.clarity / run.frames),
      originalIndex: notes.length});
    run = null;
  };
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const pitch = Number.isFinite(frame.smoothed) ? Math.round(frame.smoothed) : null;
    if (pitch === null) { endRun(frame.time); continue; }
    if (run && Math.abs(frame.smoothed - run.pitch) < 0.65) {
      run.frames++;
      run.clarity += frame.clarity;
      continue;
    }
    // Require two frames before accepting a pitch change to avoid vibrato
    // producing multiple notes.
    const next = frames[i + 1]?.smoothed;
    if (run && (!Number.isFinite(next) || Math.abs(next - pitch) >= 0.65)) continue;
    endRun(frame.time);
    run = {pitch, start: frame.time, frames: 1, clarity: frame.clarity};
  }
  endRun(Math.min(duration, frames.at(-1)?.time + HOP / ANALYSIS_RATE || duration));
  for (const note of notes) {
    note.durationSeconds = Math.min(note.durationSeconds,
      Math.max(0, windowStartSeconds + duration - note.onsetSeconds));
  }
  return {notes: notes.filter(note => note.durationSeconds >= 0.05),
    silent: false, clipping: signal.clippedFraction > 0.01,
    windowStartSeconds, windowEndSeconds: windowStartSeconds + duration,
    backend: 'yin'};
}
