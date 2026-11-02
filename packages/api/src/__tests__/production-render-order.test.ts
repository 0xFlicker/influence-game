import {afterEach,beforeEach,expect,test} from "bun:test";
import {Hono} from "hono";
import {eq} from "drizzle-orm";
import {createProductionStudioRoutes} from "../routes/production-studio";
import {createRenderJobRoutes} from "../routes/render-jobs";
import {createMcpRoutes} from "../routes/mcp";
import {createProductionGameMcpServer} from "../game-mcp/server";
import {setupTestDB} from "./test-utils";
import {seedProductionStudioFixture} from "./production-studio-fixtures";
import {schema,type DrizzleDB} from "../db";
import {readJson} from "../services/payload-storage";
import {createRenderJob,queueRenderJob,renderExecutionToken,renderJob} from "../services/render-jobs";
import {setRenderObjectStorageForTests} from "../services/render-object-storage";
import {createSessionToken,type AuthEnv} from "../middleware/auth";
import {MCP_OAUTH_CLIENT_ID,MCP_OAUTH_AUDIENCE,MCP_OAUTH_PURPOSE,hashOpaqueSecret} from "../services/mcp-oauth";
import {CURRENT_PRIVACY_VERSION,CURRENT_TERMS_VERSION} from "../services/legal-acceptance";
import {freezeProductionSelection} from "../services/production-export-selection";
import {localRendererDigest,type RenderExecution} from "@influence/engine/render-execution-config";
import type {ProductionExportDescriptor} from "@influence/engine/production-moments/export";
const execution:RenderExecution={environment:"staging",mode:"remote",network:"tailnet",configDigest:`sha256:${"a".repeat(64)}`,targets:{trailer:"existing","studio-export":"aws-batch"}};
const settings={width:640,height:360,fps:24,reducedMotion:false,music:false,volume:1,profile:{ending:"finish-score",overrides:{}}};
const saved={JWT_SECRET:process.env.JWT_SECRET,RENDER_JOB_SECRET:process.env.RENDER_JOB_SECRET,RENDER_JOB_WORKER_DIGEST:process.env.RENDER_JOB_WORKER_DIGEST,MCP_OAUTH_RESOURCE_URI:process.env.MCP_OAUTH_RESOURCE_URI,POSTGAME_MEDIA_WORKER_TOKEN:process.env.POSTGAME_MEDIA_WORKER_TOKEN};
let db:DrizzleDB,f:Awaited<ReturnType<typeof seedProductionStudioFixture>>,app:Hono<AuthEnv>,token:string;
beforeEach(async()=> {
  db=await setupTestDB();process.env.JWT_SECRET="render-order-test";process.env.RENDER_JOB_SECRET="render-order-test-32-character-secret";
  process.env.RENDER_JOB_WORKER_DIGEST=`sha256:${"a".repeat(64)}`;process.env.MCP_OAUTH_RESOURCE_URI="http://127.0.0.1:3000/mcp";
  f=await seedProductionStudioFixture(db);token=await createSessionToken(f.producer.userId);
  app=new Hono<AuthEnv>();app.route("/",createProductionStudioRoutes(db,{execution}));app.route("/",createRenderJobRoutes(db,{execution}));
  setRenderObjectStorageForTests({upload:async()=>({url:"https://storage.invalid/upload",headers:{}}),download:async()=>"https://storage.invalid/download",verify:async()=>{}});
});
afterEach(()=>{setRenderObjectStorageForTests(undefined);for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;});
const root=()=>`/api/admin/production/games/${f.influence.id}`;
function request(path:string,body?:unknown,bearer=token) {return app.request(path,{method:body===undefined?"GET":"POST",headers:{Authorization:`Bearer ${bearer}`,"Content-Type":"application/json"},...(body!==undefined?{body:JSON.stringify(body)}:{})});}
async function frozen() {
  const page=await (await request(`${root()}/source?audience=public&thinking=on&limit=256`)).json() as {snapshot:unknown};
  return freezeProductionSelection(db,f.influence.id,{snapshot:page.snapshot,audience:"public",thinking:true,selection:{mode:"ids",thinking:true,ids:[f.influence.speechId]},
    expectedMomentIds:[f.influence.speechId],settings,copy:{},recordings:[]});
}
test("localhost orders and retries use native source identity; competing workers claim exactly once",async()=> {
  const descriptor=await frozen(),local:RenderExecution={environment:"development",mode:"local",network:"direct",configDigest:execution.configDigest};
  process.env.POSTGAME_MEDIA_WORKER_TOKEN="local-order-worker";delete process.env.RENDER_JOB_WORKER_DIGEST;
  app=new Hono<AuthEnv>();app.route("/",createProductionStudioRoutes(db,{execution:local}));app.route("/",createRenderJobRoutes(db,{execution:local}));
  const ordered=await request(`${root()}/render-orders`,{descriptor,requestKey:"native-order",files:[]});expect(ordered.status).toBe(202);
  const job=await ordered.json() as {id:string;executionId:string};
  const obsolete=await createRenderJob(db,{gameId:f.influence.id,userId:f.producer.userId,requestKey:"old-local-source",rendererDigest:`sha256:${"f".repeat(64)}`,
    input:{version:1,workload:"studio-export",selectionHash:descriptor.hash,files:[{path:"manifest.json",byteLength:1,sha256:"c".repeat(64)}]}});await queueRenderJob(db,obsolete.id);
  const path="/api/internal/local-renders/assignment",body={rendererDigest:localRendererDigest()};
  expect((await request(path,body)).status).toBe(401);
  expect((await request(path,{},"local-order-worker")).status).toBe(400);
  expect((await request(path,{rendererDigest:`sha256:${"f".repeat(64)}`},"local-order-worker")).status).toBe(409);
  const assignment=await (await request(path,body,"local-order-worker")).json() as {assignment:{jobId:string;executionId:string;token:string;rendererDigest:string}};
  expect(assignment.assignment).toMatchObject({jobId:job.id,executionId:job.executionId,rendererDigest:body.rendererDigest});
  expect(await renderJob(db,obsolete.id)).toMatchObject({state:"failed",failure:"renderer_unavailable"});
  expect((await renderJob(db,job.id)).state).toBe("queued");
  const claim=()=>request(`/api/internal/renders/${job.id}/claim`,{workerId:crypto.randomUUID(),rendererDigest:body.rendererDigest,executionId:job.executionId},assignment.assignment.token);
  const competing=await Promise.all([claim(),claim()]);expect(competing.map(r=>r.status).sort()).toEqual([200,409]);
  expect((await renderJob(db,job.id)).attempt).toBe(1);
  await request(`/api/admin/renders/${job.id}/cancel`,{});
  expect((await request(`/api/admin/renders/${job.id}/retry`,{executionId:job.executionId})).status).toBe(200);
  expect((await request(`/api/internal/renders/${job.id}/status`,{},assignment.assignment.token)).status).toBe(401);
  expect((await request(`http://remote.invalid${path}`,body,"local-order-worker")).status).toBe(404);
});
test("deployed renderer routes never expose local assignment or implicitly enable exports",async()=> {
  process.env.POSTGAME_MEDIA_WORKER_TOKEN="local-order-worker";
  const body={rendererDigest:localRendererDigest()},path="/api/internal/local-renders/assignment";
  expect((await request(path,body,"local-order-worker")).status).toBe(404);
  const descriptor=await frozen();
  for(const environment of ["staging","prod"] as const) {
    const deployed={...execution,environment,mode:"local" as const,targets:undefined};
    app=new Hono<AuthEnv>();app.route("/",createProductionStudioRoutes(db,{execution:deployed}));app.route("/",createRenderJobRoutes(db,{execution:deployed}));
    expect((await request(path,body,"local-order-worker")).status).toBe(404);
    expect((await request(`${root()}/render-orders`,{descriptor,requestKey:`disabled-${environment}`,files:[]})).status).toBe(409);
  }
});
test("browser orders a frozen selection without local preparation; exact replay and changed-key conflict",async()=> {
  const descriptor=await frozen(),body={descriptor,requestKey:"browser-order",files:[]};
  const response=await request(`${root()}/render-orders`,body);expect(response.status).toBe(202);
  const job=await response.json() as {id:string;state:string};expect(job.state).toBe("queued");
  const input=await readJson((await renderJob(db,job.id)).input);expect("preparation" in input).toBe(true);
  if(!("preparation" in input))throw new Error("Missing frozen preparation");
  expect(input.preparation.descriptor.hash).toBe(descriptor.hash);expect(input.preparation.source.snapshot).toEqual(descriptor.sourceSnapshot);
  expect((await request(`${root()}/renders`,{descriptor,input,requestKey:"forged-source"})).status).toBe(400);
  expect((await (await request(`${root()}/render-orders`,body)).json() as {id:string}).id).toBe(job.id);
  expect((await request(`${root()}/render-orders`,{...body,files:[{path:`assets/${"b".repeat(64)}`,sha256:"b".repeat(64),byteLength:1}]})).status).toBe(409);
  expect(await db.select().from(schema.renderJobs)).toHaveLength(1);
  const original=await renderJob(db,job.id);
  await request(`/api/admin/renders/${job.id}/cancel`,{});
  const retry=await request(`/api/admin/renders/${job.id}/retry`,{executionId:original.executionId});expect(retry.status).toBe(200);
  const retried=await renderJob(db,job.id);expect(retried.state).toBe("queued");expect(retried.executionId).not.toBe(original.executionId);
  await db.update(schema.renderJobs).set({state:"failed"}).where(eq(schema.renderJobs.id,job.id));
  expect((await request(`/api/admin/renders/${job.id}/retry`,{executionId:original.executionId})).status).toBe(200);
  expect(await renderJob(db,job.id)).toMatchObject({state:"failed",executionId:retried.executionId});
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId,f.producer.userId));
  expect((await request(`${root()}/render-orders`,body)).status).toBe(403);
});
test("assigned selection worker gets private frozen source and only referenced media while leased",async()=> {
  const descriptor=await frozen(),job=await (await request(`${root()}/render-orders`,{descriptor,requestKey:"media",files:[]})).json() as {id:string};
  const row=await renderJob(db,job.id),bearer=renderExecutionToken(row.id,row.executionId);
  const claim=await request(`/api/internal/renders/${job.id}/claim`,{workerId:"assigned",executionId:row.executionId,rendererDigest:row.rendererDigest},bearer);
  expect(claim.status).toBe(200);const value=await claim.json() as {input?:unknown;inputDownload?:unknown};expect(value.input).toBeUndefined();expect(value.inputDownload).toBeDefined();
  const source=await readJson(row.input);if(!("preparation" in source))throw new Error("Missing input");
  const visual=source.preparation.source.visual as {scenes:Array<{imageUrl:string}>;fullBodies:Record<string,string>;portraits:Record<string,string>};
  const path=visual.scenes[0]!.imageUrl;
  expect((await request(`/api/internal/renders/${job.id}/media?path=${encodeURIComponent(path)}`,undefined,bearer)).status).toBe(200);
  for(const reference of [...Object.values(visual.fullBodies),...Object.values(visual.portraits)])if(reference.startsWith("/api/"))
    expect((await request(`/api/internal/renders/${job.id}/media?path=${encodeURIComponent(reference)}`,undefined,bearer)).status).toBe(200);
  expect((await request(`/api/internal/renders/${job.id}/media?path=${encodeURIComponent("/api/admin/production/games/other/visual/artifacts/secret")}`,undefined,bearer)).status).toBe(404);
  await request(`/api/admin/renders/${job.id}/cancel`,{});
  expect((await request(`/api/internal/renders/${job.id}/media?path=${encodeURIComponent(path)}`,undefined,bearer)).status).toBe(409);
});
test("HTTP MCP render consent is separate from tags; orders survive exact replay and revoke access immediately",async()=> {
  await db.update(schema.users).set({walletAddress:"0xrender"}).where(eq(schema.users.id,f.producer.userId));
  await db.insert(schema.legalAcceptances).values({userId:f.producer.userId,termsVersion:CURRENT_TERMS_VERSION,privacyVersion:CURRENT_PRIVACY_VERSION,deploymentSha:"0123456789abcdef0123456789abcdef01234567",source:"existing_account"});
  async function access(scope:string) {const raw=crypto.randomUUID();await db.insert(schema.mcpOauthAccessTokens).values({id:crypto.randomUUID(),tokenHash:hashOpaqueSecret(raw),userId:f.producer.userId,walletAddress:"0xrender",clientId:MCP_OAUTH_CLIENT_ID,resourceUri:"http://127.0.0.1:3000/mcp",scope,audience:MCP_OAUTH_AUDIENCE,purpose:MCP_OAUTH_PURPOSE,expiresAt:"2099-01-01T00:00:00.000Z"});return raw;}
  const read=await access("producer producer:edit"),render=await access("producer producer:render");
  const mcp=createMcpRoutes(db,{server:createProductionGameMcpServer(db,undefined,execution),auditLogger:()=>undefined,ownerLearningConnectionRecorder:async()=>undefined});
  async function rpc(bearer:string,name:string,args:unknown) {const response=await mcp.request("http://127.0.0.1:3000/mcp",{method:"POST",headers:{Authorization:`Bearer ${bearer}`,"Content-Type":"application/json",Accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}})});return {status:response.status,body:await response.json() as {error?:unknown;result?:{isError?:boolean;structuredContent?:{status:string;job:{id:string;state:string}}}}};}
  const descriptor:ProductionExportDescriptor=await frozen();
  const args={gameIdOrSlug:f.influence.id,audience:"public",thinking:true,snapshot:descriptor.sourceSnapshot,momentIds:descriptor.momentIds,settings,copy:{},requestKey:"mcp-order"};
  expect((await rpc(read,"order_production_render",args)).body.result?.isError).toBe(true);
  const first=await rpc(render,"order_production_render",args);expect(first.status).toBe(200);expect(first.body.result?.structuredContent?.status).toBe("ok");
  const job=first.body.result!.structuredContent!.job;expect(job.state).toBe("queued");
  await db.update(schema.renderJobs).set({state:"uploading_inputs"}).where(eq(schema.renderJobs.id,job.id));
  expect((await rpc(render,"order_production_render",args)).body.result?.structuredContent?.job.id).toBe(job.id);
  expect((await renderJob(db,job.id)).state).toBe("queued");
  expect((await rpc(render,"cancel_production_render",{jobId:job.id})).body.result?.structuredContent?.job.state).toBe("cancelled");
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId,f.producer.userId));
  const denied=await rpc(render,"retry_production_render",{jobId:job.id,executionId:(await renderJob(db,job.id)).executionId});expect(denied.status===401||Boolean(denied.body.error)).toBe(true);
  expect((await renderJob(db,job.id)).state).toBe("cancelled");
});
