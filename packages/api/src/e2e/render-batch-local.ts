/** Opt-in local Docker proof. Uses an isolated database and existing frozen media; no providers/AWS. */
import {Hono} from "hono";
import postgres from "postgres";
import {mkdir,cp,writeFile,rm} from "node:fs/promises";
import {resolve,join} from "node:path";
import {createWriteStream} from "node:fs";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {closeDB,schema} from "../db";
import {runMigrations} from "../db/migrate";
import {createRenderJobRoutes} from "../routes/render-jobs";
import {createRenderJob,inputTargets,queueRenderJob,renderJob,renderExecutionToken,verifyPendingRenders} from "../services/render-jobs";
import {renderDownload} from "../services/render-object-storage";
// Load host-side web helpers at runtime: the API package's rootDir deliberately
// excludes React/web implementation files from its production compilation.
const {fileIdentity}=await import(new URL("../../../web/src/lib/replay-export/provenance.ts",import.meta.url).href) as {fileIdentity(path:string):Promise<{sha256:string;byteLength:number}>};
const {bundlePath}=await import(new URL("../../../web/src/lib/replay-export/assets.ts",import.meta.url).href) as {bundlePath(root:string,path:string):string};
const {validateManifest}=await import(new URL("../../../web/src/lib/replay-export/manifest.ts",import.meta.url).href) as {validateManifest(value:unknown):void};
interface ProofManifest {game:{id:string};fps:number;range:{fromFrame:number;untilFrame:number};boundary:{selectionHash?:string};staticFiles:Record<string,string>;assets:Record<string,{path:string}>}

const source=process.argv[2];
if(!source)throw new Error("Usage: bun --env-file=<local MinIO env> scripts/verify-render-batch-local.ts BUNDLE_DIRECTORY");
const endpoint=new URL(process.env.LINODE_PRIVATE_CONTENT_ENDPOINT ?? "");
if(!["127.0.0.1","localhost"].includes(endpoint.hostname))throw new Error("Local proof requires localhost object storage");
const name=`render_proof_${crypto.randomUUID().replaceAll("-","")}`;
const database=new URL(process.env.RENDER_PROOF_DATABASE_URL ?? "postgresql://influence:influence@127.0.0.1:54329/postgres");
if(database.hostname!=="127.0.0.1")throw new Error("Local proof requires localhost PostgreSQL");
const admin=postgres(database.toString(),{max:1});
await admin.unsafe(`CREATE DATABASE ${name}`);database.pathname=`/${name}`;
const connection=database.toString();
process.env.DRIZZLE_MIGRATIONS_DIR=resolve("packages/api/drizzle");
process.env.RENDER_JOB_SECRET=crypto.randomUUID()+crypto.randomUUID();
const directory=resolve(".renders",`batch-proof-${Date.now()}`);await mkdir(directory,{recursive:true});
const app=new Hono();let api:ReturnType<typeof Bun.serve>|undefined,proxy:ReturnType<typeof Bun.serve>|undefined,verifier:ReturnType<typeof setInterval>|undefined,workerEnvFile:string|undefined;
try {
  const db=await runMigrations(connection);app.get("/api/health",c=>c.json({ok:true}));app.route("/",createRenderJobRoutes(db));
  let verifying=false;
  verifier=setInterval(()=>{if(verifying)return;verifying=true;verifyPendingRenders(db).finally(()=>{verifying=false;});},1000);
  api=Bun.serve({hostname:"0.0.0.0",port:0,fetch:app.fetch,idleTimeout:255});
  const apiOrigin=`http://127.0.0.1:${api.port}`;
  proxy=Bun.serve({hostname:"0.0.0.0",port:0,idleTimeout:255,fetch:async request=> {
    const url=new URL(request.url);
    if(url.origin!==apiOrigin && url.origin!==endpoint.origin)return new Response("Forbidden",{status:403});
    return fetch(url,{method:request.method,headers:request.headers,body:request.body,redirect:"manual"});
  }});
  const bundle=join(directory,"input.bundle");await cp(resolve(source),bundle,{recursive:true});
  const manifest=await Bun.file(join(bundle,"manifest.json")).json() as ProofManifest;
  // A short exact frame range tests transport/rendering without spending hours.
  manifest.range={fromFrame:0,untilFrame:Math.min(manifest.range.untilFrame,manifest.fps*2)};
  manifest.boundary.selectionHash ??= `sha256:${"b".repeat(64)}`;
  validateManifest(manifest);await Bun.write(join(bundle,"manifest.json"),JSON.stringify(manifest));
  const paths=["manifest.json",...Object.keys(manifest.staticFiles),...Object.values(manifest.assets).map(a=>a.path)];
  const files=await Promise.all([...new Set(paths)].map(async path=>({path,...await fileIdentity(bundlePath(bundle,path))})));
  await db.insert(schema.users).values({id:"local-render-proof"});
  await db.insert(schema.games).values({id:manifest.game.id,slug:`proof-${name}`,status:"completed",config:"{}"});
  const digest=`sha256:${"a".repeat(64)}`;
  const job=await createRenderJob(db,{gameId:manifest.game.id,userId:"local-render-proof",requestKey:name,rendererDigest:digest,
    input:{version:1,workload:"studio-export",selectionHash:manifest.boundary.selectionHash,files}});
  for(const target of await inputTargets(db,job.id)) {
    const response=await fetch(target.url,{method:"PUT",headers:target.headers,body:Bun.file(bundlePath(bundle,target.path))});
    if(!response.ok&&response.status!==412)throw new Error(`Input upload failed (${response.status})`);
  }
  await queueRenderJob(db,job.id);
  const envFile=join(directory,"worker.env");
  workerEnvFile=envFile;
  await writeFile(envFile,[`RENDER_JOB_API_URL=${apiOrigin}`,`RENDER_JOB_ID=${job.id}`,`RENDER_JOB_EXECUTION_ID=${job.executionId}`,
    `RENDER_JOB_WORKER_DIGEST=${digest}`,`RENDER_JOB_TOKEN=${renderExecutionToken(job.id,job.executionId)}`,
    `POSTGAME_MEDIA_HTTP_PROXY=http://host.docker.internal:${proxy.port}`].join("\n"),{mode:0o600});
  const child=Bun.spawn(["docker","run","--rm","--env-file",envFile,process.env.RENDER_PROOF_IMAGE ?? "influence-render-batch:local","bun","run","/app/packages/web/src/scripts/render-batch-job.ts"],
    {stdout:Bun.file(join(directory,"worker.log")),stderr:Bun.file(join(directory,"worker-errors.log"))});
  const code=await child.exited;
  const final=await renderJob(db,job.id);
  if(code!==0||final.state!=="succeeded"||!final.outputKey)throw new Error(`Docker render failed (exit ${code}, state ${final.state}); see ${directory}`);
  const response=await fetch(await renderDownload(final.outputKey));
  if(!response.body)throw new Error("Missing download body");
  const output=join(directory,"video.mp4");await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),createWriteStream(output));
  const identity=await fileIdentity(output);
  if(identity.sha256!==final.outputHash||identity.byteLength!==final.outputBytes)throw new Error("Downloaded output differs from accepted output");
  await Bun.write(join(directory,"proof.json"),JSON.stringify({jobId:job.id,state:final.state,output:identity,durationSeconds:2,databaseRemoved:true},null,2));
  console.log(`Docker render proof passed: ${directory}`);
} finally {
  if(verifier)clearInterval(verifier);api?.stop(true);proxy?.stop(true);await closeDB(connection);
  if(workerEnvFile)await rm(workerEnvFile,{force:true});
  await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);await admin.end();
}
