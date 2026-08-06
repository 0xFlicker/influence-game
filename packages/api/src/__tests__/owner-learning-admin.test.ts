import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { createSessionToken } from "../middleware/auth.js";
import { createAdminRoutes } from "../routes/admin.js";
import { applyOwnedOwnerLearningReview } from "../services/owner-learning-apply.js";
import {
  fingerprintOwnerLearningValue,
  type OwnerLearningReviewResult,
} from "../services/owner-learning-contracts.js";
import {
  getAdminOwnerLearningReview,
  listAdminOwnerLearningReviews,
} from "../services/owner-learning-admin.js";
import {
  insertPlayedOwnerLearningAgent,
  startFixtureOwnerLearningReview,
} from "./owner-learning-test-utils.js";
import { setupTestDB } from "./test-utils.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-jwt-secret-owner-learning-admin";
});

describe("owner learning admin ledger", () => {
  test("aggregates operational calls, provider diagnostics, and user action", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    await db.update(schema.users).set({
      displayName: "Review Owner",
      handle: "review-owner",
    }).where(eq(schema.users.id, fixture.ownerUserId));
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const ready = await markReady(db, reviewId);

    await db.insert(schema.agentLearningReviewCalls).values([
      {
        id: randomUUID(),
        reviewId,
        ordinal: 1,
        state: "succeeded",
        stage: "scanning_narratives",
        inputPolicyHash: "sha256:call-1",
        validatedCheckpoint: {
          version: 1,
          logicalCallCount: 1,
          diveCount: 0,
          selectedMomentIds: [],
          nextMomentCursor: 0,
          provisionalThemes: [],
          validatedFindings: [],
          lastCompletedStage: "scanning_narratives",
          promptHash: "sha256:prompt",
          schemaHash: "sha256:schema",
          completion: null,
        },
        effectiveTier: "flex",
        tokenReceipt: {
          inputTokens: 1_000,
          cachedInputTokens: 600,
          totalOutputTokens: 350,
          reasoningTokens: 150,
        },
        capacityPath: "flex",
        latencyMs: 1_250,
        costSource: "estimated",
        estimatedCostMicrousd: 725,
        pricingSourceId: "engine.OPENAI_FLEX_MODEL_PRICING",
        rateCardVersion: "2026-08-04",
        pricedAt: "2026-08-04T03:02:00.000Z",
        dispatchedAt: "2026-08-04T03:01:58.000Z",
        completedAt: "2026-08-04T03:02:00.000Z",
      },
      {
        id: randomUUID(),
        reviewId,
        ordinal: 2,
        state: "ambiguous",
        stage: "investigating_moments",
        inputPolicyHash: "sha256:call-2",
        transportReceipts: [{
          ordinal: 1,
          dispatchIntentAt: "2026-08-04T03:02:01.000Z",
          attemptedTier: "flex",
          terminalHttpStatus: 400,
          terminalOutcomeAt: "2026-08-04T03:02:01.359Z",
          latencyMs: 359,
          providerRequestId: "req-admin-diagnostic",
        }],
        safeFailureCode: "provider_error",
        costSource: "unavailable",
        dispatchedAt: "2026-08-04T03:02:01.000Z",
      },
    ]);
    await db.update(schema.agentLearningReviews).set({
      logicalCallCount: 2,
      checkpoint: {
        version: 1,
        logicalCallCount: 2,
        diveCount: 1,
        selectedMomentIds: [],
        nextMomentCursor: 0,
        provisionalThemes: ["TRANSCRIPT_SENTINEL", "COGNITION_SENTINEL", "PROMPT_SENTINEL"],
        validatedFindings: [],
        lastCompletedStage: "complete",
        promptHash: "sha256:prompt",
        schemaHash: "sha256:schema",
        completion: {
          result: ready.result,
          proposalFingerprint: ready.proposalFingerprint,
        },
      },
    }).where(eq(schema.agentLearningReviews.id, reviewId));

    await applyOwnedOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      proposalFingerprint: ready.proposalFingerprint,
      now: new Date("2026-08-04T04:00:00.000Z"),
    });
    const application = (await db.select().from(schema.agentLearningReviewApplications)
      .where(eq(schema.agentLearningReviewApplications.reviewId, reviewId)))[0]!;
    await db.update(schema.agentLearningReviewApplications).set({
      mutationReceipt: {
        ...application.mutationReceipt,
        producerTrace: "PRODUCER_TRACE_SENTINEL",
      },
    }).where(eq(schema.agentLearningReviewApplications.reviewId, reviewId));

    const detail = await getAdminOwnerLearningReview(db, reviewId);
    expect(detail).not.toBeNull();
    expect(detail!.acceptance).toBe("accepted");
    expect(detail!.application).toEqual({ appliedAt: "2026-08-04T04:00:00.000Z" });
    expect(detail!.tokens).toEqual({
      input: 1_000,
      cachedInput: 600,
      totalOutput: 350,
      reasoning: 150,
      visibleOutput: 200,
      unavailableCallCount: 1,
    });
    expect(detail!.cost).toEqual({
      actualMicrousd: 0,
      estimatedMicrousd: 725,
      unavailableCallCount: 1,
    });
    expect(detail!.calls[0]!.cost).toMatchObject({
      source: "estimated",
      microusd: 725,
      rateCardVersion: "2026-08-04",
    });
    expect(detail!.calls[1]!.cost).toMatchObject({ source: "unavailable", microusd: null });
    expect(detail!.calls[1]).toMatchObject({
      terminalHttpStatus: 400,
      providerRequestId: "req-admin-diagnostic",
      latencyMs: 359,
      safeFailureCode: "provider_error",
    });
    const serialized = JSON.stringify(detail);
    for (const sentinel of [
      "GENERATED_RECOMMENDATION_SENTINEL",
      "Make the commitment testable",
      "testable vote plan",
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
    for (const sentinel of [
      "TRANSCRIPT_SENTINEL",
      "COGNITION_SENTINEL",
      "PROMPT_SENTINEL",
      "PROVIDER_RESPONSE_SENTINEL",
      "PRODUCER_TRACE_SENTINEL",
    ]) {
      expect(serialized).not.toContain(sentinel);
    }

    const list = await listAdminOwnerLearningReviews(db, {
      dateFrom: "2026-08-04T00:00:00.000Z",
      dateTo: "2026-08-04T23:59:59.999Z",
      track: "evidence_rich",
      status: "ready",
      model: "openai:gpt-5.6-luna",
      resolution: "applied",
      application: "accepted",
    });
    expect(list.reviews).toHaveLength(1);
    expect(list.analytics.reviewCount).toBe(1);
    expect(list.analytics.cost).toEqual(detail!.cost);
    expect(list.analytics.eventCounts.review_started).toBe(1);
    expect(list.analytics.eventCounts.proposal_applied).toBe(1);
    expect((await listAdminOwnerLearningReviews(db, { application: "not_accepted" })).reviews)
      .toHaveLength(0);
  });

  test("requires view_admin for list and detail routes", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const adminUserId = randomUUID();
    const ordinaryUserId = randomUUID();
    await db.insert(schema.users).values([
      { id: adminUserId },
      { id: ordinaryUserId },
    ]);
    const adminToken = await createSessionToken(adminUserId, {
      roles: ["admin-reader"],
      permissions: ["view_admin"],
    });
    const ordinaryToken = await createSessionToken(ordinaryUserId, {
      roles: ["gamer"],
      permissions: [],
    });
    const app = new Hono();
    app.route("/", createAdminRoutes(db));

    expect((await app.request("/api/admin/owner-learning-reviews")).status).toBe(401);
    expect((await app.request("/api/admin/owner-learning-reviews", {
      headers: { Authorization: `Bearer ${ordinaryToken}` },
    })).status).toBe(403);
    const list = await app.request("/api/admin/owner-learning-reviews?status=queued", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(list.status).toBe(200);
    expect((await list.json() as { reviews: unknown[] }).reviews).toHaveLength(1);
    expect((await app.request(`/api/admin/owner-learning-reviews/${reviewId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })).status).toBe(200);
    expect((await app.request("/api/admin/owner-learning-reviews?status=bogus", {
      headers: { Authorization: `Bearer ${adminToken}` },
    })).status).toBe(400);
  });
});

async function markReady(
  db: Awaited<ReturnType<typeof setupTestDB>>,
  reviewId: string,
): Promise<{ proposalFingerprint: string; result: OwnerLearningReviewResult }> {
  const proposal = {
    field: "strategyStyle" as const,
    before: "Build trust before committing.",
    after: "Require a reciprocal commitment before coordinating the vote.",
  };
  const result: OwnerLearningReviewResult = {
    diagnosis: "The current guidance does not turn trust into a testable vote plan.",
    analysisTrack: "evidence_rich",
    recommendations: [{
      id: "olrec_admin_1",
      title: "Make the commitment testable",
      disposition: "change",
      confidence: "high",
      rationale: "GENERATED_RECOMMENDATION_SENTINEL <script>alert('x')</script> [bad](https://evil.example)",
      evidenceRefs: [{
        kind: "canonical_event",
        gameId: "admin-game-ref",
        coordinate: "round:3:vote:learner",
        sourceHash: "sha256:admin-ref",
        sourceVersion: "postgame-v1",
      }],
    }],
    proposal,
  };
  const proposalFingerprint = fingerprintOwnerLearningValue({ reviewId, proposal });
  await db.update(schema.agentLearningReviews).set({
    analysisStatus: "ready",
    stage: "complete",
    result,
    proposalFingerprint,
    startedAt: "2026-08-04T03:01:00.000Z",
    completedAt: "2026-08-04T03:03:00.000Z",
    updatedAt: "2026-08-04T03:03:00.000Z",
  }).where(eq(schema.agentLearningReviews.id, reviewId));
  return { proposalFingerprint, result };
}
