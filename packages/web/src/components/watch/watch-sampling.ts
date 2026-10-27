/** Render samples never advance the director. Sleep when paused/buffering and
 * coalesce synchronous director notifications until its mutation has finished. */
export interface WatchSampler {
  subscribe(listener: () => void): () => void;
  isAnimating(): boolean;
}
export function sampleWatch(director: WatchSampler, sample: () => void) {
  const interval = 1000 / 30;
  let frame = 0, nextSample = 0, dirty = true;
  const tick = (now: number) => {
    frame = 0;
    if (dirty) nextSample = now;
    if (dirty || now + 2 >= nextSample || !director.isAnimating()) {
      dirty = false;
      // Keep a deadline grid instead of restarting the interval at each sample.
      // Safari can deliver rAF at ~30 Hz; small jitter must not halve it to 15.
      nextSample += Math.max(1, Math.floor((now - nextSample) / interval) + 1) * interval;
      sample();
    }
    if (director.isAnimating() && !frame) frame = requestAnimationFrame(tick);
  };
  const wake = () => {
    dirty = true;
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const unsubscribe = director.subscribe(wake);
  wake();
  return () => { unsubscribe(); cancelAnimationFrame(frame); };
}
