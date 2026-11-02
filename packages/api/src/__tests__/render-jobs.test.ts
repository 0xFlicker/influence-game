import {afterEach,beforeEach,expect,test} from "bun:test";
import {eq} from "drizzle-orm";
import {schema,type DrizzleDB} from "../db/index.js";
import {setupTestDB} from "./test-utils.js";
import {createRenderJob,queueRenderJob,claimRenderJob,heartbeatRenderJob,cancelRenderJob,requestRenderFinalization,verifyPendingRenders,outputTarget,renderJob,retryRenderJob} from "../services/render-jobs.js";
import {setRenderObjectStorageForTests} from "../services/render-object-storage.js";
import {readProductionRender} from "../game-mcp/render-contracts";
import {grantTestAuthority} from "./rbac-fixtures";
import {dispatchRenderJobs,reconcileBatchTrailers} from "../services/render-job-dispatch";
import {startRenderWakeDispatcher} from "../services/postgame-media-execution";

let db:DrizzleDB,verified:string[],corrupt=false;
beforeEach(async()=> {
  db=await setupTestDB();verified=[];corrupt=false;
  await db.insert(schema.users).values({id:"render-producer"});
  await db.insert(schema.games).values({id:"render-game",slug:"render-game",status:"completed",config:"{}"});
  setRenderObjectStorageForTests({upload:async key=>({url:`https://storage.invalid/${key}`,headers:{}}),download:async key=>`https://storage.invalid/${key}`,
    verify:async key=>{verified.push(key);if(corrupt)throw new Error("checksum mismatch");}});
});
afterEach(()=>setRenderObjectStorageForTests(undefined));
const digest=`sha256:${"a".repeat(64)}`;
const receipt={schema:"house.replay-export-receipt",outputHash:"e".repeat(64),bytes:100};
async function create(key="one") {
  return createRenderJob(db,{gameId:"render-game",userId:"render-producer",requestKey:key,rendererDigest:digest,
    input:{version:1,workload:"studio-export",selectionHash:`sha256:${"b".repeat(64)}`,files:[{path:"manifest.json",byteLength:10,sha256:"c".repeat(64)}]}});
}
test("exact order replay returns one identity; conflicting key is rejected",async()=> {
  const [a,b]=await Promise.all([create(),create()]);expect(a.id).toBe(b.id);
  await expect(createRenderJob(db,{gameId:"render-game",userId:"render-producer",requestKey:"one",rendererDigest:`sha256:${"d".repeat(64)}`,
    input:{version:1,workload:"studio-export",selectionHash:`sha256:${"b".repeat(64)}`,files:[{path:"manifest.json",byteLength:10,sha256:"c".repeat(64)}]}})).rejects.toThrow("Idempotency");
});
test("corrupt inputs cannot queue, duplicate workers cannot both claim",async()=> {
  const a=await create();corrupt=true;
  await expect(queueRenderJob(db,a.id)).rejects.toThrow("checksum");expect((await renderJob(db,a.id)).state).toBe("uploading_inputs");
  corrupt=false;await queueRenderJob(db,a.id);
  const claims=await Promise.allSettled([claimRenderJob(db,a.id,"worker-one",digest,a.executionId),claimRenderJob(db,a.id,"worker-two",digest,a.executionId)]);
  expect(claims.filter(r=>r.status==="fulfilled")).toHaveLength(1);
});
test("cancellation fences heartbeat, upload and finalize",async()=> {
  const a=await create();await queueRenderJob(db,a.id);
  const claim=await claimRenderJob(db,a.id,"worker",digest,a.executionId);
  await outputTarget(db,a.id,claim.leaseToken,"e".repeat(64),100);
  await cancelRenderJob(db,a.id);
  await expect(heartbeatRenderJob(db,a.id,claim.leaseToken,20)).rejects.toThrow("lease lost");
  await expect(requestRenderFinalization(db,a.id,claim.leaseToken,receipt)).rejects.toThrow();
  expect((await renderJob(db,a.id)).state).toBe("cancelled");
});
test("only verified output finalizes; replay is idempotent; expired lease cannot finalize",async()=> {
  const a=await create();await queueRenderJob(db,a.id);const claim=await claimRenderJob(db,a.id,"worker",digest,a.executionId);
  await outputTarget(db,a.id,claim.leaseToken,"e".repeat(64),100);corrupt=true;
  expect((await requestRenderFinalization(db,a.id,claim.leaseToken,receipt)).state).toBe("verifying");
  await verifyPendingRenders(db);expect((await renderJob(db,a.id)).state).toBe("verifying");
  corrupt=false;await verifyPendingRenders(db);const result=await requestRenderFinalization(db,a.id,claim.leaseToken,receipt);expect(result.state).toBe("succeeded");
  expect(await requestRenderFinalization(db,a.id,claim.leaseToken,receipt)).toEqual(result);expect((await cancelRenderJob(db,a.id)).state).toBe("succeeded");
  const b=await create("two");await queueRenderJob(db,b.id);const other=await claimRenderJob(db,b.id,"worker",digest,b.executionId);
  await outputTarget(db,b.id,other.leaseToken,"e".repeat(64),100);
  await db.update(schema.renderJobs).set({leaseExpiresAt:new Date(0).toISOString()}).where(eq(schema.renderJobs.id,b.id));
  await expect(requestRenderFinalization(db,b.id,other.leaseToken,receipt)).rejects.toThrow("lease lost");
});
test("wrong image or retired execution cannot claim",async()=> {
  const a=await create();await queueRenderJob(db,a.id);
  await expect(claimRenderJob(db,a.id,"worker",`sha256:${"f".repeat(64)}`,a.executionId)).rejects.toThrow("not claimable");
  await expect(claimRenderJob(db,a.id,"worker",digest,crypto.randomUUID())).rejects.toThrow("not claimable");
});
test("local background reconciliation completes accepted output after worker lease expiry",async()=> {
  const job=await create();await queueRenderJob(db,job.id);
  const claim=await claimRenderJob(db,job.id,"local-worker",digest,job.executionId);
  await outputTarget(db,job.id,claim.leaseToken,"e".repeat(64),100);
  await requestRenderFinalization(db,job.id,claim.leaseToken,receipt);
  await db.update(schema.renderJobs).set({leaseExpiresAt:new Date(0).toISOString()}).where(eq(schema.renderJobs.id,job.id));
  const keys=["INFLUENCE_DEPLOYMENT_ENVIRONMENT","NODE_ENV","RENDER_JOB_DISPATCH_URL","RENDER_JOB_DISPATCH_SECRET"] as const;
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  delete process.env.INFLUENCE_DEPLOYMENT_ENVIRONMENT;process.env.NODE_ENV="test";
  delete process.env.RENDER_JOB_DISPATCH_URL;delete process.env.RENDER_JOB_DISPATCH_SECRET;
  const runtime=startRenderWakeDispatcher(db,()=>true);
  try {
    const deadline=Date.now()+3000;
    while((await renderJob(db,job.id)).state!=="succeeded"&&Date.now()<deadline)await Bun.sleep(10);
    expect(await renderJob(db,job.id)).toMatchObject({state:"succeeded",progress:100,leaseExpiresAt:null});
    expect(verified).toContain((await renderJob(db,job.id)).outputKey!);
  } finally {
    await runtime.stop();
    for(const key of keys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];
  }
});
test("cancellation during durable verification fences its late completion",async()=> {
  const job=await create();await queueRenderJob(db,job.id);
  const claim=await claimRenderJob(db,job.id,"worker",digest,job.executionId);
  await outputTarget(db,job.id,claim.leaseToken,"e".repeat(64),100);
  await requestRenderFinalization(db,job.id,claim.leaseToken,receipt);
  setRenderObjectStorageForTests({upload:async()=>{throw new Error("unexpected upload");},download:async()=>{throw new Error("unexpected download");},
    verify:async()=>{await cancelRenderJob(db,job.id);}});
  await verifyPendingRenders(db);
  expect((await renderJob(db,job.id)).state).toBe("cancelled");
});
test("retry verifies frozen objects before compute and an old retry never starts another attempt",async()=> {
  const prior=process.env.RENDER_JOB_WORKER_DIGEST;process.env.RENDER_JOB_WORKER_DIGEST=digest;
  const execution={environment:"staging" as const,mode:"remote" as const,network:"tailnet" as const,configDigest:digest,targets:{trailer:"existing" as const,"studio-export":"aws-batch" as const}};
  try {
    const job=await create();await cancelRenderJob(db,job.id);corrupt=true;
    await expect(retryRenderJob(db,job.id,job.executionId,execution)).rejects.toThrow("input files");
    expect((await renderJob(db,job.id)).executionId).toBe(job.executionId);
    corrupt=false;const retried=await retryRenderJob(db,job.id,job.executionId,execution);expect(retried.executionId).not.toBe(job.executionId);
    await db.update(schema.renderJobs).set({state:"failed"}).where(eq(schema.renderJobs.id,job.id));corrupt=true;
    expect(await retryRenderJob(db,job.id,job.executionId,execution)).toMatchObject({state:"failed",executionId:retried.executionId});
  }finally {if(prior===undefined)delete process.env.RENDER_JOB_WORKER_DIGEST;else process.env.RENDER_JOB_WORKER_DIGEST=prior;}
});
test("MCP job reads require current producer authority, including after role revocation",async()=> {
  const job=await create();
  expect((await readProductionRender(db,"render-producer","get_production_render",{jobId:job.id})).structuredContent.status).toBe("unavailable");
  await grantTestAuthority(db,"render-producer",[],"producer");
  expect((await readProductionRender(db,"render-producer","get_production_render",{jobId:job.id})).structuredContent.status).toBe("ok");
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId,"render-producer"));
  expect((await readProductionRender(db,"render-producer","get_production_render",{jobId:job.id})).structuredContent.status).toBe("unavailable");
});
test("reconciliation repairs an interrupted trailer failure without stranding a queued version",async()=> {
  await db.insert(schema.gamePostgameMedia).values({gameId:"render-game",mediaType:"house_highlights_trailer",status:"queued",renderVersion:1});
  const row=await createRenderJob(db,{gameId:"render-game",userId:"render-producer",requestKey:"trailer-one",rendererDigest:digest,
    input:{version:1,workload:"trailer",gameId:"render-game",renderVersion:1}});
  await db.update(schema.renderJobs).set({state:"failed",failure:"worker_start_failed"}).where(eq(schema.renderJobs.id,row.id));
  await dispatchRenderJobs(db);
  const [media]=await db.select().from(schema.gamePostgameMedia).where(eq(schema.gamePostgameMedia.gameId,"render-game"));
  expect(media?.status).toBe("failed");expect(media?.renderVersion).toBe(1);
  expect(media?.failureCategory).toBe("worker");
});
test("trailer assignment waits for old leases but continues while Batch trailers are active",async()=> {
  const saved=process.env.RENDER_JOB_WORKER_DIGEST;process.env.RENDER_JOB_WORKER_DIGEST=digest;
  try {
    await db.insert(schema.postgameMediaRenderRelease).values({id:1});
    await db.insert(schema.games).values({id:"next-trailer",slug:"next-trailer",status:"completed",config:"{}"});
    await db.insert(schema.gamePostgameMedia).values([
      {gameId:"render-game",mediaType:"house_highlights_trailer",status:"claimed",renderVersion:1,leaseExpiresAt:new Date(Date.now()+60_000).toISOString()},
      {gameId:"next-trailer",mediaType:"house_highlights_trailer",status:"queued",renderVersion:1},
    ]);
    const execution={environment:"staging" as const,mode:"remote" as const,network:"tailnet" as const,configDigest:digest,
      targets:{trailer:"aws-batch" as const,"studio-export":"aws-batch" as const}};
    await reconcileBatchTrailers(db,execution);
    expect(await db.select().from(schema.renderJobs)).toHaveLength(0);
    await createRenderJob(db,{gameId:"render-game",userId:null,requestKey:"batch-active",rendererDigest:digest,
      input:{version:1,workload:"trailer",gameId:"render-game",renderVersion:1}});
    await reconcileBatchTrailers(db,execution);
    const assigned=await db.select().from(schema.renderJobs).where(eq(schema.renderJobs.gameId,"next-trailer"));
    expect(assigned).toHaveLength(1);expect(assigned[0]?.state).toBe("queued");
  } finally {if(saved===undefined)delete process.env.RENDER_JOB_WORKER_DIGEST;else process.env.RENDER_JOB_WORKER_DIGEST=saved;}
});
