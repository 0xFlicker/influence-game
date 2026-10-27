"use client";
import {useEffect, useMemo, useState} from "react";
import {PresentationDirector, type WatchCue, type WatchPolicy} from "./watch-director";

export function useWatchDirector<C extends WatchCue>(policy: WatchPolicy<C>) {
  const director = useMemo(() => new PresentationDirector({policy, followTail: true}), [policy]);
  const [snapshot, setSnapshot] = useState(() => director.getSnapshot());
  useEffect(() => {
    director.activate();
    const unsubscribe = director.subscribe(() => setSnapshot(director.getSnapshot()));
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => director.setReducedMotion(preference.matches);
    motion(); preference.addEventListener("change", motion);
    return () => { unsubscribe(); preference.removeEventListener("change", motion); director.dispose(); };
  }, [director]);
  return {director, snapshot};
}
