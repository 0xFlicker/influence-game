"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { AcceptedVisualScene } from "@influence/engine/visual-mode";
import { visualSpeechOpacity } from "@influence/engine/visual-speech";
import { layoutVisualScene } from "./visual-scene-layout";

export interface VisualSpeech {
  id: string;
  playerId: string | null;
  speaker: string;
  text: string;
}

/** One timed bubble, driven by the same presentation clock as its dialogue beat. */
export function VisualSceneView({ scene, speech, elapsedMs, reducedMotion = false }: {
  scene: AcceptedVisualScene;
  speech: VisualSpeech | null;
  elapsedMs: number;
  reducedMotion?: boolean;
}) {
  const opacity = speech ? visualSpeechOpacity(speech.text, elapsedMs, reducedMotion) : 0;
  const anchor = speech?.playerId ? scene.anchors.find((item) => item.playerId === speech.playerId) : undefined;
  const frameRef = useRef<HTMLElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0, bubbleHeight: 0 });
  const visible = Boolean(speech && opacity > 0);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      const next = { width: frame.clientWidth, height: frame.clientHeight, bubbleHeight: bubbleRef.current?.offsetHeight ?? 0 };
      setSize((previous) => previous.width === next.width && previous.height === next.height && previous.bubbleHeight === next.bubbleHeight ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    if (bubbleRef.current) observer.observe(bubbleRef.current);
    return () => observer.disconnect();
  }, [visible, speech?.text, speech?.speaker, size.width]);
  const layout = layoutVisualScene({ ...size, bubbleHeight: visible ? size.bubbleHeight : 0, head: anchor?.head });
  return (
    <section ref={frameRef} aria-label="Current room" className="min-h-0 w-full flex-1 overflow-y-auto overscroll-y-contain">
      <div className="relative w-full" style={{ height: layout.contentHeight }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- immutable generated scene served by game media storage */}
        <img src={scene.imageUrl} alt="Current conversation scene" className="absolute rounded-2xl object-contain" style={{ left: layout.imageLeft, top: layout.imageTop, width: layout.imageWidth, height: layout.imageHeight }} />
        {visible && speech && <div ref={bubbleRef} className="absolute z-10 rounded-2xl border border-white/20 bg-black/90 px-4 py-3 text-white shadow-xl"
          style={{ opacity, width: layout.bubbleWidth, left: layout.bubbleLeft, top: layout.bubbleTop }}>
          <p className="mb-1 text-xs font-semibold text-white/65">{speech.playerId === null ? "Anonymous" : speech.speaker}</p>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{speech.text}</p>
          {layout.anchored && <span aria-hidden="true" className={`absolute h-4 w-4 rotate-45 border-white/20 bg-black/90 ${layout.below ? "border-t border-l" : "border-b border-r"}`} style={{ left: layout.arrowLeft, top: layout.below ? -8 : undefined, bottom: layout.below ? undefined : -8 }} />}
        </div>}
      </div>
    </section>
  );
}
