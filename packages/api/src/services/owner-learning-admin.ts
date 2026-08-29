import { and, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  type OwnerLearningAnalysisStatus,
  type OwnerLearningAnalysisTrack,
  type OwnerLearningCallFailureCode,
  type OwnerLearningCostSource,
  type OwnerLearningExecutionPhase,
  type OwnerLearningResolution,
} from "./owner-learning-contracts.js";
import type { OwnerLearningEventKind } from "./owner-learning-events.js";

const ADMIN_OWNER_LEARNING_LIMIT = 250;

export type AdminOwnerLearningApplicationFilter =
  | "accepted"
  | "not_accepted"
  | "not_applicable"
  | "pending";

export interface AdminOwnerLearningReviewFilters {
  dateFrom?: string;
  dateTo?: string;
  track?: Exclude<OwnerLearningAnalysisTrack, "awaiting_evidence">;
  status?: OwnerLearningAnalysisStatus;
  model?: string;
  resolution?: OwnerLearningResolution | "open";
  application?: AdminOwnerLearningApplicationFilter;
}

export type AdminOwnerLearningDisposition =
  | "not_ready"
  | "awaiting_owner"
  | "applied"
  | "manual_update"
  | "declined"
  | "no_change"
  | "failed"
  | "superseded";

export type AdminOwnerLearningAcceptance =
  | "accepted"
  | "not_accepted"
  | "not_applicable"
  | "pending";

export interface AdminOwnerLearningTokenTotals {
  input: number;
  cachedInput: number;
  totalOutput: number;
  reasoning: number;
  visibleOutput: number;
  unavailableCallCount: number;
}

export interface AdminOwnerLearningCostTotals {
  actualMicrousd: number;
  estimatedMicrousd: number;
  unavailableCallCount: number;
}

export interface AdminOwnerLearningCall {
  id: string;
  ordinal: number;
  attemptOrdinal: number;
  retryOfAttemptId: string | null;
  executionKind: "provider_invocation" | "local_recovery";
  providerTurnProtocol: string;
  executionFingerprint: string;
  retryOfExecutionFingerprint: string | null;
  state: string;
  stage: string;
  requestedTier: string;
  effectiveTier: string | null;
  requestedReasoningEffort: string;
  capacityPath: string | null;
  flex429Count: number;
  terminalHttpStatus: number | null;
  providerRequestId: string | null;
  providerResponseId: string | null;
  providerResponseObservedAt: string | null;
  providerResponseSha256: string | null;
  requestEvidence: { sha256: string | null; byteLength: number | null };
  responseEvidence: { sha256: string | null; byteLength: number | null };
  evidenceState: string;
  failureDiagnosticId: string | null;
  safeFailureCode: OwnerLearningCallFailureCode | null;
  latencyMs: number | null;
  tokens: {
    input: number | null;
    cachedInput: number | null;
    totalOutput: number | null;
    reasoning: number | null;
    visibleOutput: number | null;
  };
  cost: {
    source: OwnerLearningCostSource;
    microusd: number | null;
    pricingSourceId: string | null;
    rateCardVersion: string | null;
    pricedAt: string | null;
  };
  dispatchedAt: string | null;
  completedAt: string | null;
}

export interface AdminOwnerLearningFailureDiagnostic {
  id: string;
  phase: OwnerLearningExecutionPhase | null;
  safeFailureCode: string;
  errorClass: string;
  errorCode: string | null;
  message: string;
  firstApplicationStackFrame: string | null;
  fingerprint: string;
  callId: string | null;
  callOrdinal: number | null;
  attemptOrdinal: number | null;
  providerRequestId: string | null;
  providerResponseId: string | null;
  occurredAt: string;
  evidence: {
    manifestId: string;
    state: "pending" | "stored" | "degraded" | "legacy_unavailable";
    byteLength: number | null;
    sha256: string | null;
    lastStorageError: string | null;
  };
}

export interface AdminOwnerLearningReviewDetail {
  id: string;
  owner: {
    userId: string;
    displayName: string | null;
    handle: string | null;
  };
  agent: {
    profileId: string;
    name: string;
  };
  reviewedRevision: {
    id: string;
    ordinal: number;
  };
  policy: {
    eligibility: string;
    evidence: string;
    reviewer: string;
    prompt: string;
    schema: string;
    provider: string;
    model: string;
  };
  lifecycle: {
    track: Exclude<OwnerLearningAnalysisTrack, "awaiting_evidence">;
    status: OwnerLearningAnalysisStatus;
    stage: string;
    executionPhase: OwnerLearningExecutionPhase | null;
    capacitySubstatus: string | null;
    resolution: OwnerLearningResolution | null;
    safeFailureCode: string | null;
    retryable: boolean;
    ownerRetryCount: number;
    ownerRetriesRemaining: 0 | 1;
    retryTargetAttemptId: string | null;
    logicalCallCount: number;
    diveCount: number;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    resolvedAt: string | null;
    updatedAt: string;
  };
  disposition: AdminOwnerLearningDisposition;
  acceptance: AdminOwnerLearningAcceptance;
  calls: AdminOwnerLearningCall[];
  diagnostics: AdminOwnerLearningFailureDiagnostic[];
  tokens: AdminOwnerLearningTokenTotals;
  cost: AdminOwnerLearningCostTotals;
  application: {
    appliedAt: string;
  } | null;
}

export interface AdminOwnerLearningReviewSummary {
  id: string;
  owner: AdminOwnerLearningReviewDetail["owner"];
  agent: AdminOwnerLearningReviewDetail["agent"];
  reviewedRevision: AdminOwnerLearningReviewDetail["reviewedRevision"];
  track: Exclude<OwnerLearningAnalysisTrack, "awaiting_evidence">;
  status: OwnerLearningAnalysisStatus;
  stage: string;
  resolution: OwnerLearningResolution | null;
  model: string;
  disposition: AdminOwnerLearningDisposition;
  acceptance: AdminOwnerLearningAcceptance;
  logicalCallCount: number;
  diveCount: number;
  failure: AdminOwnerLearningFailureDiagnostic | null;
  tokens: AdminOwnerLearningTokenTotals;
  cost: AdminOwnerLearningCostTotals;
  createdAt: string;
  completedAt: string | null;
  resolvedAt: string | null;
}

export interface AdminOwnerLearningAnalytics {
  reviewCount: number;
  eventCounts: Partial<Record<OwnerLearningEventKind, number>>;
  tokens: AdminOwnerLearningTokenTotals;
  cost: AdminOwnerLearningCostTotals;
  averageCompletionLatencyMs: number | null;
}

export interface AdminOwnerLearningReviewList {
  reviews: AdminOwnerLearningReviewSummary[];
  analytics: AdminOwnerLearningAnalytics;
  truncated: boolean;
}

export function parseAdminOwnerLearningReviewFilters(
  input: Record<string, string>,
): AdminOwnerLearningReviewFilters {
  return {
    dateFrom: parseDateFilter(input.dateFrom, "dateFrom", false),
    dateTo: parseDateFilter(input.dateTo, "dateTo", true),
    track: parseEnumFilter(input.track, "track", ["evidence_rich", "strategy_health_check"]),
    status: parseEnumFilter(input.status, "status", ["queued", "retry_queued", "running", "ready", "no_change", "failed"]),
    model: parseTextFilter(input.model, "model"),
    resolution: parseEnumFilter(input.resolution, "resolution", [
      "open", "applied", "manual_update", "declined", "no_change", "failed", "superseded",
    ]),
    application: parseEnumFilter(input.application, "application", [
      "accepted", "not_accepted", "not_applicable", "pending",
    ]),
  };
}

type BaseReviewRow = Awaited<ReturnType<typeof loadBaseReviews>>[number];
type CallRow = Awaited<ReturnType<typeof loadCalls>>[number];
type DiagnosticRow = Awaited<ReturnType<typeof loadDiagnostics>>[number];
type ApplicationRow = Awaited<ReturnType<typeof loadApplications>>[number];

export async function listAdminOwnerLearningReviews(
  db: DrizzleDB,
  filters: AdminOwnerLearningReviewFilters = {},
): Promise<AdminOwnerLearningReviewList> {
  validateFilters(filters);
  const reviewWindow = await loadBaseReviews(
    db,
    undefined,
    filters,
    ADMIN_OWNER_LEARNING_LIMIT + 1,
  );
  const truncated = reviewWindow.length > ADMIN_OWNER_LEARNING_LIMIT;
  const reviews = reviewWindow.slice(0, ADMIN_OWNER_LEARNING_LIMIT);
  const reviewIds = reviews.map((review) => review.id);
  const [calls, diagnostics, applications, eventCounts] = await Promise.all([
    loadCalls(db, reviewIds),
    loadDiagnostics(db, reviewIds),
    loadApplications(db, reviewIds),
    loadEventCounts(db, reviewIds, filters),
  ]);
  const records = assembleAdminOwnerLearningRecords({
    reviews,
    calls,
    diagnostics,
    applications,
  });
  return {
    reviews: records.details.map(toSummary),
    analytics: aggregateAnalytics(records.details, eventCounts),
    truncated,
  };
}

export async function getAdminOwnerLearningReview(
  db: DrizzleDB,
  reviewId: string,
): Promise<AdminOwnerLearningReviewDetail | null> {
  const normalizedId = reviewId.trim();
  if (!normalizedId) return null;
  const records = await loadAdminOwnerLearningDetailRecords(db, normalizedId);
  return records.details[0] ?? null;
}

async function loadAdminOwnerLearningDetailRecords(db: DrizzleDB, reviewId: string) {
  const [reviews, calls, diagnostics, applications] = await Promise.all([
    loadBaseReviews(db, reviewId),
    loadCalls(db, [reviewId]),
    loadDiagnostics(db, [reviewId]),
    loadApplications(db, [reviewId]),
  ]);
  if (reviews.length === 0) return { details: [] };

  return assembleAdminOwnerLearningRecords({
    reviews,
    calls,
    diagnostics,
    applications,
  });
}

function assembleAdminOwnerLearningRecords(input: {
  reviews: BaseReviewRow[];
  calls: CallRow[];
  diagnostics: DiagnosticRow[];
  applications: ApplicationRow[];
}) {
  const { reviews, calls, diagnostics, applications } = input;

  const callsByReview = Map.groupBy(calls, (row) => row.reviewId);
  const diagnosticsByReview = Map.groupBy(diagnostics, (row) => row.reviewId);
  const applicationsByReview = new Map(applications.map((row) => [row.reviewId, row]));

  const details = reviews.map((review) => toDetail({
    review,
    calls: callsByReview.get(review.id) ?? [],
    diagnostics: diagnosticsByReview.get(review.id) ?? [],
    application: applicationsByReview.get(review.id) ?? null,
  }));
  return { details };
}

async function loadBaseReviews(
  db: DrizzleDB,
  reviewId?: string,
  filters: AdminOwnerLearningReviewFilters = {},
  limit?: number,
) {
  const query = db.select({
    id: schema.agentLearningReviews.id,
    ownerUserId: schema.agentLearningReviews.ownerUserId,
    ownerDisplayName: schema.users.displayName,
    ownerHandle: schema.users.handle,
    agentProfileId: schema.agentLearningReviews.agentProfileId,
    agentName: schema.agentProfiles.name,
    reviewedRevisionId: schema.agentLearningReviews.reviewedRevisionId,
    reviewedRevisionOrdinal: schema.agentRevisions.ordinal,
    eligibilityPolicyVersion: schema.agentLearningReviews.eligibilityPolicyVersion,
    evidenceVersion: schema.agentLearningReviews.evidenceVersion,
    reviewerVersion: schema.agentLearningReviews.reviewerVersion,
    promptVersion: schema.agentLearningReviews.promptVersion,
    schemaVersion: schema.agentLearningReviews.schemaVersion,
    providerPolicyVersion: schema.agentLearningReviews.providerPolicyVersion,
    selectedModel: schema.agentLearningReviews.selectedModel,
    analysisTrack: schema.agentLearningReviews.analysisTrack,
    analysisStatus: schema.agentLearningReviews.analysisStatus,
    stage: schema.agentLearningReviews.stage,
    executionPhase: schema.agentLearningReviews.executionPhase,
    capacitySubstatus: schema.agentLearningReviews.capacitySubstatus,
    resolution: schema.agentLearningReviews.resolution,
    safeFailureCode: schema.agentLearningReviews.safeFailureCode,
    retryable: schema.agentLearningReviews.retryable,
    ownerRetryCount: schema.agentLearningReviews.ownerRetryCount,
    retryTargetAttemptId: schema.agentLearningReviews.retryTargetAttemptId,
    logicalCallCount: schema.agentLearningReviews.logicalCallCount,
    diveCount: schema.agentLearningReviews.diveCount,
    result: schema.agentLearningReviews.result,
    createdAt: schema.agentLearningReviews.createdAt,
    startedAt: schema.agentLearningReviews.startedAt,
    completedAt: schema.agentLearningReviews.completedAt,
    resolvedAt: schema.agentLearningReviews.resolvedAt,
    updatedAt: schema.agentLearningReviews.updatedAt,
  }).from(schema.agentLearningReviews)
    .innerJoin(schema.users, eq(schema.agentLearningReviews.ownerUserId, schema.users.id))
    .innerJoin(schema.agentProfiles, eq(schema.agentLearningReviews.agentProfileId, schema.agentProfiles.id))
    .innerJoin(schema.agentRevisions, eq(schema.agentLearningReviews.reviewedRevisionId, schema.agentRevisions.id))
    .leftJoin(
      schema.agentLearningReviewApplications,
      eq(schema.agentLearningReviewApplications.reviewId, schema.agentLearningReviews.id),
    );
  if (reviewId) return query.where(eq(schema.agentLearningReviews.id, reviewId));
  const filtered = query.where(and(...adminReviewFilterConditions(filters)))
    .orderBy(desc(schema.agentLearningReviews.createdAt), desc(schema.agentLearningReviews.id));
  return limit === undefined ? filtered : filtered.limit(limit);
}

function adminReviewFilterConditions(filters: AdminOwnerLearningReviewFilters): SQL[] {
  const review = schema.agentLearningReviews;
  const application = schema.agentLearningReviewApplications;
  const acceptance = sql<AdminOwnerLearningAcceptance>`CASE
    WHEN ${application.reviewId} IS NOT NULL THEN 'accepted'
    WHEN ${review.resolution} = 'no_change'
      OR (
        ${review.resolution} IS NULL
        AND ${review.analysisStatus} IN ('ready', 'no_change')
        AND ${review.result} -> 'proposal' IS NULL
      ) THEN 'not_applicable'
    WHEN ${review.resolution} IS NULL AND (
      ${review.analysisStatus} IN ('queued', 'retry_queued', 'running')
      OR (
        ${review.analysisStatus} IN ('ready', 'no_change')
        AND ${review.result} -> 'proposal' IS NOT NULL
      )
    ) THEN 'pending'
    ELSE 'not_accepted'
  END`;
  return [
    filters.dateFrom ? gte(review.createdAt, filters.dateFrom) : undefined,
    filters.dateTo ? lte(review.createdAt, filters.dateTo) : undefined,
    filters.track ? eq(review.analysisTrack, filters.track) : undefined,
    filters.status ? eq(review.analysisStatus, filters.status) : undefined,
    filters.model ? eq(review.selectedModel, filters.model) : undefined,
    filters.resolution === "open"
      ? isNull(review.resolution)
      : filters.resolution ? eq(review.resolution, filters.resolution) : undefined,
    filters.application ? eq(acceptance, filters.application) : undefined,
  ].filter((condition): condition is SQL => condition !== undefined);
}

async function loadCalls(db: DrizzleDB, reviewIds: string[]) {
  if (reviewIds.length === 0) return [];
  const query = db.select({
    id: schema.agentLearningReviewCalls.id,
    reviewId: schema.agentLearningReviewCalls.reviewId,
    ordinal: schema.agentLearningReviewCalls.ordinal,
    attemptOrdinal: schema.agentLearningReviewCalls.attemptOrdinal,
    retryOfAttemptId: schema.agentLearningReviewCalls.retryOfAttemptId,
    providerTurnProtocol: schema.agentLearningReviewCalls.providerTurnProtocol,
    inputPolicyHash: schema.agentLearningReviewCalls.inputPolicyHash,
    retryOfExecutionFingerprint: schema.agentLearningReviewCalls.retryOfExecutionFingerprint,
    state: schema.agentLearningReviewCalls.state,
    stage: schema.agentLearningReviewCalls.stage,
    requestedTier: schema.agentLearningReviewCalls.requestedTier,
    effectiveTier: schema.agentLearningReviewCalls.effectiveTier,
    requestedReasoningEffort: schema.agentLearningReviewCalls.requestedReasoningEffort,
    tokenReceipt: schema.agentLearningReviewCalls.tokenReceipt,
    transportReceipts: schema.agentLearningReviewCalls.transportReceipts,
    finalProviderRequestId: schema.agentLearningReviewCalls.finalProviderRequestId,
    providerResponseId: schema.agentLearningReviewCalls.providerResponseId,
    providerResponseObservedAt: schema.agentLearningReviewCalls.providerResponseObservedAt,
    providerResponseSha256: schema.agentLearningReviewCalls.providerResponseSha256,
    requestEvidenceSha256: schema.agentLearningReviewCalls.requestEvidenceSha256,
    requestEvidenceByteLength: schema.agentLearningReviewCalls.requestEvidenceByteLength,
    responseEvidenceBodySha256: schema.agentLearningReviewCalls.responseEvidenceBodySha256,
    responseEvidenceByteLength: schema.agentLearningReviewCalls.responseEvidenceByteLength,
    evidenceState: schema.agentLearningReviewCalls.evidenceState,
    failureDiagnosticId: schema.agentLearningReviewCalls.failureDiagnosticId,
    safeFailureCode: schema.agentLearningReviewCalls.safeFailureCode,
    flex429Count: schema.agentLearningReviewCalls.flex429Count,
    capacityPath: schema.agentLearningReviewCalls.capacityPath,
    latencyMs: schema.agentLearningReviewCalls.latencyMs,
    costSource: schema.agentLearningReviewCalls.costSource,
    actualCostMicrousd: schema.agentLearningReviewCalls.actualCostMicrousd,
    estimatedCostMicrousd: schema.agentLearningReviewCalls.estimatedCostMicrousd,
    pricingSourceId: schema.agentLearningReviewCalls.pricingSourceId,
    rateCardVersion: schema.agentLearningReviewCalls.rateCardVersion,
    pricedAt: schema.agentLearningReviewCalls.pricedAt,
    dispatchedAt: schema.agentLearningReviewCalls.dispatchedAt,
    completedAt: schema.agentLearningReviewCalls.completedAt,
  }).from(schema.agentLearningReviewCalls);
  return query.where(inArray(schema.agentLearningReviewCalls.reviewId, reviewIds));
}

async function loadDiagnostics(db: DrizzleDB, reviewIds: string[]) {
  if (reviewIds.length === 0) return [];
  const query = db.select({
    id: schema.agentLearningReviewFailureDiagnostics.id,
    reviewId: schema.agentLearningReviewFailureDiagnostics.reviewId,
    phase: schema.agentLearningReviewFailureDiagnostics.phase,
    safeFailureCode: schema.agentLearningReviewFailureDiagnostics.safeFailureCode,
    errorClass: schema.agentLearningReviewFailureDiagnostics.errorClass,
    errorCode: schema.agentLearningReviewFailureDiagnostics.errorCode,
    sanitizedMessage: schema.agentLearningReviewFailureDiagnostics.sanitizedMessage,
    firstApplicationStackFrame: schema.agentLearningReviewFailureDiagnostics.firstApplicationStackFrame,
    fingerprint: schema.agentLearningReviewFailureDiagnostics.fingerprint,
    callId: schema.agentLearningReviewFailureDiagnostics.callId,
    callOrdinal: schema.agentLearningReviewFailureDiagnostics.callOrdinal,
    attemptOrdinal: schema.agentLearningReviewFailureDiagnostics.attemptOrdinal,
    providerRequestId: schema.agentLearningReviewFailureDiagnostics.providerRequestId,
    providerResponseId: schema.agentLearningReviewFailureDiagnostics.providerResponseId,
    occurredAt: schema.agentLearningReviewFailureDiagnostics.occurredAt,
    manifestId: schema.agentLearningReviewFailureManifests.id,
    evidenceState: schema.agentLearningReviewFailureManifests.state,
    byteLength: schema.agentLearningReviewFailureManifests.byteLength,
    bodySha256: schema.agentLearningReviewFailureManifests.bodySha256,
    lastStorageError: schema.agentLearningReviewFailureManifests.lastStorageError,
  }).from(schema.agentLearningReviewFailureDiagnostics)
    .innerJoin(
      schema.agentLearningReviewFailureManifests,
      eq(
        schema.agentLearningReviewFailureManifests.diagnosticId,
        schema.agentLearningReviewFailureDiagnostics.id,
      ),
    );
  return query.where(inArray(schema.agentLearningReviewFailureDiagnostics.reviewId, reviewIds));
}

async function loadApplications(db: DrizzleDB, reviewIds: string[]) {
  if (reviewIds.length === 0) return [];
  const query = db.select({
    reviewId: schema.agentLearningReviewApplications.reviewId,
    appliedAt: schema.agentLearningReviewApplications.appliedAt,
  }).from(schema.agentLearningReviewApplications);
  return query.where(inArray(schema.agentLearningReviewApplications.reviewId, reviewIds));
}

async function loadEventCounts(
  db: DrizzleDB,
  reviewIds: string[],
  filters: AdminOwnerLearningReviewFilters,
): Promise<Partial<Record<OwnerLearningEventKind, number>>> {
  const hasReviewFilters = Boolean(
    filters.track || filters.status || filters.model
    || filters.resolution || filters.application,
  );
  const reviewScope = reviewIds.length === 0
    ? sql`false`
    : inArray(schema.agentLearningEvents.reviewId, reviewIds);
  const rows = await db.select({
    kind: schema.agentLearningEvents.kind,
    count: sql<number>`count(*)::int`,
  }).from(schema.agentLearningEvents).where(and(
    filters.dateFrom ? gte(schema.agentLearningEvents.occurredAt, filters.dateFrom) : undefined,
    filters.dateTo ? lte(schema.agentLearningEvents.occurredAt, filters.dateTo) : undefined,
    hasReviewFilters
      ? reviewScope
      : or(reviewScope, isNull(schema.agentLearningEvents.reviewId)),
  )).groupBy(schema.agentLearningEvents.kind);
  return Object.fromEntries(rows.map((row) => [row.kind, row.count]));
}

function toDetail(input: {
  review: BaseReviewRow;
  calls: CallRow[];
  diagnostics: DiagnosticRow[];
  application: ApplicationRow | null;
}): AdminOwnerLearningReviewDetail {
  const calls = input.calls.sort((left, right) => (
    left.ordinal - right.ordinal || left.attemptOrdinal - right.attemptOrdinal
  )).map(toCall);
  const diagnostics = input.diagnostics
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    .map(toDiagnostic);
  const tokens = aggregateTokens(calls);
  const cost = aggregateCost(calls);
  const disposition = deriveAdminDisposition(input.review, input.application);
  const acceptance = deriveAcceptance(disposition);

  return {
    id: input.review.id,
    owner: {
      userId: input.review.ownerUserId,
      displayName: input.review.ownerDisplayName,
      handle: input.review.ownerHandle,
    },
    agent: { profileId: input.review.agentProfileId, name: input.review.agentName },
    reviewedRevision: {
      id: input.review.reviewedRevisionId,
      ordinal: input.review.reviewedRevisionOrdinal,
    },
    policy: {
      eligibility: input.review.eligibilityPolicyVersion,
      evidence: input.review.evidenceVersion,
      reviewer: input.review.reviewerVersion,
      prompt: input.review.promptVersion,
      schema: input.review.schemaVersion,
      provider: input.review.providerPolicyVersion,
      model: input.review.selectedModel,
    },
    lifecycle: {
      track: input.review.analysisTrack,
      status: input.review.analysisStatus,
      stage: input.review.stage,
      executionPhase: input.review.executionPhase,
      capacitySubstatus: input.review.capacitySubstatus,
      resolution: input.review.resolution,
      safeFailureCode: input.review.safeFailureCode,
      retryable: input.review.retryable,
      ownerRetryCount: input.review.ownerRetryCount,
      ownerRetriesRemaining: input.review.ownerRetryCount === 0 ? 1 : 0,
      retryTargetAttemptId: input.review.retryTargetAttemptId,
      logicalCallCount: input.review.logicalCallCount,
      diveCount: input.review.diveCount,
      createdAt: input.review.createdAt,
      startedAt: input.review.startedAt,
      completedAt: input.review.completedAt,
      resolvedAt: input.review.resolvedAt,
      updatedAt: input.review.updatedAt,
    },
    disposition,
    acceptance,
    calls,
    diagnostics,
    tokens,
    cost,
    application: input.application
      ? {
          appliedAt: input.application.appliedAt,
        }
      : null,
  };
}

function toCall(row: CallRow): AdminOwnerLearningCall {
  const input = finiteToken(row.tokenReceipt?.inputTokens);
  const cachedInput = finiteToken(row.tokenReceipt?.cachedInputTokens);
  const totalOutput = finiteToken(row.tokenReceipt?.totalOutputTokens);
  const reasoning = finiteToken(row.tokenReceipt?.reasoningTokens);
  const terminalReceipts = row.transportReceipts.filter((receipt) =>
    receipt.terminalOutcomeAt != null
  );
  const latestTerminalReceipt = terminalReceipts.at(-1);
  const transportLatencyMs = terminalReceipts.length > 0
    && terminalReceipts.every((receipt) => receipt.latencyMs != null)
    ? terminalReceipts.reduce((total, receipt) => total + receipt.latencyMs!, 0)
    : null;
  const executionKind = row.retryOfAttemptId != null
    && row.transportReceipts.length === 0
    && row.dispatchedAt == null
    && row.responseEvidenceBodySha256 != null
    ? "local_recovery" as const
    : "provider_invocation" as const;
  return {
    id: row.id,
    ordinal: row.ordinal,
    attemptOrdinal: row.attemptOrdinal,
    retryOfAttemptId: row.retryOfAttemptId,
    executionKind,
    providerTurnProtocol: row.providerTurnProtocol,
    executionFingerprint: row.inputPolicyHash,
    retryOfExecutionFingerprint: row.retryOfExecutionFingerprint,
    state: row.state,
    stage: row.stage,
    requestedTier: row.requestedTier,
    effectiveTier: row.effectiveTier,
    requestedReasoningEffort: row.requestedReasoningEffort,
    capacityPath: row.capacityPath,
    flex429Count: row.flex429Count,
    terminalHttpStatus: latestTerminalReceipt?.terminalHttpStatus ?? null,
    providerRequestId: latestTerminalReceipt?.providerRequestId ?? row.finalProviderRequestId,
    providerResponseId: row.providerResponseId,
    providerResponseObservedAt: row.providerResponseObservedAt,
    providerResponseSha256: row.providerResponseSha256,
    requestEvidence: {
      sha256: row.requestEvidenceSha256,
      byteLength: row.requestEvidenceByteLength,
    },
    responseEvidence: {
      sha256: row.responseEvidenceBodySha256,
      byteLength: row.responseEvidenceByteLength,
    },
    evidenceState: row.evidenceState,
    failureDiagnosticId: row.failureDiagnosticId,
    safeFailureCode: row.safeFailureCode,
    latencyMs: row.latencyMs ?? transportLatencyMs,
    tokens: {
      input,
      cachedInput,
      totalOutput,
      reasoning,
      visibleOutput: totalOutput == null ? null : Math.max(0, totalOutput - (reasoning ?? 0)),
    },
    cost: {
      source: row.costSource,
      microusd: row.costSource === "actual"
        ? row.actualCostMicrousd
        : row.costSource === "estimated"
          ? row.estimatedCostMicrousd
          : null,
      pricingSourceId: row.pricingSourceId,
      rateCardVersion: row.rateCardVersion,
      pricedAt: row.pricedAt,
    },
    dispatchedAt: row.dispatchedAt,
    completedAt: row.completedAt,
  };
}

function toDiagnostic(row: DiagnosticRow): AdminOwnerLearningFailureDiagnostic {
  return {
    id: row.id,
    phase: row.phase,
    safeFailureCode: row.safeFailureCode,
    errorClass: row.errorClass,
    errorCode: row.errorCode,
    message: row.sanitizedMessage,
    firstApplicationStackFrame: row.firstApplicationStackFrame,
    fingerprint: row.fingerprint,
    callId: row.callId,
    callOrdinal: row.callOrdinal,
    attemptOrdinal: row.attemptOrdinal,
    providerRequestId: row.providerRequestId,
    providerResponseId: row.providerResponseId,
    occurredAt: row.occurredAt,
    evidence: {
      manifestId: row.manifestId,
      state: row.evidenceState,
      byteLength: row.byteLength,
      sha256: row.bodySha256,
      lastStorageError: row.lastStorageError,
    },
  };
}

function aggregateTokens(calls: AdminOwnerLearningCall[]): AdminOwnerLearningTokenTotals {
  return calls.reduce<AdminOwnerLearningTokenTotals>((total, call) => {
    if (call.executionKind === "provider_invocation"
      && call.tokens.input == null
      && call.tokens.cachedInput == null
      && call.tokens.totalOutput == null
      && call.tokens.reasoning == null) {
      total.unavailableCallCount += 1;
    }
    total.input += call.tokens.input ?? 0;
    total.cachedInput += call.tokens.cachedInput ?? 0;
    total.totalOutput += call.tokens.totalOutput ?? 0;
    total.reasoning += call.tokens.reasoning ?? 0;
    total.visibleOutput += call.tokens.visibleOutput ?? 0;
    return total;
  }, emptyTokenTotals());
}

function aggregateCost(calls: AdminOwnerLearningCall[]): AdminOwnerLearningCostTotals {
  return calls.reduce<AdminOwnerLearningCostTotals>((total, call) => {
    if (call.cost.source === "actual") total.actualMicrousd += call.cost.microusd ?? 0;
    if (call.cost.source === "estimated") total.estimatedMicrousd += call.cost.microusd ?? 0;
    if (call.executionKind === "provider_invocation" && call.cost.source === "unavailable") {
      total.unavailableCallCount += 1;
    }
    return total;
  }, emptyCostTotals());
}

function toSummary(detail: AdminOwnerLearningReviewDetail): AdminOwnerLearningReviewSummary {
  return {
    id: detail.id,
    owner: detail.owner,
    agent: detail.agent,
    reviewedRevision: detail.reviewedRevision,
    track: detail.lifecycle.track,
    status: detail.lifecycle.status,
    stage: detail.lifecycle.stage,
    resolution: detail.lifecycle.resolution,
    model: detail.policy.model,
    disposition: detail.disposition,
    acceptance: detail.acceptance,
    logicalCallCount: detail.lifecycle.logicalCallCount,
    diveCount: detail.lifecycle.diveCount,
    failure: detail.diagnostics.at(-1) ?? null,
    tokens: detail.tokens,
    cost: detail.cost,
    createdAt: detail.lifecycle.createdAt,
    completedAt: detail.lifecycle.completedAt,
    resolvedAt: detail.lifecycle.resolvedAt,
  };
}

function aggregateAnalytics(
  details: AdminOwnerLearningReviewDetail[],
  eventCounts: Partial<Record<OwnerLearningEventKind, number>>,
): AdminOwnerLearningAnalytics {
  const tokens = emptyTokenTotals();
  const cost = emptyCostTotals();
  const completionLatencies: number[] = [];
  for (const detail of details) {
    addTokenTotals(tokens, detail.tokens);
    addCostTotals(cost, detail.cost);
    if (detail.lifecycle.completedAt) {
      const latency = Date.parse(detail.lifecycle.completedAt) - Date.parse(detail.lifecycle.createdAt);
      if (Number.isFinite(latency) && latency >= 0) completionLatencies.push(latency);
    }
  }
  return {
    reviewCount: details.length,
    eventCounts,
    tokens,
    cost,
    averageCompletionLatencyMs: completionLatencies.length === 0
      ? null
      : Math.round(completionLatencies.reduce((sum, value) => sum + value, 0) / completionLatencies.length),
  };
}

function deriveAdminDisposition(
  review: Pick<BaseReviewRow, "analysisStatus" | "resolution" | "result">,
  application: ApplicationRow | null,
): AdminOwnerLearningDisposition {
  if (application) return "applied";
  if (review.resolution === "applied") {
    throw new Error("Applied owner learning review is missing its application receipt");
  }
  if (review.resolution) return review.resolution;
  if (review.analysisStatus === "ready" || review.analysisStatus === "no_change") {
    return review.result?.proposal ? "awaiting_owner" : "no_change";
  }
  if (review.analysisStatus === "failed") return "failed";
  return "not_ready";
}

function deriveAcceptance(disposition: AdminOwnerLearningDisposition): AdminOwnerLearningAcceptance {
  if (disposition === "applied") return "accepted";
  if (disposition === "no_change") return "not_applicable";
  if (disposition === "not_ready" || disposition === "awaiting_owner") return "pending";
  return "not_accepted";
}

function validateFilters(filters: AdminOwnerLearningReviewFilters): void {
  for (const [label, value] of [["dateFrom", filters.dateFrom], ["dateTo", filters.dateTo]] as const) {
    if (value != null && !Number.isFinite(Date.parse(value))) {
      throw new Error(`${label} must be an ISO timestamp`);
    }
  }
}

function parseDateFilter(value: string | undefined, label: string, endOfDay: boolean): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(normalized);
  const parsed = new Date(dateOnly
    ? `${normalized}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
    : normalized);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} must be an ISO timestamp`);
  return parsed.toISOString();
}

function parseTextFilter(value: string | undefined, label: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > 200) throw new Error(`${label} must contain at most 200 characters`);
  return normalized;
}

function parseEnumFilter<const T extends string>(
  value: string | undefined,
  label: string,
  allowed: readonly T[],
): T | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (!allowed.includes(normalized as T)) throw new Error(`${label} is invalid`);
  return normalized as T;
}

function emptyTokenTotals(): AdminOwnerLearningTokenTotals {
  return { input: 0, cachedInput: 0, totalOutput: 0, reasoning: 0, visibleOutput: 0, unavailableCallCount: 0 };
}

function emptyCostTotals(): AdminOwnerLearningCostTotals {
  return { actualMicrousd: 0, estimatedMicrousd: 0, unavailableCallCount: 0 };
}

function addTokenTotals(target: AdminOwnerLearningTokenTotals, value: AdminOwnerLearningTokenTotals): void {
  target.input += value.input;
  target.cachedInput += value.cachedInput;
  target.totalOutput += value.totalOutput;
  target.reasoning += value.reasoning;
  target.visibleOutput += value.visibleOutput;
  target.unavailableCallCount += value.unavailableCallCount;
}

function addCostTotals(target: AdminOwnerLearningCostTotals, value: AdminOwnerLearningCostTotals): void {
  target.actualMicrousd += value.actualMicrousd;
  target.estimatedMicrousd += value.estimatedMicrousd;
  target.unavailableCallCount += value.unavailableCallCount;
}

function finiteToken(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed != null && parsed >= 0 ? Math.round(parsed) : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
