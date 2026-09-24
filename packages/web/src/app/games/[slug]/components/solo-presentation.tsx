"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { resolveAgentAvatarUrl } from "@/components/agent-avatar";
import { TimedSpeech } from "./timed-speech";
import type { VisualPresentationBeat } from "./visual-presentation";
import { layoutSoloPresentation } from "./solo-presentation-layout";
import { soloPresentationMotion } from "./solo-presentation-timing";
import { SCENE_SPEECH_START_MS, sceneSpeechOpacity } from "./scene-speech-timing";

/** Frozen character art, never a generated talking-head clip or an inferred crop. */
export function SoloPresentation({ beat, elapsedMs, readingElapsedMs = elapsedMs, paused = false, reducedMotion = false, controlsInset = 0, speechPresentation = "solo" }: {
  beat: Extract<VisualPresentationBeat, { kind: "portrait" }>;
  elapsedMs: number;
  readingElapsedMs?: number;
  paused?: boolean;
  reducedMotion?: boolean;
  controlsInset?: number;
  speechPresentation?: "solo" | "scene";
}) {
  const { player, speech } = beat;
  const motion = speechPresentation === "scene"
    ? { imageOpacity: 1, speechOpacity: sceneSpeechOpacity(speech.text, elapsedMs, reducedMotion), speechElapsedMs: elapsedMs - SCENE_SPEECH_START_MS }
    : soloPresentationMotion(speech.text, elapsedMs, paused, reducedMotion);
  const [naturalHeight, setNaturalHeight] = useState<number>();
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const fullBody = player.fullBodyReferenceUrl && failedImage !== player.fullBodyReferenceUrl ? player.fullBodyReferenceUrl : null;
  const source = fullBody ?? resolveAgentAvatarUrl(player.avatarUrl, player.persona, player.name, player.personaKey);
  const frame = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [loaded, setLoaded] = useState({ source: "", width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setSize(previous => previous.width === element.clientWidth && previous.height === element.clientHeight
      ? previous : { width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const geometry = layoutSoloPresentation(size.width, size.height, loaded.source === source ? loaded.width : 0,
    loaded.source === source ? loaded.height : 0, Boolean(fullBody), controlsInset, (naturalHeight ?? 240) + 68, player.headRectangle);
  return <section ref={frame} aria-label={`${beat.purpose}: ${player.name}`} data-solo-image={fullBody ? "full-body" : "portrait"}
    className="relative min-h-0 w-full flex-1 overflow-hidden bg-black">
    {/* eslint-disable-next-line @next/next/no-img-element -- frozen game image, with a static portrait only when full-body art is unavailable */}
    <img key={source} src={source} alt={player.name}
      onLoad={event => setLoaded({ source, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
      onError={fullBody ? () => setFailedImage(fullBody) : undefined}
      className="absolute max-w-none object-contain" style={{ ...geometry.image, opacity: motion.imageOpacity }} />
    {motion.speechOpacity > 0 && <div data-speech-bubble style={{ ...geometry.bubble, opacity: motion.speechOpacity }} className="absolute flex flex-col rounded-2xl border border-white/25 bg-black/85 px-5 py-4 text-lg leading-relaxed shadow-xl">
      <p className="mb-2 flex shrink-0 flex-wrap items-baseline gap-x-2 text-sm font-semibold leading-5"><span>{player.name}</span><span className="text-xs font-normal text-white/50">{beat.caption ?? beat.purpose}</span></p>
      <blockquote className="flex min-h-0 flex-1 flex-col">
        <TimedSpeech text={speech.text} elapsedMs={speechPresentation === "scene" ? readingElapsedMs - SCENE_SPEECH_START_MS : soloPresentationMotion(speech.text, readingElapsedMs).speechElapsedMs} onNaturalHeight={setNaturalHeight} />
      </blockquote>
      <span aria-hidden="true" className={`absolute h-4 w-4 rotate-45 border-white/25 bg-black ${geometry.above ? "-bottom-2 border-r border-b" : "-top-2 border-l border-t"}`} style={{ left: geometry.tailLeft - 8 }} />
    </div>}
  </section>;
}
