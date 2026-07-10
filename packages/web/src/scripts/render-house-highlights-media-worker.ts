import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseHouseHighlightsTrailerManifest, type HouseHighlightsTrailerManifest } from "@influence/engine";
import {
  HouseHighlightsTrailerMusicUnavailableError,
} from "../lib/house-highlights-trailer-audio";
import {
  renderHouseHighlightsTrailerMediaBundle,
  writeHouseHighlightsTrailerPlaybackMetadata,
  type HouseHighlightsTrailerBundleArtifact,
} from "../lib/house-highlights-trailer-media-bundle";

const POLL_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 60_000;

export interface HouseHighlightsMediaWorkerConfig {
  apiBaseUrl: string;
  workerToken: string;
  pollIntervalMs: number;
}

interface WorkerClaim {
  gameId: string;
  artifactVersion: string;
  attemptNumber: number;
  leaseToken: string;
  manifest: HouseHighlightsTrailerManifest;
  provenance: {
    renderInputSnapshotHash: string;
    renderInputSnapshotVersion: number;
    rendererVersion: string;
    timingContractVersion: string;
    musicAssetId: string;
  };
  publicArtifacts: Array<{
    artifact: "video" | "poster" | "captions" | "metadata";
    objectKey: string;
    publicUrl: string;
    contentType: string;
  }>;
  storage: { provider: string; bucket: string };
}

interface UploadTarget {
  artifact: "video" | "poster" | "captions" | "metadata";
  uploadUrl: string;
  uploadHeaders?: Record<string, string>;
  publicUrl: string;
  objectKey: string;
  contentType: string;
}

export function houseHighlightsMediaWorkerConfig(env: Record<string, string | undefined> = process.env): HouseHighlightsMediaWorkerConfig {
  const apiBaseUrl = env.POSTGAME_MEDIA_API_URL;
  const workerToken = env.POSTGAME_MEDIA_WORKER_TOKEN;
  if (!apiBaseUrl || !workerToken) throw new Error("POSTGAME_MEDIA_API_URL and POSTGAME_MEDIA_WORKER_TOKEN are required.");
  return {
    apiBaseUrl: new URL(apiBaseUrl).toString().replace(/\/$/, ""),
    workerToken,
    pollIntervalMs: positiveInt(env.POSTGAME_MEDIA_POLL_INTERVAL_MS, POLL_INTERVAL_MS),
  };
}

export async function runHouseHighlightsMediaWorkerOnce(config: HouseHighlightsMediaWorkerConfig, fetchImpl: typeof fetch = fetch): Promise<"idle" | "completed" | "waiting_music" | "failed"> {
  const response = await workerRequest<{ claim: WorkerClaim | null }>(config, "/api/internal/postgame-media/claim", { method: "POST" }, fetchImpl);
  if (!response.claim) return "idle";
  const claim = { ...response.claim, manifest: parseHouseHighlightsTrailerManifest(response.claim.manifest) };
  return renderClaim(config, claim, fetchImpl);
}

export async function runHouseHighlightsMediaWorker(config: HouseHighlightsMediaWorkerConfig, fetchImpl: typeof fetch = fetch): Promise<void> {
  for (;;) {
    await runHouseHighlightsMediaWorkerOnce(config, fetchImpl);
    await sleep(config.pollIntervalMs);
  }
}

export async function renderClaim(config: HouseHighlightsMediaWorkerConfig, claim: WorkerClaim, fetchImpl: typeof fetch = fetch): Promise<"completed" | "waiting_music" | "failed"> {
  const workDir = await mkdtemp(join(tmpdir(), "influence-house-highlights-worker-"));
  const heartbeat = startHeartbeat(config, claim, fetchImpl);
  try {
    await progress(config, claim, "rendering", fetchImpl);
    const bundle = await renderHouseHighlightsTrailerMediaBundle({
      manifest: claim.manifest,
      outputDir: workDir,
      onStage: async (stage) => {
        if (stage === "composing") await progress(config, claim, "composing", fetchImpl);
      },
    });
    await progress(config, claim, "uploading", fetchImpl);
    const metadataPath = join(workDir, "metadata.json");
    const metadataArtifact = await writeHouseHighlightsTrailerPlaybackMetadata({
      bundle,
      outputPath: metadataPath,
      renderVersion: claim.artifactVersion,
      urls: {
        videoUrl: publicArtifactFor(claim, "video").publicUrl,
        posterUrl: publicArtifactFor(claim, "poster").publicUrl,
        captionsUrl: publicArtifactFor(claim, "captions").publicUrl,
      },
    });
    const artifacts = [bundle.artifacts.video, bundle.artifacts.poster, bundle.artifacts.captions, metadataArtifact];
    const uploadTargets = await requestUploadTargets(config, claim, artifacts, fetchImpl);
    await Promise.all(artifacts.map(async (artifact) => uploadArtifact(targetFor(uploadTargets, artifact.name), artifact, fetchImpl)));
    await workerRequest(config, `/api/internal/postgame-media/${encodeURIComponent(claim.gameId)}/finalize`, {
      method: "POST",
      body: JSON.stringify({
        attemptNumber: claim.attemptNumber,
        leaseToken: claim.leaseToken,
        renderDurationMs: bundle.durationMs,
        ...claim.provenance,
        artifacts: artifactMetadata(claim, bundle, uploadTargets, metadataArtifact),
        cueMetadata: bundle.timeline,
      }),
    }, fetchImpl);
    return "completed";
  } catch (error) {
    if (error instanceof HouseHighlightsTrailerMusicUnavailableError) {
      await progress(config, claim, "waiting_music", fetchImpl, { category: error.category });
      return "waiting_music";
    }
    await reportFailure(config, claim, categorizedFailure(error), fetchImpl);
    return "failed";
  } finally {
    heartbeat.stop();
    await rm(workDir, { recursive: true, force: true });
  }
}

export function parseHouseHighlightsMediaWorkerArgs(argv: readonly string[]): "poll" | "once" | "smoke" | "health" {
  if (argv.length === 0) return "poll";
  if (argv.length === 1 && ["--once", "--smoke", "--health"].includes(argv[0] ?? "")) {
    return argv[0] === "--once" ? "once" : argv[0] === "--smoke" ? "smoke" : "health";
  }
  throw new Error("Usage: bun run render-house-highlights-media-worker.ts [--once|--smoke|--health]");
}

async function requestUploadTargets(config: HouseHighlightsMediaWorkerConfig, claim: WorkerClaim, artifacts: readonly HouseHighlightsTrailerBundleArtifact[], fetchImpl: typeof fetch): Promise<UploadTarget[]> {
  const response = await workerRequest<{ targets: UploadTarget[] }>(config, `/api/internal/postgame-media/${encodeURIComponent(claim.gameId)}/upload-targets`, {
    method: "POST",
    body: JSON.stringify({
      attemptNumber: claim.attemptNumber,
      leaseToken: claim.leaseToken,
      artifacts: artifacts.map((artifact) => ({ artifact: artifact.name, contentType: artifact.contentType, byteLength: artifact.byteLength, sha256: artifact.sha256 })),
    }),
  }, fetchImpl);
  return response.targets;
}

async function uploadArtifact(target: UploadTarget, artifact: HouseHighlightsTrailerBundleArtifact, fetchImpl: typeof fetch): Promise<void> {
  const response = await fetchImpl(target.uploadUrl, {
    method: "PUT",
    headers: target.uploadHeaders,
    body: Bun.file(artifact.path),
  });
  if (!response.ok) throw new Error(`artifact_upload_${response.status}`);
}

async function progress(config: HouseHighlightsMediaWorkerConfig, claim: WorkerClaim, status: "rendering" | "composing" | "uploading" | "waiting_music", fetchImpl: typeof fetch, diagnostics?: Record<string, string>): Promise<void> {
  await workerRequest(config, `/api/internal/postgame-media/${encodeURIComponent(claim.gameId)}/progress`, {
    method: "POST",
    body: JSON.stringify({ attemptNumber: claim.attemptNumber, leaseToken: claim.leaseToken, status, ...(diagnostics ? { diagnostics } : {}) }),
  }, fetchImpl);
}

function startHeartbeat(config: HouseHighlightsMediaWorkerConfig, claim: WorkerClaim, fetchImpl: typeof fetch): { stop(): void } {
  const interval = setInterval(() => {
    workerRequest(config, `/api/internal/postgame-media/${encodeURIComponent(claim.gameId)}/heartbeat`, {
      method: "POST",
      body: JSON.stringify({ attemptNumber: claim.attemptNumber, leaseToken: claim.leaseToken }),
    }, fetchImpl).catch(() => undefined);
  }, HEARTBEAT_INTERVAL_MS);
  return { stop: () => clearInterval(interval) };
}

async function reportFailure(config: HouseHighlightsMediaWorkerConfig, claim: WorkerClaim, failure: { category: string; message: string }, fetchImpl: typeof fetch): Promise<void> {
  try {
    await workerRequest(config, `/api/internal/postgame-media/${encodeURIComponent(claim.gameId)}/failure`, {
      method: "POST",
      body: JSON.stringify({ attemptNumber: claim.attemptNumber, leaseToken: claim.leaseToken, ...failure }),
    }, fetchImpl);
  } catch {
    // The lease may have expired; never print a response that could contain a token or signed URL.
  }
}

async function workerRequest<T>(config: HouseHighlightsMediaWorkerConfig, path: string, init: RequestInit, fetchImpl: typeof fetch): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${config.workerToken}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetchImpl(`${config.apiBaseUrl}${path}`, { ...init, headers });
  if (!response.ok) throw new Error(`worker_api_${response.status}`);
  return response.json() as Promise<T>;
}

function artifactMetadata(claim: WorkerClaim, bundle: Awaited<ReturnType<typeof renderHouseHighlightsTrailerMediaBundle>>, targets: UploadTarget[], metadataArtifact: HouseHighlightsTrailerBundleArtifact) {
  const video = artifactRecord(targetFor(targets, "video"), bundle.artifacts.video);
  const poster = artifactRecord(targetFor(targets, "poster"), bundle.artifacts.poster);
  const captions = artifactRecord(targetFor(targets, "captions"), bundle.artifacts.captions);
  const metadata = artifactRecord(targetFor(targets, "metadata"), metadataArtifact);
  return {
    preview: { title: "House Highlights", description: "A completed Influence game, told through the House." },
    video: { ...video, width: bundle.dimensions.width, height: bundle.dimensions.height },
    poster: { ...poster, altText: "House Highlights cast roster" },
    captions: { ...captions, language: "en", label: "English" },
    manifest: metadata,
    storage: claim.storage,
  };
}

function artifactRecord(target: UploadTarget, artifact: HouseHighlightsTrailerBundleArtifact) { return { publicUrl: target.publicUrl, objectKey: target.objectKey, contentType: artifact.contentType, byteLength: artifact.byteLength, sha256: artifact.sha256 }; }
function targetFor(targets: readonly UploadTarget[], artifact: string): UploadTarget { const target = targets.find((candidate) => candidate.artifact === artifact); if (!target) throw new Error(`missing_upload_target_${artifact}`); return target; }
function publicArtifactFor(claim: WorkerClaim, artifact: string): WorkerClaim["publicArtifacts"][number] { const target = claim.publicArtifacts.find((candidate) => candidate.artifact === artifact); if (!target) throw new Error(`missing_public_artifact_${artifact}`); return target; }
function categorizedFailure(error: unknown): { category: string; message: string } { const message = error instanceof Error ? error.message : "unknown worker failure"; return { category: message.startsWith("artifact_upload") ? "upload" : message.startsWith("worker_api") ? "api" : "render", message: message.slice(0, 240) }; }
function positiveInt(value: string | undefined, fallback: number): number { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback; }
function sleep(ms: number): Promise<void> { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }

if (import.meta.main) {
  const mode = parseHouseHighlightsMediaWorkerArgs(Bun.argv.slice(2));
  const config = houseHighlightsMediaWorkerConfig();
  const run = mode === "health"
    ? Promise.resolve(console.log("House Highlights media worker configuration is valid."))
    : mode === "poll" ? runHouseHighlightsMediaWorker(config) : runHouseHighlightsMediaWorkerOnce(config).then((result) => console.log(mode === "smoke" ? `Smoke result: ${result}` : result));
  run.catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
}
