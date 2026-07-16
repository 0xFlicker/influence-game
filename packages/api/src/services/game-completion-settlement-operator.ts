import { randomUUID } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type {
  GameCompletionSettlementAttemptOutcome,
  GameCompletionSettlementState,
} from "../db/schema.js";
import {
  COMPLETION_SETTLEMENT_TRANSIENT_FAILURE,
  GameCompletionSettlementError,
  getGameCompletionSettlementSummary,
  settleCapturedGameCompletion,
  type SettleCapturedGameCompletionResult,
} from "./game-completion-settlement.js";

export const RETRY_GAME_SETTLEMENT_CONFIRMATION = "RETRY_SETTLEMENT" as const;
export const MAX_GAME_SETTLEMENT_RETRY_REASON_LENGTH = 240;

const DENIED_AUDIT_BUCKET_MS = 60_000;

export type GameCompletionSettlementOperatorErrorCode =
  | "invalid_state"
  | "repair_blocked";

export class GameCompletionSettlementOperatorError extends Error {
  constructor(
    public readonly code: GameCompletionSettlementOperatorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GameCompletionSettlementOperatorError";
  }
}

interface SettlementAuditSnapshot {
  settlementId: string | null;
  state: GameCompletionSettlementState | null;
  resultHash: string | null;
  safeFailureCode: string | null;
}

export function parseGameSettlementRetryReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  if (reason.length === 0 || reason.length > MAX_GAME_SETTLEMENT_RETRY_REASON_LENGTH) {
    return null;
  }
  // The audit ledger is operator metadata, not a place for terminal/control bytes.
  if (/\p{Cc}/u.test(reason)) return null;
  return reason;
}

export async function recordDeniedGameSettlementRetry(
  db: DrizzleDB,
  input: {
    gameId: string;
    actorUserId: string;
    requestedReason?: string;
    now?: Date;
  },
): Promise<{ recorded: boolean }> {
  const now = input.now ?? new Date();
  const bucketStart = new Date(
    Math.floor(now.getTime() / DENIED_AUDIT_BUCKET_MS) * DENIED_AUDIT_BUCKET_MS,
  ).toISOString();

  return db.transaction(async (tx) => {
    // Serialize the check-and-insert per game so concurrent denied requests
    // cannot all observe an empty bucket and spam duplicate audit rows.
    await tx.select({ id: schema.games.id })
      .from(schema.games)
      .where(eq(schema.games.id, input.gameId))
      .for("update")
      .limit(1);
    const existing = (await tx.select({ id: schema.gameCompletionSettlementAttempts.id })
      .from(schema.gameCompletionSettlementAttempts)
      .where(and(
        eq(schema.gameCompletionSettlementAttempts.gameId, input.gameId),
        eq(schema.gameCompletionSettlementAttempts.actorUserId, input.actorUserId),
        eq(schema.gameCompletionSettlementAttempts.source, "admin"),
        eq(schema.gameCompletionSettlementAttempts.outcome, "denied"),
        gte(schema.gameCompletionSettlementAttempts.createdAt, bucketStart),
      ))
      .orderBy(desc(schema.gameCompletionSettlementAttempts.createdAt))
      .limit(1))[0];
    if (existing) return { recorded: false };

    const snapshot = await loadSettlementAuditSnapshot(tx, input.gameId);
    await insertOperatorAudit(tx, {
      gameId: input.gameId,
      actorUserId: input.actorUserId,
      requestedReason: input.requestedReason,
      outcome: "denied",
      snapshot,
      resultingState: snapshot.state,
      safeMetadata: {
        reasonCode: "insufficient_permissions",
        permission: "retry_game_settlement",
        deniedBucketStartedAt: bucketStart,
      },
      createdAt: now.toISOString(),
    });
    return { recorded: true };
  });
}

export async function recordInvalidGameSettlementRetry(
  db: DrizzleDB,
  input: {
    gameId: string;
    actorUserId: string;
    requestedReason?: string;
    reasonCode: "invalid_request" | "invalid_state";
  },
): Promise<void> {
  const snapshot = await loadSettlementAuditSnapshot(db, input.gameId);
  await insertOperatorAudit(db, {
    gameId: input.gameId,
    actorUserId: input.actorUserId,
    requestedReason: input.requestedReason,
    outcome: "invalid_state",
    snapshot,
    resultingState: snapshot.state,
    safeMetadata: { reasonCode: input.reasonCode },
  });
}

/**
 * Human-gated redrive of a sealed terminal result. This accepts only game and
 * actor context; all outcome data remains private in the immutable envelope.
 */
export async function retryCapturedGameCompletionAsOperator(
  db: DrizzleDB,
  input: {
    gameId: string;
    actorUserId: string;
    requestedReason: string;
  },
  dependencies: {
    settleCapturedGameCompletion?: typeof settleCapturedGameCompletion;
    finalizeRequestedOperatorAudit?: typeof finalizeRequestedOperatorAudit;
  } = {},
): Promise<SettleCapturedGameCompletionResult> {
  const snapshot = await loadSettlementAuditSnapshot(db, input.gameId);

  // This insert is intentionally its own transaction boundary. If it cannot
  // be recorded, no settlement mutation is attempted.
  const auditAttemptId = await insertOperatorAudit(db, {
    gameId: input.gameId,
    actorUserId: input.actorUserId,
    requestedReason: input.requestedReason,
    outcome: "requested",
    snapshot,
    resultingState: snapshot.state,
    safeMetadata: { reasonCode: "operator_requested" },
  });

  if (snapshot.state === "repair_required") {
    await finalizeRequestedOperatorAudit(db, {
      auditAttemptId,
      outcome: "repair_blocked",
      resultingState: "repair_required",
      safeMetadata: { reasonCode: "repair_required" },
    });
    throw new GameCompletionSettlementOperatorError(
      "repair_blocked",
      "This completion settlement requires evidence repair and cannot be retried.",
    );
  }

  try {
    const settle = dependencies.settleCapturedGameCompletion ?? settleCapturedGameCompletion;
    return await settle(db, input.gameId, {
      source: "admin",
      actorUserId: input.actorUserId,
      requestedReason: input.requestedReason,
      auditAttemptId,
    });
  } catch (error) {
    if (error instanceof GameCompletionSettlementError
      && (error.code === "completion_settlement_not_found"
        || error.code === "completion_settlement_retry_not_ready")) {
      const resulting = await loadSettlementAuditSnapshot(db, input.gameId);
      await finalizeRequestedOperatorAudit(db, {
        auditAttemptId,
        outcome: "invalid_state",
        resultingState: resulting.state,
        safeMetadata: { reasonCode: "retry_not_ready" },
      });
      throw new GameCompletionSettlementOperatorError(
        "invalid_state",
        "This completion settlement is not ready for operator retry.",
      );
    }
    if (error instanceof GameCompletionSettlementError
      && error.code === "completion_settlement_repair_required") {
      throw new GameCompletionSettlementOperatorError(
        "repair_blocked",
        "This completion settlement requires evidence repair and cannot be retried.",
      );
    }
    try {
      const resulting = await loadSettlementAuditSnapshot(db, input.gameId);
      if (resulting.state === "completed") {
        const settlement = await getGameCompletionSettlementSummary(db, input.gameId);
        if (!settlement.resultHash || !settlement.completedAt) {
          throw new Error("Completed settlement is missing its durable receipt fields");
        }
        try {
          const finalizeAudit = dependencies.finalizeRequestedOperatorAudit
            ?? finalizeRequestedOperatorAudit;
          await finalizeAudit(db, {
            auditAttemptId,
            outcome: "already_completed",
            resultingState: "completed",
            safeMetadata: { reasonCode: "settlement_commit_confirmed" },
          });
        } catch (auditError) {
          const message = auditError instanceof Error ? auditError.message : String(auditError);
          console.warn(
            `[completion-settlement] Settlement ${input.gameId} completed, but audit finalization was deferred: ${message}`,
          );
        }
        return {
          outcome: "already_completed",
          state: "completed",
          resultHash: settlement.resultHash,
          completedAt: settlement.completedAt,
          settlement,
        };
      }
      await finalizeRequestedOperatorAudit(db, {
        auditAttemptId,
        outcome: "failed",
        resultingState: resulting.state,
        safeFailureCode: COMPLETION_SETTLEMENT_TRANSIENT_FAILURE,
        safeMetadata: { reasonCode: "settlement_attempt_failed" },
      });
    } catch {
      // A database outage may prevent the terminal receipt; the durable
      // pre-attempt `requested` row remains the reconciliation marker.
    }
    throw error;
  }
}

type AuditDB = Pick<DrizzleDB, "insert" | "select">;

async function loadSettlementAuditSnapshot(
  db: Pick<DrizzleDB, "select">,
  gameId: string,
): Promise<SettlementAuditSnapshot> {
  const row = (await db.select({
    settlementId: schema.gameCompletionSettlements.id,
    state: schema.gameCompletionSettlements.state,
    resultHash: schema.gameCompletionSettlements.payloadHash,
    safeFailureCode: schema.gameCompletionSettlements.lastSafeFailureCode,
  }).from(schema.gameCompletionSettlements)
    .where(eq(schema.gameCompletionSettlements.gameId, gameId))
    .limit(1))[0];
  return row ?? {
    settlementId: null,
    state: null,
    resultHash: null,
    safeFailureCode: null,
  };
}

async function insertOperatorAudit(
  db: AuditDB,
  input: {
    gameId: string;
    actorUserId: string;
    requestedReason?: string;
    outcome: GameCompletionSettlementAttemptOutcome;
    snapshot: SettlementAuditSnapshot;
    resultingState: GameCompletionSettlementState | null;
    safeFailureCode?: string;
    safeMetadata: Record<string, unknown>;
    createdAt?: string;
  },
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.gameCompletionSettlementAttempts).values({
    id,
    gameId: input.gameId,
    settlementId: input.snapshot.settlementId,
    source: "admin",
    actorUserId: input.actorUserId,
    requestedReason: input.requestedReason,
    outcome: input.outcome,
    priorState: input.snapshot.state,
    resultingState: input.resultingState,
    resultHash: input.snapshot.resultHash,
    safeFailureCode: input.safeFailureCode ?? input.snapshot.safeFailureCode,
    safeMetadata: input.safeMetadata,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
  return id;
}

async function finalizeRequestedOperatorAudit(
  db: DrizzleDB,
  input: {
    auditAttemptId: string;
    outcome: "already_completed" | "repair_blocked" | "invalid_state" | "failed";
    resultingState: GameCompletionSettlementState | null;
    safeFailureCode?: string;
    safeMetadata: Record<string, unknown>;
  },
): Promise<boolean> {
  const requested = (await db.select({
    id: schema.gameCompletionSettlementAttempts.id,
    gameId: schema.gameCompletionSettlementAttempts.gameId,
    settlementId: schema.gameCompletionSettlementAttempts.settlementId,
    actorUserId: schema.gameCompletionSettlementAttempts.actorUserId,
    requestedReason: schema.gameCompletionSettlementAttempts.requestedReason,
    priorState: schema.gameCompletionSettlementAttempts.priorState,
    resultHash: schema.gameCompletionSettlementAttempts.resultHash,
    safeFailureCode: schema.gameCompletionSettlementAttempts.safeFailureCode,
  }).from(schema.gameCompletionSettlementAttempts).where(and(
    eq(schema.gameCompletionSettlementAttempts.id, input.auditAttemptId),
    eq(schema.gameCompletionSettlementAttempts.outcome, "requested"),
  )).limit(1))[0];
  if (!requested) return false;

  const inserted = await db.insert(schema.gameCompletionSettlementAttempts).values({
    id: randomUUID(),
    requestAttemptId: requested.id,
    gameId: requested.gameId,
    settlementId: requested.settlementId,
    source: "admin",
    actorUserId: requested.actorUserId,
    requestedReason: requested.requestedReason,
    outcome: input.outcome,
    priorState: requested.priorState,
    resultingState: input.resultingState,
    resultHash: requested.resultHash,
    safeFailureCode: input.safeFailureCode ?? requested.safeFailureCode,
    safeMetadata: input.safeMetadata,
  }).onConflictDoNothing().returning({ id: schema.gameCompletionSettlementAttempts.id });
  return inserted.length === 1;
}
