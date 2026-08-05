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
import {
  OwnerLearningProviderError,
  type OwnerLearningProvider,
} from "../services/owner-learning-provider.js";
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

  test("fails a reclaimed call without transmission when its persisted request policy has drifted", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const firstClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const firstCall = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: firstClaim.leaseToken,
      inputPolicyHash: "sha256:retired-policy",
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:01.000Z"),
    });
    await db.update(schema.agentLearningReviews).set({
      leaseExpiresAt: "2026-08-04T03:01:02.000Z",
    }).where(eq(schema.agentLearningReviews.id, reviewId));
    const reclaimed = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    }))!;
    const projector = async (_db: typeof db, selection: Parameters<typeof fakeOwnerLearningProjection>[0]) =>
      fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );
    let providerInvocations = 0;
    const provider: OwnerLearningProvider = {
      async invoke() {
        providerInvocations += 1;
        throw new Error("provider must not receive a drifted recovery request");
      },
    };

    expect(await runClaimedOwnerLearningReview(db, reclaimed, {
      provider,
      projector,
      now: () => new Date("2026-08-04T03:02:01.000Z"),
    })).toBe(false);
    expect(providerInvocations).toBe(0);
    const calls = await db.select().from(schema.agentLearningReviewCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      id: firstCall.callId,
      ordinal: 1,
      state: "failed",
      safeFailureCode: "worker_interrupted",
    });
    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(review).toMatchObject({
      analysisStatus: "failed",
      safeFailureCode: "worker_interrupted",
      logicalCallCount: 1,
    });
    expect(review.leaseTokenHash).toBeNull();
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

  test("persists returned accounting when the effective tier is invalid for the transport path", async () => {
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
    await observer.onTerminalOutcome({
      transportOrdinal: 1,
      attemptedTier: "flex",
      httpStatus: 200,
      latencyMs: 175,
      completedAtMs: Date.parse("2026-08-04T03:01:02.175Z"),
    });

    expect(await completeOwnerLearningCall(db, {
      reviewId,
      callId: call.callId,
      leaseToken: claim.leaseToken,
      effectiveTier: "default",
      tokenReceipt: {
        inputTokens: 900,
        cachedInputTokens: 300,
        totalOutputTokens: 400,
        reasoningTokens: 100,
      },
      costReceipt: {
        costSource: "estimated",
        estimatedCostMicrousd: 725,
        pricingSourceId: "engine.MODEL_PRICING",
        rateCardVersion: "2026-08-04",
        pricedAt: "2026-08-04T03:01:02.175Z",
      },
      now: new Date("2026-08-04T03:01:02.175Z"),
    })).toBe(false);

    const storedCall = (await db.select().from(schema.agentLearningReviewCalls))[0]!;
    expect(storedCall).toMatchObject({
      state: "failed",
      safeFailureCode: "tier_mismatch",
      effectiveTier: "default",
      latencyMs: 175,
      estimatedCostMicrousd: 725,
    });
    expect(storedCall.tokenReceipt?.totalOutputTokens).toBe(400);
  });

  test("reclaims a persisted third Flex 429 and resumes the same ordinal on standard capacity", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const firstClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const firstCall = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: firstClaim.leaseToken,
      inputPolicyHash: "sha256:scan",
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:01:01.000Z"),
    });
    const observer = createOwnerLearningTransportObserver(db, {
      reviewId,
      callId: firstCall.callId,
      leaseToken: firstClaim.leaseToken,
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
        backoffMs: 1_000,
        completedAtMs: Date.parse(`2026-08-04T03:01:0${ordinal}.100Z`),
      });
    }
    await db.update(schema.agentLearningReviews).set({
      leaseExpiresAt: "2026-08-04T03:01:04.000Z",
    }).where(eq(schema.agentLearningReviews.id, reviewId));

    const reclaimed = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:02:00.000Z"),
    }))!;
    const resumed = await reserveOwnerLearningCall(db, {
      reviewId,
      leaseToken: reclaimed.leaseToken,
      inputPolicyHash: "sha256:scan",
      stage: "scanning_narratives",
      now: new Date("2026-08-04T03:02:01.000Z"),
    });

    expect(resumed).toMatchObject({
      callId: firstCall.callId,
      ordinal: 1,
      reused: true,
      resumeTransport: {
        flex429Count: 3,
        nextTransportOrdinal: 4,
        nextTier: "auto",
      },
    });
    expect(await db.select().from(schema.agentLearningReviewCalls)).toHaveLength(1);
  });

  test("replays an interrupted fourth harness call with its original ordinal and standard fallback", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    await startFixtureOwnerLearningReview(db, fixture);
    const firstClaim = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:01:00.000Z"),
    }))!;
    const projector = async (_db: typeof db, selection: Parameters<typeof fakeOwnerLearningProjection>[0]) => {
      const base = fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );
      const game = base.games[0]!;
      const candidateMoments = [1, 2, 3].map((ordinal) => ({
        id: `olm_recovery_${ordinal}`,
        gameId: fixture.gameId,
        anchorKind: "canonical_event" as const,
        sourceCoordinate: `event:${ordinal}:vote.cast`,
        sourceHash: game.sourceHash,
        round: ordinal,
        phase: "VOTE",
      }));
      return {
        ...base,
        games: [{ ...game, candidateMoments }],
        reviewInput: {
          ...base.reviewInput,
          games: base.reviewInput.games.map((inputGame) => ({
            ...inputGame,
            candidateMomentIds: candidateMoments.map((moment) => moment.id),
          })),
        },
      };
    };
    let firstClockMs = Date.parse("2026-08-04T03:01:01.000Z");
    let interruptedCallId: string | null = null;
    const firstProvider: OwnerLearningProvider = {
      async invoke(request) {
        const turn = request.input.turn as {
          callBudget: { ordinal: number };
          evidence?: unknown;
        };
        const ordinal = turn.callBudget.ordinal;
        if (ordinal === 4) {
          expect(turn.evidence).toBeDefined();
          for (let transportOrdinal = 1; transportOrdinal <= 3; transportOrdinal += 1) {
            const dispatchedAtMs = Date.parse(`2026-08-04T03:01:1${transportOrdinal}.000Z`);
            await request.observer.onDispatchIntent({
              transportOrdinal,
              attemptedTier: "flex",
              dispatchedAtMs,
            });
            await request.observer.onTerminalOutcome({
              transportOrdinal,
              attemptedTier: "flex",
              httpStatus: 429,
              latencyMs: 100,
              backoffMs: 1_000,
              completedAtMs: dispatchedAtMs + 100,
            });
          }
          firstClockMs = Date.parse("2026-08-04T03:02:00.000Z");
          throw new Error("worker process stopped after the third Flex 429");
        }
        const dispatchedAtMs = Date.parse(`2026-08-04T03:01:0${ordinal}.000Z`);
        await request.observer.onDispatchIntent({
          transportOrdinal: 1,
          attemptedTier: "flex",
          dispatchedAtMs,
        });
        await request.observer.onTerminalOutcome({
          transportOrdinal: 1,
          attemptedTier: "flex",
          httpStatus: 200,
          latencyMs: 100,
          completedAtMs: dispatchedAtMs + 100,
        });
        return successfulProviderTurn(ordinal === 1
          ? {
              provisionalThemes: ["initiative"],
              selectedMomentHandles: ["g1:m1", "g1:m2", "g1:m3"],
              findings: [],
              finalResult: null,
            }
          : {
              provisionalThemes: ["initiative"],
              selectedMomentHandles: [],
              findings: [],
              finalResult: null,
            });
      },
    };

    expect(await runClaimedOwnerLearningReview(db, firstClaim, {
      provider: firstProvider,
      projector,
      now: () => new Date(firstClockMs += 10),
    })).toBe(false);
    const callsAfterInterruption = await db.select().from(schema.agentLearningReviewCalls);
    expect(callsAfterInterruption).toHaveLength(4);
    const interruptedCall = callsAfterInterruption.find((call) => call.ordinal === 4)!;
    interruptedCallId = interruptedCall.id;
    expect(interruptedCall).toMatchObject({ state: "dispatched", flex429Count: 3 });

    const reclaimed = (await claimOwnerLearningReview(db, {
      now: new Date("2026-08-04T03:03:00.000Z"),
    }))!;
    let recoveredBudget: unknown = null;
    const secondProvider: OwnerLearningProvider = {
      async invoke(request) {
        const turn = request.input.turn as {
          callBudget: unknown;
          currentStrategyStyle: string;
          evidence?: unknown;
        };
        recoveredBudget = turn.callBudget;
        expect(turn.currentStrategyStyle).toBe("Build trust before committing.");
        expect(turn.evidence).toBeDefined();
        expect(request.resumeTransport).toMatchObject({
          flex429Count: 3,
          nextTransportOrdinal: 4,
          nextTier: "auto",
        });
        await request.observer.onDispatchIntent({
          transportOrdinal: 4,
          attemptedTier: "auto",
          dispatchedAtMs: Date.parse("2026-08-04T03:03:01.000Z"),
        });
        await request.observer.onTerminalOutcome({
          transportOrdinal: 4,
          attemptedTier: "auto",
          httpStatus: 200,
          latencyMs: 100,
          completedAtMs: Date.parse("2026-08-04T03:03:01.100Z"),
        });
        return successfulProviderTurn({
          provisionalThemes: ["initiative"],
          selectedMomentHandles: [],
          findings: [],
          finalResult: {
            diagnosis: "The reviewed guidance remains appropriate.",
            analysisTrack: "evidence_rich",
            strategyHealthClassification: null,
            recommendations: [],
            proposal: null,
            noChange: { rationale: "No repeated strategic defect appears in the selected evidence." },
          },
        }, "auto");
      },
    };
    let secondClockMs = Date.parse("2026-08-04T03:03:00.000Z");

    expect(await runClaimedOwnerLearningReview(db, reclaimed, {
      provider: secondProvider,
      projector,
      now: () => new Date(secondClockMs += 10),
    })).toBe(true);
    expect(recoveredBudget).toEqual({
      ordinal: 4,
      remainingAfterThisCall: 0,
      finalResultRequired: true,
    });
    const recoveredCalls = await db.select().from(schema.agentLearningReviewCalls);
    expect(recoveredCalls).toHaveLength(4);
    expect(recoveredCalls.find((call) => call.ordinal === 4)).toMatchObject({
      id: interruptedCallId,
      state: "succeeded",
      effectiveTier: "auto",
      flex429Count: 3,
    });
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
            selectedMomentHandles: [],
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
            provisionalThemes: ["PRIVATE_GENERATED_OUTPUT_SENTINEL"],
            selectedMomentHandles: ["g1:m999"],
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
    const diagnostics: unknown[] = [];

    expect(await runClaimedOwnerLearningReview(db, claim, {
      provider,
      projector,
      now: () => new Date(clockMs += 100),
      onOutputFailure: (diagnostic) => diagnostics.push(diagnostic),
    })).toBe(false);

    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(review.analysisStatus).toBe("failed");
    expect(review.safeFailureCode).toBe("invalid_structured_output");
    expect(review.retryable).toBe(true);
    const call = (await db.select().from(schema.agentLearningReviewCalls))[0]!;
    expect(call.state).toBe("failed");
    expect(call.safeFailureCode).toBe("unknown_moment_handle");
    expect(call.estimatedCostMicrousd).toBe(500);
    expect(call.tokenReceipt?.totalOutputTokens).toBe(300);
    expect(diagnostics).toEqual([{
      reviewId,
      callOrdinal: 1,
      stage: "scanning_narratives",
      code: "unknown_moment_handle",
    }]);
    expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_GENERATED_OUTPUT_SENTINEL");
  });

  test("normalizes an unknown provider tier while durably failing the review", async () => {
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
      async invoke() {
        throw new OwnerLearningProviderError(
          "provider_error",
          true,
          {
            inputTokens: 100,
            cachedInputTokens: 0,
            totalOutputTokens: 25,
            reasoningTokens: 5,
          },
          {
            costSource: "estimated",
            estimatedCostMicrousd: 150,
            pricingSourceId: "engine.MODEL_PRICING",
            rateCardVersion: "2026-08-04",
            pricedAt: "2026-08-04T03:01:02.000Z",
          },
          "unknown",
        );
      },
    };

    expect(await runClaimedOwnerLearningReview(db, claim, {
      provider,
      projector,
      now: () => new Date("2026-08-04T03:01:02.000Z"),
    })).toBe(false);

    const call = (await db.select().from(schema.agentLearningReviewCalls))[0]!;
    expect(call).toMatchObject({
      state: "failed",
      effectiveTier: null,
      safeFailureCode: "provider_error",
      estimatedCostMicrousd: 150,
    });
    expect(call.tokenReceipt?.totalOutputTokens).toBe(25);
    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(review.analysisStatus).toBe("failed");
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

function successfulProviderTurn(output: unknown, effectiveTier = "flex") {
  return {
    output,
    effectiveTier,
    providerResponseId: "resp-fake",
    tokenReceipt: {
      inputTokens: 1_000,
      cachedInputTokens: 200,
      totalOutputTokens: 300,
      reasoningTokens: 50,
    },
    costReceipt: {
      costSource: "estimated" as const,
      estimatedCostMicrousd: 500,
      pricingSourceId: "engine.OPENAI_FLEX_MODEL_PRICING",
      rateCardVersion: "2026-08-04",
      pricedAt: "2026-08-04T03:01:02.100Z",
    },
  };
}
