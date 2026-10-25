"use client";
import {HouseNarration, type NarrationWindow} from "@/components/watch/house-narration";
import {WerewolfVoteOutcome} from "./werewolf-vote-outcome";
import {WerewolfTransformationStage} from "./werewolf-transformation-stage";
import {WerewolfNightOutcome} from "./werewolf-night-outcome";
import {WerewolfRoleStage} from "./werewolf-role-stage";
import {WerewolfHuntStage} from "./werewolf-hunt-stage";
import {WatchWaiting} from "@/components/watch/watch-waiting";
import {useCallback, useEffect, useLayoutEffect, useState} from "react";
import type {AcceptedVisualScene} from "@influence/engine/visual-mode";
import {selectVisualShot} from "@influence/engine/visual-mode";
import type {PresentationDirector} from "@/components/watch/watch-director";
import {VisualSceneView} from "@/app/games/[slug]/components/visual-scene-view";
import {PortraitRoom} from "@/app/games/[slug]/components/portrait-room";
import {VotePresentation} from "@/app/games/[slug]/components/vote-presentation";
import type {VisualPresentationBeat} from "@/app/games/[slug]/components/visual-presentation";
import {WEREWOLF_ROOMS} from "./werewolf-rooms";
import {RoomBackdrop} from "@/app/games/[slug]/components/stage-backdrop";
import {werewolfCueMoment, type WerewolfWatchCue} from "./werewolf-watch-model";
import {replayMoment} from "./replay-moment";
import {WerewolfSoloShot} from "./werewolf-solo-shot";
import {SOLO_EXIT_MS} from "@/app/games/[slug]/components/solo-presentation-timing";

const ignoreReadiness = () => {};
type Neighbors = {previousCue?: WerewolfWatchCue; nextCue?: WerewolfWatchCue; hideHouseCaption?: boolean};

export function WerewolfWatchStage({cue, scene, elapsed, reduced, director, holding, status, contextLabel, navigationRevision = 0, previousCue, nextCue, houseNarration, hideHouseCaption}: Neighbors & {houseNarration?: NarrationWindow | null; cue: WerewolfWatchCue | null; scene: AcceptedVisualScene | null; elapsed: number; reduced: boolean; director: Pick<PresentationDirector<WerewolfWatchCue>, "manualAdvance" | "setReady" | "getSpeechElapsedBaseMs" | "getSnapshot">; holding: boolean; status?: string; contextLabel?: string; navigationRevision?: number}) {
  const moment = cue ? werewolfCueMoment(cue) : null;
  const stageElapsed = holding && cue && moment?.retrospective ? Math.min(elapsed, cue.baseDurationMs - SOLO_EXIT_MS - 1) : elapsed;
  return <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-black" data-werewolf-stage data-cursor={cue?.moment.cursor} data-elapsed={Math.floor(elapsed)} onClick={event => {if (!(event.target instanceof Element) || !event.target.closest("button,a,input,select,summary")) director.manualAdvance();}}>
    <div className="z-20 shrink-0 truncate border-b border-white/10 bg-black/80 px-4 py-2 text-xs text-white/60" data-watch-context>{cue?.nightAction ? `Night ${cue.moment.snapshot.day} · ${cue.nightAction.kind === "hunt" ? "The hunt" : cue.nightAction.kind === "protect" ? "Doctor" : "Seer"}` : contextLabel ?? moment?.title ?? "The village"}</div>
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {cue && moment && (!holding || cue.moment.entry.kind === "result" || moment.retrospective) ? <SceneContent hideHouseCaption={hideHouseCaption} previousCue={previousCue} nextCue={nextCue} key={scene ? `${scene.id}:${scene.version}` : "portrait"} navigationRevision={navigationRevision} cue={cue} moment={moment} scene={scene} elapsed={stageElapsed} reduced={reduced} director={director} /> : <WatchWaiting label={status === "in_progress" ? "Waiting for the next scene…" : status === "suspended" ? "Game paused. Waiting for the House…" : holding ? "End of available conversation" : "Preparing the village…"} />}
      {moment?.house && <HouseNarration text={moment.text} window={houseNarration ?? null} />}
    </div>
  </div>;
}
function SceneContent({cue, moment, scene, elapsed, reduced, director, navigationRevision, previousCue, nextCue, hideHouseCaption}: Neighbors & {navigationRevision: number; cue: WerewolfWatchCue; moment: ReturnType<typeof replayMoment>; scene: AcceptedVisualScene | null; elapsed: number; reduced: boolean; director: Pick<PresentationDirector<WerewolfWatchCue>, "manualAdvance" | "setReady" | "getSpeechElapsedBaseMs" | "getSnapshot">}) {
  const shot = scene?.shots ? selectVisualShot(scene.shots, moment.actor?.id) : null;
  const covered = Boolean(scene && moment.actor && (shot ? shot.visibleParticipantIds.includes(moment.actor.id) : scene.anchors.some(anchor => anchor.playerId === moment.actor?.id && anchor.confidence === "clear")));
  const readinessKey = `${cue.key}:${shot?.imageUrl ?? scene?.imageUrl ?? moment.actor?.avatarUrl ?? "none"}`;
  const initialReady = cue.nightDecision ? !moment.actor?.avatarUrl : !cue.nightAction && cue.moment.entry.kind === "night" ? true : cue.transformation && elapsed < cue.transformation.durationMs ? false : cue.nightAction ? cue.nightAction.kind !== "hunt" || !scene : !covered && !moment.actor?.avatarUrl;
  const [readiness, setReadiness] = useState({key: readinessKey, ready: initialReady, timedOut: false});
  if (readiness.key !== readinessKey) setReadiness({key: readinessKey, ready: initialReady, timedOut: false});
  const ready = readiness.key === readinessKey ? readiness.ready : initialReady;
  const timedOut = readiness.key === readinessKey && readiness.timedOut;
  const onReady = useCallback((value: boolean) => {
    setReadiness(current => current.key === readinessKey && current.ready !== value ? {...current, ready: value} : current);
  }, [readinessKey]);
  useLayoutEffect(() => { director.setReady(cue.key, ready); }, [director, cue.key, ready]);
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setReadiness(current => current.key === readinessKey ? {...current, timedOut: true, ready: true} : current), 8000);
    return () => clearTimeout(timer);
  }, [readinessKey, ready]);
  return <WerewolfContentFrame hideHouseCaption={hideHouseCaption} previousCue={previousCue} nextCue={nextCue} cue={cue} scene={scene} elapsed={elapsed} reduced={reduced} navigationRevision={navigationRevision}
    timedOut={timedOut} readingElapsed={moment.retrospective ? Math.min(director.getSpeechElapsedBaseMs(), elapsed) : director.getSpeechElapsedBaseMs()} paused={!director.getSnapshot().isPlaying} onReady={onReady ?? ignoreReadiness} />;
}

/** Content only: browser readiness and export preparation own loading independently. */
export function WerewolfContentFrame({cue, scene, elapsed, reduced, navigationRevision = 0, timedOut = false, readingElapsed: readingTime = elapsed, paused = false, onReady, previousCue, nextCue, hideHouseCaption}: Neighbors & {
  cue: WerewolfWatchCue; scene: AcceptedVisualScene | null; elapsed: number; reduced: boolean;
  navigationRevision?: number; timedOut?: boolean; readingElapsed?: number; paused?: boolean; onReady?: (ready: boolean) => void;
}) {
  const moment = werewolfCueMoment(cue);
  const shot = scene?.shots ? selectVisualShot(scene.shots, moment.actor?.id) : null;
  const covered = Boolean(scene && moment.actor && (shot ? shot.visibleParticipantIds.includes(moment.actor.id) : scene.anchors.some(anchor => anchor.playerId === moment.actor?.id && anchor.confidence === "clear")));
  const visual = !cue.nightAction && !moment.retrospective && !cue.ballot && covered && scene && !timedOut;
  const sourceActor = cue.ballot ? cue.moment.snapshot.players.find(p => p.id === cue.ballot?.current.voterId) : moment.actor;
  const actor = sourceActor && moment.pack && cue.moment.wolfForms?.[sourceActor.id]
    ? {...sourceActor, fullBodyReferenceUrl: cue.moment.wolfForms[sourceActor.id]} : sourceActor;
  const lead = cue.transformation?.durationMs ?? 0;
  const sceneElapsed = Math.max(0, elapsed - lead);
  const readingElapsed = Math.max(0, readingTime - lead);
  const text = cue.moment.entry.kind === "ballot" ? moment.spoken ? moment.text : "" : cue.ballot ? cue.moment.snapshot.players.find(p => p.id === cue.ballot?.current.targetId)?.name ?? "" : moment.text;
  const backgroundUrl = cue.nightAction?.kind === "protect" ? WEREWOLF_ROOMS.doctor : cue.nightAction?.kind === "investigate" ? WEREWOLF_ROOMS.seer : moment.pack ? WEREWOLF_ROOMS.pack : WEREWOLF_ROOMS.village;
  const beat: Extract<VisualPresentationBeat, {kind:"portrait"}> | null = actor ? {
    kind:"portrait", purpose: cue.nightDecision ? "Night decision" : moment.retrospective ? "Retrospective" : cue.ballot ? "Ballot" : cue.moment.chapterId === "introduction" ? "Introduction" : moment.spoken ? "Conversation" : "Farewell",
    caption: cue.nightDecision ? "Tonight’s choice" : moment.retrospective ? `Retrospective · ${moment.part ?? "Contestant"}` : cue.ballot ? "Vote to eliminate" : cue.moment.chapterId === "introduction" ? "Introduction" : moment.spoken ? moment.pack ? "Pack conversation" : "Conversation" : "",
    roleLabel: cue.moment.snapshot.audience === "omniscient" || moment.retrospective ? actor.role ?? undefined : undefined,
    player: {...actor, persona: ""},
    speech: {id:cue.key, playerId:actor.id, speaker:actor.name, text, portrait:{avatarUrl:actor.avatarUrl, persona:""}},
  } : null;
  const room: Extract<VisualPresentationBeat, {kind:"portrait-room"}> | null = beat && moment.spoken && !moment.retrospective &&
    (cue.moment.entry.kind === "discussion" || cue.moment.entry.kind === "conversation" || cue.moment.entry.kind === "proposal" || cue.moment.entry.kind === "speech" && moment.pack) ? {
      kind: "portrait-room", roomNumber: null,
      roomLabel: moment.pack ? `Night ${cue.moment.snapshot.day} · Pack conversation` : `Day ${cue.moment.snapshot.day} · Village conversation`,
      participants: cue.moment.snapshot.players.filter(player => player.alive && (!moment.pack || player.role === "werewolf"))
        .map(player => ({id: player.id, name: player.name, avatarUrl: player.avatarUrl, personaKey: player.personaKey, persona: ""})),
      speech: {...beat.speech, speaker: moment.speaker},
    } : null;
  const previousMoment = previousCue ? werewolfCueMoment(previousCue) : null;
  const previousEntry = previousCue?.moment.entry;
  const previousRoomSpeech = previousEntry && previousMoment?.spoken && !previousMoment.retrospective
    && (previousEntry.kind === "discussion" || previousEntry.kind === "conversation" || previousEntry.kind === "proposal" || previousEntry.kind === "speech" && previousMoment.pack);
  const previousRoomSpeakerId = previousRoomSpeech && previousMoment.pack === moment.pack && previousEntry.day === cue.moment.entry.day
    && room?.participants.some(player => player.id === previousMoment.actor?.id) ? previousMoment.actor!.id : null;
  if (cue.transformation && elapsed < lead) return <WerewolfTransformationStage cue={cue} elapsed={elapsed} reduced={reduced} onReady={onReady ?? ignoreReadiness} />;
  if (!cue.nightAction && cue.moment.entry.kind === "night" && cue.moment.entry.killedId) return <WerewolfNightOutcome cue={cue} elapsed={elapsed} reduced={reduced} hideCaption={hideHouseCaption} />;
  if (!cue.ballot && cue.moment.entry.kind === "vote" && cue.moment.entry.result.eliminatedId) return <WerewolfVoteOutcome cue={cue} elapsed={elapsed} reduced={reduced} hideCaption={hideHouseCaption} onReady={onReady} />;
  if (cue.nightAction?.kind === "hunt") return <WerewolfHuntStage cue={cue} scene={timedOut ? null : scene} onReady={onReady ?? ignoreReadiness} />;
  if (cue.nightAction && !cue.nightDecision) return <WerewolfRoleStage action={cue.nightAction} players={cue.moment.snapshot.players} />;
  if (cue.ballot && beat) return <VotePresentation backgroundUrl={WEREWOLF_ROOMS.vote} beat={beat} ledger={cue.ballot}
    roster={cue.moment.snapshot.players.map(p => ({id:p.id, name:p.name, persona:"", avatarUrl:p.avatarUrl ?? undefined}))}
    elapsedMs={sceneElapsed} readingElapsedMs={readingElapsed} reducedMotion={reduced}
    paused={paused} staticSpeech={cue.moment.entry.kind !== "ballot"} silent={cue.moment.entry.kind === "ballot" ? !moment.spoken : cue.ballot.current.targetId === null} onImageReady={() => onReady?.(true)} />;
  return <>
    {visual ? <VisualSceneView paused={paused} navigationRevision={navigationRevision} scene={scene} focusPlayerId={moment.actor?.id} speech={moment.spoken && moment.actor ? {id: cue.key, playerId: moment.actor.id, speaker: moment.speaker, text: moment.text, portrait: {avatarUrl: moment.actor.avatarUrl, persona: "", personaKey: moment.actor.personaKey}} : null} elapsedMs={sceneElapsed} readingElapsedMs={readingElapsed} reducedMotion={reduced} onReadyChange={onReady} /> : room ? <PortraitRoom previousSpeakerId={previousRoomSpeakerId} floorPerspective backgroundUrl={backgroundUrl} beat={room} elapsedMs={sceneElapsed} readingElapsedMs={readingElapsed} reducedMotion={reduced} controlsInset={0} speechPresentation="scene" onImageReady={() => onReady?.(true)} /> : beat ? <WerewolfSoloShot cue={cue} previousCue={previousCue} nextCue={nextCue} backgroundUrl={backgroundUrl} beat={beat} elapsedMs={sceneElapsed} readingElapsedMs={readingElapsed}
      paused={paused} speechPresentation={moment.retrospective || cue.nightDecision ? "solo" : "scene"} reducedMotion={reduced} hideSpeech={!moment.spoken || moment.house} onImageReady={() => onReady?.(true)} /> : <RoomBackdrop source={backgroundUrl} />}
    {(!moment.spoken || moment.house && !hideHouseCaption) && <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 mx-auto max-h-[80%] max-w-xl overflow-y-auto rounded-xl border border-white/15 bg-black/90 p-5 text-center">
      <p className="text-xs text-white/50">The House</p><h2 className="mt-2 text-2xl text-white">{moment.text}</h2>
      {moment.details.length > 0 && <ul className="mt-4 space-y-1 text-sm text-white/65">{moment.details.map((detail,index) => <li key={index}>{detail}</li>)}</ul>}
    </div>}
  </>;
}
