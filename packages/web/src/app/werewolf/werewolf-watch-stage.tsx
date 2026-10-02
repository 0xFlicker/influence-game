"use client";
import {WatchWaiting} from "@/components/watch/watch-waiting";
import {useCallback, useEffect, useLayoutEffect, useState} from "react";
import type {AcceptedVisualScene} from "@influence/engine/visual-mode";
import {selectVisualShot} from "@influence/engine/visual-mode";
import type {PresentationDirector} from "@/components/watch/watch-director";
import {VisualSceneView} from "../games/[slug]/components/visual-scene-view";
import {SoloPresentation} from "../games/[slug]/components/solo-presentation";
import {VotePresentation} from "../games/[slug]/components/vote-presentation";
import type {VisualPresentationBeat} from "../games/[slug]/components/visual-presentation";
import type {WerewolfWatchCue} from "./werewolf-watch-model";
import {replayMoment} from "./replay-moment";

export function WerewolfWatchStage({cue, scene, elapsed, reduced, director, holding, status, contextLabel, navigationRevision = 0}: {cue: WerewolfWatchCue | null; scene: AcceptedVisualScene | null; elapsed: number; reduced: boolean; director: PresentationDirector<WerewolfWatchCue>; holding: boolean; status?: string; contextLabel?: string; navigationRevision?: number}) {
  const moment = cue ? replayMoment({...cue.moment.snapshot, entries: [cue.moment.entry]}) : null;
  return <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-black" data-werewolf-stage data-cursor={cue?.moment.cursor} data-elapsed={Math.floor(elapsed)} onClick={event => {if (!(event.target instanceof Element) || !event.target.closest("button,a,input,select,summary")) director.manualAdvance();}}>
    <div className="z-20 shrink-0 truncate border-b border-white/10 bg-black/80 px-4 py-2 text-xs text-white/60" data-watch-context>{contextLabel ?? moment?.title ?? "The village"}</div>
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {cue && moment && (!holding || cue.moment.entry.kind === "result") ? <SceneContent key={scene ? `${scene.id}:${scene.version}` : "portrait"} navigationRevision={navigationRevision} cue={cue} moment={moment} scene={scene} elapsed={elapsed} reduced={reduced} director={director} /> : <WatchWaiting label={status === "in_progress" ? "Waiting for the next scene…" : status === "suspended" ? "Game paused. Waiting for the House…" : holding ? "End of available conversation" : "Preparing the village…"} />}
    </div>
  </div>;
}
function SceneContent({cue, moment, scene, elapsed, reduced, director, navigationRevision}: {navigationRevision: number; cue: WerewolfWatchCue; moment: ReturnType<typeof replayMoment>; scene: AcceptedVisualScene | null; elapsed: number; reduced: boolean; director: PresentationDirector<WerewolfWatchCue>}) {
  const shot = scene?.shots ? selectVisualShot(scene.shots, moment.actor?.id) : null;
  const covered = Boolean(scene && moment.actor && (shot ? shot.visibleParticipantIds.includes(moment.actor.id) : scene.anchors.some(anchor => anchor.playerId === moment.actor?.id && anchor.confidence === "clear")));
  const readinessKey = `${cue.key}:${shot?.imageUrl ?? scene?.imageUrl ?? moment.actor?.avatarUrl ?? "none"}`;
  const initialReady = !covered && !moment.actor?.avatarUrl;
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
  const visual = !cue.ballot && covered && scene && !timedOut;
  const actor = cue.ballot ? cue.moment.snapshot.players.find(p => p.id === cue.ballot?.current.voterId) : moment.actor;
  const text = cue.ballot ? cue.moment.snapshot.players.find(p => p.id === cue.ballot?.current.targetId)?.name ?? "" : moment.text;
  const beat: Extract<VisualPresentationBeat, {kind:"portrait"}> | null = actor ? {
    kind:"portrait", purpose: cue.ballot ? "Ballot" : cue.moment.chapterId === "introduction" ? "Introduction" : moment.spoken ? "Conversation" : "Farewell",
    caption: cue.ballot ? "Vote to eliminate" : cue.moment.chapterId === "introduction" ? "Introduction" : moment.spoken ? moment.pack ? "Pack conversation" : "Conversation" : "",
    player: {...actor, name: `${actor.name}${cue.moment.snapshot.audience === "omniscient" && actor.role ? ` · ${actor.role}` : ""}`, persona: ""},
    speech: {id:cue.key, playerId:actor.id, speaker:actor.name, text, portrait:{avatarUrl:actor.avatarUrl, persona:""}},
  } : null;
  if (cue.ballot && beat) return <VotePresentation beat={beat} ledger={cue.ballot}
    roster={cue.moment.snapshot.players.map(p => ({id:p.id, name:p.name, persona:"", avatarUrl:p.avatarUrl ?? undefined}))}
    elapsedMs={elapsed} readingElapsedMs={director.getSpeechElapsedBaseMs()} reducedMotion={reduced}
    paused={!director.getSnapshot().isPlaying} silent={cue.ballot.current.targetId === null} onImageReady={() => onReady(true)} />;
  return <>
    {visual ? <VisualSceneView paused={!director.getSnapshot().isPlaying} navigationRevision={navigationRevision} scene={scene} focusPlayerId={moment.actor?.id} speech={moment.spoken && moment.actor ? {id: cue.key, playerId: moment.actor.id, speaker: moment.speaker, text: moment.text, portrait: {avatarUrl: moment.actor.avatarUrl, persona: "", personaKey: moment.actor.personaKey}} : null} elapsedMs={elapsed} readingElapsedMs={director.getSpeechElapsedBaseMs()} reducedMotion={reduced} onReadyChange={onReady} /> : beat ? <SoloPresentation beat={beat} elapsedMs={elapsed} readingElapsedMs={director.getSpeechElapsedBaseMs()}
      speechPresentation="scene" reducedMotion={reduced} hideSpeech={!moment.spoken} onImageReady={() => onReady(true)} /> : <div className="flex-1 bg-black" />}

    {!moment.spoken && <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 mx-auto max-h-[80%] max-w-xl overflow-y-auto rounded-xl border border-white/15 bg-black/90 p-5 text-center">
      <p className="text-xs text-white/50">The House</p><h2 className="mt-2 text-2xl text-white">{moment.text}</h2>
      {moment.details.length > 0 && <ul className="mt-4 space-y-1 text-sm text-white/65">{moment.details.map((detail,index) => <li key={index}>{detail}</li>)}</ul>}
    </div>}
  </>;
}
