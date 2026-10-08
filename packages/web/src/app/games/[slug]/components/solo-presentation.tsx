"use client";

import {validHeadRectangle} from "@influence/engine/character-portrait";
import {useBubbleTypography} from "@/components/watch/use-bubble-typography";
import {useSceneThinking} from "@/components/watch/watch-thinking";
import {thinkingFocus, ThinkingFocusOverlay} from "@/components/watch/thinking-focus";
import { useLayoutEffect, useRef, useState } from "react";
import { resolveAgentAvatarUrl } from "@/components/agent-avatar";
import { TimedSpeech } from "./timed-speech";
import type { VisualPresentationBeat } from "./visual-presentation";
import { layoutSoloPresentation } from "./solo-presentation-layout";
import { soloPresentationMotion } from "./solo-presentation-timing";
import { SCENE_SPEECH_START_MS, sceneSpeechOpacity } from "./scene-speech-timing";
import { SOLO_STUDIO_BACKDROP, StageBackdrop } from "./stage-backdrop";
import backdropStyles from "./stage-backdrop.module.css";

/** Frozen character art, never a generated talking-head clip or an inferred crop. */
export function SoloPresentation({ beat, elapsedMs, readingElapsedMs = elapsedMs, paused = false, reducedMotion = false, controlsInset = 0, speechPresentation = "solo", imageOpacity, onImageReady, hideSpeech = false, staticSpeech = false }: {
  beat: Extract<VisualPresentationBeat, { kind: "portrait" }>;
  elapsedMs: number;
  readingElapsedMs?: number;
  paused?: boolean;
  reducedMotion?: boolean;
  controlsInset?: number;
  speechPresentation?: "solo" | "scene";
  /** The ballot collection takes over these exact pixels at the end of its reveal. */
  imageOpacity?: number;
  hideSpeech?: boolean;
  /** Canonical ballot labels are short receipt facts, not timed dialogue pages. */
  staticSpeech?: boolean;
  onImageReady?: (source: string | null) => void;
}) {
  const { player, speech } = beat;
  const motion = speechPresentation === "scene"
    ? { imageOpacity: 1, speechOpacity: sceneSpeechOpacity(speech.text, elapsedMs, reducedMotion), speechElapsedMs: elapsedMs - SCENE_SPEECH_START_MS }
    : soloPresentationMotion(speech.text, elapsedMs, paused, reducedMotion);
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(new Set());
  const fullBody = player.fullBodyReferenceUrl && !failedImages.has(player.fullBodyReferenceUrl) ? player.fullBodyReferenceUrl : null;
  const portrait = resolveAgentAvatarUrl(player.avatarUrl, player.persona, player.name, player.personaKey);
  const source = fullBody ?? (failedImages.has(portrait) ? resolveAgentAvatarUrl(null, player.persona, player.name, player.personaKey) : portrait);
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
  const thought = useSceneThinking();
  const geometry = layoutSoloPresentation(size.width, size.height, loaded.source === source ? loaded.width : 0,
    loaded.source === source ? loaded.height : 0, Boolean(fullBody), controlsInset, 308, player.headRectangle, !hideSpeech);
  const headRect = validHeadRectangle(player.headRectangle) ? player.headRectangle : {x:.4, y:.04, width:.2, height:.16};
  const available = Math.max(0, size.height - controlsInset);
  const face = fullBody ? headRect : {x:.24,y:.12,width:.52,height:.52};
  const focus = thinkingFocus(size.width, available, {left:geometry.image.left + geometry.image.width * face.x,
    top:geometry.image.top + geometry.image.height * face.y, width:geometry.image.width * face.width, height:geometry.image.height * face.height},
    thought?.focus ?? 0, !fullBody, reducedMotion);
  const speechBox = geometry.bubble;
  const speechFit = useBubbleTypography(frame, speech.text, speechBox, "speech", available < 300, beat.roleLabel ? 48 : 28);
  const fittedSpeechWidth = speechFit.typography?.width ?? speechBox.width;
  const bubble = {...speechBox, width:fittedSpeechWidth, height:speechFit.typography?.height ?? speechBox.height,
    left:speechBox.left + (geometry.beside ? 0 : (speechBox.width - fittedSpeechWidth) / 2),
    top:speechBox.top};
  const tailLeft = Math.max(16, Math.min(bubble.width - 16, geometry.bubble.left + geometry.tailLeft - bubble.left));
  return <section ref={frame} aria-label={`${beat.purpose}: ${player.name}`} data-solo-image={fullBody ? "full-body" : "portrait"}
    className="relative min-h-0 w-full flex-1 overflow-hidden bg-black">
    <div data-thinking-camera className="absolute inset-0" style={focus.mediaStyle}>
    <StageBackdrop source={SOLO_STUDIO_BACKDROP} />
    {/* eslint-disable-next-line @next/next/no-img-element -- frozen game image, with a static portrait only when full-body art is unavailable */}
    <img data-solo-portrait key={source} src={source} alt={player.name}
      onLoad={event => {
        setLoaded({ source, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
        onImageReady?.(source);
      }}
      onError={() => {
        setFailedImages(previous => new Set(previous).add(source));
        onImageReady?.(null);
      }}
      className={`absolute max-w-none ${fullBody ? `object-contain ${backdropStyles.featheredBody}` : "rounded-full object-cover shadow-2xl ring-1 ring-white/30"}`} style={{ ...geometry.image, opacity: imageOpacity ?? motion.imageOpacity }} />
    </div>
    {!thought && !hideSpeech && motion.speechOpacity > 0 && <div data-speech-bubble style={{ ...bubble, opacity: motion.speechOpacity, padding:speechFit.padding }} className="absolute flex flex-col rounded-2xl border border-white/25 bg-black/85 shadow-xl">
      <div className={`mb-2 shrink-0 text-xs leading-5 ${speechFit.typography && speechFit.typography.pages.length > 1 && !speechFit.typography.footerHeight ? "pr-12" : ""}`}>
        <p className="flex h-5 items-baseline gap-x-2 overflow-hidden font-semibold">
          <span className="min-w-0 truncate">{player.name}</span>
          {beat.roleLabel ? <span data-speaker-role className="shrink-0 text-amber-200">{beat.roleLabel}</span> : <span className="shrink-0 font-normal text-white/50">{beat.caption ?? beat.purpose}</span>}
        </p>
        {beat.roleLabel && <p className="h-5 text-white/50">{beat.caption ?? beat.purpose}</p>}
      </div>
      <blockquote className="flex min-h-0 flex-1 flex-col">
        {staticSpeech ? <p className="break-words" style={{fontSize:speechFit.typography?.fontSize,lineHeight:1.4}}>{speech.text}</p> : <TimedSpeech text={speech.text} elapsedMs={speechPresentation === "scene" ? readingElapsedMs - SCENE_SPEECH_START_MS : soloPresentationMotion(speech.text, readingElapsedMs).speechElapsedMs} typography={speechFit.typography} />}
      </blockquote>
      <span aria-hidden="true" className={`absolute h-4 w-4 rotate-45 border-white/25 bg-black ${geometry.beside ? "-left-2 top-1/2 border-l border-b" : geometry.above ? "-bottom-2 border-r border-b" : "-top-2 border-l border-t"}`} style={geometry.beside ? undefined : { left: tailLeft - 8 }} />
    </div>}
    <ThinkingFocusOverlay frame={frame} layout={focus} />
  </section>;
}
