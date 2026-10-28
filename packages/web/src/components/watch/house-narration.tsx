"use client";

import {useLayoutEffect, useRef} from "react";

export type NarrationWindow = {elapsedMs: number; durationMs: number};

/** Derived entirely from the recording clock: seeking and pausing have no timers to reset. */
export function narrationWindow(elapsedMs: number, durationMs: number): NarrationWindow | null {
  return Number.isFinite(elapsedMs) && Number.isFinite(durationMs) && durationMs > 0 && elapsedMs >= 0 && elapsedMs < durationMs
    ? {elapsedMs, durationMs} : null;
}

/** Shared by the live player and Remotion; summary is the accepted spoken text. */
export function HouseNarration({text, window, logoUrl = "/logo.png", bottom = 16, centered = false}: {
  text: string; window: NarrationWindow | null; logoUrl?: string; bottom?: number; centered?: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLElement>(null);
  const copy = useRef<HTMLParagraphElement>(null);
  const visible = Boolean(window && text.trim());
  useLayoutEffect(() => {
    const outer = frame.current, section = content.current, paragraph = copy.current;
    if (!visible || !outer || !section || !paragraph) return;
    let active = true;
    const fit = () => {
      if (!active) return;
      // Measure the whole accepted message, including logo/header chrome. One
      // screen stays visible for the entire recording, with no guessed page clock.
      paragraph.style.removeProperty("font-size");
      const maximum = parseFloat(getComputedStyle(paragraph).fontSize);
      const available = Math.max(1, centered ? outer.clientHeight - 48 : (outer.clientHeight - bottom - 12) * .45);
      let low = 1, high = maximum;
      for (let step = 0; step < 10; step++) {
        const size = (low + high) / 2;
        paragraph.style.fontSize = `${size}px`;
        if (section.scrollHeight <= available) low = size;
        else high = size;
      }
      paragraph.style.fontSize = `${Math.floor(low * 10) / 10}px`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    fit(); void document.fonts.ready.then(fit);
    return () => {active = false; observer.disconnect();};
  }, [visible,text,centered,bottom]);
  if (!window || !text.trim()) return null;
  return <div ref={frame} data-house-narration data-house-layout={centered ? "center" : "caption"} className="pointer-events-none absolute inset-0 z-40" style={{background:centered ? "radial-gradient(ellipse,rgba(0,0,0,.8),rgba(0,0,0,.35))" : "linear-gradient(transparent 45%,rgba(0,0,0,.22))", containerType:"size"}}>
    <section ref={content} aria-label="The House narration" className={centered ? "absolute inset-x-0 top-1/2 mx-auto flex max-w-4xl -translate-y-1/2 flex-col items-center justify-center gap-4 p-6 text-center text-white" : "absolute inset-x-3 mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-white/25 bg-black/90 px-4 py-3 text-white shadow-2xl sm:inset-x-6"} style={centered ? undefined : {bottom}}>
      {/* eslint-disable-next-line @next/next/no-img-element -- existing bundled House logo, shared with exports */}
      <img src={logoUrl} alt="The House" className={centered ? "shrink-0 object-contain" : "h-12 w-12 shrink-0 object-contain"} style={centered ? {width:"clamp(56px, 19cqh, 144px)",height:"clamp(56px, 19cqh, 144px)"} : undefined} />
      <div className={centered ? "min-w-0 w-full" : "min-w-0 flex-1"}><p className="mb-2 text-[10px] uppercase tracking-[.2em] text-amber-100">The House</p>
        <p ref={copy} className={`break-words ${centered ? "text-[clamp(18px,min(4.5cqw,6cqh),40px)] font-medium leading-snug" : "text-sm leading-snug sm:text-lg"}`} data-house-narration-text>{text}</p>
      </div>
    </section>
  </div>;
}
