"use client";

import type { AcceptedVisualScene } from "@influence/engine/visual-mode";
import { visualSpeechOpacity } from "@influence/engine/visual-speech";

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
  const center = anchor ? (anchor.head.x + anchor.head.width / 2) * 100 : 50;
  const left = Math.max(2, Math.min(64, center - 17));
  const bottom = anchor ? Math.max(8, Math.min(84, 100 - anchor.head.y * 100 + 3)) : 8;
  const bubble = speech && opacity > 0 ? (
    <div className="rounded-2xl border border-white/20 bg-black/90 px-4 py-3 text-white shadow-xl" style={{ opacity }}>
      <p className="mb-1 text-xs font-semibold text-white/65">{speech.playerId === null ? "Anonymous" : speech.speaker}</p>
      <p className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed">{speech.text}</p>
    </div>
  ) : null;
  return (
    <section aria-label="Current room" className="overflow-hidden rounded-2xl bg-black">
      <div className="relative aspect-video">
        {/* eslint-disable-next-line @next/next/no-img-element -- immutable generated scene served by game media storage */}
        <img src={scene.imageUrl} alt="Current conversation scene" className="absolute inset-0 h-full w-full object-contain" />
        {bubble && <div className="absolute z-10 hidden w-[34%] md:block" style={{ left: `${left}%`, bottom: `${bottom}%` }}>
          {bubble}
          {anchor && <span aria-hidden="true" className="absolute -bottom-2 h-4 w-4 rotate-45 border-b border-r border-white/20 bg-black/90" style={{ left: `${Math.max(8, Math.min(92, (center - left) / 34 * 100))}%`, opacity }} />}
        </div>}
      </div>
      <div className="min-h-24 p-3 md:hidden">{bubble}</div>
    </section>
  );
}
