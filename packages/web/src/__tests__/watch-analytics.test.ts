import { describe, expect, test } from "bun:test";
import { WatchAnalytics, type WatchSample } from "../lib/watch-analytics";

describe("watch engagement", () => {
  const sample = (now: number, elapsed: number, changes: Partial<WatchSample> = {}): WatchSample => ({ now, elapsed, active: true, key: "cue", navigation: 0, ...changes });
  test("counts wall time independently of speed and deduplicates rewatched content", () => {
    const tracker = new WatchAnalytics();
    tracker.sample(sample(0, 0)); tracker.sample(sample(1000, 2000));
    expect(tracker.flush()).toEqual({ active_seconds: 1, new_content_seconds: 2 });
    tracker.sample(sample(1100, 0, { navigation: 1 }));
    tracker.sample(sample(2100, 2000, { navigation: 1 }));
    expect(tracker.flush()).toEqual({ active_seconds: 1, new_content_seconds: 0 });
  });
  test("excludes hidden, paused, stalled, sleeping and seek intervals", () => {
    const tracker = new WatchAnalytics();
    tracker.sample(sample(0, 0));
    tracker.sample(sample(1000, 1000, { active: false }));
    tracker.sample(sample(2000, 2000));
    tracker.sample(sample(3000, 2000, { active: false }));
    tracker.sample(sample(10000, 9000));
    tracker.sample(sample(11000, 99000, { navigation: 1 }));
    expect(tracker.flush()).toEqual({ active_seconds: 0, new_content_seconds: 0 });
  });
  test("active thought overlays count wall time without inventing content coverage", () => {
    const tracker = new WatchAnalytics();
    tracker.sample(sample(0, 1000)); tracker.sample(sample(1000, 1000));
    expect(tracker.flush()).toEqual({ active_seconds: 1, new_content_seconds: 0 });
  });
});
