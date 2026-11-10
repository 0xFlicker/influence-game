"use client";
import {useLayoutEffect, useRef, useState, type ReactNode} from "react";
import {HouseMessage} from "./house-message";

/** Reserve readable narration space without covering the scene or shrinking its text. */
export function HouseResultLayout({children, text, elapsedMs = 0, progress, progressDurationMs, logoUrl, controlsInset = 0}: {
  children:ReactNode; text:string; elapsedMs?:number; progress?:number; progressDurationMs?:number; logoUrl?:string; controlsInset?:number;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const update = () => {
      const height = element.clientHeight - controlsInset;
      setWide(element.clientWidth >= 500 && height < 400 && element.clientWidth > height * 2);
    };
    const observer = new ResizeObserver(update);
    observer.observe(element); update();
    return () => observer.disconnect();
  }, [controlsInset]);
  return <div ref={frame} data-house-result className="relative grid min-h-0 flex-1 gap-2 p-2" style={{
    paddingBottom:controlsInset,
    gridTemplateColumns:wide ? "minmax(0, 2fr) minmax(180px, 1fr)" : "minmax(0, 1fr)",
    gridTemplateRows:wide ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(86px, 28%)",
  }}>
    <div className="relative flex min-h-0 min-w-0 flex-col overflow-hidden" data-house-result-scene>{children}</div>
    <HouseMessage text={text} elapsedMs={elapsedMs} progress={progress} progressDurationMs={progressDurationMs} logoUrl={logoUrl} />
  </div>;
}
