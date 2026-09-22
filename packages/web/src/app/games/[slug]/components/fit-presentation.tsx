"use client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Keep canonical result/ballot layouts intact while fitting the player frame. */
export function FitPresentation({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    if (!enabled || !frame.current || !content.current) return;
    const outer = frame.current, inner = content.current;
    const measure = () => setScale(Math.min(1, outer.clientHeight / Math.max(1, inner.scrollHeight)));
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    measure();
    return () => observer.disconnect();
  }, [enabled]);
  return <div ref={frame} className={enabled ? "relative h-full min-h-0 w-full overflow-hidden" : "contents"}>
    <div ref={content} style={enabled ? { width: "100%", transform: `scale(${scale})`, transformOrigin: "top center" } : undefined}>{children}</div>
  </div>;
}
