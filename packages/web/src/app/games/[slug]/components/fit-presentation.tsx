"use client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Keep canonical result/ballot layouts intact while fitting the player frame. */
export function FitPresentation({ enabled, children, onLayoutChange }: { enabled: boolean; children: ReactNode; onLayoutChange?: (layout: { scale: number; top: number }) => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ scale: 1, top: 0 });
  useLayoutEffect(() => {
    if (!enabled || !frame.current || !content.current) return;
    const outer = frame.current, inner = content.current;
    const measure = () => {
      const scale = Math.min(1, outer.clientHeight / Math.max(1, inner.scrollHeight));
      const top = Math.max(0, (outer.clientHeight - inner.scrollHeight * scale) / 2);
      setLayout(previous => previous.scale === scale && previous.top === top ? previous : { scale, top });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    measure();
    return () => observer.disconnect();
  }, [enabled]);
  useLayoutEffect(() => {
    onLayoutChange?.(enabled ? layout : { scale: 1, top: 0 });
  }, [enabled, layout, onLayoutChange]);
  return <div ref={frame} className={enabled ? "relative h-full min-h-0 w-full overflow-hidden" : "contents"}>
    <div ref={content} style={enabled ? { width: "100%", position: "absolute", top: layout.top, transform: `scale(${layout.scale})`, transformOrigin: "top center" } : undefined}>{children}</div>
  </div>;
}
