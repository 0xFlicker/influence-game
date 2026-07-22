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
import { eq, desc, and, inArray, sql } from "drizzle-orm";
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
import { getGameSeasonIdentityMap } from "../lib/game-season.js";
import {
  getPublicPlayerIdentityMap,
  publicPlayerDisplayName,
} from "../services/public-player-identity.js";
import { gameOwnerClaimErrorBody } from "../lib/game-owner-claim-response.js";
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
import {
  currentCaptureVersionFields,
  initialGameTranscriptStateValues,
} from "../services/transcript-capture.js";
import { getRedactedKernelHealth } from "../services/game-kernel-health.js";
import { tryRefreshGameWatchStateSummary } from "../services/game-watch-state-summary.js";
import { bindFreeGameToActiveSeason } from "../services/seasons.js";
import {
  deferDailyFreePrompt,
  acquireDailyFreeLocks,
  getQueueStatus,
  joinQueue,
  leaveQueue,
  QueueEnrollmentError,
} from "../services/queue-enrollment.js";
import { AgentProfileManagementError } from "../services/agent-profile-management.js";
import { admitOwnedSeatInTransaction } from "../services/owned-seat-projection.js";

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

export function createFreeQueueRoutes(
  db: DrizzleDB,
  dependencies: { startGame?: typeof startGame } = {},
) {
  const app = new Hono<AuthEnv>();
  const startOwnedGame = dependencies.startGame ?? startGame;

  // -------------------------------------------------------------------------
  // GET /api/free-queue — queue status
  // -------------------------------------------------------------------------

  app.get("/api/free-queue", optionalAuth(db), async (c) => {
    const user = c.get("user");
    let userEntry = null;
    let personalized = null;
    if (user) {
      personalized = await getQueueStatus(db, { userId: user.id });
      const entry = personalized.queue.entry;
      if (entry) {
        userEntry = {
          agentProfileId: entry.agent.id,
          agentName: entry.agent.displayName,
          joinedAt: entry.joinedAt,
        };
      }
    }

    const queueCount = personalized?.queue.count
      ?? (await db.select({ count: sql<number>`count(*)::int` }).from(schema.freeGameQueue))[0]?.count
      ?? 0;
    const todayGame = personalized?.latestGame ?? (await db
      .select({
        id: schema.games.id,
        slug: schema.games.slug,
        status: schema.games.status,
        seasonId: schema.games.seasonId,
        createdAt: schema.games.createdAt,
      })
      .from(schema.games)
      .where(eq(schema.games.trackType, "free"))
      .orderBy(desc(schema.games.createdAt))
      .limit(1))[0];

    const seasonById = await getGameSeasonIdentityMap(db, [todayGame?.seasonId ?? null]);

    return c.json({
      count: queueCount,
      userEntry,
      eligibility: personalized?.queue.eligibility ?? null,
      promptEligible: personalized?.promptEligible ?? false,
      relevantGame: personalized?.relevantGame ?? null,
      nextGameTime: getNextFreeGameTime(),
      todayGame: todayGame
        ? {
            id: todayGame.id,
            slug: todayGame.slug,
            status: todayGame.status,
            season: todayGame.seasonId ? seasonById.get(todayGame.seasonId) : undefined,
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

    try {
      const result = await joinQueue(db, { userId: user.id }, {
        queueType: "daily-free",
        agentId: body.agentProfileId,
      });
      return c.json({
        id: result.queue.entryId,
        agentProfileId: result.agent!.id,
        agentName: result.agent!.displayName,
        joinedAt: result.queue.joinedAt,
        status: result.queue.status,
      }, result.queue.status === "already-queued" ? 200 : 201);
    } catch (error) {
      if (error instanceof QueueEnrollmentError || error instanceof AgentProfileManagementError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode as 400);
      }
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/free-queue/leave — remove user's entry
  // -------------------------------------------------------------------------

  app.delete("/api/free-queue/leave", requireAuth(db), async (c) => {
    const user = c.get("user");
    try {
      const result = await leaveQueue(db, { userId: user.id });
      return c.json({ removed: result.queue.status === "left-queue" });
    } catch (error) {
      if (error instanceof QueueEnrollmentError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode as 400);
      }
      throw error;
    }
  });

  app.post("/api/free-queue/maybe-later", requireAuth(db), async (c) => {
    const user = c.get("user");
    try {
      return c.json(await deferDailyFreePrompt(db, { userId: user.id }));
    } catch (error) {
      if (error instanceof QueueEnrollmentError) {
        return c.json({ error: error.message, code: error.code }, error.statusCode as 400);
      }
      throw error;
    }
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

    const playedRows = rows.filter((row) => row.gamesPlayed > 0);
    const identityMap = await getPublicPlayerIdentityMap(db, playedRows.map((row) => row.id));
    const leaderboard = playedRows
      .map((r, i) => ({
        rank: i + 1,
        player: identityMap.get(r.id) ?? null,
        displayName: publicPlayerDisplayName(r),
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
    const idempotencyKey = c.req.header("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return c.json({
        error: "Idempotency-Key header must contain between 1 and 200 characters.",
      }, 400);
    }

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
      await acquireDailyFreeLocks(tx);
      const existingDraw = (await tx.select({ id: schema.games.id, slug: schema.games.slug })
        .from(schema.games)
        .where(and(
          eq(schema.games.trackType, "free"),
          eq(schema.games.freeDrawRequestKey, idempotencyKey),
        ))
        .limit(1))[0];
      if (existingDraw) {
        return {
          drawn: false as const,
          reason: "This draw request has already created a game.",
          gameId: existingDraw.id,
          gameSlug: existingDraw.slug,
        };
      }
      const entries = await tx.select().from(schema.freeGameQueue);
      const busyOwners = await tx.select({ userId: schema.gamePlayers.userId })
        .from(schema.gamePlayers)
        .innerJoin(schema.games, eq(schema.gamePlayers.gameId, schema.games.id))
        .where(and(
          eq(schema.games.trackType, "free"),
          inArray(schema.games.status, ["waiting", "in_progress", "suspended"]),
        ));
      const busyOwnerIds = new Set(busyOwners.flatMap((row) => row.userId ? [row.userId] : []));
      const eligibleEntries = entries.filter((entry) => !busyOwnerIds.has(entry.userId));
      if (eligibleEntries.length < 2) {
        return {
          drawn: false as const,
          reason: `Not enough eligible players in queue (${eligibleEntries.length}). Need at least 2.`,
        };
      }
      const shuffled = [...eligibleEntries].sort(() => Math.random() - 0.5);
      const picked = shuffled.slice(0, Math.min(entries.length, 12));
      await tx.insert(schema.games).values({
          id: gameId,
          slug,
          config: JSON.stringify(config),
          status: "waiting",
          trackType: "free",
          freeDrawRequestKey: idempotencyKey,
          ...currentCaptureVersionFields(),
          minPlayers,
          maxPlayers,
          createdById: user?.id ?? null,
        });
      await tx.insert(schema.gameTranscriptStates).values(
        initialGameTranscriptStateValues(gameId),
      );

      // Add picked players to the game.
      for (const entry of picked) {
        const playerId = randomUUID();
        const admitted = await admitOwnedSeatInTransaction(tx, {
          playerId,
          gameId,
          userId: entry.userId,
          agentProfileId: entry.agentProfileId,
        });

        addedPlayers.push({
          playerId,
          userId: entry.userId,
          agentProfileId: admitted.projection.profile.id,
          agentName: admitted.projection.profile.name,
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

      const pickedIds = new Set(picked.map((entry) => entry.id));
      const selectedIds = [...pickedIds];
      const missedIds = eligibleEntries
        .filter((entry) => !pickedIds.has(entry.id))
        .map((entry) => entry.id);
      if (selectedIds.length > 0) {
        await tx.update(schema.freeGameQueue)
          .set({ consecutiveMisses: 0 })
          .where(inArray(schema.freeGameQueue.id, selectedIds));
      }
      if (missedIds.length > 0) {
        await tx.update(schema.freeGameQueue)
          .set({ consecutiveMisses: sql`${schema.freeGameQueue.consecutiveMisses} + 1` })
          .where(inArray(schema.freeGameQueue.id, missedIds));
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
      return c.json(gameOwnerClaimErrorBody(owner), owner.statusCode);
    }
    await tryRefreshGameWatchStateSummary(db, game.id, "free_queue_started");

    let startupError: string | undefined;
    try {
      const result = await startOwnedGame(db, game.id, owner.claim.ownerEpoch);
      startupError = result.error;
    } catch (error) {
      startupError = error instanceof Error ? error.message : String(error);
    }
    if (startupError) {
      const cleanup = await markOwnerStartupFailed(
        db,
        game.id,
        owner.claim.ownerEpoch,
        startupError,
      );
      if (cleanup.rosterDisposition === "repair_required") {
        console.warn("[free-queue] Startup failure roster requires repair", {
          gameId: game.id,
          ...cleanup.reconciliationError,
        });
      }
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
