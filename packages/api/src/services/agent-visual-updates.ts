import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { readJson, storeJson } from "./payload-storage.js";
import { AgentProfileManagementError, type AgentProfileMutationRead } from "./agent-profile-management.js";
import { GenerationAdmissionError } from "./generation-admission-error.js";
import { VisualRenderRecoveryRequired } from "./visual-render-journal.js";
import { visualUpdateDependencies, visualUpdatePatch, VisualUpdateGenerationError, type VisualUpdateDependencies, type VisualUpdateSource } from "./agent-visual-update-generation.js";
const jobs = schema.agentVisualUpdates;
type Job = typeof jobs.$inferSelect;
type Stage = Job["stage"];
const ACTIVE = ["queued","processing"] as const;
const LEASE_MS = 120_000;
export function needsVisualUpdate(profile: Pick<VisualUpdateSource,"avatarUrl"|"fullBodyReferenceUrl"|"visualDesign"|"performanceInstructions">) {
  return !profile.avatarUrl || !profile.fullBodyReferenceUrl || !profile.visualDesign?.trim() || !profile.performanceInstructions?.trim();
}
async function owned(db: Pick<DrizzleDB, "select">, userId: string, agentId: string) {
  const [profile] = await db.select().from(schema.agentProfiles).where(and(eq(schema.agentProfiles.id,agentId),eq(schema.agentProfiles.userId,userId),isNull(schema.agentProfiles.archivedAt)));
  if (!profile) throw new AgentProfileManagementError("agent_not_found","Agent not found.",404);
  return profile;
}
export function visualUpdateRequestId(jobId: string, stage: Stage, attempt: number) {
  const bytes = createHash("sha256").update(`${jobId}:${stage}:${attempt}`).digest().subarray(0,16);
  bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
  const h = bytes.toString("hex"); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
const messages: Record<string,string> = {
  generation_paused:"Generation is paused for this account. Contact support for help.",
  generation_busy:"Another generation is still running or awaiting recovery. Try again later.",
  generation_exhausted:"Your current generation allowance is used up. Contact support for help.",
  generation_throttled:"Please wait before trying again. Saved work is retained.",
  request_conflict:"The saved generation input differs from this request. Existing work is retained and needs recovery.",
  profile_changed:"Your agent changed during preparation. Its newer changes were preserved. Update again to prepare the current version.",
  head_unclear:"The image is saved, but its head could not be located confidently. Retry detection; the saved full-body art will be reused.",
  recovery_required:"A provider result is not yet confirmed. Saved work is retained. Retry checks the existing request without duplicating it.",
  generation_unavailable:"Visual generation is unavailable. Saved work is retained; try again later.",
  review_rejected:"This update was not approved. Open the agent editor to revise it.",
  interrupted:"The update was interrupted. Saved work is retained; retry to continue.",
};
function view(job: Job | undefined, needsUpdate: boolean) {
  return { needsUpdate, job: job ? {id:job.id,status:job.status,stage:job.stage,updatedAt:job.updatedAt,errorCode:job.errorCode,message:job.errorCode ? messages[job.errorCode] ?? "The update could not finish. Saved work is retained; retry to continue." : null} : null };
}
export async function readAgentVisualUpdate(db: DrizzleDB, userId: string, agentId: string) {
  const profile = await owned(db,userId,agentId);
  let [job] = await db.select().from(jobs).where(and(eq(jobs.agentId,agentId),eq(jobs.userId,userId))).orderBy(desc(jobs.createdAt),desc(jobs.id)).limit(1);
  if (job?.stage === "saving") {
    const [submission] = await db.select().from(schema.agentContentSubmissions).where(and(eq(schema.agentContentSubmissions.id,job.id),eq(schema.agentContentSubmissions.userId,userId),eq(schema.agentContentSubmissions.agentProfileId,agentId)));
    if (submission) {
      const receipt = (submission.result as unknown as AgentProfileMutationRead).receipt;
      const status = profile.contentRevisionId===receipt.contentRevisionId || receipt.publication === "published" ? "completed" as const : "held" as const;
      const resultRevisionId = receipt.contentRevisionId ?? null;
      if (job.status !== status || job.resultRevisionId !== resultRevisionId) {
        // Finish the already-authorized save from its committed receipt; never resubmit it.
        await db.update(jobs).set({status,resultRevisionId,errorCode:null,leaseId:null,leaseUntil:null,updatedAt:new Date().toISOString()}).where(eq(jobs.id,job.id));
      }
      job = {...job,status,resultRevisionId,errorCode:null};
    }
  }
  // Interpret moderation outcome without mutating the job or generating on a read.
  if (job?.status === "held" && job.resultRevisionId) {
    if (profile.contentRevisionId === job.resultRevisionId) return view({...job,status:"completed",errorCode:null},needsVisualUpdate(profile));
    const [review] = await db.select().from(schema.agentModerationReviews).where(eq(schema.agentModerationReviews.contentRevisionId,job.resultRevisionId));
    if (review?.disposition === "rejected") return view({...job,status:"failed",errorCode:"review_rejected"},needsVisualUpdate(profile));
    if (profile.latestContentRevisionId !== job.resultRevisionId) return view({...job,status:"conflict",errorCode:"profile_changed"},needsVisualUpdate(profile));
  }
  return view(job,needsVisualUpdate(profile));
}

/** A known failed attempt can be retried; an uncertain dispatch keeps its exact identity. */
async function retryAttempt(db: Pick<DrizzleDB, "select">, job: Job) {
  if (job.errorCode === "head_unclear") return job.attempt + 1;
  const key = visualUpdateRequestId(job.id,job.stage,job.attempt);
  const [text] = await db.select().from(schema.accountTextOperations).where(and(eq(schema.accountTextOperations.userId,job.userId),eq(schema.accountTextOperations.requestKey,key)));
  if (text) return text.state === "failed" ? job.attempt + 1 : job.attempt;
  const operations = await db.select({id:schema.visualRenderOperations.id}).from(schema.visualRenderOperations).where(and(eq(schema.visualRenderOperations.userId,job.userId),or(eq(schema.visualRenderOperations.operationKey,`full-body:${key}`),sql`${schema.visualRenderOperations.operationKey} LIKE ${`portrait-head:%:${key}`}`)));
  for (const op of operations) {
    const attempts = await db.select({receipt:schema.visualRenderAttempts.receipt,image:schema.visualRenderAttempts.image,localization:schema.visualRenderAttempts.localization}).from(schema.visualRenderAttempts).where(eq(schema.visualRenderAttempts.operationId,op.id));
    if (attempts.length && attempts.every(a => a.receipt && !a.receipt.chargeUncertain && !a.image && !a.localization)) return job.attempt + 1;
  }
  return job.attempt;
}
export async function requestAgentVisualUpdate(db: DrizzleDB, userId: string, agentId: string) {
  await owned(db,userId,agentId);
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`agent-visual-update:${agentId}`}))`);
    const source = await owned(tx,userId,agentId);
    const [last] = await tx.select().from(jobs).where(and(eq(jobs.agentId,agentId),eq(jobs.userId,userId))).orderBy(desc(jobs.createdAt),desc(jobs.id)).limit(1);
    if (last && ACTIVE.includes(last.status as typeof ACTIVE[number])) return view(last,needsVisualUpdate(source));
    if (!needsVisualUpdate(source)) return view(last,false);
    if (source.moderationRequired) throw new AgentProfileManagementError("agent_profile_stale","An agent revision is awaiting review. Its submitted changes were preserved.",409);
    if (last?.status === "failed" && last.sourceUpdatedAt === source.updatedAt) {
      const [retried] = await tx.update(jobs).set({status:"queued",attempt:await retryAttempt(tx,last),leaseId:null,leaseUntil:null,errorCode:null,updatedAt:new Date().toISOString()}).where(eq(jobs.id,last.id)).returning();
      return view(retried,true);
    }
    const id = randomUUID();
    const [job] = await tx.insert(jobs).values({id,userId,agentId,sourceUpdatedAt:source.updatedAt,sourceContentId:source.latestContentRevisionId,input:await storeJson(source),checkpoint:await storeJson({}),status:"queued",stage:"details"}).returning();
    return view(job,true);
  });
}

/** Resume only a previously authorized job. Reads never create a generation job. */
export function resumeAgentVisualUpdate(db: DrizzleDB, userId: string, agentId: string, publicBaseUrl?: string) {
  void processAgentVisualUpdate(db,userId,agentId,visualUpdateDependencies,publicBaseUrl).catch(error => console.warn("[agent-visual-update] Resume deferred", {agentId,error:error instanceof Error ? error.name : "unknown"}));
}
export async function processAgentVisualUpdate(db: DrizzleDB, userId: string, agentId: string, deps: VisualUpdateDependencies = visualUpdateDependencies, publicBaseUrl?: string) {
  await owned(db,userId,agentId);
  const now = new Date().toISOString(), leaseId = randomUUID();
  const [job] = await db.update(jobs).set({status:"processing",leaseId,leaseUntil:new Date(Date.now()+LEASE_MS).toISOString(),updatedAt:now}).where(and(eq(jobs.agentId,agentId),eq(jobs.userId,userId),inArray(jobs.status,[...ACTIVE]),or(isNull(jobs.leaseUntil),lte(jobs.leaseUntil,now)))).returning();
  if (!job) return;
  const fence = and(eq(jobs.id,job.id),eq(jobs.leaseId,leaseId),eq(jobs.status,"processing"));
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    void db.update(jobs).set({leaseUntil:new Date(Date.now()+LEASE_MS).toISOString()}).where(fence).returning({id:jobs.id}).then(rows=>{if(!rows.length) leaseLost=true;}).catch(()=>{leaseLost=true;});
  },20_000);
  heartbeat.unref();
  let stage = job.stage;
  try {
    const source = await readJson<VisualUpdateSource>(job.input);
    let prepared = {...source,...await readJson<Partial<VisualUpdateSource>>(job.checkpoint)};
    const guard = async (saving = false) => {
      if (leaseLost) throw new Error("lease_lost");
      const [current] = await db.select().from(jobs).where(fence);
      if (!current || !current.leaseUntil || Date.parse(current.leaseUntil) <= Date.now()) throw new Error("lease_lost");
      const profile = await owned(db,userId,agentId);
      if (!saving && profile.updatedAt !== job.sourceUpdatedAt) throw new AgentProfileManagementError("agent_profile_stale","Profile changed",409);
    };
    const checkpoint = async (next: Stage) => {
      await guard();
      const stored = await storeJson(prepared); // Uploaded before the relational checkpoint advances.
      const rows = await db.update(jobs).set({checkpoint:stored,stage:next,updatedAt:new Date().toISOString()}).where(fence).returning({id:jobs.id});
      if (!rows.length) throw new Error("lease_lost");
      stage = next;
    };
    await guard(stage === "saving");
    if (stage === "details") {
      if (!prepared.visualDesign?.trim() || !prepared.performanceInstructions?.trim() || !prepared.strategyStyle?.trim() || !prepared.werewolfStrategyStyle?.trim()) {
        const details = await deps.details(db,prepared,visualUpdateRequestId(job.id,stage,job.attempt));
        prepared = {...prepared,
          visualDesign:prepared.visualDesign?.trim() ? prepared.visualDesign : details.visualDesign,
          performanceInstructions:prepared.performanceInstructions?.trim() ? prepared.performanceInstructions : details.performanceInstructions,
          strategyStyle:prepared.strategyStyle?.trim() ? prepared.strategyStyle : details.strategyStyle,
          werewolfStrategyStyle:prepared.werewolfStrategyStyle?.trim() ? prepared.werewolfStrategyStyle : details.werewolfStrategyStyle};
      }
      await checkpoint("body");
    }
    if (stage === "body") {
      if (!prepared.fullBodyReferenceUrl) {
        prepared.fullBodyReferenceUrl = await deps.body(db,prepared,visualUpdateRequestId(job.id,stage,job.attempt),publicBaseUrl);
        prepared.headPosition = null;
      }
      await checkpoint("head");
    }
    if (stage === "head") {
      if ((!source.fullBodyReferenceUrl || !prepared.avatarUrl) && !prepared.headPosition) prepared.headPosition = await deps.head(db,prepared,visualUpdateRequestId(job.id,stage,job.attempt));
      await checkpoint("portrait");
    }
    if (stage === "portrait") {
      if (!prepared.avatarUrl) prepared = {...prepared,...await deps.portrait(prepared,publicBaseUrl,db)};
      await checkpoint("saving");
    }
    await guard(true);
    const result = await deps.apply(db,{userId,publicBaseUrl},agentId,{...visualUpdatePatch(source,prepared),submissionId:job.id,expectedContentRevisionId:job.sourceContentId,...(source.currentRevisionId ? {expectedRevisionId:source.currentRevisionId} : {})});
    await db.update(jobs).set({status:result.receipt.publication !== "published" ? "held" : "completed",resultRevisionId:result.receipt.contentRevisionId ?? null,errorCode:null,leaseId:null,leaseUntil:null,updatedAt:new Date().toISOString()}).where(fence);
  } catch (error) {
    const conflict = error instanceof AgentProfileManagementError && error.code === "agent_profile_stale";
    const code = conflict ? "profile_changed" : error instanceof VisualRenderRecoveryRequired || error instanceof GenerationAdmissionError && error.code === "generation_recovery_required" ? "recovery_required" : error instanceof VisualUpdateGenerationError || error instanceof GenerationAdmissionError ? error.code : "interrupted";
    await db.update(jobs).set({status:conflict ? "conflict" : "failed",errorCode:code,leaseId:null,leaseUntil:null,updatedAt:new Date().toISOString()}).where(fence);
  } finally {clearInterval(heartbeat);}
}
