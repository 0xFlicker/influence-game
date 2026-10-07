"use client";
import {createContext, useContext, useEffect, useState, type ReactNode} from "react";
import type {PresentationDirector, ThinkingOrder, WatchCue} from "./watch-director";
import type {BubbleTypography} from "./bubble-typography";
import {TimedSpeech} from "@/app/games/[slug]/components/timed-speech";
import {visualSpeechDurationMs, VISUAL_SPEECH_FADE_MS} from "@influence/engine/visual-speech";

type Thought = NonNullable<ReturnType<PresentationDirector<WatchCue>["getThinkingFrame"]>> & {speaker: string};
const ThinkingEnabledContext = createContext(false);
/** Layout intent remains stable while the timed thought is hidden or loading. */
export const useSceneThinkingEnabled = () => useContext(ThinkingEnabledContext);
const ThinkingContext = createContext<Thought | null>(null);
export const useSceneThinking = () => useContext(ThinkingContext);

/** Optional captured evidence shares the director's clock; it never makes a model call. */
export function WatchThinking<C extends WatchCue>({director, cueKey, enabled, order, speaker, load, children}: {
  director: PresentationDirector<C>; cueKey: string | null; enabled: boolean; order: ThinkingOrder;
  children: ReactNode; speaker: string; load: (signal: AbortSignal) => Promise<string | null>;
}) {
  const [, redraw] = useState(0);
  const [error, setError] = useState<{key:string; message:string} | null>(null);
  const errorKey = `${cueKey}:${order}`;
  useEffect(() => {
    if (!cueKey) return;
    if (!enabled) { director.setThinking(cueKey, null, order); return; }
    const controller = new AbortController();
    director.setThinkingPending(cueKey, true);
    void load(AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]))
      .then(text => { if (!controller.signal.aborted) {director.setThinking(cueKey, text, order);setError(null);} })
      .catch(() => { if (!controller.signal.aborted) {director.setThinking(cueKey, null, order);setError({key:errorKey,message:"Thinking could not be loaded for this turn."});} });
    return () => { controller.abort(); director.setThinkingPending(cueKey, false); };
  }, [director, cueKey, enabled, order, load, errorKey]);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const sample = () => {redraw(value => value + 1);frame = director.isAnimating() ? requestAnimationFrame(sample) : 0;};
    const schedule = () => {if (!frame) frame = requestAnimationFrame(sample);};
    const unsubscribe = director.subscribe(schedule);
    schedule();
    return () => {unsubscribe();cancelAnimationFrame(frame);};
  }, [enabled, director]);
  const thought = enabled ? director.getThinkingFrame() : null;
  return <ThinkingEnabledContext.Provider value={enabled}><ThinkingContext.Provider value={thought ? {...thought, speaker} : null}>
    {children}
    {enabled && error?.key === errorKey && <p role="status" className="pointer-events-none absolute right-4 top-14 z-30 rounded bg-black/90 p-2 text-xs text-white/70">{error.message}</p>}
  </ThinkingContext.Provider></ThinkingEnabledContext.Provider>;
}

/** A scene owns placement. There is no opaque lane or separate playback clock. */
export function ThoughtBubble({box, head, typography, padding = 18}: {
  box: {left: number; top: number; width: number; height: number};
  head: {x: number; y: number}; typography?: BubbleTypography | null; padding?: number;
}) {
  const thought = useSceneThinking();
  if (!thought) return null;
  const reading = visualSpeechDurationMs(thought.text) - 2 * VISUAL_SPEECH_FADE_MS;
  const beside = head.x < box.left || head.x > box.left + box.width;
  const start = {x: beside ? head.x < box.left ? box.left : box.left + box.width : Math.max(box.left + 20, Math.min(box.left + box.width - 20, head.x)),
    y: beside ? Math.max(box.top + 20, Math.min(box.top + box.height - 20, head.y)) : box.top + box.height};
  const dx = start.x - head.x, dy = start.y - head.y;
  const distance = Math.hypot(dx, dy);
  // Leave a little air at the head; grow each circle by 4px toward the thought.
  // Choose the count for roughly 8px gaps, then distribute the remaining space.
  const length = Math.max(0, distance - 16);
  const count = Math.max(1, Math.round((Math.sqrt(100 + 8 * (length + 12)) - 10) / 4));
  const circleSpan = 2 * count * count + 2 * count - 4;
  const gap = count > 1 ? (length - circleSpan) / (count - 1) : 0;
  return <>
    {Array.from({length:count}, (_, index) => {
      // Omit the smallest two circles nearest the character; keep the trail
      // suggestive and off the face, even when the connecting span is long.
      if (index < Math.min(2, count - 1)) return null;
      const diameter = 6 + index * 4;
      const offset = count === 1 ? distance : 16 + 2 * index * index + 6 * index + gap * index;
      const fraction = distance > 0 ? offset / distance : 1;
      return <span key={index} aria-hidden="true" data-thought-tail
        className="pointer-events-none absolute z-[180] rounded-full border border-slate-300/35 bg-slate-950/90"
        style={{left: head.x + dx * fraction - diameter / 2, top: head.y + dy * fraction - diameter / 2,
          width:diameter, height:diameter, opacity:thought.opacity}} />;
    })}
    <aside aria-label={`${thought.speaker} thinking`} data-in-scene-thinking
      className="pointer-events-none absolute z-[180] flex flex-col rounded-[2rem] border border-slate-300/35 bg-slate-950/90 text-slate-300 shadow-xl"
      style={{...box, padding, opacity: thought.opacity}}>
      <p className={`mb-1 flex shrink-0 gap-2 text-[10px] leading-3 font-medium text-slate-400 ${typography && typography.pages.length > 1 && !typography.footerHeight ? "pr-12" : ""}`}><span className="motion-safe:animate-pulse" aria-hidden="true">•••</span>{thought.speaker} thinks</p>
      <TimedSpeech typography={typography} text={thought.text} elapsedMs={VISUAL_SPEECH_FADE_MS + thought.elapsedMs / thought.durationMs * reading} />
    </aside>
  </>;
}
