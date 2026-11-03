import {decodeProductionExport,type ProductionExportDescriptor} from "./production-moments/export";
import type {PublishedAudioTrack} from "./audio-track";
/** Exact transport contract shared by Batch, the API and the local Docker harness. */
export type RenderWorkload = "trailer" | "studio-export";
export type RenderTarget = "existing" | "aws-batch";
export type RenderFile = { path: string; sha256: string; byteLength: number };
export type RenderInput =
  | { version: 1; workload: "studio-export"; selectionHash: string; files: RenderFile[] }
  | { version: 1; workload: "studio-export"; selectionHash: string; files: RenderFile[];
      preparation:{descriptor:ProductionExportDescriptor;source:Record<string,unknown>;audio:PublishedAudioTrack|null;requestHash:string} }
  | { version: 1; workload: "trailer"; gameId: string; renderVersion: number };

export function renderFile(value: unknown): RenderFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid render file");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== "byteLength,path,sha256" || typeof v.path !== "string"
    || !/^(?:assets|static)\/[a-zA-Z0-9_./-]+$|^manifest\.json$/.test(v.path)
    || v.path.split("/").some(part => !part || part === "." || part === "..")
    || typeof v.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.sha256)
    || !Number.isSafeInteger(v.byteLength) || Number(v.byteLength) < 0) throw new Error("Invalid render file");
  return { path: v.path, sha256: v.sha256, byteLength: Number(v.byteLength) };
}

export function decodeRenderInput(value: unknown): RenderInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid render input");
  const v = value as Record<string, unknown>;
  if (v.version !== 1) throw new Error("Unsupported render input version");
  if(v.workload==="studio-export" && Object.keys(v).sort().join()==="files,preparation,selectionHash,version,workload") {
    const p=v.preparation as Record<string,unknown>|null;
    if(!p||Object.keys(p).sort().join()!=="audio,descriptor,requestHash,source"||!p.source||typeof p.source!=="object"||Array.isArray(p.source)
      ||typeof p.requestHash!=="string"||!/^[a-f0-9]{64}$/.test(p.requestHash)||!Array.isArray(v.files)||v.files.length>50000)throw new Error("Invalid selected render input");
    const descriptor=decodeProductionExport(p.descriptor),files=v.files.map(renderFile);
    if(v.selectionHash!==descriptor.hash||files.some(file=>!file.path.startsWith("assets/"))||new Set(files.map(f=>f.path)).size!==files.length)throw new Error("Invalid selected render identity");
    return {version:1,workload:"studio-export",selectionHash:descriptor.hash,files,preparation:{descriptor,source:p.source as Record<string,unknown>,audio:p.audio as PublishedAudioTrack|null,requestHash:p.requestHash}};
  }
  if (v.workload === "studio-export" && Object.keys(v).sort().join() === "files,selectionHash,version,workload"
    && typeof v.selectionHash === "string" && /^sha256:[a-f0-9]{64}$/.test(v.selectionHash)
    && Array.isArray(v.files) && v.files.length > 0 && v.files.length <= 50000) {
    const files = v.files.map(renderFile);
    if (new Set(files.map(f => f.path)).size !== files.length || !files.some(f => f.path === "manifest.json")) throw new Error("Bundle requires unique files and a manifest");
    return { version: 1, workload: v.workload, selectionHash: v.selectionHash, files };
  }
  if (v.workload === "trailer" && Object.keys(v).sort().join() === "gameId,renderVersion,version,workload"
    && typeof v.gameId === "string" && /^[a-zA-Z0-9-]{1,200}$/.test(v.gameId)
    && Number.isSafeInteger(v.renderVersion) && Number(v.renderVersion) > 0)
    return { version: 1, workload: v.workload, gameId: v.gameId, renderVersion: Number(v.renderVersion) };
  throw new Error("Invalid render input");
}
