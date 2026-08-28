import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { failFixtureOwnerLearningReview } from "./owner-learning-test-utils.js";
import { setupTestDB } from "./test-utils.js";

describe("owner learning schema", () => {
  test("enforces the owner singleton and preserves resolved history", async () => {
    const db = await setupTestDB();
    const fixture = await insertFixture(db);
    const firstReviewId = randomUUID();
    await insertReview(db, {
      id: firstReviewId,
      ownerUserId: fixture.ownerUserId,
      agentProfileId: fixture.agentProfileId,
      reviewedRevisionId: fixture.revisionId,
      idempotencyKey: "start-1",
    });

    const secondProfile = await insertProfileRevision(db, fixture.ownerUserId, "Second learner");
    await expectDatabaseRejection(() => insertReview(db, {
      id: randomUUID(),
      ownerUserId: fixture.ownerUserId,
      agentProfileId: secondProfile.agentProfileId,
      reviewedRevisionId: secondProfile.revisionId,
      idempotencyKey: "start-2",
    }));

    await failFixtureOwnerLearningReview(db, {
      reviewId: firstReviewId,
      failureCode: "provider_error",
      retryable: false,
      now: new Date("2026-08-04T00:10:00.000Z"),
      reviewUpdates: {
        resolution: "failed",
        resolvedAt: "2026-08-04T00:10:00.000Z",
      },
    });

    await insertReview(db, {
      id: randomUUID(),
      ownerUserId: fixture.ownerUserId,
      agentProfileId: secondProfile.agentProfileId,
      reviewedRevisionId: secondProfile.revisionId,
      idempotencyKey: "start-2",
    });
    expect(await db.select().from(schema.agentLearningReviews)).toHaveLength(2);
  });

  test("binds one to three evidence rows to immutable review positions", async () => {
    const db = await setupTestDB();
    const fixture = await insertFixture(db);
    const reviewId = randomUUID();
    await insertReview(db, {
      id: reviewId,
      ownerUserId: fixture.ownerUserId,
      agentProfileId: fixture.agentProfileId,
      reviewedRevisionId: fixture.revisionId,
      idempotencyKey: "selection-start",
    });

    await db.insert(schema.agentLearningReviewGames).values({
      reviewId,
      gameEvidenceId: fixture.gameEvidenceId,
      gameId: fixture.gameId,
      position: 1,
    });
    await expectDatabaseRejection(() => db.insert(schema.agentLearningReviewGames).values({
      reviewId,
      gameEvidenceId: fixture.gameEvidenceId,
      gameId: fixture.gameId,
      position: 2,
    }));
    await expectDatabaseRejection(() => db.insert(schema.agentLearningReviewGames).values({
      reviewId,
      gameEvidenceId: fixture.gameEvidenceId,
      gameId: fixture.gameId,
      position: 4,
    }));
  });

  test("enforces logical-call and cost provenance constraints", async () => {
    const db = await setupTestDB();
    const fixture = await insertFixture(db);
    const reviewId = randomUUID();
    await insertReview(db, {
      id: reviewId,
      ownerUserId: fixture.ownerUserId,
      agentProfileId: fixture.agentProfileId,
      reviewedRevisionId: fixture.revisionId,
      idempotencyKey: "call-start",
    });

    await db.insert(schema.agentLearningReviewCalls).values({
      id: randomUUID(),
      reviewId,
      ordinal: 1,
      stage: "scanning_narratives",
      inputPolicyHash: "sha256:request",
      costSource: "estimated",
      estimatedCostMicrousd: 125,
    });
    await expectDatabaseRejection(() => db.insert(schema.agentLearningReviewCalls).values({
      id: randomUUID(),
      reviewId,
      ordinal: 2,
      state: "succeeded",
      stage: "investigating_moments",
      inputPolicyHash: "sha256:missing-validated-checkpoint",
    }));
    await expectDatabaseRejection(() => db.insert(schema.agentLearningReviewCalls).values({
      id: randomUUID(),
      reviewId,
      ordinal: 2,
      stage: "investigating_moments",
      inputPolicyHash: "sha256:request-2",
      costSource: "actual",
    }));
    await expectDatabaseRejection(() => db.insert(schema.agentLearningReviewCalls).values({
      id: randomUUID(),
      reviewId,
      ordinal: 5,
      stage: "investigating_moments",
      inputPolicyHash: "sha256:request-5",
    }));
  });

  test("contains typed evidence plus review-scoped private failure storage lanes", async () => {
    const db = await setupTestDB();
    const rows = await db.execute<{ table_name: string; column_name: string }>(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name LIKE 'agent_learning_%'
    `);
    const tables = new Set(rows.map((row) => row.table_name));
    expect(tables).toEqual(new Set([
      "agent_learning_events",
      "agent_learning_game_evidence",
      "agent_learning_moment_evidence",
      "agent_learning_review_applications",
      "agent_learning_review_calls",
      "agent_learning_review_entitlements",
      "agent_learning_review_failure_diagnostics",
      "agent_learning_review_failure_evidence_outbox",
      "agent_learning_review_failure_manifest_reads",
      "agent_learning_review_failure_manifests",
      "agent_learning_review_games",
      "agent_learning_reviews",
    ]));
    const forbidden = rows.filter((row) =>
      /(raw_|transcript|cognition|prompt_body)/.test(row.column_name)
    );
    expect(forbidden).toEqual([]);
  });
});

async function insertFixture(db: DrizzleDB): Promise<{
  ownerUserId: string;
  agentProfileId: string;
  revisionId: string;
  gameId: string;
  gameEvidenceId: string;
}> {
  const ownerUserId = randomUUID();
  await db.insert(schema.users).values({ id: ownerUserId });
  const profile = await insertProfileRevision(db, ownerUserId, "Review learner");
  const gameId = randomUUID();
  await db.insert(schema.games).values({
    id: gameId,
    slug: `learning-${gameId}`,
    config: "{}",
    status: "completed",
    trackType: "free",
    minPlayers: 2,
    maxPlayers: 4,
  });
  const gameEvidenceId = randomUUID();
  await db.insert(schema.agentLearningGameEvidence).values({
    id: gameEvidenceId,
    ownerUserId,
    agentProfileId: profile.agentProfileId,
    analyticalRevisionId: profile.revisionId,
    gameId,
    evidenceVersion: "owner-learning-evidence-v2",
    eligibilityPolicyVersion: "owner-learning-eligibility-v1",
    completionAt: "2026-08-04T00:00:00.000Z",
    canonicalSnapshot: { placement: 2 },
    candidateMoments: [],
    sourceCaptureVersion: "capture-v1",
    sourceHash: "sha256:evidence",
  });
  return { ownerUserId, ...profile, gameId, gameEvidenceId };
}

async function insertProfileRevision(
  db: DrizzleDB,
  ownerUserId: string,
  name: string,
): Promise<{ agentProfileId: string; revisionId: string }> {
  const agentProfileId = randomUUID();
  await db.insert(schema.agentProfiles).values({
    id: agentProfileId,
    userId: ownerUserId,
    name,
    personality: "Observant",
    strategyStyle: "Build trust.",
  });
  const revisionId = randomUUID();
  await db.insert(schema.agentRevisions).values({
    id: revisionId,
    agentProfileId,
    ordinal: 1,
    trigger: "profile_create",
    magnitude: "initial",
    fingerprint: `sha256:${revisionId}`,
    behaviorSnapshot: { strategyStyle: "Build trust." },
    effectiveRuntimeSnapshot: { model: "openai:gpt-5.6-luna" },
    revisionPolicyVersion: "agent-revision-v2",
  });
  await db.update(schema.agentProfiles).set({ currentRevisionId: revisionId })
    .where(eq(schema.agentProfiles.id, agentProfileId));
  return { agentProfileId, revisionId };
}

async function insertReview(
  db: DrizzleDB,
  input: {
    id: string;
    ownerUserId: string;
    agentProfileId: string;
    reviewedRevisionId: string;
    idempotencyKey: string;
  },
): Promise<void> {
  await db.insert(schema.agentLearningReviews).values({
    id: input.id,
    ownerUserId: input.ownerUserId,
    agentProfileId: input.agentProfileId,
    reviewedRevisionId: input.reviewedRevisionId,
    selectedGameFingerprint: `sha256:${input.id}`,
    startIdempotencyKey: input.idempotencyKey,
    eligibilityPolicyVersion: "owner-learning-eligibility-v1",
    evidenceVersion: "owner-learning-evidence-v2",
    reviewerVersion: "owner-learning-reviewer-v1",
    promptVersion: "owner-learning-prompt-v2",
    schemaVersion: "owner-learning-result-v2",
    providerPolicyVersion: "owner-learning-luna-flex-v3",
    selectedModel: "openai:gpt-5.6-luna",
    analysisTrack: "evidence_rich",
  });
}

async function expectDatabaseRejection(operation: () => PromiseLike<unknown>): Promise<void> {
  let rejected = false;
  try {
    await operation();
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
}
