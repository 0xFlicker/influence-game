/** Compare decoded recording PCM with its compiled placement, allowing a bounded codec delay. */
export function compareRecordingPcm(
  expected: Float32Array,
  actual: readonly number[],
  sampleRate: number,
  maximumOffsetMs: number,
) {
  const limit = Math.floor(maximumOffsetMs * sampleRate / 1000);
  const active: number[] = [];
  let energy = 0;
  for (let sample = 0; sample < expected.length; sample++) {
    const value = expected[sample]!;
    if (value !== 0) active.push(sample);
    energy += value * value;
  }
  if (!energy || !Number.isFinite(energy)) throw new Error("Scheduled recording PCM must have finite nonzero energy");
  const accumulated = new Float64Array(actual.length + 1);
  for (let sample = 0; sample < actual.length; sample++) {
    const value = actual[sample]!;
    if (!Number.isFinite(value)) throw new Error("Encoded recording PCM must contain finite samples");
    accumulated[sample + 1] = accumulated[sample]! + value * value;
  }
  let best = {offsetSamples: 0, correlation: -Infinity, relativeError: Infinity};
  for (let offset = -limit; offset <= limit; offset++) {
    let dot = 0;
    for (const sample of active) dot += expected[sample]! * (actual[sample + offset] ?? 0);
    const start = Math.max(0, Math.min(actual.length, offset));
    const end = Math.max(start, Math.min(actual.length, expected.length + offset));
    const actualEnergy = accumulated[end]! - accumulated[start]!;
    const correlation = actualEnergy ? dot / Math.sqrt(energy * actualEnergy) : 0;
    const relativeError = Math.sqrt(Math.max(0, actualEnergy + energy - 2 * dot) / energy);
    if (correlation > best.correlation || correlation === best.correlation && Math.abs(offset) < Math.abs(best.offsetSamples))
      best = {offsetSamples: offset, correlation, relativeError};
  }
  return {...best, offsetMs: best.offsetSamples * 1000 / sampleRate, maximumOffsetMs, sampleRate};
}
