/**
 * Influence Game — HTTP API Server
 *
 * Bun + Hono server with WebSocket support for live game observation.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq } from "drizzle-orm";
import { createDB, schema } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { createGameRoutes } from "./routes/games.js";
import { createAuthRoutes } from "./routes/auth.js";
import { isGameRunning, getGameSnapshot } from "./services/game-lifecycle.js";
import {
  setServer,
  handleOpen,
  handleClose,
  sendSnapshot,
  type WsConnectionData,
} from "./services/ws-manager.js";

// ---------------------------------------------------------------------------
// Database — run migrations on startup, then connect
// ---------------------------------------------------------------------------

const dbPath = process.env.SQLITE_PATH ?? "influence.db";
runMigrations(dbPath);
const db = createDB(dbPath);

// ---------------------------------------------------------------------------
// Startup cleanup — reset orphaned in_progress games
// ---------------------------------------------------------------------------

const orphanedGames = db
  .select({ id: schema.games.id })
  .from(schema.games)
  .where(eq(schema.games.status, "in_progress"))
  .all();

if (orphanedGames.length > 0) {
  const now = new Date().toISOString();
  console.warn(
    `[startup] Found ${orphanedGames.length} orphaned in_progress game(s) — resetting to cancelled`,
  );
  for (const game of orphanedGames) {
    db.update(schema.games)
      .set({ status: "cancelled" as const, endedAt: now })
      .where(eq(schema.games.id, game.id))
      .run();
    console.warn(`[startup]   cancelled orphaned game ${game.id}`);
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono();

// CORS — allow frontend origin
app.use(
  "/api/*",
  cors({
    origin: process.env.CORS_ORIGIN ?? "http://localhost:3001",
    credentials: true,
  }),
);

// Health check
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "influence-api",
    version: "0.7.0",
    timestamp: new Date().toISOString(),
  });
});

// Root
app.get("/", (c) => {
  return c.json({
    name: "Influence Game API",
    version: "0.7.0",
    endpoints: {
      health: "/health",
      auth: "/api/auth",
      games: "/api/games",
      ws: "/ws/games/:id",
    },
  });
});

// Auth routes
const authRoutes = createAuthRoutes(db);
app.route("/", authRoutes);

// Game routes
const gameRoutes = createGameRoutes(db);
app.route("/", gameRoutes);

// ---------------------------------------------------------------------------
// Start server with WebSocket support
// ---------------------------------------------------------------------------

const port = parseInt(process.env.PORT ?? "3000", 10);

console.log(`Influence API listening on http://localhost:${port}`);

const server = Bun.serve<WsConnectionData>({
  port,
  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade for /ws/games/:id
    if (url.pathname.startsWith("/ws/games/")) {
      const gameId = url.pathname.split("/ws/games/")[1]?.split("/")[0];
      if (!gameId) {
        return new Response("Missing game ID", { status: 400 });
      }

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

      // Send state snapshot for catch-up if game is running
      const { gameId } = ws.data;
      const snapshot = getGameSnapshot(gameId);
      if (snapshot) {
        sendSnapshot(ws, snapshot);
      }
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

export default server;
