import { and, desc, eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  parseOwnerLearningReviewResult,
  type OwnerLearningAnalysisStatus,
  type OwnerLearningAnalysisTrack,
  type OwnerLearningCostSource,
  type OwnerLearningResolution,
  type OwnerLearningReviewResult,
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
  diagnosis?: string;
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
  ordinal: number;
  state: string;
  stage: string;
  requestedTier: string;
  effectiveTier: string | null;
  requestedReasoningEffort: string;
  capacityPath: string | null;
  flex429Count: number;
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
  selectedGames: Array<{
    gameId: string;
    slug: string;
    position: number;
    previouslyAnalyzed: boolean;
  }>;
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
    capacitySubstatus: string | null;
    resolution: OwnerLearningResolution | null;
    safeFailureCode: string | null;
    retryable: boolean;
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
  result: OwnerLearningReviewResult | null;
  recommendationAcceptance: Array<{
    recommendationId: string | null;
    state: "accepted" | "not_accepted" | "not_applicable";
  }>;
  proposalFingerprint: string | null;
  calls: AdminOwnerLearningCall[];
  tokens: AdminOwnerLearningTokenTotals;
  cost: AdminOwnerLearningCostTotals;
  application: {
    proposalFingerprint: string;
    sourceRecommendationIds: string[];
    priorRevisionId: string;
    resultingRevisionId: string;
    priorStrategyStyle: string;
    resultingStrategyStyle: string;
    appliedAt: string;
    mutationReceipt: AdminOwnerLearningMutationReceiptSummary;
  } | null;
  subsequentDailyFree: {
    label: string;
    revisionId: string;
    games: Array<{
      gameId: string;
      slug: string;
      placement: number;
      lobbySize: number;
      totalPoints: number;
      earnedAt: string;
    }>;
  } | null;
}

export interface AdminOwnerLearningMutationReceiptSummary {
  schemaVersion: number | null;
  operation: string | null;
  profileRevision: {
    revisionId: string | null;
    ordinal: number | null;
    outcome: string | null;
  } | null;
  dailyFree: string | null;
  waitingSeats: {
    total: number | null;
    reconciled: number | null;
    alreadyCurrent: number | null;
    crossedFreeze: number | null;
    truncatedCount: number | null;
  } | null;
  frozenSeats: { unchanged: number | null } | null;
  warnings: string[];
}

export interface AdminOwnerLearningReviewSummary {
  id: string;
  owner: AdminOwnerLearningReviewDetail["owner"];
  agent: AdminOwnerLearningReviewDetail["agent"];
  reviewedRevision: AdminOwnerLearningReviewDetail["reviewedRevision"];
  selectedGameCount: number;
  track: Exclude<OwnerLearningAnalysisTrack, "awaiting_evidence">;
  status: OwnerLearningAnalysisStatus;
  stage: string;
  resolution: OwnerLearningResolution | null;
  diagnosis: string | null;
  model: string;
  disposition: AdminOwnerLearningDisposition;
  acceptance: AdminOwnerLearningAcceptance;
  recommendationCount: number;
  logicalCallCount: number;
  diveCount: number;
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
    diagnosis: parseTextFilter(input.diagnosis, "diagnosis"),
    status: parseEnumFilter(input.status, "status", ["queued", "running", "ready", "no_change", "failed"]),
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
type ApplicationRow = Awaited<ReturnType<typeof loadApplications>>[number];
type SelectedGameRow = Awaited<ReturnType<typeof loadSelectedGames>>[number];
type DailyFreeReceiptRow = Awaited<ReturnType<typeof loadDailyFreeReceipts>>[number];
type AnalysisHistoryRow = Awaited<ReturnType<typeof loadAnalysisHistory>>[number];
type EventRow = Awaited<ReturnType<typeof loadEvents>>[number];

export async function listAdminOwnerLearningReviews(
  db: DrizzleDB,
  filters: AdminOwnerLearningReviewFilters = {},
): Promise<AdminOwnerLearningReviewList> {
  validateFilters(filters);
  const records = await loadAdminOwnerLearningRecords(db);
  const matching = records.details.filter((record) => matchesFilters(record, filters));
  const displayed = matching.slice(0, ADMIN_OWNER_LEARNING_LIMIT);
  return {
    reviews: displayed.map(toSummary),
    analytics: aggregateAnalytics(
      matching,
      aggregateEventCounts(records.events, matching, filters),
    ),
    truncated: matching.length > displayed.length,
  };
}

export async function getAdminOwnerLearningReview(
  db: DrizzleDB,
  reviewId: string,
): Promise<AdminOwnerLearningReviewDetail | null> {
  const normalizedId = reviewId.trim();
  if (!normalizedId) return null;
  const records = await loadAdminOwnerLearningRecords(db, normalizedId);
  return records.details[0] ?? null;
}

async function loadAdminOwnerLearningRecords(db: DrizzleDB, reviewId?: string) {
  const [reviews, calls, applications, selectedGames, receipts, analysisHistory, events] = await Promise.all([
    loadBaseReviews(db, reviewId),
    loadCalls(db, reviewId),
    loadApplications(db, reviewId),
    loadSelectedGames(db, reviewId),
    loadDailyFreeReceipts(db),
    loadAnalysisHistory(db),
    loadEvents(db),
  ]);

  const callsByReview = groupBy(calls, (row) => row.reviewId);
  const applicationsByReview = new Map(applications.map((row) => [row.reviewId, row]));
  const gamesByReview = groupBy(selectedGames, (row) => row.reviewId);
  const receiptsByRevision = groupBy(receipts, (row) => row.agentRevisionId);

  const details = reviews.map((review) => toDetail({
    review,
    calls: callsByReview.get(review.id) ?? [],
    application: applicationsByReview.get(review.id) ?? null,
    selectedGames: gamesByReview.get(review.id) ?? [],
    analysisHistory,
    receiptsByRevision,
  }));
  return { details, events };
}

async function loadBaseReviews(db: DrizzleDB, reviewId?: string) {
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
    capacitySubstatus: schema.agentLearningReviews.capacitySubstatus,
    resolution: schema.agentLearningReviews.resolution,
    safeFailureCode: schema.agentLearningReviews.safeFailureCode,
    retryable: schema.agentLearningReviews.retryable,
    logicalCallCount: schema.agentLearningReviews.logicalCallCount,
    diveCount: schema.agentLearningReviews.diveCount,
    result: schema.agentLearningReviews.result,
    proposalFingerprint: schema.agentLearningReviews.proposalFingerprint,
    createdAt: schema.agentLearningReviews.createdAt,
    startedAt: schema.agentLearningReviews.startedAt,
    completedAt: schema.agentLearningReviews.completedAt,
    resolvedAt: schema.agentLearningReviews.resolvedAt,
    updatedAt: schema.agentLearningReviews.updatedAt,
  }).from(schema.agentLearningReviews)
    .innerJoin(schema.users, eq(schema.agentLearningReviews.ownerUserId, schema.users.id))
    .innerJoin(schema.agentProfiles, eq(schema.agentLearningReviews.agentProfileId, schema.agentProfiles.id))
    .innerJoin(schema.agentRevisions, eq(schema.agentLearningReviews.reviewedRevisionId, schema.agentRevisions.id));
  return reviewId
    ? query.where(eq(schema.agentLearningReviews.id, reviewId))
    : query.orderBy(desc(schema.agentLearningReviews.createdAt), desc(schema.agentLearningReviews.id));
}

async function loadCalls(db: DrizzleDB, reviewId?: string) {
  const query = db.select({
    reviewId: schema.agentLearningReviewCalls.reviewId,
    ordinal: schema.agentLearningReviewCalls.ordinal,
    state: schema.agentLearningReviewCalls.state,
    stage: schema.agentLearningReviewCalls.stage,
    requestedTier: schema.agentLearningReviewCalls.requestedTier,
    effectiveTier: schema.agentLearningReviewCalls.effectiveTier,
    requestedReasoningEffort: schema.agentLearningReviewCalls.requestedReasoningEffort,
    tokenReceipt: schema.agentLearningReviewCalls.tokenReceipt,
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
  return reviewId
    ? query.where(eq(schema.agentLearningReviewCalls.reviewId, reviewId))
    : query;
}

async function loadApplications(db: DrizzleDB, reviewId?: string) {
  const query = db.select({
    reviewId: schema.agentLearningReviewApplications.reviewId,
    proposalFingerprint: schema.agentLearningReviewApplications.proposalFingerprint,
    sourceRecommendationIds: schema.agentLearningReviewApplications.sourceRecommendationIds,
    priorRevisionId: schema.agentLearningReviewApplications.priorRevisionId,
    resultingRevisionId: schema.agentLearningReviewApplications.resultingRevisionId,
    priorStrategyStyle: schema.agentLearningReviewApplications.priorStrategyStyle,
    resultingStrategyStyle: schema.agentLearningReviewApplications.resultingStrategyStyle,
    mutationReceipt: schema.agentLearningReviewApplications.mutationReceipt,
    appliedAt: schema.agentLearningReviewApplications.appliedAt,
  }).from(schema.agentLearningReviewApplications);
  return reviewId
    ? query.where(eq(schema.agentLearningReviewApplications.reviewId, reviewId))
    : query;
}

async function loadSelectedGames(db: DrizzleDB, reviewId?: string) {
  const query = db.select({
    reviewId: schema.agentLearningReviewGames.reviewId,
    gameId: schema.agentLearningReviewGames.gameId,
    position: schema.agentLearningReviewGames.position,
    slug: schema.games.slug,
  }).from(schema.agentLearningReviewGames)
    .innerJoin(schema.games, eq(schema.agentLearningReviewGames.gameId, schema.games.id));
  return reviewId
    ? query.where(eq(schema.agentLearningReviewGames.reviewId, reviewId))
    : query;
}

async function loadDailyFreeReceipts(db: DrizzleDB) {
  return db.select({
    agentRevisionId: schema.competitionReceipts.agentRevisionId,
    gameId: schema.competitionReceipts.gameId,
    slug: schema.games.slug,
    placement: schema.competitionReceipts.placement,
    lobbySize: schema.competitionReceipts.lobbySize,
    totalPoints: schema.competitionReceipts.totalPoints,
    earnedAt: schema.competitionReceipts.earnedAt,
  }).from(schema.competitionReceipts)
    .innerJoin(schema.games, eq(schema.competitionReceipts.gameId, schema.games.id))
    .where(and(
      eq(schema.games.trackType, "free"),
      eq(schema.competitionReceipts.eligibilityStatus, "eligible"),
    ));
}

async function loadAnalysisHistory(db: DrizzleDB) {
  return db.select({
    reviewId: schema.agentLearningReviewGames.reviewId,
    gameId: schema.agentLearningReviewGames.gameId,
    reviewCreatedAt: schema.agentLearningReviews.createdAt,
    reviewCompletedAt: schema.agentLearningReviews.completedAt,
    analysisStatus: schema.agentLearningReviews.analysisStatus,
  }).from(schema.agentLearningReviewGames)
    .innerJoin(
      schema.agentLearningReviews,
      eq(schema.agentLearningReviewGames.reviewId, schema.agentLearningReviews.id),
    );
}

async function loadEvents(db: DrizzleDB) {
  return db.select({
    kind: schema.agentLearningEvents.kind,
    reviewId: schema.agentLearningEvents.reviewId,
    occurredAt: schema.agentLearningEvents.occurredAt,
  }).from(schema.agentLearningEvents);
}

function toDetail(input: {
  review: BaseReviewRow;
  calls: CallRow[];
  application: ApplicationRow | null;
  selectedGames: SelectedGameRow[];
  analysisHistory: AnalysisHistoryRow[];
  receiptsByRevision: Map<string, DailyFreeReceiptRow[]>;
}): AdminOwnerLearningReviewDetail {
  const result = input.review.result == null
    ? null
    : parseOwnerLearningReviewResult(input.review.result);
  const calls = input.calls.sort((left, right) => left.ordinal - right.ordinal).map(toCall);
  const tokens = aggregateTokens(calls);
  const cost = aggregateCost(calls);
  const disposition = deriveAdminDisposition(input.review, input.application);
  const acceptance = deriveAcceptance(disposition);
  const acceptedRecommendationIds = new Set(input.application?.sourceRecommendationIds ?? []);
  const selectedGames = input.selectedGames
    .sort((left, right) => left.position - right.position)
    .map((game) => ({
      gameId: game.gameId,
      slug: game.slug,
      position: game.position,
      previouslyAnalyzed: input.analysisHistory.some((prior) => {
        if (prior.gameId !== game.gameId || prior.reviewId === input.review.id) return false;
        return prior.reviewCompletedAt != null
          && prior.reviewCreatedAt < input.review.createdAt
          && ["ready", "no_change"].includes(prior.analysisStatus);
      }),
    }));
  const anchor = input.application?.appliedAt
    ?? input.review.resolvedAt
    ?? input.review.completedAt;
  const correlationRevisionId = input.application?.resultingRevisionId
    ?? (["manual_update", "superseded"].includes(input.review.resolution ?? "")
      ? null
      : input.review.reviewedRevisionId);
  const subsequentGames = correlationRevisionId && anchor
    ? (input.receiptsByRevision.get(correlationRevisionId) ?? [])
      .filter((receipt) => receipt.earnedAt > anchor && receipt.placement != null)
      .sort((left, right) => left.earnedAt.localeCompare(right.earnedAt))
      .map((receipt) => ({
        gameId: receipt.gameId,
        slug: receipt.slug,
        placement: receipt.placement!,
        lobbySize: receipt.lobbySize,
        totalPoints: receipt.totalPoints,
        earnedAt: receipt.earnedAt,
      }))
    : [];

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
    selectedGames,
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
      capacitySubstatus: input.review.capacitySubstatus,
      resolution: input.review.resolution,
      safeFailureCode: input.review.safeFailureCode,
      retryable: input.review.retryable,
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
    result,
    recommendationAcceptance: (result?.recommendations ?? []).map((recommendation) => ({
      recommendationId: recommendation.id ?? null,
      state: disposition === "no_change"
        ? "not_applicable"
        : recommendation.id && acceptedRecommendationIds.has(recommendation.id)
          ? "accepted"
          : "not_accepted",
    })),
    proposalFingerprint: input.review.proposalFingerprint,
    calls,
    tokens,
    cost,
    application: input.application
      ? {
          proposalFingerprint: input.application.proposalFingerprint,
          sourceRecommendationIds: [...input.application.sourceRecommendationIds],
          priorRevisionId: input.application.priorRevisionId,
          resultingRevisionId: input.application.resultingRevisionId,
          priorStrategyStyle: input.application.priorStrategyStyle,
          resultingStrategyStyle: input.application.resultingStrategyStyle,
          appliedAt: input.application.appliedAt,
          mutationReceipt: summarizeMutationReceipt(input.application.mutationReceipt),
        }
      : null,
    subsequentDailyFree: correlationRevisionId && anchor
      ? {
          label: "Later Daily Free games on this executed revision — correlation, not causal proof",
          revisionId: correlationRevisionId,
          games: subsequentGames,
        }
      : null,
  };
}

function toCall(row: CallRow): AdminOwnerLearningCall {
  const input = finiteToken(row.tokenReceipt?.inputTokens);
  const cachedInput = finiteToken(row.tokenReceipt?.cachedInputTokens);
  const totalOutput = finiteToken(row.tokenReceipt?.totalOutputTokens);
  const reasoning = finiteToken(row.tokenReceipt?.reasoningTokens);
  return {
    ordinal: row.ordinal,
    state: row.state,
    stage: row.stage,
    requestedTier: row.requestedTier,
    effectiveTier: row.effectiveTier,
    requestedReasoningEffort: row.requestedReasoningEffort,
    capacityPath: row.capacityPath,
    flex429Count: row.flex429Count,
    latencyMs: row.latencyMs,
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

function aggregateTokens(calls: AdminOwnerLearningCall[]): AdminOwnerLearningTokenTotals {
  return calls.reduce<AdminOwnerLearningTokenTotals>((total, call) => {
    if (call.tokens.input == null
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
    if (call.cost.source === "unavailable") total.unavailableCallCount += 1;
    return total;
  }, emptyCostTotals());
}

function toSummary(detail: AdminOwnerLearningReviewDetail): AdminOwnerLearningReviewSummary {
  return {
    id: detail.id,
    owner: detail.owner,
    agent: detail.agent,
    reviewedRevision: detail.reviewedRevision,
    selectedGameCount: detail.selectedGames.length,
    track: detail.lifecycle.track,
    status: detail.lifecycle.status,
    stage: detail.lifecycle.stage,
    resolution: detail.lifecycle.resolution,
    diagnosis: detail.result?.diagnosis ?? null,
    model: detail.policy.model,
    disposition: detail.disposition,
    acceptance: detail.acceptance,
    recommendationCount: detail.result?.recommendations.length ?? 0,
    logicalCallCount: detail.lifecycle.logicalCallCount,
    diveCount: detail.lifecycle.diveCount,
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

function aggregateEventCounts(
  events: EventRow[],
  details: AdminOwnerLearningReviewDetail[],
  filters: AdminOwnerLearningReviewFilters,
): Partial<Record<OwnerLearningEventKind, number>> {
  const reviewIds = new Set(details.map((detail) => detail.id));
  const hasReviewFilters = Boolean(
    filters.track || filters.diagnosis || filters.status || filters.model
    || filters.resolution || filters.application,
  );
  const counts: Partial<Record<OwnerLearningEventKind, number>> = {};
  for (const event of events) {
    if (filters.dateFrom && event.occurredAt < filters.dateFrom) continue;
    if (filters.dateTo && event.occurredAt > filters.dateTo) continue;
    if (event.reviewId ? !reviewIds.has(event.reviewId) : hasReviewFilters) continue;
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  }
  return counts;
}

function deriveAcceptance(disposition: AdminOwnerLearningDisposition): AdminOwnerLearningAcceptance {
  if (disposition === "applied") return "accepted";
  if (disposition === "no_change") return "not_applicable";
  if (disposition === "not_ready" || disposition === "awaiting_owner") return "pending";
  return "not_accepted";
}

function matchesFilters(
  detail: AdminOwnerLearningReviewDetail,
  filters: AdminOwnerLearningReviewFilters,
): boolean {
  if (filters.dateFrom && detail.lifecycle.createdAt < filters.dateFrom) return false;
  if (filters.dateTo && detail.lifecycle.createdAt > filters.dateTo) return false;
  if (filters.track && detail.lifecycle.track !== filters.track) return false;
  if (filters.status && detail.lifecycle.status !== filters.status) return false;
  if (filters.model && detail.policy.model !== filters.model) return false;
  if (filters.resolution === "open" && detail.lifecycle.resolution != null) return false;
  if (filters.resolution && filters.resolution !== "open"
    && detail.lifecycle.resolution !== filters.resolution) return false;
  if (filters.application && detail.acceptance !== filters.application) return false;
  if (filters.diagnosis
    && !detail.result?.diagnosis.toLocaleLowerCase().includes(filters.diagnosis.toLocaleLowerCase())) {
    return false;
  }
  return true;
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

function summarizeMutationReceipt(value: Record<string, unknown>): AdminOwnerLearningMutationReceiptSummary {
  const profileRevision = recordValue(value.profileRevision);
  const waitingSeats = recordValue(value.waitingSeats);
  const frozenSeats = recordValue(value.frozenSeats);
  return {
    schemaVersion: finiteNumber(value.schemaVersion),
    operation: stringValue(value.operation),
    profileRevision: profileRevision
      ? {
          revisionId: stringValue(profileRevision.revisionId),
          ordinal: finiteNumber(profileRevision.ordinal),
          outcome: stringValue(profileRevision.outcome),
        }
      : null,
    dailyFree: stringValue(value.dailyFree),
    waitingSeats: waitingSeats
      ? {
          total: finiteNumber(waitingSeats.total),
          reconciled: finiteNumber(waitingSeats.reconciled),
          alreadyCurrent: finiteNumber(waitingSeats.alreadyCurrent),
          crossedFreeze: finiteNumber(waitingSeats.crossedFreeze),
          truncatedCount: finiteNumber(waitingSeats.truncatedCount),
        }
      : null,
    frozenSeats: frozenSeats ? { unchanged: finiteNumber(frozenSeats.unchanged) } : null,
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
  };
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const identity = key(row);
    const group = groups.get(identity) ?? [];
    group.push(row);
    groups.set(identity, group);
  }
  return groups;
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

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
