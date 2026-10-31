"use client";

import {validHeadRectangle} from "@influence/engine/character-portrait";
import {useSampledStage} from "@/components/watch/sampled-stage";
import {useBubbleTypography} from "@/components/watch/use-bubble-typography";
import {useSceneThinking} from "@/components/watch/watch-thinking";
import {thinkingFocus, ThinkingFocusOverlay} from "@/components/watch/thinking-focus";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { resolveAgentAvatarUrl } from "@/components/agent-avatar";
import {SpeechBubble} from "@/components/watch/speech-bubble";
import type { VisualPresentationBeat } from "./visual-presentation";
import { layoutSoloPresentation } from "./solo-presentation-layout";
import { SOLO_IMAGE_FADE_MS, soloPresentationMotion } from "./solo-presentation-timing";
import { SCENE_SPEECH_START_MS, sceneSpeechOpacity } from "./scene-speech-timing";
import { DEFAULT_ROOM_BACKDROP, RoomBackdrop } from "./stage-backdrop";
import backdropStyles from "./stage-backdrop.module.css";

/** Frozen character art, never a generated talking-head clip or an inferred crop. */
export function SoloPresentation({ beat, elapsedMs, readingElapsedMs = elapsedMs, paused = false, reducedMotion = false, controlsInset = 0, speechPresentation = "solo", imageOpacity, onImageReady, backgroundUrl, hideSpeech = false, reserveSpeechSpace = !hideSpeech, staticSpeech = false }: {
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
  /** Keep the character anchored when hiding only the outgoing speech bubble. */
  reserveSpeechSpace?: boolean;
  backgroundUrl?: string;
  /** Canonical ballot labels are short receipt facts, not timed dialogue pages. */
  staticSpeech?: boolean;
  onImageReady?: (source: string | null) => void;
}) {
  const { player, speech } = beat;
  const sampled = useSampledStage();
  const motion = speechPresentation === "scene"
    ? { imageOpacity: 1, speechOpacity: sceneSpeechOpacity(speech.text, elapsedMs, reducedMotion), speechElapsedMs: elapsedMs - SCENE_SPEECH_START_MS }
    : soloPresentationMotion(speech.text, elapsedMs, paused, reducedMotion);
  const portraitOpacity = sampled?.continuedActorId === player.id && elapsedMs < SOLO_IMAGE_FADE_MS
    ? 1 : motion.imageOpacity;
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(new Set());
  const fullBody = player.fullBodyReferenceUrl && !failedImages.has(player.fullBodyReferenceUrl) ? player.fullBodyReferenceUrl : null;
  const portrait = resolveAgentAvatarUrl(player.avatarUrl, player.persona, player.name, player.personaKey);
  const source = fullBody ?? (failedImages.has(portrait) ? resolveAgentAvatarUrl(null, player.persona, player.name, player.personaKey) : portrait);
  const frame = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [loaded, setLoaded] = useState({ source: "", width: 0, height: 0 });
  // A retained image does not fire another load event when the next cue uses it.
  // Reannounce only the current successfully loaded source to the new cue.
  useEffect(() => {
    if (loaded.source === source && loaded.width > 0 && loaded.height > 0) onImageReady?.(source);
  }, [loaded, source, onImageReady]);
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
    loaded.source === source ? loaded.height : 0, Boolean(fullBody), controlsInset, 440, player.headRectangle, reserveSpeechSpace);
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
    <RoomBackdrop source={backgroundUrl ?? DEFAULT_ROOM_BACKDROP} />
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
      className={`absolute max-w-none ${fullBody ? `object-contain ${backdropStyles.featheredBody}` : "rounded-full object-cover shadow-2xl ring-1 ring-white/30"}`} style={{ ...geometry.image, opacity: imageOpacity ?? portraitOpacity }} />
    </div>
    {!thought && !hideSpeech && motion.speechOpacity > 0 && <SpeechBubble speaker={player.name} caption={beat.caption ?? beat.purpose} roleLabel={beat.roleLabel}
      text={speech.text} box={bubble} opacity={motion.speechOpacity} typography={speechFit.typography} padding={speechFit.padding} staticSpeech={staticSpeech}
      elapsedMs={speechPresentation === "scene" ? readingElapsedMs - SCENE_SPEECH_START_MS : soloPresentationMotion(speech.text, readingElapsedMs).speechElapsedMs}
      tail={{side:geometry.beside ? "left" : geometry.above ? "bottom" : "top",style:geometry.beside ? {top:Math.min(bubble.height - 16,fullBody ? geometry.tailTop : bubble.height / 2) - 8} : {left:tailLeft - 8}}}/>}
    <ThinkingFocusOverlay frame={frame} layout={focus} />
  </section>;
}
