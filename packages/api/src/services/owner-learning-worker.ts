import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  FlexProcessingObserver,
  FlexTransportDispatchIntent,
  FlexTransportTerminalOutcome,
} from "@influence/engine";
import { and, asc, desc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type {
  OwnerLearningCheckpoint,
  OwnerLearningCallCostReceipt,
  OwnerLearningCallFailureCode,
  OwnerLearningOutputFailureCode,
  OwnerLearningReviewResult,
  OwnerLearningSafeFailureCode,
  OwnerLearningStage,
  OwnerLearningTokenReceipt,
} from "./owner-learning-contracts.js";
import { createOwnerLearningEvent } from "./owner-learning-events.js";
import {
  fingerprintOwnerLearningRequest,
  fingerprintOwnerLearningValue,
  OWNER_LEARNING_MAX_DIVES,
  OWNER_LEARNING_MAX_LOGICAL_CALLS,
} from "./owner-learning-contracts.js";
import { runOwnerLearningHarness } from "./owner-learning-harness.js";
import type { OwnerLearningProvider } from "./owner-learning-provider.js";
import { OwnerLearningProviderError } from "./owner-learning-provider.js";
import {
  OWNER_LEARNING_REVIEW_INSTRUCTIONS,
  type OwnerLearningEvidenceProjector,
} from "./owner-learning-review.js";
import { OWNER_LEARNING_MAX_OUTPUT_TOKENS } from "./owner-learning-provider.js";
import { projectOwnerLearningEvidence } from "./owner-learning-evidence.js";
import { validateOwnerLearningSelection } from "./owner-learning-eligibility.js";

const OWNER_LEARNING_LEASE_DURATION_MS = 30_000;
const activeOwnerLearningRuns = new Map<string, AbortController>();

export interface OwnerLearningOutputFailureDiagnostic {
  reviewId: string;
  callOrdinal: number;
  stage: OwnerLearningStage;
  code: OwnerLearningOutputFailureCode;
}

export function abortActiveOwnerLearningReview(reviewId: string): boolean {
  const controller = activeOwnerLearningRuns.get(reviewId);
  if (!controller) return false;
  controller.abort(new DOMException("Owner learning review resolved", "AbortError"));
  return true;
}

export interface OwnerLearningWorkerClaim {
  reviewId: string;
  leaseToken: string;
  leaseExpiresAt: string;
}

export interface OwnerLearningCallReservation {
  callId: string;
  ordinal: number;
  reused: boolean;
  resumeTransport: {
    flex429Count: number;
    nextTransportOrdinal: number;
    nextTier: "flex" | "auto";
    initialBackoffMs: number;
  };
}

export class OwnerLearningWorkerError extends Error {
  constructor(
    readonly code:
      | "stale_or_invalid_lease"
      | "call_state_conflict"
      | "logical_call_budget_exhausted"
      | "dive_budget_exhausted",
  ) {
    super(code);
    this.name = "OwnerLearningWorkerError";
  }
}

export async function claimOwnerLearningReview(
  db: DrizzleDB,
  options: { now?: Date; leaseDurationMs?: number } = {},
): Promise<OwnerLearningWorkerClaim | null> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const leaseDurationMs = options.leaseDurationMs ?? OWNER_LEARNING_LEASE_DURATION_MS;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('owner-learning-global-worker'))`);
    const active = await tx.select({ id: schema.agentLearningReviews.id })
      .from(schema.agentLearningReviews)
      .where(and(
        eq(schema.agentLearningReviews.analysisStatus, "running"),
        sql`${schema.agentLearningReviews.resolvedAt} IS NULL`,
        gt(schema.agentLearningReviews.leaseExpiresAt, nowIso),
      )).limit(1);
    if (active.length > 0) return null;

    const candidates = await tx.select({
      id: schema.agentLearningReviews.id,
      status: schema.agentLearningReviews.analysisStatus,
      leaseExpiresAt: schema.agentLearningReviews.leaseExpiresAt,
    }).from(schema.agentLearningReviews).where(and(
      sql`${schema.agentLearningReviews.resolvedAt} IS NULL`,
      or(
        eq(schema.agentLearningReviews.analysisStatus, "queued"),
        and(
          eq(schema.agentLearningReviews.analysisStatus, "running"),
          lte(schema.agentLearningReviews.leaseExpiresAt, nowIso),
        ),
      ),
    )).orderBy(asc(schema.agentLearningReviews.createdAt), asc(schema.agentLearningReviews.id))
      .limit(20);

    for (const candidate of candidates) {
      if (candidate.status === "running") {
        const recovery = await reconcileExpiredCall(tx, candidate.id, nowIso);
        if (recovery === "failed") continue;
      }
      const leaseToken = randomBytes(32).toString("base64url");
      const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();
      const conditions = [
        eq(schema.agentLearningReviews.id, candidate.id),
        eq(schema.agentLearningReviews.analysisStatus, candidate.status),
        sql`${schema.agentLearningReviews.resolvedAt} IS NULL`,
      ];
      if (candidate.status === "running") {
        conditions.push(lte(schema.agentLearningReviews.leaseExpiresAt, nowIso));
      }
      const updated = await tx.update(schema.agentLearningReviews).set({
        analysisStatus: "running",
        leaseTokenHash: hashLeaseToken(leaseToken),
        leaseExpiresAt,
        claimedAt: nowIso,
        updatedAt: nowIso,
      }).where(and(...conditions)).returning({ id: schema.agentLearningReviews.id });
      if (updated.length === 1) return { reviewId: candidate.id, leaseToken, leaseExpiresAt };
    }
    return null;
  });
}

export async function heartbeatOwnerLearningReview(
  db: DrizzleDB,
  input: {
    reviewId: string;
    leaseToken: string;
    now?: Date;
    leaseDurationMs?: number;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const updated = await db.update(schema.agentLearningReviews).set({
    leaseExpiresAt: new Date(
      now.getTime() + (input.leaseDurationMs ?? OWNER_LEARNING_LEASE_DURATION_MS),
    ).toISOString(),
    updatedAt: nowIso,
  }).where(activeLeaseWhere(input.reviewId, input.leaseToken, nowIso))
    .returning({ id: schema.agentLearningReviews.id });
  return updated.length === 1;
}

export async function reserveOwnerLearningCall(
  db: DrizzleDB,
  input: {
    reviewId: string;
    leaseToken: string;
    inputPolicyHash: string;
    stage: OwnerLearningStage;
    isDive?: boolean;
    now?: Date;
    idFactory?: () => string;
  },
): Promise<OwnerLearningCallReservation> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const reservation = await db.transaction(async (tx): Promise<OwnerLearningCallReservation | null> => {
    await lockReview(tx, input.reviewId);
    const review = await requireActiveLease(tx, input.reviewId, input.leaseToken, nowIso);
    const latest = (await tx.select().from(schema.agentLearningReviewCalls)
      .where(eq(schema.agentLearningReviewCalls.reviewId, input.reviewId))
      .orderBy(desc(schema.agentLearningReviewCalls.ordinal)).limit(1))[0] ?? null;
    const resumable = resumableReservation(latest, input.inputPolicyHash, input.stage, now);
    if (resumable) return resumable;
    if (latest && isResumableCall(latest)) {
      await tx.update(schema.agentLearningReviewCalls).set({
        state: "failed",
        safeFailureCode: "worker_interrupted",
        completedAt: nowIso,
      }).where(eq(schema.agentLearningReviewCalls.id, latest.id));
      await failReviewUnderLease(tx, review, "worker_interrupted", true, nowIso);
      return null;
    }
    if (review.logicalCallCount >= OWNER_LEARNING_MAX_LOGICAL_CALLS) {
      await failReviewUnderLease(tx, review, "logical_call_budget_exhausted", false, nowIso);
      throw new OwnerLearningWorkerError("logical_call_budget_exhausted");
    }
    if (input.isDive && review.diveCount >= OWNER_LEARNING_MAX_DIVES) {
      throw new OwnerLearningWorkerError("dive_budget_exhausted");
    }

    const ordinal = review.logicalCallCount + 1;
    const callId = input.idFactory?.() ?? randomUUID();
    await tx.insert(schema.agentLearningReviewCalls).values({
      id: callId,
      reviewId: input.reviewId,
      ordinal,
      stage: input.stage,
      inputPolicyHash: input.inputPolicyHash,
      state: "reserved",
      requestedTier: "flex",
      requestedReasoningEffort: "low",
      reservedAt: nowIso,
    });
    await tx.update(schema.agentLearningReviews).set({
      logicalCallCount: ordinal,
      diveCount: input.isDive ? review.diveCount + 1 : review.diveCount,
      stage: input.stage,
      capacitySubstatus: null,
      safeFailureCode: null,
      retryable: false,
      updatedAt: nowIso,
    }).where(activeLeaseWhere(input.reviewId, input.leaseToken, nowIso));
    return {
      callId,
      ordinal,
      reused: false,
      resumeTransport: {
        flex429Count: 0,
        nextTransportOrdinal: 1,
        nextTier: "flex",
        initialBackoffMs: 0,
      },
    };
  });
  if (!reservation) throw new OwnerLearningWorkerError("call_state_conflict");
  return reservation;
}

export function createOwnerLearningTransportObserver(
  db: DrizzleDB,
  input: { reviewId: string; callId: string; leaseToken: string },
): FlexProcessingObserver {
  return {
    onDispatchIntent: (event) => persistDispatchIntent(db, input, event),
    onTerminalOutcome: (event) => persistTerminalOutcome(db, input, event),
  };
}

async function persistDispatchIntent(
  db: DrizzleDB,
  input: { reviewId: string; callId: string; leaseToken: string },
  event: FlexTransportDispatchIntent,
): Promise<void> {
  const nowIso = new Date(event.dispatchedAtMs).toISOString();
  await db.transaction(async (tx) => {
    await lockReview(tx, input.reviewId);
    const review = await requireActiveLease(tx, input.reviewId, input.leaseToken, nowIso);
    const call = await requireCall(tx, input.reviewId, input.callId);
    const receipts = [...call.transportReceipts];
    if (
      receipts.length + 1 !== event.transportOrdinal
      || receipts.some((receipt) => receipt.terminalOutcomeAt == null)
      || expectedNextTier(call.flex429Count) !== event.attemptedTier
      || call.state === "succeeded" || call.state === "failed" || call.state === "ambiguous"
    ) {
      throw new OwnerLearningWorkerError("call_state_conflict");
    }
    receipts.push({
      ordinal: event.transportOrdinal,
      dispatchIntentAt: nowIso,
      attemptedTier: event.attemptedTier,
    });
    const fallback = event.attemptedTier === "auto";
    await tx.update(schema.agentLearningReviewCalls).set({
      state: "dispatched",
      transportReceipts: receipts,
      dispatchedAt: call.dispatchedAt ?? nowIso,
      ...(fallback
        ? {
            fallbackStartedAt: call.fallbackStartedAt ?? nowIso,
            capacityPath: "standard_fallback" as const,
          }
        : {}),
    }).where(eq(schema.agentLearningReviewCalls.id, call.id));
    await tx.update(schema.agentLearningReviews).set({
      capacitySubstatus: fallback ? "using_standard_capacity" : review.capacitySubstatus,
      updatedAt: nowIso,
    }).where(activeLeaseWhere(input.reviewId, input.leaseToken, nowIso));
    if (fallback && call.fallbackStartedAt == null) {
      const eventRow = createOwnerLearningEvent("capacity_fallback_started", {
        ownerUserId: review.ownerUserId,
        reviewId: review.id,
        agentProfileId: review.agentProfileId,
        occurredAt: nowIso,
      }, { callOrdinal: call.ordinal, flex429Count: 3 });
      await tx.insert(schema.agentLearningEvents).values({
        id: randomUUID(),
        ownerUserId: eventRow.ownerUserId,
        reviewId: eventRow.reviewId,
        agentProfileId: eventRow.agentProfileId,
        kind: eventRow.kind,
        payload: eventRow.payload,
        occurredAt: eventRow.occurredAt,
      });
    }
  });
}

async function persistTerminalOutcome(
  db: DrizzleDB,
  input: { reviewId: string; callId: string; leaseToken: string },
  event: FlexTransportTerminalOutcome,
): Promise<void> {
  const nowIso = new Date(event.completedAtMs).toISOString();
  await db.transaction(async (tx) => {
    await lockReview(tx, input.reviewId);
    const review = await requireActiveLease(tx, input.reviewId, input.leaseToken, nowIso);
    const call = await requireCall(tx, input.reviewId, input.callId);
    const receipts = [...call.transportReceipts];
    const receipt = receipts.at(-1);
    if (
      !receipt
      || receipt.ordinal !== event.transportOrdinal
      || receipt.attemptedTier !== event.attemptedTier
      || receipt.terminalOutcomeAt != null
    ) {
      throw new OwnerLearningWorkerError("call_state_conflict");
    }
    receipts[receipts.length - 1] = {
      ...receipt,
      terminalHttpStatus: event.httpStatus,
      terminalOutcomeAt: nowIso,
      latencyMs: event.latencyMs,
      ...(event.providerRequestId ? { providerRequestId: event.providerRequestId } : {}),
      ...(event.backoffMs !== undefined ? { backoffMs: event.backoffMs } : {}),
    };
    const flex429Count = receipts.filter((entry) =>
      entry.attemptedTier === "flex" && entry.terminalHttpStatus === 429
    ).length;
    await tx.update(schema.agentLearningReviewCalls).set({
      transportReceipts: receipts,
      flex429Count,
      finalProviderRequestId: event.providerRequestId ?? call.finalProviderRequestId,
    }).where(eq(schema.agentLearningReviewCalls.id, call.id));
    await tx.update(schema.agentLearningReviews).set({
      capacitySubstatus: event.httpStatus === 429 && event.attemptedTier === "flex"
        ? "waiting_for_capacity"
        : event.attemptedTier === "auto"
          ? "using_standard_capacity"
          : null,
      updatedAt: nowIso,
    }).where(and(
      eq(schema.agentLearningReviews.id, review.id),
      eq(schema.agentLearningReviews.leaseTokenHash, hashLeaseToken(input.leaseToken)),
    ));
  });
}

export async function completeOwnerLearningCall(
  db: DrizzleDB,
  input: {
    reviewId: string;
    callId: string;
    leaseToken: string;
    effectiveTier: string;
    tokenReceipt: OwnerLearningTokenReceipt;
    costReceipt: OwnerLearningCallCostReceipt;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  return db.transaction(async (tx) => {
    await lockReview(tx, input.reviewId);
    const review = await requireActiveLease(tx, input.reviewId, input.leaseToken, nowIso);
    const call = await requireCall(tx, input.reviewId, input.callId);
    const totalLatencyMs = call.transportReceipts.reduce(
      (total, receipt) => total + (receipt.latencyMs ?? 0),
      0,
    );
    if (!validEffectiveTier(call, input.effectiveTier)) {
      await tx.update(schema.agentLearningReviewCalls).set({
        state: "failed",
        effectiveTier: persistableEffectiveTier(input.effectiveTier),
        capacityPath: call.flex429Count === 3 ? "standard_fallback" : "flex",
        tokenReceipt: input.tokenReceipt,
        latencyMs: totalLatencyMs,
        costSource: input.costReceipt.costSource,
        actualCostMicrousd: input.costReceipt.actualCostMicrousd ?? null,
        estimatedCostMicrousd: input.costReceipt.estimatedCostMicrousd ?? null,
        pricingSourceId: input.costReceipt.pricingSourceId ?? null,
        rateCardVersion: input.costReceipt.rateCardVersion ?? null,
        pricedAt: input.costReceipt.pricedAt ?? null,
        safeFailureCode: "tier_mismatch",
        completedAt: nowIso,
      }).where(eq(schema.agentLearningReviewCalls.id, call.id));
      await failReviewUnderLease(tx, review, "tier_mismatch", false, nowIso);
      return false;
    }
    await tx.update(schema.agentLearningReviewCalls).set({
      state: "succeeded",
      effectiveTier: input.effectiveTier,
      capacityPath: call.flex429Count === 3 ? "standard_fallback" : "flex",
      tokenReceipt: input.tokenReceipt,
      latencyMs: totalLatencyMs,
      costSource: input.costReceipt.costSource,
      actualCostMicrousd: input.costReceipt.actualCostMicrousd ?? null,
      estimatedCostMicrousd: input.costReceipt.estimatedCostMicrousd ?? null,
      pricingSourceId: input.costReceipt.pricingSourceId ?? null,
      rateCardVersion: input.costReceipt.rateCardVersion ?? null,
      pricedAt: input.costReceipt.pricedAt ?? null,
      completedAt: nowIso,
    }).where(eq(schema.agentLearningReviewCalls.id, call.id));
    await tx.update(schema.agentLearningReviews).set({
      capacitySubstatus: null,
      updatedAt: nowIso,
    }).where(activeLeaseWhere(input.reviewId, input.leaseToken, nowIso));
    return true;
  });
}

export async function failOwnerLearningReview(
  db: DrizzleDB,
  input: {
    reviewId: string;
    leaseToken: string;
    failureCode: OwnerLearningSafeFailureCode;
    retryable: boolean;
    callId?: string;
    completedCallId?: string;
    completedCallFailureCode?: OwnerLearningCallFailureCode;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  return db.transaction(async (tx) => {
    await lockReview(tx, input.reviewId);
    const review = await requireActiveLease(tx, input.reviewId, input.leaseToken, nowIso);
    if (input.callId) {
      await tx.update(schema.agentLearningReviewCalls).set({
        state: "failed",
        safeFailureCode: input.failureCode,
        completedAt: nowIso,
      }).where(and(
        eq(schema.agentLearningReviewCalls.id, input.callId),
        eq(schema.agentLearningReviewCalls.reviewId, input.reviewId),
        inArray(schema.agentLearningReviewCalls.state, ["reserved", "dispatched"]),
      ));
    }
    if (input.completedCallId) {
      const failed = await tx.update(schema.agentLearningReviewCalls).set({
        state: "failed",
        safeFailureCode: input.completedCallFailureCode ?? input.failureCode,
        completedAt: nowIso,
      }).where(and(
        eq(schema.agentLearningReviewCalls.id, input.completedCallId),
        eq(schema.agentLearningReviewCalls.reviewId, input.reviewId),
        eq(schema.agentLearningReviewCalls.state, "succeeded"),
      )).returning({ id: schema.agentLearningReviewCalls.id });
      if (failed.length !== 1) throw new OwnerLearningWorkerError("call_state_conflict");
    }
    await failReviewUnderLease(tx, review, input.failureCode, input.retryable, nowIso);
    return true;
  }).catch((error) => {
    if (error instanceof OwnerLearningWorkerError && error.code === "stale_or_invalid_lease") return false;
    throw error;
  });
}

export async function persistOwnerLearningCheckpoint(
  db: DrizzleDB,
  input: {
    reviewId: string;
    leaseToken: string;
    expectedCheckpointHash: string | null;
    checkpoint: OwnerLearningCheckpoint;
    now?: Date;
  },
): Promise<string> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const checkpointHash = fingerprintOwnerLearningValue(input.checkpoint);
  return db.transaction(async (tx) => {
    await lockReview(tx, input.reviewId);
    const review = await requireActiveLease(tx, input.reviewId, input.leaseToken, nowIso);
    if (review.checkpointHash !== input.expectedCheckpointHash) {
      throw new OwnerLearningWorkerError("call_state_conflict");
    }
    const updated = await tx.update(schema.agentLearningReviews).set({
      checkpoint: input.checkpoint,
      checkpointHash,
      stage: input.checkpoint.lastCompletedStage,
      updatedAt: nowIso,
    }).where(and(
      activeLeaseWhere(input.reviewId, input.leaseToken, nowIso),
      input.expectedCheckpointHash == null
        ? sql`${schema.agentLearningReviews.checkpointHash} IS NULL`
        : eq(schema.agentLearningReviews.checkpointHash, input.expectedCheckpointHash),
    )).returning({ id: schema.agentLearningReviews.id });
    if (updated.length !== 1) throw new OwnerLearningWorkerError("call_state_conflict");
    const event = createOwnerLearningEvent("stage_reached", {
      ownerUserId: review.ownerUserId,
      reviewId: review.id,
      agentProfileId: review.agentProfileId,
      occurredAt: nowIso,
    }, {
      stage: input.checkpoint.lastCompletedStage,
      logicalCallCount: review.logicalCallCount,
      diveCount: review.diveCount,
    });
    await tx.insert(schema.agentLearningEvents).values({
      id: randomUUID(),
      ownerUserId: event.ownerUserId,
      reviewId: event.reviewId,
      agentProfileId: event.agentProfileId,
      kind: event.kind,
      payload: event.payload,
      occurredAt: event.occurredAt,
    });
    return checkpointHash;
  });
}

export async function finalizeOwnerLearningReview(
  db: DrizzleDB,
  input: {
    reviewId: string;
    leaseToken: string;
    expectedCheckpointHash: string;
    result: OwnerLearningReviewResult;
    proposalFingerprint: string | null;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  return db.transaction(async (tx) => {
    await lockReview(tx, input.reviewId);
    const review = await requireActiveLease(tx, input.reviewId, input.leaseToken, nowIso);
    const noChange = input.result.noChange != null;
    const updated = await tx.update(schema.agentLearningReviews).set({
      analysisStatus: noChange ? "no_change" : "ready",
      stage: "complete",
      result: input.result,
      proposalFingerprint: input.proposalFingerprint,
      resolution: noChange ? "no_change" : null,
      resolvedAt: noChange ? nowIso : null,
      completedAt: nowIso,
      leaseTokenHash: null,
      leaseExpiresAt: null,
      capacitySubstatus: null,
      safeFailureCode: null,
      retryable: false,
      updatedAt: nowIso,
    }).where(and(
      activeLeaseWhere(input.reviewId, input.leaseToken, nowIso),
      eq(schema.agentLearningReviews.checkpointHash, input.expectedCheckpointHash),
    )).returning({ id: schema.agentLearningReviews.id });
    if (updated.length !== 1) return false;
    if (noChange) {
      const event = createOwnerLearningEvent("review_resolved", {
        ownerUserId: review.ownerUserId,
        reviewId: review.id,
        agentProfileId: review.agentProfileId,
        occurredAt: nowIso,
      }, { resolution: "no_change" });
      await tx.insert(schema.agentLearningEvents).values({
        id: randomUUID(),
        ownerUserId: event.ownerUserId,
        reviewId: event.reviewId,
        agentProfileId: event.agentProfileId,
        kind: event.kind,
        payload: event.payload,
        occurredAt: event.occurredAt,
      });
    }
    return true;
  });
}

export async function retryOwnerLearningReview(
  db: DrizzleDB,
  input: { ownerUserId: string; reviewId: string; now?: Date },
): Promise<boolean> {
  const nowIso = (input.now ?? new Date()).toISOString();
  return db.transaction(async (tx) => {
    await lockReview(tx, input.reviewId);
    const review = (await tx.select().from(schema.agentLearningReviews).where(and(
      eq(schema.agentLearningReviews.id, input.reviewId),
      eq(schema.agentLearningReviews.ownerUserId, input.ownerUserId),
    )).limit(1))[0];
    if (
      !review
      || review.resolvedAt != null
      || review.analysisStatus !== "failed"
      || !review.retryable
      || review.logicalCallCount >= OWNER_LEARNING_MAX_LOGICAL_CALLS
    ) return false;
    const updated = await tx.update(schema.agentLearningReviews).set({
      analysisStatus: "queued",
      safeFailureCode: null,
      retryable: false,
      leaseTokenHash: null,
      leaseExpiresAt: null,
      capacitySubstatus: null,
      updatedAt: nowIso,
    }).where(and(
      eq(schema.agentLearningReviews.id, input.reviewId),
      eq(schema.agentLearningReviews.analysisStatus, "failed"),
      eq(schema.agentLearningReviews.retryable, true),
      sql`${schema.agentLearningReviews.resolvedAt} IS NULL`,
    )).returning({ id: schema.agentLearningReviews.id });
    if (updated.length !== 1) return false;
    const event = createOwnerLearningEvent("review_retried", {
      ownerUserId: review.ownerUserId,
      reviewId: review.id,
      agentProfileId: review.agentProfileId,
      occurredAt: nowIso,
    }, {
      logicalCallCount: review.logicalCallCount,
      diveCount: review.diveCount,
    });
    await tx.insert(schema.agentLearningEvents).values({
      id: randomUUID(),
      ownerUserId: event.ownerUserId,
      reviewId: event.reviewId,
      agentProfileId: event.agentProfileId,
      kind: event.kind,
      payload: event.payload,
      occurredAt: event.occurredAt,
    });
    return true;
  });
}

export async function runClaimedOwnerLearningReview(
  db: DrizzleDB,
  claim: OwnerLearningWorkerClaim,
  options: {
    provider: OwnerLearningProvider;
    projector?: OwnerLearningEvidenceProjector;
    cursorSecret?: string;
    signal?: AbortSignal;
    now?: () => Date;
    heartbeatIntervalMs?: number;
    leaseDurationMs?: number;
    onOutputFailure?: (diagnostic: OwnerLearningOutputFailureDiagnostic) => void;
  },
): Promise<boolean> {
  const now = options.now ?? (() => new Date());
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? OWNER_LEARNING_LEASE_DURATION_MS / 3;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleHeartbeat = () => {
    if (controller.signal.aborted) return;
    heartbeatTimer = setTimeout(() => {
      void heartbeatOwnerLearningReview(db, {
        reviewId: claim.reviewId,
        leaseToken: claim.leaseToken,
        now: now(),
        leaseDurationMs: options.leaseDurationMs,
      }).then((renewed) => {
        if (!renewed) {
          controller.abort(new DOMException("Owner learning lease lost", "AbortError"));
          return;
        }
        scheduleHeartbeat();
      }).catch((error) => controller.abort(error));
    }, heartbeatIntervalMs);
  };
  const review = (await db.select({
    id: schema.agentLearningReviews.id,
    ownerUserId: schema.agentLearningReviews.ownerUserId,
    agentProfileId: schema.agentLearningReviews.agentProfileId,
    reviewedRevisionId: schema.agentLearningReviews.reviewedRevisionId,
    analysisTrack: schema.agentLearningReviews.analysisTrack,
    checkpoint: schema.agentLearningReviews.checkpoint,
    checkpointHash: schema.agentLearningReviews.checkpointHash,
    logicalCallCount: schema.agentLearningReviews.logicalCallCount,
    diveCount: schema.agentLearningReviews.diveCount,
    strategyStyle: schema.agentProfiles.strategyStyle,
  }).from(schema.agentLearningReviews)
    .innerJoin(schema.agentProfiles, eq(schema.agentLearningReviews.agentProfileId, schema.agentProfiles.id))
    .where(eq(schema.agentLearningReviews.id, claim.reviewId)).limit(1))[0];
  if (!review) {
    options.signal?.removeEventListener("abort", abortFromCaller);
    return false;
  }
  activeOwnerLearningRuns.get(review.id)?.abort(
    new DOMException("Owner learning review superseded locally", "AbortError"),
  );
  activeOwnerLearningRuns.set(review.id, controller);

  let expectedCheckpointHash = review.checkpointHash;
  const outputValidationCall: {
    current: {
      id: string;
      ordinal: number;
      stage: OwnerLearningStage;
    } | null;
  } = { current: null };
  try {
    scheduleHeartbeat();
    const selectedGames = await db.select({ gameId: schema.agentLearningReviewGames.gameId })
      .from(schema.agentLearningReviewGames)
      .where(eq(schema.agentLearningReviewGames.reviewId, claim.reviewId))
      .orderBy(asc(schema.agentLearningReviewGames.position));
    const selection = await validateOwnerLearningSelection(db, {
      ownerUserId: review.ownerUserId,
      agentProfileId: review.agentProfileId,
      gameIds: selectedGames.map((game) => game.gameId),
    });
    if (selection.currentRevisionId !== review.reviewedRevisionId) {
      throw new Error("reviewed revision is no longer current");
    }
    const projector = options.projector ?? projectOwnerLearningEvidence;
    const evidence = await projector(db, selection, {
      instructions: OWNER_LEARNING_REVIEW_INSTRUCTIONS,
      cursorSecret: options.cursorSecret,
    });
    const harnessCounters = await ownerLearningHarnessStartCounters(db, review);
    const harness = await runOwnerLearningHarness({
      reviewId: review.id,
      analysisTrack: review.analysisTrack,
      currentStrategyStyle: review.strategyStyle,
      evidence,
      checkpoint: review.checkpoint,
      logicalCallCount: harnessCounters.logicalCallCount,
      diveCount: harnessCounters.diveCount,
      async invoke(turn) {
        outputValidationCall.current = null;
        const requestInput = turn.request;
        const inputPolicyHash = fingerprintOwnerLearningRequest({
          model: "gpt-5.6-luna",
          input: requestInput,
          responseSchema: turn.responseSchema,
          maxOutputTokens: OWNER_LEARNING_MAX_OUTPUT_TOKENS,
          reasoning: { effort: "low" },
          store: false,
          serviceTier: "flex",
        });
        const reservation = await reserveOwnerLearningCall(db, {
          reviewId: review.id,
          leaseToken: claim.leaseToken,
          inputPolicyHash,
          stage: turn.stage,
          isDive: turn.isDive,
          now: now(),
        });
        const observer = createOwnerLearningTransportObserver(db, {
          reviewId: review.id,
          callId: reservation.callId,
          leaseToken: claim.leaseToken,
        });
        try {
          const response = await options.provider.invoke({
            input: requestInput,
            responseSchema: turn.responseSchema,
            diagnosticContext: {
              reviewId: review.id,
              callOrdinal: reservation.ordinal,
            },
            observer,
            resumeTransport: reservation.resumeTransport,
            signal: controller.signal,
          });
          const completed = await completeOwnerLearningCall(db, {
            reviewId: review.id,
            callId: reservation.callId,
            leaseToken: claim.leaseToken,
            effectiveTier: response.effectiveTier,
            tokenReceipt: response.tokenReceipt,
            costReceipt: response.costReceipt,
            now: now(),
          });
          if (!completed) throw new Error("provider tier did not match durable capacity path");
          outputValidationCall.current = {
            id: reservation.callId,
            ordinal: reservation.ordinal,
            stage: turn.stage,
          };
          return response.output;
        } catch (error) {
          if (error instanceof OwnerLearningProviderError) {
            await failProviderCall(db, {
              reviewId: review.id,
              callId: reservation.callId,
              leaseToken: claim.leaseToken,
              error,
              now: now(),
            });
          }
          throw error;
        }
      },
      async onCheckpoint(checkpoint) {
        outputValidationCall.current = null;
        expectedCheckpointHash = await persistOwnerLearningCheckpoint(db, {
          reviewId: review.id,
          leaseToken: claim.leaseToken,
          expectedCheckpointHash,
          checkpoint,
          now: now(),
        });
      },
    });
    if (!expectedCheckpointHash) throw new Error("review checkpoint was not persisted");
    return finalizeOwnerLearningReview(db, {
      reviewId: review.id,
      leaseToken: claim.leaseToken,
      expectedCheckpointHash,
      result: harness.result,
      proposalFingerprint: harness.proposalFingerprint,
      now: now(),
    });
  } catch (error) {
    if (error instanceof OwnerLearningProviderError || error instanceof OwnerLearningWorkerError) {
      return false;
    }
    if (controller.signal.aborted) {
      await failOwnerLearningReview(db, {
        reviewId: review.id,
        leaseToken: claim.leaseToken,
        failureCode: "worker_interrupted",
        retryable: true,
        now: now(),
      });
      return false;
    }
    const completedCall = outputValidationCall.current;
    const outputFailureCode = completedCall
      ? classifyOwnerLearningOutputFailure(error)
      : null;
    if (completedCall && outputFailureCode) {
      const diagnostic: OwnerLearningOutputFailureDiagnostic = {
        reviewId: review.id,
        callOrdinal: completedCall.ordinal,
        stage: completedCall.stage,
        code: outputFailureCode,
      };
      (options.onOutputFailure ?? logOwnerLearningOutputFailure)(diagnostic);
    }
    await failOwnerLearningReview(db, {
      reviewId: review.id,
      leaseToken: claim.leaseToken,
      failureCode: "invalid_structured_output",
      retryable: review.logicalCallCount < OWNER_LEARNING_MAX_LOGICAL_CALLS,
      ...(completedCall
        ? {
            completedCallId: completedCall.id,
            completedCallFailureCode: outputFailureCode ?? "unclassified_output_failure",
          }
        : {}),
      now: now(),
    });
    return false;
  } finally {
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    if (activeOwnerLearningRuns.get(review.id) === controller) {
      activeOwnerLearningRuns.delete(review.id);
    }
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function classifyOwnerLearningOutputFailure(error: unknown): OwnerLearningOutputFailureCode {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "Owner learning provider returned the obsolete moment ID protocol"
    || message === "Owner learning provider returned the obsolete evidence-ref protocol"
  ) return "obsolete_output_protocol";
  if (message === "selectedMomentHandles must be an array" || message === "evidenceHandles must be an array") {
    return "invalid_handle_list";
  }
  if (
    message === "Generated turn selected an unknown moment handle"
    || message === "Generated turn selected a non-moment evidence handle"
    || message === "Generated turn selected an unknown moment ID"
  ) return "unknown_moment_handle";
  if (message === "Generated turn cited an unknown evidence handle") return "unknown_evidence_handle";
  if (
    message === "Owner learning final turn did not contain a result"
    || message === "Owner learning final logical call must contain a result"
  ) return "missing_final_result";
  if (message === "Generated result changed the purchased analysis track") {
    return "analysis_track_mismatch";
  }
  if (
    message === "Generated result contains an unknown evidence ref"
    || message === "Generated finding contains an unknown evidence ref"
  ) return "unknown_evidence_ref";
  if (
    message === "Generated strategy proposal does not start from the reviewed strategy"
    || message === "Generated strategy proposal requires a change recommendation"
    || message === "Generated no-change result cannot contain a change recommendation"
  ) return "proposal_contract";
  if (
    message === "strategyHealthClassification is required for Strategy Health Check"
    || message === "Strategy Health Check no-change must specifically defend the current guidance"
    || message.includes(".proof is required for Strategy Health Check")
    || message.includes(".proof.rubricCategory is required")
    || message.includes(".proof observed pattern requires two games")
  ) return "strategy_health_contract";
  if (
    message === "selectedMomentIds must be distinct"
    || message.startsWith("harness turn ")
    || message.startsWith("provisionalThemes ")
    || message.startsWith("selectedMomentIds ")
    || message.startsWith("findings[")
  ) return "invalid_turn_contract";
  if (
    message.startsWith("review result ")
    || message.startsWith("recommendations ")
    || message.startsWith("recommendations[")
    || message.startsWith("diagnosis ")
    || message.startsWith("analysisTrack ")
    || message.startsWith("proposal ")
    || message.startsWith("noChange ")
    || message.startsWith("strategyHealthClassification ")
    || message.startsWith("owner learning proposal ")
  ) return "invalid_result_contract";
  return "unclassified_output_failure";
}

function logOwnerLearningOutputFailure(diagnostic: OwnerLearningOutputFailureDiagnostic): void {
  console.error(
    `[owner-learning] post-response review failure ${JSON.stringify(diagnostic)}`,
  );
}

export interface OwnerLearningWorkerLoop {
  stop(): void;
  readonly stopped: boolean;
}

export function startOwnerLearningWorkerLoop(
  db: DrizzleDB,
  options: {
    provider: OwnerLearningProvider;
    projector?: OwnerLearningEvidenceProjector;
    cursorSecret?: string;
    pollIntervalMs?: number;
  },
): OwnerLearningWorkerLoop {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;

  const schedule = (delayMs: number) => {
    if (controller.signal.aborted) return;
    timer = setTimeout(() => { void tick(); }, delayMs);
  };
  const tick = async () => {
    if (running || controller.signal.aborted) return;
    running = true;
    try {
      const claim = await claimOwnerLearningReview(db);
      if (claim) {
        await runClaimedOwnerLearningReview(db, claim, {
          provider: options.provider,
          projector: options.projector,
          cursorSecret: options.cursorSecret,
          signal: controller.signal,
        });
        schedule(0);
      } else {
        schedule(pollIntervalMs);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[owner-learning] Worker iteration failed:", message);
        schedule(pollIntervalMs);
      }
    } finally {
      running = false;
    }
  };
  schedule(0);
  return {
    stop() {
      controller.abort(new DOMException("Owner learning worker stopped", "AbortError"));
      if (timer) clearTimeout(timer);
      timer = null;
    },
    get stopped() {
      return controller.signal.aborted;
    },
  };
}

async function failProviderCall(
  db: DrizzleDB,
  input: {
    reviewId: string;
    callId: string;
    leaseToken: string;
    error: OwnerLearningProviderError;
    now: Date;
  },
): Promise<void> {
  const nowIso = input.now.toISOString();
  await db.transaction(async (tx) => {
    await lockReview(tx, input.reviewId);
    const review = await requireActiveLease(tx, input.reviewId, input.leaseToken, nowIso);
    await tx.update(schema.agentLearningReviewCalls).set({
      state: "failed",
      effectiveTier: persistableEffectiveTier(input.error.effectiveTier),
      tokenReceipt: input.error.tokenReceipt ?? null,
      costSource: input.error.costReceipt?.costSource ?? "unavailable",
      actualCostMicrousd: input.error.costReceipt?.actualCostMicrousd ?? null,
      estimatedCostMicrousd: input.error.costReceipt?.estimatedCostMicrousd ?? null,
      pricingSourceId: input.error.costReceipt?.pricingSourceId ?? null,
      rateCardVersion: input.error.costReceipt?.rateCardVersion ?? null,
      pricedAt: input.error.costReceipt?.pricedAt ?? null,
      safeFailureCode: input.error.code,
      completedAt: nowIso,
    }).where(and(
      eq(schema.agentLearningReviewCalls.id, input.callId),
      eq(schema.agentLearningReviewCalls.reviewId, input.reviewId),
      inArray(schema.agentLearningReviewCalls.state, ["reserved", "dispatched"]),
    ));
    await failReviewUnderLease(tx, review, input.error.code, input.error.retryable, nowIso);
  });
}

type ReviewTx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
type ReviewRow = typeof schema.agentLearningReviews.$inferSelect;
type CallRow = typeof schema.agentLearningReviewCalls.$inferSelect;

async function ownerLearningHarnessStartCounters(
  db: DrizzleDB,
  review: Pick<ReviewRow, "id" | "logicalCallCount" | "diveCount">,
): Promise<{ logicalCallCount: number; diveCount: number }> {
  const latest = (await db.select().from(schema.agentLearningReviewCalls)
    .where(eq(schema.agentLearningReviewCalls.reviewId, review.id))
    .orderBy(desc(schema.agentLearningReviewCalls.ordinal)).limit(1))[0] ?? null;
  if (!latest || !isResumableCall(latest)) {
    return { logicalCallCount: review.logicalCallCount, diveCount: review.diveCount };
  }
  return {
    logicalCallCount: Math.max(0, review.logicalCallCount - 1),
    diveCount: Math.max(
      0,
      review.diveCount - (latest.stage === "investigating_moments" ? 1 : 0),
    ),
  };
}

async function reconcileExpiredCall(
  tx: ReviewTx,
  reviewId: string,
  nowIso: string,
): Promise<"resumable" | "failed"> {
  const latest = (await tx.select().from(schema.agentLearningReviewCalls)
    .where(eq(schema.agentLearningReviewCalls.reviewId, reviewId))
    .orderBy(desc(schema.agentLearningReviewCalls.ordinal)).limit(1))[0] ?? null;
  if (!latest || latest.state === "reserved" || latest.state === "succeeded" || latest.state === "failed") {
    return "resumable";
  }
  const lastReceipt = latest.transportReceipts.at(-1);
  if (
    latest.state === "dispatched"
    && lastReceipt?.attemptedTier === "flex"
    && lastReceipt.terminalHttpStatus === 429
  ) {
    return "resumable";
  }
  const failureCode: OwnerLearningSafeFailureCode = lastReceipt?.attemptedTier === "auto"
    && lastReceipt.terminalHttpStatus === 429
    ? "provider_capacity_exhausted"
    : "worker_interrupted";
  await tx.update(schema.agentLearningReviewCalls).set({
    state: lastReceipt?.terminalOutcomeAt == null ? "ambiguous" : "failed",
    safeFailureCode: failureCode,
    completedAt: nowIso,
  }).where(eq(schema.agentLearningReviewCalls.id, latest.id));
  const review = (await tx.select().from(schema.agentLearningReviews)
    .where(eq(schema.agentLearningReviews.id, reviewId)).limit(1))[0];
  if (review) await failReviewUnderLease(tx, review, failureCode, true, nowIso);
  return "failed";
}

function resumableReservation(
  latest: CallRow | null,
  inputPolicyHash: string,
  stage: OwnerLearningStage,
  now: Date,
): OwnerLearningCallReservation | null {
  if (!latest || latest.inputPolicyHash !== inputPolicyHash || latest.stage !== stage) return null;
  return isResumableCall(latest) ? reservationFromExisting(latest, now) : null;
}

function isResumableCall(call: CallRow): boolean {
  if (call.state === "reserved" && call.transportReceipts.length === 0) return true;
  const lastReceipt = call.transportReceipts.at(-1);
  return call.state === "dispatched"
    && lastReceipt?.attemptedTier === "flex"
    && lastReceipt.terminalHttpStatus === 429;
}

function reservationFromExisting(call: CallRow, now: Date): OwnerLearningCallReservation {
  const lastReceipt = call.transportReceipts.at(-1);
  const terminalAtMs = lastReceipt?.terminalOutcomeAt
    ? Date.parse(lastReceipt.terminalOutcomeAt)
    : Number.NaN;
  const initialBackoffMs = lastReceipt?.backoffMs != null && Number.isFinite(terminalAtMs)
    ? Math.max(0, lastReceipt.backoffMs - Math.max(0, now.getTime() - terminalAtMs))
    : 0;
  return {
    callId: call.id,
    ordinal: call.ordinal,
    reused: true,
    resumeTransport: {
      flex429Count: call.flex429Count,
      nextTransportOrdinal: call.transportReceipts.length + 1,
      nextTier: expectedNextTier(call.flex429Count),
      initialBackoffMs,
    },
  };
}

function expectedNextTier(flex429Count: number): "flex" | "auto" {
  return flex429Count >= 3 ? "auto" : "flex";
}

function validEffectiveTier(call: CallRow, effectiveTier: string): boolean {
  const last = call.transportReceipts.at(-1);
  if (!last || last.terminalHttpStatus == null || last.terminalHttpStatus < 200 || last.terminalHttpStatus >= 300) {
    return false;
  }
  if (effectiveTier === "flex") {
    return call.flex429Count < 3 && last.attemptedTier === "flex";
  }
  if (effectiveTier === "auto" || effectiveTier === "default") {
    return call.flex429Count === 3
      && last.attemptedTier === "auto"
      && call.fallbackStartedAt != null;
  }
  return false;
}

function persistableEffectiveTier(
  effectiveTier: string | undefined,
): "flex" | "auto" | "default" | null {
  return effectiveTier === "flex" || effectiveTier === "auto" || effectiveTier === "default"
    ? effectiveTier
    : null;
}

async function requireCall(
  db: Pick<DrizzleDB, "select">,
  reviewId: string,
  callId: string,
): Promise<CallRow> {
  const call = (await db.select().from(schema.agentLearningReviewCalls).where(and(
    eq(schema.agentLearningReviewCalls.id, callId),
    eq(schema.agentLearningReviewCalls.reviewId, reviewId),
  )).limit(1))[0];
  if (!call) throw new OwnerLearningWorkerError("call_state_conflict");
  return call;
}

async function requireActiveLease(
  db: Pick<DrizzleDB, "select">,
  reviewId: string,
  leaseToken: string,
  nowIso: string,
): Promise<ReviewRow> {
  const review = (await db.select().from(schema.agentLearningReviews)
    .where(activeLeaseWhere(reviewId, leaseToken, nowIso)).limit(1))[0];
  if (!review) throw new OwnerLearningWorkerError("stale_or_invalid_lease");
  return review;
}

function activeLeaseWhere(reviewId: string, leaseToken: string, nowIso: string) {
  return and(
    eq(schema.agentLearningReviews.id, reviewId),
    eq(schema.agentLearningReviews.analysisStatus, "running"),
    sql`${schema.agentLearningReviews.resolvedAt} IS NULL`,
    eq(schema.agentLearningReviews.leaseTokenHash, hashLeaseToken(leaseToken)),
    gt(schema.agentLearningReviews.leaseExpiresAt, nowIso),
  );
}

async function lockReview(tx: ReviewTx, reviewId: string): Promise<void> {
  await tx.execute(sql`SELECT id FROM agent_learning_reviews WHERE id = ${reviewId} FOR UPDATE`);
}

async function failReviewUnderLease(
  tx: ReviewTx,
  review: ReviewRow,
  failureCode: OwnerLearningSafeFailureCode,
  retryable: boolean,
  nowIso: string,
): Promise<void> {
  await tx.update(schema.agentLearningReviews).set({
    analysisStatus: "failed",
    safeFailureCode: failureCode,
    retryable: retryable && review.logicalCallCount < OWNER_LEARNING_MAX_LOGICAL_CALLS,
    leaseTokenHash: null,
    leaseExpiresAt: null,
    capacitySubstatus: null,
    updatedAt: nowIso,
  }).where(eq(schema.agentLearningReviews.id, review.id));
  const event = createOwnerLearningEvent("review_failed", {
    ownerUserId: review.ownerUserId,
    reviewId: review.id,
    agentProfileId: review.agentProfileId,
    occurredAt: nowIso,
  }, {
    failureCode,
    retryable: retryable && review.logicalCallCount < OWNER_LEARNING_MAX_LOGICAL_CALLS,
  });
  await tx.insert(schema.agentLearningEvents).values({
    id: randomUUID(),
    ownerUserId: event.ownerUserId,
    reviewId: event.reviewId,
    agentProfileId: event.agentProfileId,
    kind: event.kind,
    payload: event.payload,
    occurredAt: event.occurredAt,
  });
}

function hashLeaseToken(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}
