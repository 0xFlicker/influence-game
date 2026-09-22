"use client";

import { useEffect, useState } from "react";
import { VISUAL_ROOMS, type AcceptedVisualScene, type VisualRoomId } from "@influence/engine/visual-mode";
import { VISUAL_SPEECH_FADE_MS, visualSpeechOpacity } from "@influence/engine/visual-speech";
import { resolveAgentAvatarUrl } from "@/components/agent-avatar";
import type { PresentationDirector } from "./format-presentation-director";
import { TimedSpeech } from "./timed-speech";
import { HouseSegment } from "./house-segment";
import { VisualSceneView, type VisualSpeech } from "./visual-scene-view";

/** Constructed from accepted dialogue or structured ballot facts at their reveal cue. */
export type VisualPresentationBeat =
  | { kind: "scene"; sceneId: string; roomId: VisualRoomId; speech: VisualSpeech | null }
  | { kind: "portrait"; purpose: "Introduction" | "Ballot" | "Diary" | "Farewell" | "Conversation"; player: { id: string; name: string; avatarUrl?: string | null; persona: string; personaKey?: string | null }; speech: VisualSpeech }
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
      if (state.isPlaying && !state.waitingAtTail) frame = requestAnimationFrame(refresh);
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
  return <VisualPresentationFrame {...props} {...clock} elapsedMs={director.getElapsedBaseMs()} paused={!director.getSnapshot().isPlaying} navigationRevision={director.getNavigationRevision()} />;
}

export function VisualPresentationFrame({ beat, rooms, retainedScene, elapsedMs: clockElapsedMs, paused = false, reducedMotion = false, status, fullscreen = false, navigationRevision = 0 }: {
  beat: VisualPresentationBeat;
  /** Only saved scene versions applicable at the current replay/presentation sequence. */
  rooms: readonly AcceptedVisualScene[];
  retainedScene?: AcceptedVisualScene | null;
  elapsedMs: number;
  paused?: boolean;
  reducedMotion?: boolean;
  fullscreen?: boolean;
  navigationRevision?: number;
  status?: "preparing" | "recovery" | null;
}) {
  // A paused seek must be readable at time zero. This affects presentation only:
  // resuming uses the director's unchanged clock, and expired speech stays gone.
  const elapsedMs = paused ? Math.max(clockElapsedMs, VISUAL_SPEECH_FADE_MS) : clockElapsedMs;
  const [speechNaturalHeight, setSpeechNaturalHeight] = useState<number | undefined>();
  const [pinnedRoom, setPinnedRoom] = useState<VisualRoomId | null>(null);
  const mingleRooms = rooms.filter((room) => room.roomId.startsWith("mingle-"));
  let content;
  if (beat.kind === "portrait") {
    const { player, speech } = beat;
    const opacity = visualSpeechOpacity(speech.text, elapsedMs, reducedMotion);
    content = <section aria-label={`${beat.purpose}: ${player.name}`} className={`mx-auto flex w-full max-w-3xl flex-col items-center gap-4 md:flex-row md:items-start ${fullscreen ? "min-h-0 flex-1 justify-center p-4 md:items-center" : "py-6"}`}>
      <figure style={fullscreen ? { width: "min(24dvh, 12rem)" } : undefined} className={`shrink-0 overflow-hidden rounded-2xl border border-white/20 bg-black p-2 shadow-xl ${fullscreen ? "" : "w-48 md:w-64"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- reuse the frozen player portrait and persona fallback */}
        <img src={resolveAgentAvatarUrl(player.avatarUrl, player.persona, player.name, player.personaKey)} alt={player.name} className="aspect-square w-full rounded-xl object-cover" />
        <figcaption className="px-2 pb-1 pt-3 text-center"><span className="block text-[9px] uppercase tracking-normal text-white/50">{beat.purpose}</span><span className="mt-1 block text-lg font-semibold">{player.name}</span></figcaption>
      </figure>
      <div style={fullscreen && speechNaturalHeight ? { height: speechNaturalHeight + 36 } : undefined} className={`self-stretch ${fullscreen ? "flex min-h-0 max-h-full shrink flex-col justify-center md:flex-1 md:self-center" : "flex-1 min-h-24 pt-4"}`}>
        {opacity > 0 && <blockquote className={`rounded-2xl border border-white/20 bg-black/85 px-5 py-4 text-base leading-relaxed whitespace-pre-wrap break-words ${fullscreen ? "flex min-h-0 max-h-full flex-col" : ""}`} style={{ opacity, height: fullscreen && speechNaturalHeight ? speechNaturalHeight + 36 : undefined }}>{fullscreen ? <TimedSpeech onNaturalHeight={setSpeechNaturalHeight} text={speech.text} elapsedMs={clockElapsedMs} /> : speech.text}</blockquote>}
      </div>
    </section>;
  } else if (beat.kind === "anonymous") {
    const opacity = visualSpeechOpacity(beat.speech.text, elapsedMs, reducedMotion);
    content = <section aria-label="Anonymous speech" className={`mx-auto w-full max-w-2xl py-10 ${fullscreen ? "flex min-h-0 flex-1 flex-col px-4" : ""}`}><p className="mb-4 text-xs text-white/50">Anonymous</p>{opacity > 0 && <blockquote style={{ opacity }} className={`rounded-2xl border border-white/20 bg-black/85 p-5 ${fullscreen ? "flex min-h-0 flex-1 flex-col" : ""}`}>{fullscreen ? <TimedSpeech text={beat.speech.text} elapsedMs={clockElapsedMs} /> : beat.speech.text}</blockquote>}</section>;
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
      {scene && <VisualSceneView controlsInset={fullscreen ? 140 : 0} scene={scene} speech={speech} elapsedMs={elapsedMs} clockElapsedMs={clockElapsedMs} navigationRevision={navigationRevision} reducedMotion={reducedMotion} />}
    </div>;
  }
  return <div className={`w-full text-white ${(beat.kind === "scene" || fullscreen) ? "flex min-h-0 flex-1 flex-col" : ""}`}>
    {content}
    {status && <p role="status" className="mt-3 shrink-0 text-center text-sm text-white/60">{status === "preparing" ? "Preparing the next scene…" : "Using portraits for this scene."}</p>}
  </div>;
}
