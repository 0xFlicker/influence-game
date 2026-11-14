"use client";
import {useSampledStage} from "@/components/watch/sampled-stage";
import {alignedPage} from "@/components/watch/speech-alignment";
import type {BubbleTypography} from "@/components/watch/bubble-typography";
import { useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { visualSpeechDurationMs, VISUAL_SPEECH_FADE_MS } from "@influence/engine/visual-speech";
import { cleanSpeechPage, paginateSpeech, speechPageIndex, speechPageStarts } from "./speech-pages";
import {WatchPageContext} from "@/components/watch/watch-page-context";

/** Measured pages use the existing beat's reading position, never their own timer. */
export function TimedSpeech({ text, elapsedMs, className = "", typography, progress, progressDurationMs, progressClock = "content", advancePart, growToLine = false, pageCounter = true }: { pageCounter?:boolean; growToLine?:boolean; progress?:number; progressDurationMs?:number; progressClock?:"content"|"timeline"; advancePart?:"thinking"|"speech"; typography?: BubbleTypography | null; text: string; elapsedMs: number; className?: string; onNaturalHeight?: (height: number) => void }) {
  const sampled = useSampledStage();
  const director = useContext(WatchPageContext);
  const pageOwner = useRef(Symbol("speech pages"));
  const frame = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const frozenPages = sampled?.pages;
  const capturePages = sampled?.capturePages;
  const [pagination, setPagination] = useState({ text, pages: [text], ready:false });
  useLayoutEffect(() => {
    if (typography) return;
    const container = frame.current, probe = measure.current;
    if (!container || !probe) return;
    let active = true;
    const update = () => {
      if (!active) return;
      const height = Math.max(1, container.clientHeight - (pageCounter ? 22 : 0));
      if (!container.clientWidth || !container.clientHeight) return;
      if (growToLine) {
        // Start from responsive CSS each time; size the complete message, never its current page.
        container.style.removeProperty("font-size");
        container.style.removeProperty("line-height");
        const base = getComputedStyle(container);
        const floor = parseFloat(base.fontSize);
        let low = floor, high = Math.max(floor, Math.min(32, Math.floor(height / 1.4)));
        probe.textContent = text;
        const fitsLine = (size:number) => {
          container.style.fontSize = `${size}px`;
          container.style.lineHeight = `${size * 1.4}px`;
          return probe.scrollHeight <= size * 1.4 + 1 && probe.scrollWidth <= container.clientWidth;
        };
        if (fitsLine(floor)) {
          while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (fitsLine(middle)) low = middle;
            else high = middle - 1;
          }
        }
        if (low > floor) fitsLine(low);
        else {
          container.style.removeProperty("font-size");
          container.style.removeProperty("line-height");
        }
      }
      const style = getComputedStyle(container);
      const key = JSON.stringify([text,container.clientWidth,height,style.fontSize,style.lineHeight,style.fontFamily]);
      if (frozenPages?.[key]) {setPagination({text,pages:frozenPages[key],ready:true});return;}
      probe.textContent = text;
      const pages = paginateSpeech(text, (candidate) => {
        probe.textContent = candidate;
        return probe.scrollHeight <= height;
      });
      probe.textContent = "";
      capturePages?.(key,pages);
      setPagination({ text, pages, ready:true });
    };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    update();
    void document.fonts?.ready.then(update);
    return () => { active = false; observer.disconnect(); };
  }, [text, typography, frozenPages, capturePages, growToLine, pageCounter]);
  const pages = useMemo(() => typography?.pages ?? (pagination.text === text ? pagination.pages : [text]), [typography, pagination, text]);
  const readingDuration = visualSpeechDurationMs(text) - 2 * VISUAL_SPEECH_FADE_MS;
  const cueKey = director?.getActiveCue()?.key;
  useLayoutEffect(() => {
    if (!director || !cueKey || !advancePart || progress !== undefined && !progressDurationMs) return;
    const contentMs = director.getSpeechElapsedBaseMs();
    return director.registerPages(pageOwner.current, {cueKey, part:advancePart, starts:speechPageStarts(pages), ready:Boolean(typography || pagination.text === text && pagination.ready),
      contentOffsetMs:contentMs - elapsedMs, readingDurationMs:readingDuration, fadeMs:VISUAL_SPEECH_FADE_MS,
      ...(progress !== undefined && progressDurationMs ? {progress:{value:progress,timelineMs:director.getTimelineElapsedBaseMs(),contentMs,durationMs:progressDurationMs,clock:progressClock}} : {})});
  }, [director,cueKey,advancePart,pages,elapsedMs,readingDuration,progress,progressDurationMs,progressClock,typography,pagination,text]);
  const page = progress !== undefined ? speechPageIndex(pages,progress)
    : sampled?.speech?.text === text ? alignedPage(pages,text,sampled.speech.alignment,sampled.speech.elapsedMs)
    : speechPageIndex(pages, (elapsedMs - VISUAL_SPEECH_FADE_MS) / readingDuration);
  return <div ref={frame} className={`relative min-h-0 flex-1 ${className}`} style={typography ? {fontSize:typography.fontSize,lineHeight:typography.lineHeight} : undefined}>
    <div ref={measure} aria-hidden="true" className="pointer-events-none invisible absolute inset-x-0 top-0 whitespace-pre-wrap [overflow-wrap:anywhere]" />
    <div data-speech-page-copy data-speech-page={page} data-speech-page-count={pages.length} className="whitespace-pre-wrap [overflow-wrap:anywhere]">{cleanSpeechPage(pages, page)}</div>
    {pageCounter && pages.length > 1 && <div aria-label={`Page ${page + 1} of ${pages.length}`} className="absolute right-0 text-xs leading-5 text-white/50" style={typography && typography.footerHeight === 0 ? {top:-typography.headerHeight} : {bottom:0}}>{page + 1} / {pages.length}</div>}
  </div>;
}
