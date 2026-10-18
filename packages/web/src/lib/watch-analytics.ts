export interface WatchSample {
  now: number;
  active: boolean;
  key: string | null;
  elapsed: number;
  navigation: number;
}

/** Measures real elapsed viewing and unioned content intervals, never seek distance. */
export class WatchAnalytics {
  private previous: WatchSample | null = null;
  private intervals = new Map<string, [number, number][]>();
  private activeMs = 0;
  private coverageMs = 0;

  sample(next: WatchSample): void {
    const previous = this.previous;
    this.previous = next;
    if (!previous || !previous.active || !next.active || !next.key || previous.key !== next.key || previous.navigation !== next.navigation) return;
    const delta = next.now - previous.now;
    // Long gaps are browser sleep/throttling, not evidence of attention.
    if (delta <= 0 || delta > 1500) return;
    this.activeMs += delta;
    // Thought overlays can run while the underlying content clock is frozen.
    if (next.elapsed <= previous.elapsed) return;
    const intervals = this.intervals.get(next.key) ?? [];
    const before = intervals.reduce((sum, [a, b]) => sum + b - a, 0);
    const sorted = [...intervals, [previous.elapsed, next.elapsed] as [number, number]].sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const interval of sorted) {
      const tail = merged.at(-1);
      if (tail && interval[0] <= tail[1]) tail[1] = Math.max(tail[1], interval[1]);
      else merged.push([...interval]);
    }
    this.intervals.set(next.key, merged);
    this.coverageMs += merged.reduce((sum, [a, b]) => sum + b - a, 0) - before;
  }

  flush(): { active_seconds: number; new_content_seconds: number } {
    const result = { active_seconds: this.activeMs / 1000, new_content_seconds: this.coverageMs / 1000 };
    this.activeMs = 0;
    this.coverageMs = 0;
    return result;
  }
}
