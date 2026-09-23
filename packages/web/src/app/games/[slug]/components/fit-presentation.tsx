"use client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Keep canonical result/ballot layouts intact while fitting the player frame. */
export function FitPresentation({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ scale: 1, top: 0 });
  useLayoutEffect(() => {
    if (!enabled || !frame.current || !content.current) return;
    const outer = frame.current, inner = content.current;
    const measure = () => {
      const scale = Math.min(1, outer.clientHeight / Math.max(1, inner.scrollHeight));
      setLayout({ scale, top: Math.max(0, (outer.clientHeight - inner.scrollHeight * scale) / 2) });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    measure();
    return () => observer.disconnect();
  }, [enabled]);
  return <div ref={frame} className={enabled ? "relative h-full min-h-0 w-full overflow-hidden" : "contents"}>
    <div ref={content} style={enabled ? { width: "100%", position: "absolute", top: layout.top, transform: `scale(${layout.scale})`, transformOrigin: "top center" } : undefined}>{children}</div>
  </div>;
}
