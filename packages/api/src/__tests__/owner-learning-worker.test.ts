import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { updateOwnedAgentProfile } from "../services/agent-profile-management.js";
import {
  claimOwnerLearningReview,
  completeOwnerLearningCall,
  createOwnerLearningTransportObserver,
  heartbeatOwnerLearningReview,
  reserveOwnerLearningCall,
  runClaimedOwnerLearningReview,
} from "../services/owner-learning-worker.js";
import type { OwnerLearningProvider } from "../services/owner-learning-provider.js";
import {
  fakeOwnerLearningProjection,
  insertPlayedOwnerLearningAgent,
  startFixtureOwnerLearningReview,
} from "./owner-learning-test-utils.js";
import { setupTestDB } from "./test-utils.js";

describe("owner learning worker durability", () => {
  test("allows only one active lease globally and rejects a stale token", async () => {
    const db = await setupTestDB();
    const firstFixture = await insertPlayedOwnerLearningAgent(db);
    const secondFixture = await insertPlayedOwnerLearningAgent(db, {
      completedAt: "2026-08-04T02:00:00.000Z",
    });
    await startFixtureOwnerLearningReview(db, firstFixture);
    await startFixtureOwnerLearningReview(db, secondFixture);
    const now = new Date("2026-08-04T03:01:00.000Z");

    const firstClaim = await claimOwnerLearningReview(db, { now });
    expect(firstClaim).not.toBeNull();
    expect(await claimOwnerLearningReview(db, { now })).toBeNull();
    expect(await heartbeatOwnerLearningReview(db, {
      reviewId: firstClaim!.reviewId,
      leaseToken: firstClaim!.leaseToken,
      now: new Date("2026-08-04T03:01:05.000Z"),
    })).toBe(true);

    await db.update(schema.agentLearningReviews).set({
      leaseExpiresAt: "2026-08-04T03:00:59.000Z",
    }).where(eq(schema.agentLearningReviews.id, firstClaim!.reviewId));
    const reclaimed = await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    });
    expect(reclaimed).not.toBeNull();
    expect(await heartbeatOwnerLearningReview(db, {
      reviewId: firstClaim!.reviewId,
      leaseToken: firstClaim!.leaseToken,
      now: new Date("2026-08-04T03:02:01.000Z"),
    })).toBe(false);
  });

  test("reuses an undispatched reserved ordinal after lease expiry", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const firstClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const firstReservation = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: firstClaim.leaseToken,
      inputPolicyHash: "sha256:scan",
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:01.000Z"),
    });
    await db.update(schema.agentLearningReviews).set({
      leaseExpiresAt: "2026-08-04T03:01:02.000Z",
    }).where(eq(schema.agentLearningReviews.id, reviewId));
    const secondClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    }))!;
    const secondReservation = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: secondClaim.leaseToken,
      inputPolicyHash: "sha256:scan",
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:02:01.000Z"),
    });

    expect(secondReservation.callId).toBe(firstReservation.callId);
    expect(secondReservation.ordinal).toBe(1);
    expect((await db.select().from(schema.agentLearningReviewCalls))).toHaveLength(1);
    expect((await db.select().from(schema.agentLearningReviews))[0]!.logicalCallCount).toBe(1);
  });

  test("persists the three-Flex-429 transition and one standard success inside one ordinal", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const call = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: claim.leaseToken,
      inputPolicyHash: "sha256:scan",
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:01.000Z"),
    });
    const observer = createOwnerLearningTransportObserver(db, {
      reviewId,
      callId: call.callId,
      leaseToken: claim.leaseToken,
    });
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      await observer.onDispatchIntent({
        transportOrdinal: ordinal,
        attemptedTier: "flex",
        dispatchedAtMs: Date.parse(`2026-08-04T03:01:0${ordinal}.000Z`),
      });
      await observer.onTerminalOutcome({
        transportOrdinal: ordinal,
        attemptedTier: "flex",
        httpStatus: 429,
        latencyMs: 100,
        backoffMs: 1_000 * ordinal,
        completedAtMs: Date.parse(`2026-08-04T03:01:0${ordinal}.100Z`),
      });
    }
    await observer.onDispatchIntent({
      transportOrdinal: 4,
      attemptedTier: "auto",
      dispatchedAtMs: Date.parse("2026-08-04T03:01:05.000Z"),
    });
    await observer.onTerminalOutcome({
      transportOrdinal: 4,
      attemptedTier: "auto",
      httpStatus: 200,
      latencyMs: 200,
      providerRequestId: "req-auto",
      completedAtMs: Date.parse("2026-08-04T03:01:05.200Z"),
    });
    expect(await completeOwnerLearningCall(db, {
      reviewId,
      callId: call.callId,
      leaseToken: claim.leaseToken,
      effectiveTier: "default",
      tokenReceipt: {
        inputTokens: 1000,
        cachedInputTokens: 200,
        totalOutputTokens: 500,
        reasoningTokens: 100,
      },
      costReceipt: {
        costSource: "estimated",
        estimatedCostMicrousd: 1_250,
        pricingSourceId: "engine.MODEL_PRICING",
        rateCardVersion: "2026-08-04",
        pricedAt: "2026-08-04T03:01:05.200Z",
      },
      now: new Date("2026-08-04T03:01:05.200Z"),
    })).toBe(true);

    const storedCall = (await db.select().from(schema.agentLearningReviewCalls))[0]!;
    expect(storedCall.state).toBe("succeeded");
    expect(storedCall.flex429Count).toBe(3);
    expect(storedCall.capacityPath).toBe("standard_fallback");
    expect(storedCall.transportReceipts).toHaveLength(4);
    expect(storedCall.effectiveTier).toBe("default");
    expect(storedCall.estimatedCostMicrousd).toBe(1_250);
  });

  test("marks an unmatched dispatch intent ambiguous instead of replaying it", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const call = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: claim.leaseToken,
      inputPolicyHash: "sha256:scan",
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:01.000Z"),
    });
    const observer = createOwnerLearningTransportObserver(db, {
      reviewId,
      callId: call.callId,
      leaseToken: claim.leaseToken,
    });
    await observer.onDispatchIntent({
      transportOrdinal: 1,
      attemptedTier: "flex",
      dispatchedAtMs: Date.parse("2026-08-04T03:01:02.000Z"),
    });
    await db.update(schema.agentLearningReviews).set({
      leaseExpiresAt: "2026-08-04T03:01:03.000Z",
    }).where(eq(schema.agentLearningReviews.id, reviewId));

    expect(await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    })).toBeNull();
    expect((await db.select().from(schema.agentLearningReviewCalls))[0]!.state).toBe("ambiguous");
    const review = (await db.select().from(schema.agentLearningReviews))[0]!;
    expect(review.analysisStatus).toBe("failed");
    expect(review.safeFailureCode).toBe("worker_interrupted");
  });

  test("runs a claimed review to a durable no-change result with a fake provider", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const projector = async (_db: typeof db, selection: Parameters<typeof fakeOwnerLearningProjection>[0]) =>
      fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );
    const provider: OwnerLearningProvider = {
      async invoke(request) {
        await request.observer.onDispatchIntent({
          transportOrdinal: request.resumeTransport.nextTransportOrdinal,
          attemptedTier: request.resumeTransport.nextTier,
          dispatchedAtMs: Date.parse("2026-08-04T03:01:02.000Z"),
        });
        await request.observer.onTerminalOutcome({
          transportOrdinal: request.resumeTransport.nextTransportOrdinal,
          attemptedTier: request.resumeTransport.nextTier,
          httpStatus: 200,
          latencyMs: 100,
          providerRequestId: "req-fake",
          completedAtMs: Date.parse("2026-08-04T03:01:02.100Z"),
        });
        return {
          output: {
            provisionalThemes: [],
            selectedMomentIds: [],
            findings: [],
            finalResult: {
              diagnosis: "The current guidance remains appropriate.",
              analysisTrack: "evidence_rich",
              strategyHealthClassification: null,
              recommendations: [],
              proposal: null,
              noChange: { rationale: "No repeated strategic defect appears in the selected evidence." },
            },
          },
          effectiveTier: "flex",
          providerResponseId: "resp-fake",
          tokenReceipt: {
            inputTokens: 1_000,
            cachedInputTokens: 200,
            totalOutputTokens: 300,
            reasoningTokens: 50,
          },
          costReceipt: {
            costSource: "estimated",
            estimatedCostMicrousd: 500,
            pricingSourceId: "engine.OPENAI_FLEX_MODEL_PRICING",
            rateCardVersion: "2026-08-04",
            pricedAt: "2026-08-04T03:01:02.100Z",
          },
        };
      },
    };
    let clockMs = Date.parse("2026-08-04T03:01:01.000Z");
    expect(await runClaimedOwnerLearningReview(db, claim, {
      provider,
      projector,
      now: () => new Date(clockMs += 100),
    })).toBe(true);

    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(review.analysisStatus).toBe("no_change");
    expect(review.resolution).toBe("no_change");
    expect(review.stage).toBe("complete");
    expect(review.checkpoint?.lastCompletedStage).toBe("complete");
    expect(review.leaseTokenHash).toBeNull();
    const calls = await db.select().from(schema.agentLearningReviewCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.state).toBe("succeeded");
  });

  test("retains cost while atomically rejecting invalid structured evidence", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const projector = async (_db: typeof db, selection: Parameters<typeof fakeOwnerLearningProjection>[0]) =>
      fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );
    const provider: OwnerLearningProvider = {
      async invoke(request) {
        await request.observer.onDispatchIntent({
          transportOrdinal: 1,
          attemptedTier: "flex",
          dispatchedAtMs: Date.parse("2026-08-04T03:01:02.000Z"),
        });
        await request.observer.onTerminalOutcome({
          transportOrdinal: 1,
          attemptedTier: "flex",
          httpStatus: 200,
          latencyMs: 100,
          completedAtMs: Date.parse("2026-08-04T03:01:02.100Z"),
        });
        return {
          output: {
            provisionalThemes: ["unsupported"],
            selectedMomentIds: ["olm_invented"],
            findings: [],
            finalResult: null,
          },
          effectiveTier: "flex",
          providerResponseId: "resp-invalid",
          tokenReceipt: {
            inputTokens: 1_000,
            cachedInputTokens: 200,
            totalOutputTokens: 300,
            reasoningTokens: 50,
          },
          costReceipt: {
            costSource: "estimated",
            estimatedCostMicrousd: 500,
            pricingSourceId: "engine.OPENAI_FLEX_MODEL_PRICING",
            rateCardVersion: "2026-08-04",
            pricedAt: "2026-08-04T03:01:02.100Z",
          },
        };
      },
    };
    let clockMs = Date.parse("2026-08-04T03:01:01.000Z");

    expect(await runClaimedOwnerLearningReview(db, claim, {
      provider,
      projector,
      now: () => new Date(clockMs += 100),
    })).toBe(false);

    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(review.analysisStatus).toBe("failed");
    expect(review.safeFailureCode).toBe("invalid_structured_output");
    expect(review.retryable).toBe(true);
    const call = (await db.select().from(schema.agentLearningReviewCalls))[0]!;
    expect(call.state).toBe("failed");
    expect(call.safeFailureCode).toBe("invalid_structured_output");
    expect(call.estimatedCostMicrousd).toBe(500);
    expect(call.tokenReceipt?.totalOutputTokens).toBe(300);
  });

  test("aborts local provider work when the durable lease is lost", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const projector = async (_db: typeof db, selection: Parameters<typeof fakeOwnerLearningProjection>[0]) =>
      fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    let providerObservedAbort = false;
    const provider: OwnerLearningProvider = {
      async invoke(request) {
        providerStarted();
        return new Promise<never>((_resolve, reject) => {
          const abort = () => {
            providerObservedAbort = true;
            reject(new DOMException("lease lost", "AbortError"));
          };
          if (request.signal?.aborted) abort();
          else request.signal?.addEventListener("abort", abort, { once: true });
        });
      },
    };
    const run = runClaimedOwnerLearningReview(db, claim, {
      provider,
      projector,
      now: () => new Date("2026-08-04T03:01:01.000Z"),
      heartbeatIntervalMs: 5,
    });
    await started;
    await db.update(schema.agentLearningReviews).set({
      leaseTokenHash: "sha256:lease-owned-by-another-worker",
    }).where(eq(schema.agentLearningReviews.id, reviewId));

    expect(await run).toBe(false);
    expect(providerObservedAbort).toBe(true);
    const calls = await db.select().from(schema.agentLearningReviewCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.state).toBe("reserved");
    expect(calls[0]!.transportReceipts).toEqual([]);
  });

  test("aborts local provider work immediately when the reviewed Profile supersedes it", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const claim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const projector = async (_db: typeof db, selection: Parameters<typeof fakeOwnerLearningProjection>[0]) =>
      fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    let providerObservedAbort = false;
    const provider: OwnerLearningProvider = {
      async invoke(request) {
        providerStarted();
        return new Promise<never>((_resolve, reject) => {
          const abort = () => {
            providerObservedAbort = true;
            reject(new DOMException("review superseded", "AbortError"));
          };
          if (request.signal?.aborted) abort();
          else request.signal?.addEventListener("abort", abort, { once: true });
        });
      },
    };
    const run = runClaimedOwnerLearningReview(db, claim, {
      provider,
      projector,
      now: () => new Date("2026-08-04T03:01:01.000Z"),
      heartbeatIntervalMs: 60_000,
    });
    await started;

    await updateOwnedAgentProfile(db, { userId: fixture.ownerUserId }, fixture.agentProfileId, {
      personality: "This owner-authored change supersedes the in-flight review.",
    });

    expect(await run).toBe(false);
    expect(providerObservedAbort).toBe(true);
    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(review.resolution).toBe("superseded");
    expect(review.leaseTokenHash).toBeNull();
  });
});
