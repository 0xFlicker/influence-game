import { describe, expect, test } from "bun:test";
import {
  compileTiming,
  parseTimingProfile,
  sampleTiming,
  type TimingInput,
} from "./timing";
const speech: TimingInput = {
  key: "speech:1",
  kind: "speech",
  baseDurationMs: 6000,
  speech: { showAtMs: 500, readAtMs: 1000, hideAtMs: 5000, hiddenAtMs: 5500 },
  thinking: null,
  order: "thinking-first",
};
describe("replay timing", () => {
  test("default is the same stage clock", () => {
    const cue = compileTiming([speech], parseTimingProfile(), 30)[0]!;
    for (const ms of [0, 500, 999, 1000, 4500, 5500, 5999])
      expect(sampleTiming(cue, ms).elapsedMs).toBe(ms);
  });
  test("thinking reserves its interval then persists through speech", () => {
    const cue = compileTiming(
      [{ ...speech, thinking: "A thought" }],
      parseTimingProfile(),
      30,
    )[0]!;
    expect(cue.endMs).toBe(8800);
    expect(sampleTiming(cue, 1500).elapsedMs).toBe(500);
    expect(sampleTiming(cue, 4500).thought?.text).toBe("A thought");
    expect(sampleTiming(cue, 8100).thought?.opacity).toBeCloseTo(0.4);
    expect(sampleTiming(cue, 8300).thought).toBeNull();
  });
  test("speech-first thought follows exit", () => {
    const cue = compileTiming(
      [{ ...speech, thinking: "A thought", order: "speech-first" }],
      parseTimingProfile(),
      30,
    )[0]!;
    expect(sampleTiming(cue, 5000).thought).toBeNull();
    expect(sampleTiming(cue, 6000).elapsedMs).toBe(5500);
    expect(sampleTiming(cue, 6000).thought?.text).toBe("A thought");
  });
  test("voice cannot be truncated by reading speed", () => {
    const cue = compileTiming(
      [{ ...speech, recording: { assetId: "voice", durationMs: 9000 } }],
      parseTimingProfile({ readingRate: 10 }),
      30,
    )[0]!;
    expect(cue.recording?.startMs).toBe(1000);
    expect(cue.speech?.hideAtMs).toBe(10000);
  });
  test("frame rounding is absolute and contiguous", () => {
    const cues = compileTiming(
      Array.from({ length: 1000 }, (_, i) => ({
        ...speech,
        key: String(i),
        baseDurationMs: 1001,
        speech: null,
      })),
      parseTimingProfile(),
      30,
    );
    expect(cues.at(-1)!.endFrame).toBe(30030);
    expect(
      cues.every((cue, i) => !i || cue.startFrame === cues[i - 1]!.endFrame),
    ).toBe(true);
  });
  test("invalid profiles and stale overrides fail", () => {
    for (const profile of [
      { readingRate: 0 },
      { foo: 1 },
      { motionScale: NaN },
      { ending: { holdMs: -1 } },
    ])
      expect(() => parseTimingProfile(profile)).toThrow();
    expect(() =>
      compileTiming(
        [speech],
        parseTimingProfile({ overrides: { missing: { readingRate: 2 } } }),
        30,
      ),
    ).toThrow("Unknown override");
  });
  test("arbitrary sampling never depends on prior frames", () => {
    const cue = compileTiming(
      [{ ...speech, thinking: "Think" }],
      parseTimingProfile({ readingRate: 1.2 }),
      30,
    )[0]!;
    const times = [4000, 0, 7000, 1000, 2500];
    const first = times.map((t) => sampleTiming(cue, t));
    times.toReversed().forEach((t) => sampleTiming(cue, t));
    expect(times.map((t) => sampleTiming(cue, t))).toEqual(first);
  });
});
