import { Hono } from "hono";
import { and, asc, eq, ne, isNull } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { schema, type DrizzleDB } from "../db/index.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { getPermissionsForUser } from "../db/rbac.js";
import { renderDownload } from "../services/render-object-storage.js";
import {createPostgameMediaWorkerRoutes} from "./postgame-media-worker.js";
import {readJson} from "../services/payload-storage.js";
import {readProductionRenderMedia} from "../services/production-render-order.js";
import {renderExecutionConfig,isLocalRenderExecution,localRendererDigest,type RenderExecution} from "@influence/engine/render-execution-config";
import {isAuthorizedPostgameMediaWorker} from "../services/postgame-media-worker-auth.js";
import {parseJsonBody} from "../lib/parse-json-body.js";
import {parseRenderMonitorQuery,readRenderMonitor} from "../services/render-job-monitor.js";
import { cancelRenderJob, claimRenderJob, failRenderJob, heartbeatRenderJob,
  inputTargets, outputTarget, queueRenderJob, renderExecutionToken, renderJob, RenderJobError, renderJobView,retryRenderJob,requestRenderFinalization } from "../services/render-jobs.js";

export function createRenderJobRoutes(db:DrizzleDB,config:{execution?:RenderExecution}={}) {
  const app=new Hono<AuthEnv>();
  const trailers=createPostgameMediaWorkerRoutes(db);
  app.onError((error,c)=> {
    if(error instanceof RenderJobError) return c.json({error:error.message},error.status);
    console.error("[render-jobs] operation failed",error instanceof Error ? error.name : "unknown");
    return c.json({error:"Render operation failed"},500);
  });
  // Discovery does not reserve work: the shared execution claim remains the
  // atomic authority. A crash between discovery and claim leaves the job queued.
  app.post("/api/internal/local-renders/assignment",async c=> {
    const execution=config.execution??renderExecutionConfig(),host=new URL(c.req.url).hostname;
    c.header("Cache-Control","no-store");
    if(!isLocalRenderExecution(execution)||!["localhost","127.0.0.1","[::1]"].includes(host))return c.json({error:"Not found"},404);
    if(!isAuthorizedPostgameMediaWorker(c.req.header("Authorization")))return c.json({error:"Worker authentication required"},401);
    const body:unknown=await parseJsonBody(c,"local-render-assignment");
    if(!body||typeof body!=="object"||Object.keys(body).join()!=="rendererDigest"||!("rendererDigest" in body)||typeof body.rendererDigest!=="string")return c.json({error:"Invalid renderer identity"},400);
    if(body.rendererDigest!==localRendererDigest())return c.json({error:"Local renderer source identity differs"},409);
    await db.update(schema.renderJobs).set({state:"failed",failure:"renderer_unavailable",updatedAt:new Date().toISOString()}).where(and(
      eq(schema.renderJobs.workload,"studio-export"),eq(schema.renderJobs.state,"queued"),isNull(schema.renderJobs.batchId),ne(schema.renderJobs.rendererDigest,body.rendererDigest)));
    const [row]=await db.select().from(schema.renderJobs).where(and(eq(schema.renderJobs.workload,"studio-export"),eq(schema.renderJobs.state,"queued"),
      eq(schema.renderJobs.rendererDigest,body.rendererDigest),isNull(schema.renderJobs.batchId))).orderBy(asc(schema.renderJobs.createdAt),asc(schema.renderJobs.id)).limit(1);
    return c.json({assignment:row?{jobId:row.id,executionId:row.executionId,rendererDigest:row.rendererDigest,token:renderExecutionToken(row.id,row.executionId)}:null});
  });
  app.use("/api/admin/renders/*",requireAuth(db),async(c,next)=> {
    c.header("Cache-Control","private, no-store");
    const {roles}=await getPermissionsForUser(db,c.get("user").id);
    if(!roles.some(r=>r==="producer"||r==="sysop")) return c.json({error:"Producer or Sysop role required"},403);
    await next();
  });
  app.get("/api/admin/renders/jobs",async c=> {
    return c.json(await readRenderMonitor(db,parseRenderMonitorQuery(c.req.query())));
  });
  app.get("/api/admin/renders/:id",async c=>c.json(renderJobView(await renderJob(db,c.req.param("id")))));
  app.post("/api/admin/renders/:id/input-targets",async c=>c.json({files:await inputTargets(db,c.req.param("id"))}));
  app.post("/api/admin/renders/:id/queue",async c=>c.json(await queueRenderJob(db,c.req.param("id"))));
  app.post("/api/admin/renders/:id/cancel",async c=>c.json(await cancelRenderJob(db,c.req.param("id"))));
  app.post("/api/admin/renders/:id/retry",async c=>{const body=await c.req.json();return c.json(await retryRenderJob(db,c.req.param("id"),String(body.executionId),config.execution));});
  app.post("/api/admin/renders/:id/download",async c=> {
    const row=await renderJob(db,c.req.param("id"));
    if(row.state!=="succeeded"||!row.outputKey) throw new RenderJobError("Render output is not ready");
    return c.json({url:await renderDownload(row.outputKey),expiresAt:new Date(Date.now()+900_000).toISOString(),sha256:row.outputHash,byteLength:row.outputBytes});
  });
  app.use("/api/internal/renders/:id/*",async(c,next)=> {
    const row=await renderJob(db,c.req.param("id")!);
    const provided=c.req.header("Authorization")?.replace(/^Bearer /,"") ?? "";
    const expected=renderExecutionToken(row.id,row.executionId);
    if(provided.length!==expected.length||!timingSafeEqual(Buffer.from(provided),Buffer.from(expected))) return c.json({error:"Execution authentication required"},401);
    c.header("Cache-Control","no-store");
    await next();
  });
  app.post("/api/internal/renders/:id/claim",async c=> {
    const body=await c.req.json();
    return c.json(await claimRenderJob(db,c.req.param("id"),String(body.workerId),String(body.rendererDigest),String(body.executionId)));
  });
  app.get("/api/internal/renders/:id/media",async c=> {
    const row=await renderJob(db,c.req.param("id")),input=await readJson(row.input);
    if(!("preparation" in input)||row.state!=="rendering"||!row.leaseExpiresAt||row.leaseExpiresAt<=new Date().toISOString())throw new RenderJobError("Render media lease is not active");
    const media=await readProductionRenderMedia(db,input.preparation.descriptor,input.preparation.source,input.preparation.audio,c.req.query("path")??"");
    c.header("Content-Type",media.contentType);return c.body(media.bytes);
  });
  app.post("/api/internal/renders/:id/heartbeat",async c=> {
    const b=await c.req.json();await heartbeatRenderJob(db,c.req.param("id"),String(b.leaseToken),b.progress);return c.json({ok:true});
  });
  app.post("/api/internal/renders/:id/output",async c=> {
    const b=await c.req.json();return c.json(await outputTarget(db,c.req.param("id"),String(b.leaseToken),String(b.sha256),b.byteLength));
  });
  app.post("/api/internal/renders/:id/finalize",async c=> {
    const b=await c.req.json();
    if(!b.receipt||typeof b.receipt!=="object"||Array.isArray(b.receipt))throw new RenderJobError("Encoded output receipt required",400);
    return c.json(await requestRenderFinalization(db,c.req.param("id"),String(b.leaseToken),b.receipt),202);
  });
  app.post("/api/internal/renders/:id/status",async c=>c.json(renderJobView(await renderJob(db,c.req.param("id")))));
  app.post("/api/internal/renders/:id/failure",async c=> {
    const b=await c.req.json();await failRenderJob(db,c.req.param("id"),String(b.leaseToken));return c.json({ok:true});
  });
  app.post("/api/internal/renders/:id/trailer/:operation",async c=> {
    const row=await renderJob(db,c.req.param("id")),input=await readJson(row.input),operation=c.req.param("operation");
    if(input.workload!=="trailer"||!["rendering","uploading"].includes(row.state)||!row.leaseExpiresAt||row.leaseExpiresAt<new Date().toISOString()
      || !["heartbeat","progress","upload-targets","finalize","failure"].includes(operation)) throw new RenderJobError("Trailer execution is not active");
    const response=await trailers.request(new URL(`/api/internal/postgame-media/${encodeURIComponent(input.gameId)}/${operation}`,c.req.url),{
      method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${process.env.POSTGAME_MEDIA_WORKER_TOKEN}`},body:await c.req.text()});
    if(response.ok && operation==="finalize") await db.update(schema.renderJobs).set({state:"succeeded",progress:100,leaseExpiresAt:null,updatedAt:new Date().toISOString()})
      .where(and(eq(schema.renderJobs.id,row.id),eq(schema.renderJobs.state,"rendering")));
    return new Response(response.body,{status:response.status,headers:response.headers});
  });
  return app;
}
