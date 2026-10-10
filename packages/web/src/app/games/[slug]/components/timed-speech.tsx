"use client";
import {useSampledStage} from "@/components/watch/sampled-stage";
import {alignedPage} from "@/components/watch/speech-alignment";
import type {BubbleTypography} from "@/components/watch/bubble-typography";
import { useLayoutEffect, useRef, useState } from "react";
import { visualSpeechDurationMs, VISUAL_SPEECH_FADE_MS } from "@influence/engine/visual-speech";
import { paginateSpeech, speechPageIndex } from "./speech-pages";

/** Measured pages use the existing beat's reading position, never their own timer. */
export function TimedSpeech({ text, elapsedMs, className = "", typography }: { typography?: BubbleTypography | null; text: string; elapsedMs: number; className?: string; onNaturalHeight?: (height: number) => void }) {
  const sampled = useSampledStage();
  const frame = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const frozenPages = sampled?.pages;
  const capturePages = sampled?.capturePages;
  const [pagination, setPagination] = useState({ text, pages: [text] });
  useLayoutEffect(() => {
    if (typography) return;
    const container = frame.current, probe = measure.current;
    if (!container || !probe) return;
    let active = true;
    const update = () => {
      if (!active) return;
      const height = Math.max(1, container.clientHeight - 22);
      if (!container.clientWidth || !container.clientHeight) return;
      const style = getComputedStyle(container);
      const key = JSON.stringify([text,container.clientWidth,height,style.fontSize,style.lineHeight,style.fontFamily]);
      if (frozenPages?.[key]) {setPagination({text,pages:frozenPages[key]});return;}
      probe.textContent = text;
      const pages = paginateSpeech(text, (candidate) => {
        probe.textContent = candidate;
        return probe.scrollHeight <= height;
      });
      probe.textContent = "";
      capturePages?.(key,pages);
      setPagination({ text, pages });
    };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    update();
    void document.fonts?.ready.then(update);
    return () => { active = false; observer.disconnect(); };
  }, [text, typography, frozenPages, capturePages]);
  const pages = typography?.pages ?? (pagination.text === text ? pagination.pages : [text]);
  const readingDuration = visualSpeechDurationMs(text) - 2 * VISUAL_SPEECH_FADE_MS;
  const page = sampled?.speech?.text === text ? alignedPage(pages,text,sampled.speech.alignment,sampled.speech.elapsedMs) : speechPageIndex(pages, (elapsedMs - VISUAL_SPEECH_FADE_MS) / readingDuration);
  return <div ref={frame} className={`relative min-h-0 flex-1 ${className}`} style={typography ? {fontSize:typography.fontSize,lineHeight:typography.lineHeight} : undefined}>
    <div ref={measure} aria-hidden="true" className="pointer-events-none invisible absolute inset-x-0 top-0 whitespace-pre-wrap [overflow-wrap:anywhere]" />
    <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{pages[page]}</div>
    {pages.length > 1 && <div aria-label={`Page ${page + 1} of ${pages.length}`} className="absolute right-0 text-xs leading-5 text-white/50" style={typography && typography.footerHeight === 0 ? {top:-typography.headerHeight} : {bottom:0}}>{page + 1} / {pages.length}</div>}
  </div>;
}
