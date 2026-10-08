"use client";

import { useEffect, useState } from "react";
import { VISUAL_ROOMS, type AcceptedVisualScene, type VisualRoomId } from "@influence/engine/visual-mode";
import {NomineeSelection, type NomineeSelectionBeat} from "./nominee-selection";
import { SoloPresentation } from "./solo-presentation";
import type { PresentationDirector } from "./influence-presentation-director";
import { TimedSpeech } from "./timed-speech";
import { HouseSegment } from "./house-segment";
import { VisualSceneView, type VisualSpeech } from "./visual-scene-view";
import { SCENE_SPEECH_START_MS, sceneSpeechOpacity } from "./scene-speech-timing";
import { SafetyBounceScene } from "./safety-bounce-scene";
import type { SafetyBounceSceneBeat } from "./safety-bounce-scene-model";
import { WinnerScene, type WinnerSceneBeat } from "./winner-scene";
import { PortraitRoom } from "./portrait-room";
import type { GamePlayer } from "@/lib/api";
import { soloPresentationDurationMs, SOLO_EXIT_MS } from "./solo-presentation-timing";
import { visualSpeechDurationMs, VISUAL_SPEECH_FADE_MS } from "@influence/engine/visual-speech";
import { VotePresentation } from "./vote-presentation";
import type { VoteLedgerState } from "./vote-ledger-model";
import type { FormatPresentationRosterPlayer } from "./types";

/** Constructed from accepted dialogue or structured ballot facts at their reveal cue. */
export type VisualPresentationBeat =
  | NomineeSelectionBeat
  | SafetyBounceSceneBeat
  | WinnerSceneBeat
  | { kind: "portrait-room"; roomNumber: number | null; participants: GamePlayer[]; speech: VisualSpeech }
  | { kind: "scene"; sceneId: string; roomId: VisualRoomId; speech: VisualSpeech | null }
  | { kind: "portrait"; purpose: "Introduction" | "Ballot" | "Diary" | "Farewell" | "Conversation" | "Plea"; caption?: string; roleLabel?: string; player: { headRectangle?: import("@influence/engine/character-portrait").HeadRectangle; fullBodyReferenceUrl?: string | null; id: string; name: string; avatarUrl?: string | null; persona: string; personaKey?: string | null }; speech: VisualSpeech }
  | { kind: "house"; text: string | null; title?: string }
  | { kind: "anonymous"; speech: VisualSpeech };

/** Observe the director instead of creating an independent wall-clock speech timer. */
export function VisualPresentation({ director, retainTail = true, ...props }: Omit<Parameters<typeof VisualPresentationFrame>[0], "elapsedMs"> & {
  director: PresentationDirector;
  retainTail?: boolean;
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
  const state = director.getSnapshot();
  const elapsedMs = director.getElapsedBaseMs();
  const holdAtTail = retainTail && state.cursor === state.cueKeys.length - 1 && !director.isAnimating()
    && elapsedMs >= (director.getActiveCue()?.baseDurationMs ?? Infinity);
  return <VisualPresentationFrame {...props} {...clock} holdAtTail={holdAtTail} elapsedMs={elapsedMs} readingElapsedMs={director.getSpeechElapsedBaseMs()} paused={!state.isPlaying && !director.isAnimating()} speechPresentation={director.getActiveCue()?.speechPresentation} navigationRevision={director.getNavigationRevision()} />;
}

export function VisualPresentationFrame({ beat, rooms, retainedScene, elapsedMs, readingElapsedMs: readingTime = elapsedMs, holdAtTail = false, paused = false, reducedMotion = false, status, fullscreen = false, controlsInset = fullscreen ? 140 : 0, navigationRevision = 0, speechPresentation, currentStateEntry = false, voteLedger, roster = [] }: {
  beat: VisualPresentationBeat;
  /** Only saved scene versions applicable at the current replay/presentation sequence. */
  rooms: readonly AcceptedVisualScene[];
  retainedScene?: AcceptedVisualScene | null;
  elapsedMs: number;
  readingElapsedMs?: number;
  holdAtTail?: boolean;
  paused?: boolean;
  currentStateEntry?: boolean;
  reducedMotion?: boolean;
  fullscreen?: boolean;
  controlsInset?: number;
  navigationRevision?: number;
  speechPresentation?: "solo" | "scene";
  status?: "preparing" | "recovery" | null;
  voteLedger?: VoteLedgerState | null;
  roster?: readonly FormatPresentationRosterPlayer[];
}) {
  const [pinnedRoom, setPinnedRoom] = useState<VisualRoomId | null>(null);
  // Older runs without a final tableau still leave a readable last frame.
  const tailTime = beat.kind === "portrait" ? soloPresentationDurationMs(beat.speech.text) - SOLO_EXIT_MS - 1
    : beat.kind === "house" ? (beat.text === null ? 2000 : visualSpeechDurationMs(beat.text)) - VISUAL_SPEECH_FADE_MS - 1 : elapsedMs;
  const clockElapsedMs = holdAtTail ? Math.min(elapsedMs, tailTime) : elapsedMs;
  const readingElapsedMs = holdAtTail ? Math.min(readingTime, tailTime) : readingTime;
  const mingleRooms = rooms.filter((room) => room.roomId.startsWith("mingle-"));
  let content;
  if (beat.kind === "nominee-selection") {
    content = <NomineeSelection beat={beat} elapsedMs={clockElapsedMs} reducedMotion={reducedMotion} />;
  } else if (beat.kind === "winner") {
    content = <WinnerScene beat={beat} fullscreen={fullscreen} controlsInset={controlsInset} />;
  } else if (beat.kind === "safety-bounce") {
    content = <SafetyBounceScene beat={beat} elapsedMs={clockElapsedMs} paused={paused} reducedMotion={reducedMotion} currentStateEntry={currentStateEntry} fullscreen={fullscreen} controlsInset={controlsInset} />;
  } else if (beat.kind === "portrait-room") {
    content = <PortraitRoom beat={beat} controlsInset={controlsInset} elapsedMs={clockElapsedMs} readingElapsedMs={readingElapsedMs} reducedMotion={reducedMotion} speechPresentation={speechPresentation} />;
  } else if (beat.kind === "portrait") {
    content = voteLedger ? <VotePresentation beat={beat} ledger={voteLedger} roster={roster} controlsInset={controlsInset}
      paused={paused} reducedMotion={reducedMotion} elapsedMs={clockElapsedMs} readingElapsedMs={readingElapsedMs} />
      : <SoloPresentation beat={beat} controlsInset={controlsInset} paused={paused} reducedMotion={reducedMotion} elapsedMs={clockElapsedMs} readingElapsedMs={readingElapsedMs} speechPresentation={speechPresentation} />;
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
      <div className="relative flex min-h-0 flex-1 flex-col">
        {scene && <VisualSceneView controlsInset={controlsInset} scene={scene} speech={speech} elapsedMs={clockElapsedMs} readingElapsedMs={readingElapsedMs} speechPresentation={speechPresentation} navigationRevision={navigationRevision} reducedMotion={reducedMotion} />}
      </div>
    </div>;
  }
  return <div className={`w-full text-white ${(beat.kind !== "anonymous" || fullscreen) ? "flex min-h-0 flex-1 flex-col" : ""}`}>
    {content}
    {status && <p role="status" className="mt-3 shrink-0 text-center text-sm text-white/60">{status === "preparing" ? "Preparing the next scene…" : "Using portraits for this scene."}</p>}
  </div>;
}
