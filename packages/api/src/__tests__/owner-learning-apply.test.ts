import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { updateOwnedAgentProfile } from "../services/agent-profile-management.js";
import { admitOwnedSeatInTransaction } from "../services/owned-seat-projection.js";
import { applyOwnedOwnerLearningReview } from "../services/owner-learning-apply.js";
import {
  fingerprintOwnerLearningValue,
  parseOwnerLearningReviewResult,
} from "../services/owner-learning-contracts.js";
import {
  resolveOwnedOwnerLearningReview,
} from "../services/owner-learning-resolution.js";
import {
  failFixtureOwnerLearningReview,
  insertPlayedOwnerLearningAgent,
  startFixtureOwnerLearningReview,
} from "./owner-learning-test-utils.js";
import { setupTestDB } from "./test-utils.js";

describe("owner learning apply and resolution", () => {
  test("applies only the persisted strategy proposal and replays one stored receipt", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const ready = await markReviewReady(db, reviewId);
    await db.insert(schema.games).values({
      id: "learning-waiting",
      slug: "learning-waiting",
      config: JSON.stringify({
        modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" },
      }),
      status: "waiting",
      trackType: "custom",
      minPlayers: 2,
      maxPlayers: 12,
    });
    await db.transaction((tx) => admitOwnedSeatInTransaction(tx, {
      gameId: "learning-waiting",
      userId: fixture.ownerUserId,
      agentProfileId: fixture.agentProfileId,
    }));
    const before = (await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, fixture.agentProfileId)))[0]!;

    const applied = await applyOwnedOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      proposalFingerprint: ready.proposalFingerprint,
      now: new Date("2026-08-04T04:00:00.000Z"),
    });

    expect(applied.replayed).toBe(false);
    expect(applied.sourceRecommendationIds).toEqual(ready.recommendationIds);
    expect(applied.priorRevisionId).toBe(fixture.revisionId);
    expect(applied.resultingRevisionId).not.toBe(fixture.revisionId);
    expect(applied.receipt.waitingSeats).toMatchObject({ total: 1, reconciled: 1 });
    const after = (await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, fixture.agentProfileId)))[0]!;
    expect(after).toMatchObject({
      name: before.name,
      personality: before.personality,
      backstory: before.backstory,
      avatarUrl: before.avatarUrl,
      strategyStyle: ready.after,
      currentRevisionId: applied.resultingRevisionId,
    });
    const waitingSeat = (await db.select().from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, "learning-waiting")))[0]!;
    expect(waitingSeat.agentRevisionId).toBe(applied.resultingRevisionId);
    expect(JSON.parse(waitingSeat.persona).strategyHints).toBe(ready.after);
    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(review.resolution).toBe("applied");

    const replayed = await applyOwnedOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      proposalFingerprint: ready.proposalFingerprint,
    });
    expect(replayed).toEqual({ ...applied, replayed: true });
    expect(await db.select().from(schema.agentLearningReviewApplications)).toHaveLength(1);
  });

  test("preserves the byte-exact server-authored baseline while canonicalizing the replacement", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewedStrategy = "Build trust before committing. \n";
    const revision = (await db.select().from(schema.agentRevisions)
      .where(eq(schema.agentRevisions.id, fixture.revisionId)))[0]!;
    await db.update(schema.agentProfiles).set({
      strategyStyle: reviewedStrategy,
    }).where(eq(schema.agentProfiles.id, fixture.agentProfileId));
    await db.update(schema.agentRevisions).set({
      behaviorSnapshot: {
        ...revision.behaviorSnapshot,
        strategyInstructions: reviewedStrategy,
      },
    }).where(eq(schema.agentRevisions.id, fixture.revisionId));
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const result = parseOwnerLearningReviewResult({
      diagnosis: "Trust did not become a testable voting commitment.",
      analysisTrack: "evidence_rich",
      recommendations: [{
        id: "olrec_canonical_proposal",
        title: "Make commitment testable",
        disposition: "change",
        confidence: "high",
        rationale: "The selected game shows trust without a voting checkpoint.",
        evidenceRefs: [{
          kind: "canonical_event",
          gameId: fixture.gameId,
          coordinate: "round:1:vote.cast:1",
          sourceHash: `sha256:${fixture.gameId}`,
          sourceVersion: "v1",
        }],
      }],
      proposal: {
        field: "strategyStyle",
        before: reviewedStrategy,
        after: "\tBuild explicit commitments before coordinating the vote. \n",
      },
    });
    const proposalFingerprint = fingerprintOwnerLearningValue({ reviewId, proposal: result.proposal });
    await db.update(schema.agentLearningReviews).set({
      analysisStatus: "ready",
      stage: "complete",
      result,
      proposalFingerprint,
      completedAt: "2026-08-04T03:30:00.000Z",
      updatedAt: "2026-08-04T03:30:00.000Z",
    }).where(eq(schema.agentLearningReviews.id, reviewId));

    const applied = await applyOwnedOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      proposalFingerprint,
      now: new Date("2026-08-04T04:00:00.000Z"),
    });

    expect(applied).toMatchObject({
      proposalFingerprint,
      priorStrategyStyle: reviewedStrategy,
      resultingStrategyStyle: "Build explicit commitments before coordinating the vote.",
    });
    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, fixture.agentProfileId)))[0]!.strategyStyle)
      .toBe("Build explicit commitments before coordinating the vote.");
    expect((await db.select().from(schema.agentLearningReviewApplications)
      .where(eq(schema.agentLearningReviewApplications.reviewId, reviewId)))[0])
      .toMatchObject({
        proposalFingerprint,
        priorStrategyStyle: reviewedStrategy,
        resultingStrategyStyle: "Build explicit commitments before coordinating the vote.",
      });
  });

  test("rejects wrong ownership and fingerprints without writes", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const ready = await markReviewReady(db, reviewId, { recommendationCount: 2 });
    const before = (await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, fixture.agentProfileId)))[0]!;

    await expect(applyOwnedOwnerLearningReview(db, {
      ownerUserId: "another-owner",
      reviewId,
      proposalFingerprint: ready.proposalFingerprint,
    })).rejects.toMatchObject({ code: "review_not_found" });
    await expect(applyOwnedOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      proposalFingerprint: "sha256:wrong",
    })).rejects.toMatchObject({ code: "proposal_mismatch" });

    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, fixture.agentProfileId)))[0]).toEqual(before);
    expect(await db.select().from(schema.agentLearningReviewApplications)).toEqual([]);
  });

  test("links a manual update to the same Profile and rejects a cross-Profile link before writes", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const other = await insertPlayedOwnerLearningAgent(db, { ownerUserId: fixture.ownerUserId });
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    await markReviewReady(db, reviewId);
    const otherBefore = (await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, other.agentProfileId)))[0]!;

    await expect(updateOwnedAgentProfile(db, { userId: fixture.ownerUserId }, other.agentProfileId, {
      strategyStyle: "This must roll back.",
      sourceReviewId: reviewId,
    })).rejects.toMatchObject({ code: "source_review_conflict" });
    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, other.agentProfileId)))[0]).toEqual(otherBefore);

    const mutation = await updateOwnedAgentProfile(db, { userId: fixture.ownerUserId }, fixture.agentProfileId, {
      strategyStyle: "Manually test commitments before declaring a bloc.",
      sourceReviewId: reviewId,
    });
    expect(mutation.profile.strategyStyle).toBe("Manually test commitments before declaring a bloc.");
    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(review.resolution).toBe("manual_update");
    expect(await db.select().from(schema.agentLearningReviewApplications)).toEqual([]);
  });

  test("replays an identical linked manual update after its response is lost", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    await markReviewReady(db, reviewId);
    const before = (await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, fixture.agentProfileId)))[0]!;
    const request = {
      strategyStyle: "Verify the coalition twice before coordinating the vote.",
      sourceReviewId: reviewId,
      expectedRevisionId: before.currentRevisionId,
    };

    const first = await updateOwnedAgentProfile(
      db,
      { userId: fixture.ownerUserId },
      fixture.agentProfileId,
      request,
    );
    const replay = await updateOwnedAgentProfile(
      db,
      { userId: fixture.ownerUserId },
      fixture.agentProfileId,
      request,
    );

    expect(replay.profile.id).toBe(first.profile.id);
    expect(replay.profile.strategyStyle).toBe(request.strategyStyle);
    expect((await db.select().from(schema.agentLearningEvents)
      .where(eq(schema.agentLearningEvents.reviewId, reviewId)))
      .filter((event) => event.kind === "review_resolved")).toHaveLength(1);
  });

  test("does not let linked edits resolve unfinished or analytically unchanged reviews", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const before = (await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, fixture.agentProfileId)))[0]!;

    await expect(updateOwnedAgentProfile(db, { userId: fixture.ownerUserId }, fixture.agentProfileId, {
      strategyStyle: "This queued review cannot be consumed.",
      sourceReviewId: reviewId,
    })).rejects.toMatchObject({ code: "source_review_conflict" });
    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, fixture.agentProfileId)))[0]).toEqual(before);

    await markReviewReady(db, reviewId);
    await expect(updateOwnedAgentProfile(db, { userId: fixture.ownerUserId }, fixture.agentProfileId, {
      strategyStyle: "Build explicit reciprocal commitments, verify the bloc, then coordinate the vote.",
      sourceReviewId: reviewId,
    })).rejects.toMatchObject({ code: "source_review_conflict" });
    await expect(updateOwnedAgentProfile(
      db,
      { userId: fixture.ownerUserId },
      fixture.agentProfileId,
      { avatarUrl: "https://cdn.example/review-avatar.png", sourceReviewId: reviewId },
    )).rejects.toMatchObject({ code: "source_review_conflict" });
    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, fixture.agentProfileId)))[0]).toEqual(before);
    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(review.resolution).toBeNull();
    expect(review.resolvedAt).toBeNull();
  });

  test("supersedes only on an unlinked analytical revision change", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    await markReviewReady(db, reviewId);

    const presentation = await updateOwnedAgentProfile(db, { userId: fixture.ownerUserId }, fixture.agentProfileId, {
      avatarUrl: "https://cdn.example/learning-avatar.png",
    });
    expect(presentation.profileRevision.outcome).toBe("preserved");
    expect((await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!.resolvedAt).toBeNull();

    const analytical = await updateOwnedAgentProfile(db, { userId: fixture.ownerUserId }, fixture.agentProfileId, {
      personality: "Make every coalition promise explicit and testable.",
    });
    expect(analytical.profileRevision.outcome).toBe("created");
    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    expect(review.resolution).toBe("superseded");
  });

  test("serializes competing exact apply and linked manual update without losing either winner", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const reviewId = await startFixtureOwnerLearningReview(db, fixture);
    const ready = await markReviewReady(db, reviewId);

    const outcomes = await Promise.allSettled([
      applyOwnedOwnerLearningReview(db, {
        ownerUserId: fixture.ownerUserId,
        reviewId,
        proposalFingerprint: ready.proposalFingerprint,
      }),
      updateOwnedAgentProfile(db, { userId: fixture.ownerUserId }, fixture.agentProfileId, {
        strategyStyle: "Manual winner: verify reciprocity before naming the bloc.",
        sourceReviewId: reviewId,
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const review = (await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, reviewId)))[0]!;
    const applications = await db.select().from(schema.agentLearningReviewApplications);
    const profile = (await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, fixture.agentProfileId)))[0]!;
    if (review.resolution === "applied") {
      expect(applications).toHaveLength(1);
      expect(profile.strategyStyle).toBe(ready.after);
    } else {
      expect(review.resolution).toBe("manual_update");
      expect(applications).toEqual([]);
      expect(profile.strategyStyle).toBe("Manual winner: verify reciprocity before naming the bloc.");
    }
  });

  test("declines ready reviews and resolves failed reviews without changing the Profile", async () => {
    const db = await setupTestDB();
    const readyFixture = await insertPlayedOwnerLearningAgent(db);
    const readyReviewId = await startFixtureOwnerLearningReview(db, readyFixture);
    await markReviewReady(db, readyReviewId);
    const readyProfile = (await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, readyFixture.agentProfileId)))[0]!;
    await resolveOwnedOwnerLearningReview(db, {
      ownerUserId: readyFixture.ownerUserId,
      reviewId: readyReviewId,
      resolution: "declined",
      now: new Date("2026-08-04T04:00:00.000Z"),
    });
    expect((await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, readyReviewId)))[0]!.resolution).toBe("declined");
    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, readyFixture.agentProfileId)))[0]).toEqual(readyProfile);

    const failedFixture = await insertPlayedOwnerLearningAgent(db);
    const failedReviewId = await startFixtureOwnerLearningReview(db, failedFixture);
    await failFixtureOwnerLearningReview(db, {
      reviewId: failedReviewId,
      failureCode: "provider_error",
      retryable: false,
    });
    const failedProfile = (await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, failedFixture.agentProfileId)))[0]!;
    await resolveOwnedOwnerLearningReview(db, {
      ownerUserId: failedFixture.ownerUserId,
      reviewId: failedReviewId,
      resolution: "failed",
    });
    expect((await db.select().from(schema.agentLearningReviews)
      .where(eq(schema.agentLearningReviews.id, failedReviewId)))[0]!.resolution).toBe("failed");
    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, failedFixture.agentProfileId)))[0]).toEqual(failedProfile);
  });
});

async function markReviewReady(
  db: Awaited<ReturnType<typeof setupTestDB>>,
  reviewId: string,
  options: { recommendationCount?: number } = {},
): Promise<{ proposalFingerprint: string; recommendationIds: string[]; after: string }> {
  const recommendationIds = Array.from(
    { length: options.recommendationCount ?? 1 },
    (_, index) => `olrec_change_${index + 1}`,
  );
  const after = "Build explicit reciprocal commitments, verify the bloc, then coordinate the vote.";
  const proposal = {
    field: "strategyStyle" as const,
    before: "Build trust before committing.",
    after,
  };
  const proposalFingerprint = fingerprintOwnerLearningValue({ reviewId, proposal });
  await db.update(schema.agentLearningReviews).set({
    analysisStatus: "ready",
    stage: "complete",
    result: {
      diagnosis: "The current guidance does not turn trust into a testable vote plan.",
      analysisTrack: "evidence_rich",
      recommendations: recommendationIds.map((id, index) => ({
        id,
        title: `Make commitment ${index + 1} testable`,
        disposition: "change" as const,
        confidence: "high" as const,
        rationale: "The selected games show informal trust without a reciprocal voting checkpoint.",
        evidenceRefs: [],
      })),
      proposal,
    },
    proposalFingerprint,
    completedAt: "2026-08-04T03:30:00.000Z",
    updatedAt: "2026-08-04T03:30:00.000Z",
  }).where(eq(schema.agentLearningReviews.id, reviewId));
  return { proposalFingerprint, recommendationIds, after };
}
