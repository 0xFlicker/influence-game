"use client";

import {validHeadRectangle} from "@influence/engine/character-portrait";
import {useBubbleTypography} from "@/components/watch/use-bubble-typography";
import {ThoughtBubble, useSceneThinking, useSceneThinkingEnabled} from "@/components/watch/watch-thinking";
import {layoutThought} from "@/components/watch/thought-layout";
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
  const thinkingEnabled = useSceneThinkingEnabled();
  const geometry = layoutSoloPresentation(size.width, size.height, loaded.source === source ? loaded.width : 0,
    loaded.source === source ? loaded.height : 0, Boolean(fullBody), controlsInset, 308, player.headRectangle, fullBody ? thinkingEnabled : Boolean(thought), !hideSpeech);
  const headRect = validHeadRectangle(player.headRectangle) ? player.headRectangle : {x:.4, y:.04, width:.2, height:.16};
  const thoughtOnLeft = geometry.thought && geometry.thought.left < geometry.image.left;
  // Aim beside the upper head, never through the mouth or the center of the face.
  const head = {x: geometry.image.left + geometry.image.width * (thoughtOnLeft ? headRect.x : headRect.x + headRect.width),
    y: geometry.image.top + geometry.image.height * (headRect.y + headRect.height * .25)};
  const thoughtLayout = thought && geometry.thought ? {thought:geometry.thought, speech:geometry.bubble, head} : thought ? layoutThought(size.width, Math.max(0, size.height - controlsInset), geometry.bubble,
    {x: geometry.image.left + geometry.image.width * .65, y: geometry.image.top + geometry.image.height * .28}) : null;
  const available = Math.max(0, size.height - controlsInset);
  // On narrow screens, give the upper text and headshot neighboring space.
  // The thought tail can touch the portrait without obscuring the entire face.
  if (thoughtLayout && !fullBody && size.width < 760 && available >= 300) {
    const diameter = Math.min(160, size.width * .28, available * .3);
    thoughtLayout.thought = {left: diameter + 24, top: 12, width: Math.max(0, size.width - diameter - 36), height: Math.min(160, available * .36)};
    geometry.image = {left:12, top:thoughtLayout.thought.top + thoughtLayout.thought.height + 12 - diameter * .28, width:diameter, height:diameter};
    geometry.tailLeft = diameter / 2;
    thoughtLayout.head = {x:geometry.image.left + diameter * .7, y:geometry.image.top + diameter * .28};
    const top = Math.max(geometry.image.top + diameter + 16, thoughtLayout.thought.top + thoughtLayout.thought.height + 16);
    thoughtLayout.speech = {left:12, top, width:Math.max(0,size.width - 24), height:Math.max(0, available - top - 12)};
  }
  const compact = available < 300 || Boolean(thought && size.width < 760);
  const speechBox = thoughtLayout?.speech ?? geometry.bubble;
  const thoughtBox = thoughtLayout?.thought ?? {...speechBox, height:0};
  const speechFit = useBubbleTypography(frame, speech.text, speechBox, "speech", compact);
  const thoughtFit = useBubbleTypography(frame, thought?.text ?? "", thoughtBox, "thought", compact);
  const fittedThought = {...thoughtBox, width:thoughtFit.typography?.width ?? thoughtBox.width, height:thoughtFit.typography?.height ?? thoughtBox.height};
  const bubble = {...speechBox, width:speechFit.typography?.width ?? speechBox.width, height:speechFit.typography?.height ?? speechBox.height,
    top:thoughtLayout && !fullBody ? Math.max(fittedThought.top + fittedThought.height + 16, speechBox.top - (thoughtBox.height - fittedThought.height)) : speechBox.top};
  return <section ref={frame} aria-label={`${beat.purpose}: ${player.name}`} data-solo-image={fullBody ? "full-body" : "portrait"}
    className="relative min-h-0 w-full flex-1 overflow-hidden bg-black">
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
    {!hideSpeech && motion.speechOpacity > 0 && <div data-speech-bubble style={{ ...bubble, opacity: motion.speechOpacity, padding:speechFit.padding }} className="absolute flex flex-col rounded-2xl border border-white/25 bg-black/85 shadow-xl">
      <p className={`mb-2 flex h-5 shrink-0 items-baseline gap-x-2 overflow-hidden text-xs font-semibold leading-5 ${speechFit.typography && speechFit.typography.pages.length > 1 && !speechFit.typography.footerHeight ? "pr-12" : ""}`}><span className="truncate">{player.name}</span><span className="shrink-0 text-xs font-normal text-white/50">{beat.caption ?? beat.purpose}</span></p>
      <blockquote className="flex min-h-0 flex-1 flex-col">
        {staticSpeech ? <p className="break-words" style={{fontSize:speechFit.typography?.fontSize,lineHeight:1.4}}>{speech.text}</p> : <TimedSpeech text={speech.text} elapsedMs={speechPresentation === "scene" ? readingElapsedMs - SCENE_SPEECH_START_MS : soloPresentationMotion(speech.text, readingElapsedMs).speechElapsedMs} typography={speechFit.typography} />}
      </blockquote>
      <span aria-hidden="true" className={`absolute h-4 w-4 rotate-45 border-white/25 bg-black ${geometry.beside ? "-left-2 top-1/2 border-l border-b" : geometry.above ? "-bottom-2 border-r border-b" : "-top-2 border-l border-t"}`} style={geometry.beside ? undefined : { left: geometry.tailLeft - 8 }} />
    </div>}
    {thoughtLayout && <ThoughtBubble box={fittedThought} head={thoughtLayout.head} typography={thoughtFit.typography} padding={thoughtFit.padding} />}
  </section>;
}
