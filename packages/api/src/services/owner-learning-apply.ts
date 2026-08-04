import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  AgentProfileManagementError,
  ExpandedWaitingGameSetError,
  findWaitingFollowerGames,
  lockOwnedAgentProfileMutationInTransaction,
  updateOwnedAgentProfileInLockedTransaction,
} from "./agent-profile-management.js";
import type { AgentMutationReceipt } from "./agent-mutation-receipt.js";
import { createOwnerLearningEvent } from "./owner-learning-events.js";
import { abortActiveOwnerLearningReview } from "./owner-learning-worker.js";
import {
  lockOwnedOwnerLearningReview,
  OwnerLearningResolutionError,
  persistOwnerLearningResolution,
  type OwnerLearningResolutionTransaction,
} from "./owner-learning-resolution.js";

export type OwnerLearningApplyErrorCode =
  | "review_not_found"
  | "review_not_ready"
  | "proposal_mismatch"
  | "recommendation_mismatch"
  | "review_revision_conflict"
  | "profile_update_conflict";

export class OwnerLearningApplyError extends Error {
  constructor(
    readonly code: OwnerLearningApplyErrorCode,
    readonly statusCode: 404 | 409,
    readonly retryable = false,
  ) {
    super(code);
    this.name = "OwnerLearningApplyError";
  }
}

export interface OwnerLearningApplyRead {
  reviewId: string;
  proposalFingerprint: string;
  sourceRecommendationIds: string[];
  priorRevisionId: string;
  resultingRevisionId: string;
  priorStrategyStyle: string;
  resultingStrategyStyle: string;
  receipt: AgentMutationReceipt;
  appliedAt: string;
  replayed: boolean;
}

export async function applyOwnedOwnerLearningReview(
  db: DrizzleDB,
  input: {
    ownerUserId: string;
    reviewId: unknown;
    proposalFingerprint: unknown;
    recommendationIds: unknown;
    now?: Date;
  },
): Promise<OwnerLearningApplyRead> {
  const reviewId = requiredString(input.reviewId, "reviewId", 200, "review_not_found");
  const proposalFingerprint = requiredString(
    input.proposalFingerprint,
    "proposalFingerprint",
    200,
    "proposal_mismatch",
  );
  const recommendationIds = parseRecommendationIds(input.recommendationIds);
  const preview = (await db.select({ agentProfileId: schema.agentLearningReviews.agentProfileId })
    .from(schema.agentLearningReviews).where(and(
      eq(schema.agentLearningReviews.id, reviewId),
      eq(schema.agentLearningReviews.ownerUserId, input.ownerUserId),
    )).limit(1))[0];
  if (!preview) throw new OwnerLearningApplyError("review_not_found", 404);

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidateGames = await findWaitingFollowerGames(db, preview.agentProfileId);
    try {
      const applied = await db.transaction(async (tx) => {
        const lockedProfile = await lockOwnedAgentProfileMutationInTransaction(tx, {
          context: { userId: input.ownerUserId },
          agentId: preview.agentProfileId,
          candidateGames,
        });
        const review = await lockOwnedOwnerLearningReview(tx, {
          ownerUserId: input.ownerUserId,
          reviewId,
        });
        await tx.execute(sql`
          SELECT review_id
          FROM agent_learning_review_applications
          WHERE review_id = ${reviewId}
          FOR UPDATE
        `);
        const existingApplication = (await tx.select()
          .from(schema.agentLearningReviewApplications)
          .where(eq(schema.agentLearningReviewApplications.reviewId, reviewId)).limit(1))[0];
        if (existingApplication) {
          assertApplyIdentity(existingApplication, proposalFingerprint, recommendationIds);
          return applicationRead(existingApplication, true);
        }
        if (
          review.resolvedAt != null
          || review.analysisStatus !== "ready"
          || review.result?.proposal == null
          || review.proposalFingerprint == null
        ) {
          throw new OwnerLearningApplyError("review_not_ready", 409);
        }
        if (review.proposalFingerprint !== proposalFingerprint) {
          throw new OwnerLearningApplyError("proposal_mismatch", 409);
        }
        const expectedRecommendationIds = changeRecommendationIds(review.result.recommendations);
        if (!sameOrderedValues(recommendationIds, expectedRecommendationIds)) {
          throw new OwnerLearningApplyError("recommendation_mismatch", 409);
        }
        const currentStrategyStyle = lockedProfile.existing.strategyStyle ?? "";
        if (
          lockedProfile.existing.currentRevisionId !== review.reviewedRevisionId
          || review.result.proposal.before !== currentStrategyStyle
        ) {
          throw new OwnerLearningApplyError("review_revision_conflict", 409);
        }

        const mutation = await updateOwnedAgentProfileInLockedTransaction(tx, {
          context: { userId: input.ownerUserId },
          agentId: review.agentProfileId,
          input: { strategyStyle: review.result.proposal.after },
          locked: lockedProfile,
        });
        const nowIso = (input.now ?? new Date()).toISOString();
        const application = {
          reviewId: review.id,
          proposalFingerprint,
          sourceRecommendationIds: expectedRecommendationIds,
          priorRevisionId: review.reviewedRevisionId,
          resultingRevisionId: mutation.profileRevision.revisionId,
          priorStrategyStyle: currentStrategyStyle,
          resultingStrategyStyle: review.result.proposal.after,
          mutationReceipt: mutation.receipt as unknown as Record<string, unknown>,
          appliedAt: nowIso,
        };
        await tx.insert(schema.agentLearningReviewApplications).values(application);
        await persistOwnerLearningResolution(tx, {
          review,
          resolution: "applied",
          nowIso,
        });
        await insertProposalAppliedEvent(tx, {
          ownerUserId: review.ownerUserId,
          reviewId: review.id,
          agentProfileId: review.agentProfileId,
          priorRevisionId: review.reviewedRevisionId,
          resultingRevisionId: mutation.profileRevision.revisionId,
          nowIso,
        });
        return applicationRead(application, false);
      });
      abortActiveOwnerLearningReview(reviewId);
      return applied;
    } catch (error) {
      if (error instanceof ExpandedWaitingGameSetError) {
        if (attempt < maxAttempts) continue;
        throw new OwnerLearningApplyError("profile_update_conflict", 409, true);
      }
      if (error instanceof OwnerLearningApplyError) throw error;
      if (error instanceof OwnerLearningResolutionError) {
        throw new OwnerLearningApplyError(
          error.code === "review_not_found" ? "review_not_found" : "review_not_ready",
          error.statusCode,
        );
      }
      if (error instanceof AgentProfileManagementError) {
        throw new OwnerLearningApplyError(
          error.code === "agent_update_conflict"
            ? "review_revision_conflict"
            : "profile_update_conflict",
          error.statusCode === 404 ? 404 : 409,
          error.retryable,
        );
      }
      throw error;
    }
  }
  throw new Error("Owner learning apply attempts exhausted unexpectedly");
}

function assertApplyIdentity(
  application: typeof schema.agentLearningReviewApplications.$inferSelect,
  proposalFingerprint: string,
  recommendationIds: readonly string[],
): void {
  if (application.proposalFingerprint !== proposalFingerprint) {
    throw new OwnerLearningApplyError("proposal_mismatch", 409);
  }
  if (!sameOrderedValues(application.sourceRecommendationIds, recommendationIds)) {
    throw new OwnerLearningApplyError("recommendation_mismatch", 409);
  }
}

function changeRecommendationIds(
  recommendations: NonNullable<typeof schema.agentLearningReviews.$inferSelect.result>["recommendations"],
): string[] {
  const ids = recommendations
    .filter((recommendation) => recommendation.disposition === "change")
    .map((recommendation) => recommendation.id);
  if (ids.length === 0 || ids.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new OwnerLearningApplyError("recommendation_mismatch", 409);
  }
  return ids as string[];
}

function applicationRead(
  application: typeof schema.agentLearningReviewApplications.$inferSelect,
  replayed: boolean,
): OwnerLearningApplyRead {
  return {
    reviewId: application.reviewId,
    proposalFingerprint: application.proposalFingerprint,
    sourceRecommendationIds: [...application.sourceRecommendationIds],
    priorRevisionId: application.priorRevisionId,
    resultingRevisionId: application.resultingRevisionId,
    priorStrategyStyle: application.priorStrategyStyle,
    resultingStrategyStyle: application.resultingStrategyStyle,
    receipt: application.mutationReceipt as unknown as AgentMutationReceipt,
    appliedAt: application.appliedAt,
    replayed,
  };
}

function parseRecommendationIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new OwnerLearningApplyError("recommendation_mismatch", 409);
  }
  const ids = value.map((entry) => requiredString(
    entry,
    "recommendationId",
    200,
    "recommendation_mismatch",
  ));
  if (new Set(ids).size !== ids.length) {
    throw new OwnerLearningApplyError("recommendation_mismatch", 409);
  }
  return ids;
}

function requiredString(
  value: unknown,
  _label: string,
  maxLength: number,
  code: "review_not_found" | "proposal_mismatch" | "recommendation_mismatch",
): string {
  if (typeof value !== "string") {
    throw new OwnerLearningApplyError(code, code === "review_not_found" ? 404 : 409);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new OwnerLearningApplyError(
      code,
      code === "review_not_found" ? 404 : 409,
    );
  }
  return normalized;
}

function sameOrderedValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function insertProposalAppliedEvent(
  tx: OwnerLearningResolutionTransaction,
  input: {
    ownerUserId: string;
    reviewId: string;
    agentProfileId: string;
    priorRevisionId: string;
    resultingRevisionId: string;
    nowIso: string;
  },
): Promise<void> {
  const event = createOwnerLearningEvent("proposal_applied", {
    ownerUserId: input.ownerUserId,
    reviewId: input.reviewId,
    agentProfileId: input.agentProfileId,
    occurredAt: input.nowIso,
  }, {
    priorRevisionId: input.priorRevisionId,
    resultingRevisionId: input.resultingRevisionId,
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
