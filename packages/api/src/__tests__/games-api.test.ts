/**
 * Game REST API endpoint tests.
 *
 * Uses Hono's test client and in-memory SQLite — no real server, no disk I/O.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createDB, schema } from "../db/index.js";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createGameRoutes } from "../routes/games.js";
import { randomUUID } from "crypto";
import path from "path";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setupApp() {
  const db = createDB(":memory:");
  const migrationsFolder = path.resolve(import.meta.dir, "../../drizzle");
  migrate(db, { migrationsFolder });

  const app = new Hono();
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.route("/", createGameRoutes(db));

  return { app, db };
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function createTestGame(app: Hono, overrides: Record<string, unknown> = {}) {
  const res = await app.request(
    "/api/games",
    json({
      playerCount: 6,
      modelTier: "budget",
      personaPool: ["honest", "strategic", "deceptive"],
      fillStrategy: "balanced",
      timingPreset: "fast",
      maxRounds: 10,
      visibility: "public",
      slotType: "all_ai",
      ...overrides,
    }),
  );
  return res.json() as Promise<{ id: string; gameNumber: number }>;
}

async function joinTestPlayer(
  app: Hono,
  gameId: string,
  name: string,
  personality = "Test personality",
) {
  const res = await app.request(
    `/api/games/${gameId}/join`,
    json({ agentName: name, personality, personaKey: "honest" }),
  );
  return res.json() as Promise<{ playerId: string }>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Game REST API", () => {
  let app: Hono;
  let db: ReturnType<typeof createDB>;

  beforeEach(() => {
    ({ app, db } = setupApp());
  });

  // =========================================================================
  // POST /api/games
  // =========================================================================

  describe("POST /api/games", () => {
    test("creates a game and returns id + gameNumber", async () => {
      const res = await app.request(
        "/api/games",
        json({
          playerCount: 6,
          modelTier: "budget",
          timingPreset: "standard",
          maxRounds: 10,
          visibility: "public",
        }),
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; gameNumber: number };
      expect(body.id).toBeTruthy();
      expect(body.gameNumber).toBe(1);
    });

    test("creates game with auto maxRounds", async () => {
      const res = await app.request(
        "/api/games",
        json({ playerCount: 8, maxRounds: "auto" }),
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string };
      expect(body.id).toBeTruthy();

      // Verify the config was stored
      const game = db
        .select()
        .from(schema.games)
        .all()[0]!;
      const config = JSON.parse(game.config);
      expect(config.maxRounds).toBeGreaterThanOrEqual(10);
    });

    test("returns 400 for invalid JSON", async () => {
      const res = await app.request("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });

      expect(res.status).toBe(400);
    });

    test("game defaults to waiting status", async () => {
      const { id } = await createTestGame(app);
      const game = db
        .select()
        .from(schema.games)
        .all()
        .find((g) => g.id === id)!;
      expect(game.status).toBe("waiting");
    });

    test("game numbers increment", async () => {
      const g1 = await createTestGame(app);
      const g2 = await createTestGame(app);
      expect(g1.gameNumber).toBe(1);
      expect(g2.gameNumber).toBe(2);
    });
  });

  // =========================================================================
  // GET /api/games
  // =========================================================================

  describe("GET /api/games", () => {
    test("returns empty array when no games exist", async () => {
      const res = await app.request("/api/games");
      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body).toEqual([]);
    });

    test("lists all games", async () => {
      await createTestGame(app);
      await createTestGame(app);

      const res = await app.request("/api/games");
      const body = (await res.json()) as unknown[];
      expect(body).toHaveLength(2);
    });

    test("filters by status", async () => {
      const { id: g1 } = await createTestGame(app);
      await createTestGame(app);

      // Manually set one to completed
      const { eq } = await import("drizzle-orm");
      db.update(schema.games)
        .set({ status: "completed", endedAt: new Date().toISOString() })
        .where(eq(schema.games.id, g1))
        .run();

      const res = await app.request("/api/games?status=waiting");
      const body = (await res.json()) as Array<{ status: string }>;
      expect(body).toHaveLength(1);
      expect(body[0]!.status).toBe("waiting");
    });

    test("filters by multiple statuses", async () => {
      const { id: g1 } = await createTestGame(app);
      const { id: g2 } = await createTestGame(app);
      await createTestGame(app);

      const { eq } = await import("drizzle-orm");
      db.update(schema.games)
        .set({ status: "completed" })
        .where(eq(schema.games.id, g1))
        .run();
      db.update(schema.games)
        .set({ status: "in_progress" })
        .where(eq(schema.games.id, g2))
        .run();

      const res = await app.request("/api/games?status=completed,in_progress");
      const body = (await res.json()) as unknown[];
      expect(body).toHaveLength(2);
    });

    test("game summaries include player count", async () => {
      const { id } = await createTestGame(app);
      await joinTestPlayer(app, id, "Atlas");
      await joinTestPlayer(app, id, "Vera");

      const res = await app.request("/api/games");
      const body = (await res.json()) as Array<{ playerCount: number }>;
      expect(body[0]!.playerCount).toBe(2);
    });
  });

  // =========================================================================
  // GET /api/games/:id
  // =========================================================================

  describe("GET /api/games/:id", () => {
    test("returns game details with players", async () => {
      const { id } = await createTestGame(app);
      await joinTestPlayer(app, id, "Atlas", "Strategic calculator");
      await joinTestPlayer(app, id, "Vera", "Master manipulator");

      const res = await app.request(`/api/games/${id}`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        id: string;
        status: string;
        players: Array<{ name: string; persona: string }>;
      };
      expect(body.id).toBe(id);
      expect(body.status).toBe("waiting");
      expect(body.players).toHaveLength(2);
      expect(body.players[0]!.name).toBe("Atlas");
    });

    test("returns 404 for non-existent game", async () => {
      const res = await app.request(`/api/games/${randomUUID()}`);
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // POST /api/games/:id/join
  // =========================================================================

  describe("POST /api/games/:id/join", () => {
    test("adds a player to a waiting game", async () => {
      const { id } = await createTestGame(app);

      const res = await app.request(
        `/api/games/${id}/join`,
        json({
          agentName: "Atlas",
          personality: "Strategic calculator",
          personaKey: "strategic",
        }),
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as { playerId: string };
      expect(body.playerId).toBeTruthy();

      // Verify in DB
      const players = db
        .select()
        .from(schema.gamePlayers)
        .all();
      expect(players).toHaveLength(1);
      expect(JSON.parse(players[0]!.persona).name).toBe("Atlas");
    });

    test("rejects join for non-existent game", async () => {
      const res = await app.request(
        `/api/games/${randomUUID()}/join`,
        json({ agentName: "Atlas", personality: "Test" }),
      );
      expect(res.status).toBe(404);
    });

    test("rejects join when game is not waiting", async () => {
      const { id } = await createTestGame(app);

      // Start the game (need min players first)
      for (let i = 0; i < 4; i++) {
        await joinTestPlayer(app, id, `Player${i}`);
      }
      await app.request(`/api/games/${id}/start`, { method: "POST" });

      const res = await app.request(
        `/api/games/${id}/join`,
        json({ agentName: "Late", personality: "Too late" }),
      );
      expect(res.status).toBe(400);
    });

    test("rejects join when game is full", async () => {
      const { id } = await createTestGame(app, { playerCount: 4 });

      for (let i = 0; i < 4; i++) {
        await joinTestPlayer(app, id, `Player${i}`);
      }

      const res = await app.request(
        `/api/games/${id}/join`,
        json({ agentName: "Extra", personality: "No room" }),
      );
      expect(res.status).toBe(400);
    });

    test("rejects join with missing fields", async () => {
      const { id } = await createTestGame(app);
      const res = await app.request(
        `/api/games/${id}/join`,
        json({ agentName: "Atlas" }),
      );
      expect(res.status).toBe(400);
    });
  });

  // =========================================================================
  // POST /api/games/:id/start
  // =========================================================================

  describe("POST /api/games/:id/start", () => {
    test("starts a game with enough players", async () => {
      const { id } = await createTestGame(app);

      for (let i = 0; i < 4; i++) {
        await joinTestPlayer(app, id, `Player${i}`);
      }

      const res = await app.request(`/api/games/${id}/start`, { method: "POST" });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { status: string; players: number };
      expect(body.status).toBe("in_progress");
      expect(body.players).toBe(4);

      // Verify in DB
      const game = db
        .select()
        .from(schema.games)
        .all()[0]!;
      expect(game.status).toBe("in_progress");
      expect(game.startedAt).toBeTruthy();
    });

    test("rejects start with too few players", async () => {
      const { id } = await createTestGame(app);
      await joinTestPlayer(app, id, "Solo");

      const res = await app.request(`/api/games/${id}/start`, { method: "POST" });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Not enough players");
    });

    test("rejects start for non-waiting game", async () => {
      const { id } = await createTestGame(app);
      for (let i = 0; i < 4; i++) {
        await joinTestPlayer(app, id, `Player${i}`);
      }

      // Start once
      await app.request(`/api/games/${id}/start`, { method: "POST" });

      // Try to start again
      const res = await app.request(`/api/games/${id}/start`, { method: "POST" });
      expect(res.status).toBe(400);
    });

    test("returns 404 for non-existent game", async () => {
      const res = await app.request(`/api/games/${randomUUID()}/start`, {
        method: "POST",
      });
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // POST /api/games/:id/stop
  // =========================================================================

  describe("POST /api/games/:id/stop", () => {
    test("stops a running game", async () => {
      const { id } = await createTestGame(app);
      for (let i = 0; i < 4; i++) {
        await joinTestPlayer(app, id, `Player${i}`);
      }
      await app.request(`/api/games/${id}/start`, { method: "POST" });

      const res = await app.request(`/api/games/${id}/stop`, { method: "POST" });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { status: string };
      expect(body.status).toBe("cancelled");

      // Verify in DB
      const game = db.select().from(schema.games).all()[0]!;
      expect(game.status).toBe("cancelled");
      expect(game.endedAt).toBeTruthy();
    });

    test("stops a waiting game", async () => {
      const { id } = await createTestGame(app);
      const res = await app.request(`/api/games/${id}/stop`, { method: "POST" });
      expect(res.status).toBe(200);
    });

    test("rejects stop for completed game", async () => {
      const { id } = await createTestGame(app);
      const { eq } = await import("drizzle-orm");
      db.update(schema.games)
        .set({ status: "completed" })
        .where(eq(schema.games.id, id))
        .run();

      const res = await app.request(`/api/games/${id}/stop`, { method: "POST" });
      expect(res.status).toBe(400);
    });
  });

  // =========================================================================
  // GET /api/games/:id/transcript
  // =========================================================================

  describe("GET /api/games/:id/transcript", () => {
    test("returns empty transcript for new game", async () => {
      const { id } = await createTestGame(app);

      const res = await app.request(`/api/games/${id}/transcript`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as unknown[];
      expect(body).toEqual([]);
    });

    test("returns transcript entries with player names", async () => {
      const { id } = await createTestGame(app);
      const { playerId } = await joinTestPlayer(app, id, "Atlas");

      // Insert transcript entries directly
      db.insert(schema.transcripts)
        .values([
          {
            gameId: id,
            round: 1,
            phase: "INTRODUCTION",
            fromPlayerId: playerId,
            scope: "public",
            text: "I am Atlas.",
            timestamp: Date.now(),
          },
          {
            gameId: id,
            round: 1,
            phase: "LOBBY",
            scope: "system",
            text: "Round 1 has begun.",
            timestamp: Date.now() + 1000,
          },
        ])
        .run();

      const res = await app.request(`/api/games/${id}/transcript`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as Array<{
        fromPlayerName: string | null;
        scope: string;
        text: string;
      }>;
      expect(body).toHaveLength(2);
      expect(body[0]!.fromPlayerName).toBe("Atlas");
      expect(body[0]!.scope).toBe("public");
      expect(body[1]!.fromPlayerName).toBeNull();
      expect(body[1]!.scope).toBe("system");
    });

    test("transcript entries are ordered by timestamp", async () => {
      const { id } = await createTestGame(app);
      const { playerId } = await joinTestPlayer(app, id, "Atlas");

      const now = Date.now();
      db.insert(schema.transcripts)
        .values([
          {
            gameId: id,
            round: 1,
            phase: "LOBBY",
            fromPlayerId: playerId,
            scope: "public",
            text: "Second message",
            timestamp: now + 1000,
          },
          {
            gameId: id,
            round: 1,
            phase: "INTRODUCTION",
            fromPlayerId: playerId,
            scope: "public",
            text: "First message",
            timestamp: now,
          },
        ])
        .run();

      const res = await app.request(`/api/games/${id}/transcript`);
      const body = (await res.json()) as Array<{ text: string }>;
      expect(body[0]!.text).toBe("First message");
      expect(body[1]!.text).toBe("Second message");
    });

    test("returns 404 for non-existent game", async () => {
      const res = await app.request(`/api/games/${randomUUID()}/transcript`);
      expect(res.status).toBe(404);
    });

    test("whisper entries include parsed toPlayerIds", async () => {
      const { id } = await createTestGame(app);
      const { playerId: p1 } = await joinTestPlayer(app, id, "Atlas");
      const { playerId: p2 } = await joinTestPlayer(app, id, "Vera");

      db.insert(schema.transcripts)
        .values({
          gameId: id,
          round: 1,
          phase: "WHISPER",
          fromPlayerId: p1,
          scope: "whisper",
          toPlayerIds: JSON.stringify([p2]),
          text: "Secret message",
          timestamp: Date.now(),
        })
        .run();

      const res = await app.request(`/api/games/${id}/transcript`);
      const body = (await res.json()) as Array<{ toPlayerIds: string[] | null }>;
      expect(body[0]!.toPlayerIds).toEqual([p2]);
    });
  });

  // =========================================================================
  // Full lifecycle integration test
  // =========================================================================

  describe("full game lifecycle", () => {
    test("create → join × 4 → start → stop", async () => {
      // Create
      const { id, gameNumber } = await createTestGame(app);
      expect(gameNumber).toBe(1);

      // Join 4 players
      const playerIds: string[] = [];
      for (const name of ["Atlas", "Vera", "Finn", "Mira"]) {
        const { playerId } = await joinTestPlayer(app, id, name, `${name} personality`);
        playerIds.push(playerId);
      }

      // Verify game detail shows 4 players
      const detailRes = await app.request(`/api/games/${id}`);
      const detail = (await detailRes.json()) as { players: unknown[] };
      expect(detail.players).toHaveLength(4);

      // Start
      const startRes = await app.request(`/api/games/${id}/start`, { method: "POST" });
      expect(startRes.status).toBe(200);

      // List should show in_progress
      const listRes = await app.request("/api/games?status=in_progress");
      const list = (await listRes.json()) as Array<{ id: string; status: string }>;
      expect(list).toHaveLength(1);
      expect(list[0]!.status).toBe("in_progress");

      // Stop
      const stopRes = await app.request(`/api/games/${id}/stop`, { method: "POST" });
      expect(stopRes.status).toBe(200);

      // Final check
      const finalRes = await app.request(`/api/games/${id}`);
      const finalDetail = (await finalRes.json()) as { status: string };
      expect(finalDetail.status).toBe("cancelled");
    });
  });
});
