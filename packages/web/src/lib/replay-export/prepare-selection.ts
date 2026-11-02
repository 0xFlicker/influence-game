import {join} from "node:path";
import {writeFile} from "node:fs/promises";
import type {RenderInput} from "@influence/engine/render-job";
import {loadProductionReplaySource,type ProductionSnapshot} from "./production-source";
import {bindInfluenceProductionPresentation,bindWerewolfProductionPresentation} from "./production-presentation";
import {resolveProductionMomentIds} from "@influence/engine/production-moments";
import {ReplayAssets,sha256,snapshotStageArt} from "./assets";
import {attachGeneratedAudio,recordingIdentity} from "./generated-audio";
import {compilePresentation,type PresentationMoment} from "./presentation";
import {rendererProvenance} from "./provenance";
import {validateManifest,type ReplayManifest} from "./manifest";

/** The assigned worker uses the same source binder, audio validation and compiler as local export. */
export async function prepareSelectedReplay(input:Extract<RenderInput,{preparation:unknown}>["preparation"],directory:string,webRoot:string,api:URL,signal:AbortSignal,fetcher:typeof fetch) {
  const {descriptor}=input,thinking=typeof descriptor.sourceSnapshot.thinking==="boolean"?descriptor.sourceSnapshot.thinking:descriptor.selection.thinking;
  const loaded=await loadProductionReplaySource(async<T>()=>input.source as T,{gameId:descriptor.gameId,gameKind:descriptor.gameKind,
    audience:descriptor.audience,thinking,snapshot:descriptor.sourceSnapshot as ProductionSnapshot});
  if(loaded.status!=="completed")throw new Error("Frozen render requires a completed source");
  const source=loaded.source;
  if(source.kind==="werewolf"&&descriptor.copy.title!==undefined)source.title=descriptor.copy.title;
  const moments=source.kind==="werewolf"?await bindWerewolfProductionPresentation({source,catalog:loaded.catalog,provenance:loaded.provenance,thoughts:loaded.thoughts})
    :await bindInfluenceProductionPresentation({source,catalog:loaded.catalog,thoughts:loaded.acceptedThoughts});
  const selectedIds=resolveProductionMomentIds(loaded.catalog,descriptor.momentIds).map(m=>m.id);
  if(selectedIds.some((id,index)=>id!==descriptor.momentIds[index]))throw new Error("Frozen selection order changed");
  const selected=new Set(selectedIds),assets=new ReplayAssets(directory,join(webRoot,"public"),api,signal,undefined,fetcher);
  let selectedMoments=moments.filter(m=>selected.has(m.id));
  const attached=await attachGeneratedAudio({source:selectedMoments,selectedIds,publication:input.audio,hash:sha256,frozen:descriptor.recordings,signal,
    asset:async clip=>{const key=await assets.cache(clip.url);return assets.table[key]!;}});
  selectedMoments=attached.source;
  for(const recording of descriptor.recordings.filter(r=>!r.versionId)) {
    const moment=selectedMoments.find(m=>m.id===recording.momentId),candidates=moment?.segments.filter(c=>recordingIdentity(c))??[];
    const cue=candidates[0],identity=cue&&recordingIdentity(cue);
    if(!moment||candidates.length!==1||!identity||identity.speakerId!==recording.speakerId||identity.messageId!==recording.messageId||sha256(identity.text)!==recording.textHash)throw new Error("Imported recording identity changed");
    const key=await assets.cache(join(directory,`assets/${recording.sha256}`),true),asset=assets.table[key]!;
    if(asset.sha256!==recording.sha256||asset.mediaType!=="audio"||!asset.durationMs||Math.abs(asset.durationMs-recording.durationMs)>50)throw new Error("Imported recording failed integrity validation");
    moment.segments=moment.segments.map(c=>c===cue?{...c,timing:{...c.timing,recording:{assetId:key,durationMs:recording.durationMs}},...(recording.alignment?{alignment:recording.alignment}:{})}:c);
  }
  const {width,height,fps,profile,music,volume,reducedMotion}=descriptor.settings;
  const frozen:PresentationMoment[]=[];
  for(const moment of selectedMoments) {
    const segments=[];for(const cue of moment.segments)segments.push(await assets.freeze({...cue,music:music?cue.music:null}));
    frozen.push({...moment,segments});
  }
  const byId=new Map(frozen.map(m=>[m.id,m]));
  const compiled=compilePresentation({source:moments.map(m=>byId.get(m.id)??{id:m.id,segments:[]}),selectedIds,profile,fps,assets:assets.table,music,volume});
  const game=source.kind==="werewolf"?{id:source.windows[0]!.gameId,slug:source.windows[0]!.slug,kind:source.kind,audience:source.windows[0]!.audience}
    :{id:source.game.id,slug:source.game.slug,kind:source.kind};
  const manifest:ReplayManifest={schema:"house.replay-export",version:2,game,width,height,fps,reducedMotion,profile,
    thinking:compiled.cues.some(c=>c.picture.kind==="thinking"),cues:compiled.cues,timeline:compiled.timeline,audio:compiled.audio,assets:assets.table,
    staticFiles:await snapshotStageArt(join(webRoot,"public"),directory),boundary:{sourceHash:loaded.snapshot.sourceHash,selectionHash:descriptor.hash,
      eventSequence:loaded.snapshot.throughEventSequence,...(loaded.snapshot.throughCursor!==undefined?{cursor:loaded.snapshot.throughCursor}:{})},
    range:{fromFrame:0,untilFrame:Math.ceil(compiled.audio.durationMs*fps/1000)},...await rendererProvenance(join(webRoot,"../.."))};
  validateManifest(manifest);signal.throwIfAborted();await writeFile(join(directory,"manifest.json"),JSON.stringify(manifest));return manifest;
}
