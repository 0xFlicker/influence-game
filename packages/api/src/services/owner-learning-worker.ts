import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  FlexProcessingObserver,
  FlexTransportDispatchIntent,
  FlexTransportTerminalOutcome,
} from "@influence/engine";
import { validateExactStructuredValue } from "@influence/engine";
import { and, asc, desc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type {
  OwnerLearningCheckpoint,
  OwnerLearningCallCostReceipt,
  OwnerLearningCallFailureCode,
  OwnerLearningExecutionPhase,
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
  OWNER_LEARNING_ELIGIBILITY_POLICY_VERSION,
  OWNER_LEARNING_EVIDENCE_VERSION,
  OWNER_LEARNING_MAX_DIVES,
  OWNER_LEARNING_MAX_LOGICAL_CALLS,
  OWNER_LEARNING_PROMPT_VERSION,
  OWNER_LEARNING_PROVIDER_POLICY_VERSION,
  OWNER_LEARNING_REVIEWER_VERSION,
  OWNER_LEARNING_SCHEMA_VERSION,
} from "./owner-learning-contracts.js";
import {
  runOwnerLearningHarness,
  type OwnerLearningHarnessInvocation,
} from "./owner-learning-harness.js";
import {
  OWNER_LEARNING_PROVIDER_PROTOCOL,
} from "./owner-learning-provider-context.js";
import type {
  OwnerLearningProvider,
  OwnerLearningProviderResponse,
  OwnerLearningProviderResponseObservation,
} from "./owner-learning-provider.js";
import {
  buildOwnerLearningProviderRequest,
  decodeOwnerLearningProviderOutput,
  OwnerLearningAttemptPersistenceError,
  OwnerLearningProviderError,
  recoverOwnerLearningProviderResponse,
} from "./owner-learning-provider.js";
import {
  OWNER_LEARNING_MODEL,
  OWNER_LEARNING_REVIEW_INSTRUCTIONS,
  type OwnerLearningEvidenceProjector,
} from "./owner-learning-review.js";
import { OWNER_LEARNING_MAX_OUTPUT_TOKENS } from "./owner-learning-provider.js";
import {
  materializeOwnerLearningEvidenceProjection,
  projectOwnerLearningEvidence,
  type OwnerLearningMaterializedEvidenceProjection,
} from "./owner-learning-evidence.js";
import {
  OwnerLearningEligibilityError,
  validateOwnerLearningSelection,
} from "./owner-learning-eligibility.js";
import {
  createOwnerLearningFailureDiagnostic,
  OwnerLearningOutputValidationError,
  type OwnerLearningFailureDiagnosticSummary,
} from "./owner-learning-failures.js";
import {
  enqueueOwnerLearningFailureEvidence,
  prepareOwnerLearningDurableValue,
  prepareOwnerLearningFailureEvidence,
  sanitizeOwnerLearningFailureExceptionForLog,
  type PreparedOwnerLearningFailureEvidence,
} from "./owner-learning-failure-evidence.js";
import { reconcileOwnerLearningFailureEvidence } from "./owner-learning-failure-reconciliation.js";

const OWNER_LEARNING_LEASE_DURATION_MS = 30_000;
const OWNER_LEARNING_LEASE_MONITOR_INTERVAL_MS = 250;
const activeOwnerLearningRuns = new Map<string, AbortController>();

export type OwnerLearningDurabilityPoint = "response_observed" | "validated_call" | "checkpoint";

class OwnerLearningInjectedFault extends Error {
  constructor(readonly injectedCause: unknown) {
    super("owner_learning_injected_fault");
  }
}

export interface OwnerLearningOutputFailureDiagnostic {
  reviewId: string;
  callOrdinal: number;
  stage: OwnerLearningStage;
  code: OwnerLearningOutputFailureCode;
}

interface OwnerLearningFailureEvidenceContext {
  error: unknown;
  requestEvidence?: unknown;
  responseEvidence?: unknown;
  redactionCredentialValues?: readonly string[];
  responseObservedAt?: string;
  decodedOutput?: unknown;
  validation?: unknown;
  tokenReceipt?: unknown;
  costReceipt?: unknown;
  protocol?: unknown;
  additionalEvidence?: unknown;
}

interface ObservedOwnerLearningCall {
  id: string;
  ordinal: number;
  attemptOrdinal: number;
  stage: OwnerLearningStage;
  response: OwnerLearningProviderResponse;
  decodedOutput?: unknown;
}

interface ActiveOwnerLearningCallCoordinate {
  id: string;
  ordinal: number;
  attemptOrdinal: number;
  stage: OwnerLearningStage;
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
  attemptOrdinal: number;
  reused: boolean;
  stagedProviderResponse?: OwnerLearningProviderResponse;
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
        eq(schema.agentLearningReviews.analysisStatus, "retry_queued"),
        and(
          eq(schema.agentLearningReviews.analysisStatus, "running"),
          lte(schema.agentLearningReviews.leaseExpiresAt, nowIso),
        ),
      ),
    )).orderBy(asc(schema.agentLearningReviews.createdAt), asc(schema.agentLearningReviews.id))
      .limit(20);

    for (const candidate of candidates) {
      await lockReview(tx, candidate.id);
      const locked = (await tx.select({
        status: schema.agentLearningReviews.analysisStatus,
        leaseExpiresAt: schema.agentLearningReviews.leaseExpiresAt,
        resolvedAt: schema.agentLearningReviews.resolvedAt,
      }).from(schema.agentLearningReviews)
        .where(eq(schema.agentLearningReviews.id, candidate.id)).limit(1))[0];
      if (
        !locked
        || locked.resolvedAt != null
        || (
          locked.status !== "queued"
          && locked.status !== "retry_queued"
          && locked.status !== "running"
        )
        || (locked.status === "running" && locked.leaseExpiresAt != null && locked.leaseExpiresAt > nowIso)
      ) continue;
      if (locked.status === "running") {
        const recovery = await reconcileExpiredCall(tx, candidate.id, nowIso);
        if (recovery === "failed") continue;
      }
      const leaseToken = randomBytes(32).toString("base64url");
      const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();
      const conditions = [
        eq(schema.agentLearningReviews.id, candidate.id),
        eq(schema.agentLearningReviews.analysisStatus, locked.status),
        sql`${schema.agentLearningReviews.resolvedAt} IS NULL`,
      ];
      if (locked.status === "running") {
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

async function ownsActiveOwnerLearningLease(
  db: DrizzleDB,
  input: { reviewId: string; leaseToken: string; now: Date },
): Promise<boolean> {
  const active = await db.select({ id: schema.agentLearningReviews.id })
    .from(schema.agentLearningReviews)
    .where(activeLeaseWhere(input.reviewId, input.leaseToken, input.now.toISOString()))
    .limit(1);
  return active.length === 1;
}

export async function reserveOwnerLearningCall(
  db: DrizzleDB,
  input: {
    reviewId: string;
    leaseToken: string;
    inputPolicyHash: string;
    requestEvidence: unknown;
    stage: OwnerLearningStage;
    isDive?: boolean;
    now?: Date;
    idFactory?: () => string;
  },
): Promise<OwnerLearningCallReservation> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const preparedRequest = prepareOwnerLearningDurableValue(input.requestEvidence);
  const reservation = await db.transaction(async (tx): Promise<OwnerLearningCallReservation | null> => {
    await lockReview(tx, input.reviewId);
    const review = await requireActiveLease(tx, input.reviewId, input.leaseToken, nowIso);
    const latest = (await tx.select().from(schema.agentLearningReviewCalls)
      .where(eq(schema.agentLearningReviewCalls.reviewId, input.reviewId))
      .orderBy(
        desc(schema.agentLearningReviewCalls.ordinal),
        desc(schema.agentLearningReviewCalls.attemptOrdinal),
      ).limit(1))[0] ?? null;
    const resumable = resumableReservation(latest, input.inputPolicyHash, input.stage, now);
    if (resumable) {
      if (latest?.requestEvidenceSha256 && latest.requestEvidenceSha256 !== preparedRequest.bodySha256) {
        throw new OwnerLearningWorkerError("call_state_conflict");
      }
      if (latest && latest.requestEvidenceBody == null) {
        await tx.update(schema.agentLearningReviewCalls).set({
          requestEvidenceBody: preparedRequest.body,
          requestEvidenceSha256: preparedRequest.bodySha256,
          requestEvidenceByteLength: preparedRequest.byteLength,
        }).where(eq(schema.agentLearningReviewCalls.id, latest.id));
      }
      return resumable;
    }
    if (latest && isResumableCall(latest)) {
      await tx.update(schema.agentLearningReviewCalls).set({
        state: "failed",
        safeFailureCode: "worker_interrupted",
        completedAt: nowIso,
      }).where(eq(schema.agentLearningReviewCalls.id, latest.id));
      await failReviewUnderLease(tx, review, "worker_interrupted", true, nowIso, {
        call: latest,
        evidence: {
          error: new Error("A previously dispatched owner review call was interrupted"),
          protocol: ownerLearningProviderProtocolEvidence(latest),
        },
      });
      return null;
    }
    const retryTarget = review.ownerRetryCount === 1
      && review.retryTargetAttemptId === latest?.id
      && (latest.state === "failed" || latest.state === "ambiguous")
      && latest.ordinal === review.logicalCallCount
      ? latest
      : null;
    if (retryTarget) {
      const terminalStagedOutcome = terminalStagedRetryOutcome(retryTarget);
      if (terminalStagedOutcome) {
        await failReviewUnderLease(
          tx,
          review,
          terminalStagedOutcome.failureCode,
          false,
          nowIso,
          {
            call: retryTarget,
            linkCall: false,
            evidence: providerResponseEvidenceContext(
              terminalStagedOutcome.error,
              terminalStagedOutcome.response,
              {
                additionalEvidence: {
                  kind: "retry_cancelled_before_reservation",
                  retryTargetAttemptId: retryTarget.id,
                },
              },
            ),
          },
        );
        return null;
      }
      const callId = input.idFactory?.() ?? randomUUID();
      const attemptOrdinal = retryTarget.attemptOrdinal + 1;
      const retryTargetDiagnostic = retryTarget.failureDiagnosticId
        ? (await tx.select({
            phase: schema.agentLearningReviewFailureDiagnostics.phase,
            safeFailureCode: schema.agentLearningReviewFailureDiagnostics.safeFailureCode,
          }).from(schema.agentLearningReviewFailureDiagnostics).where(eq(
            schema.agentLearningReviewFailureDiagnostics.id,
            retryTarget.failureDiagnosticId,
          )).limit(1))[0] ?? null
        : null;
      const outputWasPreviouslyValidated = retryTargetDiagnostic?.safeFailureCode
          === "internal_error"
        && (
          retryTargetDiagnostic.phase === "checkpoint_persistence"
          || retryTargetDiagnostic.phase === "finalization"
        );
      const stagedRetryResponse = outputWasPreviouslyValidated
        ? stagedProviderResponse(retryTarget)
        : null;
      if (
        stagedRetryResponse
        && !validEffectiveTier(retryTarget, stagedRetryResponse.effectiveTier)
      ) {
        throw new OwnerLearningWorkerError("call_state_conflict");
      }
      await tx.insert(schema.agentLearningReviewCalls).values({
        id: callId,
        reviewId: input.reviewId,
        ordinal: retryTarget.ordinal,
        attemptOrdinal,
        retryOfAttemptId: retryTarget.id,
        stage: input.stage,
        inputPolicyHash: input.inputPolicyHash,
        providerTurnProtocol: OWNER_LEARNING_PROVIDER_PROTOCOL,
        retryOfExecutionFingerprint: retryTarget.inputPolicyHash,
        state: "reserved",
        requestedTier: "flex",
        requestedReasoningEffort: "low",
        requestEvidenceBody: preparedRequest.body,
        requestEvidenceSha256: preparedRequest.bodySha256,
        requestEvidenceByteLength: preparedRequest.byteLength,
        ...(stagedRetryResponse && {
          providerResponseId: retryTarget.providerResponseId,
          providerResponseObservedAt: retryTarget.providerResponseObservedAt,
          providerResponseSha256: retryTarget.providerResponseSha256,
          responseEvidenceBody: retryTarget.responseEvidenceBody,
          responseEvidenceBodySha256: retryTarget.responseEvidenceBodySha256,
          responseEvidenceByteLength: retryTarget.responseEvidenceByteLength,
          effectiveTier: persistableEffectiveTier(stagedRetryResponse.effectiveTier),
        }),
        reservedAt: nowIso,
      });
      await tx.update(schema.agentLearningReviews).set({
        stage: input.stage,
        capacitySubstatus: null,
        safeFailureCode: null,
        retryable: false,
        executionPhase: "call_reservation",
        updatedAt: nowIso,
      }).where(activeLeaseWhere(input.reviewId, input.leaseToken, nowIso));
      return {
        callId,
        ordinal: retryTarget.ordinal,
        attemptOrdinal,
        reused: stagedRetryResponse != null,
        ...(stagedRetryResponse && { stagedProviderResponse: stagedRetryResponse }),
        resumeTransport: {
          flex429Count: 0,
          nextTransportOrdinal: 1,
          nextTier: "flex",
          initialBackoffMs: 0,
        },
      };
    }
    if (review.logicalCallCount >= OWNER_LEARNING_MAX_LOGICAL_CALLS) {
      await failReviewUnderLease(tx, review, "logical_call_budget_exhausted", false, nowIso, {
        call: latest,
        evidence: {
          error: new Error("Owner review exhausted its logical call budget"),
          protocol: ownerLearningProviderProtocolEvidence(latest),
        },
      });
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
      attemptOrdinal: 1,
      stage: input.stage,
      inputPolicyHash: input.inputPolicyHash,
      providerTurnProtocol: OWNER_LEARNING_PROVIDER_PROTOCOL,
      state: "reserved",
      requestedTier: "flex",
      requestedReasoningEffort: "low",
      requestEvidenceBody: preparedRequest.body,
      requestEvidenceSha256: preparedRequest.bodySha256,
      requestEvidenceByteLength: preparedRequest.byteLength,
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
      attemptOrdinal: 1,
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

interface StoredOwnerLearningResponseLedger {
  observations: OwnerLearningProviderResponseObservation[];
  providerResponse?: OwnerLearningProviderResponse;
}

function storedResponseLedger(call: CallRow): StoredOwnerLearningResponseLedger {
  if (!call.responseEvidenceBody) return { observations: [] };
  try {
    const parsed = JSON.parse(call.responseEvidenceBody) as {
      evidence?: StoredOwnerLearningResponseLedger;
    };
    const evidence = parsed.evidence;
    return {
      observations: Array.isArray(evidence?.observations) ? evidence.observations : [],
      ...(evidence?.providerResponse ? { providerResponse: evidence.providerResponse } : {}),
    };
  } catch {
    throw new OwnerLearningWorkerError("call_state_conflict");
  }
}

function providerResponseWithoutTransientCredentials(
  response: OwnerLearningProviderResponse,
): OwnerLearningProviderResponse {
  const { redactionCredentialValues: _credentials, ...durable } = response;
  return durable;
}

function normalizeObservedProviderResponse(
  response: OwnerLearningProviderResponse,
  now: Date,
): {
  response: OwnerLearningProviderResponse;
  observation: OwnerLearningProviderResponseObservation;
} {
  const responseEvidence = response.responseEvidence
    ?? providerResponseWithoutTransientCredentials(response);
  const responseObservedAt = response.responseObservedAt ?? now.toISOString();
  const responseSha256 = response.responseSha256
    ?? fingerprintOwnerLearningValue(responseEvidence);
  const normalized = {
    ...response,
    responseEvidence,
    responseObservedAt,
    responseSha256,
  };
  return {
    response: normalized,
    observation: {
      responseObservedAt,
      responseSha256,
      responseEvidence,
      providerResponseId: response.providerResponseId,
      redactionCredentialValues: response.redactionCredentialValues,
    },
  };
}

/** Persist raw transport evidence before provider parsing/worker validation can discard it. */
export async function persistOwnerLearningProviderResponse(
  db: DrizzleDB,
  input: {
    reviewId: string;
    callId: string;
    leaseToken: string;
    observation: OwnerLearningProviderResponseObservation;
    providerResponse?: OwnerLearningProviderResponse;
    now?: Date;
  },
): Promise<OwnerLearningProviderResponse | undefined> {
  const nowIso = (input.now ?? new Date()).toISOString();
  let cancelActiveRetry = false;
  const result = await db.transaction(async (tx) => {
    await lockReview(tx, input.reviewId);
    if (input.providerResponse) {
      await requireActiveLease(tx, input.reviewId, input.leaseToken, nowIso);
    }
    const call = await requireCall(tx, input.reviewId, input.callId);
    if (call.state === "succeeded") {
      throw new OwnerLearningWorkerError("call_state_conflict");
    }
    const terminalCall = call.state === "failed" || call.state === "ambiguous";
    const ledger = storedResponseLedger(call);
    const newObservation = !ledger.observations.some((entry) => (
      entry.responseSha256 === input.observation.responseSha256
      && entry.responseObservedAt === input.observation.responseObservedAt
    ));
    if (newObservation) {
      ledger.observations.push(input.observation);
    }
    if (input.providerResponse) {
      ledger.providerResponse = providerResponseWithoutTransientCredentials(input.providerResponse);
    }
    const prepared = prepareOwnerLearningDurableValue(ledger, [
      ...(input.observation.redactionCredentialValues ?? []),
      ...(input.providerResponse?.redactionCredentialValues ?? []),
    ]);
    const providerResponseId = input.providerResponse?.providerResponseId
      ?? input.observation.providerResponseId
      ?? call.providerResponseId;
    const responseObservedAt = input.providerResponse?.responseObservedAt
      ?? input.observation.responseObservedAt;
    const responseSha256 = input.providerResponse?.responseSha256
      ?? input.observation.responseSha256;
    const providerResponse = input.providerResponse;
    const provisionalCall: CallRow = {
      ...call,
      providerResponseId,
      providerResponseObservedAt: responseObservedAt,
      providerResponseSha256: responseSha256,
      responseEvidenceBody: prepared.body,
      responseEvidenceBodySha256: prepared.bodySha256,
      responseEvidenceByteLength: prepared.byteLength,
    };
    const recoveredOutcome = providerResponse
      ? { kind: "response" as const, response: providerResponse }
      : stagedProviderOutcome(provisionalCall);
    const receipt = recoveredOutcome?.kind === "response"
      ? recoveredOutcome.response
      : recoveredOutcome?.kind === "error" ? recoveredOutcome.error : null;
    const updated = await tx.update(schema.agentLearningReviewCalls).set({
      ...(!terminalCall && { state: "dispatched" as const }),
      dispatchedAt: call.dispatchedAt ?? nowIso,
      providerResponseId,
      providerResponseObservedAt: responseObservedAt,
      providerResponseSha256: responseSha256,
      responseEvidenceBody: prepared.body,
      responseEvidenceBodySha256: prepared.bodySha256,
      responseEvidenceByteLength: prepared.byteLength,
      ...(receipt?.effectiveTier && {
        effectiveTier: persistableEffectiveTier(receipt.effectiveTier),
      }),
      ...(receipt?.tokenReceipt && { tokenReceipt: receipt.tokenReceipt }),
      ...(receipt?.costReceipt && {
        costSource: receipt.costReceipt.costSource,
        actualCostMicrousd: receipt.costReceipt.actualCostMicrousd ?? null,
        estimatedCostMicrousd: receipt.costReceipt.estimatedCostMicrousd ?? null,
        pricingSourceId: receipt.costReceipt.pricingSourceId ?? null,
        rateCardVersion: receipt.costReceipt.rateCardVersion ?? null,
        pricedAt: receipt.costReceipt.pricedAt ?? null,
      }),
    }).where(and(
      eq(schema.agentLearningReviewCalls.id, input.callId),
      eq(schema.agentLearningReviewCalls.reviewId, input.reviewId),
      eq(schema.agentLearningReviewCalls.state, call.state),
    )).returning({ id: schema.agentLearningReviewCalls.id });
    if (updated.length !== 1) throw new OwnerLearningWorkerError("call_state_conflict");
    if (terminalCall && newObservation) {
      const review = (await tx.select().from(schema.agentLearningReviews)
        .where(eq(schema.agentLearningReviews.id, input.reviewId)).limit(1))[0];
      if (!review) throw new OwnerLearningWorkerError("call_state_conflict");
      const updatedCall = await requireCall(tx, input.reviewId, input.callId);
      const recoveredProviderError = recoveredOutcome?.kind === "error"
        ? recoveredOutcome.error
        : null;
      const recoveredTierMismatch = recoveredOutcome?.kind === "response"
        && !validEffectiveTier(updatedCall, recoveredOutcome.response.effectiveTier);
      const supplementalError = recoveredProviderError
        ?? new Error(recoveredTierMismatch
          ? "A late provider response reported a tier inconsistent with its recorded dispatch"
          : "A provider response arrived after the invocation attempt was terminalized");
      // A supplemental provider-invocation diagnostic must never inherit a
      // validation-only code from a later attempt. The original diagnostic and
      // review_failed event remain append-only below.
      const failureCode: OwnerLearningSafeFailureCode = recoveredTierMismatch
        ? "tier_mismatch"
        : recoveredProviderError?.code ?? "worker_interrupted";
      const diagnostic = createOwnerLearningFailureDiagnostic({
        phase: "provider_invocation",
        failureCode,
        error: supplementalError,
        errorCode: recoveredTierMismatch
          ? "late_provider_response_tier_mismatch"
          : recoveredProviderError?.internalCode ?? "late_provider_response_observed",
        callId: call.id,
        callOrdinal: call.ordinal,
        attemptOrdinal: call.attemptOrdinal,
        stage: call.stage,
        providerRequestId: call.finalProviderRequestId,
        providerResponseId,
      });
      const preparedFailure = prepareOwnerLearningReviewFailure({
        review,
        diagnostic,
        call: updatedCall,
        evidence: {
          error: supplementalError,
          responseEvidence: input.observation.responseEvidence,
          redactionCredentialValues: input.observation.redactionCredentialValues,
          responseObservedAt,
          tokenReceipt: receipt?.tokenReceipt,
          costReceipt: receipt?.costReceipt,
          protocol: ownerLearningProviderProtocolEvidence(updatedCall),
          additionalEvidence: {
            kind: "late_provider_response_observed",
            originalFailureDiagnosticId: call.failureDiagnosticId,
            originalCallState: call.state,
            originalReviewFailureCode: review.safeFailureCode,
            recoveredOutcome: recoveredProviderError
              ? {
                  kind: "error",
                  code: recoveredProviderError.code,
                  internalCode: recoveredProviderError.internalCode,
                  retryable: recoveredProviderError.retryable,
                }
              : recoveredTierMismatch
                ? { kind: "tier_mismatch" }
                : { kind: "response" },
          },
        },
        nowIso,
      });
      await enqueueOwnerLearningFailureEvidence(tx, {
        reviewId: review.id,
        call: {
          id: call.id,
          ordinal: call.ordinal,
          attemptOrdinal: call.attemptOrdinal,
        },
        linkCall: false,
        prepared: preparedFailure,
      });
      logOwnerLearningException({
        ...diagnostic,
        diagnosticId: preparedFailure.diagnostic.id,
        fingerprint: preparedFailure.diagnostic.fingerprint,
        evidenceManifestId: preparedFailure.manifestId,
      }, supplementalError);
      const terminalRetryDisposition = recoveredTierMismatch
        || recoveredProviderError?.retryable === false;
      if (
        review.analysisStatus === "failed"
        && review.resolvedAt == null
        && review.ownerRetryCount === 0
        && terminalRetryDisposition
      ) {
        await tx.update(schema.agentLearningReviews).set({
          retryable: false,
          updatedAt: nowIso,
        }).where(and(
          eq(schema.agentLearningReviews.id, review.id),
          eq(schema.agentLearningReviews.analysisStatus, "failed"),
          eq(schema.agentLearningReviews.ownerRetryCount, 0),
          sql`${schema.agentLearningReviews.resolvedAt} IS NULL`,
        ));
      }
      if (
        (review.analysisStatus === "retry_queued" || review.analysisStatus === "running")
        && review.resolvedAt == null
        && review.ownerRetryCount === 1
        && review.retryTargetAttemptId === call.id
        && terminalRetryDisposition
      ) {
        const retryAttempt = (await tx.select().from(schema.agentLearningReviewCalls).where(and(
          eq(schema.agentLearningReviewCalls.reviewId, review.id),
          eq(schema.agentLearningReviewCalls.retryOfAttemptId, call.id),
        )).orderBy(desc(schema.agentLearningReviewCalls.attemptOrdinal)).limit(1))[0] ?? null;
        if (retryAttempt?.state === "succeeded") return ledger.providerResponse;
        if (retryAttempt) {
          await tx.update(schema.agentLearningReviewCalls).set({
            state: "failed",
            validatedCheckpoint: null,
            safeFailureCode: failureCode,
            completedAt: nowIso,
          }).where(and(
            eq(schema.agentLearningReviewCalls.id, retryAttempt.id),
            eq(schema.agentLearningReviewCalls.reviewId, review.id),
            inArray(schema.agentLearningReviewCalls.state, ["reserved", "dispatched"]),
          ));
        }
        const persistedDiagnostic: OwnerLearningFailureDiagnosticSummary = {
          diagnosticId: preparedFailure.diagnostic.id,
          phase: "provider_invocation",
          failureCode,
          errorClass: preparedFailure.diagnostic.errorClass,
          errorCode: preparedFailure.diagnostic.errorCode ?? "late_provider_response_observed",
          message: preparedFailure.diagnostic.sanitizedMessage,
          firstApplicationFrame: preparedFailure.diagnostic.firstApplicationStackFrame ?? null,
          fingerprint: preparedFailure.diagnostic.fingerprint,
          callId: call.id,
          callOrdinal: call.ordinal,
          attemptOrdinal: call.attemptOrdinal,
          stage: call.stage,
          providerRequestId: preparedFailure.diagnostic.providerRequestId ?? null,
          providerResponseId: preparedFailure.diagnostic.providerResponseId ?? null,
          evidenceManifestId: preparedFailure.manifestId,
          evidenceState: "pending",
        };
        const failedEvent = createOwnerLearningEvent("review_failed", {
          ownerUserId: review.ownerUserId,
          reviewId: review.id,
          agentProfileId: review.agentProfileId,
          occurredAt: nowIso,
        }, {
          failureCode,
          retryable: false,
          diagnostic: persistedDiagnostic,
        });
        await tx.insert(schema.agentLearningEvents).values({
          id: randomUUID(),
          ownerUserId: failedEvent.ownerUserId,
          reviewId: failedEvent.reviewId,
          agentProfileId: failedEvent.agentProfileId,
          kind: failedEvent.kind,
          payload: failedEvent.payload,
          occurredAt: failedEvent.occurredAt,
        });
        await tx.update(schema.agentLearningReviews).set({
          analysisStatus: "failed",
          safeFailureCode: failureCode,
          retryable: false,
          executionPhase: "provider_invocation",
          leaseTokenHash: null,
          leaseExpiresAt: null,
          capacitySubstatus: null,
          updatedAt: nowIso,
        }).where(and(
          eq(schema.agentLearningReviews.id, review.id),
          inArray(schema.agentLearningReviews.analysisStatus, ["retry_queued", "running"]),
          eq(schema.agentLearningReviews.ownerRetryCount, 1),
          eq(schema.agentLearningReviews.retryTargetAttemptId, call.id),
          sql`${schema.agentLearningReviews.resolvedAt} IS NULL`,
        ));
        cancelActiveRetry = review.analysisStatus === "running";
      }
    }
    return ledger.providerResponse;
  });
  if (cancelActiveRetry) abortActiveOwnerLearningReview(input.reviewId);
  return result;
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
    const review = (await tx.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, input.reviewId)).limit(1))[0];
    if (!review) throw new OwnerLearningWorkerError("call_state_conflict");
    const call = await requireCall(tx, input.reviewId, input.callId);
    const receipts = [...call.transportReceipts];
    const receipt = receipts.at(-1);
    if (
      receipt
      && receipt.ordinal === event.transportOrdinal
      && receipt.attemptedTier === event.attemptedTier
      && receipt.terminalOutcomeAt != null
    ) {
      const isSameOutcome = receipt.terminalHttpStatus === event.httpStatus
        && receipt.terminalOutcomeAt === nowIso
        && receipt.latencyMs === event.latencyMs
        && (receipt.providerRequestId ?? null) === (event.providerRequestId ?? null)
        && (receipt.backoffMs ?? null) === (event.backoffMs ?? null);
      if (isSameOutcome) return;
      throw new OwnerLearningWorkerError("call_state_conflict");
    }
    if (
      !receipt
      || receipt.ordinal !== event.transportOrdinal
      || receipt.attemptedTier !== event.attemptedTier
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
    const updatedCall: CallRow = {
      ...call,
      transportReceipts: receipts,
      flex429Count,
      finalProviderRequestId: event.providerRequestId ?? call.finalProviderRequestId,
    };
    await tx.update(schema.agentLearningReviewCalls).set({
      transportReceipts: updatedCall.transportReceipts,
      flex429Count: updatedCall.flex429Count,
      finalProviderRequestId: updatedCall.finalProviderRequestId,
    }).where(eq(schema.agentLearningReviewCalls.id, call.id));
    const hasSealedFailureEvidence = call.state === "failed"
      || call.state === "ambiguous"
      || call.failureDiagnosticId != null
      || review.analysisStatus === "failed"
      || review.safeFailureCode != null;
    if (hasSealedFailureEvidence) {
      const originalFailureCode = review.safeFailureCode
        ?? ownerLearningSafeFailureCode(call.safeFailureCode);
      const supplementalFailureCode = originalFailureCode == null
        || originalFailureCode === "invalid_structured_output"
        ? "worker_interrupted"
        : originalFailureCode;
      const supplementalError = new Error(
        "Provider terminal transport facts arrived after owner review failure evidence was sealed",
      );
      const diagnostic = createOwnerLearningFailureDiagnostic({
        phase: "provider_invocation",
        failureCode: supplementalFailureCode,
        error: supplementalError,
        errorCode: "late_terminal_outcome_observed",
        callId: updatedCall.id,
        callOrdinal: updatedCall.ordinal,
        attemptOrdinal: updatedCall.attemptOrdinal,
        stage: updatedCall.stage,
        providerRequestId: updatedCall.finalProviderRequestId,
        providerResponseId: updatedCall.providerResponseId,
      });
      const prepared = prepareOwnerLearningReviewFailure({
        review,
        diagnostic,
        call: updatedCall,
        evidence: {
          error: supplementalError,
          protocol: ownerLearningProviderProtocolEvidence(updatedCall),
          additionalEvidence: {
            kind: "late_terminal_outcome_observed",
            terminalOutcome: event,
            mergedTransportReceipts: updatedCall.transportReceipts,
            originalFailureDiagnosticId: call.failureDiagnosticId,
            originalCallState: call.state,
            originalReviewFailureCode: review.safeFailureCode,
          },
        },
        nowIso,
      });
      await enqueueOwnerLearningFailureEvidence(tx, {
        reviewId: review.id,
        call: {
          id: updatedCall.id,
          ordinal: updatedCall.ordinal,
          attemptOrdinal: updatedCall.attemptOrdinal,
        },
        linkCall: false,
        prepared,
      });
      logOwnerLearningException({
        ...diagnostic,
        diagnosticId: prepared.diagnostic.id,
        fingerprint: prepared.diagnostic.fingerprint,
        evidenceManifestId: prepared.manifestId,
      }, supplementalError);
    }
    await tx.update(schema.agentLearningReviews).set({
      capacitySubstatus: event.httpStatus === 429 && event.attemptedTier === "flex"
        ? "waiting_for_capacity"
        : event.attemptedTier === "auto"
          ? "using_standard_capacity"
          : null,
      updatedAt: nowIso,
    }).where(and(
      eq(schema.agentLearningReviews.id, input.reviewId),
      eq(schema.agentLearningReviews.analysisStatus, "running"),
      sql`${schema.agentLearningReviews.resolvedAt} IS NULL`,
      eq(schema.agentLearningReviews.leaseTokenHash, hashLeaseToken(input.leaseToken)),
      gt(schema.agentLearningReviews.leaseExpiresAt, nowIso),
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
    validatedCheckpoint: OwnerLearningCheckpoint;
    providerResponse?: OwnerLearningProviderResponse;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  return db.transaction(async (tx) => {
    await lockReview(tx, input.reviewId);
    const review = await requireActiveLease(tx, input.reviewId, input.leaseToken, nowIso);
    const call = await requireCall(tx, input.reviewId, input.callId);
    if (
      input.validatedCheckpoint.logicalCallCount !== call.ordinal
      || (input.validatedCheckpoint.lastCompletedStage === "complete")
        !== (input.validatedCheckpoint.completion != null)
      || (
        input.validatedCheckpoint.lastCompletedStage !== "complete"
        && input.validatedCheckpoint.lastCompletedStage !== call.stage
      )
      || input.validatedCheckpoint.promptHash
        !== fingerprintOwnerLearningValue(OWNER_LEARNING_PROMPT_VERSION)
      || input.validatedCheckpoint.schemaHash
        !== fingerprintOwnerLearningValue(OWNER_LEARNING_SCHEMA_VERSION)
    ) {
      throw new OwnerLearningWorkerError("call_state_conflict");
    }
    const totalLatencyMs = call.transportReceipts.reduce(
      (total, receipt) => total + (receipt.latencyMs ?? 0),
      0,
    );
    const locallyRecoveredAttempt = call.retryOfAttemptId != null
      && call.transportReceipts.length === 0
      && stagedProviderResponse(call) != null;
    if (!validEffectiveTier(call, input.effectiveTier)) {
      const diagnostic = createOwnerLearningFailureDiagnostic({
        phase: "checkpoint_persistence",
        failureCode: "tier_mismatch",
        error: new Error("Provider response tier did not match the recorded transport attempt"),
        errorCode: "tier_mismatch",
        callId: call.id,
        callOrdinal: call.ordinal,
        attemptOrdinal: call.attemptOrdinal,
        stage: call.stage,
        providerRequestId: call.finalProviderRequestId,
        providerResponseId: input.providerResponse?.providerResponseId,
      });
      const failed = await tx.update(schema.agentLearningReviewCalls).set({
        state: "failed",
        effectiveTier: persistableEffectiveTier(input.effectiveTier),
        ...(!locallyRecoveredAttempt && {
          capacityPath: call.flex429Count === 3 ? "standard_fallback" as const : "flex" as const,
          tokenReceipt: input.tokenReceipt,
          latencyMs: totalLatencyMs,
          costSource: input.costReceipt.costSource,
          actualCostMicrousd: input.costReceipt.actualCostMicrousd ?? null,
          estimatedCostMicrousd: input.costReceipt.estimatedCostMicrousd ?? null,
          pricingSourceId: input.costReceipt.pricingSourceId ?? null,
          rateCardVersion: input.costReceipt.rateCardVersion ?? null,
          pricedAt: input.costReceipt.pricedAt ?? null,
        }),
        safeFailureCode: "tier_mismatch",
        ...persistedProviderResponseReceipt(input.providerResponse),
        completedAt: nowIso,
      }).where(and(
        eq(schema.agentLearningReviewCalls.id, call.id),
        eq(schema.agentLearningReviewCalls.reviewId, input.reviewId),
        inArray(schema.agentLearningReviewCalls.state, ["reserved", "dispatched"]),
      )).returning({ id: schema.agentLearningReviewCalls.id });
      if (failed.length !== 1) throw new OwnerLearningWorkerError("call_state_conflict");
      await failReviewUnderLease(tx, review, "tier_mismatch", false, nowIso, {
        diagnostic,
        call,
        evidence: providerResponseEvidenceContext(
          new Error("Provider response tier did not match the recorded transport attempt"),
          input.providerResponse,
        ),
      });
      return false;
    }
    const succeeded = await tx.update(schema.agentLearningReviewCalls).set({
      state: "succeeded",
      validatedCheckpoint: input.validatedCheckpoint,
      effectiveTier: input.effectiveTier,
      ...(!locallyRecoveredAttempt && {
        capacityPath: call.flex429Count === 3 ? "standard_fallback" as const : "flex" as const,
        tokenReceipt: input.tokenReceipt,
        latencyMs: totalLatencyMs,
        costSource: input.costReceipt.costSource,
        actualCostMicrousd: input.costReceipt.actualCostMicrousd ?? null,
        estimatedCostMicrousd: input.costReceipt.estimatedCostMicrousd ?? null,
        pricingSourceId: input.costReceipt.pricingSourceId ?? null,
        rateCardVersion: input.costReceipt.rateCardVersion ?? null,
        pricedAt: input.costReceipt.pricedAt ?? null,
      }),
      ...persistedProviderResponseReceipt(input.providerResponse),
      completedAt: nowIso,
    }).where(and(
      eq(schema.agentLearningReviewCalls.id, call.id),
      eq(schema.agentLearningReviewCalls.reviewId, input.reviewId),
      inArray(schema.agentLearningReviewCalls.state, ["reserved", "dispatched"]),
    )).returning({ id: schema.agentLearningReviewCalls.id });
    if (succeeded.length !== 1) throw new OwnerLearningWorkerError("call_state_conflict");
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
    evidenceCallId?: string;
    preservedProviderResponse?: OwnerLearningProviderResponse;
    preservedProviderObservation?: OwnerLearningProviderResponseObservation;
    preservedTerminalOutcome?: FlexTransportTerminalOutcome;
    diagnostic?: OwnerLearningFailureDiagnosticSummary;
    evidence?: OwnerLearningFailureEvidenceContext;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  return db.transaction(async (tx) => {
    await lockReview(tx, input.reviewId);
    const review = await requireActiveLease(tx, input.reviewId, input.leaseToken, nowIso);
    const evidenceCallId = input.evidenceCallId ?? input.callId;
    let evidenceCall = evidenceCallId
      ? await requireCall(tx, input.reviewId, evidenceCallId)
      : null;
    const callWithTerminalOutcome = evidenceCall
      ? withCapturedTerminalOutcome(evidenceCall, input.preservedTerminalOutcome)
      : null;
    if (callWithTerminalOutcome) {
      await tx.update(schema.agentLearningReviewCalls).set({
        transportReceipts: callWithTerminalOutcome.transportReceipts,
        flex429Count: callWithTerminalOutcome.flex429Count,
        finalProviderRequestId: callWithTerminalOutcome.finalProviderRequestId,
      }).where(and(
        eq(schema.agentLearningReviewCalls.id, callWithTerminalOutcome.id),
        eq(schema.agentLearningReviewCalls.reviewId, input.reviewId),
      ));
      evidenceCall = callWithTerminalOutcome;
    }
    if (input.callId) {
      const demoteValidatedAttempt = input.failureCode === "internal_error"
        && input.diagnostic?.phase === "checkpoint_persistence";
      await tx.update(schema.agentLearningReviewCalls).set({
        state: "failed",
        ...(demoteValidatedAttempt && { validatedCheckpoint: null }),
        safeFailureCode: input.failureCode,
        completedAt: nowIso,
      }).where(and(
        eq(schema.agentLearningReviewCalls.id, input.callId),
        eq(schema.agentLearningReviewCalls.reviewId, input.reviewId),
        inArray(
          schema.agentLearningReviewCalls.state,
          demoteValidatedAttempt ? ["reserved", "dispatched", "succeeded"] : ["reserved", "dispatched"],
        ),
      ));
    }
    if (input.preservedProviderResponse && evidenceCall) {
      const response = input.preservedProviderResponse;
      if (input.preservedProviderObservation) {
        const ledger = storedResponseLedger(evidenceCall);
        if (!ledger.observations.some((entry) => (
          entry.responseSha256 === input.preservedProviderObservation!.responseSha256
          && entry.responseObservedAt === input.preservedProviderObservation!.responseObservedAt
        ))) {
          ledger.observations.push(input.preservedProviderObservation);
        }
        ledger.providerResponse = providerResponseWithoutTransientCredentials(response);
        const prepared = prepareOwnerLearningDurableValue(ledger, [
          ...(input.preservedProviderObservation.redactionCredentialValues ?? []),
          ...(response.redactionCredentialValues ?? []),
        ]);
        await tx.update(schema.agentLearningReviewCalls).set({
          providerResponseId: response.providerResponseId
            ?? input.preservedProviderObservation.providerResponseId,
          providerResponseObservedAt: response.responseObservedAt
            ?? input.preservedProviderObservation.responseObservedAt,
          providerResponseSha256: response.responseSha256
            ?? input.preservedProviderObservation.responseSha256,
          responseEvidenceBody: prepared.body,
          responseEvidenceBodySha256: prepared.bodySha256,
          responseEvidenceByteLength: prepared.byteLength,
        }).where(and(
          eq(schema.agentLearningReviewCalls.id, evidenceCall.id),
          eq(schema.agentLearningReviewCalls.reviewId, input.reviewId),
          inArray(schema.agentLearningReviewCalls.state, ["reserved", "dispatched", "failed"]),
        ));
      }
      const totalLatencyMs = evidenceCall.transportReceipts.reduce(
        (total, receipt) => total + (receipt.latencyMs ?? 0),
        0,
      );
      await tx.update(schema.agentLearningReviewCalls).set({
        effectiveTier: persistableEffectiveTier(response.effectiveTier),
        capacityPath: evidenceCall.flex429Count === 3 ? "standard_fallback" : "flex",
        tokenReceipt: response.tokenReceipt,
        latencyMs: totalLatencyMs,
        costSource: response.costReceipt.costSource,
        actualCostMicrousd: response.costReceipt.actualCostMicrousd ?? null,
        estimatedCostMicrousd: response.costReceipt.estimatedCostMicrousd ?? null,
        pricingSourceId: response.costReceipt.pricingSourceId ?? null,
        rateCardVersion: response.costReceipt.rateCardVersion ?? null,
        pricedAt: response.costReceipt.pricedAt ?? null,
        ...persistedProviderResponseReceipt(response),
      }).where(and(
        eq(schema.agentLearningReviewCalls.id, evidenceCall.id),
        eq(schema.agentLearningReviewCalls.reviewId, input.reviewId),
        inArray(schema.agentLearningReviewCalls.state, ["reserved", "dispatched", "failed"]),
      ));
      evidenceCall = await requireCall(tx, input.reviewId, evidenceCall.id);
    }
    await failReviewUnderLease(
      tx,
      review,
      input.failureCode,
      input.retryable,
      nowIso,
      {
        diagnostic: input.diagnostic,
        call: evidenceCall,
        evidence: input.evidence ?? { error: new Error(input.failureCode) },
      },
    );
    return true;
  }).catch((error) => {
    if (error instanceof OwnerLearningWorkerError && error.code === "stale_or_invalid_lease") return false;
    throw error;
  });
}

async function failOwnerLearningOutputCall(
  db: DrizzleDB,
  input: {
    reviewId: string;
    callId: string;
    leaseToken: string;
    response: OwnerLearningProviderResponse;
    failureCode: OwnerLearningCallFailureCode;
    diagnostic: OwnerLearningFailureDiagnosticSummary;
    error: unknown;
    decodedOutput?: unknown;
    now: Date;
  },
): Promise<boolean> {
  const nowIso = input.now.toISOString();
  return db.transaction(async (tx) => {
    await lockReview(tx, input.reviewId);
    const review = await requireActiveLease(tx, input.reviewId, input.leaseToken, nowIso);
    const call = await requireCall(tx, input.reviewId, input.callId);
    const effectiveTierValid = validEffectiveTier(call, input.response.effectiveTier);
    const totalLatencyMs = call.transportReceipts.reduce(
      (total, receipt) => total + (receipt.latencyMs ?? 0),
      0,
    );
    const locallyRecoveredAttempt = call.retryOfAttemptId != null
      && call.transportReceipts.length === 0
      && stagedProviderResponse(call) != null;
    const terminalFailureCode: OwnerLearningSafeFailureCode = effectiveTierValid
      ? "invalid_structured_output"
      : "tier_mismatch";
    const diagnostic = effectiveTierValid
      ? input.diagnostic
      : createOwnerLearningFailureDiagnostic({
          phase: "output_validation",
          failureCode: "tier_mismatch",
          error: new Error("Provider response tier did not match the recorded transport attempt"),
          errorCode: "tier_mismatch",
          callId: call.id,
          callOrdinal: call.ordinal,
          attemptOrdinal: call.attemptOrdinal,
          stage: call.stage,
          providerRequestId: call.finalProviderRequestId,
          providerResponseId: input.response.providerResponseId,
        });
    const failed = await tx.update(schema.agentLearningReviewCalls).set({
      state: "failed",
      effectiveTier: persistableEffectiveTier(input.response.effectiveTier),
      ...(!locallyRecoveredAttempt && {
        capacityPath: call.flex429Count === 3 ? "standard_fallback" as const : "flex" as const,
        tokenReceipt: input.response.tokenReceipt,
        latencyMs: totalLatencyMs,
        costSource: input.response.costReceipt.costSource,
        actualCostMicrousd: input.response.costReceipt.actualCostMicrousd ?? null,
        estimatedCostMicrousd: input.response.costReceipt.estimatedCostMicrousd ?? null,
        pricingSourceId: input.response.costReceipt.pricingSourceId ?? null,
        rateCardVersion: input.response.costReceipt.rateCardVersion ?? null,
        pricedAt: input.response.costReceipt.pricedAt ?? null,
      }),
      safeFailureCode: effectiveTierValid ? input.failureCode : "tier_mismatch",
      ...persistedProviderResponseReceipt(input.response),
      completedAt: nowIso,
    }).where(and(
      eq(schema.agentLearningReviewCalls.id, input.callId),
      eq(schema.agentLearningReviewCalls.reviewId, input.reviewId),
      inArray(schema.agentLearningReviewCalls.state, ["reserved", "dispatched"]),
    )).returning({ id: schema.agentLearningReviewCalls.id });
    if (failed.length !== 1) throw new OwnerLearningWorkerError("call_state_conflict");
    await failReviewUnderLease(
      tx,
      review,
      terminalFailureCode,
      effectiveTierValid,
      nowIso,
      {
        diagnostic,
        call,
        evidence: providerResponseEvidenceContext(input.error, input.response, {
          decodedOutput: input.decodedOutput ?? input.response.output,
          validation: input.error instanceof OwnerLearningOutputValidationError
            ? {
                code: input.error.code,
                path: input.error.path,
                message: input.error.message,
              }
            : { code: input.failureCode },
        }),
      },
    );
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
    const noChange = input.result.noChange != null;
    const review = (await tx.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, input.reviewId)).limit(1))[0];
    if (!review) throw new OwnerLearningWorkerError("stale_or_invalid_lease");
    if (review.analysisStatus === (noChange ? "no_change" : "ready")) {
      return review.checkpointHash === input.expectedCheckpointHash
        && review.proposalFingerprint === input.proposalFingerprint
        && fingerprintOwnerLearningValue(review.result) === fingerprintOwnerLearningValue(input.result);
    }
    if (
      review.analysisStatus !== "running"
      || review.resolvedAt != null
      || review.leaseTokenHash !== hashLeaseToken(input.leaseToken)
      || review.leaseExpiresAt == null
      || review.leaseExpiresAt <= nowIso
    ) {
      throw new OwnerLearningWorkerError("stale_or_invalid_lease");
    }
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
  const identity = (await db.select({
    agentProfileId: schema.agentLearningReviews.agentProfileId,
  }).from(schema.agentLearningReviews).where(and(
    eq(schema.agentLearningReviews.id, input.reviewId),
    eq(schema.agentLearningReviews.ownerUserId, input.ownerUserId),
  )).limit(1))[0];
  if (!identity) return false;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM agent_profiles WHERE id = ${identity.agentProfileId} FOR UPDATE`);
    await lockReview(tx, input.reviewId);
    const review = (await tx.select().from(schema.agentLearningReviews).where(and(
      eq(schema.agentLearningReviews.id, input.reviewId),
      eq(schema.agentLearningReviews.ownerUserId, input.ownerUserId),
    )).limit(1))[0];
    const currentProfile = review && review.agentProfileId === identity.agentProfileId
      ? (await tx.select({ currentRevisionId: schema.agentProfiles.currentRevisionId })
        .from(schema.agentProfiles)
        .where(eq(schema.agentProfiles.id, review.agentProfileId))
        .limit(1))[0]
      : null;
    const latestAttempt = review
      ? (await tx.select().from(schema.agentLearningReviewCalls)
        .where(eq(schema.agentLearningReviewCalls.reviewId, review.id))
        .orderBy(
          desc(schema.agentLearningReviewCalls.ordinal),
          desc(schema.agentLearningReviewCalls.attemptOrdinal),
        ).limit(1))[0] ?? null
      : null;
    const stagedRetryOutcome = latestAttempt == null
      ? null
      : stagedProviderOutcome(latestAttempt);
    const stagedRetryIsTerminal = stagedRetryOutcome?.kind === "error"
      ? !stagedRetryOutcome.error.retryable
      : stagedRetryOutcome?.kind === "response"
        ? !validEffectiveTier(latestAttempt!, stagedRetryOutcome.response.effectiveTier)
        : false;
    if (
      !review
      || review.resolvedAt != null
      || review.analysisStatus !== "failed"
      || !review.retryable
      || review.ownerRetryCount !== 0
      || currentProfile?.currentRevisionId !== review.reviewedRevisionId
      || !isCurrentOwnerLearningReviewProtocol(review)
      || !ownerLearningCheckpointIsRetryable(review)
      || !ownerLearningFailureAllowsRetry(review.safeFailureCode)
      || stagedRetryIsTerminal
    ) return false;
    const updated = await tx.update(schema.agentLearningReviews).set({
      // An old worker only recognizes `queued`; the distinct recovery state
      // prevents it from consuming a newly created attempt during blue/green
      // overlap before the old process has drained.
      analysisStatus: "retry_queued",
      safeFailureCode: null,
      retryable: false,
      ownerRetryCount: 1,
      retryTargetAttemptId: latestAttempt?.state === "failed" || latestAttempt?.state === "ambiguous"
        ? latestAttempt.id
        : null,
      leaseTokenHash: null,
      leaseExpiresAt: null,
      capacitySubstatus: null,
      updatedAt: nowIso,
    }).where(and(
      eq(schema.agentLearningReviews.id, input.reviewId),
      eq(schema.agentLearningReviews.analysisStatus, "failed"),
      eq(schema.agentLearningReviews.retryable, true),
      eq(schema.agentLearningReviews.ownerRetryCount, 0),
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
      ownerRetryCount: 1,
      targetCallOrdinal: latestAttempt?.ordinal ?? null,
      targetAttemptOrdinal: latestAttempt?.attemptOrdinal ?? null,
      providerTurnProtocol: OWNER_LEARNING_PROVIDER_PROTOCOL,
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

function ownerLearningCheckpointIsRetryable(review: Pick<ReviewRow,
  "checkpoint" | "logicalCallCount" | "diveCount" | "safeFailureCode" | "executionPhase"
>): boolean {
  const checkpoint = review.checkpoint;
  if (!checkpoint) return review.logicalCallCount <= 1 && review.diveCount <= 1;
  if (!ownerLearningCheckpointHasCoherentShape(checkpoint)) return false;
  const completionCanResumeLocally = checkpoint.completion != null
    && review.safeFailureCode === "internal_error"
    && (review.executionPhase === "checkpoint_persistence" || review.executionPhase === "finalization");
  return (checkpoint.completion == null || completionCanResumeLocally)
    && checkpoint.logicalCallCount <= review.logicalCallCount
    && checkpoint.diveCount <= review.diveCount;
}

function ownerLearningCheckpointHasCoherentShape(checkpoint: OwnerLearningCheckpoint): boolean {
  const stages = new Set<OwnerLearningStage>([
    "evidence_ready",
    "scanning_narratives",
    "investigating_moments",
    "drafting_recommendations",
    "complete",
  ]);
  return checkpoint.version === 1
    && Number.isInteger(checkpoint.logicalCallCount)
    && checkpoint.logicalCallCount >= 0
    && checkpoint.logicalCallCount <= 4
    && Number.isInteger(checkpoint.diveCount)
    && checkpoint.diveCount >= 0
    && checkpoint.diveCount <= 3
    && Number.isInteger(checkpoint.nextMomentCursor)
    && checkpoint.nextMomentCursor >= 0
    && Array.isArray(checkpoint.selectedMomentIds)
    && checkpoint.selectedMomentIds.every((value) => typeof value === "string")
    && Array.isArray(checkpoint.provisionalThemes)
    && checkpoint.provisionalThemes.every((value) => typeof value === "string")
    && Array.isArray(checkpoint.validatedFindings)
    && checkpoint.validatedFindings.every((finding) =>
      finding != null
      && typeof finding === "object"
      && Array.isArray(finding.evidenceRefs)
      && typeof finding.observation === "string"
      && typeof finding.interpretation === "string"
    )
    && stages.has(checkpoint.lastCompletedStage)
    && typeof checkpoint.promptHash === "string"
    && checkpoint.promptHash.length > 0
    && typeof checkpoint.schemaHash === "string"
    && checkpoint.schemaHash.length > 0
    && (
      checkpoint.completion === null
      || (
        typeof checkpoint.completion === "object"
        && checkpoint.completion.result != null
        && typeof checkpoint.completion.result === "object"
        && (
          checkpoint.completion.proposalFingerprint === null
          || typeof checkpoint.completion.proposalFingerprint === "string"
        )
      )
    );
}

function ownerLearningFailureAllowsRetry(
  code: OwnerLearningSafeFailureCode | null,
): boolean {
  return code === "invalid_structured_output"
    || code === "output_budget_exhausted"
    || code === "provider_capacity_exhausted"
    || code === "provider_timeout"
    || code === "provider_error"
    || code === "worker_interrupted"
    || code === "internal_error";
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
    leaseMonitorIntervalMs?: number;
    leaseDurationMs?: number;
    onOutputFailure?: (diagnostic: OwnerLearningOutputFailureDiagnostic) => void;
    faultInjector?: (point: OwnerLearningDurabilityPoint) => void;
    phaseFaultInjector?: (phase: OwnerLearningExecutionPhase) => void;
    receiptPersistenceFaultInjector?: () => void;
  },
): Promise<boolean> {
  const now = options.now ?? (() => new Date());
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? OWNER_LEARNING_LEASE_DURATION_MS / 3;
  const leaseMonitorIntervalMs = options.leaseMonitorIntervalMs
    ?? OWNER_LEARNING_LEASE_MONITOR_INTERVAL_MS;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let leaseMonitorTimer: ReturnType<typeof setTimeout> | null = null;
  let leaseMonitorStopped = false;
  let infrastructureAbortReason: unknown;
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
      }).catch((error) => {
        infrastructureAbortReason = error;
        controller.abort(error);
      });
    }, heartbeatIntervalMs);
  };
  const scheduleLeaseMonitor = () => {
    if (leaseMonitorStopped || controller.signal.aborted) return;
    leaseMonitorTimer = setTimeout(() => {
      void ownsActiveOwnerLearningLease(db, {
        reviewId: claim.reviewId,
        leaseToken: claim.leaseToken,
        now: now(),
      }).then((active) => {
        if (leaseMonitorStopped) return;
        if (!active) {
          controller.abort(new DOMException("Owner learning lease lost", "AbortError"));
          return;
        }
        scheduleLeaseMonitor();
      }).catch((error) => {
        infrastructureAbortReason = error;
        controller.abort(error);
      });
    }, leaseMonitorIntervalMs);
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
    ownerRetryCount: schema.agentLearningReviews.ownerRetryCount,
    retryTargetAttemptId: schema.agentLearningReviews.retryTargetAttemptId,
    eligibilityPolicyVersion: schema.agentLearningReviews.eligibilityPolicyVersion,
    evidenceVersion: schema.agentLearningReviews.evidenceVersion,
    reviewerVersion: schema.agentLearningReviews.reviewerVersion,
    promptVersion: schema.agentLearningReviews.promptVersion,
    schemaVersion: schema.agentLearningReviews.schemaVersion,
    providerPolicyVersion: schema.agentLearningReviews.providerPolicyVersion,
    selectedModel: schema.agentLearningReviews.selectedModel,
    reviewedBehaviorSnapshot: schema.agentRevisions.behaviorSnapshot,
  }).from(schema.agentLearningReviews)
    .innerJoin(schema.agentProfiles, eq(schema.agentLearningReviews.agentProfileId, schema.agentProfiles.id))
    .innerJoin(schema.agentRevisions, eq(schema.agentLearningReviews.reviewedRevisionId, schema.agentRevisions.id))
    .where(eq(schema.agentLearningReviews.id, claim.reviewId)).limit(1))[0];
  if (!review) {
    options.signal?.removeEventListener("abort", abortFromCaller);
    return false;
  }
  if (!isCurrentOwnerLearningReviewProtocol(review)) {
    await failOwnerLearningReview(db, {
      reviewId: review.id,
      leaseToken: claim.leaseToken,
      failureCode: "evidence_unavailable",
      retryable: false,
      now: now(),
    });
    options.signal?.removeEventListener("abort", abortFromCaller);
    return false;
  }
  activeOwnerLearningRuns.get(review.id)?.abort(
    new DOMException("Owner learning review superseded locally", "AbortError"),
  );
  activeOwnerLearningRuns.set(review.id, controller);

  let expectedCheckpointHash = review.checkpointHash;
  const executionPhase: { current: OwnerLearningExecutionPhase } = { current: "selection" };
  const outputValidationCall: { current: ObservedOwnerLearningCall | null } = { current: null };
  const lastProviderCall: typeof outputValidationCall = { current: null };
  const activeCall: { current: ActiveOwnerLearningCallCoordinate | null } = { current: null };
  let reusableStagedResponseCallId: string | null = null;
  let currentInvocationEvidence: Record<string, unknown> | undefined;
  const injectFault = (point: OwnerLearningDurabilityPoint) => {
    try {
      options.faultInjector?.(point);
    } catch (error) {
      throw new OwnerLearningInjectedFault(error);
    }
  };
  const enterPhase = async (phase: OwnerLearningExecutionPhase) => {
    executionPhase.current = phase;
    const phaseNowIso = now().toISOString();
    const persisted = await db.update(schema.agentLearningReviews).set({
      executionPhase: phase,
      updatedAt: phaseNowIso,
    }).where(activeLeaseWhere(review.id, claim.leaseToken, phaseNowIso))
      .returning({ id: schema.agentLearningReviews.id });
    if (persisted.length !== 1) throw new OwnerLearningWorkerError("stale_or_invalid_lease");
    options.phaseFaultInjector?.(phase);
  };
  try {
    scheduleHeartbeat();
    scheduleLeaseMonitor();
    await enterPhase("selection");
    const selectedGames = await db.select({
      gameId: schema.agentLearningReviewGames.gameId,
      gameEvidenceId: schema.agentLearningReviewGames.gameEvidenceId,
    })
      .from(schema.agentLearningReviewGames)
      .where(eq(schema.agentLearningReviewGames.reviewId, claim.reviewId))
      .orderBy(asc(schema.agentLearningReviewGames.position));
    const selection = await validateOwnerLearningSelection(db, {
      ownerUserId: review.ownerUserId,
      agentProfileId: review.agentProfileId,
      gameIds: selectedGames.map((game) => game.gameId),
    });
    if (selection.currentRevisionId !== review.reviewedRevisionId) {
      await failOwnerLearningEvidenceDrift(db, {
        reviewId: review.id,
        leaseToken: claim.leaseToken,
        phase: "selection",
        message: "The reviewed revision is no longer current",
        now: now(),
      });
      return false;
    }
    await enterPhase("evidence_projection");
    const projector = options.projector ?? projectOwnerLearningEvidence;
    const projection = await projector(db, selection, {
      instructions: OWNER_LEARNING_REVIEW_INSTRUCTIONS,
      cursorSecret: options.cursorSecret,
    });
    if (projection.analysisTrack !== review.analysisTrack) {
      await failOwnerLearningEvidenceDrift(db, {
        reviewId: review.id,
        leaseToken: claim.leaseToken,
        now: now(),
      });
      return false;
    }
    await enterPhase("materialization");
    const evidence = await materializeOwnerLearningEvidenceProjection(db, selection, projection);
    const selectedEvidenceIds = new Map(
      selectedGames.map((game) => [game.gameId, game.gameEvidenceId]),
    );
    if (evidence.games.some((game) =>
      game.gameEvidenceId !== selectedEvidenceIds.get(game.gameId)
    )) {
      const rebound = await rebindOwnerLearningEvidenceBeforeFirstCall(db, {
        reviewId: review.id,
        leaseToken: claim.leaseToken,
        evidence,
        now: now(),
      });
      if (!rebound) return false;
    }
    const harnessCounters = await ownerLearningHarnessStartCounters(db, review);
    const harness = await runOwnerLearningHarness({
      reviewId: review.id,
      analysisTrack: review.analysisTrack,
      currentStrategyStyle: reviewedStrategyStyle(review.reviewedBehaviorSnapshot),
      evidence,
      checkpoint: review.checkpoint,
      logicalCallCount: harnessCounters.logicalCallCount,
      diveCount: harnessCounters.diveCount,
      async resumeValidatedTurn(turn) {
        const inputPolicyHash = ownerLearningInputPolicyHash(turn);
        const call = (await db.select().from(schema.agentLearningReviewCalls).where(and(
          eq(schema.agentLearningReviewCalls.reviewId, review.id),
          eq(schema.agentLearningReviewCalls.ordinal, turn.ordinal),
          eq(schema.agentLearningReviewCalls.state, "succeeded"),
        )).limit(1))[0] ?? null;
        if (!call || call.state !== "succeeded") return null;
        if (
          call.stage !== turn.stage
          || call.inputPolicyHash !== inputPolicyHash
          || call.validatedCheckpoint == null
        ) {
          throw new OwnerLearningWorkerError("call_state_conflict");
        }
        return call.validatedCheckpoint;
      },
      async invoke(turn) {
        outputValidationCall.current = null;
        lastProviderCall.current = null;
        activeCall.current = null;
        reusableStagedResponseCallId = null;
        const requestInput = turn.request;
        const inputPolicyHash = ownerLearningInputPolicyHash(turn);
        currentInvocationEvidence = buildOwnerLearningProviderRequest({
          input: requestInput,
          responseSchema: turn.responseSchema,
        }) as unknown as Record<string, unknown>;
        await enterPhase("call_reservation");
        const reservation = await reserveOwnerLearningCall(db, {
          reviewId: review.id,
          leaseToken: claim.leaseToken,
          inputPolicyHash,
          requestEvidence: currentInvocationEvidence,
          stage: turn.stage,
          isDive: turn.isDive,
          now: now(),
        });
        activeCall.current = {
          id: reservation.callId,
          ordinal: reservation.ordinal,
          attemptOrdinal: reservation.attemptOrdinal,
          stage: turn.stage,
        };
        const observer = createOwnerLearningTransportObserver(db, {
          reviewId: review.id,
          callId: reservation.callId,
          leaseToken: claim.leaseToken,
        });
        try {
          await enterPhase("provider_invocation");
          let response = reservation.stagedProviderResponse;
          let persistParsedResponse = false;
          if (response) reusableStagedResponseCallId = reservation.callId;
          if (!response) {
            response = await options.provider.invoke({
              input: requestInput,
              responseSchema: turn.responseSchema,
              diagnosticContext: {
                reviewId: review.id,
                callOrdinal: reservation.ordinal,
              },
              observer,
              resumeTransport: reservation.resumeTransport,
              onResponseObserved: async (observation) => {
                await persistOwnerLearningProviderResponse(db, {
                  reviewId: review.id,
                  callId: reservation.callId,
                  leaseToken: claim.leaseToken,
                  observation,
                  now: now(),
                });
                reusableStagedResponseCallId = reservation.callId;
                injectFault("response_observed");
              },
              signal: controller.signal,
            });
            const observed = normalizeObservedProviderResponse(response, now());
            response = observed.response;
            persistParsedResponse = true;
          }
          const observedCall: ObservedOwnerLearningCall = {
            id: reservation.callId,
            ordinal: reservation.ordinal,
            attemptOrdinal: reservation.attemptOrdinal,
            stage: turn.stage,
            response,
          };
          outputValidationCall.current = observedCall;
          lastProviderCall.current = observedCall;
          if (persistParsedResponse) {
            options.receiptPersistenceFaultInjector?.();
            const observed = normalizeObservedProviderResponse(response, now());
            await persistOwnerLearningProviderResponse(db, {
              reviewId: review.id,
              callId: reservation.callId,
              leaseToken: claim.leaseToken,
              observation: observed.observation,
              providerResponse: response,
              now: now(),
            });
            reusableStagedResponseCallId = reservation.callId;
          }
          await enterPhase("output_validation");
          const decodedOutput = decodeOwnerLearningProviderOutput(response);
          observedCall.decodedOutput = decodedOutput;
          const exactOutput = validateExactStructuredValue(
            turn.responseSchema,
            decodedOutput,
            "Owner learning provider response",
          );
          if (exactOutput.status === "invalid") {
            throw new OwnerLearningOutputValidationError(
              "invalid_turn_contract",
              exactOutput.message,
            );
          }
          return decodedOutput;
        } catch (error) {
          if (error instanceof OwnerLearningProviderError) {
            if (
              error.capture?.responseObservedAt
              && error.capture.responseSha256
              && error.capture.responseEvidence !== undefined
            ) {
              await persistOwnerLearningProviderResponse(db, {
                reviewId: review.id,
                callId: reservation.callId,
                leaseToken: claim.leaseToken,
                observation: {
                  responseObservedAt: error.capture.responseObservedAt,
                  responseSha256: error.capture.responseSha256,
                  responseEvidence: error.capture.responseEvidence,
                  providerResponseId: error.capture.providerResponseId ?? null,
                  redactionCredentialValues: error.capture.redactionCredentialValues,
                },
                now: now(),
              });
            }
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
      async onTurnValidated(turn, checkpoint) {
        const completedCall = outputValidationCall.current;
        if (
          !completedCall
          || completedCall.ordinal !== turn.ordinal
          || completedCall.stage !== turn.stage
        ) {
          throw new OwnerLearningWorkerError("call_state_conflict");
        }
        await enterPhase("checkpoint_persistence");
        const completed = await completeOwnerLearningCall(db, {
          reviewId: review.id,
          callId: completedCall.id,
          leaseToken: claim.leaseToken,
          effectiveTier: completedCall.response.effectiveTier,
          tokenReceipt: completedCall.response.tokenReceipt,
          costReceipt: completedCall.response.costReceipt,
          validatedCheckpoint: checkpoint,
          providerResponse: completedCall.response,
          now: now(),
        });
        if (!completed) throw new OwnerLearningWorkerError("call_state_conflict");
        outputValidationCall.current = null;
        injectFault("validated_call");
      },
      async onCheckpoint(checkpoint) {
        await enterPhase("checkpoint_persistence");
        expectedCheckpointHash = await persistOwnerLearningCheckpoint(db, {
          reviewId: review.id,
          leaseToken: claim.leaseToken,
          expectedCheckpointHash,
          checkpoint,
          now: now(),
        });
        injectFault("checkpoint");
      },
    });
    if (!expectedCheckpointHash) throw new Error("review checkpoint was not persisted");
    await enterPhase("finalization");
    return finalizeOwnerLearningReview(db, {
      reviewId: review.id,
      leaseToken: claim.leaseToken,
      expectedCheckpointHash,
      result: harness.result,
      proposalFingerprint: harness.proposalFingerprint,
      now: now(),
    });
  } catch (error) {
    if (error instanceof OwnerLearningInjectedFault) throw error.injectedCause;
    if (
      executionPhase.current === "selection"
      && error instanceof OwnerLearningEligibilityError
    ) {
      await failOwnerLearningEvidenceDrift(db, {
        reviewId: review.id,
        leaseToken: claim.leaseToken,
        phase: "selection",
        message: error.message,
        error,
        now: now(),
      });
      return false;
    }
    if (error instanceof OwnerLearningProviderError) {
      return false;
    }
    if (
      error instanceof OwnerLearningWorkerError
      && (
        error.code === "stale_or_invalid_lease"
        || error.code === "logical_call_budget_exhausted"
      )
    ) return false;
    if (controller.signal.aborted) {
      if (infrastructureAbortReason !== undefined) {
        const diagnosticCall = lastProviderCall.current ?? activeCall.current;
        const diagnostic = createOwnerLearningFailureDiagnostic({
          phase: executionPhase.current,
          failureCode: "internal_error",
          error: infrastructureAbortReason,
          callId: diagnosticCall?.id,
          callOrdinal: diagnosticCall?.ordinal,
          attemptOrdinal: diagnosticCall?.attemptOrdinal,
          stage: diagnosticCall?.stage,
        });
        await failOwnerLearningReview(db, {
          reviewId: review.id,
          leaseToken: claim.leaseToken,
          failureCode: "internal_error",
          retryable: true,
          callId: activeCall.current?.id,
          evidenceCallId: diagnosticCall?.id,
          diagnostic,
          evidence: {
            error: infrastructureAbortReason,
            requestEvidence: currentInvocationEvidence,
            protocol: OWNER_LEARNING_PROVIDER_PROTOCOL,
            additionalEvidence: { providerCancellation: error },
          },
          now: now(),
        });
        return false;
      }
      const diagnostic = createOwnerLearningFailureDiagnostic({
        phase: executionPhase.current,
        failureCode: "worker_interrupted",
        error,
      });
      await failOwnerLearningReview(db, {
        reviewId: review.id,
        leaseToken: claim.leaseToken,
        failureCode: "worker_interrupted",
        retryable: true,
        diagnostic,
        evidenceCallId: lastProviderCall.current?.id,
        evidence: providerResponseEvidenceContext(error, lastProviderCall.current?.response, {
          decodedOutput: lastProviderCall.current?.decodedOutput,
          requestEvidence: currentInvocationEvidence,
        }),
        now: now(),
      });
      return false;
    }
    const validationCall = outputValidationCall.current;
    let evidenceCall = validationCall ?? lastProviderCall.current;
    let preservedProviderObservation: OwnerLearningProviderResponseObservation | undefined;
    if (
      error instanceof OwnerLearningAttemptPersistenceError
      && evidenceCall == null
      && activeCall.current != null
    ) {
      const recovered = await loadStagedProviderOutcome(
        db,
        review.id,
        activeCall.current.id,
      );
      const capturedObservation = error.capture.responseObservedAt
        && error.capture.responseSha256
        && error.capture.responseEvidence !== undefined
        ? {
            responseObservedAt: error.capture.responseObservedAt,
            responseSha256: error.capture.responseSha256,
            responseEvidence: error.capture.responseEvidence,
            providerResponseId: error.capture.providerResponseId ?? null,
            redactionCredentialValues: error.capture.redactionCredentialValues,
          }
        : undefined;
      const recoveredOutcome = recovered?.outcome ?? (
        capturedObservation && recovered?.call
          ? recoverOwnerLearningProviderResponse(
              capturedObservation,
              error.capture.requestEvidence ?? currentInvocationEvidence,
              {
                attemptedTier: error.terminalOutcome?.attemptedTier
                  ?? recovered.call.transportReceipts.at(-1)?.attemptedTier,
              },
            )
          : null
      );
      if (recoveredOutcome?.kind === "error") {
        const intermediateFlexCapacity = recoveredOutcome.error.code
          === "provider_capacity_exhausted"
          && (error.terminalOutcome?.attemptedTier
            ?? recovered?.call.transportReceipts.at(-1)?.attemptedTier) === "flex";
        if (!intermediateFlexCapacity && recovered?.call) {
          await failProviderCall(db, {
            reviewId: review.id,
            callId: recovered.call.id,
            leaseToken: claim.leaseToken,
            error: recoveredOutcome.error,
            persistenceError: error,
            now: now(),
          });
          return false;
        }
      }
      if (recoveredOutcome?.kind === "response") {
        evidenceCall = {
          ...activeCall.current,
          response: recoveredOutcome.response,
        };
        lastProviderCall.current = evidenceCall;
        preservedProviderObservation = capturedObservation;
      }
    }
    const persistenceCapture = error instanceof OwnerLearningAttemptPersistenceError
      ? error.capture
      : undefined;
    const diagnosticCall = evidenceCall ?? activeCall.current;
    const isStructuredOutputFailure = executionPhase.current === "output_validation"
      && validationCall != null
      && error instanceof OwnerLearningOutputValidationError
      && validationCall.response.responseObservedAt != null
      && validationCall.response.responseSha256 != null
      && validationCall.response.responseEvidence !== undefined;
    const failureCode: OwnerLearningSafeFailureCode = isStructuredOutputFailure
      ? "invalid_structured_output"
      : "internal_error";
    const outputFailureCode = error instanceof OwnerLearningOutputValidationError
      ? error.code
      : "unclassified_output_failure";
    const diagnostic = createOwnerLearningFailureDiagnostic({
      phase: executionPhase.current,
      failureCode,
      error,
      errorCode: error instanceof OwnerLearningOutputValidationError
        ? outputFailureCode
        : undefined,
      callId: diagnosticCall?.id,
      callOrdinal: diagnosticCall?.ordinal,
      attemptOrdinal: diagnosticCall?.attemptOrdinal,
      stage: diagnosticCall?.stage,
      providerResponseId: evidenceCall?.response.providerResponseId
        ?? persistenceCapture?.providerResponseId,
      providerRequestId: error instanceof OwnerLearningAttemptPersistenceError
        ? error.terminalOutcome?.providerRequestId
        : undefined,
    });
    if (isStructuredOutputFailure && validationCall) {
      const outputDiagnostic: OwnerLearningOutputFailureDiagnostic = {
        reviewId: review.id,
        callOrdinal: validationCall.ordinal,
        stage: validationCall.stage,
        code: outputFailureCode,
      };
      (options.onOutputFailure ?? logOwnerLearningOutputFailure)(outputDiagnostic);
      await failOwnerLearningOutputCall(db, {
        reviewId: review.id,
        callId: validationCall.id,
        leaseToken: claim.leaseToken,
        response: validationCall.response,
        failureCode: outputFailureCode,
        diagnostic,
        error,
        decodedOutput: validationCall.decodedOutput,
        now: now(),
      });
    } else {
      const preserveStagedResponse = evidenceCall != null && (
        reusableStagedResponseCallId === diagnosticCall?.id
        || preservedProviderObservation != null
      );
      await failOwnerLearningReview(db, {
        reviewId: review.id,
        leaseToken: claim.leaseToken,
        failureCode: "internal_error",
        retryable: true,
        callId: diagnosticCall?.id,
        evidenceCallId: diagnosticCall?.id,
        preservedProviderResponse: preserveStagedResponse && evidenceCall
          ? evidenceCall.response
          : undefined,
        preservedProviderObservation: preserveStagedResponse
          ? preservedProviderObservation
          : undefined,
        preservedTerminalOutcome: error instanceof OwnerLearningAttemptPersistenceError
          ? error.terminalOutcome
          : undefined,
        diagnostic,
        evidence: persistenceCapture
          ? {
              error,
              requestEvidence: persistenceCapture.requestEvidence ?? currentInvocationEvidence,
              responseEvidence: persistenceCapture.responseEvidence,
              redactionCredentialValues: persistenceCapture.redactionCredentialValues,
              responseObservedAt: persistenceCapture.responseObservedAt,
              protocol: OWNER_LEARNING_PROVIDER_PROTOCOL,
            }
          : providerResponseEvidenceContext(error, evidenceCall?.response, {
              decodedOutput: evidenceCall?.decodedOutput,
              requestEvidence: currentInvocationEvidence,
              validation: error instanceof OwnerLearningOutputValidationError
                ? { code: error.code, path: error.path, message: error.message }
                : undefined,
            }),
        now: now(),
      });
    }
    return false;
  } finally {
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    leaseMonitorStopped = true;
    if (leaseMonitorTimer) clearTimeout(leaseMonitorTimer);
    await releaseResolvedOwnerLearningLease(db, {
      reviewId: review.id,
      leaseToken: claim.leaseToken,
      now: now(),
    });
    if (activeOwnerLearningRuns.get(review.id) === controller) {
      activeOwnerLearningRuns.delete(review.id);
    }
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function isCurrentOwnerLearningReviewProtocol(review: {
  eligibilityPolicyVersion: string;
  evidenceVersion: string;
  reviewerVersion: string;
  promptVersion: string;
  schemaVersion: string;
  providerPolicyVersion: string;
  selectedModel: string;
}): boolean {
  return review.eligibilityPolicyVersion === OWNER_LEARNING_ELIGIBILITY_POLICY_VERSION
    && review.evidenceVersion === OWNER_LEARNING_EVIDENCE_VERSION
    && review.reviewerVersion === OWNER_LEARNING_REVIEWER_VERSION
    && review.promptVersion === OWNER_LEARNING_PROMPT_VERSION
    && review.schemaVersion === OWNER_LEARNING_SCHEMA_VERSION
    && review.providerPolicyVersion === OWNER_LEARNING_PROVIDER_POLICY_VERSION
    && review.selectedModel === OWNER_LEARNING_MODEL;
}

function ownerLearningInputPolicyHash(turn: OwnerLearningHarnessInvocation): string {
  return fingerprintOwnerLearningRequest({
    model: "gpt-5.6-luna",
    input: turn.request,
    responseSchema: turn.responseSchema,
    maxOutputTokens: OWNER_LEARNING_MAX_OUTPUT_TOKENS,
    reasoning: { effort: "low" },
    store: false,
    serviceTier: "flex",
  });
}

function reviewedStrategyStyle(snapshot: Record<string, unknown>): string | null {
  const value = snapshot.strategyInstructions;
  if (value === null || typeof value === "string") return value;
  throw new Error("Reviewed agent revision is missing strategyInstructions");
}

export function classifyOwnerLearningOutputFailure(error: unknown): OwnerLearningOutputFailureCode {
  return error instanceof OwnerLearningOutputValidationError
    ? error.code
    : "unclassified_output_failure";
}

function logOwnerLearningOutputFailure(diagnostic: OwnerLearningOutputFailureDiagnostic): void {
  console.error(
    `[owner-learning] post-response review failure ${JSON.stringify(diagnostic)}`,
  );
}

function logOwnerLearningException(
  diagnostic: OwnerLearningFailureDiagnosticSummary,
  error: unknown,
): void {
  console.error(
    `[owner-learning] review execution failure ${JSON.stringify({
      diagnosticId: diagnostic.diagnosticId,
      phase: diagnostic.phase,
      failureCode: diagnostic.failureCode,
      fingerprint: diagnostic.fingerprint,
      evidenceManifestId: diagnostic.evidenceManifestId,
    })}`,
    JSON.stringify(sanitizeOwnerLearningFailureExceptionForLog(error)),
  );
}

export interface OwnerLearningWorkerLoop {
  stop(): Promise<void>;
  readonly stopped: boolean;
}

export function startOwnerLearningWorkerLoop(
  db: DrizzleDB,
  options: {
    provider: OwnerLearningProvider;
    projector?: OwnerLearningEvidenceProjector;
    cursorSecret?: string;
    pollIntervalMs?: number;
    canClaimWork?: () => boolean;
  },
): OwnerLearningWorkerLoop {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let idlePromise = Promise.resolve();
  let resolveIdle: (() => void) | null = null;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;

  const schedule = (delayMs: number) => {
    if (controller.signal.aborted) return;
    timer = setTimeout(() => { void tick(); }, delayMs);
  };
  const tick = async () => {
    if (running || controller.signal.aborted) return;
    if (options.canClaimWork && !options.canClaimWork()) {
      schedule(pollIntervalMs);
      return;
    }
    running = true;
    idlePromise = new Promise<void>((resolve) => {
      resolveIdle = resolve;
    });
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
        console.error(
          "[owner-learning] Worker iteration failed",
          sanitizeOwnerLearningFailureExceptionForLog(error),
        );
        schedule(pollIntervalMs);
      }
    } finally {
      running = false;
      resolveIdle?.();
      resolveIdle = null;
    }
  };
  schedule(0);
  return {
    stop() {
      controller.abort(new DOMException("Owner learning worker stopped", "AbortError"));
      if (timer) clearTimeout(timer);
      timer = null;
      return idlePromise;
    },
    get stopped() {
      return controller.signal.aborted;
    },
  };
}

export interface OwnerLearningFailureReconciliationLoop {
  stop(): Promise<void>;
  readonly stopped: boolean;
}

export function startOwnerLearningFailureReconciliationLoop(
  db: DrizzleDB,
  options: {
    pollIntervalMs?: number;
    canClaimWork?: () => boolean;
    reconcile?: () => Promise<unknown>;
  } = {},
): OwnerLearningFailureReconciliationLoop {
  const controller = new AbortController();
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let idlePromise = Promise.resolve();
  let resolveIdle: (() => void) | null = null;
  const schedule = (delayMs: number) => {
    if (controller.signal.aborted) return;
    timer = setTimeout(() => { void tick(); }, delayMs);
  };
  const tick = async () => {
    if (running || controller.signal.aborted) return;
    if (options.canClaimWork && !options.canClaimWork()) {
      schedule(pollIntervalMs);
      return;
    }
    running = true;
    idlePromise = new Promise<void>((resolve) => {
      resolveIdle = resolve;
    });
    try {
      // One bounded upload per iteration keeps its 30-second claim comfortably
      // beyond the 15-second storage deadline.
      await (options.reconcile?.() ?? reconcileOwnerLearningFailureEvidence(db, { limit: 1 }));
    } catch (error) {
      console.error(
        "[owner-learning] Failure evidence reconciliation failed",
        sanitizeOwnerLearningFailureExceptionForLog(error),
      );
    } finally {
      running = false;
      resolveIdle?.();
      resolveIdle = null;
      schedule(pollIntervalMs);
    }
  };
  schedule(0);
  return {
    stop() {
      controller.abort(new DOMException("Owner learning evidence reconciliation stopped", "AbortError"));
      if (timer) clearTimeout(timer);
      timer = null;
      return idlePromise;
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
    persistenceError?: OwnerLearningAttemptPersistenceError;
    now: Date;
  },
): Promise<void> {
  const nowIso = input.now.toISOString();
  await db.transaction(async (tx) => {
    await lockReview(tx, input.reviewId);
    const review = await requireActiveLease(tx, input.reviewId, input.leaseToken, nowIso);
    const storedCall = await requireCall(tx, input.reviewId, input.callId);
    const terminalOutcome = input.persistenceError?.terminalOutcome;
    const recoveredCall = withCapturedTerminalOutcome(storedCall, terminalOutcome);
    const call = recoveredCall ?? storedCall;
    const correlatedError = input.persistenceError
      ? correlatedProviderPersistenceError(input.error, input.persistenceError)
      : input.error;
    const diagnostic = createOwnerLearningFailureDiagnostic({
      phase: "provider_invocation",
      failureCode: input.error.code,
      error: input.error,
      errorCode: input.error.internalCode,
      callId: call.id,
      callOrdinal: call.ordinal,
      attemptOrdinal: call.attemptOrdinal,
      stage: call.stage,
      providerRequestId: terminalOutcome?.providerRequestId ?? call.finalProviderRequestId,
      providerResponseId: input.error.capture?.providerResponseId,
    });
    await tx.update(schema.agentLearningReviewCalls).set({
      state: "failed",
      ...(recoveredCall && {
        transportReceipts: call.transportReceipts,
        flex429Count: call.flex429Count,
        finalProviderRequestId: call.finalProviderRequestId,
      }),
      effectiveTier: persistableEffectiveTier(input.error.effectiveTier),
      tokenReceipt: input.error.tokenReceipt ?? null,
      costSource: input.error.costReceipt?.costSource ?? "unavailable",
      actualCostMicrousd: input.error.costReceipt?.actualCostMicrousd ?? null,
      estimatedCostMicrousd: input.error.costReceipt?.estimatedCostMicrousd ?? null,
      pricingSourceId: input.error.costReceipt?.pricingSourceId ?? null,
      rateCardVersion: input.error.costReceipt?.rateCardVersion ?? null,
      pricedAt: input.error.costReceipt?.pricedAt ?? null,
      safeFailureCode: input.error.code,
      ...persistedProviderResponseReceipt(input.error.capture),
      completedAt: nowIso,
    }).where(and(
      eq(schema.agentLearningReviewCalls.id, input.callId),
      eq(schema.agentLearningReviewCalls.reviewId, input.reviewId),
      inArray(schema.agentLearningReviewCalls.state, ["reserved", "dispatched"]),
    ));
    await failReviewUnderLease(
      tx,
      review,
      input.error.code,
      input.error.retryable,
      nowIso,
      {
        diagnostic,
        call,
        evidence: {
          error: correlatedError,
          requestEvidence: input.error.capture?.requestEvidence,
          responseEvidence: input.error.capture?.responseEvidence,
          redactionCredentialValues: input.error.capture?.redactionCredentialValues,
          responseObservedAt: input.error.capture?.responseObservedAt,
          tokenReceipt: input.error.tokenReceipt,
          costReceipt: input.error.costReceipt,
          protocol: ownerLearningProviderProtocolEvidence(call),
          additionalEvidence: terminalOutcome
            ? { terminalOutcome, terminalReceiptRecovered: recoveredCall != null }
            : undefined,
        },
      },
    );
  });
}

function correlatedProviderPersistenceError(
  providerError: OwnerLearningProviderError,
  persistenceError: OwnerLearningAttemptPersistenceError,
): Error {
  return Object.assign(
    new Error("A terminal provider outcome and its persistence failure were observed together", {
      cause: persistenceError,
    }),
    {
      name: "OwnerLearningProviderPersistenceFailure",
      providerError,
    },
  );
}

async function releaseResolvedOwnerLearningLease(
  db: DrizzleDB,
  input: { reviewId: string; leaseToken: string; now: Date },
): Promise<void> {
  const nowIso = input.now.toISOString();
  await db.update(schema.agentLearningReviews).set({
    leaseTokenHash: null,
    leaseExpiresAt: null,
    capacitySubstatus: null,
    updatedAt: nowIso,
  }).where(and(
    eq(schema.agentLearningReviews.id, input.reviewId),
    sql`${schema.agentLearningReviews.resolvedAt} IS NOT NULL`,
    eq(schema.agentLearningReviews.leaseTokenHash, hashLeaseToken(input.leaseToken)),
  ));
}

type ReviewTx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
type ReviewRow = typeof schema.agentLearningReviews.$inferSelect;
type CallRow = typeof schema.agentLearningReviewCalls.$inferSelect;

function withCapturedTerminalOutcome(
  call: CallRow,
  event: FlexTransportTerminalOutcome | undefined,
): CallRow | null {
  if (!event) return null;
  const transportReceipts = [...call.transportReceipts];
  const latestReceipt = transportReceipts.at(-1);
  if (
    !latestReceipt
    || latestReceipt.ordinal !== event.transportOrdinal
    || latestReceipt.attemptedTier !== event.attemptedTier
    || latestReceipt.terminalOutcomeAt != null
  ) return null;
  transportReceipts[transportReceipts.length - 1] = {
    ...latestReceipt,
    terminalHttpStatus: event.httpStatus,
    terminalOutcomeAt: new Date(event.completedAtMs).toISOString(),
    latencyMs: event.latencyMs,
    ...(event.providerRequestId ? { providerRequestId: event.providerRequestId } : {}),
    ...(event.backoffMs !== undefined ? { backoffMs: event.backoffMs } : {}),
  };
  return {
    ...call,
    transportReceipts,
    flex429Count: transportReceipts.filter((receipt) =>
      receipt.attemptedTier === "flex" && receipt.terminalHttpStatus === 429
    ).length,
    finalProviderRequestId: event.providerRequestId ?? call.finalProviderRequestId,
  };
}

async function failOwnerLearningEvidenceDrift(
  db: DrizzleDB,
  input: {
    reviewId: string;
    leaseToken: string;
    phase?: OwnerLearningExecutionPhase;
    message?: string;
    error?: unknown;
    now: Date;
  },
): Promise<boolean> {
  const nowIso = input.now.toISOString();
  return db.transaction(async (tx) => {
    await lockReview(tx, input.reviewId);
    const review = await requireActiveLease(tx, input.reviewId, input.leaseToken, nowIso);
    await failOwnerLearningEvidenceDriftUnderLease(tx, review, nowIso, input);
    return true;
  }).catch((error) => {
    if (error instanceof OwnerLearningWorkerError && error.code === "stale_or_invalid_lease") {
      return false;
    }
    throw error;
  });
}

async function failOwnerLearningEvidenceDriftUnderLease(
  tx: ReviewTx,
  review: ReviewRow,
  nowIso: string,
  input: { phase?: OwnerLearningExecutionPhase; message?: string; error?: unknown } = {},
): Promise<void> {
  const call = (await tx.select().from(schema.agentLearningReviewCalls)
    .where(eq(schema.agentLearningReviewCalls.reviewId, review.id))
    .orderBy(
      desc(schema.agentLearningReviewCalls.ordinal),
      desc(schema.agentLearningReviewCalls.attemptOrdinal),
    )
    .limit(1))[0] ?? null;
  if (call && (call.state === "reserved" || call.state === "dispatched")) {
    await tx.update(schema.agentLearningReviewCalls).set({
      state: "failed",
      safeFailureCode: "evidence_unavailable",
      completedAt: nowIso,
    }).where(and(
      eq(schema.agentLearningReviewCalls.id, call.id),
      inArray(schema.agentLearningReviewCalls.state, ["reserved", "dispatched"]),
    ));
  }
  const error = input.error ?? new Error(
    input.message ?? "Owner review evidence no longer matches its durable selection",
  );
  const diagnostic = createOwnerLearningFailureDiagnostic({
    phase: input.phase ?? "evidence_projection",
    failureCode: "evidence_unavailable",
    error,
    callId: call?.id,
    callOrdinal: call?.ordinal,
    attemptOrdinal: call?.attemptOrdinal,
    stage: call?.stage,
    providerRequestId: call?.finalProviderRequestId,
    providerResponseId: call?.providerResponseId,
  });
  await failReviewUnderLease(tx, review, "evidence_unavailable", false, nowIso, {
    diagnostic,
    call,
    evidence: {
      error,
      protocol: ownerLearningProviderProtocolEvidence(call),
    },
  });
}

async function rebindOwnerLearningEvidenceBeforeFirstCall(
  db: DrizzleDB,
  input: {
    reviewId: string;
    leaseToken: string;
    evidence: OwnerLearningMaterializedEvidenceProjection;
    now: Date;
  },
): Promise<boolean> {
  const nowIso = input.now.toISOString();
  return db.transaction(async (tx) => {
    await lockReview(tx, input.reviewId);
    const review = await requireActiveLease(tx, input.reviewId, input.leaseToken, nowIso);
    const call = (await tx.select({
      id: schema.agentLearningReviewCalls.id,
      state: schema.agentLearningReviewCalls.state,
    })
      .from(schema.agentLearningReviewCalls)
      .where(eq(schema.agentLearningReviewCalls.reviewId, input.reviewId))
      .orderBy(
        desc(schema.agentLearningReviewCalls.ordinal),
        desc(schema.agentLearningReviewCalls.attemptOrdinal),
      )
      .limit(1))[0] ?? null;
    const checkpoint = review.checkpoint;
    if (
      call
      || review.stage !== "evidence_ready"
      || review.logicalCallCount !== 0
      || review.diveCount !== 0
      || (checkpoint != null && (
        checkpoint.logicalCallCount !== 0
        || checkpoint.diveCount !== 0
        || checkpoint.selectedMomentIds.length !== 0
        || checkpoint.nextMomentCursor !== 0
        || checkpoint.provisionalThemes.length !== 0
        || checkpoint.validatedFindings.length !== 0
        || checkpoint.lastCompletedStage !== "evidence_ready"
        || checkpoint.promptHash !== fingerprintOwnerLearningValue(OWNER_LEARNING_PROMPT_VERSION)
        || checkpoint.schemaHash !== fingerprintOwnerLearningValue(OWNER_LEARNING_SCHEMA_VERSION)
        || checkpoint.completion != null
      ))
    ) {
      await failOwnerLearningEvidenceDriftUnderLease(tx, review, nowIso);
      return false;
    }

    const boundGames = await tx.select({
      gameId: schema.agentLearningReviewGames.gameId,
    }).from(schema.agentLearningReviewGames)
      .where(eq(schema.agentLearningReviewGames.reviewId, input.reviewId));
    if (
      boundGames.length !== input.evidence.games.length
      || input.evidence.games.some((game) =>
        !boundGames.some((bound) => bound.gameId === game.gameId)
      )
    ) {
      await failOwnerLearningEvidenceDriftUnderLease(tx, review, nowIso);
      return false;
    }

    for (const game of input.evidence.games) {
      const updated = await tx.update(schema.agentLearningReviewGames).set({
        gameEvidenceId: game.gameEvidenceId,
      }).where(and(
        eq(schema.agentLearningReviewGames.reviewId, input.reviewId),
        eq(schema.agentLearningReviewGames.gameId, game.gameId),
      )).returning({ gameId: schema.agentLearningReviewGames.gameId });
      if (updated.length !== 1) throw new OwnerLearningWorkerError("call_state_conflict");
    }
    return true;
  });
}

async function ownerLearningHarnessStartCounters(
  db: DrizzleDB,
  review: Pick<ReviewRow,
    "id" | "logicalCallCount" | "diveCount" | "checkpoint" | "retryTargetAttemptId"
  >,
): Promise<{ logicalCallCount: number; diveCount: number }> {
  const latest = (await db.select().from(schema.agentLearningReviewCalls)
    .where(eq(schema.agentLearningReviewCalls.reviewId, review.id))
    .orderBy(
      desc(schema.agentLearningReviewCalls.ordinal),
      desc(schema.agentLearningReviewCalls.attemptOrdinal),
    ).limit(1))[0] ?? null;
  const checkpointCounters = review.checkpoint
    ? {
        logicalCallCount: review.checkpoint.logicalCallCount,
        diveCount: review.checkpoint.diveCount,
      }
    : null;
  if (
    checkpointCounters
    && review.retryTargetAttemptId != null
  ) {
    return checkpointCounters;
  }
  if (
    checkpointCounters
    && (!latest || latest.ordinal <= checkpointCounters.logicalCallCount)
  ) {
    return checkpointCounters;
  }
  if (latest && review.retryTargetAttemptId === latest.id) {
    return {
      logicalCallCount: Math.max(0, review.logicalCallCount - 1),
      diveCount: Math.max(
        0,
        review.diveCount - (latest.stage === "investigating_moments" ? 1 : 0),
      ),
    };
  }
  if (
    !latest
    || (!isResumableCall(latest) && !(latest.state === "succeeded" && latest.validatedCheckpoint != null))
  ) {
    return { logicalCallCount: review.logicalCallCount, diveCount: review.diveCount };
  }
  if (checkpointCounters) return checkpointCounters;
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
    .orderBy(
      desc(schema.agentLearningReviewCalls.ordinal),
      desc(schema.agentLearningReviewCalls.attemptOrdinal),
    ).limit(1))[0] ?? null;
  const lastReceipt = latest?.transportReceipts.at(-1);
  if (
    latest?.state === "dispatched"
    && lastReceipt?.attemptedTier === "flex"
    && lastReceipt.terminalHttpStatus === 429
  ) {
    return "resumable";
  }
  const recoveredOutcome = latest?.responseEvidenceBody
    ? stagedProviderOutcome(latest)
    : null;
  if (recoveredOutcome?.kind === "response") return "resumable";
  if (latest && recoveredOutcome?.kind === "error") {
    const error = recoveredOutcome.error;
    await tx.update(schema.agentLearningReviewCalls).set({
      state: "failed",
      effectiveTier: persistableEffectiveTier(error.effectiveTier),
      tokenReceipt: error.tokenReceipt ?? null,
      costSource: error.costReceipt?.costSource ?? "unavailable",
      actualCostMicrousd: error.costReceipt?.actualCostMicrousd ?? null,
      estimatedCostMicrousd: error.costReceipt?.estimatedCostMicrousd ?? null,
      pricingSourceId: error.costReceipt?.pricingSourceId ?? null,
      rateCardVersion: error.costReceipt?.rateCardVersion ?? null,
      pricedAt: error.costReceipt?.pricedAt ?? null,
      safeFailureCode: error.code,
      ...persistedProviderResponseReceipt(error.capture),
      completedAt: nowIso,
    }).where(and(
      eq(schema.agentLearningReviewCalls.id, latest.id),
      inArray(schema.agentLearningReviewCalls.state, ["reserved", "dispatched"]),
    ));
    const review = (await tx.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)).limit(1))[0];
    if (review) {
      const diagnostic = createOwnerLearningFailureDiagnostic({
        phase: "provider_invocation",
        failureCode: error.code,
        error,
        errorCode: error.internalCode,
        callId: latest.id,
        callOrdinal: latest.ordinal,
        attemptOrdinal: latest.attemptOrdinal,
        stage: latest.stage,
        providerRequestId: latest.finalProviderRequestId,
        providerResponseId: error.capture?.providerResponseId ?? latest.providerResponseId,
      });
      await failReviewUnderLease(tx, review, error.code, error.retryable, nowIso, {
        diagnostic,
        call: latest,
        evidence: {
          error,
          requestEvidence: error.capture?.requestEvidence,
          responseEvidence: error.capture?.responseEvidence,
          responseObservedAt: error.capture?.responseObservedAt,
          tokenReceipt: error.tokenReceipt,
          costReceipt: error.costReceipt,
          protocol: ownerLearningProviderProtocolEvidence(latest),
        },
      });
    }
    return "failed";
  }
  if (!latest || latest.state === "reserved" || latest.state === "succeeded" || latest.state === "failed") {
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
  if (review) {
    const diagnostic = createOwnerLearningFailureDiagnostic({
      phase: review.executionPhase ?? "provider_invocation",
      failureCode,
      error: new Error("Owner review worker lease expired during a provider attempt"),
      callId: latest.id,
      callOrdinal: latest.ordinal,
      attemptOrdinal: latest.attemptOrdinal,
      stage: latest.stage,
      providerRequestId: latest.finalProviderRequestId,
      providerResponseId: latest.providerResponseId,
    });
    await failReviewUnderLease(tx, review, failureCode, true, nowIso, {
      diagnostic,
      call: latest,
      evidence: {
        error: new Error("Owner review worker lease expired during a provider attempt"),
        protocol: ownerLearningProviderProtocolEvidence(latest),
        additionalEvidence: { lastTransportReceipt: lastReceipt },
      },
    });
  }
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
  if (
    (call.state === "reserved" || call.state === "dispatched")
    && call.responseEvidenceBody
    && stagedProviderResponse(call)
  ) return true;
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
  const stagedResponse = stagedProviderResponse(call);
  return {
    callId: call.id,
    ordinal: call.ordinal,
    attemptOrdinal: call.attemptOrdinal,
    reused: true,
    ...(stagedResponse && { stagedProviderResponse: stagedResponse }),
    resumeTransport: {
      flex429Count: call.flex429Count,
      nextTransportOrdinal: call.transportReceipts.length + 1,
      nextTier: expectedNextTier(call.flex429Count),
      initialBackoffMs,
    },
  };
}

function stagedProviderResponse(call: CallRow): OwnerLearningProviderResponse | null {
  const outcome = stagedProviderOutcome(call);
  return outcome?.kind === "response" ? outcome.response : null;
}

function stagedProviderOutcome(
  call: CallRow,
): ReturnType<typeof recoverOwnerLearningProviderResponse> {
  const ledger = storedResponseLedger(call);
  if (ledger.providerResponse) return { kind: "response", response: ledger.providerResponse };
  const requestEvidence = durableCallEvidence(call.requestEvidenceBody);
  const attemptedTier = call.transportReceipts.at(-1)?.attemptedTier;
  for (const observation of ledger.observations.toReversed()) {
    const recovered = recoverOwnerLearningProviderResponse(
      observation,
      requestEvidence,
      { attemptedTier },
    );
    if (recovered) return recovered;
  }
  return null;
}

function terminalStagedRetryOutcome(call: CallRow): {
  failureCode: OwnerLearningSafeFailureCode;
  error: Error;
  response?: OwnerLearningProviderResponse;
} | null {
  const outcome = stagedProviderOutcome(call);
  if (outcome?.kind === "error" && !outcome.error.retryable) {
    return {
      failureCode: outcome.error.code,
      error: outcome.error,
    };
  }
  if (outcome?.kind === "response" && !validEffectiveTier(call, outcome.response.effectiveTier)) {
    return {
      failureCode: "tier_mismatch",
      error: new Error("A staged provider response reported a tier inconsistent with its recorded dispatch"),
      response: outcome.response,
    };
  }
  return null;
}

async function loadStagedProviderOutcome(
  db: DrizzleDB,
  reviewId: string,
  callId: string,
): Promise<{
  call: CallRow;
  outcome: ReturnType<typeof stagedProviderOutcome>;
} | null> {
  const call = (await db.select().from(schema.agentLearningReviewCalls).where(and(
    eq(schema.agentLearningReviewCalls.id, callId),
    eq(schema.agentLearningReviewCalls.reviewId, reviewId),
  )).limit(1))[0] ?? null;
  if (!call) return null;
  const outcome = stagedProviderOutcome(call);
  return { call, outcome };
}

function expectedNextTier(flex429Count: number): "flex" | "auto" {
  return flex429Count >= 3 ? "auto" : "flex";
}

function validEffectiveTier(call: CallRow, effectiveTier: string): boolean {
  const last = call.transportReceipts.at(-1);
  const terminalReceiptObserved = last?.terminalHttpStatus != null
    && last.terminalHttpStatus >= 200
    && last.terminalHttpStatus < 300;
  const rawResponseObserved = stagedProviderResponse(call) != null;
  if (!last) {
    return call.retryOfAttemptId != null
      && rawResponseObserved
      && call.effectiveTier === effectiveTier;
  }
  if (!terminalReceiptObserved && !rawResponseObserved) return false;
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

function persistedProviderResponseReceipt(response: {
  providerResponseId?: string | null;
  responseObservedAt?: string;
  responseSha256?: string;
} | null | undefined): Partial<Pick<CallRow,
  "providerResponseId" | "providerResponseObservedAt" | "providerResponseSha256"
>> {
  if (!response?.responseObservedAt || !response.responseSha256) {
    return {};
  }
  return {
    providerResponseId: response.providerResponseId ?? null,
    providerResponseObservedAt: response.responseObservedAt,
    providerResponseSha256: response.responseSha256,
  };
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

function ownerLearningProviderProtocolEvidence(call: CallRow | null): Record<string, unknown> {
  return {
    providerTurnProtocol: OWNER_LEARNING_PROVIDER_PROTOCOL,
    ...(call && {
      callId: call.id,
      logicalOrdinal: call.ordinal,
      attemptOrdinal: call.attemptOrdinal,
      inputPolicyHash: call.inputPolicyHash,
      providerTurnProtocol: call.providerTurnProtocol,
      retryOfExecutionFingerprint: call.retryOfExecutionFingerprint,
      requestedTier: call.requestedTier,
      requestedReasoningEffort: call.requestedReasoningEffort,
    }),
  };
}

function providerResponseEvidenceContext(
  error: unknown,
  response: OwnerLearningProviderResponse | undefined,
  extra: Pick<
    OwnerLearningFailureEvidenceContext,
    "decodedOutput" | "validation" | "requestEvidence" | "additionalEvidence"
  > = {},
): OwnerLearningFailureEvidenceContext {
  return {
    error,
    requestEvidence: response?.requestEvidence ?? extra.requestEvidence,
    responseEvidence: response?.responseEvidence,
    redactionCredentialValues: response?.redactionCredentialValues,
    responseObservedAt: response?.responseObservedAt,
    decodedOutput: extra.decodedOutput ?? response?.output,
    validation: extra.validation,
    tokenReceipt: response?.tokenReceipt,
    costReceipt: response?.costReceipt,
    protocol: OWNER_LEARNING_PROVIDER_PROTOCOL,
    additionalEvidence: extra.additionalEvidence,
  };
}

function durableCallEvidence(body: string | null): unknown {
  if (!body) return undefined;
  try {
    return (JSON.parse(body) as { evidence?: unknown }).evidence;
  } catch {
    return { unavailable: "durable_call_evidence_invalid", bodySha256Only: true };
  }
}

function durableCallEvidenceEnvelope(body: string | null): unknown {
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return { unavailable: "durable_call_evidence_invalid", bodySha256Only: true };
  }
}

function completeFailureEvidence(
  suppliedEvidence: unknown,
  durableBody: string | null,
): unknown {
  const durableEvidence = durableCallEvidenceEnvelope(durableBody);
  if (durableEvidence === undefined) return suppliedEvidence;
  return suppliedEvidence === undefined
    ? { durableCallEvidence: durableEvidence }
    : { durableCallEvidence: durableEvidence, terminalEvidence: suppliedEvidence };
}

function prepareOwnerLearningReviewFailure(input: {
  review: ReviewRow;
  diagnostic: OwnerLearningFailureDiagnosticSummary;
  call: CallRow | null;
  evidence: OwnerLearningFailureEvidenceContext;
  nowIso: string;
}): PreparedOwnerLearningFailureEvidence {
  return prepareOwnerLearningFailureEvidence({
    reviewId: input.review.id,
    phase: input.diagnostic.phase,
    diagnostic: input.diagnostic,
    error: input.evidence.error,
    requestEvidence: completeFailureEvidence(
      input.evidence.requestEvidence,
      input.call?.requestEvidenceBody ?? null,
    ),
    responseEvidence: completeFailureEvidence(
      input.evidence.responseEvidence,
      input.call?.responseEvidenceBody ?? null,
    ),
    redactionCredentialValues: input.evidence.redactionCredentialValues,
    responseObservedAt: input.evidence.responseObservedAt,
    decodedOutput: input.evidence.decodedOutput,
    validation: input.evidence.validation,
    tokenReceipt: input.evidence.tokenReceipt,
    costReceipt: input.evidence.costReceipt,
    checkpoint: input.review.checkpoint,
    protocol: input.evidence.protocol ?? ownerLearningProviderProtocolEvidence(input.call),
    additionalEvidence: {
      review: {
        analysisTrack: input.review.analysisTrack,
        analysisStatus: input.review.analysisStatus,
        stage: input.review.stage,
        executionPhase: input.review.executionPhase,
        reviewedRevisionId: input.review.reviewedRevisionId,
        logicalCallCount: input.review.logicalCallCount,
        diveCount: input.review.diveCount,
        ownerRetryCount: input.review.ownerRetryCount,
        retryTargetAttemptId: input.review.retryTargetAttemptId,
        checkpointHash: input.review.checkpointHash,
        eligibilityPolicyVersion: input.review.eligibilityPolicyVersion,
        evidenceVersion: input.review.evidenceVersion,
        reviewerVersion: input.review.reviewerVersion,
        promptVersion: input.review.promptVersion,
        schemaVersion: input.review.schemaVersion,
        providerPolicyVersion: input.review.providerPolicyVersion,
        selectedModel: input.review.selectedModel,
      },
      ...(input.call && {
        call: {
          id: input.call.id,
          ordinal: input.call.ordinal,
          attemptOrdinal: input.call.attemptOrdinal,
          retryOfAttemptId: input.call.retryOfAttemptId,
          state: input.call.state,
          stage: input.call.stage,
          inputPolicyHash: input.call.inputPolicyHash,
          providerTurnProtocol: input.call.providerTurnProtocol,
          retryOfExecutionFingerprint: input.call.retryOfExecutionFingerprint,
          validatedCheckpoint: input.call.validatedCheckpoint,
          validatedCheckpointFingerprint: input.call.validatedCheckpoint == null
            ? null
            : fingerprintOwnerLearningValue(input.call.validatedCheckpoint),
          finalProviderRequestId: input.call.finalProviderRequestId,
          providerResponseId: input.call.providerResponseId,
          providerResponseObservedAt: input.call.providerResponseObservedAt,
          providerResponseSha256: input.call.providerResponseSha256,
          requestEvidenceSha256: input.call.requestEvidenceSha256,
          requestEvidenceByteLength: input.call.requestEvidenceByteLength,
          responseEvidenceBodySha256: input.call.responseEvidenceBodySha256,
          responseEvidenceByteLength: input.call.responseEvidenceByteLength,
          transportReceipts: input.call.transportReceipts,
        },
      }),
      context: input.evidence.additionalEvidence,
    },
    now: new Date(input.nowIso),
  });
}

async function failReviewUnderLease(
  tx: ReviewTx,
  review: ReviewRow,
  failureCode: OwnerLearningSafeFailureCode,
  retryable: boolean,
  nowIso: string,
  options: {
    diagnostic?: OwnerLearningFailureDiagnosticSummary;
    call?: CallRow | null;
    linkCall?: boolean;
    evidence?: OwnerLearningFailureEvidenceContext;
  } = {},
): Promise<void> {
  const call = options.call ?? null;
  const baseDiagnostic = options.diagnostic ?? createOwnerLearningFailureDiagnostic({
    phase: defaultPhaseForFailureCode(failureCode),
    failureCode,
    error: options.evidence?.error ?? new Error(failureCode),
    callId: call?.id,
    callOrdinal: call?.ordinal,
    attemptOrdinal: call?.attemptOrdinal,
    stage: call?.stage,
    providerRequestId: call?.finalProviderRequestId,
    providerResponseId: call?.providerResponseId,
  });
  const failureDiagnostic: OwnerLearningFailureDiagnosticSummary = {
    ...baseDiagnostic,
    callId: baseDiagnostic.callId ?? call?.id ?? null,
    callOrdinal: baseDiagnostic.callOrdinal ?? call?.ordinal ?? null,
    attemptOrdinal: baseDiagnostic.attemptOrdinal ?? call?.attemptOrdinal ?? null,
    stage: baseDiagnostic.stage ?? call?.stage ?? null,
    providerRequestId: baseDiagnostic.providerRequestId ?? call?.finalProviderRequestId ?? null,
    providerResponseId: baseDiagnostic.providerResponseId ?? call?.providerResponseId ?? null,
  };
  const prepared = prepareOwnerLearningReviewFailure({
    review,
    diagnostic: failureDiagnostic,
    call,
    evidence: options.evidence ?? { error: new Error(failureCode) },
    nowIso,
  });
  const persistedDiagnostic: OwnerLearningFailureDiagnosticSummary = {
    diagnosticId: prepared.diagnostic.id,
    phase: prepared.diagnostic.phase,
    failureCode,
    errorClass: prepared.diagnostic.errorClass,
    errorCode: prepared.diagnostic.errorCode ?? "unknown_error",
    message: prepared.diagnostic.sanitizedMessage,
    firstApplicationFrame: prepared.diagnostic.firstApplicationStackFrame ?? null,
    fingerprint: prepared.diagnostic.fingerprint,
    callId: failureDiagnostic.callId,
    callOrdinal: failureDiagnostic.callOrdinal,
    attemptOrdinal: failureDiagnostic.attemptOrdinal,
    stage: failureDiagnostic.stage,
    providerRequestId: prepared.diagnostic.providerRequestId ?? null,
    providerResponseId: prepared.diagnostic.providerResponseId ?? null,
    evidenceManifestId: prepared.manifestId,
    evidenceState: "pending",
  };
  logOwnerLearningException(
    persistedDiagnostic,
    options.evidence?.error ?? new Error(failureCode),
  );
  await enqueueOwnerLearningFailureEvidence(tx, {
    reviewId: review.id,
    ...(call && {
      call: {
        id: call.id,
        ordinal: call.ordinal,
        attemptOrdinal: call.attemptOrdinal,
      },
    }),
    ...(options.linkCall !== undefined && { linkCall: options.linkCall }),
    prepared,
  });
  const ownerRetryAvailable = retryable && (review.ownerRetryCount ?? 0) < 1;
  await tx.update(schema.agentLearningReviews).set({
    analysisStatus: "failed",
    safeFailureCode: failureCode,
    retryable: ownerRetryAvailable,
    executionPhase: persistedDiagnostic.phase,
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
    retryable: ownerRetryAvailable,
    diagnostic: persistedDiagnostic,
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

function defaultPhaseForFailureCode(
  failureCode: OwnerLearningSafeFailureCode,
): OwnerLearningExecutionPhase {
  if (
    failureCode === "provider_capacity_exhausted"
    || failureCode === "provider_timeout"
    || failureCode === "provider_error"
    || failureCode === "tier_mismatch"
    || failureCode === "output_budget_exhausted"
  ) return "provider_invocation";
  if (failureCode === "invalid_structured_output") return "output_validation";
  if (failureCode === "evidence_unavailable") return "evidence_projection";
  return "finalization";
}

function ownerLearningSafeFailureCode(
  value: OwnerLearningCallFailureCode | null,
): OwnerLearningSafeFailureCode | null {
  switch (value) {
    case "provider_capacity_exhausted":
    case "provider_timeout":
    case "provider_error":
    case "invalid_structured_output":
    case "tier_mismatch":
    case "output_budget_exhausted":
    case "logical_call_budget_exhausted":
    case "evidence_unavailable":
    case "worker_interrupted":
    case "internal_error":
      return value;
    default:
      return null;
  }
}

function hashLeaseToken(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}
