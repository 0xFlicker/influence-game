"use client";
import {RoomBackdrop} from "./stage-backdrop";
import {HouseResultLayout} from "@/components/watch/house-result-layout";
import {HouseMessage} from "@/components/watch/house-message";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {useSceneThinking} from "@/components/watch/watch-thinking";
import {FormatPresentation} from "./format-presentation";
import type {FormatPresentationCue} from "./types";
import {sampleWatch} from "@/components/watch/watch-sampling";
import { VISUAL_ROOMS, type AcceptedVisualScene, type VisualRoomId } from "@influence/engine/visual-mode";
import {NomineeSelection, type NomineeSelectionBeat} from "./nominee-selection";
import { influenceRoomBackground, INFLUENCE_ROOMS } from "./influence-rooms";
import { SoloPresentation } from "./solo-presentation";
import type { PresentationDirector } from "./influence-presentation-director";
import { TimedSpeech } from "./timed-speech";
import { HouseSegment } from "./house-segment";
import {ResultStage} from "./result-stage";
import { VisualSceneView, type VisualSpeech } from "./visual-scene-view";
import { SCENE_SPEECH_START_MS, sceneSpeechOpacity } from "./scene-speech-timing";
import { SafetyChain, type SafetyChainBeat } from "./safety-chain";
import { SafetyBounceScene } from "./safety-bounce-scene";
import type { SafetyBounceSceneBeat } from "./safety-bounce-scene-model";
import { WinnerScene, type WinnerSceneBeat } from "./winner-scene";
import { PortraitRoom } from "./portrait-room";
import { AllianceIntroductionStage } from "./alliance-introduction-stage";
import { soloPresentationDurationMs, SOLO_EXIT_MS } from "./solo-presentation-timing";
import { visualSpeechDurationMs, VISUAL_SPEECH_FADE_MS } from "@influence/engine/visual-speech";
import { VotePresentation } from "./vote-presentation";
import type { VoteLedgerState } from "./vote-ledger-model";
import type { FormatPresentationRosterPlayer } from "./types";

/** Constructed from accepted dialogue or structured ballot facts at their reveal cue. */
export type VisualPresentationBeat =
  | {kind:"alliance-introduction"; allianceName:string; participants:FormatPresentationRosterPlayer[]; text:string}
  | {kind:"house-result"; result: VisualPresentationBeat; text:string}
  | {kind:"canonical-result"; headline:string; detail:string; players:FormatPresentationRosterPlayer[]}
  | {kind:"format-result"; cue:FormatPresentationCue; roster:SafetyChainBeat["roster"]}
  | {kind:"elimination-result"; player:FormatPresentationRosterPlayer; counts?:Array<{name:string;votes:number}>; juryCounts?:Array<{name:string;votes:number}>}
  | {kind:"two-names-stage"; cue:FormatPresentationCue; roster:SafetyChainBeat["roster"]}
  | {kind:"two-names-decision"; cue:FormatPresentationCue; roster:SafetyChainBeat["roster"]; player:SafetyChainBeat["roster"][number] & {headRectangle?: import("@influence/engine/character-portrait").HeadRectangle}; speech:VisualSpeech}
  | SafetyChainBeat
  | NomineeSelectionBeat
  | SafetyBounceSceneBeat
  | WinnerSceneBeat
  | { kind: "portrait-room"; roomNumber: number | null; roomLabel?: string; paginateLargeCast?: true; participants: Array<{id: string; name: string; persona: string; personaKey?: string | null; avatarUrl?: string | null}>; speech: VisualSpeech }
  | { kind: "scene"; sceneId: string; roomId: VisualRoomId; roomLabel?: string; speechDurationMs?: number; speech: VisualSpeech | null }
  | { kind: "portrait"; thinkingAllowed?: boolean; purpose: "Decision" | "Night decision" | "Introduction" | "Retrospective" | "Ballot" | "Diary" | "Farewell" | "Conversation" | "Plea"; ballotPurpose?: "empower" | "council"; caption?: string; roleLabel?: string; player: { headRectangle?: import("@influence/engine/character-portrait").HeadRectangle; fullBodyReferenceUrl?: string | null; id: string; name: string; avatarUrl?: string | null; persona: string; personaKey?: string | null }; speech: VisualSpeech }
  | { kind: "house"; text: string | null; title?: string; backgroundUrl?:string }
  | { kind: "anonymous"; speech: VisualSpeech };

/** Observe the director instead of creating an independent wall-clock speech timer. */
export function VisualPresentation({ director, retainTail = true, ...props }: Omit<Parameters<typeof VisualPresentationFrame>[0], "elapsedMs"> & {
  director: PresentationDirector;
  retainTail?: boolean;
}) {
  const cueKey = director.getSnapshot().activeKey;
  const onSceneReadyChange = useCallback((ready: boolean) => {
    if (cueKey) director.setReady(cueKey, ready);
  }, [director, cueKey]);
  useLayoutEffect(() => {
    if (props.beat.kind !== "scene") onSceneReadyChange(true);
    return () => onSceneReadyChange(true);
  }, [props.beat.kind, onSceneReadyChange]);
  const [clock, setClock] = useState(() => ({ elapsedMs: director.getElapsedBaseMs(), paused: !director.getSnapshot().isPlaying }));
  useEffect(() => {
    return sampleWatch(director, () => {
      const state = director.getSnapshot();
      setClock({ elapsedMs: director.getElapsedBaseMs(), paused: !state.isPlaying });
    });
  }, [director]);
  const state = director.getSnapshot();
  const elapsedMs = director.getElapsedBaseMs();
  const holdAtTail = retainTail && state.cursor === state.cueKeys.length - 1 && !director.isAnimating()
    && elapsedMs >= (director.getActiveCue()?.baseDurationMs ?? Infinity);
  return <VisualPresentationFrame {...props} {...clock} onSceneReadyChange={onSceneReadyChange} holdAtTail={holdAtTail} elapsedMs={elapsedMs} readingElapsedMs={director.getSpeechElapsedBaseMs()} paused={!state.isPlaying && !director.isAnimating()} speechPresentation={director.getActiveCue()?.speechPresentation} navigationRevision={director.getNavigationRevision()} />;
}

export function VisualPresentationFrame({ beat, rooms, retainedScene, elapsedMs, readingElapsedMs: readingTime = elapsedMs, holdAtTail = false, paused = false, reducedMotion = false, status, fullscreen = false, controlsInset = fullscreen ? 140 : 0, navigationRevision = 0, speechPresentation, currentStateEntry = false, voteLedger, roster = [], onSceneReadyChange, hideHouseNarration = false, naturalHouseMessages = true, houseLogoUrl }: {
  beat: VisualPresentationBeat;
  hideHouseNarration?: boolean;
  naturalHouseMessages?: boolean;
  houseLogoUrl?: string;
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
  onSceneReadyChange?: (ready: boolean) => void;
}) {
  const [pinnedRoom, setPinnedRoom] = useState<VisualRoomId | null>(null);
  // Older runs without a final tableau still leave a readable last frame.
  const tailTime = beat.kind === "portrait" ? soloPresentationDurationMs(beat.speech.text) - SOLO_EXIT_MS - 1
    : beat.kind === "house" ? (beat.text === null ? 2000 : visualSpeechDurationMs(beat.text)) - VISUAL_SPEECH_FADE_MS - 1 : elapsedMs;
  const clockElapsedMs = holdAtTail ? Math.min(elapsedMs, tailTime) : elapsedMs;
  const readingElapsedMs = holdAtTail ? Math.min(readingTime, tailTime) : readingTime;
  const mingleRooms = rooms.filter((room) => room.roomId.startsWith("mingle-"));
  const backgroundUrl = influenceRoomBackground(beat, voteLedger);
  let content;
  if (beat.kind === "alliance-introduction") {
    content = <AllianceIntroductionStage {...beat} logoUrl={houseLogoUrl} elapsedMs={clockElapsedMs} readingElapsedMs={readingElapsedMs} paused={paused} reducedMotion={reducedMotion} controlsInset={controlsInset} />;
  } else if (beat.kind === "house-result") {
    const result = <VisualPresentationFrame beat={beat.result} naturalHouseMessages={naturalHouseMessages} houseLogoUrl={houseLogoUrl} rooms={rooms} elapsedMs={0} currentStateEntry paused reducedMotion={reducedMotion} fullscreen={fullscreen} controlsInset={0} roster={roster} />;
    content = naturalHouseMessages ? <HouseResultLayout text={beat.text} elapsedMs={readingElapsedMs} logoUrl={houseLogoUrl} controlsInset={fullscreen ? controlsInset : 0}>{result}</HouseResultLayout>
      : <div className="flex min-h-0 flex-1 flex-col gap-3" style={{paddingBottom:fullscreen ? controlsInset : 0}} data-house-result>
        {result}
        {hideHouseNarration ? <div className="shrink-0" style={{height:"clamp(56px, 20vh, 120px)"}} aria-hidden="true" />
          : <div className="relative flex shrink-0 flex-col rounded-xl border border-white/20 bg-black/85 p-3" style={{height:"clamp(56px, 20vh, 120px)"}} aria-label="House summary"><TimedSpeech text={beat.text} elapsedMs={readingElapsedMs} className="text-base leading-relaxed sm:text-lg" /></div>}
      </div>;
  } else if (beat.kind === "canonical-result") {
    content = <ResultStage compactCast={naturalHouseMessages} players={beat.players}><h2 className="text-center text-2xl">{beat.headline}</h2><p className="mt-3 text-center text-sm">{beat.detail}</p></ResultStage>;
  } else if (beat.kind === "elimination-result") {
    content = <ResultStage players={[beat.player]}><p className="text-center text-sm text-rose-200">Eliminated</p><h2 className="mt-3 text-center text-2xl">{beat.player.name} leaves the game</h2>{beat.counts && <p className="mt-3 text-center text-sm">{beat.counts.map(row => `${row.name}: ${row.votes}`).join(" · ")}</p>}{beat.juryCounts && <p className="mt-2 text-center text-sm">Jury tiebreak · {beat.juryCounts.map(row=>`${row.name}: ${row.votes}`).join(" · ")}</p>}</ResultStage>;
  } else if (beat.kind === "two-names-stage" || beat.kind === "format-result") {
    content = <FormatPresentation elapsedMs={clockElapsedMs} reducedMotion={reducedMotion} cue={beat.cue} roster={beat.roster} currentStateEntry={currentStateEntry} controlsInset={controlsInset} />;
  } else if (beat.kind === "two-names-decision") {
    content = <TwoNamesDecision beat={beat} elapsedMs={clockElapsedMs} reducedMotion={reducedMotion} currentStateEntry={currentStateEntry} controlsInset={controlsInset} />;
  } else if (beat.kind === "safety-chain") {
    content = <SafetyChain beat={beat} elapsedMs={clockElapsedMs} reducedMotion={reducedMotion} currentStateEntry={currentStateEntry} controlsInset={controlsInset} />;
  } else if (beat.kind === "nominee-selection") {
    content = <NomineeSelection beat={beat} elapsedMs={clockElapsedMs} reducedMotion={reducedMotion} />;
  } else if (beat.kind === "winner") {
    content = <WinnerScene beat={beat} fullscreen={fullscreen} controlsInset={controlsInset} />;
  } else if (beat.kind === "safety-bounce") {
    content = <SafetyBounceScene beat={beat} elapsedMs={clockElapsedMs} paused={paused} reducedMotion={reducedMotion} currentStateEntry={currentStateEntry} fullscreen={fullscreen} controlsInset={controlsInset} />;
  } else if (beat.kind === "portrait-room") {
    content = <PortraitRoom paginateLargeCast={beat.paginateLargeCast} floorPerspective backgroundUrl={backgroundUrl} beat={beat} controlsInset={controlsInset} elapsedMs={clockElapsedMs} readingElapsedMs={readingElapsedMs} reducedMotion={reducedMotion} speechPresentation={speechPresentation} />;
  } else if (beat.kind === "portrait") {
    content = voteLedger ? <VotePresentation backgroundUrl={backgroundUrl} beat={beat} ledger={voteLedger} roster={roster} controlsInset={controlsInset}
      paused={paused} reducedMotion={reducedMotion} elapsedMs={clockElapsedMs} readingElapsedMs={readingElapsedMs} />
      : <SoloPresentation backgroundUrl={backgroundUrl} beat={beat} controlsInset={controlsInset} paused={paused} reducedMotion={reducedMotion} elapsedMs={clockElapsedMs} readingElapsedMs={readingElapsedMs} speechPresentation={speechPresentation} />;
  } else if (beat.kind === "anonymous") {
    const opacity = sceneSpeechOpacity(beat.speech.text, clockElapsedMs, reducedMotion);
    content = <section aria-label="Anonymous speech" className={`mx-auto w-full max-w-2xl py-10 ${fullscreen ? "flex min-h-0 flex-1 flex-col px-4" : ""}`}><p className="mb-4 text-xs text-white/50">Anonymous</p>{opacity > 0 && <blockquote data-speech-bubble style={{ opacity }} className={`rounded-2xl border border-white/20 bg-black/85 p-5 ${fullscreen ? "flex min-h-0 flex-1 flex-col" : ""}`}>{fullscreen ? <TimedSpeech text={beat.speech.text} elapsedMs={readingElapsedMs - SCENE_SPEECH_START_MS} /> : beat.speech.text}</blockquote>}</section>;
  } else if (beat.kind === "house") {
    const segment = hideHouseNarration && beat.text !== null ? null : <HouseSegment logoUrl={houseLogoUrl} fullscreen={fullscreen} text={beat.text} title={beat.title} elapsedMs={clockElapsedMs} paused={paused} reducedMotion={reducedMotion} />;
    content = naturalHouseMessages && beat.text !== null ? <div style={{paddingBottom:fullscreen ? controlsInset + 8 : 8}} className="relative isolate flex min-h-0 flex-1 flex-col justify-end overflow-hidden p-2"><RoomBackdrop source={beat.backgroundUrl ?? INFLUENCE_ROOMS.lobby} resilient /><div className="h-1/3 min-h-[90px] shrink-0"><HouseMessage text={beat.text} elapsedMs={readingElapsedMs} logoUrl={houseLogoUrl} /></div></div> : beat.backgroundUrl ? <div className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden"><RoomBackdrop source={beat.backgroundUrl} resilient />{segment}</div> : segment;
  } else if (beat.kind === "scene") {
    const isMingle = beat.roomId.startsWith("mingle-");
    const selectedRoom = isMingle && !fullscreen && pinnedRoom && mingleRooms.some((room) => room.roomId === pinnedRoom) ? pinnedRoom : beat.roomId;
    const selectedScene = rooms.find((room) => room.roomId === selectedRoom);
    const scene = selectedScene ?? retainedScene;
    // Never anchor new-scene dialogue to an old scene, including while a room is pinned.
    const speech = selectedScene?.id === beat.sceneId && selectedRoom === beat.roomId ? beat.speech : null;
    content = <div className="flex min-h-0 flex-1 flex-col gap-3">
      {beat.roomLabel && <p data-room-context-label className="shrink-0 text-center text-sm font-medium tracking-wide text-[#e6ce9a]">{beat.roomLabel}</p>}
      {isMingle && !beat.roomLabel && !fullscreen && <nav aria-label="Mingle rooms" className="flex shrink-0 flex-wrap justify-center gap-2">
        <button type="button" aria-pressed={pinnedRoom === null} onClick={() => setPinnedRoom(null)} className="rounded-full border border-white/20 px-3 py-1.5 text-sm aria-pressed:bg-white aria-pressed:text-black">Follow speaker</button>
        {mingleRooms.map((room) => <button key={room.roomId} type="button" aria-pressed={pinnedRoom === room.roomId} onClick={() => setPinnedRoom(room.roomId)} className="rounded-full border border-white/20 px-3 py-1.5 text-sm aria-pressed:bg-white aria-pressed:text-black">{VISUAL_ROOMS[room.roomId].name}</button>)}
      </nav>}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {scene && <VisualSceneView onReadyChange={onSceneReadyChange} controlsInset={controlsInset} scene={scene} speech={speech} elapsedMs={clockElapsedMs} readingElapsedMs={readingElapsedMs} speechPresentation={speechPresentation} speechDurationMs={beat.speechDurationMs} navigationRevision={navigationRevision} reducedMotion={reducedMotion} />}
      </div>
    </div>;
  } else {
    const unsupported: never = beat;
    throw new Error(`Unsupported visual presentation: ${JSON.stringify(unsupported)}`);
  }
  return <div data-presentation-current-entry={currentStateEntry || undefined} className={`w-full text-white ${(beat.kind !== "anonymous" || fullscreen) ? "flex min-h-0 flex-1 flex-col" : ""}`}>
    {content}
    {status && <p role="status" className="mt-3 shrink-0 text-center text-sm text-white/60">{status === "preparing" ? "Preparing the next scene…" : "Using portraits for this scene."}</p>}
  </div>;
}


function TwoNamesDecision({beat, elapsedMs, currentStateEntry, reducedMotion, controlsInset}: {
  beat:Extract<VisualPresentationBeat,{kind:"two-names-decision"}>;elapsedMs:number;currentStateEntry:boolean;reducedMotion:boolean;controlsInset:number;
}) {
  const thought = useSceneThinking();
  if (currentStateEntry || (!thought && elapsedMs >= soloPresentationDurationMs(beat.speech.text))) {
    return <div className="flex min-h-0 flex-1 flex-col" data-two-names-decision-reveal={beat.cue.kind}><FormatPresentation cue={beat.cue} roster={beat.roster} currentStateEntry={currentStateEntry} controlsInset={controlsInset} /></div>;
  }
  return <div data-two-names-decision-speech={beat.cue.kind} className="flex min-h-0 flex-1 flex-col">
    <SoloPresentation backgroundUrl={influenceRoomBackground(beat)} beat={{kind:"portrait",purpose:"Decision",caption:"Two Names",player:beat.player,speech:beat.speech}} elapsedMs={elapsedMs} reducedMotion={reducedMotion} controlsInset={controlsInset} />
  </div>;
}

/** Natural House copy lives with its scenery/result, including when audio is present. */
export function hasInlineHouseMessage(beat: VisualPresentationBeat | null | undefined): boolean {
  return beat?.kind === "alliance-introduction" || beat?.kind === "house-result" || beat?.kind === "house" && beat.text !== null;
}
