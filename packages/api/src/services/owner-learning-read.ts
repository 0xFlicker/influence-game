import { and, asc, eq, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type {
  OwnerLearningReviewDTO,
  OwnerLearningReviewStatusDTO,
} from "./owner-learning-contracts.js";
import { deriveOwnerLearningApplyDisposition } from "./owner-learning-contracts.js";

export class OwnerLearningReadError extends Error {
  constructor(readonly code = "review_unavailable" as const) {
    super(code);
    this.name = "OwnerLearningReadError";
  }
}

export async function getOwnedOwnerLearningReview(
  db: DrizzleDB,
  input: {
    ownerUserId: string;
    reviewId: string;
    agentProfileId?: string;
  },
): Promise<OwnerLearningReviewDTO> {
  const row = (await db.select({
    review: schema.agentLearningReviews,
    currentRevisionId: schema.agentProfiles.currentRevisionId,
  }).from(schema.agentLearningReviews)
    .innerJoin(schema.agentProfiles, and(
      eq(schema.agentLearningReviews.agentProfileId, schema.agentProfiles.id),
      eq(schema.agentProfiles.userId, input.ownerUserId),
    ))
    .where(and(
      eq(schema.agentLearningReviews.id, input.reviewId),
      eq(schema.agentLearningReviews.ownerUserId, input.ownerUserId),
      ...(input.agentProfileId
        ? [eq(schema.agentLearningReviews.agentProfileId, input.agentProfileId)]
        : []),
    )).limit(1))[0];
  if (!row) throw new OwnerLearningReadError();

  const [evidenceRows, applicationRows] = await Promise.all([
    db.select({
      gameId: schema.agentLearningReviewGames.gameId,
      position: schema.agentLearningReviewGames.position,
      canonicalFacts: schema.agentLearningGameEvidence.canonicalSnapshot,
      candidateMoments: schema.agentLearningGameEvidence.candidateMoments,
      sourceCaptureVersion: schema.agentLearningGameEvidence.sourceCaptureVersion,
      sourceHash: schema.agentLearningGameEvidence.sourceHash,
    }).from(schema.agentLearningReviewGames)
      .innerJoin(
        schema.agentLearningGameEvidence,
        eq(schema.agentLearningReviewGames.gameEvidenceId, schema.agentLearningGameEvidence.id),
      )
      .where(and(
        eq(schema.agentLearningReviewGames.reviewId, row.review.id),
        eq(schema.agentLearningGameEvidence.ownerUserId, input.ownerUserId),
        eq(schema.agentLearningGameEvidence.agentProfileId, row.review.agentProfileId),
      ))
      .orderBy(asc(schema.agentLearningReviewGames.position)),
    db.select().from(schema.agentLearningReviewApplications)
      .where(eq(schema.agentLearningReviewApplications.reviewId, row.review.id)).limit(1),
  ]);
  const application = applicationRows[0] ?? null;
  return {
    id: row.review.id,
    agentProfileId: row.review.agentProfileId,
    reviewedRevisionId: row.review.reviewedRevisionId,
    selectedGameIds: evidenceRows.map((entry) => entry.gameId),
    analysisTrack: row.review.analysisTrack,
    analysisStatus: row.review.analysisStatus,
    stage: row.review.stage,
    capacitySubstatus: row.review.capacitySubstatus,
    resolution: row.review.resolution,
    result: row.review.result ?? null,
    proposalFingerprint: row.review.proposalFingerprint,
    safeFailureCode: row.review.safeFailureCode,
    retryable: row.review.retryable,
    ownerRetriesRemaining: row.review.ownerRetryCount === 0 ? 1 : 0,
    logicalCallCount: row.review.logicalCallCount,
    diveCount: row.review.diveCount,
    applyDisposition: deriveOwnerLearningApplyDisposition({
      analysisStatus: row.review.analysisStatus,
      resolution: row.review.resolution,
      hasProposal: Boolean(row.review.result?.proposal && row.review.proposalFingerprint),
      hasApplication: application != null,
      reviewedRevisionIsCurrent: row.currentRevisionId === row.review.reviewedRevisionId,
    }),
    evidence: {
      games: evidenceRows.map((entry) => ({
        gameId: entry.gameId,
        position: entry.position,
        canonicalFacts: entry.canonicalFacts,
        candidateMoments: entry.candidateMoments,
        sourceCaptureVersion: entry.sourceCaptureVersion,
        sourceHash: entry.sourceHash,
      })),
    },
    application: application
      ? {
          sourceRecommendationIds: [...application.sourceRecommendationIds],
          priorRevisionId: application.priorRevisionId,
          resultingRevisionId: application.resultingRevisionId,
          priorStrategyStyle: application.priorStrategyStyle,
          resultingStrategyStyle: application.resultingStrategyStyle,
          mutationReceipt: application.mutationReceipt,
          appliedAt: application.appliedAt,
        }
      : null,
    createdAt: row.review.createdAt,
    updatedAt: row.review.updatedAt,
    resolvedAt: row.review.resolvedAt,
  };
}

export async function getOwnedOwnerLearningReviewStatus(
  db: DrizzleDB,
  input: {
    ownerUserId: string;
    reviewId: string;
    agentProfileId?: string;
  },
): Promise<OwnerLearningReviewStatusDTO> {
  const row = (await db.select({
    analysisStatus: schema.agentLearningReviews.analysisStatus,
    stage: schema.agentLearningReviews.stage,
    capacitySubstatus: schema.agentLearningReviews.capacitySubstatus,
    resolution: schema.agentLearningReviews.resolution,
    result: schema.agentLearningReviews.result,
    proposalFingerprint: schema.agentLearningReviews.proposalFingerprint,
    safeFailureCode: schema.agentLearningReviews.safeFailureCode,
    retryable: schema.agentLearningReviews.retryable,
    ownerRetryCount: schema.agentLearningReviews.ownerRetryCount,
    logicalCallCount: schema.agentLearningReviews.logicalCallCount,
    diveCount: schema.agentLearningReviews.diveCount,
    reviewedRevisionId: schema.agentLearningReviews.reviewedRevisionId,
    currentRevisionId: schema.agentProfiles.currentRevisionId,
    applicationId: schema.agentLearningReviewApplications.reviewId,
    updatedAt: schema.agentLearningReviews.updatedAt,
    resolvedAt: schema.agentLearningReviews.resolvedAt,
  }).from(schema.agentLearningReviews)
    .innerJoin(schema.agentProfiles, and(
      eq(schema.agentLearningReviews.agentProfileId, schema.agentProfiles.id),
      eq(schema.agentProfiles.userId, input.ownerUserId),
    ))
    .leftJoin(
      schema.agentLearningReviewApplications,
      eq(schema.agentLearningReviewApplications.reviewId, schema.agentLearningReviews.id),
    )
    .where(and(
      eq(schema.agentLearningReviews.id, input.reviewId),
      eq(schema.agentLearningReviews.ownerUserId, input.ownerUserId),
      ...(input.agentProfileId
        ? [eq(schema.agentLearningReviews.agentProfileId, input.agentProfileId)]
        : []),
    )).limit(1))[0];
  if (!row) throw new OwnerLearningReadError();

  return {
    analysisStatus: row.analysisStatus,
    stage: row.stage,
    capacitySubstatus: row.capacitySubstatus,
    resolution: row.resolution,
    proposalFingerprint: row.proposalFingerprint,
    safeFailureCode: row.safeFailureCode,
    retryable: row.retryable,
    ownerRetriesRemaining: row.ownerRetryCount === 0 ? 1 : 0,
    logicalCallCount: row.logicalCallCount,
    diveCount: row.diveCount,
    applyDisposition: deriveOwnerLearningApplyDisposition({
      analysisStatus: row.analysisStatus,
      resolution: row.resolution,
      hasProposal: Boolean(row.result?.proposal && row.proposalFingerprint),
      hasApplication: row.applicationId != null,
      reviewedRevisionIsCurrent: row.currentRevisionId === row.reviewedRevisionId,
    }),
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
  };
}

export async function listOpenOwnedOwnerLearningReviews(
  db: DrizzleDB,
  input: { ownerUserId: string },
): Promise<OwnerLearningReviewDTO[]> {
  const rows = await db.select({ id: schema.agentLearningReviews.id })
    .from(schema.agentLearningReviews)
    .where(and(
      eq(schema.agentLearningReviews.ownerUserId, input.ownerUserId),
      sql`${schema.agentLearningReviews.resolvedAt} IS NULL`,
    )).limit(1);
  if (rows.length === 0) return [];
  return [await getOwnedOwnerLearningReview(db, {
    ownerUserId: input.ownerUserId,
    reviewId: rows[0]!.id,
  })];
}
