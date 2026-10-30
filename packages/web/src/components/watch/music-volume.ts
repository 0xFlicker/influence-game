/** Audio-taper slider: 0 is silence, 50 is about -30 dB, 100 is full gain. */
export function musicVolumeFromSlider(percent: number): number {
  return (10 ** (3 * Math.max(0, Math.min(100, percent)) / 100) - 1) / 999;
}

/** Stored/shared volume remains linear gain; only the slider uses the taper. */
export function musicVolumeToSlider(volume: number): number {
  return Math.log1p(Math.max(0, Math.min(1, volume)) * 999) / (Math.LN10 * 3) * 100;
}
