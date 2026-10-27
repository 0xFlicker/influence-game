"use client";
import {useEffect, useState, type ReactNode} from "react";
import {sampleWatch, type WatchSampler} from "./watch-sampling";

/** Confine animation updates to the scene, leaving the viewer and cast idle. */
export function WatchClock({director, children}: {
  director: WatchSampler & {getElapsedBaseMs(): number};
  children: (elapsedMs: number) => ReactNode;
}) {
  const [, setElapsed] = useState(() => director.getElapsedBaseMs());
  useEffect(() => sampleWatch(director, () => setElapsed(director.getElapsedBaseMs())), [director]);
  // A parent may render a new cue before the next sample; never reuse the
  // previous cue's elapsed time for that first render.
  return children(director.getElapsedBaseMs());
}
