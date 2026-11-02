import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProductionExportDescriptor } from "@influence/engine/production-moments/export";
import { decodeRenderInput } from "@influence/engine/render-job";
import { bundlePath } from "./assets";
import type { ReplayManifest } from "./manifest";
import { fileIdentity } from "./provenance";

/** Upload only the exact files named by a prepared bundle. No credentials enter it. */
export async function orderCloudReplay(args:{api:URL;token:string;descriptor:ProductionExportDescriptor;bundleDir:string;requestKey:string;signal:AbortSignal}) {
  const manifest=JSON.parse(await readFile(join(args.bundleDir,"manifest.json"),"utf8")) as ReplayManifest;
  if(manifest.boundary.selectionHash!==args.descriptor.hash) throw new Error("Bundle selection does not match descriptor");
  if(manifest.width!==args.descriptor.settings.width||manifest.height!==args.descriptor.settings.height||manifest.fps!==args.descriptor.settings.fps)
    throw new Error("Bundle geometry does not match descriptor");
  const paths=["manifest.json",...Object.keys(manifest.staticFiles),...Object.values(manifest.assets).map(a=>a.path)];
  const files=await Promise.all([...new Set(paths)].map(async path=>({path,...await fileIdentity(bundlePath(args.bundleDir,path))})));
  const input=decodeRenderInput({version:1,workload:"studio-export",selectionHash:args.descriptor.hash,files});
  async function post<T>(path:string,body:unknown):Promise<T> {
    const response=await fetch(new URL(path,args.api),{method:"POST",redirect:"error",signal:args.signal,
      headers:{Authorization:`Bearer ${args.token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
    if(!response.ok) throw new Error(`Cloud export request failed (${response.status})`);
    return response.json() as Promise<T>;
  }
  const job=await post<{id:string;state:string}>(`/api/admin/production/games/${encodeURIComponent(args.descriptor.gameId)}/renders`,{descriptor:args.descriptor,input,requestKey:args.requestKey});
  if(job.state!=="uploading_inputs")return job;
  const {files:targets}=await post<{files:Array<{path:string;url:string;headers:Record<string,string>}>}>(`/api/admin/renders/${job.id}/input-targets`,{});
  for(const target of targets) {
    const response=await fetch(target.url,{method:"PUT",redirect:"error",signal:args.signal,headers:target.headers,body:Bun.file(bundlePath(args.bundleDir,target.path))});
    if(!response.ok && response.status!==412) throw new Error(`Bundle upload failed (${response.status}); retry with the same request key`);
  }
  return post<{id:string;state:string}>(`/api/admin/renders/${job.id}/queue`,{});
}
