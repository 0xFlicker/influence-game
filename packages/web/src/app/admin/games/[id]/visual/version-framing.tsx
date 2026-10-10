"use client";
/* eslint-disable @next/next/no-img-element -- Exact immutable comparison references. */
import {useEffect,useState} from "react";
import {selectVisualShot,type AcceptedVisualScene,type StoredVisualShot} from "@influence/engine/visual-mode";
import {VisualSceneView} from "../../../../games/[slug]/components/visual-scene-view";
import {useAdminSession} from "../../../admin-session";
import type {MediaVersion} from "./scene-repair-panel";

/** A silent comparison still. It never changes the playable head or resolves another version. */
export function VersionFraming({gameId,version,apiPrefix}:{gameId:string;version:MediaVersion;apiPrefix:string}) {
  const session=useAdminSession(),[playerId,setPlayerId]=useState("");
  const cast=version.plan?.cast ?? [];
  const shots=version.shots;
  const artifactKey=JSON.stringify([...new Set([
    ...(shots ? [...shots.groups,...(shots.overview ? [shots.overview] : [])].map(shot=>shot.imageArtifactId) : [version.imageArtifactId]),
    ...cast.map(member=>member.referenceArtifactId),
  ].filter(Boolean))]);
  const [images,setImages]=useState<{key:string;urls:Record<string,string>}|null>(null),[error,setError]=useState<string|null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    const ids=JSON.parse(artifactKey) as string[];
    Promise.all(ids.map(async id=>{
      const result=await session.read<{imageUrl:string}>(`${apiPrefix}/${gameId}/visual/evidence/artifact/${encodeURIComponent(id)}`,controller.signal);
      if(!result.imageUrl) throw new Error("Frozen comparison image is unavailable");
      return [id,result.imageUrl] as const;
    })).then(entries=>{if(!controller.signal.aborted){setImages({key:artifactKey,urls:Object.fromEntries(entries)});setError(null);}})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error ? cause.message : "Version framing unavailable");});
    return ()=>controller.abort();
  },[session,apiPrefix,gameId,artifactKey]);
  const player=cast.find(member=>member.id===playerId) ?? cast[0];
  if(!player) return <p>No immutable cast references are available for this version.</p>;
  if(!version.plan?.roomId) return <p>No immutable room context is available for this version.</p>;
  if(error) return <p role="alert">{error}</p>;
  if(!images || images.key!==artifactKey) return <p role="status">Loading exact version framing…</p>;
  const convert=(shot:StoredVisualShot)=>({...shot,imageUrl:images.urls[shot.imageArtifactId]!,annotatedImageUrl:""});
  const scene:AcceptedVisualScene={id:version.sceneId,roomId:version.plan.roomId,version:version.version,
    imageUrl:images.urls[version.imageArtifactId] ?? "",annotatedImageUrl:"",participantIds:cast.map(member=>member.id),anchors:version.localization.anchors,
    ...(shots ? {shots:{mode:shots.mode,groups:shots.groups.map(convert),overview:shots.overview ? convert(shots.overview) : null}} : {})};
  const shot=scene.shots ? selectVisualShot(scene.shots,player.id) : null;
  const covered=shot ? shot.visibleParticipantIds.includes(player.id) : scene.anchors.some(anchor=>anchor.playerId===player.id && anchor.confidence==="clear");
  const picture=shot?.imageUrl ?? scene.imageUrl;
  const fallback=images.urls[player.referenceArtifactId];
  return <section aria-label={`Character framing v${version.version}`} className="space-y-2">
    <label>Frame character <select aria-label="Frame character" value={player.id} onChange={event=>setPlayerId(event.target.value)} className="rounded bg-neutral-900 p-2">{cast.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
    <div className="relative flex aspect-video overflow-hidden rounded bg-neutral-900" aria-label="Exact version framing still" data-framing-version={version.id}>
      {covered && picture ? <VisualSceneView key={`${version.id}:${player.id}`} scene={scene} speech={null} focusPlayerId={player.id} focusActor={{id:player.id,name:player.name,persona:""}} elapsedMs={650} paused reducedMotion />
        : fallback ? <div className="flex w-full flex-col items-center justify-center p-4"><img src={fallback} alt={`${player.name} frozen reference`} className="min-h-0 flex-1 object-contain" /><p className="text-sm">{player.name} · Frozen reference fallback</p></div>
        : <p className="m-auto">No verified panel or immutable reference for {player.name}.</p>}
    </div>
    <p className="text-xs text-white/50">Silent still from candidate v{version.version}. Published preview and playhead remain pinned.</p>
  </section>;
}
