"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { VISUAL_ROOMS, type AcceptedVisualScene, type VisualRoomId } from "@influence/engine/visual-mode";
import { SoloPresentation } from "./solo-presentation";
import type { PresentationDirector } from "./format-presentation-director";
import { TimedSpeech } from "./timed-speech";
import { HouseSegment } from "./house-segment";
import { VisualSceneView, type VisualSpeech } from "./visual-scene-view";
import { SCENE_SPEECH_START_MS, sceneSpeechOpacity } from "./scene-speech-timing";

/** Each room keeps its own camera; switching rooms changes only opacity. */
function RoomLayer({ reducedMotion, ...props }: Parameters<typeof VisualSceneView>[0]) {
  const present = useIsPresent();
  return <motion.div aria-hidden={!present} className="absolute inset-0 flex min-h-0 flex-col"
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    transition={{ duration: reducedMotion ? 0 : 0.25 }}>
    <VisualSceneView {...props} reducedMotion={reducedMotion} />
  </motion.div>;
}

/** Constructed from accepted dialogue or structured ballot facts at their reveal cue. */
export type VisualPresentationBeat =
  | { kind: "scene"; sceneId: string; roomId: VisualRoomId; speech: VisualSpeech | null }
  | { kind: "portrait"; purpose: "Introduction" | "Ballot" | "Diary" | "Farewell" | "Conversation" | "Plea"; caption?: string; player: { headRectangle?: import("@influence/engine/character-portrait").HeadRectangle; fullBodyReferenceUrl?: string | null; id: string; name: string; avatarUrl?: string | null; persona: string; personaKey?: string | null }; speech: VisualSpeech }
  | { kind: "house"; text: string | null; title?: string }
  | { kind: "anonymous"; speech: VisualSpeech };

/** Observe the director instead of creating an independent wall-clock speech timer. */
export function VisualPresentation({ director, ...props }: Omit<Parameters<typeof VisualPresentationFrame>[0], "elapsedMs"> & {
  director: PresentationDirector;
}) {
  const [clock, setClock] = useState(() => ({ elapsedMs: director.getElapsedBaseMs(), paused: !director.getSnapshot().isPlaying }));
  useEffect(() => {
    let frame: number | null = null;
    const refresh = () => {
      frame = null;
      const state = director.getSnapshot();
      setClock({ elapsedMs: director.getElapsedBaseMs(), paused: !state.isPlaying });
      if (director.isAnimating()) frame = requestAnimationFrame(refresh);
    };
    // Director notifications happen inside state transitions. Read on the next
    // frame, after the transition has also updated its remaining duration.
    const schedule = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(refresh);
    };
    const unsubscribe = director.subscribe(schedule);
    schedule();
    return () => { unsubscribe(); if (frame !== null) cancelAnimationFrame(frame); };
  }, [director]);
  return <VisualPresentationFrame {...props} {...clock} elapsedMs={director.getElapsedBaseMs()} readingElapsedMs={director.getSpeechElapsedBaseMs()} paused={!director.getSnapshot().isPlaying && !director.isAnimating()} speechPresentation={director.getActiveCue()?.speechPresentation} navigationRevision={director.getNavigationRevision()} />;
}

export function VisualPresentationFrame({ beat, rooms, retainedScene, elapsedMs: clockElapsedMs, readingElapsedMs = clockElapsedMs, paused = false, reducedMotion = false, status, fullscreen = false, navigationRevision = 0, speechPresentation }: {
  beat: VisualPresentationBeat;
  /** Only saved scene versions applicable at the current replay/presentation sequence. */
  rooms: readonly AcceptedVisualScene[];
  retainedScene?: AcceptedVisualScene | null;
  elapsedMs: number;
  readingElapsedMs?: number;
  paused?: boolean;
  reducedMotion?: boolean;
  fullscreen?: boolean;
  navigationRevision?: number;
  speechPresentation?: "solo" | "scene";
  status?: "preparing" | "recovery" | null;
}) {
  const [pinnedRoom, setPinnedRoom] = useState<VisualRoomId | null>(null);
  const mingleRooms = rooms.filter((room) => room.roomId.startsWith("mingle-"));
  let content;
  if (beat.kind === "portrait") {
    content = <SoloPresentation beat={beat} controlsInset={fullscreen ? 140 : 0} paused={paused} reducedMotion={reducedMotion} elapsedMs={clockElapsedMs} readingElapsedMs={readingElapsedMs} speechPresentation={speechPresentation} />;
  } else if (beat.kind === "anonymous") {
    const opacity = sceneSpeechOpacity(beat.speech.text, clockElapsedMs, reducedMotion);
    content = <section aria-label="Anonymous speech" className={`mx-auto w-full max-w-2xl py-10 ${fullscreen ? "flex min-h-0 flex-1 flex-col px-4" : ""}`}><p className="mb-4 text-xs text-white/50">Anonymous</p>{opacity > 0 && <blockquote data-speech-bubble style={{ opacity }} className={`rounded-2xl border border-white/20 bg-black/85 p-5 ${fullscreen ? "flex min-h-0 flex-1 flex-col" : ""}`}>{fullscreen ? <TimedSpeech text={beat.speech.text} elapsedMs={readingElapsedMs - SCENE_SPEECH_START_MS} /> : beat.speech.text}</blockquote>}</section>;
  } else if (beat.kind === "house") {
    content = <HouseSegment fullscreen={fullscreen} text={beat.text} title={beat.title} elapsedMs={clockElapsedMs} paused={paused} reducedMotion={reducedMotion} />;
  } else {
    const isMingle = beat.roomId.startsWith("mingle-");
    const selectedRoom = isMingle && !fullscreen && pinnedRoom && mingleRooms.some((room) => room.roomId === pinnedRoom) ? pinnedRoom : beat.roomId;
    const selectedScene = rooms.find((room) => room.roomId === selectedRoom);
    const scene = selectedScene ?? retainedScene;
    // Never anchor new-scene dialogue to an old scene, including while a room is pinned.
    const speech = selectedScene?.id === beat.sceneId && selectedRoom === beat.roomId ? beat.speech : null;
    content = <div className="flex min-h-0 flex-1 flex-col gap-3">
      {isMingle && !fullscreen && <nav aria-label="Mingle rooms" className="flex shrink-0 flex-wrap justify-center gap-2">
        <button type="button" aria-pressed={pinnedRoom === null} onClick={() => setPinnedRoom(null)} className="rounded-full border border-white/20 px-3 py-1.5 text-sm aria-pressed:bg-white aria-pressed:text-black">Follow speaker</button>
        {mingleRooms.map((room) => <button key={room.roomId} type="button" aria-pressed={pinnedRoom === room.roomId} onClick={() => setPinnedRoom(room.roomId)} className="rounded-full border border-white/20 px-3 py-1.5 text-sm aria-pressed:bg-white aria-pressed:text-black">{VISUAL_ROOMS[room.roomId].name}</button>)}
      </nav>}
      <div className="relative min-h-0 flex-1">
        <AnimatePresence initial={false}>
          {scene && <RoomLayer key={`${scene.roomId}:${scene.id}:${scene.version}:${scene.imageUrl}`} controlsInset={fullscreen ? 140 : 0} scene={scene} speech={speech} elapsedMs={clockElapsedMs} readingElapsedMs={readingElapsedMs} speechPresentation={speechPresentation} navigationRevision={navigationRevision} reducedMotion={reducedMotion} />}
        </AnimatePresence>
      </div>
    </div>;
  }
  return <div className={`w-full text-white ${(beat.kind !== "anonymous" || fullscreen) ? "flex min-h-0 flex-1 flex-col" : ""}`}>
    {content}
    {status && <p role="status" className="mt-3 shrink-0 text-center text-sm text-white/60">{status === "preparing" ? "Preparing the next scene…" : "Using portraits for this scene."}</p>}
  </div>;
}
