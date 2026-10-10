import { renderExecutionConfig, type RenderExecution } from "@influence/engine/render-execution-config";
import { mkdir, mkdtemp, readdir, rename, rm, statfs, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { parseHouseHighlightsTrailerManifest, type HouseHighlightsTrailerManifest } from "@influence/engine";
import {
  HouseHighlightsTrailerMusicUnavailableError,
  selectHouseHighlightsTrailerMusicVariant,
  selectWerewolfTrailerMusic,
} from "../lib/house-highlights-trailer-audio";
import {
  DEFAULT_HOUSE_HIGHLIGHTS_TRAILER_MUSIC_DIR,
  DEFAULT_WEREWOLF_TRAILER_MUSIC_DIR,
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
  httpProxy?: string;
  workerToken: string;
  pollIntervalMs: number;
  httpTimeoutMs: number;
  uploadTimeoutMs: number;
  temporaryRoot: string;
  minimumFreeBytes: number;
  remotionOptions: HouseHighlightsRemotionMediaOptions;
  executionMode: "local" | "remote";
  remote?: {
    generation: string;
    digest: string;
    instanceId: string;
    maxJobs: number;
    quietIntervalMs: number;
  };
}

export type HouseHighlightsMediaWorkerResult = "idle" | "completed" | "waiting_music" | "failed" | "drained";

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
    private readonly workerInstanceId: string = randomUUID(),
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

export function houseHighlightsMediaWorkerConfig(env: Record<string, string | undefined> = process.env, execution: RenderExecution = renderExecutionConfig(env)): HouseHighlightsMediaWorkerConfig {
  const apiBaseUrl = env.POSTGAME_MEDIA_API_URL;
  const workerToken = env.POSTGAME_MEDIA_WORKER_TOKEN;
  if (!apiBaseUrl || !workerToken) throw new Error("POSTGAME_MEDIA_API_URL and POSTGAME_MEDIA_WORKER_TOKEN are required.");
  const executionMode = execution.mode;
  const apiUrl = new URL(apiBaseUrl);
  if (executionMode === "remote" && (apiUrl.protocol !== "https:" || apiUrl.username || apiUrl.password)) {
    throw new Error("POSTGAME_MEDIA_API_URL must use HTTPS without URL credentials in remote mode");
  }
  const remote = executionMode === "remote" ? {
    generation: requiredIdentity(env.POSTGAME_MEDIA_RENDER_GENERATION, "POSTGAME_MEDIA_RENDER_GENERATION"),
    digest: requiredIdentity(env.POSTGAME_MEDIA_WORKER_DIGEST, "POSTGAME_MEDIA_WORKER_DIGEST"),
    instanceId: requiredIdentity(env.POSTGAME_MEDIA_WORKER_INSTANCE_ID, "POSTGAME_MEDIA_WORKER_INSTANCE_ID"),
    maxJobs: boundedInt(env.POSTGAME_MEDIA_MAX_JOBS, 4, 1, 100, "POSTGAME_MEDIA_MAX_JOBS"),
    quietIntervalMs: boundedInt(env.POSTGAME_MEDIA_QUIET_INTERVAL_MS, 30_000, 1_000, 120_000, "POSTGAME_MEDIA_QUIET_INTERVAL_MS"),
  } : undefined;
  let httpProxy: string | undefined;
  if (executionMode === "remote" && execution.network === "tailnet") {
    if (apiUrl.origin !== execution.apiOrigin || apiUrl.pathname !== "/" || apiUrl.search || apiUrl.hash) throw new Error("Worker API must match the release canonical tailnet HTTPS origin");
    httpProxy = env.POSTGAME_MEDIA_HTTP_PROXY;
    if (httpProxy !== "http://127.0.0.1:1055") throw new Error("Tailnet worker requires POSTGAME_MEDIA_HTTP_PROXY=http://127.0.0.1:1055");
  } else if (env.POSTGAME_MEDIA_HTTP_PROXY) throw new Error("HTTP proxy is only permitted for release-configured remote tailnet rendering");
  const renderOptions = remotionMediaOptions(httpProxy ? { ...env, REMOTION_BROWSER_EXECUTABLE: "/usr/local/bin/chromium-tailnet" } : env);
  return {
    ...(httpProxy ? { httpProxy } : {}),
    apiBaseUrl: apiUrl.toString().replace(/\/$/, ""),
    workerToken,
    pollIntervalMs: positiveInt(env.POSTGAME_MEDIA_POLL_INTERVAL_MS, POLL_INTERVAL_MS),
    httpTimeoutMs: positiveInt(env.POSTGAME_MEDIA_HTTP_TIMEOUT_MS, HTTP_TIMEOUT_MS),
    uploadTimeoutMs: positiveInt(env.POSTGAME_MEDIA_UPLOAD_TIMEOUT_MS, UPLOAD_TIMEOUT_MS),
    temporaryRoot: env.POSTGAME_MEDIA_TEMP_DIR?.trim() || DEFAULT_HOUSE_HIGHLIGHTS_MEDIA_WORKER_TEMP_DIR,
    minimumFreeBytes: positiveInt(env.POSTGAME_MEDIA_MIN_FREE_BYTES, MIN_HOUSE_HIGHLIGHTS_MEDIA_WORKER_FREE_BYTES),
    remotionOptions: renderOptions,
    executionMode,
    ...(remote ? { remote } : {}),
  };
}

export async function readHouseHighlightsMediaWorkerAdmission(config: HouseHighlightsMediaWorkerConfig, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (config.executionMode === "local") return true;
  if (!config.remote) throw new Error("worker_remote_identity_required");
  const control = await workerRequest<unknown>(config, "/api/internal/postgame-media/control", { method: "POST" }, fetchImpl);
  if (typeof control !== "object" || control === null || !("admitted" in control) || !("generation" in control) || !("draining" in control)
    || typeof control.admitted !== "boolean" || typeof control.draining !== "boolean"
    || !(typeof control.generation === "string" || (control.generation === null && !control.admitted))) {
    throw new Error("worker_api_invalid_control");
  }
  return control.admitted && !control.draining && control.generation === config.remote.generation;
}

export async function runHouseHighlightsMediaWorkerOnce(config: HouseHighlightsMediaWorkerConfig, fetchImpl: typeof fetch = fetch): Promise<HouseHighlightsMediaWorkerResult> {
  if (!await readHouseHighlightsMediaWorkerAdmission(config, fetchImpl)) return "drained";
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
  runOnceImpl?: () => Promise<unknown>;
  nowImpl?: () => number;
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
  const now = options.nowImpl ?? (() => performance.now());
  const remote = config.executionMode === "remote" ? config.remote : undefined;
  if (config.executionMode === "remote" && !remote) throw new Error("worker_remote_identity_required");
  let consecutiveFailures = 0;
  let jobs = 0;
  let quietSince: number | undefined;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    if (drainController.claimDisabled) break;
    let delayMs = config.pollIntervalMs;
    // The isolated child checks again immediately before its claim. The parent
    // also checks before launching that child, so drain prevents new attempts.
    if (remote && options.runOnceImpl && !await readHouseHighlightsMediaWorkerAdmission(config, fetchImpl)) break;
    drainController.setClaimInFlight(true);
    try {
      const result = await runOnce();
      if (remote) {
        if (!isWorkerResult(result)) throw new Error("worker_remote_attempt_result_missing");
        if (result === "drained") break;
        if (result === "idle") {
          quietSince ??= now();
          const remainingQuietMs = remote.quietIntervalMs - (now() - quietSince);
          if (remainingQuietMs <= 0) break;
          delayMs = Math.min(delayMs, remainingQuietMs);
        } else {
          quietSince = undefined;
          jobs += 1;
          if (jobs >= remote.maxJobs) break;
          // Drain serial work promptly; the API remains the job authority.
          delayMs = 0;
        }
      }
      consecutiveFailures = 0;
    } catch (error) {
      // Remote launch reconciliation owns recovery. Never fall back to an
      // indefinitely polling local worker after auth, control or claim errors.
      if (remote) throw error;
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

/**
 * Keep Remotion's process-wide signal handlers outside the polling parent.
 * The parent drains admission while the child finishes its one claimed job.
 */
export async function runHouseHighlightsMediaWorkerAttempt(
  scriptPath = import.meta.path,
): Promise<HouseHighlightsMediaWorkerResult | undefined> {
  let result: HouseHighlightsMediaWorkerResult | undefined;
  const child = spawn(process.execPath, [scriptPath, "--once"], {
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });
  child.on("message", (message: unknown) => {
    if (typeof message !== "object" || message === null || !("type" in message) || !("result" in message)) return;
    if (message.type === "postgame-media-result" && isWorkerResult(message.result)) result = message.result;
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`render_attempt_exit_${signal ?? code}`));
    });
  });
  return result;
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

export function assertHouseHighlightsMediaWorkerSmokeResult(result: HouseHighlightsMediaWorkerResult): void {
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
    avatarUrl: rewriteWorkerAssetUrl(value.avatarUrl, apiBaseUrl, rewriteLoopbackHosts),
  });
  if (manifest.kind === "werewolf") return { ...manifest, cast: manifest.cast.map(agent) };
  return {
    ...manifest,
    cast: manifest.cast.map(agent),
    scenelets: manifest.scenelets.map((scenelet) => ({
      ...scenelet,
      backgroundImage: rewriteWorkerAssetUrl(scenelet.backgroundImage, apiBaseUrl, rewriteLoopbackHosts),
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

function rewriteWorkerAssetUrl(value: string, apiBaseUrl: string, rewriteLoopbackHosts: boolean): string {
  if (value.startsWith("/api/")) return new URL(value, apiBaseUrl).toString();
  try {
    const url = new URL(value);
    if (!rewriteLoopbackHosts || !isLoopbackHost(url.hostname) || !url.pathname.startsWith("/api/")) return value;
    return new URL(`${url.pathname}${url.search}${url.hash}`, new URL(apiBaseUrl).origin).toString();
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
  await (dependencies.verifyMusic ?? assertPreparedTrailerMusic)();
  await (dependencies.verifyTemporarySpace ?? assertHouseHighlightsMediaWorkerTemporarySpace)(config.temporaryRoot, config.minimumFreeBytes);
  const response = await fetchWithTimeout(
    dependencies.fetchImpl ?? fetch,
    `${config.apiBaseUrl}/api/health`,
    undefined,
    config.httpTimeoutMs,
    "worker_health_api",
    config.httpProxy,
  );
  if (!response.ok) throw new Error(`worker_health_api_${response.status}`);
  const body = await response.json().catch(() => null) as { status?: unknown } | null;
  if (body?.status !== "ok") throw new Error("worker_health_api_invalid_response");
}

export async function assertPreparedTrailerMusic() {
  await assertPreparedHouseHighlightsTrailerMusicMatrix();
  await selectWerewolfTrailerMusic(9, DEFAULT_WEREWOLF_TRAILER_MUSIC_DIR);
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
    }, config.uploadTimeoutMs, "artifact_upload", config.httpProxy);
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
  if (config.executionMode === "remote") {
    if (!config.remote) throw new Error("worker_remote_identity_required");
    headers.set("x-render-generation", config.remote.generation);
    headers.set("x-render-worker-digest", config.remote.digest);
    headers.set("x-render-worker-instance", config.remote.instanceId);
  }
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetchWithTimeout(fetchImpl, `${config.apiBaseUrl}${path}`, { ...init, headers }, config.httpTimeoutMs, "worker_api", config.httpProxy);
  if (!response.ok) throw new Error(`worker_api_${response.status}`);
  return response.json() as Promise<T>;
}

function artifactMetadata(claim: WorkerClaim, bundle: Awaited<ReturnType<typeof renderHouseHighlightsTrailerMediaBundle>>, targets: UploadTarget[], metadataArtifact: HouseHighlightsTrailerBundleArtifact) {
  const video = artifactRecord(targetFor(targets, "video"), bundle.artifacts.video);
  const poster = artifactRecord(targetFor(targets, "poster"), bundle.artifacts.poster);
  const captions = artifactRecord(targetFor(targets, "captions"), bundle.artifacts.captions);
  const metadata = artifactRecord(targetFor(targets, "metadata"), metadataArtifact);
  return {
    preview: claim.manifest.kind === "werewolf" ? { title: claim.manifest.story.title, description: claim.manifest.story.description } : { title: "House Highlights", description: "A completed Influence game, told through the House." },
    video: { ...video, width: bundle.dimensions.width, height: bundle.dimensions.height },
    poster: { ...poster, altText: claim.manifest.kind === "werewolf" ? "The Werewolf cast at The House" : "House Highlights cast roster" },
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
function requiredIdentity(value: string | undefined, name: string): string {
  if (!value?.trim() || value !== value.trim() || /[\r\n]/.test(value)) throw new Error(`${name} is required and must be a single header value in remote mode`);
  return value;
}
function boundedInt(value: string | undefined, fallback: number, minimum: number, maximum: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  return parsed;
}
function isWorkerResult(value: unknown): value is HouseHighlightsMediaWorkerResult {
  return value === "idle" || value === "completed" || value === "waiting_music" || value === "failed" || value === "drained";
}
function safePollFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown";
  if (/^(?:worker_api|worker_temp_space_low_)[a-z0-9_]+$/i.test(message)) return `poll_failed:${message}`;
  return "poll_failed:unexpected";
}
function runCommandQuietly(command: string, args: readonly string[]): Promise<void> { return new Promise((resolvePromise, reject) => { const child = spawn(command, args, { stdio: "ignore" }); child.on("error", (error) => reject(new Error(`${command} failed to start: ${error.message}`))); child.on("close", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with code ${code}`))); }); }
async function fetchWithTimeout(fetchImpl: typeof fetch, input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number, errorPrefix: string, proxy?: string): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal, redirect: "error", ...(proxy ? { proxy } : {}) });
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
      if (config.executionMode === "local" && !drainAcknowledgementFile) throw new Error("POSTGAME_MEDIA_DRAIN_ACK_FILE is required in local poll mode");
      const startupMode = readHouseHighlightsMediaWorkerStartupMode();
      if (config.executionMode === "remote" && startupMode !== "active") throw new Error("remote workers require active startup mode");
      const workerInstanceId = config.remote?.instanceId ?? randomUUID();
      if (drainAcknowledgementFile) await initializeHouseHighlightsMediaWorkerControl(drainAcknowledgementFile, workerInstanceId);
      const drainController = new HouseHighlightsMediaWorkerDrainController(
        (acknowledgement) => drainAcknowledgementFile ? writeHouseHighlightsMediaWorkerDrainAcknowledgement(
          drainAcknowledgementFile,
          acknowledgement,
        ) : undefined,
        workerInstanceId,
      );
      process.on("SIGTERM", () => { drainController.requestDrain("SIGTERM"); });
      process.on("SIGINT", () => { drainController.requestDrain("SIGINT"); });
      if (startupMode === "standby") {
        while (!drainController.claimDisabled) await drainController.waitForPollDelay(config.pollIntervalMs);
        await drainController.waitForAcknowledgement();
      } else {
        await runHouseHighlightsMediaWorker(config, fetch, {
          drainController,
          runOnceImpl: () => runHouseHighlightsMediaWorkerAttempt(),
        });
      }
      return;
    }
    const result = await runHouseHighlightsMediaWorkerOnce(config);
    if (process.send) process.send({ type: "postgame-media-result", result });
    if (mode === "smoke") assertHouseHighlightsMediaWorkerSmokeResult(result);
    console.log(mode === "smoke" ? "Smoke render completed." : result);
  };
  // Completion means finalize/failure reporting, temporary cleanup and drain
  // acknowledgement have settled. Do not let renderer-owned handles keep this
  // CLI process alive; Remotion's exit handlers retire its browser children.
  run().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
}
