import type { ProductionCatalog } from "@influence/engine/production-moments";
import type { PublishedAudioClip } from "@influence/engine/audio-track";
import type { CachedAsset } from "./replay-export/assets";
import type { ExportCue } from "./replay-export/cues";
import { resolveApiUrl, type GameStatus } from "./api";
import { bindInfluenceProductionPresentation, bindWerewolfProductionPresentation } from "./replay-export/production-presentation";
import type { PresentationMoment } from "./replay-export/presentation";
import { loadProductionReplaySource, type ProductionSnapshot, type ProductionAnnotation, type ProductionSourceInput } from "./replay-export/production-source";
export type { ProductionSnapshot } from "./replay-export/production-source";
export type MomentAnnotation = ProductionAnnotation;

export interface ProductionCapabilities {
  visualRead: boolean; sceneRepair: boolean; editorial: boolean; policy: boolean; resume: boolean;
  influenceRecovery: boolean; formRepair: boolean; episodeRead: boolean; episodeEdit: boolean; trailerRead: boolean; trailerRender: boolean;
}
export interface ProductionLibraryGame {
  id: string; slug: string; gameKind: "influence" | "werewolf"; status: GameStatus;
  createdAt: string; hidden: boolean; playerCount: number; title: string | null; namingStatus: string | null;
  needsAttention: boolean; recovery: "influence" | "scene" | "form" | "visual" | null; capabilities: ProductionCapabilities;
}
export interface ProductionLibraryPage { items: ProductionLibraryGame[]; skippedInvalidPauses: number; nextCursor: string | null }
export const productionGameRoot = (gameId: string) => `/api/admin/production/games/${encodeURIComponent(gameId)}`;
export interface LoadedProductionSource {
  snapshot: ProductionSnapshot; status: "completed" | "suspended"; title?: string;
  catalog: ProductionCatalog; presentation: PresentationMoment[]; annotations: MomentAnnotation[];
}

/** Canonical paging and moment binding are shared with the exporter. */
export async function loadProductionStudioSource(read: <T>(url: string, signal: AbortSignal) => Promise<T>, input: ProductionSourceInput & {signal: AbortSignal}): Promise<LoadedProductionSource> {
  const loaded = await loadProductionReplaySource(url => read(url, input.signal), input);
  input.signal.throwIfAborted();
  const presentation = loaded.source.kind === "werewolf"
    ? await bindWerewolfProductionPresentation({source: loaded.source, catalog: loaded.catalog, provenance: loaded.provenance, thoughts: loaded.thoughts})
    : await bindInfluenceProductionPresentation({source: loaded.source, catalog: loaded.catalog, thoughts: loaded.acceptedThoughts});
  input.signal.throwIfAborted();
  return {snapshot: loaded.snapshot, status: loaded.status, title: loaded.title, catalog: loaded.catalog, presentation, annotations: loaded.annotations};
}

/** Only library filters return to the library; no signed media, drafts or arbitrary navigation targets. */
export function productionLibraryFilters(params: URLSearchParams): URLSearchParams {
  const result = new URLSearchParams();
  for (const key of ["kind", "status", "search", "attention"]) {
    const value = params.get(key);
    if (value && value.length <= 200) result.set(key, value);
  }
  return result;
}

/** Protected audio uses the same authenticated reads and source-scoped URL disposal as imagery. */
export async function prepareProductionAudio(clip: PublishedAudioClip, signal: AbortSignal,
  cache: {assets: Map<string, CachedAsset>; urls: Map<string, string>},
  read: (url: string, signal: AbortSignal) => Promise<Blob>): Promise<CachedAsset> {
  signal.throwIfAborted();
  const cached = cache.assets.get(clip.url);
  if (cached) return cached;
  const blob = await read(clip.url, signal);
  const bytes = await blob.arrayBuffer();
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2,"0")).join("");
  signal.throwIfAborted();
  if (sha256 !== clip.sha256) throw new Error("Generated audio failed integrity validation");
  const path = URL.createObjectURL(blob);
  const asset: CachedAsset = {path, sha256, durationMs: clip.durationMs, mediaType: "audio"};
  cache.urls.set(clip.url, path); cache.assets.set(clip.url, asset);
  return asset;
}

/** Preparation is browser-owned metadata only. Playback remains in Remotion. */
export async function prepareProductionAssets(cues: readonly ExportCue[], signal: AbortSignal, cache = new Map<string, CachedAsset>(), privateMedia?: {
  read: (url: string, signal: AbortSignal) => Promise<Blob>; urls: Map<string, string>;
}): Promise<{cues: ExportCue[]; assets: Record<string, CachedAsset>}> {
  const media = new Map<string, "image" | "audio" | "video">();
  const walk = (value: unknown, key = "", parent = ""): unknown => {
    if (typeof value === "string" && (/url$|^src$/i.test(key) || /wolfForms|portraits|fullBodyReferences/.test(parent)) && /^(https?:\/\/|\/)/.test(value)) {
      const url = value.startsWith("/api/") ? resolveApiUrl(value) : value;
      const type = /music|effect/i.test(key) || key === "src" && parent === "music" ? "audio" : /video/i.test(key) ? "video" : "image";
      media.set(url, type); return url;
    }
    if (Array.isArray(value)) return value.map(child => walk(child, key, parent));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, walk(child, name, key)]));
    return value;
  };
  let prepared = walk(cues) as ExportCue[];
  // Recordings have a semantic asset reference rather than a URL-named field.
  for (const cue of prepared) if (cue.timing.recording) {
    const recording = cue.timing.recording;
    const url = recording.assetId.startsWith("/api/") ? resolveApiUrl(recording.assetId) : recording.assetId;
    recording.assetId = url; media.set(url, "audio");
  }
  const entries: [string, CachedAsset][] = [];
  for (const [url, type] of media) {
    signal.throwIfAborted();
    const cached = cache.get(url);
    if (cached) {entries.push([cached.path, cached]); continue;}
    let source = url;
    if (new URL(url, window.location.origin).pathname.startsWith("/api/admin/production/")) {
      if (!privateMedia) throw new Error("Private media requires the administration session");
      source = privateMedia.urls.get(url) ?? "";
      if (!source) {
        const target = new URL(url, window.location.origin);
        const blob = await privateMedia.read(`${target.pathname}${target.search}`, signal); signal.throwIfAborted();
        source = URL.createObjectURL(blob); privateMedia.urls.set(url, source);
      }
    }
    const element = type === "image" ? new Image() : document.createElement(type === "video" ? "video" : "audio");
    if (element instanceof HTMLMediaElement) element.preload = "metadata";
    await new Promise<void>((accept, reject) => {
      const timeout = setTimeout(() => done(new Error(`Media metadata timed out: ${url}`)), 30_000);
      const done = (error?: Error) => {clearTimeout(timeout); signal.removeEventListener("abort", aborted); element.onload = null; element.onerror = null; if (element instanceof HTMLMediaElement) element.onloadedmetadata = null; if (error) {element.removeAttribute("src"); if (element instanceof HTMLMediaElement) element.load(); reject(error);} else accept();};
      const aborted = () => done(new DOMException("Preparation cancelled", "AbortError"));
      signal.addEventListener("abort", aborted, {once: true});
      element.onerror = () => done(new Error(`Media could not load: ${url}`));
      if (element instanceof HTMLImageElement) element.onload = () => done();
      else element.onloadedmetadata = () => done();
      element.src = source;
    });
    signal.throwIfAborted();
    const asset: CachedAsset = {path: source, sha256: "browser-preview", mediaType: type};
    if (element instanceof HTMLImageElement) {asset.width = element.naturalWidth; asset.height = element.naturalHeight;}
    else {
      asset.durationMs = element.duration * 1000;
      if (!Number.isFinite(asset.durationMs) || asset.durationMs <= 0) throw new Error(`Media has no finite duration: ${url}`);
      if (element instanceof HTMLVideoElement) {asset.width = element.videoWidth; asset.height = element.videoHeight;}
      element.removeAttribute("src"); element.load();
    }
    cache.set(url, asset); entries.push([source, asset]);
  }
  const privateUrl = (value: unknown): unknown => typeof value === "string" ? privateMedia?.urls.get(value) ?? value
    : Array.isArray(value) ? value.map(privateUrl) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, privateUrl(child)])) : value;
  prepared = privateUrl(prepared) as ExportCue[];
  return {cues: prepared, assets: Object.fromEntries(entries)};
}
