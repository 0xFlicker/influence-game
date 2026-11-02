import {createHash} from "node:crypto";
import {and,eq} from "drizzle-orm";
import {renderExecutionConfig,studioRenderEnabled,renderWorkerDigest,type RenderExecution} from "@influence/engine/render-execution-config";
import {decodeRenderInput,type RenderFile} from "@influence/engine/render-job";
import {decodeProductionExport,stableProductionJson,type ProductionExportDescriptor} from "@influence/engine/production-moments/export";
import {schema,type DrizzleDB} from "../db/index.js";
import {getPermissionsForUser} from "../db/rbac.js";
import {readJson,loadPayloads} from "./payload-storage.js";
import {validateProductionSelection} from "./production-export-selection.js";
import {readAudioPublication,readPublishedAudioBytes} from "./audio-publication.js";
import {decodeWerewolfProductionSnapshot,readWerewolfProductionMedia,readWerewolfProductionCharacter} from "./werewolf-production-source.js";
import {createRenderJob,queueRenderJob,renderJobView,RenderJobError} from "./render-jobs.js";

export const renderOrderHash=(value:unknown)=>createHash("sha256").update(stableProductionJson(value)).digest("hex");
export async function findProductionRenderOrder(db:DrizzleDB,userId:string,requestKey:string,requestHash:string) {
  const [row]=await db.select().from(schema.renderJobs).where(and(eq(schema.renderJobs.requestedBy,userId),eq(schema.renderJobs.requestKey,requestKey)));
  if(!row)return null;
  const input=await readJson(row.input);
  if(!("preparation" in input)||input.preparation.requestHash!==requestHash)throw new RenderJobError("Idempotency key already used for a different render");
  return row;
}
/** Freeze all source metadata into the existing private input document before accepting work. */
export async function orderProductionRender(db:DrizzleDB,userId:string,gameId:string,args:{descriptor:unknown;requestKey:string;files?:RenderFile[]},
  options:{execution?:RenderExecution;requestHash?:string}={}) {
  if(!(await getPermissionsForUser(db,userId)).roles.some(r=>r==="producer"||r==="sysop"))throw new RenderJobError("Current producer access required",404);
  if(decodeProductionExport(args.descriptor).gameId!==gameId)throw new RenderJobError("Selection belongs to another game",400);
  const requestHash=options.requestHash ?? renderOrderHash(args);
  const existing=await findProductionRenderOrder(db,userId,args.requestKey,requestHash);
  if(existing) {
    const input=await readJson(existing.input);
    return existing.state==="uploading_inputs"&&input.workload==="studio-export"&&!input.files.length?queueRenderJob(db,existing.id):renderJobView(existing);
  }
  const execution=options.execution ?? renderExecutionConfig();
  if(!studioRenderEnabled(execution))throw new RenderJobError("Cloud exports are not selected for this environment");
  const digest=renderWorkerDigest(execution);
  if(!digest)throw new RenderJobError("Render worker image has not been admitted");
  const {descriptor,source}=await validateProductionSelection(db,gameId,args.descriptor);
  if(!descriptor.momentIds.length)throw new RenderJobError("Selected cut is empty",400);
  const files=args.files ?? [],imports=descriptor.recordings.filter(r=>!r.versionId);
  const hashes=new Set(imports.map(r=>r.sha256));
  if(files.length!==hashes.size||files.some(f=>f.path!==`assets/${f.sha256}`||!hashes.has(f.sha256)))throw new RenderJobError("Upload files must match the selected imported recordings",400);
  const thinking=typeof descriptor.sourceSnapshot.thinking==="boolean" ? descriptor.sourceSnapshot.thinking:descriptor.selection.thinking;
  const audio=await readAudioPublication(db,gameId,descriptor.audience,thinking,true,descriptor.recordings.flatMap(r=>r.versionId?[r.versionId]:[]));
  // An internal complete page uses the same loader/compiler as the paged CLI.
  const page=source.snapshot.gameKind==="werewolf"&&"window" in source ? {...source,permittedMedia:undefined,annotations:[],nextCursor:null} : {...source,annotations:[],
    nextSequence:null,nextMessageOffset:null,nextCatalogOffset:null,nextThoughtOffset:null,nextVisualOffset:null};
  const input=decodeRenderInput({version:1,workload:"studio-export",selectionHash:descriptor.hash,files,
    preparation:{descriptor,source:page,audio,requestHash}});
  const job=await createRenderJob(db,{gameId,userId,requestKey:args.requestKey,rendererDigest:digest,input});
  return files.length ? renderJobView(job):queueRenderJob(db,job.id);
}

/** Collect structured media references using the renderer's typed URL traversal. */
function mediaPaths(value:unknown,key="",parent="",found=new Set<string>()):Set<string> {
  if(typeof value==="string"&&(/url$|^src$/i.test(key)||/wolfForms|portraits|fullBodies|fullBodyReferences/.test(parent))&&value.startsWith("/api/"))found.add(value);
  else if(Array.isArray(value))value.forEach(v=>mediaPaths(v,key,parent,found));
  else if(value&&typeof value==="object")Object.entries(value).forEach(([k,v])=>mediaPaths(v,k,key,found));
  return found;
}
/** A job capability can read only exact media references retained in its frozen input. */
export async function readProductionRenderMedia(db:DrizzleDB,descriptor:ProductionExportDescriptor,source:unknown,audio:unknown,path:string) {
  const allowed=mediaPaths(source);mediaPaths(audio,"","",allowed);
  if(!allowed.has(path))throw new RenderJobError("Media is outside this frozen render",404);
  const url=new URL(path,"http://render.invalid"),root=`/api/admin/production/games/${encodeURIComponent(descriptor.gameId)}`;
  if(!url.pathname.startsWith(`${root}/`))throw new RenderJobError("Media is outside this game",404);
  const relative=url.pathname.slice(root.length),id=decodeURIComponent(relative.split("/").at(-1)!);
  if(relative.startsWith("/visual/artifacts/")) {
    const [row]=await loadPayloads(db.select({image:schema.visualArtifacts.image}).from(schema.visualArtifacts)
      .where(and(eq(schema.visualArtifacts.gameId,descriptor.gameId),eq(schema.visualArtifacts.id,id))));
    if(row)return {bytes:new Uint8Array(row.image),contentType:"image/png"};
  } else if(relative.startsWith("/source/media/"))return readWerewolfProductionMedia(db,descriptor.gameId,id,{snapshot:decodeWerewolfProductionSnapshot(descriptor.sourceSnapshot)});
  else if(relative.startsWith("/source/characters/"))return readWerewolfProductionCharacter(db,descriptor.gameId,id,{snapshot:decodeWerewolfProductionSnapshot(descriptor.sourceSnapshot),image:url.searchParams.get("image")==="body"?"body":"portrait"});
  else if(relative.startsWith("/audio/")) {
    const thinking=typeof descriptor.sourceSnapshot.thinking==="boolean"?descriptor.sourceSnapshot.thinking:descriptor.selection.thinking;
    const bytes=await readPublishedAudioBytes(db,descriptor.gameId,id,descriptor.audience,thinking,true);
    if(bytes)return {bytes:new Uint8Array(bytes),contentType:"audio/mpeg"};
  }
  throw new RenderJobError("Frozen media is unavailable",404);
}
