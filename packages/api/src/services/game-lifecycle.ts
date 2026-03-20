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
import { broadcastGameEvent } from "./ws-manager.js";
import { ViewerEventPacer } from "./viewer-event-pacer.js";

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
  const game = db
    .select()
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .all()[0];

  if (!game) {
    return { error: "Game not found" };
  }

  if (game.status !== "in_progress") {
    return { error: "Game must be in_progress to run" };
  }

  // Load players
  const players = db
    .select()
    .from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.gameId, gameId))
    .all();

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
    const model = agentCfg.model ?? "gpt-4o-mini";

    const agent = new InfluenceAgent(
      player.id,
      persona.name,
      personality,
      openai,
      model,
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
      // Batch insert in chunks to avoid SQLite limits
      const CHUNK_SIZE = 100;
      for (let i = 0; i < transcriptEntries.length; i += CHUNK_SIZE) {
        const chunk = transcriptEntries.slice(i, i + CHUNK_SIZE);
        db.insert(schema.transcripts)
          .values(
            chunk.map((entry) => ({
              gameId,
              round: entry.round,
              phase: entry.phase,
              fromPlayerId: entry.from === "SYSTEM" ? null : entry.from,
              scope: entry.scope,
              toPlayerIds: entry.to ? JSON.stringify(entry.to) : null,
              text: entry.text,
              timestamp: entry.timestamp,
            })),
          )
          .run();
      }
    }

    // Compute token usage
    const usage = tokenTracker.getTotalUsage();
    const model = (gameConfig.modelTier === "premium" ? "gpt-4o" : "gpt-4o-mini") as string;
    const cost = estimateCost(usage, model);

    // Write game results
    db.insert(schema.gameResults)
      .values({
        id: randomUUID(),
        gameId,
        winnerId: result.winner ?? null,
        roundsPlayed: result.rounds,
        tokenUsage: JSON.stringify({
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          estimatedCost: cost.totalCost,
        }),
      })
      .run();

    // Update agent profile win/loss stats for players with saved profiles
    const playersWithProfiles = db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, gameId))
      .all()
      .filter((p) => p.agentProfileId != null);

    for (const player of playersWithProfiles) {
      const isWinner = player.id === result.winner;
      db.run(
        sql`UPDATE agent_profiles
            SET games_played = games_played + 1,
                games_won = games_won + ${isWinner ? 1 : 0},
                updated_at = ${new Date().toISOString()}
            WHERE id = ${player.agentProfileId}`,
      );
    }

    // Update game status to completed and set viewerMode to "replay"
    const updatedConfig = { ...gameConfig, viewerMode: "replay" };
    db.update(schema.games)
      .set({
        status: "completed",
        endedAt: new Date().toISOString(),
        config: JSON.stringify(updatedConfig),
      })
      .where(eq(schema.games.id, gameId))
      .run();

  } catch (err) {
    // Game failed — mark as cancelled and store error reason in config
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[game-lifecycle] Game ${gameId} failed:`, errorMessage);

    try {
      // Read current config and append errorInfo
      const game = db
        .select({ config: schema.games.config })
        .from(schema.games)
        .where(eq(schema.games.id, gameId))
        .all()[0];
      const currentConfig = game ? JSON.parse(game.config) : {};
      const updatedConfig = {
        ...currentConfig,
        errorInfo: errorMessage,
      };

      db.update(schema.games)
        .set({
          status: "cancelled",
          endedAt: new Date().toISOString(),
          config: JSON.stringify(updatedConfig),
        })
        .where(eq(schema.games.id, gameId))
        .run();
    } catch (dbErr) {
      console.error(`[game-lifecycle] Failed to update game ${gameId} status after error:`, dbErr);
    }
  } finally {
    activeGames.delete(gameId);
  }
}
