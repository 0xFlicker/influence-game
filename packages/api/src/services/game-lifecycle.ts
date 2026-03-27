/**
 * Game Lifecycle Service
 *
 * Bridges the API server with the engine's GameRunner.
 * Handles constructing agents from DB records, running games asynchronously,
 * and persisting transcripts + results back to the database.
 */

import OpenAI from "openai";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  GameRunner,
  InfluenceAgent,
  TokenTracker,
  estimateCost,
} from "@influence/engine";
import type {
  IAgent,
  Personality,
  GameConfig,
  GameStateSnapshot,
  ViewerMode,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { PgMemoryStore } from "../db/memory-store.js";
import { broadcastGameEvent, broadcastRaw } from "./ws-manager.js";
import { ViewerEventPacer } from "./viewer-event-pacer.js";
import { calculateEloChanges } from "./elo.js";
import type { PlayerResult } from "./elo.js";

// ---------------------------------------------------------------------------
// Active game tracking
// ---------------------------------------------------------------------------

interface ActiveGame {
  gameId: string;
  runner: GameRunner;
  startedAt: Date;
  promise: Promise<void>;
}

/** Map of gameId → active game. Prevents double-starts and enables status queries. */
const activeGames = new Map<string, ActiveGame>();

export function isGameRunning(gameId: string): boolean {
  return activeGames.has(gameId);
}

export function getActiveGameCount(): number {
  return activeGames.size;
}

/** Abort and await all active games — used by tests to prevent cross-file pollution. */
export async function abortAllGames(): Promise<void> {
  for (const game of activeGames.values()) {
    game.runner.abort();
  }
  const promises = [...activeGames.values()].map((g) =>
    g.promise.catch(() => {}),
  );
  await Promise.all(promises);
}

/** Get a state snapshot for a running game (for WebSocket catch-up). */
export function getGameSnapshot(gameId: string): GameStateSnapshot | null {
  const active = activeGames.get(gameId);
  if (!active) return null;
  return active.runner.getStateSnapshot();
}

// ---------------------------------------------------------------------------
// Valid personality keys
// ---------------------------------------------------------------------------

const VALID_PERSONALITIES = new Set<string>([
  "honest", "strategic", "deceptive", "paranoid", "social",
  "aggressive", "loyalist", "observer", "diplomat", "wildcard",
  "contrarian", "provocateur", "martyr",
]);

function resolvePersonality(key: string | null | undefined): Personality {
  if (key && VALID_PERSONALITIES.has(key)) {
    return key as Personality;
  }
  return "strategic";
}

// ---------------------------------------------------------------------------
// Start a game
// ---------------------------------------------------------------------------

export async function startGame(
  db: DrizzleDB,
  gameId: string,
): Promise<{ error?: string }> {
  // Prevent double-start
  if (activeGames.has(gameId)) {
    return { error: "Game is already running" };
  }

  // Load game record
  const game = (await db
    .select()
    .from(schema.games)
    .where(eq(schema.games.id, gameId)))[0];

  if (!game) {
    return { error: "Game not found" };
  }

  if (game.status !== "in_progress") {
    return { error: "Game must be in_progress to run" };
  }

  // Load players
  const players = await db
    .select()
    .from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.gameId, gameId));

  if (players.length < game.minPlayers) {
    return { error: `Not enough players: ${players.length} < ${game.minPlayers}` };
  }

  // Parse game config
  const gameConfig = JSON.parse(game.config) as Record<string, unknown>;

  // Create OpenAI client
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return { error: "OPENAI_API_KEY not configured" };
  }
  const openai = new OpenAI({ apiKey: openaiApiKey });

  // Create token tracker
  const tokenTracker = new TokenTracker();

  // Construct agents from player records
  const agents: IAgent[] = players.map((player) => {
    const persona = JSON.parse(player.persona) as {
      name: string;
      personality?: string;
      strategyHints?: string;
      personaKey?: string;
    };
    const agentCfg = JSON.parse(player.agentConfig) as {
      model?: string;
      temperature?: number;
    };

    const personality = resolvePersonality(
      persona.personaKey ?? persona.personality,
    );
    const model = agentCfg.model ?? "gpt-5-nano";

    const memoryStore = new PgMemoryStore(db);
    const agent = new InfluenceAgent(
      player.id,
      persona.name,
      personality,
      openai,
      model,
      undefined,
      memoryStore,
    );
    agent.setTokenTracker(tokenTracker);
    return agent;
  });

  // Build engine GameConfig
  const defaultTimers = {
    introduction: 30000,
    lobby: 30000,
    whisper: 45000,
    rumor: 30000,
    vote: 20000,
    power: 15000,
    council: 20000,
  };
  const storedTimers = (gameConfig.timers ?? {}) as Record<string, number>;

  const engineConfig: GameConfig = {
    maxRounds: (gameConfig.maxRounds as number) ?? 10,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    timers: {
      ...defaultTimers,
      ...storedTimers,
    },
  };

  // Create runner
  const runner = new GameRunner(agents, engineConfig);

  // Stream game events to WebSocket observers via the display-hold pacer
  const viewerMode: ViewerMode =
    (gameConfig.viewerMode as ViewerMode) ?? "speedrun";
  const pacer = new ViewerEventPacer(
    viewerMode === "replay" ? "speedrun" : viewerMode,
    (event) => broadcastGameEvent(gameId, event),
  );
  runner.setStreamListener((event) => pacer.emit(event));

  // Run game asynchronously
  const promise = runGameAsync(db, gameId, runner, tokenTracker, gameConfig);

  activeGames.set(gameId, {
    gameId,
    runner,
    startedAt: new Date(),
    promise,
  });

  return {};
}

// ---------------------------------------------------------------------------
// Async game execution
// ---------------------------------------------------------------------------

async function runGameAsync(
  db: DrizzleDB,
  gameId: string,
  runner: GameRunner,
  tokenTracker: TokenTracker,
  gameConfig: Record<string, unknown>,
): Promise<void> {
  try {
    const result = await runner.run();

    // Persist transcript entries
    const transcriptEntries = result.transcript;
    if (transcriptEntries.length > 0) {
      // Batch insert in chunks to avoid parameter limits
      const CHUNK_SIZE = 100;
      for (let i = 0; i < transcriptEntries.length; i += CHUNK_SIZE) {
        const chunk = transcriptEntries.slice(i, i + CHUNK_SIZE);
        await db.insert(schema.transcripts)
          .values(
            chunk.map((entry) => ({
              gameId,
              round: entry.round,
              phase: entry.phase,
              fromPlayerId: entry.from === "SYSTEM" ? null : entry.from,
              scope: entry.scope,
              toPlayerIds: entry.to ? JSON.stringify(entry.to) : null,
              roomId: entry.roomId ?? null,
              text: entry.text,
              timestamp: entry.timestamp,
            })),
          );
      }
    }

    // Compute token usage
    const usage = tokenTracker.getTotalUsage();
    const model = (gameConfig.modelTier === "premium" ? "gpt-5.4-mini" : gameConfig.modelTier === "standard" ? "gpt-5-mini" : "gpt-5-nano") as string;
    const cost = estimateCost(usage, model);

    // Write game results
    await db.insert(schema.gameResults)
      .values({
        id: randomUUID(),
        gameId,
        winnerId: result.winner ?? null,
        roundsPlayed: result.rounds,
        tokenUsage: JSON.stringify({
          promptTokens: usage.promptTokens,
          cachedTokens: usage.cachedTokens,
          completionTokens: usage.completionTokens,
          reasoningTokens: usage.reasoningTokens,
          totalTokens: usage.totalTokens,
          emptyResponses: usage.emptyResponses,
          estimatedCost: cost.totalCost,
          perAction: tokenTracker.getAllUsage(),
        }),
      });

    // Update agent profile win/loss stats for players with saved profiles
    const playersWithProfiles = (await db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, gameId)))
      .filter((p) => p.agentProfileId != null);

    for (const player of playersWithProfiles) {
      const isWinner = player.id === result.winner;
      await db.execute(
        sql`UPDATE agent_profiles
            SET games_played = games_played + 1,
                games_won = games_won + ${isWinner ? 1 : 0},
                updated_at = ${new Date().toISOString()}
            WHERE id = ${player.agentProfileId}`,
      );
    }

    // Update free-track ELO ratings if this is a free game
    const gameRecord = (await db
      .select({ trackType: schema.games.trackType })
      .from(schema.games)
      .where(eq(schema.games.id, gameId)))[0];

    if (gameRecord?.trackType === "free") {
      // Build placement from elimination order (names) → player IDs
      const allPlayers = await db
        .select()
        .from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.gameId, gameId));

      // Map name → player record
      const nameToPlayer = new Map<string, typeof allPlayers[number]>();
      for (const p of allPlayers) {
        const persona = JSON.parse(p.persona) as { name: string };
        nameToPlayer.set(persona.name, p);
      }

      // eliminationOrder: first eliminated = worst placement
      // Winner is not in eliminationOrder
      const humanPlayers: PlayerResult[] = [];
      const totalHumans = allPlayers.filter((p) => p.agentProfileId != null).length;

      if (totalHumans >= 2) {
        for (const p of allPlayers) {
          if (!p.agentProfileId) continue; // skip AI-only players

          const persona = JSON.parse(p.persona) as { name: string };
          const elimIndex = result.eliminationOrder.indexOf(persona.name);
          let placement: number;
          if (p.id === result.winner) {
            placement = 1;
          } else if (elimIndex >= 0) {
            // First eliminated gets worst placement (totalHumans),
            // last eliminated before winner gets placement 2
            placement = totalHumans - elimIndex;
            // Clamp: at least 2 since 1 is reserved for winner
            if (placement < 2) placement = 2;
          } else {
            // Not eliminated and not winner (shouldn't happen, but default to middle)
            placement = Math.ceil(totalHumans / 2);
          }

          humanPlayers.push({
            agentProfileId: p.agentProfileId!,
            placement,
            totalPlayers: totalHumans,
          });
        }

        // Fetch current ratings
        const currentRatings = new Map<string, number>();
        for (const hp of humanPlayers) {
          const rating = (await db
            .select({ rating: schema.freeTrackRatings.rating })
            .from(schema.freeTrackRatings)
            .where(eq(schema.freeTrackRatings.agentProfileId, hp.agentProfileId)))[0];
          currentRatings.set(hp.agentProfileId, rating?.rating ?? 1200);
        }

        const eloChanges = calculateEloChanges(humanPlayers, currentRatings);
        const now = new Date().toISOString();

        for (const change of eloChanges) {
          const isWinner = humanPlayers.find((p) => p.agentProfileId === change.agentProfileId)?.placement === 1;
          const player = allPlayers.find((p) => p.agentProfileId === change.agentProfileId);

          const existing = (await db
            .select()
            .from(schema.freeTrackRatings)
            .where(eq(schema.freeTrackRatings.agentProfileId, change.agentProfileId)))[0];

          if (existing) {
            const newPeak = Math.max(existing.peakRating, change.newRating);
            await db.execute(
              sql`UPDATE free_track_ratings
                  SET rating = ${change.newRating},
                      games_played = games_played + 1,
                      games_won = games_won + ${isWinner ? 1 : 0},
                      peak_rating = ${newPeak},
                      last_game_at = ${now},
                      updated_at = ${now}
                  WHERE agent_profile_id = ${change.agentProfileId}`,
            );
          } else {
            await db.insert(schema.freeTrackRatings)
              .values({
                id: randomUUID(),
                agentProfileId: change.agentProfileId,
                userId: player?.userId ?? null,
                rating: change.newRating,
                gamesPlayed: 1,
                gamesWon: isWinner ? 1 : 0,
                peakRating: Math.max(1200, change.newRating),
                lastGameAt: now,
              });
          }
        }
      }
    }

    // Update game status to completed and set viewerMode to "replay"
    const updatedConfig = { ...gameConfig, viewerMode: "replay" };
    await db.update(schema.games)
      .set({
        status: "completed",
        endedAt: new Date().toISOString(),
        config: JSON.stringify(updatedConfig),
      })
      .where(eq(schema.games.id, gameId));

  } catch (err) {
    // Game failed — mark as cancelled and store error reason in config
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[game-lifecycle] Game ${gameId} failed:`, errorMessage);

    // Save partial transcript so viewers can replay what happened before the crash
    try {
      const partialTranscript = runner.transcriptLog;
      if (partialTranscript.length > 0) {
        const CHUNK_SIZE = 100;
        for (let i = 0; i < partialTranscript.length; i += CHUNK_SIZE) {
          const chunk = partialTranscript.slice(i, i + CHUNK_SIZE);
          await db.insert(schema.transcripts)
            .values(
              chunk.map((entry) => ({
                gameId,
                round: entry.round,
                phase: entry.phase,
                fromPlayerId: entry.from === "SYSTEM" ? null : entry.from,
                scope: entry.scope,
                toPlayerIds: entry.to ? JSON.stringify(entry.to) : null,
                roomId: entry.roomId ?? null,
                text: entry.text,
                timestamp: entry.timestamp,
              })),
            );
        }
        console.error(`[game-lifecycle] Saved ${partialTranscript.length} partial transcript entries for game ${gameId}`);
      }
    } catch (transcriptErr) {
      console.error(`[game-lifecycle] Failed to save partial transcript for game ${gameId}:`, transcriptErr);
    }

    // Notify live viewers that the game crashed
    broadcastRaw(gameId, { type: "error", message: "Game ended unexpectedly due to an error." });
    broadcastRaw(gameId, { type: "game_over", totalRounds: 0 });

    try {
      // Read current config and append errorInfo
      const game = (await db
        .select({ config: schema.games.config })
        .from(schema.games)
        .where(eq(schema.games.id, gameId)))[0];
      const currentConfig = game ? JSON.parse(game.config) : {};
      const updatedConfig = {
        ...currentConfig,
        errorInfo: errorMessage,
        viewerMode: "replay",
      };

      await db.update(schema.games)
        .set({
          status: "cancelled",
          endedAt: new Date().toISOString(),
          config: JSON.stringify(updatedConfig),
        })
        .where(eq(schema.games.id, gameId));
    } catch (dbErr) {
      console.error(`[game-lifecycle] Failed to update game ${gameId} status after error:`, dbErr);
    }
  } finally {
    // Clear operational memories — they exist only for game duration
    try {
      await new PgMemoryStore(db).clear(gameId);
    } catch (err) {
      console.warn(`[game-lifecycle] memory cleanup failed for game=${gameId}:`, err instanceof Error ? err.message : err);
    }
    activeGames.delete(gameId);
  }
}
