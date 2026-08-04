import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { getOwnerLearningEligibleInputs } from "./owner-learning-eligibility.js";
import { createOwnerLearningEvent } from "./owner-learning-events.js";

type AnalyticsTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

export class OwnerLearningAnalyticsError extends Error {
  constructor(readonly code: "prompt_unavailable" | "review_unavailable" | "recommendations_unavailable") {
    super(code);
    this.name = "OwnerLearningAnalyticsError";
  }
}

export async function recordOwnerLearningPromptImpression(
  db: DrizzleDB,
  input: { ownerUserId: string; threshold: 1 | 3; now?: Date },
): Promise<{ recorded: boolean }> {
  return db.transaction(async (tx) => {
    await lockEntitlement(tx, input.ownerUserId);
    const eligible = await getOwnerLearningEligibleInputs(tx, {
      ownerUserId: input.ownerUserId,
      now: input.now,
    });
    const completion = eligible.credit.latestEligibleCompletion;
    if (eligible.credit.balance !== 1 || eligible.prompt.threshold !== input.threshold || !completion) {
      throw new OwnerLearningAnalyticsError("prompt_unavailable");
    }
    const completionWatermark = watermark(completion);
    const exists = await hasPromptEvent(tx, {
      ownerUserId: input.ownerUserId,
      kind: "prompt_impression",
      completionWatermark,
      threshold: input.threshold,
    });
    if (exists) return { recorded: false };
    const nowIso = (input.now ?? new Date()).toISOString();
    await tx.update(schema.agentLearningReviewEntitlements).set({
      lastSurfacedThreshold: input.threshold,
      updatedAt: nowIso,
    }).where(eq(schema.agentLearningReviewEntitlements.ownerUserId, input.ownerUserId));
    const event = createOwnerLearningEvent("prompt_impression", {
      ownerUserId: input.ownerUserId,
      occurredAt: nowIso,
    }, { threshold: input.threshold, completionWatermark });
    await insertEvent(tx, event);
    return { recorded: true };
  });
}

export async function dismissOwnerLearningPrompt(
  db: DrizzleDB,
  input: { ownerUserId: string; now?: Date },
): Promise<{ recorded: boolean }> {
  return db.transaction(async (tx) => {
    const entitlement = await lockEntitlement(tx, input.ownerUserId);
    const eligible = await getOwnerLearningEligibleInputs(tx, {
      ownerUserId: input.ownerUserId,
      now: input.now,
    });
    const completion = eligible.credit.latestEligibleCompletion;
    if (eligible.credit.balance !== 1 || eligible.prompt.threshold == null || !completion) {
      throw new OwnerLearningAnalyticsError("prompt_unavailable");
    }
    if (
      entitlement.dismissedCompletionAt === completion.completionAt
      && entitlement.dismissedGameId === completion.gameId
    ) return { recorded: false };
    const nowIso = (input.now ?? new Date()).toISOString();
    await tx.update(schema.agentLearningReviewEntitlements).set({
      dismissedCompletionAt: completion.completionAt,
      dismissedGameId: completion.gameId,
      updatedAt: nowIso,
    }).where(eq(schema.agentLearningReviewEntitlements.ownerUserId, input.ownerUserId));
    const event = createOwnerLearningEvent("prompt_dismissed", {
      ownerUserId: input.ownerUserId,
      occurredAt: nowIso,
    }, { completionWatermark: watermark(completion) });
    await insertEvent(tx, event);
    return { recorded: true };
  });
}

export async function recordOwnerLearningRecommendationsViewed(
  db: DrizzleDB,
  input: { ownerUserId: string; reviewId: string; now?: Date },
): Promise<{ recorded: boolean }> {
  return db.transaction(async (tx) => {
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
    if (!review) throw new OwnerLearningAnalyticsError("review_unavailable");
    if (review.analysisStatus !== "ready") {
      throw new OwnerLearningAnalyticsError("recommendations_unavailable");
    }
    const existing = await tx.select({ id: schema.agentLearningEvents.id })
      .from(schema.agentLearningEvents).where(and(
        eq(schema.agentLearningEvents.ownerUserId, input.ownerUserId),
        eq(schema.agentLearningEvents.reviewId, input.reviewId),
        eq(schema.agentLearningEvents.kind, "recommendations_viewed"),
      )).limit(1);
    if (existing.length > 0) return { recorded: false };
    const event = createOwnerLearningEvent("recommendations_viewed", {
      ownerUserId: input.ownerUserId,
      reviewId: input.reviewId,
      agentProfileId: review.agentProfileId,
      occurredAt: (input.now ?? new Date()).toISOString(),
    }, {});
    await insertEvent(tx, event);
    return { recorded: true };
  });
}

async function lockEntitlement(
  tx: AnalyticsTransaction,
  ownerUserId: string,
): Promise<typeof schema.agentLearningReviewEntitlements.$inferSelect> {
  await tx.insert(schema.agentLearningReviewEntitlements).values({ ownerUserId })
    .onConflictDoNothing();
  await tx.execute(sql`
    SELECT owner_user_id
    FROM agent_learning_review_entitlements
    WHERE owner_user_id = ${ownerUserId}
    FOR UPDATE
  `);
  return (await tx.select().from(schema.agentLearningReviewEntitlements)
    .where(eq(schema.agentLearningReviewEntitlements.ownerUserId, ownerUserId)).limit(1))[0]!;
}

async function hasPromptEvent(
  tx: AnalyticsTransaction,
  input: {
    ownerUserId: string;
    kind: "prompt_impression";
    completionWatermark: string;
    threshold: 1 | 3;
  },
): Promise<boolean> {
  const rows = await tx.select({ id: schema.agentLearningEvents.id })
    .from(schema.agentLearningEvents).where(and(
      eq(schema.agentLearningEvents.ownerUserId, input.ownerUserId),
      eq(schema.agentLearningEvents.kind, input.kind),
      sql`${schema.agentLearningEvents.payload}->>'completionWatermark' = ${input.completionWatermark}`,
      sql`${schema.agentLearningEvents.payload}->>'threshold' = ${String(input.threshold)}`,
    )).limit(1);
  return rows.length > 0;
}

async function insertEvent(
  tx: AnalyticsTransaction,
  event: ReturnType<typeof createOwnerLearningEvent>,
): Promise<void> {
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

function watermark(input: { completionAt: string; gameId: string }): string {
  return `${input.completionAt}|${input.gameId}`;
}
