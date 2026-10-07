"use client";

import {useBubbleTypography} from "@/components/watch/use-bubble-typography";
import {ThoughtBubble, useSceneThinking} from "@/components/watch/watch-thinking";
import {layoutThought} from "@/components/watch/thought-layout";
import { useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { resolveAgentAvatarUrl } from "@/components/agent-avatar";
import { TimedSpeech } from "./timed-speech";
import type { VisualPresentationBeat } from "./visual-presentation";
import { SCENE_SPEECH_START_MS, sceneSpeechOpacity } from "./scene-speech-timing";
import { soloPresentationMotion } from "./solo-presentation-timing";
import { SOLO_STUDIO_BACKDROP, StageBackdrop } from "./stage-backdrop";

/** Project a semicircle in space, turning the speaker toward the camera. */
export function portraitRoomSeats(width: number, count: number, speakerIndex: number) {
  const diameter = Math.max(0, Math.min(count > 4 ? 140 : 210, width / Math.max(3.3, count + .3)));
  const radius = Math.max(0, (width - diameter - 48) / 2);
  return Array.from({ length: count }, (_, index) => {
    // Rotate the circular seat order, projecting the other seats into the visible semicircle.
    // A literal yaw of a flat half-circle would stack the end seats over each other.
    let offset = (index - Math.max(0, speakerIndex) + count) % count;
    if (offset > count / 2) offset -= count;
    const turn = offset / Math.max(1, Math.floor(count / 2)) * Math.PI * .39;
    const depth = Math.cos(turn);
    return { x: Math.sin(turn) * radius, y: (1 - depth) * -35, z: depth * 60,
      scale: .72 + (depth + 1) * .14, diameter };
  });
}

/** Saved audience membership supplies the cast; asset availability never changes the game. */
export function PortraitRoom({ beat, elapsedMs, readingElapsedMs, reducedMotion, controlsInset, speechPresentation }: {
  beat: Extract<VisualPresentationBeat, { kind: "portrait-room" }>;
  elapsedMs: number; readingElapsedMs: number; reducedMotion: boolean; controlsInset: number;
  speechPresentation?: "solo" | "scene";
}) {
  const frame = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
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
  const speakerIndex = beat.participants.findIndex(player => player.id === beat.speech.playerId);
  const available = Math.max(0, size.height - controlsInset);
  const beside = available < 340 && size.width >= 600;
  const seats = portraitRoomSeats(beside ? size.width * .5 : size.width, beat.participants.length, speakerIndex);
  const centerX = size.width * (beside ? .72 : .5);
  const diameter = Math.min(seats[0]?.diameter ?? 0, available * (beside ? .44 : .34));
  const thought = useSceneThinking();
  const bubbleHeight = Math.max(0, Math.min(300, 248, beside ? available - 56 : available * .45));
  const centerY = beside ? available / 2 : Math.max(diameter / 2 + 44, (available + bubbleHeight) / 2);
  const bubbleTop = beside ? 44 : Math.max(44, centerY - diameter / 2 - bubbleHeight - 24);
  const opacity = speechPresentation === "solo" ? soloPresentationMotion(beat.speech.text, elapsedMs, false, reducedMotion).speechOpacity
    : sceneSpeechOpacity(beat.speech.text, elapsedMs, reducedMotion);
  const speechTime = speechPresentation === "solo" ? soloPresentationMotion(beat.speech.text, readingElapsedMs).speechElapsedMs
    : readingElapsedMs - SCENE_SPEECH_START_MS;
  const rawBubble = {left: beside ? 12 : Math.max(12, (size.width - 480) / 2), top: bubbleTop,
    width: Math.max(0, Math.min(480, beside ? size.width * .43 : size.width - 24)), height: bubbleHeight};
  const thoughtLayout = thought ? layoutThought(size.width, available, rawBubble, {x:centerX, y:centerY - diameter * .2}) : null;
  const speechBox = thoughtLayout?.speech ?? rawBubble;
  const thoughtBox = thoughtLayout?.thought ?? {...speechBox,height:0};
  const speechFit = useBubbleTypography(frame, beat.speech.text, speechBox, "speech", available < 300);
  const thoughtFit = useBubbleTypography(frame, thought?.text ?? "", thoughtBox, "thought", available < 300);
  const fittedThought = {...thoughtBox,width:thoughtFit.typography?.width ?? thoughtBox.width,height:thoughtFit.typography?.height ?? thoughtBox.height};
  const bubble = {...speechBox,width:speechFit.typography?.width ?? speechBox.width,height:speechFit.typography?.height ?? speechBox.height};
  return <section ref={frame} aria-label={beat.roomNumber === null ? "Mingle room" : `Mingle room ${beat.roomNumber}`} data-portrait-room
    className="relative min-h-0 w-full flex-1 overflow-hidden" style={{ perspective: 1200 }}>
    <StageBackdrop source={SOLO_STUDIO_BACKDROP} />
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_70%,transparent,rgba(0,0,0,.55))]" />
    <p className="absolute inset-x-0 top-4 text-center text-xs font-medium uppercase tracking-[.2em] text-white/60">Mingle{beat.roomNumber === null ? "" : ` · Room ${beat.roomNumber}`}</p>
    <div aria-hidden="true" className="absolute rounded-[50%] border border-white/10 bg-black/15" style={{ left: centerX, top: centerY + diameter * .1, width: Math.max(0, size.width * (beside ? .5 : 1) - 80), height: diameter * .7, transform: "translateX(-50%) rotateX(35deg)" }} />
    {beat.participants.map((player, index) => {
      const seat = seats[index]!;
      const active = index === speakerIndex;
      const saved = resolveAgentAvatarUrl(player.avatarUrl, player.persona, player.name, player.personaKey);
      const source = failed.has(saved) ? resolveAgentAvatarUrl(null, player.persona, player.name, player.personaKey) : saved;
      return <motion.div key={player.id} data-room-player={player.id} data-active-speaker={active}
        className="absolute flex flex-col items-center" style={{ left: centerX - diameter / 2, top: centerY - diameter / 2, width: diameter, zIndex: active ? 170 : Math.round(seat.z + 100) }}
        initial={false} animate={{ x: seat.x, y: seat.y, z: seat.z, scale: seat.scale }}
        transition={{ duration: reducedMotion ? 0 : .65, ease: [.25, .1, .25, 1] }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- frozen room cast with a deterministic portrait if art fails */}
        <img src={source} alt={player.name} onError={() => setFailed(previous => new Set(previous).add(saved))}
          className={`aspect-square w-full rounded-full object-cover shadow-2xl ring-2 ${active ? "ring-[#d9c9a2]" : "ring-white/20"}`} />
        <p className={`mt-3 max-w-full truncate rounded-full bg-black/60 px-3 py-1 text-xs ${active ? "text-white" : "text-white/65"}`}>{player.name}</p>
      </motion.div>;
    })}
    {opacity > 0 && <div data-speech-bubble className="absolute z-[200] flex flex-col rounded-2xl border border-white/25 bg-black/90 px-5 py-4 shadow-xl"
      style={{...bubble, opacity, padding:speechFit.padding}}>
      <p className={`mb-2 h-5 shrink-0 truncate text-xs font-semibold leading-5 text-white/70 ${speechFit.typography && speechFit.typography.pages.length > 1 && !speechFit.typography.footerHeight ? "pr-12" : ""}`}>{beat.speech.speaker}</p>
      <TimedSpeech text={beat.speech.text} elapsedMs={speechTime} typography={speechFit.typography} className={thoughtLayout && available < 300 ? "text-xs leading-4" : "text-base leading-relaxed"} />
      <span aria-hidden="true" className={`absolute h-4 w-4 rotate-45 border-white/25 bg-black/90 ${beside ? "-right-2 border-r border-t" : "-bottom-2 left-1/2 -translate-x-1/2 border-r border-b"}`} style={beside ? { top: centerY - bubbleTop - 8 } : undefined} />
    </div>}
    {thoughtLayout && <ThoughtBubble box={fittedThought} head={thoughtLayout.head} typography={thoughtFit.typography} padding={thoughtFit.padding} />}
  </section>;
}
