import { mkdir, mkdtemp, readdir, rm, statfs } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { parseHouseHighlightsTrailerManifest, type HouseHighlightsTrailerManifest } from "@influence/engine";
import {
  HouseHighlightsTrailerMusicUnavailableError,
  selectHouseHighlightsTrailerMusicVariant,
} from "../lib/house-highlights-trailer-audio";
import {
  DEFAULT_HOUSE_HIGHLIGHTS_TRAILER_MUSIC_DIR,
  renderHouseHighlightsTrailerMediaBundle,
  writeHouseHighlightsTrailerPlaybackMetadata,
  type HouseHighlightsTrailerBundleArtifact,
} from "../lib/house-highlights-trailer-media-bundle";

const POLL_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 60_000;
const HTTP_TIMEOUT_MS = 15_000;
export const DEFAULT_HOUSE_HIGHLIGHTS_MEDIA_WORKER_TEMP_DIR = "/tmp/influence-render-worker";
export const MIN_HOUSE_HIGHLIGHTS_MEDIA_WORKER_FREE_BYTES = 2 * 1024 * 1024 * 1024;
const PREPARED_HOUSE_CUT_COUNTS = [0, 1, 2, 3, 4, 5] as const;
const PREPARED_PLAYER_COUNTS = [6, 8, 10, 12] as const;

export interface HouseHighlightsMediaWorkerConfig {
  apiBaseUrl: string;
  workerToken: string;
  pollIntervalMs: number;
  httpTimeoutMs: number;
  temporaryRoot: string;
  minimumFreeBytes: number;
  browserExecutable?: string;
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
    httpTimeoutMs: positiveInt(env.POSTGAME_MEDIA_HTTP_TIMEOUT_MS, HTTP_TIMEOUT_MS),
    temporaryRoot: env.POSTGAME_MEDIA_TEMP_DIR?.trim() || DEFAULT_HOUSE_HIGHLIGHTS_MEDIA_WORKER_TEMP_DIR,
    minimumFreeBytes: positiveInt(env.POSTGAME_MEDIA_MIN_FREE_BYTES, MIN_HOUSE_HIGHLIGHTS_MEDIA_WORKER_FREE_BYTES),
    browserExecutable: env.REMOTION_BROWSER_EXECUTABLE?.trim() || undefined,
  };
}

export async function runHouseHighlightsMediaWorkerOnce(config: HouseHighlightsMediaWorkerConfig, fetchImpl: typeof fetch = fetch): Promise<"idle" | "completed" | "waiting_music" | "failed"> {
  await assertHouseHighlightsMediaWorkerTemporarySpace(config.temporaryRoot, config.minimumFreeBytes);
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

export function assertHouseHighlightsMediaWorkerSmokeResult(result: "idle" | "completed" | "waiting_music" | "failed"): void {
  if (result !== "completed") throw new Error(`Smoke requires a queued completed-game render job; received ${result}.`);
}

export async function renderClaim(config: HouseHighlightsMediaWorkerConfig, claim: WorkerClaim, fetchImpl: typeof fetch = fetch): Promise<"completed" | "waiting_music" | "failed"> {
  const workDir = await mkdtemp(join(config.temporaryRoot, "claim-"));
  const heartbeat = startHeartbeat(config, claim, fetchImpl);
  try {
    await progress(config, claim, "rendering", fetchImpl);
    const bundle = await renderHouseHighlightsTrailerMediaBundle({
      manifest: claim.manifest,
      outputDir: workDir,
      temporaryRoot: workDir,
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
    await Promise.all(artifacts.map(async (artifact) => uploadArtifact(config, targetFor(uploadTargets, artifact.name), artifact, fetchImpl)));
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

export interface HouseHighlightsMediaWorkerHealthDependencies {
  fetchImpl?: typeof fetch;
  runCommand?: (command: string, args: readonly string[]) => Promise<void>;
  verifyMusic?: () => Promise<void>;
  verifyTemporarySpace?: (temporaryRoot: string, minimumFreeBytes: number) => Promise<void>;
}

export async function checkHouseHighlightsMediaWorkerHealth(
  config: HouseHighlightsMediaWorkerConfig,
  dependencies: HouseHighlightsMediaWorkerHealthDependencies = {},
): Promise<void> {
  if (!config.browserExecutable) throw new Error("REMOTION_BROWSER_EXECUTABLE is required for worker health checks.");
  const runCommand = dependencies.runCommand ?? runCommandQuietly;
  await runCommand("ffmpeg", ["-version"]);
  await runCommand(config.browserExecutable, ["--version"]);
  await (dependencies.verifyMusic ?? assertPreparedHouseHighlightsTrailerMusicMatrix)();
  await (dependencies.verifyTemporarySpace ?? assertHouseHighlightsMediaWorkerTemporarySpace)(config.temporaryRoot, config.minimumFreeBytes);
  const response = await fetchWithTimeout(
    dependencies.fetchImpl ?? fetch,
    `${config.apiBaseUrl}/api/health`,
    undefined,
    config.httpTimeoutMs,
    "worker_health_api",
  );
  if (!response.ok) throw new Error(`worker_health_api_${response.status}`);
  const body = await response.json().catch(() => null) as { status?: unknown } | null;
  if (body?.status !== "ok") throw new Error("worker_health_api_invalid_response");
}

export async function assertPreparedHouseHighlightsTrailerMusicMatrix(): Promise<void> {
  const filenames = await readdir(DEFAULT_HOUSE_HIGHLIGHTS_TRAILER_MUSIC_DIR);
  const prepared = filenames.filter((filename) => filename.endsWith(".m4a"));
  const expectedCount = PREPARED_HOUSE_CUT_COUNTS.length * PREPARED_PLAYER_COUNTS.length;
  if (prepared.length !== expectedCount) {
    throw new Error(`worker_music_matrix_expected_${expectedCount}_found_${prepared.length}`);
  }
  for (const houseCuts of PREPARED_HOUSE_CUT_COUNTS) {
    for (const players of PREPARED_PLAYER_COUNTS) {
      selectHouseHighlightsTrailerMusicVariant({ houseCuts, players, trailerDurationSeconds: 1 }, prepared, DEFAULT_HOUSE_HIGHLIGHTS_TRAILER_MUSIC_DIR);
    }
  }
}

export async function assertHouseHighlightsMediaWorkerTemporarySpace(temporaryRoot: string, minimumFreeBytes = MIN_HOUSE_HIGHLIGHTS_MEDIA_WORKER_FREE_BYTES): Promise<void> {
  await mkdir(temporaryRoot, { recursive: true });
  const filesystem = await statfs(temporaryRoot);
  const availableBytes = filesystem.bavail * filesystem.bsize;
  if (availableBytes < minimumFreeBytes) {
    throw new Error(`worker_temp_space_low_${availableBytes}`);
  }
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

async function uploadArtifact(config: HouseHighlightsMediaWorkerConfig, target: UploadTarget, artifact: HouseHighlightsTrailerBundleArtifact, fetchImpl: typeof fetch): Promise<void> {
  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, target.uploadUrl, {
      method: "PUT",
      headers: target.uploadHeaders,
      body: Bun.file(artifact.path),
    }, config.httpTimeoutMs, "artifact_upload");
  } catch {
    throw new Error("artifact_upload_request_failed");
  }
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
  const response = await fetchWithTimeout(fetchImpl, `${config.apiBaseUrl}${path}`, { ...init, headers }, config.httpTimeoutMs, "worker_api");
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
function runCommandQuietly(command: string, args: readonly string[]): Promise<void> { return new Promise((resolvePromise, reject) => { const child = spawn(command, args, { stdio: "ignore" }); child.on("error", (error) => reject(new Error(`${command} failed to start: ${error.message}`))); child.on("close", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with code ${code}`))); }); }
async function fetchWithTimeout(fetchImpl: typeof fetch, input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number, errorPrefix: string): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal });
  } catch {
    throw new Error(`${errorPrefix}_${signal.aborted ? "timeout" : "request_failed"}`);
  }
}

if (import.meta.main) {
  const mode = parseHouseHighlightsMediaWorkerArgs(Bun.argv.slice(2));
  const config = houseHighlightsMediaWorkerConfig();
  const run = mode === "health"
    ? checkHouseHighlightsMediaWorkerHealth(config).then(() => console.log("House Highlights media worker health check passed."))
    : mode === "poll" ? runHouseHighlightsMediaWorker(config) : runHouseHighlightsMediaWorkerOnce(config).then((result) => {
      if (mode === "smoke") assertHouseHighlightsMediaWorkerSmokeResult(result);
      console.log(mode === "smoke" ? "Smoke render completed." : result);
    });
  run.catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
}
