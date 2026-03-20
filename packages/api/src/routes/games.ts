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
import { eq, inArray, asc, or } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { GameStatus } from "../db/schema.js";
import {
  requireAuth,
  requirePermission,
  type AuthEnv,
} from "../middleware/auth.js";
import { startGame, isGameRunning } from "../services/game-lifecycle.js";
import { generateUniqueSlug } from "../lib/slug.js";
import { generatePersona, pickAgentNames, pickArchetypes } from "@influence/engine";
import type { Personality } from "@influence/engine";
import OpenAI from "openai";

// ---------------------------------------------------------------------------
// Factory — creates a Hono sub-app with injected DB
// ---------------------------------------------------------------------------

export function createGameRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  // -------------------------------------------------------------------------
  // POST /api/games — create a new game
  // -------------------------------------------------------------------------

  app.post("/api/games", requireAuth(db), requirePermission("create_game"), async (c) => {
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
      viewerMode,
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

    // Validate viewerMode — only "live" and "speedrun" are valid at creation time
    const validCreationModes = ["live", "speedrun"];
    const resolvedViewerMode = validCreationModes.includes(viewerMode)
      ? viewerMode
      : "speedrun"; // Default for admin-created games

    const resolvedModelTier = modelTier ?? "budget";

    const config = {
      timers,
      maxRounds: computedMaxRounds,
      minPlayers,
      maxPlayers,
      modelTier: resolvedModelTier,
      personaPool: personaPool ?? [],
      fillStrategy: fillStrategy ?? "balanced",
      visibility: visibility ?? "public",
      slotType: slotType ?? "all_ai",
      viewerMode: resolvedViewerMode,
    };

    const gameId = randomUUID();

    const slug = generateUniqueSlug((s) => {
      const existing = db.select({ id: schema.games.id }).from(schema.games).where(eq(schema.games.slug, s)).all();
      return existing.length > 0;
    });

    const user = c.get("user");
    db.insert(schema.games)
      .values({
        id: gameId,
        slug,
        config: JSON.stringify(config),
        status: "waiting",
        minPlayers,
        maxPlayers,
        createdById: user?.id ?? null,
      })
      .run();

    // Game number = total count of games (this is the newest)
    const allGames = db.select({ id: schema.games.id }).from(schema.games).all();
    const gameNumber = allGames.length;

    return c.json({ id: gameId, slug, gameNumber }, 201);
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
        slug: game.slug ?? undefined,
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
        viewerMode: config.viewerMode ?? "speedrun",
        winner: winnerPlayer ? JSON.parse(winnerPlayer.persona).name : undefined,
        errorInfo: config.errorInfo ?? undefined,
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
    const idOrSlug = c.req.param("id");

    // Support lookup by UUID or human-readable slug
    const game = db
      .select()
      .from(schema.games)
      .where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug)))
      .all()[0];

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }

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

    // Compute game number from creation order
    const allGamesOrdered = db
      .select({ id: schema.games.id, createdAt: schema.games.createdAt })
      .from(schema.games)
      .all()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const gameNumber = allGamesOrdered.findIndex((g) => g.id === game.id) + 1;

    const detail = {
      id: game.id,
      slug: game.slug ?? undefined,
      gameNumber,
      status: game.status,
      currentRound: result[0]?.roundsPlayed ?? 0,
      maxRounds: config.maxRounds ?? 10,
      currentPhase: game.status === "completed" ? "END" : "INIT",
      players: players.map((p) => {
        const persona = JSON.parse(p.persona);
        // Resolve avatar from linked agent profile if available
        let avatarUrl: string | undefined;
        if (p.agentProfileId) {
          const profile = db
            .select({ avatarUrl: schema.agentProfiles.avatarUrl })
            .from(schema.agentProfiles)
            .where(eq(schema.agentProfiles.id, p.agentProfileId))
            .all()[0];
          avatarUrl = profile?.avatarUrl ?? undefined;
        }
        return {
          id: p.id,
          name: persona.name ?? "Unknown",
          persona: persona.personality ?? persona.name ?? "Unknown",
          status: "alive" as const,
          shielded: false,
          avatarUrl,
        };
      }),
      modelTier: config.modelTier ?? "budget",
      visibility: config.visibility ?? "public",
      viewerMode: config.viewerMode ?? "speedrun",
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

  app.post("/api/games/:id/join", requireAuth(db), async (c) => {
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

    const { agentName, personality, strategyHints, personaKey, agentProfileId } = body;

    const joinUser = c.get("user");

    // -----------------------------------------------------------------------
    // Resolve agent identity
    // -----------------------------------------------------------------------
    let resolvedName: string;
    let resolvedPersonality: string;
    let resolvedStrategyHints: string | null = strategyHints ?? null;
    let resolvedPersonaKey: string | null = personaKey ?? null;
    let resolvedProfileId: string | null = null;

    if (agentProfileId) {
      const profile = db
        .select()
        .from(schema.agentProfiles)
        .where(eq(schema.agentProfiles.id, agentProfileId))
        .all()[0];

      if (!profile) {
        return c.json({ error: "Agent profile not found" }, 404);
      }

      if (profile.userId !== joinUser?.id) {
        return c.json({ error: "Agent profile does not belong to you" }, 403);
      }

      resolvedName = profile.name;
      resolvedPersonality = profile.personality;
      resolvedStrategyHints = profile.strategyStyle;
      resolvedPersonaKey = profile.personaKey;
      resolvedProfileId = profile.id;
    } else {
      if (!agentName || !personality) {
        return c.json({ error: "agentName and personality are required (or provide agentProfileId)" }, 400);
      }
      resolvedName = agentName;
      resolvedPersonality = personality;
    }

    // -----------------------------------------------------------------------
    // Resolve model from game config
    // -----------------------------------------------------------------------
    const gameConfig = JSON.parse(game.config);
    const agentModel =
      gameConfig.modelTier === "premium"
        ? "gpt-4o"
        : gameConfig.modelTier === "standard"
          ? "gpt-4o"
          : "gpt-4o-mini";

    const playerId = randomUUID();
    const persona = {
      name: resolvedName,
      personality: resolvedPersonality,
      strategyHints: resolvedStrategyHints,
      personaKey: resolvedPersonaKey,
    };

    const agentConfig = {
      model: agentModel,
      temperature: 0.9,
    };

    db.insert(schema.gamePlayers)
      .values({
        id: playerId,
        gameId,
        userId: joinUser?.id ?? null,
        agentProfileId: resolvedProfileId,
        persona: JSON.stringify(persona),
        agentConfig: JSON.stringify(agentConfig),
      })
      .run();

    return c.json({ playerId }, 201);
  });

  // -------------------------------------------------------------------------
  // POST /api/games/:id/fill — fill remaining slots with AI players
  // -------------------------------------------------------------------------

  app.post("/api/games/:id/fill", requireAuth(db), requirePermission("fill_game"), async (c) => {
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
      return c.json({ error: "Game is not in waiting status" }, 400);
    }

    // Generate personas outside the transaction (may involve LLM calls)
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const openai = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;

    // Pre-read to estimate how many personas to generate
    const estimatedPlayers = db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, gameId))
      .all();

    const estimatedSlots = game.maxPlayers - estimatedPlayers.length;
    if (estimatedSlots <= 0) {
      return c.json({ error: "Game is already full" }, 400);
    }

    const existingNames = estimatedPlayers.map((p) => {
      const persona = JSON.parse(p.persona);
      return persona.name as string;
    });
    const existingArchetypes = estimatedPlayers.map((p) => {
      const persona = JSON.parse(p.persona);
      return (persona.personaKey ?? persona.personality ?? "strategic") as Personality;
    });

    const names = pickAgentNames(estimatedSlots, existingNames);
    const archetypes = pickArchetypes(estimatedSlots, existingArchetypes);

    const config = JSON.parse(game.config);
    const agentModel =
      config.modelTier === "premium"
        ? "gpt-4o"
        : config.modelTier === "standard"
          ? "gpt-4o"
          : "gpt-4o-mini";

    // Pre-generate personas (LLM calls can't run inside sync SQLite transaction)
    const generatedPersonas: Array<{ personality: string; strategyHints: string }> = [];
    for (let i = 0; i < estimatedSlots; i++) {
      const name = names[i] ?? `Agent-${i + 1}`;
      const archetype = archetypes[i] ?? "strategic";
      let personalityBlurb = "";
      let strategyHints = "";
      if (openai) {
        try {
          const generated = await generatePersona(openai, name, archetype, "gpt-4o-mini");
          personalityBlurb = generated.personality;
          strategyHints = generated.strategyHints;
        } catch (err) {
          // Non-fatal: engine uses hardcoded prompts as fallback
          console.warn(`[games] Persona generation failed for ${name}:`, err instanceof Error ? err.message : err);
        }
      }
      generatedPersonas.push({ personality: personalityBlurb, strategyHints });
    }

    // Atomic transaction: re-count players and insert only what fits
    const addedPlayers: Array<{ id: string; name: string; archetype: string }> = [];

    db.transaction((tx) => {
      const currentPlayers = tx
        .select()
        .from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.gameId, gameId))
        .all();

      const slotsToFill = game.maxPlayers - currentPlayers.length;

      for (let i = 0; i < slotsToFill && i < estimatedSlots; i++) {
        const name = names[i] ?? `Agent-${i + 1}`;
        const archetype = archetypes[i] ?? "strategic";
        const gen = generatedPersonas[i] ?? { personality: "", strategyHints: "" };

        const playerId = randomUUID();
        const persona = {
          name,
          personality: archetype,
          strategyHints: gen.strategyHints || null,
          personaKey: archetype,
          personalityBlurb: gen.personality || null,
        };

        const agentConfig = {
          model: agentModel,
          temperature: 0.9,
        };

        tx.insert(schema.gamePlayers)
          .values({
            id: playerId,
            gameId,
            userId: null,
            persona: JSON.stringify(persona),
            agentConfig: JSON.stringify(agentConfig),
          })
          .run();

        addedPlayers.push({ id: playerId, name, archetype });
      }
    });

    if (addedPlayers.length === 0) {
      return c.json({ error: "Game is already full" }, 400);
    }

    return c.json({
      filled: addedPlayers.length,
      totalPlayers: estimatedPlayers.length + addedPlayers.length,
      maxPlayers: game.maxPlayers,
      players: addedPlayers,
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/games/:id/start — start a game (min players met)
  // -------------------------------------------------------------------------

  app.post("/api/games/:id/start", requireAuth(db), requirePermission("start_game"), async (c) => {
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

    // Check if already running (race condition guard)
    if (isGameRunning(gameId)) {
      return c.json({ error: "Game is already running" }, 400);
    }

    db.update(schema.games)
      .set({
        status: "in_progress",
        startedAt: new Date().toISOString(),
      })
      .where(eq(schema.games.id, gameId))
      .run();

    // Await startGame to catch configuration errors (missing API key, etc.)
    // before returning success to the client. The actual game execution
    // (runGameAsync) runs in the background after this returns.
    const result = await startGame(db, gameId);
    if (result.error) {
      // Revert game status — startup failed before execution began
      db.update(schema.games)
        .set({ status: "waiting" as const, startedAt: null })
        .where(eq(schema.games.id, gameId))
        .run();
      return c.json({ error: result.error }, 500);
    }

    return c.json({ status: "in_progress", players: currentPlayers.length });
  });

  // -------------------------------------------------------------------------
  // POST /api/games/:id/stop — stop / cancel a running game
  // -------------------------------------------------------------------------

  app.post("/api/games/:id/stop", requireAuth(db), requirePermission("stop_game"), async (c) => {
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
  // GET /api/player/games — authenticated player's game history
  // -------------------------------------------------------------------------

  app.get("/api/player/games", requireAuth(db), async (c) => {
    const user = c.get("user");

    const playerRecords = db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.userId, user.id))
      .all();

    if (playerRecords.length === 0) {
      return c.json([]);
    }

    // Build game number map from all games ordered by creation
    const allGames = db
      .select({ id: schema.games.id, createdAt: schema.games.createdAt })
      .from(schema.games)
      .all()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const gameNumberMap = new Map(allGames.map((g, i) => [g.id, i + 1]));

    const results = playerRecords
      .map((playerRecord) => {
        const game = db
          .select()
          .from(schema.games)
          .where(eq(schema.games.id, playerRecord.gameId))
          .all()[0];
        if (!game) return null;

        const config = JSON.parse(game.config);
        const persona = JSON.parse(playerRecord.persona);

        const allPlayers = db
          .select()
          .from(schema.gamePlayers)
          .where(eq(schema.gamePlayers.gameId, game.id))
          .all();
        const totalPlayers = allPlayers.length;

        const result = db
          .select()
          .from(schema.gameResults)
          .where(eq(schema.gameResults.gameId, game.id))
          .all()[0];

        const isWinner = result?.winnerId === playerRecord.id;

        return {
          gameId: game.id,
          gameSlug: game.slug ?? undefined,
          gameNumber: gameNumberMap.get(game.id) ?? 0,
          agentName: persona.name ?? "Unknown",
          persona: persona.personaKey ?? "strategic",
          placement: isWinner ? 1 : totalPlayers,
          totalPlayers,
          eliminated: game.status === "completed" && !isWinner,
          winner: isWinner,
          rounds: result?.roundsPlayed ?? 0,
          completedAt: game.endedAt ?? game.createdAt,
          modelTier: config.modelTier ?? "budget",
        };
      })
      .filter(Boolean);

    return c.json(results);
  });

  // -------------------------------------------------------------------------
  // GET /api/games/:id/transcript — full transcript export
  // -------------------------------------------------------------------------

  app.get("/api/games/:id/transcript", async (c) => {
    const idOrSlug = c.req.param("id");

    const game = db
      .select()
      .from(schema.games)
      .where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug)))
      .all()[0];

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }

    const gameId = game.id;

    const players = db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, gameId))
      .all();

    // Build lookup by both UUID and name: the engine stores player names (not UUIDs)
    // in transcript.from, so we need both keys to resolve fromPlayerName correctly.
    const playerNameMap = new Map<string, string>();
    for (const p of players) {
      const persona = JSON.parse(p.persona);
      const name = persona.name as string | undefined;
      if (name) {
        playerNameMap.set(p.id, name);   // UUID → name (future-proof)
        playerNameMap.set(name, name);   // name → name (current engine behavior)
      }
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
