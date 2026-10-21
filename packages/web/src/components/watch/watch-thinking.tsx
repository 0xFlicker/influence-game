"use client";
import {createContext, useContext, useEffect, useState, type ReactNode} from "react";
import type {PresentationDirector, WatchCue} from "./watch-director";
import type {BubbleTypography} from "./bubble-typography";
import {TimedSpeech} from "@/app/games/[slug]/components/timed-speech";
import {visualSpeechDurationMs, VISUAL_SPEECH_FADE_MS} from "@influence/engine/visual-speech";
import {thoughtTail} from "./thought-tail";

export type Thought = NonNullable<ReturnType<PresentationDirector<WatchCue>["getThinkingFrame"]>> & {speaker: string; roleLabel?: string};
const ThinkingContext = createContext<Thought | null>(null);
export const useSceneThinking = () => useContext(ThinkingContext);

/** Frozen evidence can use the same layout without browser fetching or clocks. */
export function SceneThinkingProvider({thought, children}: {thought: Thought | null; children: ReactNode}) {
  return <ThinkingContext.Provider value={thought}>{children}</ThinkingContext.Provider>;
}

/** Optional captured evidence shares the director's clock; it never makes a model call. */
export function WatchThinking<C extends WatchCue>({director, cueKey, enabled, speaker, roleLabel, load, children}: {
  director: PresentationDirector<C>; cueKey: string | null; enabled: boolean;
  children: ReactNode; speaker: string; roleLabel?: string; load: (signal: AbortSignal) => Promise<string | null>;
}) {
  const [, redraw] = useState(0);
  const [error, setError] = useState<{key:string | null; message:string} | null>(null);
  const errorKey = cueKey;
  useEffect(() => {
    director.setThinkingEnabled(enabled);
    if (!cueKey) return;
    if (!enabled) return;
    const controller = new AbortController();
    director.setThinkingPending(cueKey, true);
    void load(AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]))
      .then(text => { if (!controller.signal.aborted) {director.setThinking(cueKey, text);setError(null);} })
      .catch(() => { if (!controller.signal.aborted) {director.setThinking(cueKey, null);setError({key:errorKey,message:"Thinking could not be loaded for this turn."});} });
    return () => { controller.abort(); director.setThinkingPending(cueKey, false); };
  }, [director, cueKey, enabled, load, errorKey]);
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
  return <SceneThinkingProvider thought={thought ? {...thought, speaker, roleLabel} : null}>
    {children}
    {enabled && error?.key === errorKey && <p role="status" className="pointer-events-none absolute right-4 top-14 z-30 rounded bg-black/90 p-2 text-xs text-white/70">{error.message}</p>}
  </SceneThinkingProvider>;
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
    y: beside ? Math.max(box.top + 20, Math.min(box.top + box.height - 20, head.y)) : head.y < box.top ? box.top : box.top + box.height};
  const circles = thoughtTail(head, start, Math.max(.8, Math.min(1.5, (typography?.fontSize ?? 28) / 28)));
  return <>
    {circles.map((circle, index) => <span key={index} aria-hidden="true" data-thought-tail
        className="pointer-events-none absolute z-[180] rounded-full border border-slate-300/35 bg-slate-950/90"
        style={{...circle, opacity:thought.opacity}} />)}
    <aside aria-label={`${thought.speaker} thinking`} data-in-scene-thinking
      className="pointer-events-none absolute z-[180] flex flex-col rounded-[2rem] border border-slate-300/35 bg-slate-950/90 text-slate-300 shadow-xl"
      style={{...box, padding, opacity: thought.opacity}}>
      <div className={`mb-2 shrink-0 text-base leading-5 font-medium text-slate-300 ${typography && typography.pages.length > 1 && !typography.footerHeight ? "pr-12" : ""}`}>
        <p className="truncate"><span style={{opacity: .65 + .35 * Math.sin(thought.elapsedMs / 350) ** 2}} aria-hidden="true">••• </span>{thought.speaker} thinks</p>
        {thought.roleLabel && <p data-thinking-role className="text-amber-200">{thought.roleLabel}</p>}
      </div>
      <TimedSpeech typography={typography} text={thought.text} elapsedMs={VISUAL_SPEECH_FADE_MS + thought.elapsedMs / thought.durationMs * reading} />
    </aside>
  </>;
}
