import {describe, expect, test} from "bun:test";
import {compareRecordingPcm} from "../scripts/recording-alignment";

function recording() {
  const values = new Float32Array(1000);
  // A changing frequency prevents a periodic tone from hiding an incorrect seek.
  for (let sample = 100; sample < 800; sample++) values[sample] = Math.sin(sample * sample * .013) * .25;
  return values;
}
function delayed(source: Float32Array, offset: number) {
  const actual = Array<number>(source.length + 100).fill(0);
  for (let sample = 0; sample < source.length; sample++) {
    if (sample + offset >= 0) actual[sample + offset] = source[sample]!;
  }
  return actual;
}

describe("encoded recording alignment", () => {
  test("reports signed codec delay within the explicit bound", () => {
    const expected = recording();
    for (const offset of [-42, 0, 43]) {
      const result = compareRecordingPcm(expected, delayed(expected, offset), 1000, 83);
      expect(result.offsetMs).toBe(offset);
      expect(result.maximumOffsetMs).toBe(83);
      expect(result.correlation).toBeCloseTo(1);
      expect(result.relativeError).toBeCloseTo(0);
    }
  });
  test("cannot search beyond the permitted codec and output-frame budget", () => {
    const expected = recording();
    const result = compareRecordingPcm(expected, delayed(expected, 90), 1000, 83);
    expect(Math.abs(result.offsetMs)).toBeLessThanOrEqual(83);
    expect(result.correlation).toBeLessThan(.95);
  });
  test("detects different audio, wrong gain and silence", () => {
    const expected = recording();
    expect(compareRecordingPcm(expected, [...recording()].reverse(), 1000, 83).correlation).toBeLessThan(.95);
    expect(compareRecordingPcm(expected, [...expected].map(value => value * .5), 1000, 83).relativeError).toBeCloseTo(.5);
    expect(compareRecordingPcm(expected, Array(1000).fill(0), 1000, 83).relativeError).toBe(1);
  });
});
