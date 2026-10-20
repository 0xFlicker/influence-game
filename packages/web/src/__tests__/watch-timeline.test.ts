import {expect, test} from "bun:test";
import {compileWatchTimeline, WATCH_FPS, watchFrameTarget} from "../components/watch/watch-timeline";
test("thought-only passes add only their captured thinking duration", () => {
 const cues = [{key:"pass",baseDurationMs:0,thinkingOnly:true as const},{key:"speech",baseDurationMs:1000}];
 expect(compileWatchTimeline(cues, () => null).map(cue => cue.key)).toEqual(["speech"]);
 const timeline = compileWatchTimeline(cues, key => key === "pass" ? "No new point." : null);
 expect(timeline[0]!.segments.map(segment => segment.kind)).toEqual(["thinking"]);
 expect(timeline[0]!.endMs).toBe(5250);
 expect(timeline[1]!.startMs).toBe(5250);
});

test("frames use elapsed presentation time, including positions inside unequal cues", () => {
  const timeline = compileWatchTimeline([{key: "short", baseDurationMs: 1000}, {key: "long", baseDurationMs: 9000}], () => null);
  expect(timeline.at(-1)?.endFrame).toBe(300);
  expect(watchFrameTarget(timeline, 150)).toEqual({key: "long", index: 1, elapsedMs: 4000});
  expect(watchFrameTarget(timeline, 30)?.elapsedMs).toBe(0);
  expect(watchFrameTarget(timeline, 999)?.elapsedMs).toBeCloseTo(8966.6666667);
});

test("fractional cue durations share absolute frame rounding with Studio without cumulative drift", () => {
  const cues = Array.from({length: 1000}, (_, i) => ({key: `${i}`, baseDurationMs: 1001}));
  const timeline = compileWatchTimeline(cues, () => null);
  expect(timeline.at(-1)?.endFrame).toBe(30030);
  for (const cue of timeline) {
    const target = watchFrameTarget(timeline, cue.startFrame)!;
    expect(target.key).toBe(cue.key);
    expect(target.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(target.elapsedMs).toBeLessThan(1000 / WATCH_FPS);
  }
});

test("live append retains every prior frame coordinate and includes thinking duration", () => {
  const cues = [{key: "one", baseDurationMs: 4000}];
  const before = compileWatchTimeline(cues, () => "A thought");
  const after = compileWatchTimeline([...cues, {key: "two", baseDurationMs: 3000}], key => key === "one" ? "A thought" : null);
  expect(after[0]).toEqual(before[0]);
  expect(watchFrameTarget(before, 90)).toEqual(watchFrameTarget(after, 90));
  expect(before[0]!.endFrame).toBeGreaterThan(120);
  expect(watchFrameTarget([], 0)).toBeNull();
});
