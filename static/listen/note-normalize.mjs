/** Convert Basic Pitch note events into a single ordered melodic line. */
export function normalizeNotes(events, audioDurationSeconds, options = {}) {
  const minDuration = options.minDurationSeconds ?? 0.05;
  const onsetTolerance = options.onsetToleranceSeconds ?? 0.03;
  if (!Array.isArray(events) || !Number.isFinite(audioDurationSeconds) || audioDurationSeconds <= 0)
    throw new TypeError('Invalid transcription input.');
  const valid = events.map((event, originalIndex) => {
    const pitch = event?.pitchMidi ?? event?.pitch;
    const onset = event?.startTimeSeconds ?? event?.onsetSeconds;
    const duration = event?.durationSeconds;
    const amplitude = event?.amplitude ?? event?.confidence ?? null;
    if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127 ||
        !Number.isFinite(onset) || !Number.isFinite(duration) ||
        onset < -0.02 || duration < minDuration || onset >= audioDurationSeconds + 0.02) return null;
    const clippedOnset = Math.max(0, onset);
    const clippedDuration = Math.min(duration, audioDurationSeconds - clippedOnset);
    if (clippedDuration < minDuration) return null;
    return {pitch, onsetSeconds: clippedOnset, durationSeconds: clippedDuration,
      confidence: Number.isFinite(amplitude) ? Math.max(0, Math.min(1, amplitude)) : null,
      originalIndex};
  }).filter(Boolean).sort((a, b) => a.onsetSeconds - b.onsetSeconds ||
    (b.confidence ?? -1) - (a.confidence ?? -1) || a.pitch - b.pitch || a.originalIndex - b.originalIndex);
  const selected = [];
  for (const event of valid) {
    const previous = selected.at(-1);
    if (previous && event.onsetSeconds - previous.onsetSeconds < onsetTolerance) {
      if ((event.confidence ?? -1) > (previous.confidence ?? -1)) selected[selected.length - 1] = event;
      continue;
    }
    selected.push(event);
  }
  // Basic Pitch often emits one held tone as several adjacent note events.
  // Join same-pitch pieces when the audio has no clear break between them.
  // A discernible rest remains a separate repeated attack.
  const joined = [];
  for (const event of selected) {
    const previous = joined.at(-1);
    const gap = previous ? event.onsetSeconds -
      (previous.onsetSeconds + previous.durationSeconds) : Infinity;
    if (previous && previous.pitch === event.pitch && gap <= 0.025) {
      previous.durationSeconds = Math.max(previous.durationSeconds,
        event.onsetSeconds + event.durationSeconds - previous.onsetSeconds);
      previous.confidence = Math.max(previous.confidence ?? 0, event.confidence ?? 0);
    } else joined.push(event);
  }
  for (let i = 0; i < joined.length - 1; i++) {
    const current = joined[i], next = joined[i + 1];
    current.durationSeconds = Math.min(current.durationSeconds,
      Math.max(0, next.onsetSeconds - current.onsetSeconds));
  }
  return joined.filter(event => event.durationSeconds >= minDuration);
}

export function inspectPCM(pcm) {
  if (!(pcm instanceof Float32Array)) throw new TypeError('PCM must be Float32Array.');
  let sum = 0, peak = 0, clipped = 0;
  for (const x of pcm) {
    if (!Number.isFinite(x)) throw new TypeError('PCM contains a nonfinite sample.');
    sum += x * x;
    peak = Math.max(peak, Math.abs(x));
    if (Math.abs(x) >= 0.99) clipped++;
  }
  const rms = Math.sqrt(sum / Math.max(1, pcm.length));
  return {rms, peak, clippedFraction: clipped / Math.max(1, pcm.length),
    silent: peak < 0.003 && rms < 0.001};
}

/** Windowed-sinc low-pass resampler; handles 44.1/48 kHz mic input. */
export function resamplePCM(pcm, sourceRate, targetRate = 22050) {
  if (!(pcm instanceof Float32Array) || !Number.isFinite(sourceRate) ||
      !Number.isFinite(targetRate) || sourceRate <= 0 || targetRate <= 0)
    throw new TypeError('Invalid resampling input.');
  if (sourceRate === targetRate) return pcm;
  const output = new Float32Array(Math.round(pcm.length * targetRate / sourceRate));
  const cutoff = Math.min(1, targetRate / sourceRate) * 0.9;
  const radius = 24;
  for (let i = 0; i < output.length; i++) {
    const sourcePos = i * sourceRate / targetRate;
    const base = Math.floor(sourcePos);
    let weighted = 0, norm = 0;
    for (let j = base - radius + 1; j <= base + radius; j++) {
      if (j < 0 || j >= pcm.length) continue;
      const delta = sourcePos - j;
      const sinc = delta === 0 ? cutoff : Math.sin(Math.PI * cutoff * delta) / (Math.PI * delta);
      const window = 0.5 + 0.5 * Math.cos(Math.PI * delta / radius);
      const coefficient = sinc * window;
      weighted += pcm[j] * coefficient;
      norm += coefficient;
    }
    output[i] = norm ? weighted / norm : 0;
  }
  return output;
}
