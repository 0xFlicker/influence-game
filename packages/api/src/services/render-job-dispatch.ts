import {and,asc,eq,sql} from "drizzle-orm";
import {renderExecutionConfig,type RenderExecution} from "@influence/engine/render-execution-config";
import {schema,type DrizzleDB} from "../db";
import {signedRenderWake} from "./postgame-media-execution";
import {createRenderJob,verifyPendingRenders,failAssignedTrailer} from "./render-jobs";

export async function reconcileBatchTrailers(db:DrizzleDB,execution:RenderExecution=renderExecutionConfig()) {
  if(execution.targets?.trailer!=="aws-batch")return;
  const digest=process.env.RENDER_JOB_WORKER_DIGEST;
  if(!digest)throw new Error("Batch renderer digest has not been admitted");
  await db.transaction(async tx=> {
    await tx.select().from(schema.postgameMediaRenderRelease).where(eq(schema.postgameMediaRenderRelease.id,1)).for("update");
    const [active]=await tx.select({count:sql<number>`count(*)::int`}).from(schema.gamePostgameMedia).where(sql`lease_expires_at > ${new Date().toISOString()}
      AND NOT EXISTS (SELECT 1 FROM render_jobs r WHERE r.workload='trailer' AND r.game_id=game_postgame_media.game_id AND r.source_render_version=game_postgame_media.render_version)`);
    if(!active)throw new Error("Trailer lease inventory unavailable");
    if(active.count>0)return;
    const rows=await tx.select().from(schema.gamePostgameMedia).where(eq(schema.gamePostgameMedia.status,"queued")).limit(10).for("update");
    for(const row of rows) {
      const assigned=await tx.select({id:schema.renderJobs.id,state:schema.renderJobs.state}).from(schema.renderJobs).where(and(eq(schema.renderJobs.gameId,row.gameId),eq(schema.renderJobs.sourceRenderVersion,row.renderVersion))).limit(1);
      if(assigned[0]) {
        if(assigned[0].state==="uploading_inputs")await tx.update(schema.renderJobs).set({state:"queued"}).where(eq(schema.renderJobs.id,assigned[0].id));
        continue;
      }
      const job=await createRenderJob(tx,{gameId:row.gameId,userId:null,requestKey:`trailer:${row.gameId}:${row.renderVersion}`,rendererDigest:digest,
        input:{version:1,workload:"trailer",gameId:row.gameId,renderVersion:row.renderVersion}});
      if(job.state==="uploading_inputs")await tx.update(schema.renderJobs).set({state:"queued"}).where(eq(schema.renderJobs.id,job.id));
    }
  });
}

/** Repeated delivery is safe because the AWS adapter journals by execution ID. */
export async function dispatchRenderJobs(db:DrizzleDB) {
  // Public publication is the trailer's completion authority, even if the
  // worker/bridge loses its response or a newer rerender has already started.
  await db.update(schema.renderJobs).set({state:"succeeded",failure:null,progress:100,leaseExpiresAt:null,updatedAt:new Date().toISOString()})
    .where(sql`${schema.renderJobs.workload}='trailer' AND ${schema.renderJobs.state} IN ('rendering','uploading','failed') AND EXISTS (
      SELECT 1 FROM game_postgame_media m WHERE m.game_id=${schema.renderJobs.gameId}
      AND m.current_ready_render_version=${schema.renderJobs.sourceRenderVersion}
      AND m.current_ready_artifact_metadata IS NOT NULL)`);
  const expired=await db.update(schema.renderJobs).set({state:"failed",failure:"worker_lease_expired",leaseExpiresAt:null,updatedAt:new Date().toISOString()})
    .where(sql`state IN ('rendering','uploading') AND lease_expires_at <= ${new Date().toISOString()}`).returning();
  for(const row of expired)await failAssignedTrailer(db,row);
  const interruptedFailures=await db.select({job:schema.renderJobs}).from(schema.renderJobs).innerJoin(schema.gamePostgameMedia,
    and(eq(schema.gamePostgameMedia.gameId,schema.renderJobs.gameId),eq(schema.gamePostgameMedia.renderVersion,schema.renderJobs.sourceRenderVersion)))
    .where(and(eq(schema.renderJobs.workload,"trailer"),eq(schema.renderJobs.state,"failed"),sql`${schema.gamePostgameMedia.status} IN ('queued','claimed','rendering','composing','uploading')`)).limit(25);
  for(const {job} of interruptedFailures)await failAssignedTrailer(db,job);
  await verifyPendingRenders(db);
  await reconcileBatchTrailers(db);
  const url=process.env.RENDER_JOB_DISPATCH_URL,secret=process.env.RENDER_JOB_DISPATCH_SECRET;
  if(!url && !secret)return;
  const environment=process.env.INFLUENCE_DEPLOYMENT_ENVIRONMENT;
  if(!url||!secret||!["staging","prod"].includes(environment??"")||new URL(url).protocol!=="https:")throw new Error("Incomplete Batch dispatch configuration");
  const jobs=await db.select().from(schema.renderJobs).where(eq(schema.renderJobs.state,"queued")).orderBy(asc(schema.renderJobs.updatedAt)).limit(10);
  for(const job of jobs) {
    const body=JSON.stringify({environment,jobId:job.id,executionId:job.executionId,workload:job.workload,rendererDigest:job.rendererDigest});
    const response=await fetch(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(15_000),headers:{"Content-Type":"application/json",...signedRenderWake(body,secret)},body});
    if(!response.ok) {
      await db.update(schema.renderJobs).set({failure:"submission_unresolved",updatedAt:new Date().toISOString()})
        .where(and(eq(schema.renderJobs.id,job.id),eq(schema.renderJobs.executionId,job.executionId),eq(schema.renderJobs.state,"queued")));
      continue; // unresolved intent remains queued for exact reconciliation
    }
    const receipt=await response.json() as {state?:string;batchId?:string;executionStatus?:string};
    if(receipt.state!=="submitted"||typeof receipt.batchId!=="string"||!/^[a-f0-9-]{36}$/.test(receipt.batchId))throw new Error("Invalid Batch submission receipt");
    const updated=await db.update(schema.renderJobs).set({batchId:receipt.batchId,updatedAt:new Date().toISOString(),
      ...(["FAILED","SUCCEEDED"].includes(receipt.executionStatus??"")?{state:"failed",failure:"worker_exited_before_claim"}:{})})
      .where(and(eq(schema.renderJobs.id,job.id),eq(schema.renderJobs.executionId,job.executionId),eq(schema.renderJobs.state,"queued"))).returning();
    for(const row of updated)if(row.state==="failed")await failAssignedTrailer(db,row);
  }
}
