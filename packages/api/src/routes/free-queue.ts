/**
 * Free Game Queue API routes.
 *
 * Player endpoints:
 *   GET    /api/free-queue              — queue status (count, user's entry, next game time)
 *   POST   /api/free-queue/join         — add agent to queue
 *   DELETE /api/free-queue/leave        — remove user's entry
 *   GET    /api/free-queue/leaderboard  — top 100 by ELO
 *
 * Admin/scheduler endpoints:
 *   POST   /api/free-queue/draw         — daily draw: pick players, create game
 *   POST   /api/free-queue/start        — start today's free game
 */

import { Hono } from "hono";
import { eq, desc, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  requireAuth,
  requirePermission,
  optionalAuth,
  type AuthEnv,
} from "../middleware/auth.js";
import { generateUniqueSlug } from "../lib/slug.js";
import { pickAgentNames, pickArchetypes } from "@influence/engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNextFreeGameTime(): string {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(0, 0, 0, 0);
  // If past midnight UTC, next game is tomorrow
  if (now >= next) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.toISOString();
}

function getTodayUTCDate(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFreeQueueRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  // -------------------------------------------------------------------------
  // GET /api/free-queue — queue status
  // -------------------------------------------------------------------------

  app.get("/api/free-queue", optionalAuth(db), async (c) => {
    const allEntries = db
      .select()
      .from(schema.freeGameQueue)
      .all();

    const user = c.get("user");
    let userEntry = null;
    if (user) {
      const entry = allEntries.find((e) => e.userId === user.id);
      if (entry) {
        const profile = db
          .select({ name: schema.agentProfiles.name })
          .from(schema.agentProfiles)
          .where(eq(schema.agentProfiles.id, entry.agentProfileId))
          .all()[0];
        userEntry = {
          agentProfileId: entry.agentProfileId,
          agentName: profile?.name ?? "Unknown",
          joinedAt: entry.joinedAt,
        };
      }
    }

    return c.json({
      count: allEntries.length,
      userEntry,
      nextGameTime: getNextFreeGameTime(),
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/free-queue/join — add agent to queue
  // -------------------------------------------------------------------------

  app.post("/api/free-queue/join", requireAuth(db), async (c) => {
    const user = c.get("user");
    const body = await c.req.json().catch(() => null);
    if (!body?.agentProfileId) {
      return c.json({ error: "agentProfileId is required" }, 400);
    }

    const { agentProfileId } = body;

    // Validate agent profile exists and belongs to user
    const profile = db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, agentProfileId))
      .all()[0];

    if (!profile) {
      return c.json({ error: "Agent profile not found" }, 404);
    }
    if (profile.userId !== user.id) {
      return c.json({ error: "Agent profile does not belong to you" }, 403);
    }

    // Check if user already has an entry (1 per user)
    const existing = db
      .select()
      .from(schema.freeGameQueue)
      .where(eq(schema.freeGameQueue.userId, user.id))
      .all()[0];

    if (existing) {
      return c.json({ error: "You already have an agent in the queue. Leave first to switch." }, 409);
    }

    const id = randomUUID();
    db.insert(schema.freeGameQueue)
      .values({
        id,
        userId: user.id,
        agentProfileId,
      })
      .run();

    return c.json({
      id,
      agentProfileId,
      agentName: profile.name,
    }, 201);
  });

  // -------------------------------------------------------------------------
  // DELETE /api/free-queue/leave — remove user's entry
  // -------------------------------------------------------------------------

  app.delete("/api/free-queue/leave", requireAuth(db), async (c) => {
    const user = c.get("user");

    const entry = db
      .select()
      .from(schema.freeGameQueue)
      .where(eq(schema.freeGameQueue.userId, user.id))
      .all()[0];

    if (!entry) {
      return c.json({ error: "You are not in the queue" }, 404);
    }

    db.delete(schema.freeGameQueue)
      .where(eq(schema.freeGameQueue.id, entry.id))
      .run();

    return c.json({ removed: true });
  });

  // -------------------------------------------------------------------------
  // GET /api/free-queue/leaderboard — top 100 by ELO
  // -------------------------------------------------------------------------

  app.get("/api/free-queue/leaderboard", async (c) => {
    const ratings = db
      .select()
      .from(schema.freeTrackRatings)
      .orderBy(desc(schema.freeTrackRatings.rating))
      .limit(100)
      .all();

    const leaderboard = ratings.map((r, i) => {
      const profile = db
        .select({ name: schema.agentProfiles.name, avatarUrl: schema.agentProfiles.avatarUrl })
        .from(schema.agentProfiles)
        .where(eq(schema.agentProfiles.id, r.agentProfileId))
        .all()[0];

      return {
        rank: i + 1,
        agentProfileId: r.agentProfileId,
        agentName: profile?.name ?? "Unknown",
        avatarUrl: profile?.avatarUrl ?? null,
        rating: r.rating,
        gamesPlayed: r.gamesPlayed,
        gamesWon: r.gamesWon,
        winRate: r.gamesPlayed > 0 ? r.gamesWon / r.gamesPlayed : 0,
        peakRating: r.peakRating,
      };
    });

    return c.json(leaderboard);
  });

  // -------------------------------------------------------------------------
  // POST /api/free-queue/draw — daily draw (admin/scheduler)
  // -------------------------------------------------------------------------

  app.post("/api/free-queue/draw", requireAuth(db), requirePermission("schedule_free_game"), async (c) => {
    const today = getTodayUTCDate();

    // Idempotent guard: check if a free game already exists for today
    const existingFreeGames = db
      .select()
      .from(schema.games)
      .where(eq(schema.games.trackType, "free"))
      .all()
      .filter((g) => g.createdAt.startsWith(today));

    if (existingFreeGames.length > 0) {
      return c.json({
        drawn: false,
        reason: "Free game already exists for today",
        gameId: existingFreeGames[0]!.id,
        gameSlug: existingFreeGames[0]!.slug,
      });
    }

    // Get all queue entries
    const entries = db
      .select()
      .from(schema.freeGameQueue)
      .all();

    if (entries.length < 2) {
      return c.json({
        drawn: false,
        reason: `Not enough players in queue (${entries.length}). Need at least 2.`,
      });
    }

    // Shuffle and pick up to 12
    const shuffled = entries.sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, Math.min(entries.length, 12));
    const maxPlayers = 12;
    const minPlayers = 4;

    // Create the game
    const gameId = randomUUID();
    const slug = generateUniqueSlug((s) => {
      const existing = db.select({ id: schema.games.id }).from(schema.games).where(eq(schema.games.slug, s)).all();
      return existing.length > 0;
    });

    const timerPresets = {
      introduction: 30000,
      lobby: 30000,
      whisper: 45000,
      rumor: 30000,
      vote: 20000,
      power: 15000,
      council: 20000,
    };

    const computedMaxRounds = Math.max(10, (maxPlayers - 4) + 3 + 2);
    const config = {
      timers: timerPresets,
      maxRounds: computedMaxRounds,
      minPlayers,
      maxPlayers,
      modelTier: "budget",
      personaPool: [],
      fillStrategy: "balanced",
      visibility: "public",
      slotType: "mixed",
      viewerMode: "live",
    };

    const user = c.get("user");

    db.insert(schema.games)
      .values({
        id: gameId,
        slug,
        config: JSON.stringify(config),
        status: "waiting",
        trackType: "free",
        minPlayers,
        maxPlayers,
        createdById: user?.id ?? null,
      })
      .run();

    // Add picked players to the game
    const addedPlayers: Array<{ playerId: string; userId: string; agentProfileId: string; agentName: string }> = [];

    for (const entry of picked) {
      const profile = db
        .select()
        .from(schema.agentProfiles)
        .where(eq(schema.agentProfiles.id, entry.agentProfileId))
        .all()[0];

      if (!profile) continue;

      const playerId = randomUUID();
      const agentModel = "gpt-4o-mini"; // budget tier
      const persona = {
        name: profile.name,
        personality: profile.personality,
        strategyHints: profile.strategyStyle,
        personaKey: profile.personaKey,
      };

      db.insert(schema.gamePlayers)
        .values({
          id: playerId,
          gameId,
          userId: entry.userId,
          agentProfileId: profile.id,
          persona: JSON.stringify(persona),
          agentConfig: JSON.stringify({ model: agentModel, temperature: 0.9 }),
        })
        .run();

      addedPlayers.push({
        playerId,
        userId: entry.userId,
        agentProfileId: profile.id,
        agentName: profile.name,
      });
    }

    // Fill remaining slots with AI if less than maxPlayers
    const slotsToFill = maxPlayers - addedPlayers.length;
    if (slotsToFill > 0) {
      const existingNames = addedPlayers.map((p) => p.agentName);
      const names = pickAgentNames(slotsToFill, existingNames);
      const archetypes = pickArchetypes(slotsToFill, []);

      for (let i = 0; i < slotsToFill; i++) {
        const name = names[i] ?? `Agent-${i + 1}`;
        const archetype = archetypes[i] ?? "strategic";
        const aiPlayerId = randomUUID();

        const persona = {
          name,
          personality: archetype,
          strategyHints: null,
          personaKey: archetype,
        };

        db.insert(schema.gamePlayers)
          .values({
            id: aiPlayerId,
            gameId,
            userId: null,
            persona: JSON.stringify(persona),
            agentConfig: JSON.stringify({ model: "gpt-4o-mini", temperature: 0.9 }),
          })
          .run();
      }
    }

    // Remove picked entries from queue
    for (const entry of picked) {
      db.delete(schema.freeGameQueue)
        .where(eq(schema.freeGameQueue.id, entry.id))
        .run();
    }

    return c.json({
      drawn: true,
      gameId,
      gameSlug: slug,
      playersDrawn: addedPlayers.length,
      aiPlayersFilled: slotsToFill,
      totalPlayers: maxPlayers,
    }, 201);
  });

  // -------------------------------------------------------------------------
  // POST /api/free-queue/start — start today's free game (admin/scheduler)
  // -------------------------------------------------------------------------

  app.post("/api/free-queue/start", requireAuth(db), requirePermission("schedule_free_game"), async (c) => {
    const today = getTodayUTCDate();

    // Find today's free game in waiting status
    const freeGames = db
      .select()
      .from(schema.games)
      .where(and(eq(schema.games.trackType, "free"), eq(schema.games.status, "waiting")))
      .all()
      .filter((g) => g.createdAt.startsWith(today));

    if (freeGames.length === 0) {
      return c.json({ error: "No waiting free game found for today. Run draw first." }, 404);
    }

    const game = freeGames[0]!;

    // Delegate to the start endpoint pattern
    const { startGame, isGameRunning } = await import("../services/game-lifecycle.js");

    if (isGameRunning(game.id)) {
      return c.json({ error: "Game is already running" }, 400);
    }

    const currentPlayers = db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, game.id))
      .all();

    if (currentPlayers.length < game.minPlayers) {
      return c.json({
        error: `Not enough players. Need at least ${game.minPlayers}, have ${currentPlayers.length}`,
      }, 400);
    }

    db.update(schema.games)
      .set({
        status: "in_progress",
        startedAt: new Date().toISOString(),
      })
      .where(eq(schema.games.id, game.id))
      .run();

    const result = await startGame(db, game.id);
    if (result.error) {
      db.update(schema.games)
        .set({ status: "waiting" as const, startedAt: null })
        .where(eq(schema.games.id, game.id))
        .run();
      return c.json({ error: result.error }, 500);
    }

    return c.json({
      started: true,
      gameId: game.id,
      gameSlug: game.slug,
      players: currentPlayers.length,
    });
  });

  return app;
}
