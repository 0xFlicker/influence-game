import {compileTiming, type CompiledTiming} from "@/lib/replay-export/timing";
import type {WatchCue} from "./watch-director";

export const WATCH_FPS = 30;
export function compileWatchTimeline(cues: readonly WatchCue[], thinking: (key: string) => string | null): CompiledTiming[] {
  return compileTiming(cues.flatMap(cue => {
    const text = thinking(cue.key);
    if (cue.thinkingOnly && !text?.trim()) return [];
    return [{...cue, kind: cue.thinkingOnly ? "thinking" as const : "scene" as const, speech: null, thinking: text}];
  }), {ending: "finish-score", overrides: {}}, WATCH_FPS);
}
/** Absolute frame boundaries are rounded once by the same compiler used in Studio. */
export function watchFrameTarget(timeline: readonly CompiledTiming[], frame: number) {
  if (!timeline.length || !Number.isFinite(frame)) return null;
  const bounded = Math.max(0, Math.min(Math.round(frame), timeline.at(-1)!.endFrame - 1));
  let low = 0, high = timeline.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timeline[middle]!.endFrame <= bounded) low = middle + 1;
    else high = middle;
  }
  const cue = timeline[low]!;
  return {key: cue.key, index: low, elapsedMs: Math.max(0, bounded * 1000 / WATCH_FPS - cue.startMs)};
}
