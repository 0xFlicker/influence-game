"use client";
import {useEffect, useMemo, useState} from "react";
import {PresentationDirector, type WatchCue, type WatchPolicy} from "./watch-director";

export function useWatchDirector<C extends WatchCue>(policy: WatchPolicy<C>) {
  const director = useMemo(() => new PresentationDirector({policy, followTail: true}), [policy]);
  const [snapshot, setSnapshot] = useState(() => director.getSnapshot());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    director.activate();
    const unsubscribe = director.subscribe(() => { setSnapshot(director.getSnapshot()); setElapsed(director.getElapsedBaseMs()); });
    // Sampling only: all advancement, pause and speed remain on the shared scheduler.
    let frame = 0;
    const sample = () => { setElapsed(director.getElapsedBaseMs()); frame = requestAnimationFrame(sample); };
    frame = requestAnimationFrame(sample);
    const hidden = () => { if (document.hidden) director.pause(); };
    document.addEventListener("visibilitychange", hidden);
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => director.setReducedMotion(preference.matches);
    motion(); preference.addEventListener("change", motion);
    return () => { unsubscribe(); cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", hidden); preference.removeEventListener("change", motion); director.dispose(); };
  }, [director]);
  return {director, snapshot, elapsed};
}
