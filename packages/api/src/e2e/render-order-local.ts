/** Opt-in HTTP MCP → frozen source → Docker worker → private download proof. No AWS/providers. */
import {Hono} from "hono";
import postgres from "postgres";
import {mkdir,writeFile,rm} from "node:fs/promises";
import {resolve,join} from "node:path";
import {createWriteStream} from "node:fs";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {createHash} from "node:crypto";
import {eq} from "drizzle-orm";
import {closeDB,schema} from "../db";
import {runMigrations} from "../db/migrate";
import {seedProductionStudioFixture} from "../__tests__/production-studio-fixtures";
import {createProductionStudioRoutes} from "../routes/production-studio";
import {createRenderJobRoutes} from "../routes/render-jobs";
import {createPostgameMediaWorkerRoutes} from "../routes/postgame-media-worker";
import {createMcpRoutes} from "../routes/mcp";
import {createProductionGameMcpServer} from "../game-mcp/server";
import {renderJob,renderExecutionToken} from "../services/render-jobs";
import {startRenderWakeDispatcher} from "../services/postgame-media-execution";
import {readJson} from "../services/payload-storage";
import {recordCurrentLegalAcceptance} from "../services/legal-acceptance";
import {MCP_OAUTH_CLIENT_ID,MCP_OAUTH_AUDIENCE,MCP_OAUTH_PURPOSE,hashOpaqueSecret} from "../services/mcp-oauth";
import type {AuthEnv} from "../middleware/auth";
import type {RenderExecution} from "@influence/engine/render-execution-config";
import type {ProductionCatalog} from "@influence/engine/production-moments";
import {createAuthRoutes} from "../routes/auth";
import {openLocalRenderMonitor} from "./render-monitor-local-browser";
import {cleanupE2eResources} from "./cleanup";
const native=process.argv.includes("--native");
const endpoint=new URL(process.env.LINODE_PRIVATE_CONTENT_ENDPOINT??"");
if(!["localhost","127.0.0.1"].includes(endpoint.hostname))throw new Error("Local proof requires localhost storage");
const connection=new URL(process.env.RENDER_PROOF_DATABASE_URL??"postgresql://influence:influence@127.0.0.1:54329/postgres");
if(connection.hostname!=="127.0.0.1")throw new Error("Local proof requires localhost PostgreSQL");
const name=`render_order_${crypto.randomUUID().replaceAll("-","")}`,admin=postgres(connection.toString(),{max:1});
connection.pathname=`/${name}`;
process.env.DRIZZLE_MIGRATIONS_DIR=resolve("packages/api/drizzle");process.env.JWT_SECRET=crypto.randomUUID();
process.env.RENDER_JOB_SECRET=crypto.randomUUID()+crypto.randomUUID();process.env.RENDER_JOB_WORKER_DIGEST=`sha256:${"a".repeat(64)}`;
const directory=resolve(".renders",`order-proof-${Date.now()}`);await mkdir(directory,{recursive:true});
const execution:RenderExecution=native?{environment:"development",mode:"local",network:"direct",configDigest:process.env.RENDER_JOB_WORKER_DIGEST}
  :{environment:"staging",mode:"remote",network:"tailnet",configDigest:process.env.RENDER_JOB_WORKER_DIGEST,targets:{trailer:"existing","studio-export":"aws-batch"}};
process.env.POSTGAME_MEDIA_WORKER_TOKEN=crypto.randomUUID();
let api:ReturnType<typeof Bun.serve>|undefined,proxy:ReturnType<typeof Bun.serve>|undefined,verifier:ReturnType<typeof startRenderWakeDispatcher>|undefined,workerEnv:string|undefined;
let monitor:Awaited<ReturnType<typeof openLocalRenderMonitor>>|undefined;
try {
  await admin.unsafe(`CREATE DATABASE ${name}`);
  const db=await runMigrations(connection.toString()),fixture=await seedProductionStudioFixture(db),app=new Hono<AuthEnv>();
  await db.update(schema.users).set({walletAddress:"0xlocal-render-proof"}).where(eq(schema.users.id,fixture.producer.userId));
  await recordCurrentLegalAcceptance(db,fixture.producer.userId,"existing_account","0123456789abcdef0123456789abcdef01234567");
  app.get("/api/health",c=>c.json({ok:true}));app.route("/",createProductionStudioRoutes(db,{execution}));app.route("/",createRenderJobRoutes(db,{execution}));
  if(native)app.route("/",createPostgameMediaWorkerRoutes(db));
  app.route("/",createAuthRoutes(db,{managedAuthMode:"full",compatibilityBridgeEnabled:false}));
  api=Bun.serve({hostname:"0.0.0.0",port:0,fetch:app.fetch,idleTimeout:255});const origin=`http://127.0.0.1:${api.port}`;
  process.env.MCP_OAUTH_RESOURCE_URI=`${origin}/mcp`;
  app.route("/",createMcpRoutes(db,{server:createProductionGameMcpServer(db,undefined,execution),auditLogger:()=>undefined,ownerLearningConnectionRecorder:async()=>undefined}));
  const bearer=crypto.randomUUID();await db.insert(schema.mcpOauthAccessTokens).values({id:crypto.randomUUID(),tokenHash:hashOpaqueSecret(bearer),userId:fixture.producer.userId,
    walletAddress:"0xlocal-render-proof",clientId:MCP_OAUTH_CLIENT_ID,resourceUri:`${origin}/mcp`,scope:"producer producer:render",audience:MCP_OAUTH_AUDIENCE,purpose:MCP_OAUTH_PURPOSE,expiresAt:new Date(Date.now()+3600_000).toISOString()});
  proxy=Bun.serve({hostname:"0.0.0.0",port:0,idleTimeout:255,fetch:request=> {
    const url=new URL(request.url);if(![origin,endpoint.origin].includes(url.origin))return new Response("Forbidden",{status:403});
    return fetch(url,{method:request.method,headers:request.headers,body:request.body,redirect:"manual"});
  }});
  verifier=startRenderWakeDispatcher(db,()=>true);
  if(process.argv.includes("--browser"))monitor=await openLocalRenderMonitor(origin,fixture.producer.token,directory);
  async function rpc<T>(tool:string,args:unknown):Promise<T> {
    const response=await fetch(`${origin}/mcp`,{method:"POST",headers:{Authorization:`Bearer ${bearer}`,"Content-Type":"application/json",Accept:"application/json, text/event-stream"},
      body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:tool,arguments:args}})});
    const result=await response.json() as {error?:unknown;result?:{isError?:boolean;structuredContent?:T}};
    if(!response.ok||result.error||result.result?.isError||!result.result?.structuredContent)throw new Error(`MCP ${tool} failed`);
    return result.result.structuredContent;
  }
  const proofs=[];
  for(const game of [{id:fixture.influence.id,audience:"public",momentId:fixture.influence.speechId},{id:fixture.werewolf.id,audience:"omniscient",momentId:null}]) {
    const sourceResponse=await fetch(`${origin}/api/admin/production/games/${game.id}/source?audience=${game.audience}&thinking=on`,{headers:{Authorization:`Bearer ${fixture.producer.token}`}});
    if(!sourceResponse.ok)throw new Error("Source read failed");
    const page=await sourceResponse.json() as {snapshot:Record<string,unknown>;catalog:ProductionCatalog};
    const id=game.momentId??page.catalog.moments.find(m=>m.kind==="speech")?.id;if(!id)throw new Error("Missing selected speech");
    const args={gameIdOrSlug:game.id,audience:game.audience,thinking:true,snapshot:page.snapshot,momentIds:[id],copy:{},requestKey:`proof-${game.id}`,
      settings:{width:640,height:360,fps:24,reducedMotion:false,music:false,volume:1,profile:{readingRate:100,thinkingRate:100,conversationGapMs:0,postSpeechHoldMs:0,ending:{holdMs:0},overrides:{}}}};
    const ordered=await rpc<{job:{id:string;state:string}}>("order_production_render",args),job=await renderJob(db,ordered.job.id);
    if(ordered.job.state!=="queued")throw new Error("Order was not queued");
    if(monitor)await monitor.job(job.id,"queued",`${game.audience}-queued.png`);
    if((await rpc<{job:{id:string}}>("order_production_render",args)).job.id!==job.id)throw new Error("Order replay duplicated execution");
    workerEnv=join(directory,"worker.env");await writeFile(workerEnv,[`RENDER_JOB_API_URL=${origin}`,`RENDER_JOB_ID=${job.id}`,`RENDER_JOB_EXECUTION_ID=${job.executionId}`,
      `RENDER_JOB_WORKER_DIGEST=${job.rendererDigest}`,`RENDER_JOB_TOKEN=${renderExecutionToken(job.id,job.executionId)}`,`POSTGAME_MEDIA_HTTP_PROXY=http://host.docker.internal:${proxy.port}`].join("\n"),{mode:0o600});
    const localEntry='import {runBatchRender} from "/app/packages/web/src/scripts/render-batch-job.ts";runBatchRender().catch(e=>{console.error(e instanceof Error?e.message.replace(/https?:\\/\\/[^\\s]+/g,s=>{const u=new URL(s);return u.origin+u.pathname}):"Unknown local render error");process.exitCode=1;});';
    const command=native?[process.execPath,"packages/web/src/scripts/render-house-highlights-media-worker.ts","--once"]
      :["docker","run","--rm","--env-file",workerEnv,process.env.RENDER_PROOF_IMAGE??"influence-render-batch:local","bun","-e",localEntry];
    const child=Bun.spawn(command,{env:{...process.env,...(native?{POSTGAME_MEDIA_API_URL:origin,
      REMOTION_BROWSER_EXECUTABLE:process.env.REMOTION_BROWSER_EXECUTABLE??"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}:{})},
      stdout:Bun.file(join(directory,`${game.audience}-worker.log`)),stderr:Bun.file(join(directory,`${game.audience}-worker-errors.log`))});
    const code=await child.exited;await rm(workerEnv,{force:true});workerEnv=undefined;
    const final=await rpc<{job:{state:string}}>("get_production_render",{jobId:job.id});
    if(code!==0||final.job.state!=="succeeded")throw new Error(`${native?"Native worker":"Docker"} order proof failed (exit ${code}, state ${final.job.state}); see ${directory}`);
    if(monitor)await monitor.job(job.id,"succeeded",`${game.audience}-completed.png`);
    const download=await rpc<{url:string;sha256:string;byteLength:number}>("get_production_render_download",{jobId:job.id});
    const response=await fetch(download.url);if(!response.ok||!response.body)throw new Error("Download failed");
    const path=join(directory,`${game.audience}.mp4`);await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),createWriteStream(path));
    const bytes=await Bun.file(path).bytes(),hash=createHash("sha256").update(bytes).digest("hex");
    if(hash!==download.sha256||bytes.length!==download.byteLength)throw new Error("Download identity mismatch");
    const browserDownload=monitor?await monitor.download(job.id,download):undefined;
    const input=await readJson(job.input);if(!("preparation" in input))throw new Error("Missing selected input");
    await Bun.write(join(directory,`${game.audience}-selection.json`),JSON.stringify(input.preparation.descriptor,null,2));
    proofs.push({gameId:game.id,jobId:job.id,state:final.job.state,selectionHash:input.selectionHash,momentIds:[id],output:{sha256:hash,byteLength:bytes.length},...(browserDownload?{browserDownload}:{})});
  }
  if(monitor)await monitor.overview();
  await Bun.write(join(directory,"proof.json"),JSON.stringify({execution:native?"native-local-worker":"docker",proofs,databaseRemoved:false},null,2));console.log(`MCP/${native?"native worker":"Docker"} order proof passed: ${directory}`);
} finally {
  await cleanupE2eResources([
    ["monitor browser",async()=>{await monitor?.close();}],
    ["local servers",async()=>{await verifier?.stop();api?.stop(true);proxy?.stop(true);}],
    ["worker credentials",async()=>{if(workerEnv)await rm(workerEnv,{force:true});}],
    ["database connection",()=>closeDB(connection.toString())],
    ["proof database",async()=>{await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);}],
    ["administration connection",()=>admin.end()],
  ]);
  const proof=Bun.file(join(directory,"proof.json"));if(await proof.exists())await Bun.write(proof,JSON.stringify({...await proof.json(),databaseRemoved:true},null,2));
}
