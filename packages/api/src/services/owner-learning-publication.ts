import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { schema } from "../db/index.js";
import type { AgentMutationReceipt } from "./agent-mutation-receipt.js";
import type { OwnerLearningResolutionTransaction } from "./owner-learning-resolution.js";
import {
  lockOwnedOwnerLearningReview,
  persistOwnerLearningResolution,
  resolveOwnerLearningReviewForProfileMutation,
} from "./owner-learning-resolution.js";
import {
  currentReviewIdentity,
  reviewStrategyField,
} from "./owner-learning-game.js";
import { createOwnerLearningEvent } from "./owner-learning-events.js";
type Profile = typeof schema.agentProfiles.$inferSelect;
/** The profile lock is held by the publishing transaction; learning resolves only on acceptance. */
export async function finalizePublishedLearning(
  tx: OwnerLearningResolutionTransaction,
  before: Profile,
  after: Profile,
  revisionId: string,
  snapshot: Record<string, unknown>,
  receipt: AgentMutationReceipt,
) {
  const [candidate] = await tx
    .select({ id: schema.agentLearningReviews.id })
    .from(schema.agentLearningReviews)
    .where(
      and(
        eq(schema.agentLearningReviews.agentProfileId, after.id),
        isNull(schema.agentLearningReviews.resolvedAt),
      ),
    )
    .limit(1);
  if (!candidate) return null;
  const review = await lockOwnedOwnerLearningReview(tx, {
    ownerUserId: after.userId,
    reviewId: candidate.id,
  });
  const [application] = await tx
    .select()
    .from(schema.agentLearningReviewApplications)
    .where(eq(schema.agentLearningReviewApplications.reviewId, review.id))
    .for("update");
  const nowIso = new Date().toISOString();
  if (
    application?.submissionContentRevisionId === revisionId &&
    !application.appliedAt
  ) {
    const resultingRevisionId = currentReviewIdentity(review.gameKind, after);
    if (!resultingRevisionId)
      throw new Error("Accepted strategy revision is unavailable");
    await tx
      .update(schema.agentLearningReviewApplications)
      .set({
        resultingRevisionId,
        appliedAt: nowIso,
        mutationReceipt: receipt as unknown as Record<string, unknown>,
      })
      .where(eq(schema.agentLearningReviewApplications.reviewId, review.id));
    await persistOwnerLearningResolution(tx, {
      review,
      resolution: "applied",
      nowIso,
    });
    const event = createOwnerLearningEvent(
      "proposal_applied",
      {
        ownerUserId: after.userId,
        reviewId: review.id,
        agentProfileId: after.id,
        occurredAt: nowIso,
      },
      { priorRevisionId: application.priorRevisionId, resultingRevisionId },
    );
    await tx
      .insert(schema.agentLearningEvents)
      .values({
        id: randomUUID(),
        ownerUserId: after.userId,
        reviewId: review.id,
        agentProfileId: after.id,
        kind: event.kind,
        payload: event.payload,
        occurredAt: nowIso,
      });
    return review.id;
  }
  const resolution = await resolveOwnerLearningReviewForProfileMutation(tx, {
    review,
    sourceReviewId:
      typeof snapshot.sourceReviewId === "string"
        ? snapshot.sourceReviewId
        : undefined,
    analyticalRevisionChanged:
      currentReviewIdentity(review.gameKind, before) !==
        currentReviewIdentity(review.gameKind, after) ||
      (review.gameKind === "werewolf" &&
        before.werewolfStrategyStyle !== after.werewolfStrategyStyle),
    resultingStrategyStyle: after[reviewStrategyField(review.gameKind)],
    nowIso,
  });
  return resolution ? review.id : null;
}
