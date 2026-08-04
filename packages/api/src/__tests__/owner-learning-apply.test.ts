import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { updateOwnedAgentProfile } from "../services/agent-profile-management.js";
import { admitOwnedSeatInTransaction } from "../services/owned-seat-projection.js";
import { applyOwnedOwnerLearningReview } from "../services/owner-learning-apply.js";
import { fingerprintOwnerLearningValue } from "../services/owner-learning-contracts.js";
import {
  resolveOwnedOwnerLearningReview,
} from "../services/owner-learning-resolution.js";
import {
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
      recommendationIds: ready.recommendationIds,
      now: new Date("2026-08-04T04:00:00.000Z"),
    });

    expect(applied.replayed).toBe(false);
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
      recommendationIds: ready.recommendationIds,
    });
    expect(replayed).toEqual({ ...applied, replayed: true });
    expect(await db.select().from(schema.agentLearningReviewApplications)).toHaveLength(1);
  });

  test("rejects wrong ownership, fingerprint, and recommendation subsets without writes", async () => {
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
      recommendationIds: ready.recommendationIds,
    })).rejects.toMatchObject({ code: "review_not_found" });
    await expect(applyOwnedOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      proposalFingerprint: "sha256:wrong",
      recommendationIds: ready.recommendationIds,
    })).rejects.toMatchObject({ code: "proposal_mismatch" });
    await expect(applyOwnedOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      reviewId,
      proposalFingerprint: ready.proposalFingerprint,
      recommendationIds: ready.recommendationIds.slice(0, 1),
    })).rejects.toMatchObject({ code: "recommendation_mismatch" });

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
        recommendationIds: ready.recommendationIds,
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
    await db.update(schema.agentLearningReviews).set({
      analysisStatus: "failed",
      safeFailureCode: "provider_error",
      retryable: false,
    }).where(eq(schema.agentLearningReviews.id, failedReviewId));
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
