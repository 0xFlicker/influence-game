/**
 * Game Lifecycle Service
 *
 * Bridges the API server with the engine's GameRunner.
 * Handles constructing agents from DB records, running games asynchronously,
 * and persisting transcripts + results back to the database.
 */

import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  GameRunner,
  InfluenceAgent,
  LLMHouseInterviewer,
  TokenTracker,
  createLlmClientFromEnv,
  estimateCost,
  resolveModelForTier,
} from "@influence/engine";
import type {
  AgentResponse,
  IAgent,
  MingleIntentAction,
  Personality,
  GameConfig,
  GameStateSnapshot,
  PhaseContext,
  PrivateDecisionTrace,
  PrivateTraceSink,
  PowerAction,
  StrategicReflectionAction,
  TargetDecision,
  TranscriptEntry,
  UUID,
  ViewerMode,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { PgMemoryStore } from "../db/memory-store.js";
import { broadcastGameEvent, broadcastRaw } from "./ws-manager.js";
import { ViewerEventPacer } from "./viewer-event-pacer.js";
import { calculateEloChanges } from "./elo.js";
import type { PlayerResult } from "./elo.js";
import { appendGameEvents } from "./game-events.js";
import { writeGameCheckpoint } from "./game-checkpoints.js";
import {
  assertOwnerActive,
  markGameSuspended,
  renewGameRunOwner,
} from "./game-ownership.js";
import { writePrivateDecisionTrace } from "./private-trace-writer.js";

// ---------------------------------------------------------------------------
// Active game tracking
// ---------------------------------------------------------------------------

interface ActiveGame {
  gameId: string;
  runner: GameRunner;
  ownerEpoch?: string;
  heartbeat?: OwnerHeartbeat;
  startedAt: Date;
  promise: Promise<void>;
}

const OWNER_LEASE_MS = 10 * 60 * 1000;
const OWNER_HEARTBEAT_MS = 2 * 60 * 1000;

interface OwnerHeartbeat {
  stop: () => void;
}

function startOwnerHeartbeat(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch: string,
  runner: GameRunner,
): OwnerHeartbeat {
  let stopped = false;
  const interval = setInterval(() => {
    if (stopped) return;
    renewGameRunOwner(db, gameId, ownerEpoch, { leaseMs: OWNER_LEASE_MS })
      .catch(async (error) => {
        if (stopped) return;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[game-lifecycle] Owner heartbeat failed for game ${gameId}:`, message);
        stopped = true;
        clearInterval(interval);
        runner.abort();
        await markGameSuspended(db, gameId, "owner_heartbeat_failed", { message }).catch(() => {});
        broadcastRaw(gameId, {
          type: "game_status",
          gameId,
          status: "suspended",
          terminal: true,
          reasonCode: "owner_heartbeat_failed",
          message: "Game suspended because the durable owner heartbeat failed.",
        });
      });
  }, OWNER_HEARTBEAT_MS);

  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
    },
  };
}

function createPrivateTraceSink(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch: string,
): PrivateTraceSink {
  return async (trace) => {
    const enrichedTrace: PrivateDecisionTrace = {
      ...trace,
      gameId,
      ownerEpoch,
    };
    try {
      const result = await writePrivateDecisionTrace(db, {
        gameId,
        ownerEpoch,
        trace: enrichedTrace,
        eventSequence: trace.boundary?.finalEventSequence,
      });
      if (!result.ok) {
        console.warn(`[game-lifecycle] Private trace degraded for game ${gameId}: ${result.error}`);
      }
    } catch (error) {
      console.warn(`[game-lifecycle] Private trace sink failed for game ${gameId}:`, error);
    }
  };
}

/** Map of gameId → active game. Prevents double-starts and enables status queries. */
const activeGames = new Map<string, ActiveGame>();

export function isGameRunning(gameId: string): boolean {
  return activeGames.has(gameId);
}

export function getActiveGameCount(): number {
  return activeGames.size;
}

export function abortGame(gameId: string): boolean {
  const active = activeGames.get(gameId);
  if (!active) return false;
  active.runner.abort();
  return true;
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

function mockResponse(message: string): AgentResponse {
  return { thinking: "", message };
}

class ApiTestMockAgent implements IAgent {
  readonly id: UUID;
  readonly name: string;

  constructor(id: UUID, name: string) {
    this.id = id;
    this.name = name;
  }

  onGameStart() {}
  async onPhaseStart() {}
  async getIntroduction() { return mockResponse(`Hi, I'm ${this.name}`); }
  async getLobbyMessage(ctx: PhaseContext) { return mockResponse(`${this.name} round ${ctx.round}`); }
  async getWhispers(ctx: PhaseContext) {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    if (others.length === 0) return [];
    return [{ to: [others[0]!.id], text: "secret" }];
  }
  async getMingleIntent(ctx: PhaseContext): Promise<MingleIntentAction> {
    const other = ctx.alivePlayers.find((p) => p.id !== this.id)?.name ?? null;
    return {
      seekPlayers: other ? [other] : [],
      avoidPlayers: [],
      preferredRoomSize: "any",
      purpose: "api route test Mingle intent",
      provisionalTarget: null,
      noTargetReason: "api route test mock does not pick a target",
      openingAsk: "compare notes",
      strategicLens: "room_traffic",
      strategicLensRationale: "api route test mock watches room traffic",
      thinking: "api route test Mingle intent",
    };
  }
  async sendRoomMessage(
    _ctx: PhaseContext,
    roomMates: string[],
    conversationHistory?: Array<{ from: string; text: string }>,
  ) {
    const alreadySpoke = conversationHistory?.some((m) => m.from === this.name) ?? false;
    if (alreadySpoke) return null;
    const others = roomMates.filter((name) => name !== this.name);
    return others.length > 0 ? mockResponse(`whisper to ${others.join(", ")}`) : null;
  }
  async getRumorMessage() { return mockResponse("rumor"); }
  async getVotes(ctx: PhaseContext) {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    return {
      empowerTarget: others[0]?.id ?? this.id,
      exposeTarget: others[others.length - 1]?.id ?? this.id,
    };
  }
  async getEmpowerRevote(ctx: PhaseContext, tiedCandidates: UUID[]) {
    return {
      empowerTarget: tiedCandidates[0] ?? ctx.alivePlayers.find((p) => p.id !== this.id)?.id ?? this.id,
      thinking: "api route test empower revote",
    };
  }
  async getPowerAction(_ctx: PhaseContext, candidates: [UUID, UUID]): Promise<PowerAction> {
    return { action: "protect", target: candidates[0] };
  }
  async getCouncilVote(_ctx: PhaseContext, candidates: [UUID, UUID]): Promise<{ target: UUID }> {
    return { target: candidates[0] };
  }
  async getLastMessage() { return mockResponse("goodbye"); }
  async getDiaryEntry() { return mockResponse("diary entry"); }
  async getPlea() { return mockResponse("please keep me"); }
  async getEndgameEliminationVote(ctx: PhaseContext): Promise<TargetDecision> {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    return { target: others[0]?.id ?? this.id, thinking: "api route test endgame vote" };
  }
  async getAccusation(ctx: PhaseContext) {
    const others = ctx.alivePlayers.filter((p) => p.id !== this.id);
    return { targetId: others[0]?.id ?? this.id, text: "accusation" };
  }
  async getDefense() { return mockResponse("defense"); }
  async getOpeningStatement() { return mockResponse("opening"); }
  async getJuryQuestion(_ctx: PhaseContext, finalistIds: [UUID, UUID]) {
    return { targetFinalistId: finalistIds[0], question: "why?" };
  }
  async getJuryAnswer() { return mockResponse("because"); }
  async getClosingArgument() { return mockResponse("closing"); }
  async getJuryVote(_ctx: PhaseContext, finalistIds: [UUID, UUID]): Promise<TargetDecision> {
    return { target: finalistIds[0], thinking: "api route test jury vote" };
  }
  async getStrategicReflection(_ctx: PhaseContext): Promise<StrategicReflectionAction> {
    return {
      certainties: [],
      suspicions: [],
      allies: [],
      threats: [],
      plan: "api route test plan",
      strategicLens: "broad_read",
      strategicLensRationale: "api route test broad reflection",
      thinking: "api route test strategic reflection",
    };
  }

  updateAlly(_playerName: string): void {}
  updateThreat(_playerName: string): void {}
  addNote(_playerName: string, _note: string): void {}
  removeFromMemory(_playerName: string): void {}
}

export function serializeTranscriptEntry(
  gameId: string,
  entry: TranscriptEntry,
): typeof schema.transcripts.$inferInsert {
  return {
    gameId,
    round: entry.round,
    phase: entry.phase,
    fromPlayerId: entry.from === "SYSTEM" || entry.from === "House" ? null : entry.from,
    scope: entry.scope,
    toPlayerIds: entry.to ? JSON.stringify(entry.to) : null,
    roomId: entry.roomId ?? null,
    roomMetadata: entry.roomMetadata ? JSON.stringify(entry.roomMetadata) : null,
    text: entry.text,
    thinking: entry.thinking ?? null,
    timestamp: entry.timestamp,
  };
}

interface CompletedGameRunResult {
  winner?: string;
  winnerName?: string;
  rounds: number;
  transcript: TranscriptEntry[];
  eliminationOrder: string[];
}

async function persistCompletedGame(
  db: DrizzleDB,
  params: {
    gameId: string;
    ownerEpoch?: string;
    result: CompletedGameRunResult;
    finalEventSequence: number;
    tokenTracker: TokenTracker;
    gameConfig: Record<string, unknown>;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const model = resolveModelForTier(params.gameConfig.modelTier as string | undefined);
  const usage = params.tokenTracker.getTotalUsage();
  const cost = estimateCost(usage, model);
  const updatedConfig = { ...params.gameConfig, viewerMode: "replay" };

  await db.transaction(async (tx) => {
    if (params.ownerEpoch) {
      await tx.execute(sql`
        SELECT id
        FROM game_run_owners
        WHERE game_id = ${params.gameId}
          AND owner_epoch = ${params.ownerEpoch}
        FOR UPDATE
      `);

      const owner = (await tx
        .select({
          status: schema.gameRunOwners.status,
          expiresAt: schema.gameRunOwners.expiresAt,
          lastPersistedEventSequence: schema.gameRunOwners.lastPersistedEventSequence,
        })
        .from(schema.gameRunOwners)
        .where(and(
          eq(schema.gameRunOwners.gameId, params.gameId),
          eq(schema.gameRunOwners.ownerEpoch, params.ownerEpoch),
        )))[0];
      if (!owner) {
        throw new Error(`No durable owner for game ${params.gameId}`);
      }
      if (owner.status !== "active") {
        throw new Error(`Owner epoch ${params.ownerEpoch} is ${owner.status}`);
      }
      if (owner.expiresAt && new Date(owner.expiresAt).getTime() <= Date.now()) {
        throw new Error(`Owner epoch ${params.ownerEpoch} expired`);
      }
      if (owner.lastPersistedEventSequence !== params.finalEventSequence) {
        throw new Error(
          `Final persisted event head ${owner.lastPersistedEventSequence} does not match runner head ${params.finalEventSequence}`,
        );
      }
    }

    if (params.result.transcript.length > 0) {
      const CHUNK_SIZE = 100;
      for (let i = 0; i < params.result.transcript.length; i += CHUNK_SIZE) {
        const chunk = params.result.transcript.slice(i, i + CHUNK_SIZE);
        await tx.insert(schema.transcripts)
          .values(
            chunk.map((entry) => serializeTranscriptEntry(params.gameId, entry)),
          );
      }
    }

    await tx.insert(schema.gameResults)
      .values({
        id: randomUUID(),
        gameId: params.gameId,
        winnerId: params.result.winner ?? null,
        roundsPlayed: params.result.rounds,
        tokenUsage: JSON.stringify({
          promptTokens: usage.promptTokens,
          cachedTokens: usage.cachedTokens,
          completionTokens: usage.completionTokens,
          reasoningTokens: usage.reasoningTokens,
          totalTokens: usage.totalTokens,
          emptyResponses: usage.emptyResponses,
          estimatedCost: cost.totalCost,
          perAction: params.tokenTracker.getAllUsage(),
        }),
      });

    const playersWithProfiles = (await tx
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, params.gameId)))
      .filter((p) => p.agentProfileId != null);

    for (const player of playersWithProfiles) {
      const isWinner = player.id === params.result.winner;
      await tx.execute(
        sql`UPDATE agent_profiles
            SET games_played = games_played + 1,
                games_won = games_won + ${isWinner ? 1 : 0},
                updated_at = ${now}
            WHERE id = ${player.agentProfileId}`,
      );
    }

    const gameRecord = (await tx
      .select({ trackType: schema.games.trackType })
      .from(schema.games)
      .where(eq(schema.games.id, params.gameId)))[0];

    if (gameRecord?.trackType === "free") {
      const allPlayers = await tx
        .select()
        .from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.gameId, params.gameId));

      const seenUsers = new Set<string>();
      const humanPlayers: PlayerResult[] = [];
      const totalHumans = allPlayers.filter((p) => p.userId != null).length;

      if (totalHumans >= 2) {
        for (const p of allPlayers) {
          if (!p.userId) continue;
          if (seenUsers.has(p.userId)) continue;
          seenUsers.add(p.userId);

          const persona = JSON.parse(p.persona) as { name: string };
          const elimIndex = params.result.eliminationOrder.indexOf(persona.name);
          let placement: number;
          if (p.id === params.result.winner) {
            placement = 1;
          } else if (elimIndex >= 0) {
            placement = totalHumans - elimIndex;
            if (placement < 2) placement = 2;
          } else {
            placement = Math.ceil(totalHumans / 2);
          }

          humanPlayers.push({
            userId: p.userId,
            placement,
            totalPlayers: totalHumans,
          });
        }

        const currentRatings = new Map<string, number>();
        for (const hp of humanPlayers) {
          const user = (await tx
            .select({ rating: schema.users.rating })
            .from(schema.users)
            .where(eq(schema.users.id, hp.userId)))[0];
          currentRatings.set(hp.userId, user?.rating ?? 1200);
        }

        const eloChanges = calculateEloChanges(humanPlayers, currentRatings);
        for (const change of eloChanges) {
          const isWinner = humanPlayers.find((p) => p.userId === change.userId)?.placement === 1;

          const user = (await tx
            .select({ peakRating: schema.users.peakRating })
            .from(schema.users)
            .where(eq(schema.users.id, change.userId)))[0];

          const newPeak = Math.max(user?.peakRating ?? 1200, change.newRating);
          await tx.execute(
            sql`UPDATE users
                SET rating = ${change.newRating},
                    games_played = games_played + 1,
                    games_won = games_won + ${isWinner ? 1 : 0},
                    peak_rating = ${newPeak},
                    last_game_at = ${now}
                WHERE id = ${change.userId}`,
          );
        }
      }
    }

    const completed = await tx.update(schema.games)
      .set({
        status: "completed",
        endedAt: now,
        config: JSON.stringify(updatedConfig),
      })
      .where(and(eq(schema.games.id, params.gameId), eq(schema.games.status, "in_progress")))
      .returning({ id: schema.games.id });
    if (completed.length === 0) {
      throw new Error(`Game ${params.gameId} could not be completed from its current status`);
    }

    if (params.ownerEpoch) {
      const closedOwner = await tx.update(schema.gameRunOwners)
        .set({
          status: "closed",
          closedAt: now,
        })
        .where(and(
          eq(schema.gameRunOwners.gameId, params.gameId),
          eq(schema.gameRunOwners.ownerEpoch, params.ownerEpoch),
          eq(schema.gameRunOwners.status, "active"),
        ))
        .returning({ ownerEpoch: schema.gameRunOwners.ownerEpoch });
      if (closedOwner.length === 0) {
        throw new Error(`Owner epoch ${params.ownerEpoch} could not be closed`);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Start a game
// ---------------------------------------------------------------------------

export async function startGame(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch?: string,
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

  const useTestMockRunner = process.env.INFLUENCE_API_TEST_MOCK_RUNNER === "true";
  const llmConfig = useTestMockRunner ? null : createLlmClientFromEnv();
  if (!llmConfig) {
    if (!useTestMockRunner) {
      return { error: "LLM provider not configured" };
    }
  }

  // Create token tracker
  const tokenTracker = new TokenTracker();
  const privateTraceSink = ownerEpoch
    ? createPrivateTraceSink(db, gameId, ownerEpoch)
    : undefined;

  // Construct agents from player records
  const agents: IAgent[] = players.map((player) => {
    const persona = JSON.parse(player.persona) as {
      name: string;
      personality?: string;
      strategyHints?: string;
      personaKey?: string;
    };
    if (useTestMockRunner) {
      return new ApiTestMockAgent(player.id, persona.name);
    }

    if (!llmConfig) {
      throw new Error("LLM provider not configured");
    }

    const agentCfg = JSON.parse(player.agentConfig) as {
      model?: string;
      temperature?: number;
    };

    const personality = resolvePersonality(
      persona.personaKey ?? persona.personality,
    );
    const model = agentCfg.model ?? resolveModelForTier(gameConfig.modelTier as string | undefined);

    const memoryStore = new PgMemoryStore(db);
    const agent = new InfluenceAgent(
      player.id,
      persona.name,
      personality,
      llmConfig.client,
      model,
      undefined,
      memoryStore,
      {
        toolChoiceMode: llmConfig.toolChoiceMode,
        ...(privateTraceSink && { privateTraceSink }),
      },
    );
    agent.setTokenTracker(tokenTracker);
    return agent;
  });

  // Build engine GameConfig
  const defaultTimers = {
    introduction: 30000,
    lobby: 30000,
    mingle: 45000,
    rumor: 30000,
    vote: 20000,
    power: 15000,
    council: 20000,
  };
  const storedTimers = (gameConfig.timers ?? {}) as Record<string, number>;

  const roomPhaseTimer = storedTimers.mingle ?? defaultTimers.mingle;
  const { whisper: _unsupportedWhisperTimer, ...currentTimers } = storedTimers;

  const engineConfig: GameConfig = {
    maxRounds: (gameConfig.maxRounds as number) ?? 10,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    timers: {
      ...defaultTimers,
      ...currentTimers,
      mingle: roomPhaseTimer,
    },
  };

  const houseInterviewer = !useTestMockRunner && llmConfig
    ? new LLMHouseInterviewer(
        llmConfig.client,
        resolveModelForTier(gameConfig.modelTier as string | undefined),
        {
          gameId,
          ...(ownerEpoch && { ownerEpoch }),
          ...(privateTraceSink && { privateTraceSink }),
        },
      )
    : undefined;
  houseInterviewer?.setTokenTracker(tokenTracker);

  // Create runner
  const runner = new GameRunner(agents, engineConfig, houseInterviewer, {
    gameId,
    ...(privateTraceSink && { privateTraceSink }),
    tokenTracker,
    ...(ownerEpoch && {
      durableEventSink: (events) => appendGameEvents(db, { gameId, ownerEpoch, events }),
      durableCheckpointSink: async (checkpoint) => {
        const result = await writeGameCheckpoint(db, { gameId, ownerEpoch, checkpoint });
        if (!result.ok) {
          console.warn(`[game-lifecycle] Checkpoint degraded for game ${gameId}: ${result.error}`);
        }
      },
      beforeAcceptedCommit: () => assertOwnerActive(db, gameId, ownerEpoch),
    }),
  });

  // Stream game events to WebSocket observers via the display-hold pacer
  const viewerMode: ViewerMode =
    (gameConfig.viewerMode as ViewerMode) ?? "speedrun";
  const pacer = new ViewerEventPacer(
    viewerMode === "replay" ? "speedrun" : viewerMode,
    (event) => broadcastGameEvent(gameId, event),
  );
  runner.setStreamListener((event) => pacer.emit(event));

  // Run game asynchronously
  const heartbeat = ownerEpoch
    ? startOwnerHeartbeat(db, gameId, ownerEpoch, runner)
    : undefined;
  const promise = runGameAsync(db, gameId, runner, tokenTracker, gameConfig, ownerEpoch, heartbeat);

  activeGames.set(gameId, {
    gameId,
    runner,
    ...(ownerEpoch && { ownerEpoch }),
    ...(heartbeat && { heartbeat }),
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
  ownerEpoch?: string,
  heartbeat?: OwnerHeartbeat,
): Promise<void> {
  let clearMemoryOnExit = true;
  let persistedTranscriptEntries = 0;
  try {
    const result = await runner.run();
    await persistCompletedGame(db, {
      gameId,
      ...(ownerEpoch && { ownerEpoch }),
      result,
      finalEventSequence: runner.getCanonicalEvents().at(-1)?.sequence ?? 0,
      tokenTracker,
      gameConfig,
    });
    persistedTranscriptEntries = result.transcript.length;
    if (ownerEpoch) {
      broadcastRaw(gameId, {
        type: "game_over",
        winner: result.winner,
        winnerName: result.winnerName,
        totalRounds: result.rounds,
      });
    }

  } catch (err) {
    // Game failed — owner-backed runs suspend for inspection instead of pretending to cancel/complete.
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[game-lifecycle] Game ${gameId} failed:`, errorMessage);

    if (!ownerEpoch) {
      // Legacy non-owner path keeps best-effort partial transcripts. Durable runs
      // only publish transcript rows after event-backed terminal completion.
      try {
        const partialTranscript = runner.transcriptLog.slice(persistedTranscriptEntries);
        if (partialTranscript.length > 0) {
          const CHUNK_SIZE = 100;
          for (let i = 0; i < partialTranscript.length; i += CHUNK_SIZE) {
            const chunk = partialTranscript.slice(i, i + CHUNK_SIZE);
            await db.insert(schema.transcripts)
              .values(
                chunk.map((entry) => serializeTranscriptEntry(gameId, entry)),
              );
          }
          console.error(`[game-lifecycle] Saved ${partialTranscript.length} partial transcript entries for game ${gameId}`);
        }
      } catch (transcriptErr) {
        console.error(`[game-lifecycle] Failed to save partial transcript for game ${gameId}:`, transcriptErr);
      }
    }

    if (ownerEpoch && runner.aborted) {
      const currentGame = (await db
        .select({ status: schema.games.status })
        .from(schema.games)
        .where(eq(schema.games.id, gameId)))[0];
      if (currentGame?.status === "suspended") {
        clearMemoryOnExit = false;
        return;
      }

      const cancelled = await db.update(schema.games)
        .set({
          status: "cancelled",
          endedAt: new Date().toISOString(),
        })
        .where(and(eq(schema.games.id, gameId), eq(schema.games.status, "in_progress")))
        .returning({ id: schema.games.id });
      if (cancelled.length > 0) {
        broadcastRaw(gameId, {
          type: "game_status",
          gameId,
          status: "cancelled",
          terminal: true,
          reasonCode: "admin_stop",
          message: "Game cancelled.",
        });
      }
      return;
    }

    // Notify live viewers that the game cannot safely continue.
    broadcastRaw(gameId, { type: "error", message: "Game suspended because the run could not safely continue." });

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
      };

      if (ownerEpoch) {
        clearMemoryOnExit = false;
        await db.update(schema.games)
          .set({ config: JSON.stringify(updatedConfig) })
          .where(eq(schema.games.id, gameId));
        await markGameSuspended(db, gameId, "runner_failed", { message: errorMessage });
        broadcastRaw(gameId, {
          type: "game_status",
          gameId,
          status: "suspended",
          terminal: true,
          reasonCode: "runner_failed",
          message: "Game suspended because the run could not safely continue.",
        });
      } else {
        const fallbackConfig = { ...updatedConfig, viewerMode: "replay" };
        broadcastRaw(gameId, { type: "game_over", totalRounds: 0 });
        await db.update(schema.games)
          .set({
            status: "cancelled",
            endedAt: new Date().toISOString(),
            config: JSON.stringify(fallbackConfig),
          })
          .where(eq(schema.games.id, gameId));
      }
    } catch (dbErr) {
      console.error(`[game-lifecycle] Failed to update game ${gameId} status after error:`, dbErr);
    }
  } finally {
    heartbeat?.stop();
    // Clear operational memories — they exist only for game duration
    if (clearMemoryOnExit) {
      try {
        await new PgMemoryStore(db).clear(gameId);
      } catch (err) {
        console.warn(`[game-lifecycle] memory cleanup failed for game=${gameId}:`, err instanceof Error ? err.message : err);
      }
    }
    activeGames.delete(gameId);
  }
}
