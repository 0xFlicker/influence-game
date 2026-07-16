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
 *   PATCH  /api/games/:id/hide — admin soft-delete (hide from public lists)
 *   PATCH  /api/games/:id/unhide — admin restore hidden game
 *   GET    /api/games/:id/alliances — public named-alliance facts
 *   GET    /api/games/:id/transcript — full transcript export
 *   GET    /api/games/:id/replay-watch-frames — structured replay watch states
 */

import { Hono, type Context } from "hono";
import { eq, inArray, asc, or, and, isNull, ne } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { GameCompletionSettlementState, GameStatus } from "../db/schema.js";
import {
  requireAuth,
  requirePermission,
  type AuthEnv,
} from "../middleware/auth.js";
import { abortGame, startGame, validateGameStartReadiness } from "../services/game-lifecycle.js";
import {
  acquireGameRunOwner,
  markOwnerStartupFailed,
} from "../services/game-ownership.js";
import {
  getRedactedKernelHealth,
  getRedactedKernelHealthByGameId,
} from "../services/game-kernel-health.js";
import {
  buildGameWatchState,
  getGameWatchReplayFrames,
} from "../services/game-watch-state.js";
import { getCompletedGameResults } from "../services/completed-game-results.js";
import { getPublicGameAlliances } from "../services/public-alliance-read-model.js";
import {
  buildCompactPostgameBrief,
  getPostgameAnalysis,
  getPostgameJuryBreakdown,
  getPostgamePlayerSummary,
  getPostgameTurningPoints,
  type PostgameReadStatus,
} from "../services/postgame-analysis.js";
import { getPostgameHighlights } from "../services/postgame-highlights.js";
import { getPublicPostgameMedia } from "../services/postgame-media.js";
import {
  buildFallbackGameWatchStateSummary,
  getGameWatchStateSummaryReadsByGameIds,
  tryRefreshGameWatchStateSummary,
} from "../services/game-watch-state-summary.js";
import { broadcastRaw } from "../services/ws-manager.js";
import {
  admitOwnedSeatInTransaction,
  assertUnownedSeatAdmissionInTransaction,
  lockWaitingGameForRosterWrite,
  OwnedSeatProjectionError,
  updateWaitingHouseSeatPersonaInTransaction,
} from "../services/owned-seat-projection.js";
import { getPublicGameCompetitionReceipts } from "../services/season-read-model.js";
import { generateUniqueSlug } from "../lib/slug.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import { modelLabelFromConfig } from "../lib/model-label.js";
import { getGameSeasonIdentityMap } from "../lib/game-season.js";
import { gameOwnerClaimErrorBody } from "../lib/game-owner-claim-response.js";
import {
  getGameCompletionSettlementState,
  getGameCompletionSettlementStateMap,
} from "../services/game-completion-settlement.js";
import {
  createLlmClientFromEnv,
  generatePersona,
  normalizeGameModelSelection,
  pickAgentNames,
  pickArchetypes,
  resolveModelForTier,
  resolveModelSelection,
} from "@influence/engine";
import type { Personality } from "@influence/engine";

const PUBLIC_SUSPENDED_ERROR_INFO = "The game failed and cannot be resumed.";

function publicErrorInfo(
  status: GameStatus,
  config: Record<string, unknown>,
  settlementState?: GameCompletionSettlementState | "not_applicable",
): string | undefined {
  if (status === "suspended") {
    if (settlementState === "pending") return "Finalizing results.";
    if (settlementState === "repair_required") return "Results under review.";
    return PUBLIC_SUSPENDED_ERROR_INFO;
  }
  return typeof config.errorInfo === "string" ? config.errorInfo : undefined;
}

// ---------------------------------------------------------------------------
// Factory — creates a Hono sub-app with injected DB
// ---------------------------------------------------------------------------

export function createGameRoutes(
  db: DrizzleDB,
  dependencies: { startGame?: typeof startGame } = {},
) {
  const app = new Hono<AuthEnv>();
  const startOwnedGame = dependencies.startGame ?? startGame;

  // -------------------------------------------------------------------------
  // POST /api/games — create a new game
  // -------------------------------------------------------------------------

  app.post("/api/games", requireAuth(db), requirePermission("create_game"), async (c) => {
    const body = await parseJsonBody(c, "POST /api/games");
    if (!body) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const {
      playerCount,
      modelTier,
      modelSelection,
      modelCatalogId,
      reasoningPolicy,
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
        mingle: 20000,
        rumor: 15000,
        vote: 10000,
        power: 10000,
        council: 10000,
      },
      standard: {
        introduction: 30000,
        lobby: 30000,
        mingle: 45000,
        rumor: 30000,
        vote: 20000,
        power: 15000,
        council: 20000,
      },
      slow: {
        introduction: 60000,
        lobby: 60000,
        mingle: 90000,
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
    const rawModelSelection = modelSelection ?? (
      typeof modelCatalogId === "string"
        ? {
            catalogId: modelCatalogId,
            ...(reasoningPolicy !== undefined && { reasoningPolicy }),
          }
        : undefined
    );
    const normalizedModelSelection = normalizeGameModelSelection(rawModelSelection);
    if (rawModelSelection && !normalizedModelSelection) {
      return c.json({ error: "Invalid model selection" }, 400);
    }
    let resolvedModelSelection;
    try {
      resolvedModelSelection = resolveModelSelection(normalizedModelSelection, resolvedModelTier);
    } catch {
      return c.json({ error: "Unknown model selection" }, 400);
    }
    if (normalizedModelSelection && resolvedModelSelection.model.evaluationStatus !== "game-ready") {
      return c.json({ error: "Model is not game-ready" }, 400);
    }

    const config = {
      timers,
      maxRounds: computedMaxRounds,
      minPlayers,
      maxPlayers,
      modelTier: resolvedModelTier,
      modelSelection: {
        catalogId: resolvedModelSelection.catalogId,
        reasoningPolicy: resolvedModelSelection.reasoningPolicy,
      },
      personaPool: personaPool ?? [],
      fillStrategy: fillStrategy ?? "balanced",
      visibility: visibility ?? "public",
      slotType: slotType ?? "all_ai",
      viewerMode: resolvedViewerMode,
    };

    const gameId = randomUUID();

    const slug = await generateUniqueSlug(async (s) => {
      const existing = await db.select({ id: schema.games.id }).from(schema.games).where(eq(schema.games.slug, s));
      return existing.length > 0;
    });

    const user = c.get("user");
    await db.insert(schema.games)
      .values({
        id: gameId,
        slug,
        config: JSON.stringify(config),
        status: "waiting",
        cognitiveArtifactCaptureVersion: 1,
        minPlayers,
        maxPlayers,
        createdById: user?.id ?? null,
      });
    await tryRefreshGameWatchStateSummary(db, gameId, "game_created");

    return c.json({ id: gameId, slug }, 201);
  });

  // -------------------------------------------------------------------------
  // GET /api/games — list games (with optional status filter)
  // -------------------------------------------------------------------------

  app.get("/api/games", async (c) => {
    const statusParam = c.req.query("status");

    let rows;
    if (statusParam) {
      const statuses = statusParam.split(",").map((s) => s.trim()) as GameStatus[];
      rows = await db
        .select()
        .from(schema.games)
        .where(and(inArray(schema.games.status, statuses), isNull(schema.games.hiddenAt)));
    } else {
      rows = await db.select().from(schema.games).where(isNull(schema.games.hiddenAt));
    }

    const gameIds = rows.map((game) => game.id);
    const [kernelHealthByGameId, watchSummaryReadsByGameId, seasonById, settlementStateByGameId] = await Promise.all([
      getRedactedKernelHealthByGameId(db, gameIds),
      getGameWatchStateSummaryReadsByGameIds(db, gameIds),
      getGameSeasonIdentityMap(db, rows.map((game) => game.seasonId)),
      getGameCompletionSettlementStateMap(db, gameIds),
    ]);

    const summaries = rows.map((game) => {
      const config = JSON.parse(game.config);
      const summaryRead = watchSummaryReadsByGameId.get(game.id) ?? { status: "missing" as const };
      const watchState = summaryRead.status === "current"
        ? summaryRead.summary
        : buildFallbackGameWatchStateSummary(game, config);

      return {
        id: game.id,
        slug: game.slug,
        status: game.status,
        playerCount: game.maxPlayers ?? config.maxPlayers ?? watchState.counts.totalPlayers,
        currentRound: watchState.currentRound,
        maxRounds: config.maxRounds ?? 10,
        currentPhase: watchState.currentPhase,
        phaseTimeRemaining: null,
        alivePlayers: watchState.counts.alivePlayers,
        eliminatedPlayers: watchState.counts.eliminatedPlayers,
        modelTier: config.modelTier ?? "budget",
        modelLabel: modelLabelFromConfig(config),
        visibility: config.visibility ?? "public",
        viewerMode: config.viewerMode ?? "speedrun",
        trackType: game.trackType,
        seasonId: game.seasonId ?? undefined,
        season: game.seasonId ? seasonById.get(game.seasonId) : undefined,
        rated: Boolean(game.seasonId),
        winner: watchState.winner?.name,
        errorInfo: publicErrorInfo(game.status, config, settlementStateByGameId.get(game.id)),
        kernelHealth: kernelHealthByGameId.get(game.id),
        watchState,
        watchStateSummaryStatus: summaryRead.status,
        createdAt: game.createdAt,
        startedAt: game.startedAt ?? undefined,
        completedAt: game.endedAt ?? undefined,
      };
    });

    return c.json(summaries);
  });

  // -------------------------------------------------------------------------
  // GET /api/games/:id — get game details
  // -------------------------------------------------------------------------

  app.get("/api/games/:id", async (c) => {
    const idOrSlug = c.req.param("id");

    // Support lookup by UUID or human-readable slug
    const game = (await db
      .select()
      .from(schema.games)
      .where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug))))[0];

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }

    const config = JSON.parse(game.config);
    const completionSettlementState = await getGameCompletionSettlementState(db, game.id);

    const result = await db
      .select()
      .from(schema.gameResults)
      .where(eq(schema.gameResults.gameId, game.id));

    const watchState = await buildGameWatchState(db, game);
    const competition = game.seasonId
      ? await getPublicGameCompetitionReceipts(db, game.seasonId, game.id)
      : null;

    const detail = {
      id: game.id,
      slug: game.slug,
      status: game.status,
      currentRound: watchState.currentRound,
      maxRounds: config.maxRounds ?? 10,
      currentPhase: watchState.currentPhase,
      players: watchState.players.map((player) => ({
        id: player.id,
        name: player.name,
        persona: player.persona,
        ...(player.personaKey && { personaKey: player.personaKey }),
        status: player.status,
        shielded: player.shielded,
        ...(player.pressureStatus && { pressureStatus: player.pressureStatus }),
        ...(player.exposeScore !== undefined && { exposeScore: player.exposeScore }),
        ...(player.avatarUrl && { avatarUrl: player.avatarUrl }),
      })),
      modelTier: config.modelTier ?? "budget",
      modelLabel: modelLabelFromConfig(config),
      visibility: config.visibility ?? "public",
      viewerMode: config.viewerMode ?? "speedrun",
      seasonId: game.seasonId ?? undefined,
      season: competition
        ? {
            id: competition.season.id,
            slug: competition.season.slug,
            name: competition.season.name,
          }
        : undefined,
      rated: Boolean(game.seasonId),
      competitionReceipts: competition?.receipts ?? [],
      winner: watchState.winner?.name,
      tokenUsage: result[0]?.tokenUsage ? JSON.parse(result[0].tokenUsage) : undefined,
      errorInfo: publicErrorInfo(game.status, config, completionSettlementState),
      kernelHealth: await getRedactedKernelHealth(db, game.id),
      watchState,
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

    const game = (await db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, gameId)))[0];

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }

    if (game.status !== "waiting") {
      return c.json({ error: "Game is not accepting players" }, 400);
    }

    const currentPlayers = await db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, gameId));

    if (currentPlayers.length >= game.maxPlayers) {
      return c.json({ error: "Game is full" }, 400);
    }

    const body = await parseJsonBody(c, "POST /api/games/:id/join");
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
    let resolvedBackstory: string | null = null;
    let resolvedStrategyHints: string | null = strategyHints ?? null;
    let resolvedPersonaKey: string | null = personaKey ?? null;
    let resolvedProfile: typeof schema.agentProfiles.$inferSelect | null = null;

    if (agentProfileId) {
      const profile = (await db
        .select()
        .from(schema.agentProfiles)
        .where(eq(schema.agentProfiles.id, agentProfileId)))[0];

      if (!profile) {
        return c.json({ error: "Agent profile not found" }, 404);
      }

      if (profile.userId !== joinUser?.id) {
        return c.json({ error: "Agent profile does not belong to you" }, 403);
      }

      resolvedName = profile.name;
      resolvedPersonality = profile.personality;
      resolvedBackstory = profile.backstory;
      resolvedStrategyHints = profile.strategyStyle;
      resolvedPersonaKey = profile.personaKey;
      resolvedProfile = profile;
    } else {
      if (!agentName || !personality) {
        return c.json({ error: "agentName and personality are required (or provide agentProfileId)" }, 400);
      }
      resolvedName = agentName;
      resolvedPersonality = personality;
    }

    if (game.seasonId && !resolvedProfile) {
      return c.json({ error: "Rated games require an owned saved agent." }, 400);
    }

    // -----------------------------------------------------------------------
    // Reject if name collides with an existing player in this game
    // -----------------------------------------------------------------------
    const normalizedJoinName = resolvedName.trim().toLowerCase();
    const nameCollision = currentPlayers.some((p) => {
      const persona = JSON.parse(p.persona) as { name: string };
      return persona.name.trim().toLowerCase() === normalizedJoinName;
    });
    if (nameCollision) {
      return c.json({ error: "A player with that name already exists in this game" }, 409);
    }

    // -----------------------------------------------------------------------
    // Resolve model from game config
    // -----------------------------------------------------------------------
    const gameConfig = JSON.parse(game.config);
    const resolvedModelSelection = resolveModelSelection(
      normalizeGameModelSelection(gameConfig.modelSelection),
      gameConfig.modelTier,
    );
    const agentModel = resolvedModelSelection.modelId;

    const playerId = randomUUID();
    const persona = {
      name: resolvedName,
      personality: resolvedPersonality,
      backstory: resolvedBackstory,
      strategyHints: resolvedStrategyHints,
      personaKey: resolvedPersonaKey,
    };

    const agentConfig = {
      model: agentModel,
      temperature: 0.9,
    };

    try {
      await db.transaction(async (tx) => {
        if (resolvedProfile && joinUser) {
          await admitOwnedSeatInTransaction(tx, {
            gameId,
            userId: joinUser.id,
            agentProfileId: resolvedProfile.id,
            playerId,
            overrides: { temperature: agentConfig.temperature },
          });
          return;
        }
        await assertUnownedSeatAdmissionInTransaction(tx, { gameId, name: resolvedName });
        await tx.insert(schema.gamePlayers).values({
          id: playerId,
          gameId,
          userId: joinUser?.id ?? null,
          agentProfileId: null,
          agentRevisionId: null,
          persona: JSON.stringify(persona),
          agentConfig: JSON.stringify(agentConfig),
        });
      });
    } catch (error) {
      if (error instanceof OwnedSeatProjectionError) {
        return c.json({ error: error.message }, error.code === "rated_roster_invalid" ? 409 : 400);
      }
      throw error;
    }
    await tryRefreshGameWatchStateSummary(db, gameId, "player_joined");

    return c.json({ playerId }, 201);
  });

  // -------------------------------------------------------------------------
  // POST /api/games/:id/fill — fill remaining slots with AI players
  // -------------------------------------------------------------------------

  app.post("/api/games/:id/fill", requireAuth(db), requirePermission("fill_game"), async (c) => {
    const gameId = c.req.param("id");

    const game = (await db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, gameId)))[0];

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }

    if (game.status !== "waiting") {
      return c.json({ error: "Game is not in waiting status" }, 400);
    }

    const existingPlayers = await db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, gameId));

    const slotsToFill = game.maxPlayers - existingPlayers.length;
    if (slotsToFill <= 0) {
      return c.json({ error: "Game is already full" }, 400);
    }

    const config = JSON.parse(game.config);
    const resolvedModelSelection = resolveModelSelection(
      normalizeGameModelSelection(config.modelSelection),
      config.modelTier,
    );
    const agentModel = resolvedModelSelection.modelId;

    // Step 1: Create placeholder players immediately (no LLM needed)
    const addedPlayers: Array<{ id: string; name: string; archetype: string }> = [];
    let totalPlayers = existingPlayers.length;

    try {
      await db.transaction(async (tx) => {
        const lockedGame = await lockWaitingGameForRosterWrite(tx, gameId);
        const currentPlayers = await tx
          .select()
          .from(schema.gamePlayers)
          .where(eq(schema.gamePlayers.gameId, gameId));
        const actualSlots = lockedGame.maxPlayers - currentPlayers.length;
        const currentPersonas = currentPlayers.map((player) => (
          JSON.parse(player.persona) as {
            name: string;
            personaKey?: Personality;
            personality?: Personality;
          }
        ));
        const existingNames = currentPersonas.map((persona) => persona.name);
        const existingArchetypes = currentPersonas.map((persona) => {
          return persona.personaKey ?? persona.personality ?? "strategic";
        });
        const names = pickAgentNames(actualSlots, existingNames);
        const archetypes = pickArchetypes(actualSlots, existingArchetypes);

        for (let i = 0; i < actualSlots; i++) {
          const name = names[i] ?? `Agent-${i + 1}`;
          const archetype = archetypes[i] ?? "strategic";

          const playerId = randomUUID();
          const persona = {
            name,
            personality: archetype,
            strategyHints: null,
            personaKey: archetype,
            personalityBlurb: null,
          };

          const agentCfg = {
            model: agentModel,
            temperature: 0.9,
          };

          await tx.insert(schema.gamePlayers)
            .values({
              id: playerId,
              gameId,
              userId: null,
              persona: JSON.stringify(persona),
              agentConfig: JSON.stringify(agentCfg),
            });

          addedPlayers.push({ id: playerId, name, archetype });
        }
        totalPlayers = currentPlayers.length + addedPlayers.length;
      });
    } catch (error) {
      if (error instanceof OwnedSeatProjectionError) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }

    if (addedPlayers.length === 0) {
      return c.json({ error: "Game is already full" }, 400);
    }

    await tryRefreshGameWatchStateSummary(db, gameId, "players_filled");

    // Fill progress stays on the authenticated HTTP operation path, not the product watch stream.
    const openai = createLlmClientFromEnv()?.client ?? null;

    if (openai) {
      void (async () => {
        const updatedPlayers: Array<{ id: string; name: string; archetype: string }> = [];

        for (const player of addedPlayers) {
          try {
            const generated = await generatePersona(openai, player.name, player.archetype as Personality, resolveModelForTier("budget"));

            const existing = (await db
              .select()
              .from(schema.gamePlayers)
              .where(eq(schema.gamePlayers.id, player.id)))[0];

            if (existing) {
              const persona = JSON.parse(existing.persona);
              persona.strategyHints = generated.strategyHints || null;
              persona.personalityBlurb = generated.personality || null;

              const updated = await db.transaction((tx) => updateWaitingHouseSeatPersonaInTransaction(tx, {
                gameId,
                playerId: player.id,
                persona: JSON.stringify(persona),
              }));
              if (updated) updatedPlayers.push(player);
            }
          } catch (err) {
            console.warn(`[games] Persona generation failed for ${player.name}:`, err instanceof Error ? err.message : err);
          }
        }

        if (updatedPlayers.length > 0) {
          console.log(`[games] Generated personas for ${updatedPlayers.length} filled player(s) in ${gameId}`);
        }
      })();
    }

    // Step 4: Return 202 Accepted immediately
    return c.json({
      filling: true,
      slotsToFill: addedPlayers.length,
      filled: addedPlayers.length,
      totalPlayers,
      maxPlayers: game.maxPlayers,
      players: addedPlayers,
    }, 202);
  });

  // -------------------------------------------------------------------------
  // POST /api/games/:id/start — start a game (min players met)
  // -------------------------------------------------------------------------

  app.post("/api/games/:id/start", requireAuth(db), requirePermission("start_game"), async (c) => {
    const gameId = c.req.param("id");

    const game = (await db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, gameId)))[0];

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }

    if (game.status !== "waiting") {
      return c.json({ error: "Game can only be started from waiting status" }, 400);
    }

    const currentPlayers = await db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, gameId));

    if (currentPlayers.length < game.minPlayers) {
      return c.json(
        {
          error: `Not enough players. Need at least ${game.minPlayers}, have ${currentPlayers.length}`,
        },
        400,
      );
    }

    const readiness = await validateGameStartReadiness(db, gameId);
    if (readiness.error) {
      return c.json({ error: readiness.error }, 500);
    }

    const owner = await acquireGameRunOwner(db, gameId);
    if (!owner.ok) {
      return c.json(gameOwnerClaimErrorBody(owner), owner.statusCode);
    }
    await tryRefreshGameWatchStateSummary(db, gameId, "game_started");

    // Await startGame to catch configuration errors (missing API key, etc.)
    // before returning success to the client. The actual game execution
    // (runGameAsync) runs in the background after this returns.
    let startupError: string | undefined;
    try {
      const result = await startOwnedGame(db, gameId, owner.claim.ownerEpoch);
      startupError = result.error;
    } catch (error) {
      startupError = error instanceof Error ? error.message : String(error);
    }
    if (startupError) {
      const cleanup = await markOwnerStartupFailed(db, gameId, owner.claim.ownerEpoch, startupError);
      if (cleanup.rosterDisposition === "repair_required") {
        console.warn("[games] Startup failure roster requires repair", {
          gameId,
          ...cleanup.reconciliationError,
        });
      }
      await tryRefreshGameWatchStateSummary(db, gameId, "startup_failed");
      return c.json({ error: startupError }, 500);
    }

    return c.json({ status: "in_progress", players: currentPlayers.length });
  });

  // -------------------------------------------------------------------------
  // POST /api/games/:id/stop — stop / cancel a running game
  // -------------------------------------------------------------------------

  app.post("/api/games/:id/stop", requireAuth(db), requirePermission("stop_game"), async (c) => {
    const gameId = c.req.param("id");
    const cancellation = await db.transaction(async (tx) => {
      // Capture uses this same game-row mutex before sealing completion. The
      // winner of the race is therefore unambiguous: cancel first, or seal
      // first and reject cancellation forever.
      const game = (await tx.select({ status: schema.games.status })
        .from(schema.games)
        .where(eq(schema.games.id, gameId))
        .for("update"))[0];
      if (!game) return { outcome: "not_found" as const };
      if (game.status !== "in_progress" && game.status !== "waiting" && game.status !== "suspended") {
        return { outcome: "invalid_state" as const, status: game.status };
      }

      const sealed = (await tx.select({ state: schema.gameCompletionSettlements.state })
        .from(schema.gameCompletionSettlements)
        .where(eq(schema.gameCompletionSettlements.gameId, gameId))
        .limit(1))[0];
      if (sealed) return { outcome: "sealed" as const, state: sealed.state };

      const wasSuspended = game.status === "suspended";
      const reasonCode = wasSuspended ? "admin_void" : "admin_stop";
      const endedAt = new Date().toISOString();
      await tx.update(schema.gameRunOwners)
        .set({
          status: "revoked",
          revokedAt: endedAt,
          kernelHealth: "suspended",
          failureReason: reasonCode,
        })
        .where(and(
          eq(schema.gameRunOwners.gameId, gameId),
          eq(schema.gameRunOwners.status, "active"),
        ));
      await tx.update(schema.games)
        .set({ status: "cancelled", endedAt })
        .where(eq(schema.games.id, gameId));
      return { outcome: "cancelled" as const, wasSuspended, reasonCode };
    });

    if (cancellation.outcome === "not_found") {
      return c.json({ error: "Game not found" }, 404);
    }
    if (cancellation.outcome === "invalid_state") {
      return c.json({ error: "Game is not running, waiting, or suspended" }, 400);
    }
    if (cancellation.outcome === "sealed") {
      return c.json({
        error: "A sealed completion cannot be stopped or voided.",
        code: "completion_settlement_sealed",
      }, 409);
    }

    const { wasSuspended, reasonCode } = cancellation;

    abortGame(gameId);
    await tryRefreshGameWatchStateSummary(db, gameId, "game_cancelled");

    broadcastRaw(gameId, {
      type: "game_status",
      gameId,
      status: "cancelled",
      terminal: true,
      reasonCode,
      message: wasSuspended ? "Game voided by an administrator." : "Game cancelled.",
    });

    return c.json({ status: "cancelled" });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/games/:id/hide — admin soft-delete a game
  // -------------------------------------------------------------------------

  app.patch("/api/games/:id/hide", requireAuth(db), requirePermission("hide_game"), async (c) => {
    const gameId = c.req.param("id");

    const game = (await db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, gameId)))[0];

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }

    if (game.hiddenAt) {
      return c.json({ error: "Game is already hidden" }, 400);
    }

    await db.update(schema.games)
      .set({ hiddenAt: new Date().toISOString() })
      .where(eq(schema.games.id, gameId));

    return c.json({ id: gameId, hiddenAt: new Date().toISOString() });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/games/:id/unhide — admin restore a hidden game
  // -------------------------------------------------------------------------

  app.patch("/api/games/:id/unhide", requireAuth(db), requirePermission("hide_game"), async (c) => {
    const gameId = c.req.param("id");

    const game = (await db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, gameId)))[0];

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }

    if (!game.hiddenAt) {
      return c.json({ error: "Game is not hidden" }, 400);
    }

    await db.update(schema.games)
      .set({ hiddenAt: null })
      .where(eq(schema.games.id, gameId));

    return c.json({ id: gameId, hiddenAt: null });
  });

  // -------------------------------------------------------------------------
  // GET /api/player/games — authenticated player's game history
  // -------------------------------------------------------------------------

  app.get("/api/player/games", requireAuth(db), async (c) => {
    const user = c.get("user");

    const playerRecords = await db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.userId, user.id));

    if (playerRecords.length === 0) {
      return c.json([]);
    }

    const results = (await Promise.all(playerRecords
      .map(async (playerRecord) => {
        const game = (await db
          .select()
          .from(schema.games)
          .where(and(eq(schema.games.id, playerRecord.gameId), isNull(schema.games.hiddenAt))))[0];
        if (!game) return null;
        if (game.status !== "completed" || !game.endedAt) return null;

        const config = JSON.parse(game.config);
        const persona = JSON.parse(playerRecord.persona);

        const allPlayers = await db
          .select()
          .from(schema.gamePlayers)
          .where(eq(schema.gamePlayers.gameId, game.id));
        const totalPlayers = allPlayers.length;

        const result = (await db
          .select()
          .from(schema.gameResults)
          .where(eq(schema.gameResults.gameId, game.id)))[0];

        const isWinner = result?.winnerId === playerRecord.id;

        return {
          gameId: game.id,
          gameSlug: game.slug,
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
      })))
      .filter(Boolean);

    return c.json(results);
  });

  // -------------------------------------------------------------------------
  // GET /api/games/:id/results — completed game results review
  // -------------------------------------------------------------------------

  app.get("/api/games/:id/results", async (c) => {
    const idOrSlug = c.req.param("id");
    const result = await getCompletedGameResults(db, idOrSlug);

    if (!result.ok) {
      if (result.status === "not_found") {
        return c.json({ error: result.error }, 404);
      }
      return c.json({ error: result.error, status: result.status }, 409);
    }

    return c.json(result);
  });

  // -------------------------------------------------------------------------
  // GET /api/games/:id/alliances — public named-alliance facts
  // -------------------------------------------------------------------------

  app.get("/api/games/:id/alliances", async (c) => {
    const idOrSlug = c.req.param("id");
    const result = await getPublicGameAlliances(db, idOrSlug);

    if (!result.ok) {
      return c.json({ error: result.error }, 404);
    }

    return c.json(result);
  });

  // -------------------------------------------------------------------------
  // GET /api/games/:id/postgame/brief — compact postgame analysis
  // -------------------------------------------------------------------------

  app.get("/api/games/:id/postgame/brief", async (c) => {
    const idOrSlug = c.req.param("id");
    const detailLevelValue = c.req.query("detailLevel");
    const detailLevel = parsePostgameDetailLevel(detailLevelValue);
    if (detailLevelValue !== undefined && detailLevel === undefined) {
      return invalidPostgameDetailLevelResponse(c);
    }
    const result = await getPostgameAnalysis(db, idOrSlug, {
      detailLevel,
      includeEvidence: c.req.query("includeEvidence") === "true",
    });

    if (!result.ok) return postgameErrorResponse(c, result);

    return c.json({
      schemaVersion: 1,
      ok: true,
      game: result.game,
      postgame: buildCompactPostgameBrief(result.analysis, detailLevel ?? "standard"),
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/games/:id/postgame/jury — purpose-built jury breakdown
  // -------------------------------------------------------------------------

  app.get("/api/games/:id/postgame/jury", async (c) => {
    const unsupportedDetailLevel = unsupportedPostgameDetailLevelResponse(c);
    if (unsupportedDetailLevel) return unsupportedDetailLevel;
    const result = await getPostgameJuryBreakdown(db, c.req.param("id"), {
      includeEvidence: c.req.query("includeEvidence") === "true",
    });
    if (!result.ok) return postgameErrorResponse(c, result);
    return c.json(result);
  });

  // -------------------------------------------------------------------------
  // GET /api/games/:id/postgame/players/:player/summary — one-player arc
  // -------------------------------------------------------------------------

  app.get("/api/games/:id/postgame/players/:player/summary", async (c) => {
    const unsupportedDetailLevel = unsupportedPostgameDetailLevelResponse(c);
    if (unsupportedDetailLevel) return unsupportedDetailLevel;
    const result = await getPostgamePlayerSummary(db, c.req.param("id"), c.req.param("player"), {
      includeEvidence: c.req.query("includeEvidence") === "true",
    });
    if (!result.ok) return postgameErrorResponse(c, result);
    return c.json(result);
  });

  // -------------------------------------------------------------------------
  // GET /api/games/:id/postgame/turning-points — deterministic turning points
  // -------------------------------------------------------------------------

  app.get("/api/games/:id/postgame/turning-points", async (c) => {
    const unsupportedDetailLevel = unsupportedPostgameDetailLevelResponse(c);
    if (unsupportedDetailLevel) return unsupportedDetailLevel;
    const result = await getPostgameTurningPoints(db, c.req.param("id"), {
      includeEvidence: c.req.query("includeEvidence") === "true",
    });
    if (!result.ok) return postgameErrorResponse(c, result);
    return c.json(result);
  });

  // -------------------------------------------------------------------------
  // GET /api/games/:id/postgame/highlights — public House Highlights artifact
  // -------------------------------------------------------------------------

  app.get("/api/games/:id/postgame/highlights", async (c) => {
    const unsupportedDetailLevel = unsupportedPostgameDetailLevelResponse(c);
    if (unsupportedDetailLevel) return unsupportedDetailLevel;
    const result = await getPostgameHighlights(db, c.req.param("id"));
    if (!result.ok) return postgameErrorResponse(c, result);
    return c.json(result);
  });

  // GET /api/games/:id/postgame/media — spoiler-safe postgame trailer state
  app.get("/api/games/:id/postgame/media", async (c) => {
    const idOrSlug = c.req.param("id");
    const game = (await db.select({ id: schema.games.id })
      .from(schema.games)
      .where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug)))
      .limit(1))[0];
    if (!game) return c.json({ error: "Game not found" }, 404);
    return c.json(await getPublicPostgameMedia(db, game.id));
  });

  // -------------------------------------------------------------------------
  // GET /api/games/:id/transcript — full transcript export
  // -------------------------------------------------------------------------

  app.get("/api/games/:id/transcript", async (c) => {
    const idOrSlug = c.req.param("id");

    const game = (await db
      .select()
      .from(schema.games)
      .where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug))))[0];

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }

    if (game.status !== "completed" && game.status !== "cancelled") {
      return c.json({ error: "Transcript is only available after replay is public" }, 403);
    }

    const gameId = game.id;

    const players = await db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, gameId));

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

    const rows = await db
      .select()
      .from(schema.transcripts)
      .where(and(
        eq(schema.transcripts.gameId, gameId),
        ne(schema.transcripts.scope, "huddle"),
      ))
      .orderBy(asc(schema.transcripts.timestamp));

    const parseJsonOrNull = (value: string | null): Record<string, unknown> | null => {
      if (!value) return null;
      try {
        return JSON.parse(value) as Record<string, unknown>;
      } catch {
        return null;
      }
    };

    const entries = rows.map((row) => {
      const roomMetadata = parseJsonOrNull(row.roomMetadata);
      return {
        id: row.id,
        gameId: row.gameId,
        round: row.round,
        phase: row.phase,
        fromPlayerId: row.fromPlayerId,
        fromPlayerName: row.fromPlayerId ? (playerNameMap.get(row.fromPlayerId) ?? null) : null,
        scope: row.scope,
        toPlayerIds: row.toPlayerIds ? JSON.parse(row.toPlayerIds) : null,
        ...(row.roomId != null && { roomId: row.roomId }),
        ...(roomMetadata && { roomMetadata }),
        text: row.text,
        thinking: row.thinking,
        timestamp: row.timestamp,
      };
    });

    return c.json(entries);
  });

  // -------------------------------------------------------------------------
  // GET /api/games/:id/replay-watch-frames — structured replay watch states
  // -------------------------------------------------------------------------

  app.get("/api/games/:id/replay-watch-frames", async (c) => {
    const idOrSlug = c.req.param("id");

    const game = (await db
      .select({
        id: schema.games.id,
        slug: schema.games.slug,
        status: schema.games.status,
      })
      .from(schema.games)
      .where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug)))
      .limit(1))[0];

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }

    if (game.status !== "completed" && game.status !== "cancelled") {
      return c.json({ error: "Replay watch frames are only available after replay is public" }, 403);
    }

    const frames = await getGameWatchReplayFrames(db, idOrSlug);
    return c.json(frames ?? []);
  });

  return app;
}

function parsePostgameDetailLevel(value: string | undefined): "brief" | "standard" | "full" | undefined {
  return value === "brief" || value === "standard" || value === "full"
    ? value
    : undefined;
}

function invalidPostgameDetailLevelResponse(c: Context<AuthEnv>) {
  return c.json({
    error: "detailLevel must be one of: brief, standard, full.",
    status: "invalid_detail_level",
  }, 400);
}

function unsupportedPostgameDetailLevelResponse(c: Context<AuthEnv>) {
  return c.req.query("detailLevel") === undefined
    ? null
    : c.json({
        error: "detailLevel is only supported by the postgame brief endpoint.",
        status: "unsupported_detail_level",
      }, 400);
}

function postgameErrorResponse(
  c: Context<AuthEnv>,
  result: { status: PostgameReadStatus; error: string },
) {
  if (
    result.status === "not_found" ||
    result.status === "player_not_found" ||
    result.status === "agent_not_found"
  ) {
    return c.json({ error: result.error, status: result.status }, 404);
  }
  return c.json({ error: result.error, status: result.status }, 409);
}
