import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {createWriteStream} from "node:fs";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {prepareSelectedReplay} from "../lib/replay-export/prepare-selection";
import {renderWorkerError} from "../lib/replay-export/worker-error";
import {workerMediaFetch} from "../lib/replay-export/worker-media-fetch";
import { decodeRenderInput, type RenderFile } from "@influence/engine/render-job";
import { bundlePath } from "../lib/replay-export/assets";
import {renderClaim,type WorkerClaim} from "./render-house-highlights-media-worker";
import {remotionMediaOptions} from "../lib/house-highlights-trailer-media-bundle";
import { validateManifest, type ReplayManifest } from "../lib/replay-export/manifest";
import { renderReplay } from "../lib/replay-export/render";
import { fileIdentity } from "../lib/replay-export/provenance";

/** One assigned execution; the old polling worker remains a separate entry point. */
export async function runBatchRender(env:NodeJS.ProcessEnv=process.env) {
  const api=new URL(required(env.RENDER_JOB_API_URL)), id=required(env.RENDER_JOB_ID), executionId=required(env.RENDER_JOB_EXECUTION_ID);
  if(!/^[a-f0-9-]{36}$/.test(id)||!/^sha256:[a-f0-9]{64}$/.test(required(env.RENDER_JOB_WORKER_DIGEST))) throw new Error("Invalid execution identity");
  if(api.username||api.password||api.pathname!=="/"||api.search||api.hash || (api.protocol!=="https:" && !["localhost","127.0.0.1","host.docker.internal"].includes(api.hostname))) throw new Error("Invalid renderer API origin");
  const abort=new AbortController(), stop=()=>abort.abort();
  process.once("SIGTERM",stop);process.once("SIGINT",stop);
  if(env.POSTGAME_MEDIA_HTTP_PROXY) {
    const deadline=Date.now()+110_000;
    while(true) {
      try {
        const ready=await fetch(new URL("/api/health",api),{redirect:"error",proxy:env.POSTGAME_MEDIA_HTTP_PROXY,signal:AbortSignal.any([abort.signal,AbortSignal.timeout(5000)])});
        if(ready.ok)break;
      }catch {if(abort.signal.aborted)throw abort.signal.reason;}
      if(Date.now()>deadline)throw new Error("Renderer network readiness deadline exceeded");
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  }
  async function post<T>(operation:string,body:unknown):Promise<T> {
    const response=await fetch(new URL(`/api/internal/renders/${id}/${operation}`,api),{
      method:"POST",redirect:"error",signal:AbortSignal.any([abort.signal,AbortSignal.timeout(60_000)]),
      headers:{Authorization:`Bearer ${required(env.RENDER_JOB_TOKEN)}`,"Content-Type":"application/json"},body:JSON.stringify(body),
      ...(env.POSTGAME_MEDIA_HTTP_PROXY ? {proxy:env.POSTGAME_MEDIA_HTTP_PROXY}:{}),
    });
    if(!response.ok) throw new Error(`render_${operation}_${response.status}`);
    return response.json() as Promise<T>;
  }
  const claim=await post<{input?:unknown;inputDownload?:{url:string;sha256:string;byteLength:number};files:Array<RenderFile & {url:string}>;leaseToken:string;trailer:WorkerClaim|null}>("claim",{
    workerId:env.AWS_BATCH_JOB_ID ?? crypto.randomUUID(),rendererDigest:env.RENDER_JOB_WORKER_DIGEST,executionId});
  let progress=0, lastHeartbeat=Date.now(), beating=false;
  const heartbeat=setInterval(async()=> {
    if(beating)return;beating=true;
    try {await post("heartbeat",{leaseToken:claim.leaseToken,progress});lastHeartbeat=Date.now();}
    catch {if(Date.now()-lastHeartbeat>120_000)abort.abort(new Error("Render lease could not be renewed"));}
    finally {beating=false;}
  },15_000);
  const scratch=await mkdtemp(join(tmpdir(),"house-batch-"));
  try {
    let rawInput=claim.input;
    if(claim.inputDownload) {
      const response=await fetch(claim.inputDownload.url,{redirect:"error",signal:abort.signal,...(env.POSTGAME_MEDIA_HTTP_PROXY?{proxy:env.POSTGAME_MEDIA_HTTP_PROXY}:{})});
      if(!response.ok)throw new Error("Frozen input download failed");
      const bytes=Buffer.from(await response.arrayBuffer());
      if(bytes.length!==claim.inputDownload.byteLength||createHash("sha256").update(bytes).digest("hex")!==claim.inputDownload.sha256)throw new Error("Frozen input checksum mismatch");
      rawInput=JSON.parse(gunzipSync(bytes).toString("utf8"));
    }
    const input=decodeRenderInput(rawInput);
    if(input.workload==="trailer") {
      if(!claim.trailer)throw new Error("Missing assigned trailer");
      const originalFetch=fetch;
      const scopedFetch:typeof fetch=Object.assign(async(url:Parameters<typeof fetch>[0],init?:RequestInit)=> {
        const parsed=new URL(String(url));
        if(parsed.origin===api.origin && parsed.pathname.startsWith(`/api/internal/postgame-media/${input.gameId}/`)) {
          const operation=parsed.pathname.split("/").at(-1)!;
          const headers=new Headers(init?.headers);headers.set("Authorization",`Bearer ${required(env.RENDER_JOB_TOKEN)}`);
          return originalFetch(new URL(`/api/internal/renders/${id}/trailer/${operation}`,api),{...init,headers,signal:AbortSignal.any([abort.signal,...(init?.signal?[init.signal]:[])])});
        }
        return originalFetch(url,{...init,signal:abort.signal});
      },{preconnect:fetch.preconnect});
      const result=await renderClaim({apiBaseUrl:api.origin,workerToken:required(env.RENDER_JOB_TOKEN),pollIntervalMs:5000,httpTimeoutMs:60_000,
        uploadTimeoutMs:300_000,temporaryRoot:scratch,minimumFreeBytes:0,remotionOptions:remotionMediaOptions(env.POSTGAME_MEDIA_HTTP_PROXY?{...env,REMOTION_BROWSER_EXECUTABLE:"/usr/local/bin/chromium-tailnet"}:env),executionMode:"local",localExports:false,
        ...(env.POSTGAME_MEDIA_HTTP_PROXY ? {httpProxy:env.POSTGAME_MEDIA_HTTP_PROXY}:{})},claim.trailer,scopedFetch);
      if(result!=="completed")throw new Error("Trailer render did not complete");
      return;
    }
    if(claim.files.length!==input.files.length) throw new Error("Incomplete bundle");
    for(const file of input.files) {
      const target=claim.files.find(f=>f.path===file.path);
      if(!target)throw new Error("Missing bundle object");
      const response=await fetch(target.url,{redirect:"error",signal:AbortSignal.any([abort.signal,AbortSignal.timeout(60_000)]),...(env.POSTGAME_MEDIA_HTTP_PROXY ? {proxy:env.POSTGAME_MEDIA_HTTP_PROXY}:{})});
      if(!response.ok||!response.body)throw new Error("Bundle download failed");
      const path=bundlePath(scratch,file.path);await mkdir(dirname(path),{recursive:true});
      await pipeline(Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream),createWriteStream(path),{signal:abort.signal});
      const actual=await fileIdentity(path);
      if(actual.sha256!==file.sha256||actual.byteLength!==file.byteLength)throw new Error("Bundle checksum mismatch");
    }
    if("preparation" in input) {
      const scopedFetch=workerMediaFetch(api,id,required(env.RENDER_JOB_TOKEN),abort.signal,env.POSTGAME_MEDIA_HTTP_PROXY);
      await prepareSelectedReplay(input.preparation,scratch,join(import.meta.dir,"../.."),api,abort.signal,scopedFetch);
    }
    const manifest=await Bun.file(join(scratch,"manifest.json")).json() as ReplayManifest;
    validateManifest(manifest);
    if(manifest.boundary.selectionHash!==input.selectionHash)throw new Error("Bundle selection mismatch");
    // Enforce the bundle's own checksums as well as transport declarations.
    for(const [path,expected] of Object.entries(manifest.staticFiles)) if((await fileIdentity(bundlePath(scratch,path))).sha256!==expected)throw new Error("Stage art checksum mismatch");
    for(const asset of Object.values(manifest.assets)) if((await fileIdentity(bundlePath(scratch,asset.path))).sha256!==asset.sha256)throw new Error("Asset checksum mismatch");
    const output=join(scratch,"video.mp4");
    await renderReplay(manifest,scratch,output,false,abort.signal,{browserExecutable:remotionMediaOptions(env.POSTGAME_MEDIA_HTTP_PROXY?{...env,REMOTION_BROWSER_EXECUTABLE:"/usr/local/bin/chromium-tailnet"}:env).browserExecutable,onProgress:value=>{progress=Math.min(95,Math.floor(value*95));}});
    const identity=await fileIdentity(output);
    const target=await post<{url:string;headers:Record<string,string>}>("output",{leaseToken:claim.leaseToken,...identity});
    const uploaded=await fetch(target.url,{method:"PUT",redirect:"error",headers:target.headers,body:Bun.file(output),signal:abort.signal,
      ...(env.POSTGAME_MEDIA_HTTP_PROXY ? {proxy:env.POSTGAME_MEDIA_HTTP_PROXY}:{})});
    if(!uploaded.ok && uploaded.status!==412)throw new Error("Output upload failed");
    await post("finalize",{leaseToken:claim.leaseToken,receipt:await Bun.file(`${output}.receipt.json`).json()});
    while(true) {
      const state=await post<{state:string}>("status",{});
      if(state.state==="succeeded")break;
      if(state.state!=="verifying")throw new Error("Output verification did not complete");
      if(abort.signal.aborted)throw abort.signal.reason;
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
  } catch(error) {
    if(!abort.signal.aborted) await post("failure",{leaseToken:claim.leaseToken}).catch(()=>{process.stderr.write("Render failure could not be acknowledged\n");});
    throw error;
  } finally {
    clearInterval(heartbeat);process.removeListener("SIGTERM",stop);process.removeListener("SIGINT",stop);
    await rm(scratch,{recursive:true,force:true});
  }
}
function required(value:string|undefined) {if(!value)throw new Error("Missing assigned-render configuration");return value;}
if(import.meta.main) runBatchRender().catch(error=>{console.error("Assigned render failed",renderWorkerError(error,[process.env.RENDER_JOB_TOKEN]));process.exitCode=1;});
