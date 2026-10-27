/** Render samples never advance the director. Sleep when paused/buffering and
 * coalesce synchronous director notifications until its mutation has finished. */
export interface WatchSampler {
  subscribe(listener: () => void): () => void;
  isAnimating(): boolean;
}
export function sampleWatch(director: WatchSampler, sample: () => void) {
  let frame = 0, previous = -Infinity, dirty = true;
  const tick = (now: number) => {
    frame = 0;
    if (dirty || now - previous >= 1000 / 30 - 0.5 || !director.isAnimating()) {
      dirty = false;
      previous = now;
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
