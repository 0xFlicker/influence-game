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
import { runMigrations } from "./db/migrate.js";
import { seedRBAC } from "./db/rbac-seed.js";
import { createGameRoutes } from "./routes/games.js";
import {
  createAuthRoutes,
  readPrivyCompatibilityBridgeEnabled,
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
import { createPostgameMediaWorkerRoutes } from "./routes/postgame-media-worker.js";
import { createSeasonRoutes } from "./routes/seasons.js";
import { createPublicPlayerRoutes } from "./routes/public-players.js";
import { getStorageStatus } from "./lib/storage.js";
import { getGameWatchState } from "./services/game-watch-state.js";
import { recoverGamesOnStartup } from "./services/game-lifecycle.js";
import { suspendOrphanedInProgressGamesOnStartup } from "./services/startup-orphaned-games.js";
import { preparePendingCompletionSettlementsOnStartup } from "./services/game-completion-settlement.js";
import { reconcileCompletedPostgameMedia } from "./services/postgame-media-coordinator.js";
import {
  setServer,
  handleOpen,
  handleClose,
  sendWatchState,
  type WsConnectionData,
} from "./services/ws-manager.js";

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

const MANAGED_AUTH_MODES = [
  "disabled",
  "existing-only",
  "full",
] as const;
type ManagedAuthMode = (typeof MANAGED_AUTH_MODES)[number];

const managedAuthMode = (process.env.MANAGED_AUTH_MODE ?? "disabled").trim();
if (!MANAGED_AUTH_MODES.includes(managedAuthMode as ManagedAuthMode)) {
  console.error(
    '\n  Managed authentication configuration error:\n\n    MANAGED_AUTH_MODE must be one of "disabled", "existing-only", or "full".\n',
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
await seedRBAC(db);
try {
  const reconciliation = await reconcileCompletedPostgameMedia(db);
  if (reconciliation.queued > 0 || reconciliation.waitingInputs > 0) {
    console.info(`[postgame-media] Reconciled ${reconciliation.examined} completed games; queued ${reconciliation.queued}, waiting inputs ${reconciliation.waitingInputs}`);
  }
} catch {
  console.warn("[postgame-media] Startup reconciliation deferred");
}

// ---------------------------------------------------------------------------
// Startup cleanup — this API process is also the worker in current deployments.
// Any pre-existing in_progress row has no in-memory runner here, so fail it
// closed and let configured recovery decide whether it can continue.
// ---------------------------------------------------------------------------

const startupOrphans = await suspendOrphanedInProgressGamesOnStartup(db);
for (const orphan of startupOrphans.returnedToWaiting) {
  console.info(`[startup] Returned zero-event orphaned game ${orphan.gameId} to waiting`);
}
for (const orphan of startupOrphans.repairRequired) {
  console.warn(
    `[startup] Returned zero-event orphaned game ${orphan.gameId} to waiting; roster repair is required`,
  );
}
for (const orphan of startupOrphans.suspended) {
  const age = orphan.ageMs === null ? "unknown age" : `started ${Math.round(orphan.ageMs / 1000)}s ago`;
  console.warn(`[startup] Suspended orphaned game ${orphan.gameId} (${age}; ${orphan.reason})`);
}

const pendingSettlements = await preparePendingCompletionSettlementsOnStartup(db);
if (pendingSettlements.readyGameIds.length > 0) {
  console.warn(
    `[startup] Marked ${pendingSettlements.readyGameIds.length} sealed completion settlement(s) ready for operator retry`,
  );
}

const startupRecoveryDisabled = process.env.INFLUENCE_API_STARTUP_RECOVERY?.toLowerCase() === "false";
if (!startupRecoveryDisabled) {
  const recovery = await recoverGamesOnStartup(db);
  if (recovery.attempted > 0) {
    console.info(
      `[startup] Recovery attempted ${recovery.attempted} suspended game(s); recovered ${recovery.recovered}; skipped ${recovery.skipped.length}`,
    );
    for (const skipped of recovery.skipped) {
      console.warn(`[startup] Recovery skipped ${skipped.gameId}: ${skipped.reason}`);
    }
  }
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
    endpoints: {
      health: "/api/health",
      config: "/api/config",
      auth: "/api/auth",
      games: "/api/games",
      admin: "/api/admin",
      freeQueue: "/api/free-queue",
      ws: "/ws/games/:id",
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

const postgameMediaWorkerRoutes = createPostgameMediaWorkerRoutes(db);
app.route("/", postgameMediaWorkerRoutes);

// Public watch intelligence routes
const watchIntelligenceRoutes = createWatchIntelligenceRoutes(db);
app.route("/", watchIntelligenceRoutes);

// Cognitive artifact routes
const cognitiveArtifactRoutes = createCognitiveArtifactRoutes(db);
app.route("/", cognitiveArtifactRoutes);

// Agent profile routes
const agentProfileRoutes = createAgentProfileRoutes(db);
app.route("/", agentProfileRoutes);

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

const server = Bun.serve<WsConnectionData>({
  port,
  hostname,
  async fetch(req, server) {
    const url = new URL(req.url);

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

      const upgraded = server.upgrade(req, {
        data: { gameId },
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
      handleOpen(ws);

      // Send persisted viewer-safe watch state for catch-up.
      const { gameId } = ws.data;
      void getGameWatchState(db, gameId)
        .then((state) => {
          if (state) sendWatchState(ws, state);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[ws] Failed to send watch-state catch-up for ${gameId}:`, message);
          ws.close(1011, "Watch state is unavailable");
        });
    },
    close(ws) {
      handleClose(ws);
    },
    message(_ws, _message) {
      // Observers are read-only — no inbound messages expected
    },
  },
});

// Register server instance with WS manager for pub/sub broadcasting
setServer(server);

console.log(`Influence API listening on http://${server.hostname}:${server.port}`);

export default server;
