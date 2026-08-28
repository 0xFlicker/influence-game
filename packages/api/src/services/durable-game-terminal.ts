import { asc, eq } from "drizzle-orm";
import {
  buildCompletedGameResults,
  estimateCostForKnownModel,
  parseOpenAIServiceTier,
  replayCanonicalEvents,
  resolveProviderManifestFromGameConfig,
  type OpenAIServiceTier,
  type ServiceTierUsage,
  type TokenUsage,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  captureGameCompletionSettlement,
  getGameCompletionSettlementSummary,
  settleCapturedGameCompletion,
  type CaptureGameCompletionSettlementResult,
  type GameCompletionTokenUsageV1,
  type SettleCapturedGameCompletionResult,
} from "./game-completion-settlement.js";
import { createDurableGameRunnerStore } from "./durable-game-runner-store.js";

export type DurableGameTerminalErrorCode =
  | "game_not_found"
  | "game_not_in_progress"
  | "invalid_game_config"
  | "execution_state_missing"
  | "execution_owner_mismatch"
  | "execution_not_terminal"
  | "terminal_event_missing"
  | "terminal_result_invalid"
  | "provider_accounting_invalid";

export class DurableGameTerminalError extends Error {
  constructor(
    public readonly code: DurableGameTerminalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DurableGameTerminalError";
  }
}

export interface DurableGameTerminalInput {
  gameId: string;
  /** The currently adopted, active owner of the terminal execution state. */
  ownerEpoch: string;
}

export interface DurableGameTerminalResult {
  capture: CaptureGameCompletionSettlementResult;
  settlement: SettleCapturedGameCompletionResult;
}

/**
 * Reconstruct and settle a completed durable run from committed PostgreSQL
 * authority only. This is the normal reload path: no runner-memory result,
 * suspended state, or operator retry preparation is required.
 */
export async function settleDurableTerminalGame(
  db: DrizzleDB,
  input: DurableGameTerminalInput,
): Promise<DurableGameTerminalResult> {
  const store = createDurableGameRunnerStore(db, input);
  const snapshot = await store.load(input.gameId);
  if (!snapshot) {
    throw new DurableGameTerminalError(
      "execution_state_missing",
      `Game ${input.gameId} has no durable execution state`,
    );
  }
  if (snapshot.execution.ownerEpoch !== input.ownerEpoch) {
    throw new DurableGameTerminalError(
      "execution_owner_mismatch",
      `Game ${input.gameId} terminal authority belongs to another owner`,
    );
  }
  if (
    snapshot.execution.status !== "terminal"
    || snapshot.execution.cursor.kind !== "terminal"
    || snapshot.execution.cursor.stage !== "commit_game"
  ) {
    throw new DurableGameTerminalError(
      "execution_not_terminal",
      `Game ${input.gameId} has not committed its terminal gameplay boundary`,
    );
  }

  const finalEvent = snapshot.canonicalEvents.at(-1);
  const finalEventHash = snapshot.execution.heads.eventHash;
  if (
    !finalEvent
    || finalEventHash === null
    || finalEvent.sequence !== snapshot.execution.heads.eventSequence
  ) {
    throw new DurableGameTerminalError(
      "terminal_event_missing",
      `Game ${input.gameId} terminal execution head has no matching canonical event`,
    );
  }

  const game = (await db.select({
    status: schema.games.status,
    config: schema.games.config,
  }).from(schema.games)
    .where(eq(schema.games.id, input.gameId))
    .limit(1))[0];
  if (!game) {
    throw new DurableGameTerminalError("game_not_found", `Game ${input.gameId} does not exist`);
  }
  if (game.status !== "in_progress") {
    throw new DurableGameTerminalError(
      "game_not_in_progress",
      `Game ${input.gameId} is ${game.status}, not in progress`,
    );
  }

  const gameConfig = parseGameConfig(game.config, input.gameId);
  let resolvedModel: string;
  try {
    resolvedModel = resolveProviderManifestFromGameConfig(gameConfig)[0]!.modelId;
  } catch (error) {
    throw new DurableGameTerminalError(
      "invalid_game_config",
      error instanceof Error ? error.message : `Game ${input.gameId} has an invalid provider manifest`,
    );
  }

  const completedResults = buildCompletedGameResults({
    events: snapshot.canonicalEvents,
    eventLogStatus: "complete",
    projectionStatus: "complete",
  });
  if (
    completedResults.source !== "durable_canonical_events"
    || completedResults.availability.status === "unavailable"
  ) {
    throw new DurableGameTerminalError(
      "terminal_result_invalid",
      `Game ${input.gameId} canonical terminal result could not be reconstructed`,
    );
  }
  const winner = completedResults.summary.winner;
  const projection = replayCanonicalEvents(snapshot.canonicalEvents);
  const eliminatedPlayerIds = completedResults.eliminationOrder.map((entry) => entry.player.id);
  const rankedPlayerIds = [
    ...(winner ? [winner.id] : []),
    ...projection.playerOrder.filter((playerId) =>
      playerId !== winner?.id && projection.players[playerId]?.status !== "eliminated"
    ),
    ...[...eliminatedPlayerIds].reverse(),
  ];
  if (new Set(rankedPlayerIds).size !== rankedPlayerIds.length) {
    throw new DurableGameTerminalError(
      "terminal_result_invalid",
      `Game ${input.gameId} canonical terminal ranking contains duplicate players`,
    );
  }
  if (winner && rankedPlayerIds[0] !== winner.id) {
    throw new DurableGameTerminalError(
      "terminal_result_invalid",
      `Game ${input.gameId} terminal winner is not first in the canonical ranking`,
    );
  }

  const tokenUsage = await reconstructProviderTokenUsage(db, input.gameId);
  const existingSettlement = await getGameCompletionSettlementSummary(db, input.gameId);
  if (existingSettlement.state === "pending") {
    if (
      existingSettlement.boundary?.finalEventSequence !== finalEvent.sequence
      || existingSettlement.boundary.finalEventHash !== finalEventHash
    ) {
      throw new DurableGameTerminalError(
        "terminal_result_invalid",
        `Game ${input.gameId} pending completion does not match terminal execution authority`,
      );
    }
    const settlement = await settleCapturedGameCompletion(db, input.gameId, {
      source: "runner",
      adoptedOwnerEpoch: input.ownerEpoch,
    });
    const existingRow = (await db.select({ id: schema.gameCompletionSettlements.id })
      .from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, input.gameId))
      .limit(1))[0];
    if (!existingRow || !existingSettlement.resultHash || !existingSettlement.capturedAt) {
      throw new DurableGameTerminalError(
        "terminal_result_invalid",
        `Game ${input.gameId} pending completion identity is incomplete`,
      );
    }
    return {
      capture: {
        settlementId: existingRow.id,
        created: false,
        state: "pending",
        resultHash: existingSettlement.resultHash,
        capturedAt: existingSettlement.capturedAt,
        retryReadyAt: existingSettlement.retryReadyAt,
      },
      settlement,
    };
  }
  const capture = await captureGameCompletionSettlement(db, {
    gameId: input.gameId,
    ownerEpoch: input.ownerEpoch,
    finalEventSequence: finalEvent.sequence,
    finalEventHash,
    terminalResult: {
      gameId: input.gameId,
      winnerId: winner?.id ?? null,
      winnerName: winner?.name ?? null,
      rounds: completedResults.summary.roundsPlayed,
      transcript: snapshot.transcriptEntries,
      eliminationOrder: completedResults.eliminationOrder.map((entry) => entry.player.name),
      rankedPlayerIds,
    },
    tokenUsage,
    resolvedModel,
    calculatedCost: estimateCostForKnownModel(tokenUsage.total, resolvedModel),
    completionConfig: { ...gameConfig, viewerMode: "replay" },
    // The canonical commit timestamp, not the time a reloaded process noticed it.
    finishedAt: finalEvent.timestamp,
  });
  const settlement = await settleCapturedGameCompletion(db, input.gameId, {
    source: "runner",
  });
  return { capture, settlement };
}

function parseGameConfig(value: string, gameId: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new DurableGameTerminalError(
      "invalid_game_config",
      `Game ${gameId} config is not valid JSON`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DurableGameTerminalError(
      "invalid_game_config",
      `Game ${gameId} config is not a JSON object`,
    );
  }
  return parsed as Record<string, unknown>;
}

const EMPTY_USAGE: TokenUsage = {
  promptTokens: 0,
  cachedTokens: 0,
  cacheWriteTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  callCount: 0,
  emptyResponses: 0,
};

async function reconstructProviderTokenUsage(
  db: DrizzleDB,
  gameId: string,
): Promise<GameCompletionTokenUsageV1> {
  const rows = await db.select({
    attemptId: schema.providerCallAttempts.id,
    status: schema.providerCallAttempts.status,
    accounting: schema.providerCallAttempts.accounting,
    action: schema.providerLogicalCalls.action,
    actorName: schema.providerLogicalCalls.actorName,
  }).from(schema.providerCallAttempts)
    .innerJoin(
      schema.providerLogicalCalls,
      eq(schema.providerLogicalCalls.id, schema.providerCallAttempts.logicalCallId),
    )
    .where(eq(schema.providerCallAttempts.gameId, gameId))
    .orderBy(
      asc(schema.providerLogicalCalls.id),
      asc(schema.providerCallAttempts.attemptOrdinal),
    );

  const total = emptyUsage();
  const perAction: Record<string, TokenUsage> = {};
  const byServiceTier: ServiceTierUsage = {};
  for (const row of rows) {
    if (row.status !== "terminal" || row.accounting?.usage === undefined) continue;
    const usage = normalizeAttemptUsage(row.accounting.usage, row.attemptId);
    const source = `${row.actorName}/${row.action}`;
    addUsage(total, usage);
    addUsage(perAction[source] ??= emptyUsage(), usage);
    const tier = parseOpenAIServiceTier(row.accounting.effectiveServiceTier);
    if (tier) addUsageForTier(byServiceTier, tier, usage);
  }

  return {
    total,
    perAction: Object.fromEntries(Object.entries(perAction).sort(([left], [right]) =>
      left.localeCompare(right)
    )),
    ...(Object.keys(byServiceTier).length > 0 && { byServiceTier }),
  };
}

function normalizeAttemptUsage(
  value: NonNullable<NonNullable<typeof schema.providerCallAttempts.$inferSelect.accounting>["usage"]>,
  attemptId: string,
): TokenUsage {
  const promptTokens = accountingInteger(value.promptTokens, "promptTokens", attemptId);
  const cachedTokens = accountingInteger(value.cachedTokens, "cachedTokens", attemptId);
  const cacheWriteTokens = accountingInteger(value.cacheWriteTokens, "cacheWriteTokens", attemptId);
  const completionTokens = accountingInteger(value.completionTokens, "completionTokens", attemptId);
  const reasoningTokens = accountingInteger(value.reasoningTokens, "reasoningTokens", attemptId);
  const reportedTotal = accountingInteger(value.totalTokens, "totalTokens", attemptId);
  return {
    promptTokens: promptTokens ?? 0,
    cachedTokens: cachedTokens ?? 0,
    cacheWriteTokens: cacheWriteTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    reasoningTokens: reasoningTokens ?? 0,
    totalTokens: reportedTotal ?? (promptTokens ?? 0) + (completionTokens ?? 0),
    callCount: 1,
    emptyResponses: 0,
  };
}

function accountingInteger(
  value: number | undefined,
  field: string,
  attemptId: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DurableGameTerminalError(
      "provider_accounting_invalid",
      `Provider attempt ${attemptId} has invalid ${field}`,
    );
  }
  return value;
}

function emptyUsage(): TokenUsage {
  return { ...EMPTY_USAGE };
}

function addUsage(target: TokenUsage, value: TokenUsage): void {
  target.promptTokens += value.promptTokens;
  target.cachedTokens += value.cachedTokens;
  target.cacheWriteTokens = (target.cacheWriteTokens ?? 0) + (value.cacheWriteTokens ?? 0);
  target.completionTokens += value.completionTokens;
  target.reasoningTokens += value.reasoningTokens;
  target.totalTokens += value.totalTokens;
  target.callCount += value.callCount;
  target.emptyResponses += value.emptyResponses;
}

function addUsageForTier(
  usageByTier: ServiceTierUsage,
  tier: OpenAIServiceTier,
  value: TokenUsage,
): void {
  const target = usageByTier[tier] ?? emptyUsage();
  addUsage(target, value);
  usageByTier[tier] = target;
}
