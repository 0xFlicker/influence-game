/**
 * Repeated Chromium PNG captures can differ at antialiased rounded edges.
 * Bounds come from the unchanged renderer's two observed variants: seven pixels,
 * six channel levels, 74 total levels. These are absolute budgets, not a
 * percentage or average that could conceal a missing label in a large picture.
 * See docs/plans/evidence/render-speed-2026-11-02/clean-ballot-raster.json.
 * Used only by diagnostic capture checks, never by movie rendering or reuse.
 */
export function compareCapturePixels(expected: Uint8Array, actual: Uint8Array) {
  if (!expected.length || expected.length !== actual.length || expected.length % 4)
    throw new Error("Capture RGBA dimensions differ or are empty");
  let changedPixels = 0, maxChannelDifference = 0, totalDifference = 0;
  let alphaChanged = false;
  for (let offset = 0; offset < expected.length; offset += 4) {
    let changed = false;
    for (let channel = 0; channel < 3; channel++) {
      const difference = Math.abs(expected[offset + channel]! - actual[offset + channel]!);
      changed ||= difference > 0;
      maxChannelDifference = Math.max(maxChannelDifference, difference);
      totalDifference += difference;
    }
    alphaChanged ||= expected[offset + 3] !== actual[offset + 3];
    if (changed) changedPixels++;
  }
  return {matches: !alphaChanged && changedPixels <= 7 && maxChannelDifference <= 6 && totalDifference <= 74,
    changedPixels, maxChannelDifference, totalDifference, alphaChanged};
}
