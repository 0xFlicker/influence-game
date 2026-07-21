import { randomUUID } from "crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Phase } from "@influence/engine";
import type { CostEstimate, TokenUsage, TranscriptEntry } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { GameCompletionSettlementState } from "../db/schema.js";
import { calculateEloChanges } from "./elo.js";
import type { PlayerResult } from "./elo.js";
import {
  CompetitionSettlementRepairRequiredError,
  completeCompetitionGameInTransaction,
} from "./competition-completion.js";
import { ensureWaitingPostgameMediaRow } from "./postgame-media-coordinator.js";
import { sha256StableJson } from "./stable-hash.js";
import { serializeTranscriptEntry } from "./transcript-serialization.js";

export const GAME_COMPLETION_ENVELOPE_SCHEMA = "influence.game-completion" as const;
/** Historical completion envelope version (completed V1 records remain valid). */
export const GAME_COMPLETION_ENVELOPE_VERSION = 1 as const;
/** Current-capture completion envelope version (normalized dialogue identity). */
export const GAME_COMPLETION_ENVELOPE_VERSION_V2 = 2 as const;
export const GAME_COMPLETION_SETTLEMENT_SUMMARY_VERSION = 1 as const;
export const COMPLETION_SETTLEMENT_TRANSIENT_FAILURE = "completion_settlement_transient_failure" as const;
export const COMPLETION_SETTLEMENT_REPAIR_REQUIRED = "completion_settlement_repair_required" as const;

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const PHASES = new Set<string>(Object.values(Phase));
const TRANSCRIPT_SCOPES = new Set<TranscriptEntry["scope"]>([
  "public",
  "mingle",
  "huddle",
  "whisper",
  "system",
  "diary",
  "thinking",
]);

const GAME_COMPLETION_SETTLEMENT_SAFE_FAILURE_CODES = [
  COMPLETION_SETTLEMENT_TRANSIENT_FAILURE,
  "competition_settlement_evidence_missing",
  "competition_settlement_evidence_mismatch",
  "completion_envelope_invalid",
  "completion_envelope_hash_mismatch",
  "completion_boundary_conflict",
  "completion_game_state_conflict",
] as const;

const GAME_COMPLETION_SETTLEMENT_SAFE_FAILURE_CODE_SET = new Set<string>(
  GAME_COMPLETION_SETTLEMENT_SAFE_FAILURE_CODES,
);

export type GameCompletionSettlementSafeFailureCode =
  typeof GAME_COMPLETION_SETTLEMENT_SAFE_FAILURE_CODES[number];

export interface GameCompletionTerminalResultV1 {
  /** Read independently from the runner snapshot and checked against the API game. */
  gameId: string;
  winnerId: string | null;
  winnerName: string | null;
  rounds: number;
  transcript: TranscriptEntry[];
  eliminationOrder: string[];
  rankedPlayerIds: string[];
}

export interface GameCompletionTokenUsageV1 {
  total: TokenUsage;
  perAction: Record<string, TokenUsage>;
}

export interface GameCompletionEnvelopeV1 {
  schema: typeof GAME_COMPLETION_ENVELOPE_SCHEMA;
  version: typeof GAME_COMPLETION_ENVELOPE_VERSION;
  boundary: {
    ownerEpoch: string;
    finalEventSequence: number;
    finalEventHash: string;
  };
  result: GameCompletionTerminalResultV1;
  tokenUsage: GameCompletionTokenUsageV1;
  model: {
    resolvedModel: string;
    calculatedCost: CostEstimate | null;
  };
  completionConfig: Record<string, unknown>;
  finishedAt: string;
}

/**
 * V2 terminal result uses the same structural fields as V1 but requires
 * normalized dialogue identity on dialogue-bearing transcript entries.
 */
export interface GameCompletionTerminalResultV2 extends GameCompletionTerminalResultV1 {}

export interface GameCompletionEnvelopeV2 {
  schema: typeof GAME_COMPLETION_ENVELOPE_SCHEMA;
  version: typeof GAME_COMPLETION_ENVELOPE_VERSION_V2;
  boundary: {
    ownerEpoch: string;
    finalEventSequence: number;
    finalEventHash: string;
  };
  result: GameCompletionTerminalResultV2;
  tokenUsage: GameCompletionTokenUsageV1;
  model: {
    resolvedModel: string;
    calculatedCost: CostEstimate | null;
  };
  completionConfig: Record<string, unknown>;
  finishedAt: string;
}

export type GameCompletionEnvelope = GameCompletionEnvelopeV1 | GameCompletionEnvelopeV2;

export interface CaptureGameCompletionSettlementInput {
  gameId: string;
  ownerEpoch: string;
  finalEventSequence: number;
  finalEventHash: string;
  terminalResult: GameCompletionTerminalResultV1;
  tokenUsage: GameCompletionTokenUsageV1;
  resolvedModel: string;
  calculatedCost: CostEstimate | null;
  completionConfig: Record<string, unknown>;
  finishedAt: string;
}

export type GameCompletionSettlementCaptureErrorCode =
  | "invalid_envelope"
  | "terminal_game_mismatch"
  | "game_not_in_progress"
  | "owner_not_found"
  | "owner_not_active"
  | "owner_expired"
  | "event_head_mismatch"
  | "event_boundary_not_found"
  | "event_owner_mismatch"
  | "event_hash_mismatch"
  | "conflicting_capture"
  | "stored_payload_invalid"
  | "stored_payload_hash_mismatch";

export class GameCompletionSettlementCaptureError extends Error {
  constructor(
    public readonly code: GameCompletionSettlementCaptureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GameCompletionSettlementCaptureError";
  }
}

export interface GameCompletionSettlementSummary {
  schemaVersion: typeof GAME_COMPLETION_SETTLEMENT_SUMMARY_VERSION;
  state: GameCompletionSettlementState | "not_applicable";
  retryEligible: boolean;
  attemptCount: number;
  resultHash: string | null;
  boundary: {
    ownerEpoch: string;
    finalEventSequence: number;
    finalEventHash: string;
  } | null;
  failureCode: string | null;
  capturedAt: string | null;
  retryReadyAt: string | null;
  lastAttemptedAt: string | null;
  completedAt: string | null;
}

type SettlementSummaryRow = Pick<
  typeof schema.gameCompletionSettlements.$inferSelect,
  | "state"
  | "attemptCount"
  | "payloadHash"
  | "ownerEpoch"
  | "finalEventSequence"
  | "finalEventHash"
  | "lastSafeFailureCode"
  | "capturedAt"
  | "retryReadyAt"
  | "lastAttemptedAt"
  | "completedAt"
>;

export interface CaptureGameCompletionSettlementResult {
  settlementId: string;
  created: boolean;
  state: GameCompletionSettlementState;
  resultHash: string;
  capturedAt: string;
  retryReadyAt: string | null;
}

export type SettleCapturedGameCompletionContext =
  | {
      source: "runner";
      actorUserId?: never;
      requestedReason?: never;
      auditAttemptId?: never;
    }
  | {
      source: "admin";
      actorUserId: string;
      requestedReason: string;
      /** Audit-first row created before the operator is allowed to mutate settlement state. */
      auditAttemptId?: string;
    };

export type SettleCapturedGameCompletionOutcome = "completed" | "already_completed";

export interface SettleCapturedGameCompletionResult {
  outcome: SettleCapturedGameCompletionOutcome;
  state: "completed";
  resultHash: string;
  completedAt: string;
  settlement: GameCompletionSettlementSummary;
}

export interface PreparePendingCompletionSettlementsResult {
  scanned: number;
  readyGameIds: string[];
}

export interface PrepareCapturedCompletionAfterRunnerExitResult {
  state: GameCompletionSettlementState | "not_applicable";
  prepared: boolean;
  retryReady: boolean;
  openedRetry: boolean;
}

export type GameCompletionSettlementErrorCode =
  | "completion_settlement_not_found"
  | "completion_settlement_retry_not_ready"
  | typeof COMPLETION_SETTLEMENT_REPAIR_REQUIRED;

export class GameCompletionSettlementError extends Error {
  constructor(
    public readonly code: GameCompletionSettlementErrorCode,
    public readonly safeFailureCode: GameCompletionSettlementSafeFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "GameCompletionSettlementError";
  }
}

class DeterministicSettlementError extends Error {
  constructor(
    public readonly safeFailureCode: GameCompletionSettlementSafeFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "DeterministicSettlementError";
  }
}

/**
 * Version-dispatched completion envelope validation. V1 preserves historical
 * completed-record semantics; V2 requires normalized dialogue fields.
 */
export function assertGameCompletionEnvelope(value: unknown): GameCompletionEnvelope {
  const record = assertRecord(value, "Invalid completion envelope");
  if (record.version === GAME_COMPLETION_ENVELOPE_VERSION_V2) {
    return assertGameCompletionEnvelopeV2(value);
  }
  return assertGameCompletionEnvelopeV1(value);
}

/**
 * Validate and normalize a v1 terminal envelope. Unknown fields fail closed;
 * JSON snapshots remain opaque but must contain only JSON-safe values.
 */
export function assertGameCompletionEnvelopeV1(value: unknown): GameCompletionEnvelopeV1 {
  return assertGameCompletionEnvelopeAtVersion(value, GAME_COMPLETION_ENVELOPE_VERSION);
}

export function assertGameCompletionEnvelopeV2(value: unknown): GameCompletionEnvelopeV2 {
  return assertGameCompletionEnvelopeAtVersion(value, GAME_COMPLETION_ENVELOPE_VERSION_V2);
}

function assertGameCompletionEnvelopeAtVersion(
  value: unknown,
  expectedVersion: typeof GAME_COMPLETION_ENVELOPE_VERSION,
): GameCompletionEnvelopeV1;
function assertGameCompletionEnvelopeAtVersion(
  value: unknown,
  expectedVersion: typeof GAME_COMPLETION_ENVELOPE_VERSION_V2,
): GameCompletionEnvelopeV2;
function assertGameCompletionEnvelopeAtVersion(
  value: unknown,
  expectedVersion: typeof GAME_COMPLETION_ENVELOPE_VERSION | typeof GAME_COMPLETION_ENVELOPE_VERSION_V2,
): GameCompletionEnvelope {
  const record = assertRecord(value, "Invalid completion envelope");
  assertExactKeys(record, [
    "schema",
    "version",
    "boundary",
    "result",
    "tokenUsage",
    "model",
    "completionConfig",
    "finishedAt",
  ], "completion envelope");
  if (record.schema !== GAME_COMPLETION_ENVELOPE_SCHEMA) {
    throw new Error("Invalid completion envelope schema");
  }
  if (record.version !== expectedVersion) {
    throw new Error(`Invalid completion envelope version: expected ${expectedVersion}`);
  }

  const boundary = assertRecord(record.boundary, "Invalid completion envelope boundary");
  assertExactKeys(boundary, ["ownerEpoch", "finalEventSequence", "finalEventHash"], "completion boundary");
  const normalizedBoundary = {
    ownerEpoch: assertText(boundary.ownerEpoch, "Invalid completion owner epoch"),
    finalEventSequence: assertInteger(boundary.finalEventSequence, "Invalid completion event sequence", 1),
    finalEventHash: assertSha256(boundary.finalEventHash, "Invalid completion event hash"),
  };

  const result = expectedVersion === GAME_COMPLETION_ENVELOPE_VERSION_V2
    ? assertTerminalResultV2(record.result)
    : assertTerminalResult(record.result);
  const tokenUsage = assertTokenUsageSnapshot(record.tokenUsage);
  const model = assertRecord(record.model, "Invalid completion model snapshot");
  assertExactKeys(model, ["resolvedModel", "calculatedCost"], "completion model snapshot");
  const resolvedModel = assertText(model.resolvedModel, "Invalid completion resolved model");
  const calculatedCost = assertCostEstimate(model.calculatedCost);
  if (calculatedCost && calculatedCost.model !== resolvedModel) {
    throw new Error("Completion cost model does not match resolved model");
  }

  const completionConfig = assertJsonRecord(record.completionConfig, "Invalid completion config snapshot");
  const finishedAt = assertIsoTimestamp(record.finishedAt, "Invalid completion finish time");

  if (expectedVersion === GAME_COMPLETION_ENVELOPE_VERSION_V2) {
    return {
      schema: GAME_COMPLETION_ENVELOPE_SCHEMA,
      version: GAME_COMPLETION_ENVELOPE_VERSION_V2,
      boundary: normalizedBoundary,
      result,
      tokenUsage,
      model: { resolvedModel, calculatedCost },
      completionConfig,
      finishedAt,
    };
  }

  return {
    schema: GAME_COMPLETION_ENVELOPE_SCHEMA,
    version: GAME_COMPLETION_ENVELOPE_VERSION,
    boundary: normalizedBoundary,
    result,
    tokenUsage,
    model: { resolvedModel, calculatedCost },
    completionConfig,
    finishedAt,
  };
}

export function hashGameCompletionEnvelope(value: unknown): string {
  return sha256StableJson(assertGameCompletionEnvelope(value));
}

export function buildGameCompletionSettlementSummary(
  row: SettlementSummaryRow | null | undefined,
  now = new Date(),
): GameCompletionSettlementSummary {
  if (!row) {
    return {
      schemaVersion: GAME_COMPLETION_SETTLEMENT_SUMMARY_VERSION,
      state: "not_applicable",
      retryEligible: false,
      attemptCount: 0,
      resultHash: null,
      boundary: null,
      failureCode: null,
      capturedAt: null,
      retryReadyAt: null,
      lastAttemptedAt: null,
      completedAt: null,
    };
  }

  const retryReadyAtMs = row.retryReadyAt ? new Date(row.retryReadyAt).getTime() : Number.NaN;
  return {
    schemaVersion: GAME_COMPLETION_SETTLEMENT_SUMMARY_VERSION,
    state: row.state,
    retryEligible: row.state === "pending"
      && Number.isFinite(retryReadyAtMs)
      && retryReadyAtMs <= now.getTime(),
    attemptCount: row.attemptCount,
    resultHash: row.payloadHash,
    boundary: {
      ownerEpoch: row.ownerEpoch,
      finalEventSequence: row.finalEventSequence,
      finalEventHash: row.finalEventHash,
    },
    failureCode: row.lastSafeFailureCode,
    capturedAt: row.capturedAt,
    retryReadyAt: row.retryReadyAt,
    lastAttemptedAt: row.lastAttemptedAt,
    completedAt: row.completedAt,
  };
}

export async function getGameCompletionSettlementSummary(
  db: Pick<DrizzleDB, "select">,
  gameId: string,
): Promise<GameCompletionSettlementSummary> {
  const row = (await db.select({
    state: schema.gameCompletionSettlements.state,
    attemptCount: schema.gameCompletionSettlements.attemptCount,
    payloadHash: schema.gameCompletionSettlements.payloadHash,
    ownerEpoch: schema.gameCompletionSettlements.ownerEpoch,
    finalEventSequence: schema.gameCompletionSettlements.finalEventSequence,
    finalEventHash: schema.gameCompletionSettlements.finalEventHash,
    lastSafeFailureCode: schema.gameCompletionSettlements.lastSafeFailureCode,
    capturedAt: schema.gameCompletionSettlements.capturedAt,
    retryReadyAt: schema.gameCompletionSettlements.retryReadyAt,
    lastAttemptedAt: schema.gameCompletionSettlements.lastAttemptedAt,
    completedAt: schema.gameCompletionSettlements.completedAt,
  })
    .from(schema.gameCompletionSettlements)
    .where(eq(schema.gameCompletionSettlements.gameId, gameId))
    .limit(1))[0];

  return buildGameCompletionSettlementSummary(row);
}

export async function getGameCompletionSettlementSummaryMap(
  db: Pick<DrizzleDB, "select">,
  gameIds: readonly string[],
): Promise<Map<string, GameCompletionSettlementSummary>> {
  const uniqueGameIds = [...new Set(gameIds)];
  if (uniqueGameIds.length === 0) return new Map();
  const rows = await db.select({
    gameId: schema.gameCompletionSettlements.gameId,
    state: schema.gameCompletionSettlements.state,
    attemptCount: schema.gameCompletionSettlements.attemptCount,
    payloadHash: schema.gameCompletionSettlements.payloadHash,
    ownerEpoch: schema.gameCompletionSettlements.ownerEpoch,
    finalEventSequence: schema.gameCompletionSettlements.finalEventSequence,
    finalEventHash: schema.gameCompletionSettlements.finalEventHash,
    lastSafeFailureCode: schema.gameCompletionSettlements.lastSafeFailureCode,
    capturedAt: schema.gameCompletionSettlements.capturedAt,
    retryReadyAt: schema.gameCompletionSettlements.retryReadyAt,
    lastAttemptedAt: schema.gameCompletionSettlements.lastAttemptedAt,
    completedAt: schema.gameCompletionSettlements.completedAt,
  }).from(schema.gameCompletionSettlements)
    .where(inArray(schema.gameCompletionSettlements.gameId, uniqueGameIds));
  return new Map(rows.map((row) => [
    row.gameId,
    buildGameCompletionSettlementSummary(row),
  ]));
}

export async function getGameCompletionSettlementState(
  db: Pick<DrizzleDB, "select">,
  gameId: string,
): Promise<GameCompletionSettlementState | undefined> {
  return (await db.select({ state: schema.gameCompletionSettlements.state })
    .from(schema.gameCompletionSettlements)
    .where(eq(schema.gameCompletionSettlements.gameId, gameId))
    .limit(1))[0]?.state;
}

export async function getGameCompletionSettlementStateMap(
  db: Pick<DrizzleDB, "select">,
  gameIds: readonly string[],
): Promise<Map<string, GameCompletionSettlementState>> {
  const uniqueGameIds = [...new Set(gameIds)];
  if (uniqueGameIds.length === 0) return new Map();
  const rows = await db.select({
    gameId: schema.gameCompletionSettlements.gameId,
    state: schema.gameCompletionSettlements.state,
  }).from(schema.gameCompletionSettlements)
    .where(inArray(schema.gameCompletionSettlements.gameId, uniqueGameIds));
  return new Map(rows.map((row) => [row.gameId, row.state]));
}

/**
 * After the originating runner is absent, atomically turn a sealed non-final
 * completion into its fail-closed operational state. This is idempotent and
 * derives authority from the durable settlement row, not volatile runner
 * memory, so an ambiguous capture commit can still be recovered safely.
 */
export async function prepareCapturedCompletionAfterRunnerExit(
  db: DrizzleDB,
  gameId: string,
  source: "runner_exit" | "api_startup",
): Promise<PrepareCapturedCompletionAfterRunnerExitResult> {
  return db.transaction(async (tx) => {
    const settlement = (await tx.select({
      id: schema.gameCompletionSettlements.id,
      ownerEpoch: schema.gameCompletionSettlements.ownerEpoch,
      finalEventSequence: schema.gameCompletionSettlements.finalEventSequence,
      state: schema.gameCompletionSettlements.state,
      retryReadyAt: schema.gameCompletionSettlements.retryReadyAt,
      lastSafeFailureCode: schema.gameCompletionSettlements.lastSafeFailureCode,
    }).from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, gameId))
      .for("update")
      .limit(1))[0];
    if (!settlement) {
      return { state: "not_applicable", prepared: false, retryReady: false, openedRetry: false };
    }
    if (settlement.state === "completed") {
      return { state: "completed", prepared: true, retryReady: false, openedRetry: false };
    }

    const game = (await tx.select({
      status: schema.games.status,
      endedAt: schema.games.endedAt,
    })
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .for("update"))[0];
    if (!game || (game.status !== "in_progress" && game.status !== "suspended")) {
      return { state: settlement.state, prepared: false, retryReady: false, openedRetry: false };
    }

    const owner = (await tx.select({
      status: schema.gameRunOwners.status,
      closedAt: schema.gameRunOwners.closedAt,
      lastPersistedEventSequence: schema.gameRunOwners.lastPersistedEventSequence,
    }).from(schema.gameRunOwners)
      .where(and(
        eq(schema.gameRunOwners.gameId, gameId),
        eq(schema.gameRunOwners.ownerEpoch, settlement.ownerEpoch),
      ))
      .for("update"))[0];
    if (!owner
      || (owner.status !== "active" && owner.status !== "expired")
      || owner.lastPersistedEventSequence !== settlement.finalEventSequence) {
      return { state: settlement.state, prepared: false, retryReady: false, openedRetry: false };
    }

    const preparedAt = new Date().toISOString();
    const failureReason = settlement.state === "repair_required"
      ? COMPLETION_SETTLEMENT_REPAIR_REQUIRED
      : COMPLETION_SETTLEMENT_TRANSIENT_FAILURE;
    await tx.update(schema.gameRunOwners).set({
      status: "expired",
      closedAt: owner.closedAt ?? preparedAt,
      kernelHealth: "suspended",
      failureReason,
      failureDetails: {
        source,
        safeFailureCode: settlement.lastSafeFailureCode ?? failureReason,
      },
    }).where(and(
      eq(schema.gameRunOwners.gameId, gameId),
      eq(schema.gameRunOwners.ownerEpoch, settlement.ownerEpoch),
      inArray(schema.gameRunOwners.status, ["active", "expired"]),
    ));
    if (game.status === "in_progress") {
      await tx.update(schema.games).set({
        status: "suspended",
        endedAt: game.endedAt ?? preparedAt,
      }).where(and(
        eq(schema.games.id, gameId),
        eq(schema.games.status, "in_progress"),
      ));
    }

    let openedRetry = false;
    if (settlement.state === "pending" && settlement.retryReadyAt === null) {
      const ready = await tx.update(schema.gameCompletionSettlements).set({
        retryReadyAt: preparedAt,
        updatedAt: preparedAt,
      }).where(and(
        eq(schema.gameCompletionSettlements.id, settlement.id),
        eq(schema.gameCompletionSettlements.state, "pending"),
        isNull(schema.gameCompletionSettlements.retryReadyAt),
      )).returning({ gameId: schema.gameCompletionSettlements.gameId });
      openedRetry = ready.length === 1;
    }
    return {
      state: settlement.state,
      prepared: true,
      retryReady: settlement.state === "pending",
      openedRetry,
    };
  });
}

export async function markPendingCompletionSettlementRetryReady(
  db: DrizzleDB,
  gameId: string,
  source: "runner_exit" | "api_startup",
): Promise<boolean> {
  return (await prepareCapturedCompletionAfterRunnerExit(db, gameId, source)).openedRetry;
}

/** Startup is the proof that no runner from the prior process can still race. */
export async function preparePendingCompletionSettlementsOnStartup(
  db: DrizzleDB,
): Promise<PreparePendingCompletionSettlementsResult> {
  const rows = await db.select({ gameId: schema.gameCompletionSettlements.gameId })
    .from(schema.gameCompletionSettlements)
    .where(and(
      eq(schema.gameCompletionSettlements.state, "pending"),
      isNull(schema.gameCompletionSettlements.retryReadyAt),
    ))
    .orderBy(asc(schema.gameCompletionSettlements.gameId));
  const readyGameIds: string[] = [];
  for (const row of rows) {
    if (await markPendingCompletionSettlementRetryReady(db, row.gameId, "api_startup")) {
      readyGameIds.push(row.gameId);
    }
  }
  return { scanned: rows.length, readyGameIds };
}

/**
 * Seal the engine-finished result before any completion side effect. The
 * private payload is intentionally absent from the return value.
 */
export async function captureGameCompletionSettlement(
  db: DrizzleDB,
  input: CaptureGameCompletionSettlementInput,
): Promise<CaptureGameCompletionSettlementResult> {
  if (input.terminalResult.gameId !== input.gameId) {
    throw new GameCompletionSettlementCaptureError(
      "terminal_game_mismatch",
      `Terminal result belongs to game ${input.terminalResult.gameId}, expected ${input.gameId}`,
    );
  }

  let envelope: GameCompletionEnvelopeV1;
  try {
    envelope = assertGameCompletionEnvelopeV1({
      schema: GAME_COMPLETION_ENVELOPE_SCHEMA,
      version: GAME_COMPLETION_ENVELOPE_VERSION,
      boundary: {
        ownerEpoch: input.ownerEpoch,
        finalEventSequence: input.finalEventSequence,
        finalEventHash: input.finalEventHash,
      },
      result: input.terminalResult,
      tokenUsage: input.tokenUsage,
      model: {
        resolvedModel: input.resolvedModel,
        calculatedCost: input.calculatedCost,
      },
      completionConfig: input.completionConfig,
      finishedAt: input.finishedAt,
    });
  } catch (error) {
    throw new GameCompletionSettlementCaptureError(
      "invalid_envelope",
      error instanceof Error ? error.message : "Invalid completion envelope",
    );
  }
  const payloadHash = hashGameCompletionEnvelope(envelope);

  return db.transaction(async (tx) => {
    // The game row is the lifecycle mutex shared with stop/void. Once capture
    // holds it, cancellation cannot cross the one-way sealed boundary.
    const game = (await tx.select({ status: schema.games.status })
      .from(schema.games)
      .where(eq(schema.games.id, input.gameId))
      .for("update")
      .limit(1))[0];
    if (game?.status !== "in_progress") {
      throw new GameCompletionSettlementCaptureError(
        "game_not_in_progress",
        `Completion game ${input.gameId} is not in progress`,
      );
    }

    const owner = (await tx.select({
      status: schema.gameRunOwners.status,
      expiresAt: schema.gameRunOwners.expiresAt,
      lastPersistedEventSequence: schema.gameRunOwners.lastPersistedEventSequence,
    })
      .from(schema.gameRunOwners)
      .where(and(
        eq(schema.gameRunOwners.gameId, input.gameId),
        eq(schema.gameRunOwners.ownerEpoch, input.ownerEpoch),
      ))
      .for("update")
      .limit(1))[0];

    if (!owner) {
      throw new GameCompletionSettlementCaptureError(
        "owner_not_found",
        `No durable owner ${input.ownerEpoch} for game ${input.gameId}`,
      );
    }
    if (owner.status !== "active") {
      throw new GameCompletionSettlementCaptureError(
        "owner_not_active",
        `Owner epoch ${input.ownerEpoch} is ${owner.status}`,
      );
    }
    if (owner.expiresAt && new Date(owner.expiresAt).getTime() <= Date.now()) {
      throw new GameCompletionSettlementCaptureError(
        "owner_expired",
        `Owner epoch ${input.ownerEpoch} expired`,
      );
    }
    if (owner.lastPersistedEventSequence !== input.finalEventSequence) {
      throw new GameCompletionSettlementCaptureError(
        "event_head_mismatch",
        `Persisted owner head ${owner.lastPersistedEventSequence} does not match terminal head ${input.finalEventSequence}`,
      );
    }

    const eventBoundary = (await tx.select({
      eventHash: schema.gameEvents.eventHash,
      ownerEpoch: schema.gameEvents.ownerEpoch,
    })
      .from(schema.gameEvents)
      .where(and(
        eq(schema.gameEvents.gameId, input.gameId),
        eq(schema.gameEvents.sequence, input.finalEventSequence),
      ))
      .limit(1))[0];
    if (!eventBoundary) {
      throw new GameCompletionSettlementCaptureError(
        "event_boundary_not_found",
        `Final event boundary ${input.finalEventSequence} was not found`,
      );
    }
    if (eventBoundary.ownerEpoch !== input.ownerEpoch) {
      throw new GameCompletionSettlementCaptureError(
        "event_owner_mismatch",
        "Final event boundary belongs to a different owner epoch",
      );
    }
    if (eventBoundary.eventHash !== input.finalEventHash) {
      throw new GameCompletionSettlementCaptureError(
        "event_hash_mismatch",
        "Final event hash does not match the persisted boundary",
      );
    }

    const existing = (await tx.select()
      .from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, input.gameId))
      .limit(1))[0];
    if (existing) {
      let storedEnvelope: GameCompletionEnvelope;
      try {
        storedEnvelope = assertGameCompletionEnvelope(existing.payload);
      } catch (error) {
        throw new GameCompletionSettlementCaptureError(
          "stored_payload_invalid",
          error instanceof Error ? error.message : "Stored completion payload is invalid",
        );
      }
      if (hashGameCompletionEnvelope(storedEnvelope) !== existing.payloadHash) {
        throw new GameCompletionSettlementCaptureError(
          "stored_payload_hash_mismatch",
          "Stored completion payload hash does not match its contents",
        );
      }
      const exactBoundary = existing.ownerEpoch === input.ownerEpoch
        && existing.finalEventSequence === input.finalEventSequence
        && existing.finalEventHash === input.finalEventHash
        && (
          existing.payloadSchemaVersion === GAME_COMPLETION_ENVELOPE_VERSION
          || existing.payloadSchemaVersion === GAME_COMPLETION_ENVELOPE_VERSION_V2
        );
      if (!exactBoundary || existing.payloadHash !== payloadHash) {
        throw new GameCompletionSettlementCaptureError(
          "conflicting_capture",
          `Game ${input.gameId} already has a different completion envelope`,
        );
      }
      return {
        settlementId: existing.id,
        created: false,
        state: existing.state,
        resultHash: existing.payloadHash,
        capturedAt: existing.capturedAt,
        retryReadyAt: existing.retryReadyAt,
      };
    }

    const settlementId = randomUUID();
    const inserted = (await tx.insert(schema.gameCompletionSettlements)
      .values({
        id: settlementId,
        gameId: input.gameId,
        ownerEpoch: input.ownerEpoch,
        finalEventSequence: input.finalEventSequence,
        finalEventHash: input.finalEventHash,
        payloadSchemaVersion: GAME_COMPLETION_ENVELOPE_VERSION,
        payload: envelope as unknown as Record<string, unknown>,
        payloadHash,
        state: "pending",
      })
      .returning({
        capturedAt: schema.gameCompletionSettlements.capturedAt,
        retryReadyAt: schema.gameCompletionSettlements.retryReadyAt,
      }))[0]!;

    return {
      settlementId,
      created: true,
      state: "pending",
      resultHash: payloadHash,
      capturedAt: inserted.capturedAt,
      retryReadyAt: inserted.retryReadyAt,
    };
  });
}

/**
 * Settle every terminal side effect from the sealed envelope. Callers may
 * identify the operational attempt, but cannot provide any outcome data.
 */
export async function settleCapturedGameCompletion(
  db: DrizzleDB,
  gameId: string,
  context: SettleCapturedGameCompletionContext,
): Promise<SettleCapturedGameCompletionResult> {
  try {
    return await db.transaction(async (tx) => {
      const settlement = (await tx.select()
        .from(schema.gameCompletionSettlements)
        .where(eq(schema.gameCompletionSettlements.gameId, gameId))
        .for("update")
        .limit(1))[0];
      if (!settlement) {
        throw new GameCompletionSettlementError(
          "completion_settlement_not_found",
          "completion_game_state_conflict",
          `No completion settlement exists for game ${gameId}`,
        );
      }

      const envelope = validateStoredSettlement(settlement, gameId);
      if (settlement.state === "repair_required") {
        throw new DeterministicSettlementError(
          safeFailureCode(settlement.lastSafeFailureCode, "completion_game_state_conflict"),
          `Completion settlement for game ${gameId} requires repair`,
        );
      }

      const attemptedAt = new Date().toISOString();
      if (settlement.state === "completed") {
        await recordSettlementAttempt(tx, {
          gameId,
          settlementId: settlement.id,
          context,
          outcome: "already_completed",
          priorState: "completed",
          resultingState: "completed",
          resultHash: settlement.payloadHash,
          createdAt: attemptedAt,
        });
        await tx.update(schema.gameCompletionSettlements)
          .set({
            attemptCount: settlement.attemptCount + 1,
            lastAttemptedAt: attemptedAt,
            updatedAt: attemptedAt,
          })
          .where(eq(schema.gameCompletionSettlements.id, settlement.id));
        return {
          outcome: "already_completed",
          state: "completed",
          resultHash: settlement.payloadHash,
          completedAt: settlement.completedAt!,
          settlement: buildGameCompletionSettlementSummary({
            ...settlement,
            attemptCount: settlement.attemptCount + 1,
            lastAttemptedAt: attemptedAt,
          }),
        };
      }

      const eventBoundary = (await tx.select({
        eventHash: schema.gameEvents.eventHash,
        ownerEpoch: schema.gameEvents.ownerEpoch,
      })
        .from(schema.gameEvents)
        .where(and(
          eq(schema.gameEvents.gameId, gameId),
          eq(schema.gameEvents.sequence, settlement.finalEventSequence),
        ))
        .limit(1))[0];
      if (!eventBoundary
        || eventBoundary.ownerEpoch !== settlement.ownerEpoch
        || eventBoundary.eventHash !== settlement.finalEventHash) {
        throw new DeterministicSettlementError(
          "completion_boundary_conflict",
          `Completion boundary for game ${gameId} no longer matches durable events`,
        );
      }

      const game = (await tx.select({
        status: schema.games.status,
        trackType: schema.games.trackType,
        seasonId: schema.games.seasonId,
      }).from(schema.games)
        .where(eq(schema.games.id, gameId))
        .for("update")
        .limit(1))[0];
      if (!game) {
        throw new DeterministicSettlementError(
          "completion_game_state_conflict",
          `Completion game ${gameId} no longer exists`,
        );
      }

      const owner = (await tx.select({
        status: schema.gameRunOwners.status,
        failureReason: schema.gameRunOwners.failureReason,
        lastPersistedEventSequence: schema.gameRunOwners.lastPersistedEventSequence,
      })
        .from(schema.gameRunOwners)
        .where(and(
          eq(schema.gameRunOwners.gameId, gameId),
          eq(schema.gameRunOwners.ownerEpoch, settlement.ownerEpoch),
        ))
        .for("update")
        .limit(1))[0];
      if (!owner || owner.lastPersistedEventSequence !== settlement.finalEventSequence) {
        throw new DeterministicSettlementError(
          "completion_boundary_conflict",
          `Originating owner boundary for game ${gameId} no longer matches the sealed result`,
        );
      }
      const activeOwner = owner.status === "active" && game.status === "in_progress";
      const retryReadyAtMs = settlement.retryReadyAt
        ? Date.parse(settlement.retryReadyAt)
        : Number.NaN;
      const pendingExpiredOwner = owner.status === "expired"
        && owner.failureReason === COMPLETION_SETTLEMENT_TRANSIENT_FAILURE
        && game.status === "suspended"
        && Number.isFinite(retryReadyAtMs)
        && retryReadyAtMs <= Date.parse(attemptedAt);
      if (context.source === "admin" && !pendingExpiredOwner) {
        throw new GameCompletionSettlementError(
          "completion_settlement_retry_not_ready",
          "completion_game_state_conflict",
          `Completion settlement for game ${gameId} is not ready for operator retry`,
        );
      }
      if (context.source === "runner" && !activeOwner) {
        throw new DeterministicSettlementError(
          "completion_game_state_conflict",
          `Game ${gameId} is not in an eligible completion-settlement state`,
        );
      }

      const existingResult = (await tx.select({ id: schema.gameResults.id })
        .from(schema.gameResults)
        .where(eq(schema.gameResults.gameId, gameId))
        .limit(1))[0];
      if (existingResult) {
        throw new DeterministicSettlementError(
          "completion_game_state_conflict",
          `Game ${gameId} already has terminal result side effects without a completed settlement`,
        );
      }

      if (envelope.result.transcript.length > 0) {
        const gameCapture = (await tx
          .select({ transcriptCaptureVersion: schema.games.transcriptCaptureVersion })
          .from(schema.games)
          .where(eq(schema.games.id, gameId))
          .limit(1))[0];
        const transcriptCaptureVersion = gameCapture?.transcriptCaptureVersion ?? 0;
        const chunkSize = 100;
        for (let index = 0; index < envelope.result.transcript.length; index += chunkSize) {
          await tx.insert(schema.transcripts).values(
            envelope.result.transcript
              .slice(index, index + chunkSize)
              .map((entry) => serializeTranscriptEntry(gameId, entry, { transcriptCaptureVersion })),
          );
        }
      }

      await tx.insert(schema.gameResults).values({
        id: randomUUID(),
        gameId,
        winnerId: envelope.result.winnerId,
        roundsPlayed: envelope.result.rounds,
        tokenUsage: JSON.stringify({
          promptTokens: envelope.tokenUsage.total.promptTokens,
          cachedTokens: envelope.tokenUsage.total.cachedTokens,
          completionTokens: envelope.tokenUsage.total.completionTokens,
          reasoningTokens: envelope.tokenUsage.total.reasoningTokens,
          totalTokens: envelope.tokenUsage.total.totalTokens,
          emptyResponses: envelope.tokenUsage.total.emptyResponses,
          estimatedCost: envelope.model.calculatedCost?.totalCost ?? null,
          perAction: envelope.tokenUsage.perAction,
        }),
        finishedAt: envelope.finishedAt,
      });

      let competition;
      try {
        competition = await completeCompetitionGameInTransaction(tx, {
          gameId,
          winnerId: envelope.result.winnerId,
          roundsPlayed: envelope.result.rounds,
          earnedAt: envelope.finishedAt,
        });
      } catch (error) {
        if (error instanceof CompetitionSettlementRepairRequiredError) {
          throw new DeterministicSettlementError(
            error.reason.endsWith("_missing")
              ? "competition_settlement_evidence_missing"
              : "competition_settlement_evidence_mismatch",
            error.message,
          );
        }
        throw error;
      }

      if (!competition.rated) {
        const playersWithProfiles = (await tx.select()
          .from(schema.gamePlayers)
          .where(eq(schema.gamePlayers.gameId, gameId)))
          .filter((player) => player.agentProfileId !== null);
        for (const player of playersWithProfiles) {
          const isWinner = player.id === envelope.result.winnerId;
          await tx.execute(sql`
            UPDATE agent_profiles
            SET games_played = games_played + 1,
                games_won = games_won + ${isWinner ? 1 : 0},
                updated_at = ${envelope.finishedAt}
            WHERE id = ${player.agentProfileId}
          `);
        }
      }

      if (game.trackType === "free") {
        await settleFreeTrackAccounts(tx, {
          gameId,
          seasonId: game.seasonId,
          winnerId: envelope.result.winnerId,
          rankedPlayerIds: envelope.result.rankedPlayerIds,
          finishedAt: envelope.finishedAt,
        });
      }

      const completed = await tx.update(schema.games)
        .set({
          status: "completed",
          endedAt: envelope.finishedAt,
          config: JSON.stringify(envelope.completionConfig),
        })
        .where(and(
          eq(schema.games.id, gameId),
          eq(schema.games.status, game.status),
        ))
        .returning({ id: schema.games.id });
      if (completed.length === 0) {
        throw new DeterministicSettlementError(
          "completion_game_state_conflict",
          `Game ${gameId} could not be completed from its current status`,
        );
      }

      try {
        await tx.transaction(async (mediaTx) => {
          await ensureWaitingPostgameMediaRow(mediaTx, gameId);
        });
      } catch {
        console.warn("[postgame-media] Could not create completion media placeholder");
      }

      const closedOwner = await tx.update(schema.gameRunOwners)
        .set({ status: "closed", closedAt: envelope.finishedAt })
        .where(and(
          eq(schema.gameRunOwners.gameId, gameId),
          eq(schema.gameRunOwners.ownerEpoch, settlement.ownerEpoch),
          eq(schema.gameRunOwners.status, owner.status),
        ))
        .returning({ ownerEpoch: schema.gameRunOwners.ownerEpoch });
      if (closedOwner.length === 0) {
        throw new DeterministicSettlementError(
          "completion_game_state_conflict",
          `Originating owner ${settlement.ownerEpoch} could not be closed`,
        );
      }

      await tx.update(schema.gameCompletionSettlements)
        .set({
          state: "completed",
          attemptCount: settlement.attemptCount + 1,
          lastSafeFailureCode: null,
          retryReadyAt: null,
          lastAttemptedAt: attemptedAt,
          completedAt: attemptedAt,
          updatedAt: attemptedAt,
        })
        .where(eq(schema.gameCompletionSettlements.id, settlement.id));
      await recordSettlementAttempt(tx, {
        gameId,
        settlementId: settlement.id,
        context,
        outcome: "succeeded",
        priorState: "pending",
        resultingState: "completed",
        resultHash: settlement.payloadHash,
        createdAt: attemptedAt,
      });

      return {
        outcome: "completed",
        state: "completed",
        resultHash: settlement.payloadHash,
        completedAt: attemptedAt,
        settlement: buildGameCompletionSettlementSummary({
          ...settlement,
          state: "completed",
          attemptCount: settlement.attemptCount + 1,
          lastSafeFailureCode: null,
          retryReadyAt: null,
          lastAttemptedAt: attemptedAt,
          completedAt: attemptedAt,
        }),
      };
    });
  } catch (error) {
    if (error instanceof GameCompletionSettlementError) {
      throw error;
    }
    if (error instanceof DeterministicSettlementError) {
      const resulting = await markSettlementRepairRequired(db, gameId, context, error.safeFailureCode);
      if (resulting?.state === "completed") {
        return {
          outcome: "already_completed",
          state: "completed",
          resultHash: resulting.payloadHash,
          completedAt: resulting.completedAt!,
          settlement: buildGameCompletionSettlementSummary(resulting),
        };
      }
      throw new GameCompletionSettlementError(
        COMPLETION_SETTLEMENT_REPAIR_REQUIRED,
        error.safeFailureCode,
        `Completion settlement for game ${gameId} requires repair`,
      );
    }
    await recordTransientSettlementFailure(db, gameId, context);
    throw error;
  }
}

type SettlementTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

function validateStoredSettlement(
  settlement: typeof schema.gameCompletionSettlements.$inferSelect,
  gameId: string,
): GameCompletionEnvelope {
  if (
    settlement.payloadSchemaVersion !== GAME_COMPLETION_ENVELOPE_VERSION
    && settlement.payloadSchemaVersion !== GAME_COMPLETION_ENVELOPE_VERSION_V2
  ) {
    throw new DeterministicSettlementError(
      "completion_envelope_invalid",
      `Unsupported completion envelope version for game ${gameId}`,
    );
  }
  let envelope: GameCompletionEnvelope;
  try {
    envelope = assertGameCompletionEnvelope(settlement.payload);
  } catch {
    throw new DeterministicSettlementError(
      "completion_envelope_invalid",
      `Invalid completion envelope for game ${gameId}`,
    );
  }
  if (hashGameCompletionEnvelope(envelope) !== settlement.payloadHash) {
    throw new DeterministicSettlementError(
      "completion_envelope_hash_mismatch",
      `Completion envelope hash mismatch for game ${gameId}`,
    );
  }
  if (envelope.result.gameId !== gameId
    || envelope.boundary.ownerEpoch !== settlement.ownerEpoch
    || envelope.boundary.finalEventSequence !== settlement.finalEventSequence
    || envelope.boundary.finalEventHash !== settlement.finalEventHash) {
    throw new DeterministicSettlementError(
      "completion_boundary_conflict",
      `Completion envelope boundary mismatch for game ${gameId}`,
    );
  }
  return envelope;
}

async function settleFreeTrackAccounts(
  tx: SettlementTransaction,
  input: {
    gameId: string;
    seasonId: string | null;
    winnerId: string | null;
    rankedPlayerIds: readonly string[];
    finishedAt: string;
  },
): Promise<void> {
  const allPlayers = await tx.select().from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.gameId, input.gameId));
  const totalHumans = allPlayers.filter((player) => player.userId !== null).length;
  if (totalHumans < 2) return;

  const playerById = new Map(allPlayers.map((player) => [player.id, player]));
  const seenUsers = new Set<string>();
  const humanPlayers: PlayerResult[] = [];
  for (const playerId of input.rankedPlayerIds) {
    const player = playerById.get(playerId);
    if (!player?.userId || seenUsers.has(player.userId)) continue;
    seenUsers.add(player.userId);
    humanPlayers.push({
      userId: player.userId,
      placement: humanPlayers.length + 1,
      totalPlayers: 0,
    });
  }
  for (const player of humanPlayers) player.totalPlayers = humanPlayers.length;

  const userIds = [...new Set(humanPlayers.map((player) => player.userId))].sort();
  const lockedUsers = userIds.length === 0
    ? []
    : await tx.select({
      id: schema.users.id,
      rating: schema.users.rating,
      peakRating: schema.users.peakRating,
    }).from(schema.users)
      .where(inArray(schema.users.id, userIds))
      .orderBy(asc(schema.users.id))
      .for("update");
  const lockedUserById = new Map(lockedUsers.map((user) => [user.id, user]));
  const currentRatings = new Map<string, number>();
  const currentPeaks = new Map<string, number>();
  for (const userId of userIds) {
    const user = lockedUserById.get(userId);
    currentRatings.set(userId, user?.rating ?? 1200);
    currentPeaks.set(userId, user?.peakRating ?? 1200);
  }

  const eloChanges = calculateEloChanges(humanPlayers, currentRatings);
  const winnerUserId = allPlayers.find((player) => player.id === input.winnerId)?.userId ?? null;
  for (const change of eloChanges) {
    const newPeak = Math.max(currentPeaks.get(change.userId) ?? 1200, change.newRating);
    await tx.execute(sql`
      UPDATE users
      SET rating = ${change.newRating},
          games_played = games_played + 1,
          games_won = games_won + ${change.userId === winnerUserId ? 1 : 0},
          peak_rating = ${newPeak},
          last_game_at = ${input.finishedAt}
      WHERE id = ${change.userId}
    `);
    if (input.seasonId) {
      await tx.update(schema.competitionReceipts)
        .set({ accountRatingDelta: change.delta })
        .where(and(
          eq(schema.competitionReceipts.gameId, input.gameId),
          eq(schema.competitionReceipts.ownerId, change.userId),
        ));
    }
  }
}

async function recordSettlementAttempt(
  tx: SettlementTransaction,
  input: {
    gameId: string;
    settlementId: string;
    context: SettleCapturedGameCompletionContext;
    outcome: "succeeded" | "already_completed" | "repair_required" | "failed";
    priorState: GameCompletionSettlementState;
    resultingState: GameCompletionSettlementState;
    resultHash: string;
    createdAt: string;
    safeFailureCode?: GameCompletionSettlementSafeFailureCode;
  },
): Promise<void> {
  if (input.context.source === "admin" && input.context.auditAttemptId) {
    const requested = (await tx.select({
      id: schema.gameCompletionSettlementAttempts.id,
      actorUserId: schema.gameCompletionSettlementAttempts.actorUserId,
      requestedReason: schema.gameCompletionSettlementAttempts.requestedReason,
    }).from(schema.gameCompletionSettlementAttempts).where(and(
      eq(schema.gameCompletionSettlementAttempts.id, input.context.auditAttemptId),
      eq(schema.gameCompletionSettlementAttempts.gameId, input.gameId),
      eq(schema.gameCompletionSettlementAttempts.outcome, "requested"),
    )).limit(1))[0];
    if (!requested
      || requested.actorUserId !== input.context.actorUserId
      || requested.requestedReason !== input.context.requestedReason) {
      throw new Error("Operator settlement audit request is missing or does not match its actor context");
    }
    await tx.insert(schema.gameCompletionSettlementAttempts).values({
      id: randomUUID(),
      requestAttemptId: requested.id,
      gameId: input.gameId,
      settlementId: input.settlementId,
      source: "admin",
      actorUserId: requested.actorUserId,
      requestedReason: requested.requestedReason,
      outcome: input.outcome,
      priorState: input.priorState,
      resultingState: input.resultingState,
      resultHash: input.resultHash,
      safeFailureCode: input.safeFailureCode,
      createdAt: input.createdAt,
    });
    return;
  }
  await tx.insert(schema.gameCompletionSettlementAttempts).values({
    id: randomUUID(),
    gameId: input.gameId,
    settlementId: input.settlementId,
    source: input.context.source,
    actorUserId: input.context.actorUserId,
    requestedReason: input.context.requestedReason,
    outcome: input.outcome,
    priorState: input.priorState,
    resultingState: input.resultingState,
    resultHash: input.resultHash,
    safeFailureCode: input.safeFailureCode,
    createdAt: input.createdAt,
  });
}

async function markSettlementRepairRequired(
  db: DrizzleDB,
  gameId: string,
  context: SettleCapturedGameCompletionContext,
  failureCode: GameCompletionSettlementSafeFailureCode,
): Promise<typeof schema.gameCompletionSettlements.$inferSelect | undefined> {
  return db.transaction(async (tx) => {
    const settlement = (await tx.select().from(schema.gameCompletionSettlements)
      .where(eq(schema.gameCompletionSettlements.gameId, gameId))
      .for("update")
      .limit(1))[0];
    if (!settlement || settlement.state === "completed") return settlement;

    const attemptedAt = new Date().toISOString();
    await tx.update(schema.gameCompletionSettlements).set({
      state: "repair_required",
      attemptCount: settlement.attemptCount + 1,
      lastSafeFailureCode: failureCode,
      retryReadyAt: null,
      lastAttemptedAt: attemptedAt,
      completedAt: null,
      updatedAt: attemptedAt,
    }).where(eq(schema.gameCompletionSettlements.id, settlement.id));
    await recordSettlementAttempt(tx, {
      gameId,
      settlementId: settlement.id,
      context,
      outcome: "repair_required",
      priorState: settlement.state,
      resultingState: "repair_required",
      resultHash: settlement.payloadHash,
      safeFailureCode: failureCode,
      createdAt: attemptedAt,
    });
    return { ...settlement, state: "repair_required" };
  });
}

async function recordTransientSettlementFailure(
  db: DrizzleDB,
  gameId: string,
  context: SettleCapturedGameCompletionContext,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const settlement = (await tx.select().from(schema.gameCompletionSettlements)
        .where(eq(schema.gameCompletionSettlements.gameId, gameId))
        .for("update")
        .limit(1))[0];
      if (!settlement || settlement.state !== "pending") return;
      const attemptedAt = new Date().toISOString();
      await tx.update(schema.gameCompletionSettlements).set({
        attemptCount: settlement.attemptCount + 1,
        lastSafeFailureCode: COMPLETION_SETTLEMENT_TRANSIENT_FAILURE,
        lastAttemptedAt: attemptedAt,
        updatedAt: attemptedAt,
      }).where(eq(schema.gameCompletionSettlements.id, settlement.id));
      await recordSettlementAttempt(tx, {
        gameId,
        settlementId: settlement.id,
        context,
        outcome: "failed",
        priorState: "pending",
        resultingState: "pending",
        resultHash: settlement.payloadHash,
        safeFailureCode: COMPLETION_SETTLEMENT_TRANSIENT_FAILURE,
        createdAt: attemptedAt,
      });
    });
  } catch {
    // The primary failure can itself be a database outage; preserve it.
  }
}

function safeFailureCode(
  value: string | null,
  fallback: GameCompletionSettlementSafeFailureCode,
): GameCompletionSettlementSafeFailureCode {
  return value !== null && isSafeFailureCode(value) ? value : fallback;
}

function isSafeFailureCode(value: string): value is GameCompletionSettlementSafeFailureCode {
  return GAME_COMPLETION_SETTLEMENT_SAFE_FAILURE_CODE_SET.has(value);
}

function assertTerminalResult(value: unknown): GameCompletionTerminalResultV1 {
  return assertTerminalResultAtMode(value, "v1");
}

function assertTerminalResultV2(value: unknown): GameCompletionTerminalResultV2 {
  return assertTerminalResultAtMode(value, "v2");
}

function assertTerminalResultAtMode(
  value: unknown,
  mode: "v1" | "v2",
): GameCompletionTerminalResultV1 {
  const record = assertRecord(value, "Invalid completion terminal result");
  assertExactKeys(record, [
    "gameId",
    "winnerId",
    "winnerName",
    "rounds",
    "transcript",
    "eliminationOrder",
    "rankedPlayerIds",
  ], "completion terminal result");

  const gameId = assertText(record.gameId, "Invalid terminal result game ID");
  const winnerId = assertNullableText(record.winnerId, "Invalid completion winner ID");
  const winnerName = assertNullableText(record.winnerName, "Invalid completion winner name");
  if ((winnerId === null) !== (winnerName === null)) {
    throw new Error("Completion winner ID and name must both be present or absent");
  }
  const rounds = assertInteger(record.rounds, "Invalid completion round count", 0);
  if (!Array.isArray(record.transcript)) throw new Error("Invalid completion transcript");
  const transcript = record.transcript.map((entry) =>
    mode === "v2" ? assertTranscriptEntryV2(entry) : assertTranscriptEntry(entry),
  );
  const eliminationOrder = assertTextArray(record.eliminationOrder, "Invalid completion elimination order");
  const rankedPlayerIds = assertTextArray(record.rankedPlayerIds, "Invalid completion ranking");
  if (new Set(rankedPlayerIds).size !== rankedPlayerIds.length) {
    throw new Error("Completion ranking contains duplicate player IDs");
  }
  if (winnerId && rankedPlayerIds[0] !== winnerId) {
    throw new Error("Completion winner must be first in the ranking");
  }

  return {
    gameId,
    winnerId,
    winnerName,
    rounds,
    transcript,
    eliminationOrder,
    rankedPlayerIds,
  };
}

const TRANSCRIPT_MODERN_OPTIONAL_KEYS = [
  "speakerPlayerId",
  "entrySequence",
  "dialogueKind",
  "audiencePlayerIds",
  "dialogueContext",
] as const;

function assertTranscriptEntry(value: unknown): TranscriptEntry {
  return assertTranscriptEntryAtMode(value, "v1");
}

function assertTranscriptEntryV2(value: unknown): TranscriptEntry {
  return assertTranscriptEntryAtMode(value, "v2");
}

function assertTranscriptEntryAtMode(value: unknown, mode: "v1" | "v2"): TranscriptEntry {
  const record = assertRecord(value, "Invalid completion transcript entry");
  assertExactKeys(record, [
    "round",
    "phase",
    "timestamp",
    "from",
    "scope",
    "to",
    "text",
    "thinking",
    "reasoningContext",
    "anonymous",
    "displayOrder",
    "roomId",
    "roomMetadata",
    ...TRANSCRIPT_MODERN_OPTIONAL_KEYS,
  ], "completion transcript entry", [
    "to",
    "thinking",
    "reasoningContext",
    "anonymous",
    "displayOrder",
    "roomId",
    "roomMetadata",
    ...TRANSCRIPT_MODERN_OPTIONAL_KEYS,
  ]);

  const phase = assertText(record.phase, "Invalid transcript phase");
  if (!PHASES.has(phase)) throw new Error("Invalid transcript phase");
  const scope = assertText(record.scope, "Invalid transcript scope") as TranscriptEntry["scope"];
  if (!TRANSCRIPT_SCOPES.has(scope)) throw new Error("Invalid transcript scope");

  const isDialogueScope =
    scope === "public"
    || scope === "mingle"
    || scope === "huddle"
    || scope === "whisper"
    || scope === "system";

  const base: TranscriptEntry = {
    round: assertInteger(record.round, "Invalid transcript round", 0),
    phase: phase as Phase,
    timestamp: assertFiniteNumber(record.timestamp, "Invalid transcript timestamp"),
    from: assertText(record.from, "Invalid transcript author"),
    scope,
    ...(record.to !== undefined && { to: assertTextArray(record.to, "Invalid transcript recipients") }),
    text: assertString(record.text, "Invalid transcript text"),
    ...(record.thinking !== undefined && { thinking: assertString(record.thinking, "Invalid transcript thinking") }),
    ...(record.reasoningContext !== undefined && {
      reasoningContext: assertString(record.reasoningContext, "Invalid transcript reasoning context"),
    }),
    ...(record.anonymous !== undefined && { anonymous: assertBoolean(record.anonymous, "Invalid transcript anonymity") }),
    ...(record.displayOrder !== undefined && {
      displayOrder: assertInteger(record.displayOrder, "Invalid transcript display order", 0),
    }),
    ...(record.roomId !== undefined && { roomId: assertInteger(record.roomId, "Invalid transcript room ID", 1) }),
    ...(record.roomMetadata !== undefined && {
      roomMetadata: assertJsonRecord(record.roomMetadata, "Invalid transcript room metadata") as TranscriptEntry["roomMetadata"],
    }),
  };

  const modern = assertModernTranscriptFields(record, scope, isDialogueScope, mode);
  return { ...base, ...modern };
}

function assertModernTranscriptFields(
  record: Record<string, unknown>,
  scope: TranscriptEntry["scope"],
  isDialogueScope: boolean,
  mode: "v1" | "v2",
): Partial<TranscriptEntry> {
  const out: Partial<TranscriptEntry> = {};

  if (record.speakerPlayerId !== undefined) {
    out.speakerPlayerId = record.speakerPlayerId === null
      ? null
      : assertText(record.speakerPlayerId, "Invalid transcript speakerPlayerId");
  }
  if (record.entrySequence !== undefined) {
    out.entrySequence = assertInteger(record.entrySequence, "Invalid transcript entrySequence", 1);
  }
  if (record.dialogueKind !== undefined) {
    out.dialogueKind = assertText(record.dialogueKind, "Invalid transcript dialogueKind") as TranscriptEntry["dialogueKind"];
  }
  if (record.audiencePlayerIds !== undefined) {
    out.audiencePlayerIds = assertTextArray(record.audiencePlayerIds, "Invalid transcript audiencePlayerIds");
  }
  if (record.dialogueContext !== undefined) {
    const context = assertRecord(record.dialogueContext, "Invalid transcript dialogueContext");
    if (context.version !== 1) throw new Error("Invalid transcript dialogueContext version");
    out.dialogueContext = {
      version: 1,
      ...(context.roomId !== undefined && {
        roomId: assertInteger(context.roomId, "Invalid dialogueContext roomId", 1),
      }),
      ...(context.allianceId !== undefined && {
        allianceId: assertText(context.allianceId, "Invalid dialogueContext allianceId"),
      }),
      ...(context.scheduleId !== undefined && {
        scheduleId: assertText(context.scheduleId, "Invalid dialogueContext scheduleId"),
      }),
      ...(context.sessionId !== undefined && {
        sessionId: assertText(context.sessionId, "Invalid dialogueContext sessionId"),
      }),
      ...(context.window !== undefined && {
        window: assertText(context.window, "Invalid dialogueContext window"),
      }),
      ...(context.sessionAudiencePlayerIds !== undefined && {
        sessionAudiencePlayerIds: assertTextArray(
          context.sessionAudiencePlayerIds,
          "Invalid dialogueContext sessionAudiencePlayerIds",
        ),
      }),
    };
  }

  if (mode === "v2") {
    if (isDialogueScope) {
      if (out.entrySequence == null) {
        throw new Error(`V2 dialogue transcript entry missing entrySequence (scope=${scope})`);
      }
      if (!Array.isArray(out.audiencePlayerIds)) {
        throw new Error(`V2 dialogue transcript entry missing audiencePlayerIds (scope=${scope})`);
      }
      if (!out.dialogueContext) {
        throw new Error(`V2 dialogue transcript entry missing dialogueContext (scope=${scope})`);
      }
      if (scope === "system" && !out.dialogueKind) {
        throw new Error("V2 system transcript entry missing dialogueKind");
      }
    } else {
      if (out.entrySequence != null || out.audiencePlayerIds != null || out.dialogueContext != null || out.dialogueKind != null) {
        throw new Error(`V2 non-dialogue scope ${scope} must not carry dialogue identity fields`);
      }
    }
  }

  return out;
}

function assertTokenUsageSnapshot(value: unknown): GameCompletionTokenUsageV1 {
  const record = assertRecord(value, "Invalid completion token usage");
  assertExactKeys(record, ["total", "perAction"], "completion token usage");
  const total = assertTokenUsage(record.total);
  const perActionRecord = assertRecord(record.perAction, "Invalid completion per-action usage");
  const perAction = Object.fromEntries(
    Object.entries(perActionRecord).map(([key, usage]) => [
      assertText(key, "Invalid completion usage action"),
      assertTokenUsage(usage),
    ]),
  );

  const summed = Object.values(perAction).reduce<TokenUsage>((accumulator, usage) => ({
    promptTokens: accumulator.promptTokens + usage.promptTokens,
    cachedTokens: accumulator.cachedTokens + usage.cachedTokens,
    completionTokens: accumulator.completionTokens + usage.completionTokens,
    reasoningTokens: accumulator.reasoningTokens + usage.reasoningTokens,
    totalTokens: accumulator.totalTokens + usage.totalTokens,
    callCount: accumulator.callCount + usage.callCount,
    emptyResponses: accumulator.emptyResponses + usage.emptyResponses,
  }), emptyTokenUsage());
  if (Object.keys(total).some((key) => total[key as keyof TokenUsage] !== summed[key as keyof TokenUsage])) {
    throw new Error("Completion per-action token usage does not sum to total usage");
  }

  return { total, perAction };
}

function assertTokenUsage(value: unknown): TokenUsage {
  const record = assertRecord(value, "Invalid completion token usage entry");
  assertExactKeys(record, [
    "promptTokens",
    "cachedTokens",
    "completionTokens",
    "reasoningTokens",
    "totalTokens",
    "callCount",
    "emptyResponses",
  ], "completion token usage entry");
  const usage: TokenUsage = {
    promptTokens: assertInteger(record.promptTokens, "Invalid prompt token count", 0),
    cachedTokens: assertInteger(record.cachedTokens, "Invalid cached token count", 0),
    completionTokens: assertInteger(record.completionTokens, "Invalid completion token count", 0),
    reasoningTokens: assertInteger(record.reasoningTokens, "Invalid reasoning token count", 0),
    totalTokens: assertInteger(record.totalTokens, "Invalid total token count", 0),
    callCount: assertInteger(record.callCount, "Invalid call count", 0),
    emptyResponses: assertInteger(record.emptyResponses, "Invalid empty-response count", 0),
  };
  if (usage.cachedTokens > usage.promptTokens) {
    throw new Error("Cached token count exceeds prompt token count");
  }
  if (usage.totalTokens !== usage.promptTokens + usage.completionTokens) {
    throw new Error("Total token count does not match prompt plus completion tokens");
  }
  return usage;
}

function emptyTokenUsage(): TokenUsage {
  return {
    promptTokens: 0,
    cachedTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    callCount: 0,
    emptyResponses: 0,
  };
}

function assertCostEstimate(value: unknown): CostEstimate | null {
  if (value === null) return null;
  const record = assertRecord(value, "Invalid completion cost estimate");
  assertExactKeys(record, ["model", "inputCost", "outputCost", "totalCost"], "completion cost estimate");
  const inputCost = assertNonnegativeNumber(record.inputCost, "Invalid completion input cost");
  const outputCost = assertNonnegativeNumber(record.outputCost, "Invalid completion output cost");
  const totalCost = assertNonnegativeNumber(record.totalCost, "Invalid completion total cost");
  if (Math.abs(totalCost - (inputCost + outputCost)) > Number.EPSILON * Math.max(1, totalCost)) {
    throw new Error("Completion total cost does not match input plus output cost");
  }
  return {
    model: assertText(record.model, "Invalid completion cost model"),
    inputCost,
    outputCost,
    totalCost,
  };
}

function assertRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
  optionalKeys: readonly string[] = [],
): void {
  const allowed = new Set(allowedKeys);
  const optional = new Set(optionalKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`Unexpected ${label} field: ${key}`);
  }
  for (const key of allowedKeys) {
    if (!(key in record) && !optional.has(key)) {
      throw new Error(`Missing ${label} field: ${key}`);
    }
  }
}

function assertString(value: unknown, message: string): string {
  if (typeof value !== "string") throw new Error(message);
  return value;
}

function assertText(value: unknown, message: string): string {
  if (typeof value !== "string" || value.length === 0 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(message);
  }
  return value;
}

function assertNullableText(value: unknown, message: string): string | null {
  return value === null ? null : assertText(value, message);
}

function assertInteger(value: unknown, message: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new Error(message);
  return value;
}

function assertFiniteNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(message);
  return value;
}

function assertNonnegativeNumber(value: unknown, message: string): number {
  const number = assertFiniteNumber(value, message);
  if (number < 0) throw new Error(message);
  return number;
}

function assertBoolean(value: unknown, message: string): boolean {
  if (typeof value !== "boolean") throw new Error(message);
  return value;
}

function assertTextArray(value: unknown, message: string): string[] {
  if (!Array.isArray(value)) throw new Error(message);
  return value.map((entry) => assertText(entry, message));
}

function assertSha256(value: unknown, message: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) throw new Error(message);
  return value;
}

function assertIsoTimestamp(value: unknown, message: string): string {
  if (typeof value !== "string") throw new Error(message);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new Error(message);
  return value;
}

function assertJsonRecord(value: unknown, message: string): Record<string, unknown> {
  const record = assertRecord(value, message);
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, assertJsonValue(entry, message)]),
  );
}

function assertJsonValue(value: unknown, message: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(message);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => assertJsonValue(entry, message));
  if (value && typeof value === "object") return assertJsonRecord(value, message);
  throw new Error(message);
}
