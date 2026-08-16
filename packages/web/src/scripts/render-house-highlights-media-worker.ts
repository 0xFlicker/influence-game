import { mkdir, mkdtemp, readdir, rename, rm, statfs, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { parseHouseHighlightsTrailerManifest, type HouseHighlightsTrailerManifest } from "@influence/engine";
import {
  HouseHighlightsTrailerMusicUnavailableError,
  selectHouseHighlightsTrailerMusicVariant,
} from "../lib/house-highlights-trailer-audio";
import {
  DEFAULT_HOUSE_HIGHLIGHTS_TRAILER_MUSIC_DIR,
  remotionMediaOptions,
  renderHouseHighlightsTrailerMediaBundle,
  writeHouseHighlightsTrailerPlaybackMetadata,
  type HouseHighlightsTrailerBundleArtifact,
  type HouseHighlightsRemotionMediaOptions,
} from "../lib/house-highlights-trailer-media-bundle";

const POLL_INTERVAL_MS = 5_000;
const MAX_HEARTBEAT_INTERVAL_MS = 60_000;
const HTTP_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;
const MAX_POLL_BACKOFF_MS = 60_000;
export const DEFAULT_HOUSE_HIGHLIGHTS_MEDIA_WORKER_TEMP_DIR = "/tmp/influence-render-worker";
export const MIN_HOUSE_HIGHLIGHTS_MEDIA_WORKER_FREE_BYTES = 2 * 1024 * 1024 * 1024;
const PREPARED_HOUSE_CUT_COUNTS = [0, 1, 2, 3, 4, 5] as const;
const PREPARED_PLAYER_COUNTS = [6, 8, 10, 12] as const;

export interface HouseHighlightsMediaWorkerConfig {
  apiBaseUrl: string;
  workerToken: string;
  pollIntervalMs: number;
  httpTimeoutMs: number;
  uploadTimeoutMs: number;
  temporaryRoot: string;
  minimumFreeBytes: number;
  remotionOptions: HouseHighlightsRemotionMediaOptions;
}

export type HouseHighlightsMediaWorkerStartupMode = "active" | "standby";

export function readHouseHighlightsMediaWorkerStartupMode(
  env: Record<string, string | undefined> = process.env,
): HouseHighlightsMediaWorkerStartupMode {
  const mode = env.POSTGAME_MEDIA_STARTUP_MODE ?? "active";
  if (mode === "active" || mode === "standby") return mode;
  throw new Error("POSTGAME_MEDIA_STARTUP_MODE must be active or standby");
}

interface WorkerClaim {
  gameId: string;
  artifactVersion: string;
  attemptNumber: number;
  leaseToken: string;
  leaseExpiresAt: string;
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

export interface HouseHighlightsMediaWorkerDrainAcknowledgement {
  schemaVersion: 2;
  workerInstanceId: string;
  claimDisabled: true;
  claimInFlight: boolean;
  signal: "SIGINT" | "SIGTERM";
  acknowledgedAt: string;
}

export class HouseHighlightsMediaWorkerDrainController {
  private disabled = false;
  private claimInFlight = false;
  private readonly drainAbortController = new AbortController();
  private pollWaiters = 0;
  private acknowledgementPromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly onAcknowledge: (acknowledgement: HouseHighlightsMediaWorkerDrainAcknowledgement) => void | Promise<void> = () => undefined,
    private readonly workerInstanceId = randomUUID(),
  ) {}

  get claimDisabled(): boolean {
    return this.disabled;
  }

  get pendingPollWaiterCount(): number {
    return this.pollWaiters;
  }

  setClaimInFlight(value: boolean): void {
    this.claimInFlight = value;
  }

  requestDrain(signal: "SIGINT" | "SIGTERM", now = new Date()): void {
    if (this.disabled) return;
    this.disabled = true;
    this.drainAbortController.abort();
    this.acknowledgementPromise = Promise.resolve(this.onAcknowledge({
      schemaVersion: 2,
      workerInstanceId: this.workerInstanceId,
      claimDisabled: true,
      claimInFlight: this.claimInFlight,
      signal,
      acknowledgedAt: now.toISOString(),
    })).catch(() => undefined);
  }

  waitForAcknowledgement(): Promise<void> {
    return this.acknowledgementPromise;
  }

  async waitForPollDelay(ms: number, sleepImpl?: (ms: number) => Promise<void>): Promise<void> {
    if (this.disabled) return;
    const signal = this.drainAbortController.signal;
    let resolveDrain!: () => void;
    const drain = new Promise<void>((resolve) => { resolveDrain = resolve; });
    const onAbort = () => resolveDrain();
    this.pollWaiters += 1;
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      if (sleepImpl) {
        await Promise.race([sleepImpl(ms), drain]);
      } else {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); }),
            drain,
          ]);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      this.pollWaiters -= 1;
    }
  }
}

export function houseHighlightsMediaWorkerConfig(env: Record<string, string | undefined> = process.env): HouseHighlightsMediaWorkerConfig {
  const apiBaseUrl = env.POSTGAME_MEDIA_API_URL;
  const workerToken = env.POSTGAME_MEDIA_WORKER_TOKEN;
  if (!apiBaseUrl || !workerToken) throw new Error("POSTGAME_MEDIA_API_URL and POSTGAME_MEDIA_WORKER_TOKEN are required.");
  const renderOptions = remotionMediaOptions(env);
  return {
    apiBaseUrl: new URL(apiBaseUrl).toString().replace(/\/$/, ""),
    workerToken,
    pollIntervalMs: positiveInt(env.POSTGAME_MEDIA_POLL_INTERVAL_MS, POLL_INTERVAL_MS),
    httpTimeoutMs: positiveInt(env.POSTGAME_MEDIA_HTTP_TIMEOUT_MS, HTTP_TIMEOUT_MS),
    uploadTimeoutMs: positiveInt(env.POSTGAME_MEDIA_UPLOAD_TIMEOUT_MS, UPLOAD_TIMEOUT_MS),
    temporaryRoot: env.POSTGAME_MEDIA_TEMP_DIR?.trim() || DEFAULT_HOUSE_HIGHLIGHTS_MEDIA_WORKER_TEMP_DIR,
    minimumFreeBytes: positiveInt(env.POSTGAME_MEDIA_MIN_FREE_BYTES, MIN_HOUSE_HIGHLIGHTS_MEDIA_WORKER_FREE_BYTES),
    remotionOptions: renderOptions,
  };
}

export async function runHouseHighlightsMediaWorkerOnce(config: HouseHighlightsMediaWorkerConfig, fetchImpl: typeof fetch = fetch): Promise<"idle" | "completed" | "waiting_music" | "failed"> {
  await assertHouseHighlightsMediaWorkerTemporarySpace(config.temporaryRoot, config.minimumFreeBytes);
  const response = await workerRequest<{ claim: WorkerClaim | null }>(config, "/api/internal/postgame-media/claim", { method: "POST" }, fetchImpl);
  if (!response.claim) return "idle";
  const claim = { ...response.claim, manifest: parseHouseHighlightsTrailerManifest(response.claim.manifest) };
  return renderClaim(config, claim, fetchImpl);
}

export interface HouseHighlightsMediaWorkerLoopOptions {
  maxIterations?: number;
  sleepImpl?: (ms: number) => Promise<void>;
  random?: () => number;
  onError?: (code: string) => void;
  drainController?: HouseHighlightsMediaWorkerDrainController;
  runOnceImpl?: () => Promise<"idle" | "completed" | "waiting_music" | "failed">;
}

export async function runHouseHighlightsMediaWorker(
  config: HouseHighlightsMediaWorkerConfig,
  fetchImpl: typeof fetch = fetch,
  options: HouseHighlightsMediaWorkerLoopOptions = {},
): Promise<void> {
  const maxIterations = options.maxIterations ?? Number.POSITIVE_INFINITY;
  const random = options.random ?? Math.random;
  const onError = options.onError ?? ((code) => console.error(`[postgame-media-worker] ${code}`));
  const drainController = options.drainController ?? new HouseHighlightsMediaWorkerDrainController();
  const runOnce = options.runOnceImpl ?? (() => runHouseHighlightsMediaWorkerOnce(config, fetchImpl));
  let consecutiveFailures = 0;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (drainController.claimDisabled) break;
    let delayMs = config.pollIntervalMs;
    drainController.setClaimInFlight(true);
    try {
      await runOnce();
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      onError(safePollFailureCode(error));
      const baseDelay = Math.min(MAX_POLL_BACKOFF_MS, config.pollIntervalMs * 2 ** Math.min(consecutiveFailures - 1, 6));
      delayMs = Math.min(MAX_POLL_BACKOFF_MS, baseDelay + Math.floor(baseDelay * 0.2 * random()));
    } finally {
      drainController.setClaimInFlight(false);
    }
    if (drainController.claimDisabled) break;
    if (iteration + 1 < maxIterations) await drainController.waitForPollDelay(delayMs, options.sleepImpl);
  }
  await drainController.waitForAcknowledgement();
}

export async function writeHouseHighlightsMediaWorkerDrainAcknowledgement(
  file: string,
  acknowledgement: HouseHighlightsMediaWorkerDrainAcknowledgement,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(acknowledgement)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

export async function initializeHouseHighlightsMediaWorkerControl(
  acknowledgementFile: string,
  workerInstanceId: string,
  now = new Date(),
): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(workerInstanceId)) throw new Error("worker instance ID must be a UUID");
  const controlDir = dirname(acknowledgementFile);
  const identityFile = join(controlDir, "worker-instance.json");
  await mkdir(controlDir, { recursive: true });
  await rm(acknowledgementFile, { force: true });
  const temporary = `${identityFile}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({
    schemaVersion: 1,
    workerInstanceId,
    startedAt: now.toISOString(),
  })}\n`, { mode: 0o600 });
  await rename(temporary, identityFile);
  return identityFile;
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
      manifest: withWorkerReachableAssetUrls(claim.manifest, config.apiBaseUrl),
      outputDir: workDir,
      temporaryRoot: workDir,
      remotionOptions: config.remotionOptions,
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
      await progress(config, claim, "waiting_music", fetchImpl, {
        category: error.category,
        message: error.message,
        requestedHouseCuts: String(error.request.houseCuts),
        requestedPlayers: String(error.request.players),
      });
      return "waiting_music";
    }
    await reportFailure(config, claim, categorizedFailure(error), fetchImpl);
    return "failed";
  } finally {
    heartbeat.stop();
    await rm(workDir, { recursive: true, force: true });
  }
}

export function withWorkerReachableAssetUrls(
  manifest: HouseHighlightsTrailerManifest,
  apiBaseUrl: string,
): HouseHighlightsTrailerManifest {
  const reachableHost = new URL(apiBaseUrl).hostname;
  const rewriteLoopbackHosts = !isLoopbackHost(reachableHost);

  const agent = (value: HouseHighlightsTrailerManifest["cast"][number]) => ({
    ...value,
    avatarUrl: rewriteWorkerAssetUrl(value.avatarUrl, apiBaseUrl, reachableHost, rewriteLoopbackHosts),
  });
  return {
    ...manifest,
    cast: manifest.cast.map(agent),
    scenelets: manifest.scenelets.map((scenelet) => ({
      ...scenelet,
      primaryAgents: scenelet.primaryAgents.map(agent),
      secondaryAgents: scenelet.secondaryAgents.map(agent),
    })),
    finalVote: {
      ...manifest.finalVote,
      finalists: manifest.finalVote.finalists.map(agent),
      groups: manifest.finalVote.groups.map((group) => ({
        ...group,
        finalist: agent(group.finalist),
        jurors: group.jurors.map(agent),
      })),
      winner: agent(manifest.finalVote.winner),
    },
    playerResults: manifest.playerResults.map((result) => ({
      ...result,
      agent: agent(result.agent),
    })),
  };
}

function rewriteWorkerAssetUrl(value: string, apiBaseUrl: string, reachableHost: string, rewriteLoopbackHosts: boolean): string {
  if (value.startsWith("/api/")) return new URL(value, apiBaseUrl).toString();
  try {
    const url = new URL(value);
    if (!rewriteLoopbackHosts || !isLoopbackHost(url.hostname)) return value;
    url.hostname = reachableHost;
    return url.toString();
  } catch {
    return value;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
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
  const browserExecutable = config.remotionOptions.browserExecutable;
  if (!browserExecutable) throw new Error("REMOTION_BROWSER_EXECUTABLE is required for worker health checks.");
  const runCommand = dependencies.runCommand ?? runCommandQuietly;
  await runCommand("ffmpeg", ["-version"]);
  await runCommand(browserExecutable, ["--version"]);
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

export async function assertPreparedHouseHighlightsTrailerMusicMatrix(
  musicDir = DEFAULT_HOUSE_HIGHLIGHTS_TRAILER_MUSIC_DIR,
): Promise<void> {
  const filenames = await readdir(musicDir);
  const prepared = filenames.filter((filename) => filename.endsWith(".m4a"));
  for (const houseCuts of PREPARED_HOUSE_CUT_COUNTS) {
    for (const players of PREPARED_PLAYER_COUNTS) {
      selectHouseHighlightsTrailerMusicVariant({ houseCuts, players, trailerDurationSeconds: 1 }, prepared, musicDir);
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
    }, config.uploadTimeoutMs, "artifact_upload");
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
  }, heartbeatIntervalForLease(claim.leaseExpiresAt));
  return { stop: () => clearInterval(interval) };
}

export function heartbeatIntervalForLease(leaseExpiresAt: string, nowMs = Date.now()): number {
  const remainingMs = new Date(leaseExpiresAt).getTime() - nowMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 1_000;
  return Math.max(1_000, Math.min(MAX_HEARTBEAT_INTERVAL_MS, Math.floor(remainingMs / 3)));
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
function safePollFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown";
  if (/^(?:worker_api|worker_temp_space_low_)[a-z0-9_]+$/i.test(message)) return `poll_failed:${message}`;
  return "poll_failed:unexpected";
}
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
  const drainAcknowledgementFile = process.env.POSTGAME_MEDIA_DRAIN_ACK_FILE;
  const run = async () => {
    if (mode === "health") {
      await checkHouseHighlightsMediaWorkerHealth(config);
      console.log("House Highlights media worker health check passed.");
      return;
    }
    if (mode === "poll") {
      if (!drainAcknowledgementFile) throw new Error("POSTGAME_MEDIA_DRAIN_ACK_FILE is required in poll mode");
      const startupMode = readHouseHighlightsMediaWorkerStartupMode();
      const workerInstanceId = randomUUID();
      await initializeHouseHighlightsMediaWorkerControl(drainAcknowledgementFile, workerInstanceId);
      const drainController = new HouseHighlightsMediaWorkerDrainController(
        (acknowledgement) => writeHouseHighlightsMediaWorkerDrainAcknowledgement(
          drainAcknowledgementFile,
          acknowledgement,
        ),
        workerInstanceId,
      );
      process.on("SIGTERM", () => { drainController.requestDrain("SIGTERM"); });
      process.on("SIGINT", () => { drainController.requestDrain("SIGINT"); });
      if (startupMode === "standby") {
        while (!drainController.claimDisabled) await drainController.waitForPollDelay(config.pollIntervalMs);
        await drainController.waitForAcknowledgement();
      } else {
        await runHouseHighlightsMediaWorker(config, fetch, { drainController });
      }
      return;
    }
    const result = await runHouseHighlightsMediaWorkerOnce(config);
    if (mode === "smoke") assertHouseHighlightsMediaWorkerSmokeResult(result);
    console.log(mode === "smoke" ? "Smoke render completed." : result);
  };
  run().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
}
