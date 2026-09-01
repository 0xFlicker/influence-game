/**
 * Influence Game — HTTP API Server
 *
 * Bun + Hono server with WebSocket support for live game observation.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq, or } from "drizzle-orm";
import { createDB, schema } from "./db/index.js";
import { calculateMigrationSet, runMigrations } from "./db/migrate.js";
import { seedRBAC } from "./db/rbac-seed.js";
import { createGameRoutes } from "./routes/games.js";
import { createProviderModelRoutes } from "./routes/provider-models.js";
import {
  createAuthRoutes,
  readManagedAuthMode,
  readPrivyCompatibilityBridgeEnabled,
  type ManagedAuthMode,
} from "./routes/auth.js";
import { createMcpOAuthRoutes } from "./routes/mcp-oauth.js";
import { createMcpRoutes } from "./routes/mcp.js";
import { createAgentProfileRoutes } from "./routes/agent-profiles.js";
import { createAdminRoutes } from "./routes/admin.js";
import { createFreeQueueRoutes } from "./routes/free-queue.js";
import { createUploadRoutes } from "./routes/upload.js";
import { createProfileRoutes } from "./routes/profile.js";
import { createCognitiveArtifactRoutes } from "./routes/cognitive-artifacts.js";
import { createWatchIntelligenceRoutes } from "./routes/watch-intelligence.js";
import { createOwnerLearningRoutes } from "./routes/owner-learning.js";
import { createPostgameMediaWorkerRoutes } from "./routes/postgame-media-worker.js";
import { createSeasonRoutes } from "./routes/seasons.js";
import { createPublicPlayerRoutes } from "./routes/public-players.js";
import { createDeploymentControlRoutes } from "./routes/deployment-control.js";
import { getStorageStatus } from "./lib/storage.js";
import { getGameWatchState } from "./services/game-watch-state.js";
import { abortAllGames, isGameRunning, startGame } from "./services/game-lifecycle.js";
import { adoptInProgressDurableGamesOnStartup } from "./services/startup-durable-games.js";
import { preparePendingCompletionSettlementsOnStartup } from "./services/game-completion-settlement.js";
import { reconcileCompletedPostgameMedia } from "./services/postgame-media-coordinator.js";
import { assertRuntimeDeploymentSha } from "./services/legal-acceptance.js";
import {
  broadcastGamePublication,
  setServer,
  handleOpen,
  handleClose,
  parseAfterPublicationSequence,
  sendGamePublication,
  sendWatchState,
  type WsConnectionData,
} from "./services/ws-manager.js";
import {
  getDueGamePublicationHead,
  readDueGamePublicationSuffix,
  startDueGamePublicationRuntime,
} from "./services/game-publications.js";
import { createOwnerLearningOpenAIProvider } from "./services/owner-learning-provider.js";
import {
  startOwnerLearningFailureReconciliationLoop,
  startOwnerLearningWorkerLoop,
} from "./services/owner-learning-worker.js";
import {
  ownerLearningDeploymentEnabled,
  ownerLearningGenerationEnabled,
} from "./services/owner-learning-public.js";
import {
  getDeploymentAdmissionStatus,
  validateDeploymentAdmissionActivationFence,
} from "./services/deployment-admission.js";
import { runPendingDeploymentRecoveryReconciliation } from "./services/deployment-recovery-reconciliation.js";
import {
  finishRuntimeStartupWithProviderAttemptReconciliation,
  startProviderAttemptReconciliationRuntime,
} from "./services/provider-call-journal.js";
import { startProviderHealthProbeRuntime } from "./services/provider-health-probe.js";
import {
  createRuntimeActivationController,
  readRuntimeStartupMode,
  type AcceptedRuntimeIdentity,
  type RuntimeStartupMode,
} from "./services/runtime-activation.js";
import {
  acknowledgeGameWorkerDrain,
  readApiRuntimeRole,
  startGameExecutionWorkerRuntime,
  type ApiRuntimeRole,
  type GameExecutionWorkerRuntime,
} from "./services/game-execution-worker.js";
import { listenBeforeRuntimeInitialization } from "./services/listening-runtime.js";
import {
  createServerShutdownController,
  installServerShutdownSignalHandlers,
} from "./server-shutdown.js";

// ---------------------------------------------------------------------------
// Version — read from package.json so it stays in sync with releases
// ---------------------------------------------------------------------------

const apiVersion = (
  JSON.parse(
    readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8"),
  ) as { version: string }
).version;

// ---------------------------------------------------------------------------
// Startup env validation — crash immediately if required vars are missing
// ---------------------------------------------------------------------------

const REQUIRED_ENV = [
  "PRIVY_APP_ID",
  "PRIVY_APP_SECRET",
  "JWT_SECRET",
  "ADMIN_ADDRESS",
] as const;

let managedAuthMode: ManagedAuthMode;
let runtimeStartupMode: RuntimeStartupMode;
let apiRuntimeRole: ApiRuntimeRole;
let activeGameExecutionWorker: GameExecutionWorkerRuntime | null = null;
try {
  managedAuthMode = readManagedAuthMode();
} catch (error) {
  console.error(
    `\n  Managed authentication configuration error:\n\n    ${(error as Error).message}\n`,
  );
  process.exit(1);
}

try {
  runtimeStartupMode = readRuntimeStartupMode();
} catch (error) {
  console.error(
    `\n  Runtime startup configuration error:\n\n    ${(error as Error).message}\n`,
  );
  process.exit(1);
}

try {
  apiRuntimeRole = readApiRuntimeRole();
} catch (error) {
  console.error(
    `\n  API runtime role configuration error:\n\n    ${(error as Error).message}\n`,
  );
  process.exit(1);
}

try {
  readPrivyCompatibilityBridgeEnabled();
} catch (error) {
  console.error(
    `\n  Privy compatibility bridge configuration error:\n\n    ${(error as Error).message}\n`,
  );
  process.exit(1);
}

try {
  assertRuntimeDeploymentSha();
} catch (error) {
  console.error(
    `\n  Deployment provenance configuration error:\n\n    ${(error as Error).message}\n`,
  );
  process.exit(1);
}

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(
    `\n  Missing required environment variables:\n\n${missing.map((k) => `    - ${k}`).join("\n")}\n\n  Set these in Doppler or your .env file and restart.\n`,
  );
  process.exit(1);
}

if (managedAuthMode !== "disabled") {
  const requiredClerkEnv = [
    "CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
    "CLERK_JWT_KEY",
    "CLERK_AUTHORIZED_PARTIES",
  ] as const;
  const missingClerkEnv = requiredClerkEnv.filter(
    (key) => !process.env[key]?.trim(),
  );
  if (missingClerkEnv.length > 0) {
    console.error(
      `\n  Managed authentication configuration error:\n\n${missingClerkEnv.map((key) => `    - ${key} is required when MANAGED_AUTH_MODE is ${managedAuthMode}`).join("\n")}\n\n  Set these in Doppler or your environment and restart.\n`,
    );
    process.exit(1);
  }

  const authorizedParties = process.env.CLERK_AUTHORIZED_PARTIES!
    .split(",")
    .map((party) => party.trim())
    .filter(Boolean);
  const invalidAuthorizedParties = authorizedParties.filter((party) => {
    try {
      const url = new URL(party);
      return (
        !["http:", "https:"].includes(url.protocol) ||
        url.origin !== party
      );
    } catch {
      return true;
    }
  });
  if (invalidAuthorizedParties.length > 0) {
    console.error(
      "\n  Managed authentication configuration error:\n\n    CLERK_AUTHORIZED_PARTIES must be a comma-separated list of exact http(s) origins.\n",
    );
    process.exit(1);
  }
}

// Optional: object storage for PFP uploads.
const storageStatus = getStorageStatus();
if (storageStatus.backend === "s3") {
  console.info("[startup] PFP uploads using Linode Object Storage");
} else if (storageStatus.backend === "local") {
  console.warn(`[startup] PFP uploads using local filesystem: ${storageStatus.localDir}`);
} else {
  console.warn(
    `[startup] PFP upload disabled — missing env vars: ${storageStatus.missingS3Env.join(", ")}`,
  );
}

function getAllowedCorsOrigins(): string[] {
  const origins = (process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins;
}

// ---------------------------------------------------------------------------
// Database — run migrations on startup, then connect
// ---------------------------------------------------------------------------

const databaseUrl = process.env.DATABASE_URL;
await runMigrations(databaseUrl);
const db = createDB(databaseUrl);
const releaseMigrationSet = calculateMigrationSet();
const runtimeActivation = createRuntimeActivationController({
  mode: runtimeStartupMode,
  validateFence: (fence) => validateDeploymentAdmissionActivationFence(db, fence),
  validateIdentity: validateAcceptedRuntimeIdentity,
  startRuntime: startBackgroundRuntime,
});

function validateAcceptedRuntimeIdentity(identity: AcceptedRuntimeIdentity) {
  const expected = {
    candidateSha: process.env.GIT_SHA ?? "",
    apiDigest: process.env.INFLUENCE_API_IMAGE_DIGEST ?? "",
    migrationSet: releaseMigrationSet,
  };
  return identity.candidateSha === expected.candidateSha
    && identity.apiDigest === expected.apiDigest
    && identity.migrationSet === expected.migrationSet
    ? { ok: true as const }
    : {
        ok: false as const,
        code: "accepted_runtime_identity_mismatch",
        error: "Accepted runtime identity does not match this API process",
        retryable: false,
      };
}

async function startBackgroundRuntime(context: {
  fence?: { leaseId: string; fencingToken: number };
  signal: AbortSignal;
}) {
  const activationFence = context.fence;
  const assertNotAborted = () => context.signal.throwIfAborted();
  assertNotAborted();
  const gameExecutionWorker = apiRuntimeRole === "game-worker"
    ? startGameExecutionWorkerRuntime()
    : null;
  activeGameExecutionWorker = gameExecutionWorker;
  if (gameExecutionWorker) {
    console.info(`[game-worker] Started durable execution worker ${gameExecutionWorker.workerId}`);
  }
  await seedRBAC(db);
  assertNotAborted();
  // startBackgroundRuntime is invoked only for the active process or after a
  // validation candidate passes durable acceptance. Merely activating a
  // private candidate never starts this shared-state sweep.
  try {
    const providerAttemptReconciliation =
      await startProviderAttemptReconciliationRuntime(db, {
        signal: context.signal,
      });
    return await finishRuntimeStartupWithProviderAttemptReconciliation(
      providerAttemptReconciliation,
      () => finishBackgroundRuntimeStartup(
        context,
        activationFence,
        providerAttemptReconciliation,
        gameExecutionWorker,
      ),
    );
  } catch (error) {
    if (activeGameExecutionWorker === gameExecutionWorker) activeGameExecutionWorker = null;
    throw error;
  }
}

async function finishBackgroundRuntimeStartup(
  context: {
    fence?: { leaseId: string; fencingToken: number };
    signal: AbortSignal;
  },
  activationFence: { leaseId: string; fencingToken: number } | undefined,
  providerAttemptReconciliation: Awaited<
    ReturnType<typeof startProviderAttemptReconciliationRuntime>
  >,
  gameExecutionWorker: GameExecutionWorkerRuntime | null,
) {
  const assertNotAborted = () => context.signal.throwIfAborted();
  assertNotAborted();
  try {
    const reconciliation = await reconcileCompletedPostgameMedia(db);
    if (reconciliation.queued > 0 || reconciliation.waitingInputs > 0) {
      console.info(`[postgame-media] Reconciled ${reconciliation.examined} completed games; queued ${reconciliation.queued}, waiting inputs ${reconciliation.waitingInputs}`);
    }
  } catch {
    console.warn("[postgame-media] Startup reconciliation deferred");
  }

  // A fenced candidate is still reversible until the host completes the
  // accepting lease. It may initialize background services, but it must not
  // classify, claim, or recover durable game ownership. Lease completion
  // atomically enqueues the same DB-backed recovery reconciliation consumed
  // below after admission reopens.
  const adoptDurableGames = async () => {
    if (!gameExecutionWorker) {
      throw new Error("Durable game adoption requires INFLUENCE_API_ROLE=game-worker");
    }
    let admission;
    try {
      admission = await getDeploymentAdmissionStatus(db);
    } catch {
      console.warn("[game-worker] Deployment admission check unavailable; durable adoption paused");
      return { attempted: 0, recovered: 0, skipped: [] };
    }
    if (!admission.lease && !gameExecutionWorker.canClaimGames()) {
      gameExecutionWorker.resumeClaimingAfterAdmissionReopens();
      console.info("[game-worker] Deployment admission reopened; durable claims resumed");
    }
    if (admission.lease?.phase === "draining" || admission.lease?.phase === "validating") {
      const drainStatus = await acknowledgeGameWorkerDrain(
        db,
        gameExecutionWorker,
        {
          id: admission.lease.id,
          fencingToken: admission.lease.fencingToken,
          phase: admission.lease.phase,
        },
        abortAllGames,
      );
      console.info(
        `[game-worker] Drain ${drainStatus.state}; local active leases ${drainStatus.ownedGameCount ?? "unknown"}`,
      );
      return { attempted: 0, recovered: 0, skipped: [] };
    }
    // A draining worker must keep reconciling its own durable owner rows
    // until the acknowledgement can truthfully become drained. It remains
    // non-claiming throughout; this is not a recovery scan.
    if (!gameExecutionWorker.canClaimGames()) {
      return { attempted: 0, recovered: 0, skipped: [] };
    }
    if (admission.admissionBlocked) return { attempted: 0, recovered: 0, skipped: [] };
    const result = await adoptInProgressDurableGamesOnStartup(db, {
      signal: context.signal,
      processId: gameExecutionWorker.workerId,
      isAlreadyRunning: isGameRunning,
      canAttemptStart: gameExecutionWorker.canAttemptGameStart,
      onStartSucceeded: gameExecutionWorker.recordGameStartSucceeded,
      onStartFailed: gameExecutionWorker.recordGameStartFailed,
      start: async ({ gameId, ownerEpoch, upgradeFrom }) => {
        const started = await startGame(db, gameId, ownerEpoch, {
          ...(upgradeFrom && { durableUpgradeFrom: upgradeFrom }),
        });
        if (started.error) throw new Error(started.error);
      },
    });
    return {
      attempted: result.scanned,
      recovered: result.adopted.length,
      skipped: result.skipped.map((entry) => ({
        gameId: entry.gameId,
        reason: entry.detail ? `${entry.reason}: ${entry.detail}` : entry.reason,
      })),
    };
  };
  if (!activationFence && gameExecutionWorker) {
    assertNotAborted();
    const pendingSettlements = await preparePendingCompletionSettlementsOnStartup(db);
    assertNotAborted();
    if (pendingSettlements.readyGameIds.length > 0) {
      console.warn(
        `[startup] Marked ${pendingSettlements.readyGameIds.length} sealed completion settlement(s) ready for operator retry`,
      );
    }

    const recovery = await adoptDurableGames();
    assertNotAborted();
    if (recovery.attempted > 0) {
      console.info(
        `[startup] Durable restart scanned ${recovery.attempted} in-progress game(s); adopted ${recovery.recovered}; skipped ${recovery.skipped.length}`,
      );
      for (const skipped of recovery.skipped) {
        console.warn(`[startup] Durable restart skipped ${skipped.gameId}: ${skipped.reason}`);
      }
    }
  }

  const providerHealthProbeRuntime = activationFence
    ? null
    : await startProviderHealthProbeRuntime(db);
  const ownerLearningApiKey = process.env.OPENAI_API_KEY?.trim();
  assertNotAborted();
  const ownerLearningFailureReconciliation = startOwnerLearningFailureReconciliationLoop(db, {
    canClaimWork: () => runtimeActivation.canClaimWork(),
  });
  const ownerLearningWorker = ownerLearningApiKey && ownerLearningGenerationEnabled()
    ? startOwnerLearningWorkerLoop(db, {
        provider: createOwnerLearningOpenAIProvider({ apiKey: ownerLearningApiKey }),
        cursorSecret: process.env.JWT_SECRET,
        canClaimWork: () => runtimeActivation.canClaimWork(),
      })
    : null;
  if (!ownerLearningDeploymentEnabled()) {
    console.info("[owner-learning] Live review generation disabled by deployment configuration");
  } else if (activationFence) {
    console.info("[owner-learning] Worker claims paused until deployment activation completes");
  } else if (!ownerLearningWorker) {
    console.warn("[owner-learning] Review generation unavailable because OPENAI_API_KEY is not configured");
  }
  const reconcilePendingRecovery = async () => {
    try {
      const result = await runPendingDeploymentRecoveryReconciliation(
        db,
        adoptDurableGames,
        context.signal,
      );
      if (result.outcome === "succeeded") {
        console.info(
          `[startup] Reconciled terminal deployment ${result.leaseId}; recovered ${result.recovery.recovered}/${result.recovery.attempted} suspended game(s)`,
        );
      } else if (result.outcome === "retry") {
        console.warn(`[startup] Terminal deployment ${result.leaseId} recovery will retry: ${result.error}`);
      }
    } catch (error) {
      if (!context.signal.aborted) console.warn("[startup] Deployment recovery reconciliation deferred", error);
    }
  };
  if (gameExecutionWorker) await reconcilePendingRecovery();
  assertNotAborted();
  const gamePublicationRuntime = await startDueGamePublicationRuntime(db, {
    broadcast: broadcastGamePublication,
  });
  const reconciliationTimer = gameExecutionWorker
    ? setInterval(() => { void reconcilePendingRecovery(); }, 5_000)
    : null;
  reconciliationTimer?.unref();
  const executionScanTimer = gameExecutionWorker
    ? setInterval(() => {
      void adoptDurableGames().catch((error) => {
        if (!context.signal.aborted) console.warn("[game-worker] Durable game scan deferred", error);
      });
    }, 2_000)
    : null;
  executionScanTimer?.unref();

  return {
    async stop() {
      if (reconciliationTimer) clearInterval(reconciliationTimer);
      if (executionScanTimer) clearInterval(executionScanTimer);
      if (gameExecutionWorker) await abortAllGames();
      providerHealthProbeRuntime?.stop();
      await gamePublicationRuntime.stop();
      await providerAttemptReconciliation.stop();
      await ownerLearningFailureReconciliation.stop();
      await ownerLearningWorker?.stop();
      if (activeGameExecutionWorker === gameExecutionWorker) activeGameExecutionWorker = null;
    },
  };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono();
const allowedCorsOrigins = new Set(getAllowedCorsOrigins());

// CORS — allow frontend origin
app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      if (!origin) return origin;
      return allowedCorsOrigins.has(origin) ? origin : null;
    },
    credentials: true,
  }),
);

// Health check (both paths: /health for direct access, /api/health for reverse-proxy)
const healthResponse = () => ({
  status: "ok" as const,
  service: "influence-api",
  version: apiVersion,
  commit: process.env.GIT_SHA ?? "unknown",
  releaseControl: {
    ...runtimeActivation.getStatus(),
    migrationSet: releaseMigrationSet,
    imageDigest: process.env.INFLUENCE_API_IMAGE_DIGEST ?? null,
  },
  runtimeRole: apiRuntimeRole,
  timestamp: new Date().toISOString(),
});
app.get("/health", (c) => c.json(healthResponse()));
app.get("/api/health", (c) => c.json(healthResponse()));

// Public config — exposes feature flags for the frontend
app.get("/api/config", (c) => {
  return c.json({});
});

// Root
app.get("/", (c) => {
  return c.json({
    name: "Influence Game API",
    version: apiVersion,
    commit: process.env.GIT_SHA ?? "unknown",
    releaseControl: {
      ...runtimeActivation.getStatus(),
      migrationSet: releaseMigrationSet,
      imageDigest: process.env.INFLUENCE_API_IMAGE_DIGEST ?? null,
    },
    endpoints: {
      health: "/api/health",
      config: "/api/config",
      auth: "/api/auth",
      games: "/api/games",
      admin: "/api/admin",
      freeQueue: "/api/free-queue",
      ws: "/ws/games/:id",
      wsReleaseProbe: "/ws/health",
    },
  });
});

// Auth routes
const authRoutes = createAuthRoutes(db);
app.route("/", authRoutes);

// MCP OAuth routes
const mcpOAuthRoutes = createMcpOAuthRoutes(db);
app.route("/", mcpOAuthRoutes);

// Production Game MCP route
const mcpRoutes = createMcpRoutes(db);
app.route("/", mcpRoutes);

// Game routes
const gameRoutes = createGameRoutes(db);
app.route("/", gameRoutes);

const providerModelRoutes = createProviderModelRoutes(db);
app.route("/", providerModelRoutes);

const postgameMediaWorkerRoutes = createPostgameMediaWorkerRoutes(db, {
  canClaimWork: () => runtimeActivation.canClaimWork(),
});
app.route("/", postgameMediaWorkerRoutes);

const deploymentControlRoutes = createDeploymentControlRoutes(db, {
  runtimeActivation,
  gameWorkerDrainStatus: () => activeGameExecutionWorker?.getDrainStatus() ?? null,
});
app.route("/", deploymentControlRoutes);

// Public watch intelligence routes
const watchIntelligenceRoutes = createWatchIntelligenceRoutes(db);
app.route("/", watchIntelligenceRoutes);

// Cognitive artifact routes
const cognitiveArtifactRoutes = createCognitiveArtifactRoutes(db);
app.route("/", cognitiveArtifactRoutes);

// Agent profile routes
const agentProfileRoutes = createAgentProfileRoutes(db);
app.route("/", agentProfileRoutes);

const ownerLearningRoutes = createOwnerLearningRoutes(db);
app.route("/", ownerLearningRoutes);

// Admin RBAC routes
const adminRoutes = createAdminRoutes(db);
app.route("/", adminRoutes);

// Free game queue routes
const freeQueueRoutes = createFreeQueueRoutes(db);
app.route("/", freeQueueRoutes);

// Dual Crown seasons and competition data
const seasonRoutes = createSeasonRoutes(db);
app.route("/", seasonRoutes);

// Anonymous public player identities, résumés, and agent rosters
const publicPlayerRoutes = createPublicPlayerRoutes(db);
app.route("/", publicPlayerRoutes);

// Upload routes (presigned URL generation for PFPs)
const uploadRoutes = createUploadRoutes(db);
app.route("/", uploadRoutes);

// Profile & leaderboard routes
const profileRoutes = createProfileRoutes(db);
app.route("/", profileRoutes);

// ---------------------------------------------------------------------------
// Start server with WebSocket support
// ---------------------------------------------------------------------------

const port = parseInt(process.env.PORT ?? "3000", 10);
const hostname = process.env.HOST ?? "127.0.0.1";
let acceptingRequests = false;
let unavailableMessage = "Server starting";

const server = await listenBeforeRuntimeInitialization({
  listen: () => Bun.serve<WsConnectionData>({
    port,
    hostname,
    async fetch(req, server) {
      if (!acceptingRequests) {
        return new Response(unavailableMessage, {
          status: 503,
          headers: { Connection: "close" },
        });
      }

      const url = new URL(req.url);

      // Canonical release probes need a real WebSocket upgrade that does not
      // depend on mutable game data or subscribe to a game stream.
      if (url.pathname === "/ws/health") {
        const upgraded = server.upgrade(req, {
          data: { gameId: "", releaseProbe: true },
        });
        if (upgraded) {
          return undefined as unknown as Response;
        }
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // WebSocket upgrade for /ws/games/:id (accepts UUID or slug)
      if (url.pathname.startsWith("/ws/games/")) {
        const slugOrId = url.pathname.split("/ws/games/")[1]?.split("/")[0];
        if (!slugOrId) {
          return new Response("Missing game ID", { status: 400 });
        }

        // Resolve slug to canonical UUID so WS topics match broadcastGameEvent
        const gameRow = (await db
          .select({ id: schema.games.id, status: schema.games.status })
          .from(schema.games)
          .where(or(eq(schema.games.id, slugOrId), eq(schema.games.slug, slugOrId))))[0];

        if (!gameRow) {
          return new Response("Game not found", { status: 404 });
        }

        const gameId = gameRow.id;

        let afterPublicationSequence: number;
        try {
          afterPublicationSequence = parseAfterPublicationSequence(
            url.searchParams.get("afterPublicationSequence"),
          );
        } catch {
          return new Response(
            "afterPublicationSequence must be a non-negative safe integer",
            { status: 400 },
          );
        }

        const upgraded = server.upgrade(req, {
          data: { gameId, afterPublicationSequence },
        });
        if (upgraded) {
          return undefined as unknown as Response; // Bun handles the rest
        }
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Delegate everything else to Hono
      return app.fetch(req, { env: {} });
    },
    websocket: {
      open(ws) {
        if (ws.data.releaseProbe) {
          ws.send("ok");
          ws.close(1000, "Release probe complete");
          return;
        }
        handleOpen(ws);

        // Subscribe first, then send the durable suffix. Live/catch-up overlap is
        // intentional and the client publication cursor removes duplicates.
        const { gameId, afterPublicationSequence = 0 } = ws.data;
        void Promise.all([
          getGameWatchState(db, gameId),
          readDueGamePublicationSuffix(db, gameId, {
            afterPublicationSequence,
          }),
          getDueGamePublicationHead(db, gameId),
        ])
          .then(([state, publications, dueHead]) => {
            if (afterPublicationSequence > dueHead) {
              throw new Error("Publication cursor is ahead of the durable feed");
            }
            for (const publication of publications) {
              sendGamePublication(ws, publication);
            }
            if (state) sendWatchState(ws, state, dueHead);
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[ws] Failed to send publication catch-up for ${gameId}:`, message);
            ws.close(1011, "Game publications are unavailable");
          });
      },
      close(ws) {
        if (ws.data.releaseProbe) return;
        handleClose(ws);
      },
      message(_ws, _message) {
        // Observers are read-only — no inbound messages expected
      },
    },
  }),
  onListening: (listeningServer) => setServer(listeningServer),
  initializeRuntime: () => runtimeActivation.initialize(),
  onReady: () => {
    acceptingRequests = true;
  },
});

const shutdown = createServerShutdownController({
  server,
  worker: { stop: () => runtimeActivation.stop() },
  stopAcceptingRequests: () => {
    unavailableMessage = "Server shutting down";
    acceptingRequests = false;
  },
  exit: (code) => process.exit(code),
});
installServerShutdownSignalHandlers(process, shutdown);

console.log(`Influence API listening on http://${server.hostname}:${server.port}`);

export default server;
