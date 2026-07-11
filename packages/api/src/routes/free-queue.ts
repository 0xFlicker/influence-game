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
import { eq, desc, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  requireAuth,
  requirePermission,
  optionalAuth,
  type AuthEnv,
} from "../middleware/auth.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import { generateUniqueSlug } from "../lib/slug.js";
import { getPublicDisplayName } from "../lib/display-name.js";
import {
  pickAgentNames,
  pickArchetypes,
  resolveModelForTier,
} from "@influence/engine";
import { startGame, validateGameStartReadiness } from "../services/game-lifecycle.js";
import {
  acquireGameRunOwner,
  markOwnerStartupFailed,
} from "../services/game-ownership.js";
import { getRedactedKernelHealth } from "../services/game-kernel-health.js";
import { tryRefreshGameWatchStateSummary } from "../services/game-watch-state-summary.js";
import { bindFreeGameToActiveSeason } from "../services/seasons.js";

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


// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFreeQueueRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  // -------------------------------------------------------------------------
  // GET /api/free-queue — queue status
  // -------------------------------------------------------------------------

  app.get("/api/free-queue", optionalAuth(db), async (c) => {
    const allEntries = await db
      .select()
      .from(schema.freeGameQueue);

    const user = c.get("user");
    let userEntry = null;
    if (user) {
      const entry = allEntries.find((e) => e.userId === user.id);
      if (entry) {
        const profile = (await db
          .select({ name: schema.agentProfiles.name })
          .from(schema.agentProfiles)
          .where(eq(schema.agentProfiles.id, entry.agentProfileId)))[0];
        userEntry = {
          agentProfileId: entry.agentProfileId,
          agentName: profile?.name ?? "Unknown",
          joinedAt: entry.joinedAt,
        };
      }
    }

    const todayGame = (await db
      .select({
        id: schema.games.id,
        slug: schema.games.slug,
        status: schema.games.status,
        createdAt: schema.games.createdAt,
      })
      .from(schema.games)
      .where(eq(schema.games.trackType, "free"))
      .orderBy(desc(schema.games.createdAt))
      .limit(1))[0];

    const gameNumber = todayGame
      ? Number((await db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.games)
          .where(sql`${schema.games.createdAt} <= ${todayGame.createdAt}`))[0]?.count ?? 0)
      : 0;

    return c.json({
      count: allEntries.length,
      userEntry,
      nextGameTime: getNextFreeGameTime(),
      todayGame: todayGame
        ? {
            id: todayGame.id,
            slug: todayGame.slug ?? todayGame.id,
            gameNumber,
            status: todayGame.status,
            kernelHealth: await getRedactedKernelHealth(db, todayGame.id),
          }
        : null,
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/free-queue/join — add agent to queue
  // -------------------------------------------------------------------------

  app.post("/api/free-queue/join", requireAuth(db), async (c) => {
    const user = c.get("user");
    const body = await parseJsonBody(c, "POST /api/free-queue/join");
    if (!body?.agentProfileId) {
      return c.json({ error: "agentProfileId is required" }, 400);
    }

    const { agentProfileId } = body;

    // Validate agent profile exists and belongs to user
    const profile = (await db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, agentProfileId)))[0];

    if (!profile) {
      return c.json({ error: "Agent profile not found" }, 404);
    }
    if (profile.userId !== user.id) {
      return c.json({ error: "Agent profile does not belong to you" }, 403);
    }

    // Check if user already has an entry (1 per user)
    const existing = (await db
      .select()
      .from(schema.freeGameQueue)
      .where(eq(schema.freeGameQueue.userId, user.id)))[0];

    if (existing) {
      return c.json({ error: "You already have an agent in the queue. Leave first to switch." }, 409);
    }

    const id = randomUUID();
    await db.insert(schema.freeGameQueue)
      .values({
        id,
        userId: user.id,
        agentProfileId,
      });

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

    const entry = (await db
      .select()
      .from(schema.freeGameQueue)
      .where(eq(schema.freeGameQueue.userId, user.id)))[0];

    if (!entry) {
      return c.json({ error: "You are not in the queue" }, 404);
    }

    await db.delete(schema.freeGameQueue)
      .where(eq(schema.freeGameQueue.id, entry.id));

    return c.json({ removed: true });
  });

  // -------------------------------------------------------------------------
  // GET /api/free-queue/leaderboard — account-level leaderboard (top 100 by ELO)
  // -------------------------------------------------------------------------

  app.get("/api/free-queue/leaderboard", async (c) => {
    const rows = await db
      .select({
        id: schema.users.id,
        displayName: schema.users.displayName,
        email: schema.users.email,
        walletAddress: schema.users.walletAddress,
        rating: schema.users.rating,
        gamesPlayed: schema.users.gamesPlayed,
        gamesWon: schema.users.gamesWon,
        peakRating: schema.users.peakRating,
      })
      .from(schema.users)
      .orderBy(desc(schema.users.rating))
      .limit(100);

    const leaderboard = rows
      .filter((r) => r.gamesPlayed > 0)
      .map((r, i) => ({
        rank: i + 1,
        userId: r.id,
        displayName: getPublicDisplayName(r),
        rating: r.rating,
        gamesPlayed: r.gamesPlayed,
        gamesWon: r.gamesWon,
        winRate: r.gamesPlayed > 0 ? r.gamesWon / r.gamesPlayed : 0,
        peakRating: r.peakRating,
      }));

    return c.json(leaderboard);
  });

  // -------------------------------------------------------------------------
  // POST /api/free-queue/draw — daily draw (admin/scheduler)
  // -------------------------------------------------------------------------

  app.post("/api/free-queue/draw", requireAuth(db), requirePermission("schedule_free_game"), async (c) => {
    const maxPlayers = 12;
    const minPlayers = 4;

    // Create the game
    const gameId = randomUUID();
    const slug = await generateUniqueSlug(async (s) => {
      const existing = await db.select({ id: schema.games.id }).from(schema.games).where(eq(schema.games.slug, s));
      return existing.length > 0;
    });

    const timerPresets = {
      introduction: 30000,
      lobby: 30000,
      mingle: 45000,
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

    const addedPlayers: Array<{ playerId: string; userId: string; agentProfileId: string; agentName: string }> = [];
    let slotsToFill = maxPlayers;
    const admission = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('influence-daily-free-draw'))`);
      const existingDraw = (await tx.select({ id: schema.games.id, slug: schema.games.slug })
        .from(schema.games)
        .where(and(
          eq(schema.games.trackType, "free"),
          sql`${schema.games.createdAt}::timestamptz >= date_trunc('day', now())`,
        ))
        .orderBy(desc(schema.games.createdAt))
        .limit(1))[0];
      if (existingDraw) {
        return {
          drawn: false as const,
          reason: "Today's Daily Free game has already been drawn.",
          gameId: existingDraw.id,
          gameSlug: existingDraw.slug,
        };
      }
      const entries = await tx.select().from(schema.freeGameQueue);
      if (entries.length < 2) {
        return {
          drawn: false as const,
          reason: `Not enough players in queue (${entries.length}). Need at least 2.`,
        };
      }
      const shuffled = entries.sort(() => Math.random() - 0.5);
      const picked = shuffled.slice(0, Math.min(entries.length, 12));
      await tx.insert(schema.games).values({
          id: gameId,
          slug,
          config: JSON.stringify(config),
          status: "waiting",
          trackType: "free",
          cognitiveArtifactCaptureVersion: 1,
          minPlayers,
          maxPlayers,
          createdById: user?.id ?? null,
        });

      // Add picked players to the game.
      for (const entry of picked) {
        const profile = (await tx
          .select()
          .from(schema.agentProfiles)
          .where(eq(schema.agentProfiles.id, entry.agentProfileId)))[0];

        if (!profile) continue;

        const playerId = randomUUID();
        const agentModel = resolveModelForTier("budget");
        const persona = {
          name: profile.name,
          personality: profile.personality,
          backstory: profile.backstory,
          strategyHints: profile.strategyStyle,
          personaKey: profile.personaKey,
        };

        await tx.insert(schema.gamePlayers).values({
            id: playerId,
            gameId,
            userId: entry.userId,
            agentProfileId: profile.id,
            persona: JSON.stringify(persona),
            agentConfig: JSON.stringify({ model: agentModel, temperature: 0.9 }),
          });

        addedPlayers.push({
          playerId,
          userId: entry.userId,
          agentProfileId: profile.id,
          agentName: profile.name,
        });
      }

      // Fill remaining slots with House agents.
      slotsToFill = maxPlayers - addedPlayers.length;
      if (slotsToFill > 0) {
        const existingNames = addedPlayers.map((p) => p.agentName);
        const names = pickAgentNames(slotsToFill, existingNames);
        const archetypes = pickArchetypes(slotsToFill, []);

        for (let i = 0; i < slotsToFill; i++) {
          const name = names[i] ?? `Agent-${i + 1}`;
          const archetype = archetypes[i] ?? "strategic";
          const aiPlayerId = randomUUID();
          await tx.insert(schema.gamePlayers).values({
              id: aiPlayerId,
              gameId,
              userId: null,
              persona: JSON.stringify({
                name,
                personality: archetype,
                strategyHints: null,
                personaKey: archetype,
              }),
              agentConfig: JSON.stringify({ model: resolveModelForTier("budget"), temperature: 0.9 }),
            });
        }
      }

      for (const entry of picked) {
        await tx.delete(schema.freeGameQueue).where(eq(schema.freeGameQueue.id, entry.id));
      }
      return {
        drawn: true as const,
        ...(await bindFreeGameToActiveSeason(tx, gameId)),
      };
    });
    if (!admission.drawn) return c.json(admission);
    await tryRefreshGameWatchStateSummary(db, gameId, "free_queue_draw");

    return c.json({
      drawn: true,
      gameId,
      gameSlug: slug,
      playersDrawn: addedPlayers.length,
      aiPlayersFilled: slotsToFill,
      totalPlayers: maxPlayers,
      rated: admission.rated,
      seasonId: admission.seasonId,
    }, 201);
  });

  // -------------------------------------------------------------------------
  // POST /api/free-queue/start — start today's free game (admin/scheduler)
  // -------------------------------------------------------------------------

  app.post("/api/free-queue/start", requireAuth(db), requirePermission("schedule_free_game"), async (c) => {
    // Find any waiting free game (most recent first)
    const freeGames = await db
      .select()
      .from(schema.games)
      .where(and(eq(schema.games.trackType, "free"), eq(schema.games.status, "waiting")))
      .orderBy(desc(schema.games.createdAt))
      .limit(1);

    if (freeGames.length === 0) {
      return c.json({ error: "No waiting free game found. Run draw first." }, 404);
    }

    const game = freeGames[0]!;

    const currentPlayers = await db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, game.id));

    if (currentPlayers.length < game.minPlayers) {
      return c.json({
        error: `Not enough players. Need at least ${game.minPlayers}, have ${currentPlayers.length}`,
      }, 400);
    }

    const readiness = await validateGameStartReadiness(db, game.id);
    if (readiness.error) {
      return c.json({ error: readiness.error }, 500);
    }

    const owner = await acquireGameRunOwner(db, game.id);
    if (!owner.ok) {
      return c.json({ error: owner.error }, owner.statusCode);
    }
    await tryRefreshGameWatchStateSummary(db, game.id, "free_queue_started");

    let startupError: string | undefined;
    try {
      const result = await startGame(db, game.id, owner.claim.ownerEpoch);
      startupError = result.error;
    } catch (error) {
      startupError = error instanceof Error ? error.message : String(error);
    }
    if (startupError) {
      await markOwnerStartupFailed(db, game.id, owner.claim.ownerEpoch, startupError);
      await tryRefreshGameWatchStateSummary(db, game.id, "free_queue_startup_failed");
      return c.json({ error: startupError }, 500);
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
