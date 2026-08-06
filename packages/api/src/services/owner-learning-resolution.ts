import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { OwnerLearningResolution } from "./owner-learning-contracts.js";
import { createOwnerLearningEvent } from "./owner-learning-events.js";
import { abortActiveOwnerLearningReview } from "./owner-learning-worker.js";

export type OwnerLearningResolutionTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
export type LockedOwnerLearningReview = typeof schema.agentLearningReviews.$inferSelect;

export type OwnerLearningResolutionErrorCode =
  | "review_not_found"
  | "review_profile_mismatch"
  | "review_state_conflict";

export class OwnerLearningResolutionError extends Error {
  constructor(
    readonly code: OwnerLearningResolutionErrorCode,
    readonly statusCode: 404 | 409,
  ) {
    super(code);
    this.name = "OwnerLearningResolutionError";
  }
}

export async function lockOwnedOwnerLearningReview(
  tx: OwnerLearningResolutionTransaction,
  input: { ownerUserId: string; reviewId: string },
): Promise<LockedOwnerLearningReview> {
  await tx.execute(sql`
    SELECT id
    FROM agent_learning_reviews
    WHERE id = ${input.reviewId}
    FOR UPDATE
  `);
  const review = (await tx.select().from(schema.agentLearningReviews).where(and(
    eq(schema.agentLearningReviews.id, input.reviewId),
    eq(schema.agentLearningReviews.ownerUserId, input.ownerUserId),
  )).limit(1))[0];
  if (!review) throw new OwnerLearningResolutionError("review_not_found", 404);
  return review;
}

export async function lockOwnerLearningReviewForProfileMutation(
  tx: OwnerLearningResolutionTransaction,
  input: {
    ownerUserId: string;
    agentProfileId: string;
    sourceReviewId?: string;
  },
): Promise<LockedOwnerLearningReview | null> {
  if (input.sourceReviewId) {
    const review = await lockOwnedOwnerLearningReview(tx, {
      ownerUserId: input.ownerUserId,
      reviewId: input.sourceReviewId,
    });
    if (review.agentProfileId !== input.agentProfileId) {
      throw new OwnerLearningResolutionError("review_profile_mismatch", 409);
    }
    if (review.resolvedAt != null) {
      throw new OwnerLearningResolutionError("review_state_conflict", 409);
    }
    if (
      review.analysisStatus !== "ready"
      || review.proposalFingerprint == null
      || review.result?.proposal == null
    ) {
      throw new OwnerLearningResolutionError("review_state_conflict", 409);
    }
    return review;
  }

  const candidate = (await tx.select({ id: schema.agentLearningReviews.id })
    .from(schema.agentLearningReviews)
    .where(and(
      eq(schema.agentLearningReviews.ownerUserId, input.ownerUserId),
      eq(schema.agentLearningReviews.agentProfileId, input.agentProfileId),
      sql`${schema.agentLearningReviews.resolvedAt} IS NULL`,
    )).limit(1))[0];
  if (!candidate) return null;
  await tx.execute(sql`
    SELECT id
    FROM agent_learning_reviews
    WHERE id = ${candidate.id}
    FOR UPDATE
  `);
  return (await tx.select().from(schema.agentLearningReviews)
    .where(eq(schema.agentLearningReviews.id, candidate.id)).limit(1))[0] ?? null;
}

export async function resolveOwnerLearningReviewForProfileMutation(
  tx: OwnerLearningResolutionTransaction,
  input: {
    review: LockedOwnerLearningReview | null;
    sourceReviewId?: string;
    analyticalRevisionChanged: boolean;
    nowIso: string;
    idFactory?: () => string;
  },
): Promise<"manual_update" | "superseded" | null> {
  if (!input.review) return null;
  const resolution = input.sourceReviewId
    ? input.analyticalRevisionChanged ? "manual_update" as const : null
    : input.analyticalRevisionChanged
      ? "superseded" as const
      : null;
  if (!resolution) return null;
  await persistOwnerLearningResolution(tx, {
    review: input.review,
    resolution,
    nowIso: input.nowIso,
    idFactory: input.idFactory,
  });
  if (resolution === "superseded") {
    await insertEvent(tx, createOwnerLearningEvent("review_superseded", {
      ownerUserId: input.review.ownerUserId,
      reviewId: input.review.id,
      agentProfileId: input.review.agentProfileId,
      occurredAt: input.nowIso,
    }, { source: "unlinked_profile_update" }), input.idFactory);
  }
  return resolution;
}

export async function persistOwnerLearningResolution(
  tx: OwnerLearningResolutionTransaction,
  input: {
    review: LockedOwnerLearningReview;
    resolution: OwnerLearningResolution;
    nowIso: string;
    idFactory?: () => string;
  },
): Promise<void> {
  const updated = await tx.update(schema.agentLearningReviews).set({
    resolution: input.resolution,
    resolvedAt: input.nowIso,
    ...(input.review.analysisStatus === "running"
      ? {}
      : {
          leaseTokenHash: null,
          leaseExpiresAt: null,
        }),
    capacitySubstatus: null,
    updatedAt: input.nowIso,
  }).where(and(
    eq(schema.agentLearningReviews.id, input.review.id),
    sql`${schema.agentLearningReviews.resolvedAt} IS NULL`,
  )).returning({ id: schema.agentLearningReviews.id });
  if (updated.length !== 1) {
    throw new OwnerLearningResolutionError("review_state_conflict", 409);
  }
  await insertEvent(tx, createOwnerLearningEvent("review_resolved", {
    ownerUserId: input.review.ownerUserId,
    reviewId: input.review.id,
    agentProfileId: input.review.agentProfileId,
    occurredAt: input.nowIso,
  }, { resolution: input.resolution }), input.idFactory);
}

export async function resolveOwnedOwnerLearningReview(
  db: DrizzleDB,
  input: {
    ownerUserId: string;
    reviewId: string;
    resolution: "declined" | "failed";
    now?: Date;
    idFactory?: () => string;
  },
): Promise<void> {
  const nowIso = (input.now ?? new Date()).toISOString();
  await db.transaction(async (tx) => {
    const review = await lockOwnedOwnerLearningReview(tx, input);
    const expectedStatus = input.resolution === "declined" ? "ready" : "failed";
    if (review.resolvedAt != null && review.resolution === input.resolution) return;
    if (review.resolvedAt != null || review.analysisStatus !== expectedStatus) {
      throw new OwnerLearningResolutionError("review_state_conflict", 409);
    }
    await persistOwnerLearningResolution(tx, {
      review,
      resolution: input.resolution,
      nowIso,
      idFactory: input.idFactory,
    });
    if (input.resolution === "declined") {
      await insertEvent(tx, createOwnerLearningEvent("review_declined", {
        ownerUserId: review.ownerUserId,
        reviewId: review.id,
        agentProfileId: review.agentProfileId,
        occurredAt: nowIso,
      }, {}), input.idFactory);
    }
  });
  abortActiveOwnerLearningReview(input.reviewId);
}

async function insertEvent(
  tx: OwnerLearningResolutionTransaction,
  event: ReturnType<typeof createOwnerLearningEvent>,
  idFactory: (() => string) | undefined,
): Promise<void> {
  await tx.insert(schema.agentLearningEvents).values({
    id: idFactory?.() ?? randomUUID(),
    ownerUserId: event.ownerUserId,
    reviewId: event.reviewId,
    agentProfileId: event.agentProfileId,
    kind: event.kind,
    payload: event.payload,
    occurredAt: event.occurredAt,
  });
}
