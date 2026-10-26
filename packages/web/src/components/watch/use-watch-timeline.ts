"use client";
import {useEffect, useMemo, useState} from "react";
import type {PresentationDirector, WatchCue} from "./watch-director";
import {compileWatchTimeline, WATCH_FPS, watchFrameTarget} from "./watch-timeline";

/** Timing metadata can span unloaded windows; the game adapter resolves the chosen cue. */
export function useWatchTimeline<C extends WatchCue>(director: PresentationDirector<C>, cues: readonly WatchCue[], thinking: boolean) {
  const [revision, setRevision] = useState(0);
  const [frame, setFrame] = useState(0);
  useEffect(() => director.subscribe(() => setRevision(value => value + 1)), [director]);
  useEffect(() => director.setThinkingEnabled(thinking), [director, thinking]);
  const timeline = useMemo(() => { void revision; return compileWatchTimeline(cues, key => thinking ? director.getThinkingText(key) : null,key => director.getRecordedDuration(key)); }, [cues, director, thinking, revision]);
  useEffect(() => {
    const byKey = new Map(timeline.map(cue => [cue.key, cue]));
    let request = 0;
    const sample = () => {
      const cue = byKey.get(director.getActiveCue()?.key ?? "");
      if (cue) setFrame(Math.min(timeline.at(-1)!.endFrame - 1, Math.floor((cue.startMs + director.getTimelineElapsedBaseMs()) * WATCH_FPS / 1000 + 1e-7)));
      request = requestAnimationFrame(sample);
    };
    sample();
    return () => cancelAnimationFrame(request);
  }, [director, timeline]);
  return {frame, frameCount: timeline.at(-1)?.endFrame ?? 0, fps: WATCH_FPS, target: (value: number) => watchFrameTarget(timeline, value)};
}
