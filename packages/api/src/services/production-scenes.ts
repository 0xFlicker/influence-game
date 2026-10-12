import {readReplayVisualSceneCatalog,ReplayVisualError} from "./visual-replay-production.js";
import {readVisualSceneMedia,readVisualSceneSummaries} from "./visual-media-repair.js";
import {readVisualSceneAttempts} from "./visual-render-journal.js";
import type {DrizzleDB} from "../db/index.js";

type Inventory=Awaited<ReturnType<typeof readReplayVisualSceneCatalog>>;
type Scene=Inventory["scenes"][number];
type Summary=Awaited<ReturnType<typeof readVisualSceneSummaries>> extends Map<string,infer Value> ? Value : never;
export type ProductionSceneAudience="public"|"mystery"|"omniscient";

function permittedScenes(inventory:Inventory,audience?:ProductionSceneAudience) {
  const werewolf=inventory.gameKind==="werewolf",selected=audience ?? (werewolf ? "mystery" : "public");
  if (werewolf ? selected!=="mystery" && selected!=="omniscient" : selected!=="public")
    throw new ReplayVisualError("Invalid scene audience for this game","invalid_scene_audience",400);
  // Audience/purpose comes from the canonical descriptor, never image contents or dialogue prose.
  return inventory.scenes.filter(scene=>!werewolf || selected==="omniscient" || ("audience" in scene && scene.audience==="public" && "purpose" in scene && scene.purpose==="village"));
}

function pageBounds(options:{offset?:number;limit?:number}) {
  const offset=options.offset ?? 0,limit=options.limit ?? 25;
  if (!Number.isSafeInteger(offset) || offset<0 || !Number.isSafeInteger(limit) || limit<1 || limit>50)
    throw new ReplayVisualError("Scene page needs a nonnegative offset and a limit from 1 to 50","invalid_scene_page",400);
  return {offset,limit};
}

function sceneMetadata(scene:Scene,summary:Summary|undefined) {
  return {key:scene.key,previewHash:scene.previewHash,sceneId:scene.sceneId,roomId:scene.roomId,roomName:scene.roomName,round:scene.round,
    boundarySequence:scene.boundarySequence,afterDialogueSequence:scene.afterDialogueSequence,participants:scene.participants,
    available:"purpose" in scene ? Boolean(summary?.published) : scene.available || Boolean(summary?.published),originalFailed:scene.originalFailed,
    ...("purpose" in scene ? {purpose:scene.purpose,audience:scene.audience} : {}),latestVersion:summary?.latestVersion ?? null,
    publishedVersion:summary?.publishedVersion ?? null,activeJob:summary?.activeJob ?? null,attention:scene.originalFailed || Boolean(summary?.attention)};
}

/** Project full canonical staging first; fetch narrow media summaries only for this ≤50-scene page. */
export async function readProductionScenes(db:DrizzleDB,gameId:string,options:{offset?:number;limit?:number;audience?:ProductionSceneAudience}={}) {
  const {offset,limit}=pageBounds(options),inventory=await readReplayVisualSceneCatalog(db,gameId);
  const scenes=permittedScenes(inventory,options.audience),page=scenes.slice(offset,offset+limit);
  const ids=[...new Set(page.flatMap(scene=>scene.sceneId ? [scene.sceneId] : []))],summaries=await readVisualSceneSummaries(db,gameId,ids);
  return {gameId,items:page.map(scene=>sceneMetadata(scene,scene.sceneId ? summaries.get(scene.sceneId) : undefined)),total:scenes.length,
    nextOffset:offset+limit<scenes.length ? offset+limit : null};
}

/** Scene-scoped SQL evidence pages preserve exact versions and the complete bounded acknowledgement set. */
export async function readProductionScene(db:DrizzleDB,gameId:string,sceneKey:string,options:{versionId?:string;offset?:number;limit?:number;audience?:ProductionSceneAudience}={}) {
  const {offset,limit}=pageBounds(options);
  if (typeof sceneKey!=="string" || !sceneKey || sceneKey.length>200 || (options.versionId!==undefined && (typeof options.versionId!=="string" || !options.versionId || options.versionId.length>200)))
    throw new ReplayVisualError("Invalid scene or version","invalid_scene_detail",400);
  const inventory=await readReplayVisualSceneCatalog(db,gameId),scene=permittedScenes(inventory,options.audience).find(scene=>scene.key===sceneKey);
  if (!scene) throw new ReplayVisualError("Scene not found for this game","scene_missing",404);
  const sceneId=scene.sceneId;
  const [summaries,detail,accounting]=await Promise.all([
    readVisualSceneSummaries(db,gameId,sceneId ? [sceneId] : []),
    sceneId ? readVisualSceneMedia(db,gameId,sceneId,{offset,limit,versionId:options.versionId}) : {selectedVersion:null,media:{versions:[],jobs:[],publications:[],requests:[]},pages:{nextVersionOffset:null,nextJobOffset:null,nextPublicationOffset:null,nextRequestOffset:null}},
    sceneId ? readVisualSceneAttempts(db,gameId,sceneId,offset,limit) : {attempts:[],uncertainAttemptIds:[],nextOffset:null},
  ]);
  if (options.versionId && !detail.selectedVersion) throw new ReplayVisualError("Version not found for this scene","version_missing",404);
  const root=`/api/admin/production/games/${encodeURIComponent(gameId)}/visual`;
  return {scene:sceneMetadata(scene,sceneId ? summaries.get(sceneId) : undefined),media:detail.media,selectedVersion:detail.selectedVersion,
    attempts:accounting.attempts.map(attempt=>({...attempt,...(attempt.imageHash ? {imageEvidenceUrl:`${root}/evidence/attempt/${encodeURIComponent(attempt.id)}`} : {})})),
    uncertainAttemptIds:accounting.uncertainAttemptIds.slice(0,100),requiresReconciliation:accounting.uncertainAttemptIds.length>100,
    pages:{...detail.pages,nextAttemptOffset:accounting.nextOffset}};
}
