"use client";

import { useEffect, useState } from "react";
import { VISUAL_ROOMS, type AcceptedVisualScene, type VisualRoomId } from "@influence/engine/visual-mode";
import { visualSpeechOpacity } from "@influence/engine/visual-speech";
import { resolveAgentAvatarUrl } from "@/components/agent-avatar";
import type { PresentationDirector } from "./format-presentation-director";
import { VisualSceneView, type VisualSpeech } from "./visual-scene-view";

/** Constructed from accepted dialogue or structured ballot facts at their reveal cue. */
export type VisualPresentationBeat =
  | { kind: "scene"; sceneId: string; roomId: VisualRoomId; speech: VisualSpeech | null }
  | { kind: "portrait"; purpose: "Introduction" | "Ballot" | "Diary" | "Farewell"; player: { id: string; name: string; avatarUrl?: string | null; persona: string; personaKey?: string | null }; speech: VisualSpeech }
  | { kind: "house"; text: string };

/** Observe the director instead of creating an independent wall-clock speech timer. */
export function VisualPresentation({ director, ...props }: Omit<Parameters<typeof VisualPresentationFrame>[0], "elapsedMs"> & {
  director: PresentationDirector;
}) {
  const [elapsedMs, setElapsedMs] = useState(() => director.getElapsedBaseMs());
  useEffect(() => {
    let frame: number | null = null;
    const refresh = () => {
      frame = null;
      setElapsedMs(director.getElapsedBaseMs());
      const state = director.getSnapshot();
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
  return <VisualPresentationFrame {...props} elapsedMs={elapsedMs} />;
}

export function VisualPresentationFrame({ beat, rooms, retainedScene, elapsedMs, reducedMotion = false, status }: {
  beat: VisualPresentationBeat;
  /** Only saved scene versions applicable at the current replay/presentation sequence. */
  rooms: readonly AcceptedVisualScene[];
  retainedScene?: AcceptedVisualScene | null;
  elapsedMs: number;
  reducedMotion?: boolean;
  status?: "preparing" | "recovery" | null;
}) {
  const [pinnedRoom, setPinnedRoom] = useState<VisualRoomId | null>(null);
  const mingleRooms = rooms.filter((room) => room.roomId.startsWith("mingle-"));
  let content;
  if (beat.kind === "portrait") {
    const { player, speech } = beat;
    const opacity = visualSpeechOpacity(speech.text, elapsedMs, reducedMotion);
    content = <section aria-label={`${beat.purpose}: ${player.name}`} className="mx-auto flex max-w-3xl flex-col items-center gap-6 py-6 md:flex-row md:items-start">
      <figure className="w-48 shrink-0 overflow-hidden rounded-2xl border border-white/20 bg-black p-2 shadow-xl md:w-64">
        {/* eslint-disable-next-line @next/next/no-img-element -- reuse the frozen player portrait and persona fallback */}
        <img src={resolveAgentAvatarUrl(player.avatarUrl, player.persona, player.name, player.personaKey)} alt={player.name} className="aspect-square w-full rounded-xl object-cover" />
        <figcaption className="px-2 pb-1 pt-3 text-center"><span className="block text-xs uppercase tracking-widest text-white/50">{beat.purpose}</span><span className="mt-1 block text-lg font-semibold">{player.name}</span></figcaption>
      </figure>
      <div className="min-h-24 flex-1 self-stretch pt-4">
        {opacity > 0 && <blockquote className="rounded-2xl border border-white/20 bg-black/85 px-5 py-4 text-base leading-relaxed whitespace-pre-wrap break-words" style={{ opacity }}>{speech.text}</blockquote>}
      </div>
    </section>;
  } else if (beat.kind === "house") {
    content = <section aria-label="House summary" className="mx-auto max-w-2xl py-10"><p className="mb-4 text-xs uppercase tracking-widest text-white/50">The House</p><p className="whitespace-pre-wrap text-lg leading-relaxed">{beat.text}</p></section>;
  } else {
    const isMingle = beat.roomId.startsWith("mingle-");
    const selectedRoom = isMingle && pinnedRoom && mingleRooms.some((room) => room.roomId === pinnedRoom) ? pinnedRoom : beat.roomId;
    const selectedScene = rooms.find((room) => room.roomId === selectedRoom);
    const scene = selectedScene ?? retainedScene;
    // Never anchor new-scene dialogue to an old scene, including while a room is pinned.
    const speech = selectedScene?.id === beat.sceneId && selectedRoom === beat.roomId ? beat.speech : null;
    content = <div className="space-y-3">
      {isMingle && <nav aria-label="Mingle rooms" className="flex flex-wrap justify-center gap-2">
        <button type="button" aria-pressed={pinnedRoom === null} onClick={() => setPinnedRoom(null)} className="rounded-full border border-white/20 px-3 py-1.5 text-sm aria-pressed:bg-white aria-pressed:text-black">Follow speaker</button>
        {mingleRooms.map((room) => <button key={room.roomId} type="button" aria-pressed={pinnedRoom === room.roomId} onClick={() => setPinnedRoom(room.roomId)} className="rounded-full border border-white/20 px-3 py-1.5 text-sm aria-pressed:bg-white aria-pressed:text-black">{VISUAL_ROOMS[room.roomId].name}</button>)}
      </nav>}
      {scene && <VisualSceneView scene={scene} speech={speech} elapsedMs={elapsedMs} reducedMotion={reducedMotion} />}
    </div>;
  }
  return <div className="w-full text-white">
    {content}
    {status && <p role="status" className="mt-3 text-center text-sm text-white/60">{status === "preparing" ? "Preparing the next scene…" : "Scene preparation paused. Awaiting recovery."}</p>}
  </div>;
}
