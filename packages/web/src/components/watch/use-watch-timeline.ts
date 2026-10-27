"use client";
import {useEffect, useMemo, useState} from "react";
import type {PresentationDirector, WatchCue} from "./watch-director";
import {compileWatchTimeline, WATCH_FPS, watchFrameTarget} from "./watch-timeline";
import {sampleWatch} from "./watch-sampling";

/** Timing metadata can span unloaded windows; the game adapter resolves the chosen cue. */
export function useWatchTimeline<C extends WatchCue>(director: PresentationDirector<C>, cues: readonly WatchCue[], thinking: boolean) {
  const [revision, setRevision] = useState(() => director.getTimingRevision());
  useEffect(() => director.subscribe(() => setRevision(director.getTimingRevision())), [director]);
  useEffect(() => director.setThinkingEnabled(thinking), [director, thinking]);
  const timeline = useMemo(() => { void revision; return compileWatchTimeline(cues, key => thinking ? director.getThinkingText(key) : null,key => director.getRecordedDuration(key)); }, [cues, director, thinking, revision]);
  return useMemo(() => {
    const byKey = new Map(timeline.map(cue => [cue.key, cue]));
    const getFrame = () => {
      const cue = byKey.get(director.getActiveCue()?.key ?? "");
      return cue ? Math.min(timeline.at(-1)!.endFrame - 1, Math.floor((cue.startMs + director.getTimelineElapsedBaseMs()) * WATCH_FPS / 1000 + 1e-7)) : 0;
    };
    return {getFrame, subscribe: (sample: () => void) => sampleWatch(director, sample), frameCount: timeline.at(-1)?.endFrame ?? 0, fps: WATCH_FPS, target: (value: number) => watchFrameTarget(timeline, value)};
  }, [director, timeline]);
}

export type WatchTimeline = ReturnType<typeof useWatchTimeline>;
