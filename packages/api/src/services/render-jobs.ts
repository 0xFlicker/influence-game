import { and, eq, isNull, sql } from "drizzle-orm";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { decodeRenderInput, type RenderInput } from "@influence/engine/render-job";
import { stableProductionJson } from "@influence/engine/production-moments/export";
import {renderExecutionConfig,isLocalRenderExecution,studioRenderEnabled,renderWorkerDigest,type RenderExecution} from "@influence/engine/render-execution-config";
import { schema, type DrizzleDB } from "../db/index.js";
import { readJson, storeJson } from "./payload-storage.js";
import { renderDownload, renderUpload, verifyRenderObject,RenderObjectIntegrityError } from "./render-object-storage.js";
import { claimPostgameMedia } from "./postgame-media-worker.js";
import { postgameMediaPublicArtifactLocations, postgameMediaPublicStorageIdentity } from "./postgame-media-uploads.js";
type JobDB=Pick<DrizzleDB,"select"|"insert"|"update">;

export class RenderJobError extends Error {
  constructor(message:string,readonly status:400|404|409=409) {super(message);}
}
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const time=()=>new Date().toISOString();
const leaseEnd=()=>new Date(Date.now()+10*60_000).toISOString();
/** Local APIs share a domain-separated capability key without another dev secret. */
export function configureLocalRenderJobs(execution:RenderExecution) {
  if(!isLocalRenderExecution(execution))return;
  const secret=process.env.JWT_SECRET;
  if(!secret)throw new Error("JWT_SECRET is required for local render capabilities");
  process.env.RENDER_JOB_SECRET=createHmac("sha256",secret).update("house.local-render-capabilities.v1").digest("hex");
}
export function renderExecutionToken(id:string,executionId:string) {
  const secret=process.env.RENDER_JOB_SECRET;
  if(!secret || secret.length<32) throw new Error("RENDER_JOB_SECRET must contain at least 32 characters");
  return createHmac("sha256",secret).update(`render/v1/${id}/${executionId}`).digest("hex");
}
export const inputKey=(id:string,path:string)=>`renders/v1/${id}/inputs/${path}`;
export async function renderJob(db:DrizzleDB,id:string) {
  const [row]=await db.select().from(schema.renderJobs).where(eq(schema.renderJobs.id,id));
  if(!row) throw new RenderJobError("Render job not found",404);
  return row;
}
export function renderJobView(row:typeof schema.renderJobs.$inferSelect) {
  return {id:row.id,executionId:row.executionId,gameId:row.gameId,workload:row.workload,state:row.state,progress:row.progress,
    attempt:row.attempt,rendererDigest:row.rendererDigest,failure:row.failure,
    createdAt:row.createdAt,updatedAt:row.updatedAt,output:row.state==="succeeded" ? {sha256:row.outputHash,byteLength:row.outputBytes}:null};
}
export async function createRenderJob(db:JobDB,args:{gameId:string;userId:string|null;requestKey:string;input:unknown;rendererDigest:string}) {
  if(!/^[A-Za-z0-9._:-]{1,128}$/.test(args.requestKey) || !/^sha256:[a-f0-9]{64}$/.test(args.rendererDigest)) throw new RenderJobError("Invalid render request identity",400);
  const input=decodeRenderInput(args.input);
  if(input.workload==="trailer"&&input.gameId!==args.gameId)throw new RenderJobError("Trailer game identity mismatch",400);
  const requestHash=hash(stableProductionJson({gameId:args.gameId,input:"preparation" in input ? {requestHash:input.preparation.requestHash}:input,rendererDigest:args.rendererDigest}));
  const existing=await db.select().from(schema.renderJobs).where(and(args.userId===null?isNull(schema.renderJobs.requestedBy):eq(schema.renderJobs.requestedBy,args.userId),eq(schema.renderJobs.requestKey,args.requestKey)));
  if(existing[0]) {if(existing[0].requestHash!==requestHash) throw new RenderJobError("Idempotency key already used for a different render");return existing[0];}
  if(input.workload==="trailer") {
    const assigned=await db.select().from(schema.renderJobs).where(and(eq(schema.renderJobs.gameId,args.gameId),eq(schema.renderJobs.sourceRenderVersion,input.renderVersion)));
    if(assigned.length)throw new RenderJobError("This trailer version already has an execution");
  }
  const stored=await storeJson(input);
  const [row]=await db.insert(schema.renderJobs).values({gameId:args.gameId,requestedBy:args.userId,requestKey:args.requestKey,
    requestHash,workload:input.workload,sourceRenderVersion:input.workload==="trailer"?input.renderVersion:null,input:stored,rendererDigest:args.rendererDigest})
    .onConflictDoNothing({target:[schema.renderJobs.requestedBy,schema.renderJobs.requestKey]}).returning();
  if(row) return row;
  return createRenderJob(db,args);
}
export async function inputTargets(db:DrizzleDB,id:string) {
  const row=await renderJob(db,id);
  if(row.state!=="uploading_inputs") throw new RenderJobError("Inputs are already sealed");
  const input=await readJson(row.input);
  if(input.workload!=="studio-export") return [];
  return Promise.all(input.files.map(async file=>({...file,...await renderUpload(inputKey(id,file.path),file.byteLength,file.sha256)})));
}
export async function queueRenderJob(db:DrizzleDB,id:string) {
  const row=await renderJob(db,id);
  if(row.state!=="uploading_inputs") return renderJobView(row);
  const input=await readJson(row.input);
  if(input.workload==="studio-export") for(const file of input.files) await verifyRenderObject(inputKey(id,file.path),file);
  // This durable queued row is also the submission outbox. Adapter admission is
  // fenced by its execution identity; never mark a cloud submission delivered on timeout.
  await db.update(schema.renderJobs).set({state:"queued",updatedAt:time()}).where(and(eq(schema.renderJobs.id,id),eq(schema.renderJobs.state,"uploading_inputs")));
  return renderJobView(await renderJob(db,id));
}
export async function claimRenderJob(db:DrizzleDB,id:string,workerId:string,rendererDigest:string,executionId:string) {
  if(!/^[A-Za-z0-9._:-]{1,200}$/.test(workerId)) throw new RenderJobError("Invalid worker identity",400);
  const token=randomBytes(32).toString("hex");
  const [row]=await db.update(schema.renderJobs).set({state:"rendering",workerId,leaseHash:hash(token),leaseExpiresAt:leaseEnd(),
    attempt:sql`${schema.renderJobs.attempt}+1`,updatedAt:time()}).where(and(eq(schema.renderJobs.id,id),
    eq(schema.renderJobs.state,"queued"),eq(schema.renderJobs.executionId,executionId),eq(schema.renderJobs.rendererDigest,rendererDigest))).returning();
  if(!row) throw new RenderJobError("Execution is not claimable");
  const input:RenderInput=await readJson(row.input);
  const trailer=input.workload==="trailer" ? await claimPostgameMedia(db,workerId,new Date(),input) : null;
  if(input.workload==="trailer" && !trailer) {
    await failRenderJob(db,id,token);
    throw new RenderJobError("Assigned trailer version is unavailable");
  }
  const files=input.workload==="studio-export" ? await Promise.all(input.files.map(async f=>({...f,url:await renderDownload(inputKey(id,f.path))}))) : [];
  return {job:renderJobView(row),...("preparation" in input ? {inputDownload:{url:await renderDownload(row.input.key),sha256:row.input.storedSha256,byteLength:row.input.storedByteLength}}:{input}),files,leaseToken:token,leaseExpiresAt:row.leaseExpiresAt,
    trailer:trailer ? {...trailer,publicArtifacts:postgameMediaPublicArtifactLocations(trailer.gameId,trailer.artifactVersion),storage:postgameMediaPublicStorageIdentity()}:null};
}
function active(id:string,token:string) {
  return and(eq(schema.renderJobs.id,id),eq(schema.renderJobs.leaseHash,hash(token)),
    sql`${schema.renderJobs.state} IN ('rendering','uploading','verifying')`,sql`${schema.renderJobs.leaseExpiresAt} > ${time()}`);
}
export async function heartbeatRenderJob(db:DrizzleDB,id:string,token:string,progress:number) {
  if(!Number.isInteger(progress)||progress<0||progress>99) throw new RenderJobError("Invalid progress",400);
  const rows=await db.update(schema.renderJobs).set({leaseExpiresAt:leaseEnd(),progress:sql`greatest(${schema.renderJobs.progress},${progress})`,updatedAt:time()}).where(active(id,token)).returning({id:schema.renderJobs.id});
  if(!rows.length) throw new RenderJobError("Render lease lost");
}
export async function outputTarget(db:DrizzleDB,id:string,token:string,sha256:string,byteLength:number) {
  if(!/^[a-f0-9]{64}$/.test(sha256)||!Number.isSafeInteger(byteLength)||byteLength<=0) throw new RenderJobError("Invalid output declaration",400);
  const key=`renders/v1/${id}/attempts/${hash(token)}/video.mp4`;
  const [row]=await db.update(schema.renderJobs).set({state:"uploading",outputKey:key,outputHash:sha256,outputBytes:byteLength,updatedAt:time()})
    .where(and(active(id,token),eq(schema.renderJobs.workload,"studio-export"),sql`(${schema.renderJobs.outputKey} IS NULL OR (${schema.renderJobs.outputHash}=${sha256} AND ${schema.renderJobs.outputBytes}=${byteLength}))`)).returning();
  if(!row) throw new RenderJobError("Stale lease or different output declaration");
  return renderUpload(key,byteLength,sha256);
}
/** Persist finalization intent before acknowledging; large verification runs outside HTTP. */
export async function requestRenderFinalization(db:DrizzleDB,id:string,token:string,receipt:Record<string,unknown>) {
  const row=await renderJob(db,id);
  if(row.leaseHash!==hash(token))throw new RenderJobError("Render lease lost");
  if(["verifying","succeeded"].includes(row.state))return renderJobView(row);
  if(row.state!=="uploading"||receipt.schema!=="house.replay-export-receipt"||receipt.outputHash!==row.outputHash||receipt.bytes!==row.outputBytes)
    throw new RenderJobError("Receipt does not match output",400);
  const stored=await storeJson(receipt);
  const [pending]=await db.update(schema.renderJobs).set({state:"verifying",receipt:stored,updatedAt:time()}).where(active(id,token)).returning();
  if(!pending)throw new RenderJobError("Render lease lost");
  return renderJobView(pending);
}
export async function verifyPendingRenders(db:DrizzleDB) {
  const jobs=await db.select().from(schema.renderJobs).where(eq(schema.renderJobs.state,"verifying")).limit(2);
  for(const job of jobs) {
    if(!job.outputKey||!job.outputHash||!job.outputBytes||!job.receipt)continue;
    try {await verifyRenderObject(job.outputKey,{byteLength:job.outputBytes,sha256:job.outputHash});}
    catch(error) {
      if(error instanceof RenderObjectIntegrityError)await db.update(schema.renderJobs).set({state:"failed",failure:"output_integrity",leaseExpiresAt:null,updatedAt:time()})
        .where(and(eq(schema.renderJobs.id,job.id),eq(schema.renderJobs.state,"verifying")));
      continue; // transport failures retain durable verification intent
    }
    // Accepted finalization transfers ownership to the durable verifier. Worker
    // exit/lease expiry cannot discard uploaded output; cancel/retry still fence
    // completion through the current execution, state and lease identity.
    await db.update(schema.renderJobs).set({state:"succeeded",progress:100,leaseExpiresAt:null,updatedAt:time()})
      .where(and(eq(schema.renderJobs.id,job.id),eq(schema.renderJobs.state,"verifying"),eq(schema.renderJobs.executionId,job.executionId),eq(schema.renderJobs.leaseHash,job.leaseHash!)));
  }
}
export async function cancelRenderJob(db:DrizzleDB,id:string) {
  await db.transaction(async tx=> {
    const [row]=await tx.select().from(schema.renderJobs).where(eq(schema.renderJobs.id,id)).for("update");
    if(!row||["succeeded","failed","cancelled"].includes(row.state))return;
    if(row.workload==="trailer") {
      if(row.sourceRenderVersion===null)throw new RenderJobError("Trailer source identity is unavailable");
      const [media]=await tx.select().from(schema.gamePostgameMedia).where(eq(schema.gamePostgameMedia.gameId,row.gameId)).for("update");
      if(media?.renderVersion===row.sourceRenderVersion && media.status==="ready") {
        await tx.update(schema.renderJobs).set({state:"succeeded",progress:100,leaseExpiresAt:null,updatedAt:time()}).where(eq(schema.renderJobs.id,id));return;
      }
      if(media?.renderVersion===row.sourceRenderVersion)await tx.update(schema.gamePostgameMedia).set({status:"failed",failureCategory:"cancelled",failureMessage:"Render cancelled by producer",
        leaseTokenHash:null,leaseExpiresAt:null,workerIdHash:null,updatedAt:time()}).where(eq(schema.gamePostgameMedia.gameId,row.gameId));
    }
    await tx.update(schema.renderJobs).set({state:"cancelled",leaseExpiresAt:null,updatedAt:time()}).where(eq(schema.renderJobs.id,id));
  });
  return renderJobView(await renderJob(db,id));
}
export async function failRenderJob(db:DrizzleDB,id:string,token:string) {
  const rows=await db.update(schema.renderJobs).set({state:"failed",failure:"worker_failed",leaseExpiresAt:null,updatedAt:time()}).where(active(id,token)).returning();
  for(const row of rows)await failAssignedTrailer(db,row);
}
export async function failAssignedTrailer(db:DrizzleDB,row:typeof schema.renderJobs.$inferSelect) {
  if(row.workload!=="trailer"||row.sourceRenderVersion===null)return;
  await db.update(schema.gamePostgameMedia).set({status:"failed",failureCategory:"worker",failureMessage:"Assigned render execution ended before publication",
    leaseTokenHash:null,leaseExpiresAt:null,workerIdHash:null,updatedAt:time()})
    .where(and(eq(schema.gamePostgameMedia.gameId,row.gameId),eq(schema.gamePostgameMedia.renderVersion,row.sourceRenderVersion),
      sql`${schema.gamePostgameMedia.status} IN ('queued','claimed','rendering','composing','uploading')`));
}
export async function retryRenderJob(db:DrizzleDB,id:string,executionId:string,execution:RenderExecution=renderExecutionConfig()) {
  if(!/^[a-f0-9-]{36}$/.test(executionId))throw new RenderJobError("Retry requires the inspected execution ID",400);
  const row=await renderJob(db,id);
  if(row.workload!=="studio-export")throw new RenderJobError("Use the game-owned trailer rerender operation");
  if(row.executionId!==executionId)return renderJobView(row);
  if(!studioRenderEnabled(execution))throw new RenderJobError("Cloud exports are not selected for this environment");
  if(row.rendererDigest!==renderWorkerDigest(execution))throw new RenderJobError("Pinned renderer is unavailable; prepare a new export");
  const input=await readJson(row.input);
  if(input.workload==="studio-export")try {
    for(const file of input.files)await verifyRenderObject(inputKey(id,file.path),file);
  }catch {throw new RenderJobError("Frozen input files are unavailable; prepare a new render order");}
  const [retried]=await db.update(schema.renderJobs).set({state:"queued",executionId:crypto.randomUUID(),batchId:null,workerId:null,
    leaseHash:null,leaseExpiresAt:null,progress:0,failure:null,outputKey:null,outputHash:null,outputBytes:null,receipt:null,updatedAt:time()})
    .where(and(eq(schema.renderJobs.id,id),eq(schema.renderJobs.executionId,executionId),sql`${schema.renderJobs.state} IN ('failed','cancelled')`)).returning();
  if(!retried) {
    const current=await renderJob(db,id);if(current.executionId!==executionId)return renderJobView(current);
    throw new RenderJobError("Only failed or cancelled exports can be retried");
  }
  return renderJobView(retried);
}
