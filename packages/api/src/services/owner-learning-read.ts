import { and, asc, eq, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type {
  OwnerLearningApplyDisposition,
  OwnerLearningReviewDTO,
} from "./owner-learning-contracts.js";

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
    logicalCallCount: row.review.logicalCallCount,
    diveCount: row.review.diveCount,
    applyDisposition: deriveApplyDisposition({
      review: row.review,
      currentRevisionId: row.currentRevisionId,
      applicationExists: application != null,
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

function deriveApplyDisposition(input: {
  review: typeof schema.agentLearningReviews.$inferSelect;
  currentRevisionId: string | null;
  applicationExists: boolean;
}): OwnerLearningApplyDisposition {
  if (input.applicationExists) return "applied";
  if (input.review.resolution) return input.review.resolution;
  if (input.review.analysisStatus === "no_change") return "no_change";
  if (input.review.analysisStatus === "failed") return "failed";
  if (input.review.analysisStatus !== "ready") return "not_ready";
  if (
    input.review.result?.proposal
    && input.review.proposalFingerprint
    && input.currentRevisionId === input.review.reviewedRevisionId
  ) return "available";
  return "unavailable";
}
