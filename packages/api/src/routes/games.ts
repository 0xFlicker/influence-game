/**
 * Game REST API routes.
 *
 * Hono routes for the full game lifecycle:
 *   POST   /api/games           — create a new game
 *   GET    /api/games           — list games (with status filter)
 *   GET    /api/games/:id       — get game details
 *   POST   /api/games/:id/join  — join a game with agent config
 *   POST   /api/games/:id/start — start a game (min players met)
 *   POST   /api/games/:id/stop  — stop / cancel a running game
 *   GET    /api/games/:id/transcript — full transcript export
 */

import { Hono } from "hono";
import { eq, and, inArray, asc } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { GameStatus } from "../db/schema.js";

// ---------------------------------------------------------------------------
// Factory — creates a Hono sub-app with injected DB
// ---------------------------------------------------------------------------

export function createGameRoutes(db: DrizzleDB) {
  const app = new Hono();

  // -------------------------------------------------------------------------
  // POST /api/games — create a new game
  // -------------------------------------------------------------------------

  app.post("/api/games", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const {
      playerCount,
      modelTier,
      personaPool,
      fillStrategy,
      timingPreset,
      maxRounds,
      visibility,
      slotType,
    } = body;

    const minPlayers = 4;
    const maxPlayers = playerCount ?? 12;

    // Build GameConfig (engine-compatible)
    const timerPresets: Record<string, Record<string, number>> = {
      fast: {
        introduction: 15000,
        lobby: 15000,
        whisper: 20000,
        rumor: 15000,
        vote: 10000,
        power: 10000,
        council: 10000,
      },
      standard: {
        introduction: 30000,
        lobby: 30000,
        whisper: 45000,
        rumor: 30000,
        vote: 20000,
        power: 15000,
        council: 20000,
      },
      slow: {
        introduction: 60000,
        lobby: 60000,
        whisper: 90000,
        rumor: 60000,
        vote: 40000,
        power: 30000,
        council: 40000,
      },
    };

    const timers = timerPresets[timingPreset ?? "standard"] ?? timerPresets.standard;
    const computedMaxRounds =
      maxRounds === "auto" || maxRounds == null
        ? Math.max(10, (maxPlayers - 4) + 3 + 2)
        : maxRounds;

    const config = {
      timers,
      maxRounds: computedMaxRounds,
      minPlayers,
      maxPlayers,
      modelTier: modelTier ?? "budget",
      personaPool: personaPool ?? [],
      fillStrategy: fillStrategy ?? "balanced",
      visibility: visibility ?? "public",
      slotType: slotType ?? "all_ai",
    };

    const gameId = randomUUID();

    db.insert(schema.games)
      .values({
        id: gameId,
        config: JSON.stringify(config),
        status: "waiting",
        minPlayers,
        maxPlayers,
      })
      .run();

    // Game number = total count of games (this is the newest)
    const allGames = db.select({ id: schema.games.id }).from(schema.games).all();
    const gameNumber = allGames.length;

    return c.json({ id: gameId, gameNumber }, 201);
  });

  // -------------------------------------------------------------------------
  // GET /api/games — list games (with optional status filter)
  // -------------------------------------------------------------------------

  app.get("/api/games", async (c) => {
    const statusParam = c.req.query("status");

    let rows;
    if (statusParam) {
      const statuses = statusParam.split(",").map((s) => s.trim()) as GameStatus[];
      rows = db
        .select()
        .from(schema.games)
        .where(inArray(schema.games.status, statuses))
        .all();
    } else {
      rows = db.select().from(schema.games).all();
    }

    const summaries = rows.map((game) => {
      const config = JSON.parse(game.config);
      const players = db
        .select()
        .from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.gameId, game.id))
        .all();

      const result = db
        .select()
        .from(schema.gameResults)
        .where(eq(schema.gameResults.gameId, game.id))
        .all();

      const winnerPlayer = result[0]?.winnerId
        ? players.find((p) => p.id === result[0]!.winnerId)
        : null;

      return {
        id: game.id,
        gameNumber: 0, // Populated below
        status: game.status,
        playerCount: players.length,
        currentRound: 0,
        maxRounds: config.maxRounds ?? 10,
        currentPhase: game.status === "completed" ? "END" : "INIT",
        phaseTimeRemaining: null,
        alivePlayers: players.length,
        eliminatedPlayers: 0,
        modelTier: config.modelTier ?? "budget",
        visibility: config.visibility ?? "public",
        winner: winnerPlayer ? JSON.parse(winnerPlayer.persona).name : undefined,
        createdAt: game.createdAt,
        startedAt: game.startedAt ?? undefined,
        completedAt: game.endedAt ?? undefined,
      };
    });

    // Assign game numbers by creation order
    summaries.forEach((s, i) => {
      s.gameNumber = i + 1;
    });

    return c.json(summaries);
  });

  // -------------------------------------------------------------------------
  // GET /api/games/:id — get game details
  // -------------------------------------------------------------------------

  app.get("/api/games/:id", async (c) => {
    const gameId = c.req.param("id");

    const game = db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .all()[0];

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }

    const config = JSON.parse(game.config);

    const players = db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, gameId))
      .all();

    const result = db
      .select()
      .from(schema.gameResults)
      .where(eq(schema.gameResults.gameId, gameId))
      .all();

    const winnerPlayer = result[0]?.winnerId
      ? players.find((p) => p.id === result[0]!.winnerId)
      : null;

    const detail = {
      id: game.id,
      gameNumber: 0,
      status: game.status,
      currentRound: result[0]?.roundsPlayed ?? 0,
      maxRounds: config.maxRounds ?? 10,
      currentPhase: game.status === "completed" ? "END" : "INIT",
      players: players.map((p) => {
        const persona = JSON.parse(p.persona);
        return {
          id: p.id,
          name: persona.name ?? "Unknown",
          persona: persona.personality ?? persona.name ?? "Unknown",
          status: "alive" as const,
          shielded: false,
        };
      }),
      modelTier: config.modelTier ?? "budget",
      visibility: config.visibility ?? "public",
      winner: winnerPlayer ? JSON.parse(winnerPlayer.persona).name : undefined,
      createdAt: game.createdAt,
      startedAt: game.startedAt ?? undefined,
      completedAt: game.endedAt ?? undefined,
    };

    return c.json(detail);
  });

  // -------------------------------------------------------------------------
  // POST /api/games/:id/join — join a game with agent config
  // -------------------------------------------------------------------------

  app.post("/api/games/:id/join", async (c) => {
    const gameId = c.req.param("id");

    const game = db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .all()[0];

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }

    if (game.status !== "waiting") {
      return c.json({ error: "Game is not accepting players" }, 400);
    }

    const currentPlayers = db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, gameId))
      .all();

    if (currentPlayers.length >= game.maxPlayers) {
      return c.json({ error: "Game is full" }, 400);
    }

    const body = await c.req.json().catch(() => null);
    if (!body) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { agentName, personality, strategyHints, personaKey } = body;

    if (!agentName || !personality) {
      return c.json({ error: "agentName and personality are required" }, 400);
    }

    const playerId = randomUUID();
    const persona = {
      name: agentName,
      personality,
      strategyHints: strategyHints ?? null,
      personaKey: personaKey ?? null,
    };

    const config = JSON.parse(game.config);
    const agentConfig = {
      model:
        config.modelTier === "premium"
          ? "gpt-4o"
          : config.modelTier === "standard"
            ? "gpt-4o"
            : "gpt-4o-mini",
      temperature: 0.9,
    };

    db.insert(schema.gamePlayers)
      .values({
        id: playerId,
        gameId,
        persona: JSON.stringify(persona),
        agentConfig: JSON.stringify(agentConfig),
      })
      .run();

    return c.json({ playerId }, 201);
  });

  // -------------------------------------------------------------------------
  // POST /api/games/:id/start — start a game (min players met)
  // -------------------------------------------------------------------------

  app.post("/api/games/:id/start", async (c) => {
    const gameId = c.req.param("id");

    const game = db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .all()[0];

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }

    if (game.status !== "waiting") {
      return c.json({ error: "Game can only be started from waiting status" }, 400);
    }

    const currentPlayers = db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, gameId))
      .all();

    if (currentPlayers.length < game.minPlayers) {
      return c.json(
        {
          error: `Not enough players. Need at least ${game.minPlayers}, have ${currentPlayers.length}`,
        },
        400,
      );
    }

    db.update(schema.games)
      .set({
        status: "in_progress",
        startedAt: new Date().toISOString(),
      })
      .where(eq(schema.games.id, gameId))
      .run();

    return c.json({ status: "in_progress", players: currentPlayers.length });
  });

  // -------------------------------------------------------------------------
  // POST /api/games/:id/stop — stop / cancel a running game
  // -------------------------------------------------------------------------

  app.post("/api/games/:id/stop", async (c) => {
    const gameId = c.req.param("id");

    const game = db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .all()[0];

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }

    if (game.status !== "in_progress" && game.status !== "waiting") {
      return c.json({ error: "Game is not running or waiting" }, 400);
    }

    db.update(schema.games)
      .set({
        status: "cancelled",
        endedAt: new Date().toISOString(),
      })
      .where(eq(schema.games.id, gameId))
      .run();

    return c.json({ status: "cancelled" });
  });

  // -------------------------------------------------------------------------
  // GET /api/games/:id/transcript — full transcript export
  // -------------------------------------------------------------------------

  app.get("/api/games/:id/transcript", async (c) => {
    const gameId = c.req.param("id");

    const game = db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .all()[0];

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }

    const players = db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, gameId))
      .all();

    const playerNameMap = new Map<string, string>();
    for (const p of players) {
      const persona = JSON.parse(p.persona);
      playerNameMap.set(p.id, persona.name ?? "Unknown");
    }

    const rows = db
      .select()
      .from(schema.transcripts)
      .where(eq(schema.transcripts.gameId, gameId))
      .orderBy(asc(schema.transcripts.timestamp))
      .all();

    const entries = rows.map((row) => ({
      id: row.id,
      gameId: row.gameId,
      round: row.round,
      phase: row.phase,
      fromPlayerId: row.fromPlayerId,
      fromPlayerName: row.fromPlayerId ? (playerNameMap.get(row.fromPlayerId) ?? null) : null,
      scope: row.scope,
      toPlayerIds: row.toPlayerIds ? JSON.parse(row.toPlayerIds) : null,
      text: row.text,
      timestamp: row.timestamp,
    }));

    return c.json(entries);
  });

  return app;
}
