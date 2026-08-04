import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import {
  classifyOwnerLearningEvidence,
  deriveOwnerLearningCredit,
  getOwnerLearningEligibleInputs,
  ownerLearningGameEligibilityPolicy,
  validateOwnerLearningSelection,
} from "../services/owner-learning-eligibility.js";
import { setupTestDB } from "./test-utils.js";

describe("owner learning eligibility", () => {
  test("V1 admits only completed Daily Free games with durable completion coordinates", () => {
    const base = {
      gameId: "game-1",
      agentProfileId: "profile-1",
      analyticalRevisionId: "revision-1",
      completionAt: "2026-08-04T01:00:00.000Z",
    };

    expect(ownerLearningGameEligibilityPolicy.admits({
      ...base,
      status: "completed",
      trackType: "free",
    })).toBe(true);
    expect(ownerLearningGameEligibilityPolicy.admits({
      ...base,
      status: "completed",
      trackType: "custom",
    })).toBe(false);
    expect(ownerLearningGameEligibilityPolicy.admits({
      ...base,
      status: "in_progress",
      trackType: "free",
    })).toBe(false);
    expect(ownerLearningGameEligibilityPolicy.admits({
      ...base,
      status: "completed",
      trackType: "free",
      completionAt: null,
    })).toBe(false);
  });

  test("owner-wide credit caps at one and refills after the consumed watermark", () => {
    const completions = [
      { gameId: "game-b", completionAt: "2026-08-04T02:00:00.000Z" },
      { gameId: "game-a", completionAt: "2026-08-04T01:00:00.000Z" },
      { gameId: "game-c", completionAt: "2026-08-04T02:00:00.000Z" },
    ];

    expect(deriveOwnerLearningCredit(completions, null)).toEqual({
      balance: 1,
      latestEligibleCompletion: completions[2]!,
      refillCompletion: completions[1]!,
      qualifyingCompletionCount: 3,
    });
    expect(deriveOwnerLearningCredit(completions, completions[2]!)).toEqual({
      balance: 0,
      latestEligibleCompletion: completions[2]!,
      refillCompletion: null,
      qualifyingCompletionCount: 3,
    });
    expect(deriveOwnerLearningCredit([
      ...completions,
      { gameId: "game-d", completionAt: "2026-08-05T00:00:00.000Z" },
    ], completions[2]!).balance).toBe(1);
  });

  test("classifies thin early exits without weakening the three-game health check", () => {
    const thinEarlyExit = { eliminatedRound: 2, narrativeCoverage: "thin" as const };
    expect(classifyOwnerLearningEvidence([thinEarlyExit])).toBe("awaiting_evidence");
    expect(classifyOwnerLearningEvidence([thinEarlyExit, {
      eliminatedRound: 1,
      narrativeCoverage: "thin",
    }])).toBe("awaiting_evidence");
    expect(classifyOwnerLearningEvidence([
      thinEarlyExit,
      { eliminatedRound: 1, narrativeCoverage: "rich" },
    ])).toBe("evidence_rich");
    expect(classifyOwnerLearningEvidence([
      thinEarlyExit,
      { eliminatedRound: 1, narrativeCoverage: "thin" },
      { eliminatedRound: 2, narrativeCoverage: "thin" },
    ])).toBe("strategy_health_check");
    expect(classifyOwnerLearningEvidence([
      thinEarlyExit,
      { eliminatedRound: 1, narrativeCoverage: "thin" },
      { eliminatedRound: 3, narrativeCoverage: "thin" },
    ])).toBe("evidence_rich");
  });

  test("lists and reauthorizes only owned current-revision Daily Free games", async () => {
    const db = await setupTestDB();
    const fixture = await insertEligibilityFixture(db);
    const inputs = await getOwnerLearningEligibleInputs(db, {
      ownerUserId: fixture.ownerUserId,
      now: new Date("2026-08-06T00:00:00.000Z"),
    });

    expect(inputs.credit.balance).toBe(1);
    expect(inputs.credit.qualifyingCompletionCount).toBe(2);
    expect(inputs.profiles).toHaveLength(1);
    expect(inputs.profiles[0]!.games.map((game) => game.gameId)).toEqual([
      fixture.currentFreeGameId,
    ]);
    expect(inputs.profiles[0]!.games[0]!.previouslyAnalyzed).toBe(true);

    const selection = await validateOwnerLearningSelection(db, {
      ownerUserId: fixture.ownerUserId,
      agentProfileId: fixture.agentProfileId,
      gameIds: [fixture.currentFreeGameId],
    });
    expect(selection.currentRevisionId).toBe(fixture.currentRevisionId);
    expect(selection.games[0]!.playerId).toBe(fixture.currentFreePlayerId);

    for (const unavailableGameId of [fixture.oldRevisionGameId, fixture.customGameId]) {
      await expect(validateOwnerLearningSelection(db, {
        ownerUserId: fixture.ownerUserId,
        agentProfileId: fixture.agentProfileId,
        gameIds: [unavailableGameId],
      })).rejects.toMatchObject({ code: "selection_unavailable" });
    }
  });
});

async function insertEligibilityFixture(db: DrizzleDB): Promise<{
  ownerUserId: string;
  agentProfileId: string;
  currentRevisionId: string;
  currentFreeGameId: string;
  currentFreePlayerId: string;
  oldRevisionGameId: string;
  customGameId: string;
}> {
  const ownerUserId = randomUUID();
  const agentProfileId = randomUUID();
  const oldRevisionId = randomUUID();
  const currentRevisionId = randomUUID();
  await db.insert(schema.users).values({ id: ownerUserId });
  await db.insert(schema.agentProfiles).values({
    id: agentProfileId,
    userId: ownerUserId,
    name: `Learner ${agentProfileId.slice(0, 8)}`,
    personality: "Observant",
    strategyStyle: "Build trust.",
  });
  await db.insert(schema.agentRevisions).values([
    {
      id: oldRevisionId,
      agentProfileId,
      ordinal: 1,
      trigger: "profile_create",
      magnitude: "initial",
      fingerprint: `sha256:${oldRevisionId}`,
      behaviorSnapshot: {},
      effectiveRuntimeSnapshot: {},
      revisionPolicyVersion: "agent-revision-v2",
    },
    {
      id: currentRevisionId,
      agentProfileId,
      ordinal: 2,
      priorRevisionId: oldRevisionId,
      trigger: "profile_edit",
      magnitude: "material",
      fingerprint: `sha256:${currentRevisionId}`,
      behaviorSnapshot: {},
      effectiveRuntimeSnapshot: {},
      revisionPolicyVersion: "agent-revision-v2",
    },
  ]);
  await db.update(schema.agentProfiles).set({ currentRevisionId })
    .where(eq(schema.agentProfiles.id, agentProfileId));

  const currentFree = await insertCompletedSeat(db, {
    ownerUserId,
    agentProfileId,
    revisionId: currentRevisionId,
    trackType: "free",
    completedAt: "2026-08-05T03:00:00.000Z",
  });
  const oldFree = await insertCompletedSeat(db, {
    ownerUserId,
    agentProfileId,
    revisionId: oldRevisionId,
    trackType: "free",
    completedAt: "2026-08-04T03:00:00.000Z",
  });
  const custom = await insertCompletedSeat(db, {
    ownerUserId,
    agentProfileId,
    revisionId: currentRevisionId,
    trackType: "custom",
    completedAt: "2026-08-05T04:00:00.000Z",
  });

  const evidenceId = randomUUID();
  await db.insert(schema.agentLearningGameEvidence).values({
    id: evidenceId,
    ownerUserId,
    agentProfileId,
    analyticalRevisionId: currentRevisionId,
    gameId: currentFree.gameId,
    evidenceVersion: "owner-learning-evidence-v1",
    eligibilityPolicyVersion: "owner-learning-eligibility-v1",
    completionAt: "2026-08-05T03:00:00.000Z",
    canonicalSnapshot: {},
    candidateMoments: [],
    sourceCaptureVersion: "postgame-v1:transcript-v0:cognition-v0",
    sourceHash: "sha256:evidence",
  });
  const reviewId = randomUUID();
  await db.insert(schema.agentLearningReviews).values({
    id: reviewId,
    ownerUserId,
    agentProfileId,
    reviewedRevisionId: currentRevisionId,
    selectedGameFingerprint: "sha256:selection",
    startIdempotencyKey: "eligibility-test",
    eligibilityPolicyVersion: "owner-learning-eligibility-v1",
    evidenceVersion: "owner-learning-evidence-v1",
    reviewerVersion: "owner-learning-reviewer-v1",
    promptVersion: "owner-learning-prompt-v1",
    schemaVersion: "owner-learning-result-v1",
    providerPolicyVersion: "owner-learning-luna-flex-v1",
    selectedModel: "openai:gpt-5.6-luna",
    analysisTrack: "evidence_rich",
    analysisStatus: "no_change",
    stage: "complete",
    result: {
      diagnosis: "The existing strategy remains appropriate.",
      analysisTrack: "evidence_rich",
      recommendations: [],
      noChange: { rationale: "The selected evidence does not warrant a strategy edit." },
    },
    resolution: "no_change",
    resolvedAt: "2026-08-05T05:00:00.000Z",
  });
  await db.insert(schema.agentLearningReviewGames).values({
    reviewId,
    gameEvidenceId: evidenceId,
    gameId: currentFree.gameId,
    position: 1,
  });

  return {
    ownerUserId,
    agentProfileId,
    currentRevisionId,
    currentFreeGameId: currentFree.gameId,
    currentFreePlayerId: currentFree.playerId,
    oldRevisionGameId: oldFree.gameId,
    customGameId: custom.gameId,
  };
}

async function insertCompletedSeat(
  db: DrizzleDB,
  input: {
    ownerUserId: string;
    agentProfileId: string;
    revisionId: string;
    trackType: "free" | "custom";
    completedAt: string;
  },
): Promise<{ gameId: string; playerId: string }> {
  const gameId = randomUUID();
  const playerId = randomUUID();
  await db.insert(schema.games).values({
    id: gameId,
    slug: `learning-${gameId}`,
    config: "{}",
    status: "completed",
    trackType: input.trackType,
    endedAt: input.completedAt,
    minPlayers: 2,
    maxPlayers: 4,
  });
  await db.insert(schema.gamePlayers).values({
    id: playerId,
    gameId,
    userId: input.ownerUserId,
    agentProfileId: input.agentProfileId,
    agentRevisionId: input.revisionId,
    persona: JSON.stringify({ name: "Learner", personality: "Observant" }),
    agentConfig: "{}",
  });
  await db.insert(schema.gameResults).values({
    id: randomUUID(),
    gameId,
    roundsPlayed: 2,
    tokenUsage: "{}",
    finishedAt: input.completedAt,
  });
  return { gameId, playerId };
}
