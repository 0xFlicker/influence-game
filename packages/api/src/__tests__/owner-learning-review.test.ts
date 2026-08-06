import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import {
  preflightOwnerLearningReview,
  startOwnerLearningReview,
  type OwnerLearningEvidenceProjector,
} from "../services/owner-learning-review.js";
import { setupTestDB } from "./test-utils.js";
import {
  fakeOwnerLearningProjection,
  insertPlayedOwnerLearningAgent,
} from "./owner-learning-test-utils.js";

describe("owner learning review start", () => {
  test("rejects an invalid idempotency key before touching the database", async () => {
    const explosiveDb = new Proxy({}, {
      get() {
        throw new Error("database was touched");
      },
    });
    await expect(startOwnerLearningReview(explosiveDb as never, {
      ownerUserId: "owner-1",
      agentProfileId: "profile-1",
      gameIds: ["game-1"],
      idempotencyKey: "   ",
    })).rejects.toThrow("idempotency key");
  });

  test("preflights and starts three narrative-heavy games without a request-size failure", async () => {
    const db = await setupTestDB();
    const first = await insertPlayedOwnerLearningAgent(db, {
      completedAt: "2026-08-01T01:00:00.000Z",
    });
    const second = await insertAdditionalPlayedGame(db, first, "2026-08-02T01:00:00.000Z");
    const third = await insertAdditionalPlayedGame(db, first, "2026-08-03T01:00:00.000Z");
    const evidenceIds = new Map([
      [first.gameId, first.gameEvidenceId],
      [second.gameId, second.gameEvidenceId],
      [third.gameId, third.gameEvidenceId],
    ]);
    const projector: OwnerLearningEvidenceProjector = async (_db, selection) => {
      const projection = fakeOwnerLearningProjection(selection, evidenceIds);
      const games = projection.games.map((game) => {
        const narrativeGroups = Array.from({ length: 240 }, (_, index) => ({
          corr: "exact" as const,
          decisionId: `${game.gameId}:decision:${index}`,
          round: index % 13 + 1,
          phase: "MINGLE",
          text: "public dialogue ".repeat(60),
          thinking: "reviewed cognition ".repeat(60),
          strategy: "strategy reflection ".repeat(60),
        }));
        const candidateMoments = narrativeGroups.map((group, index) => ({
          id: `olm_${game.gameId}_${index}`,
          gameId: game.gameId,
          anchorKind: "decision" as const,
          sourceCoordinate: `decision:${group.decisionId}`,
          sourceHash: `sha256:${game.gameId}:${index}`,
          round: group.round,
          phase: group.phase,
        }));
        return {
          ...game,
          canonicalFacts: {
            ...game.canonicalFacts,
            game: { ...game.canonicalFacts.game, roundCount: 13, playerCount: 12 },
            reviewedPlayer: {
              ...game.canonicalFacts.reviewedPlayer,
              placement: 2,
              status: "finalist" as const,
              eliminatedRound: null,
              readableSummary: "Reached the final council. ".repeat(80),
            },
          },
          narrativeGroups,
          candidateMoments,
        };
      });
      return {
        ...projection,
        games,
        reviewInput: {
          ...projection.reviewInput,
          games: games.map((game) => ({
            gameId: game.gameId,
            canonicalFacts: game.canonicalFacts,
            candidateMomentIds: game.candidateMoments.map((moment) => moment.id),
            narrativeGroups: game.narrativeGroups,
            omittedNarrativeGroupCount: 0,
          })),
        },
      };
    };
    const gameIds = [first.gameId, second.gameId, third.gameId];
    await db.delete(schema.agentLearningGameEvidence);

    const preflight = await preflightOwnerLearningReview(db, {
      ownerUserId: first.ownerUserId,
      agentProfileId: first.agentProfileId,
      gameIds,
    }, { projector });
    expect(preflight.evidence.games).toHaveLength(3);
    expect(await db.select().from(schema.agentLearningGameEvidence)).toEqual([]);
    expect(await db.select().from(schema.agentLearningReviews)).toHaveLength(0);
    expect(await db.select().from(schema.agentLearningReviewEntitlements)).toHaveLength(0);

    const started = await startOwnerLearningReview(db, {
      ownerUserId: first.ownerUserId,
      agentProfileId: first.agentProfileId,
      gameIds,
      idempotencyKey: "three-full-games",
    }, { projector, now: new Date("2026-08-04T03:00:00.000Z") });
    expect(started.status).toBe("started");
    expect(await db.select().from(schema.agentLearningGameEvidence)).toHaveLength(3);
    expect(await db.select().from(schema.agentLearningReviewGames)).toHaveLength(3);
    expect(await db.select().from(schema.agentLearningReviews)).toHaveLength(1);
  });

  test("atomically buys one owner-wide singleton and advances the latest completion watermark", async () => {
    const db = await setupTestDB();
    const first = await insertPlayedOwnerLearningAgent(db, {
      completedAt: "2026-08-04T01:00:00.000Z",
    });
    const second = await insertPlayedOwnerLearningAgent(db, {
      ownerUserId: first.ownerUserId,
      completedAt: "2026-08-04T02:00:00.000Z",
    });
    const evidenceIds = new Map([
      [first.gameId, first.gameEvidenceId],
      [second.gameId, second.gameEvidenceId],
    ]);
    const projector: OwnerLearningEvidenceProjector = async (_db, selection) =>
      fakeOwnerLearningProjection(selection, evidenceIds);
    const now = new Date("2026-08-04T03:00:00.000Z");

    const [left, right] = await Promise.all([
      startOwnerLearningReview(db, {
        ownerUserId: first.ownerUserId,
        agentProfileId: first.agentProfileId,
        gameIds: [first.gameId],
        idempotencyKey: "web-start",
      }, { projector, now }),
      startOwnerLearningReview(db, {
        ownerUserId: first.ownerUserId,
        agentProfileId: second.agentProfileId,
        gameIds: [second.gameId],
        idempotencyKey: "mcp-start",
      }, { projector, now }),
    ]);

    expect([left.status, right.status].sort()).toEqual([
      "existing_open_review",
      "started",
    ]);
    expect(left.reviewId).toBe(right.reviewId);
    expect(await db.select().from(schema.agentLearningReviews)).toHaveLength(1);
    const entitlement = (await db.select().from(schema.agentLearningReviewEntitlements))[0]!;
    expect(entitlement.consumedCompletionAt).toBe("2026-08-04T02:00:00.000Z");
    expect(entitlement.consumedGameId).toBe(second.gameId);
    expect(entitlement.lastPaidReviewStartedAt).toBe(now.toISOString());

    const replay = await startOwnerLearningReview(db, {
      ownerUserId: first.ownerUserId,
      agentProfileId: first.agentProfileId,
      gameIds: [first.gameId],
      idempotencyKey: "web-start",
    }, { projector, now });
    expect(replay.reviewId).toBe(left.reviewId);
    expect(await db.select().from(schema.agentLearningReviews)).toHaveLength(1);
  });

  test("awaiting evidence and generation-disabled preflight spend nothing", async () => {
    for (const mode of ["awaiting", "disabled"] as const) {
      const db = await setupTestDB();
      const fixture = await insertPlayedOwnerLearningAgent(db);
      const evidenceBefore = await db.select().from(schema.agentLearningGameEvidence);
      const projector: OwnerLearningEvidenceProjector = async (_db, selection) =>
        fakeOwnerLearningProjection(
          selection,
          new Map([[fixture.gameId, fixture.gameEvidenceId]]),
          mode === "awaiting" ? "awaiting_evidence" : "evidence_rich",
        );
      const result = await startOwnerLearningReview(db, {
        ownerUserId: fixture.ownerUserId,
        agentProfileId: fixture.agentProfileId,
        gameIds: [fixture.gameId],
        idempotencyKey: `start-${mode}`,
      }, {
        projector,
        generationEnabled: mode !== "disabled",
        now: new Date("2026-08-04T03:00:00.000Z"),
      });

      expect(result.status).toBe(mode === "awaiting" ? "awaiting_evidence" : "generation_unavailable");
      expect(await db.select().from(schema.agentLearningGameEvidence)).toEqual(evidenceBefore);
      expect(await db.select().from(schema.agentLearningReviews)).toHaveLength(0);
      expect(await db.select().from(schema.agentLearningReviewEntitlements)).toHaveLength(0);
    }
  });

  test("does not materialize projected evidence when rolling admission rejects the start", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    await db.insert(schema.agentLearningReviewEntitlements).values({
      ownerUserId: fixture.ownerUserId,
      lastPaidReviewStartedAt: "2026-08-04T02:00:00.000Z",
    });
    const evidenceBefore = await db.select().from(schema.agentLearningGameEvidence);
    const projector: OwnerLearningEvidenceProjector = async (_db, selection) => {
      const projection = fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );
      return {
        ...projection,
        games: projection.games.map((game) => ({
          ...game,
          sourceHash: `sha256:unmaterialized:${game.gameId}`,
        })),
      };
    };

    const result = await startOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      agentProfileId: fixture.agentProfileId,
      gameIds: [fixture.gameId],
      idempotencyKey: "rolling-rejected",
    }, {
      projector,
      now: new Date("2026-08-04T03:00:00.000Z"),
    });

    expect(result.status).toBe("rolling_limited");
    expect(await db.select().from(schema.agentLearningGameEvidence)).toEqual(evidenceBefore);
    expect(await db.select().from(schema.agentLearningReviews)).toEqual([]);
    expect(await db.select().from(schema.agentLearningReviewGames)).toEqual([]);
  });

  test("versions a changed durable source without overwriting the earlier snapshot", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const evidenceBefore = await db.select().from(schema.agentLearningGameEvidence);
    const projector: OwnerLearningEvidenceProjector = async (_db, selection) => {
      const projection = fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );
      return {
        ...projection,
        games: projection.games.map((game) => ({
          ...game,
          sourceHash: `sha256:changed:${game.gameId}`,
        })),
      };
    };

    const result = await startOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      agentProfileId: fixture.agentProfileId,
      gameIds: [fixture.gameId],
      idempotencyKey: "stale-source",
    }, {
      projector,
      now: new Date("2026-08-04T03:00:00.000Z"),
    });

    expect(result.status).toBe("started");
    const evidenceAfter = await db.select().from(schema.agentLearningGameEvidence);
    expect(evidenceAfter).toHaveLength(evidenceBefore.length + 1);
    expect(evidenceAfter.find((row) => row.id === fixture.gameEvidenceId)?.sourceHash)
      .toBe(evidenceBefore[0]!.sourceHash);
    expect(evidenceAfter.some((row) => row.sourceHash === `sha256:changed:${fixture.gameId}`))
      .toBe(true);
    expect(await db.select().from(schema.agentLearningReviewEntitlements)).toHaveLength(1);
    expect(await db.select().from(schema.agentLearningReviews)).toHaveLength(1);
    expect(await db.select().from(schema.agentLearningReviewGames)).toHaveLength(1);
  });

  test("rolls back admission when evidence changes after the read-only preflight", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    await db.delete(schema.agentLearningGameEvidence);
    let projectionCount = 0;
    const projector: OwnerLearningEvidenceProjector = async (_db, selection) => {
      projectionCount += 1;
      const projection = fakeOwnerLearningProjection(
        selection,
        new Map([[fixture.gameId, fixture.gameEvidenceId]]),
      );
      return {
        ...projection,
        games: projection.games.map((game) => ({
          ...game,
          sourceHash: `sha256:source-${projectionCount}:${game.gameId}`,
        })),
      };
    };

    await expect(startOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      agentProfileId: fixture.agentProfileId,
      gameIds: [fixture.gameId],
      idempotencyKey: "source-race",
    }, {
      projector,
      now: new Date("2026-08-04T03:00:00.000Z"),
    })).rejects.toThrow("Owner learning evidence changed after preflight");

    expect(projectionCount).toBe(2);
    expect(await db.select().from(schema.agentLearningGameEvidence)).toEqual([]);
    expect(await db.select().from(schema.agentLearningReviewEntitlements)).toEqual([]);
    expect(await db.select().from(schema.agentLearningReviews)).toEqual([]);
    expect(await db.select().from(schema.agentLearningReviewGames)).toEqual([]);
  });

  test("starts a review from a game-effective runtime variant while reviewing the active strategy", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    const runtimeRevisionId = randomUUID();
    await db.insert(schema.agentRevisions).values({
      id: runtimeRevisionId,
      agentProfileId: fixture.agentProfileId,
      ordinal: 2,
      priorRevisionId: fixture.revisionId,
      trigger: "runtime_policy_change",
      magnitude: "execution",
      fingerprint: `sha256:${runtimeRevisionId}`,
      behaviorSnapshot: {},
      effectiveRuntimeSnapshot: {},
      revisionPolicyVersion: "agent-revision-v2",
    });
    await db.update(schema.gamePlayers).set({ agentRevisionId: runtimeRevisionId })
      .where(eq(schema.gamePlayers.id, fixture.playerId));
    await db.update(schema.agentLearningGameEvidence).set({ analyticalRevisionId: runtimeRevisionId })
      .where(eq(schema.agentLearningGameEvidence.id, fixture.gameEvidenceId));
    const projector: OwnerLearningEvidenceProjector = async (_db, selection) =>
      fakeOwnerLearningProjection(selection, new Map([[fixture.gameId, fixture.gameEvidenceId]]));

    const result = await startOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      agentProfileId: fixture.agentProfileId,
      gameIds: [fixture.gameId],
      idempotencyKey: "runtime-variant-start",
    }, { projector, now: new Date("2026-08-04T03:00:00.000Z") });

    expect(result.status).toBe("started");
    expect(result.preflight?.selection.currentRevisionId).toBe(fixture.revisionId);
    expect(result.preflight?.selection.games[0]!.analyticalRevisionId).toBe(runtimeRevisionId);
    const review = (await db.select().from(schema.agentLearningReviews))[0]!;
    expect(review.reviewedRevisionId).toBe(fixture.revisionId);
  });

  test("lets a persisted sysop start unlimited reviews without consuming credits or rolling allowance", async () => {
    const db = await setupTestDB();
    const fixture = await insertPlayedOwnerLearningAgent(db);
    await grantSysop(db, fixture.ownerUserId);
    const projector: OwnerLearningEvidenceProjector = async (_db, selection) =>
      fakeOwnerLearningProjection(selection, new Map([[fixture.gameId, fixture.gameEvidenceId]]));
    const now = new Date("2026-08-04T03:00:00.000Z");

    const first = await startOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      agentProfileId: fixture.agentProfileId,
      gameIds: [fixture.gameId],
      idempotencyKey: "sysop-first",
    }, { projector, now });
    expect(first.status).toBe("started");
    await db.update(schema.agentLearningReviews).set({
      analysisStatus: "failed",
      stage: "complete",
      resolution: "failed",
      resolvedAt: now.toISOString(),
    }).where(eq(schema.agentLearningReviews.id, first.reviewId!));

    const second = await startOwnerLearningReview(db, {
      ownerUserId: fixture.ownerUserId,
      agentProfileId: fixture.agentProfileId,
      gameIds: [fixture.gameId],
      idempotencyKey: "sysop-second",
    }, { projector, now });

    expect(second.status).toBe("started");
    const entitlement = (await db.select().from(schema.agentLearningReviewEntitlements))[0]!;
    expect(entitlement.consumedCompletionAt).toBeNull();
    expect(entitlement.consumedGameId).toBeNull();
    expect(entitlement.lastPaidReviewStartedAt).toBeNull();
    const events = await db.select().from(schema.agentLearningEvents);
    expect(events.filter((event) => event.kind === "credit_consumed")).toHaveLength(0);
  });
});

async function insertAdditionalPlayedGame(
  db: DrizzleDB,
  fixture: Awaited<ReturnType<typeof insertPlayedOwnerLearningAgent>>,
  completedAt: string,
): Promise<{ gameId: string; gameEvidenceId: string }> {
  const gameId = randomUUID();
  const playerId = randomUUID();
  const gameEvidenceId = randomUUID();
  await db.insert(schema.games).values({
    id: gameId,
    slug: `learning-${gameId}`,
    config: "{}",
    status: "completed",
    trackType: "free",
    endedAt: completedAt,
    minPlayers: 2,
    maxPlayers: 12,
  });
  await db.insert(schema.gamePlayers).values({
    id: playerId,
    gameId,
    userId: fixture.ownerUserId,
    agentProfileId: fixture.agentProfileId,
    agentRevisionId: fixture.revisionId,
    persona: JSON.stringify({ name: "Learner", personality: "Observant" }),
    agentConfig: "{}",
  });
  await db.insert(schema.gameResults).values({
    id: randomUUID(),
    gameId,
    roundsPlayed: 13,
    tokenUsage: "{}",
    finishedAt: completedAt,
  });
  await db.insert(schema.agentLearningGameEvidence).values({
    id: gameEvidenceId,
    ownerUserId: fixture.ownerUserId,
    agentProfileId: fixture.agentProfileId,
    analyticalRevisionId: fixture.revisionId,
    gameId,
    evidenceVersion: "owner-learning-evidence-v2",
    eligibilityPolicyVersion: "owner-learning-eligibility-v1",
    completionAt: completedAt,
    canonicalSnapshot: { reviewedPlayer: { eliminatedRound: null } },
    candidateMoments: [],
    sourceCaptureVersion: "postgame-v2:transcript-v1:cognition-v1",
    sourceHash: `sha256:${gameId}`,
  });
  return { gameId, gameEvidenceId };
}

async function grantSysop(db: DrizzleDB, ownerUserId: string): Promise<void> {
  const walletAddress = `0x${ownerUserId.replaceAll("-", "").slice(0, 40)}`.toLowerCase();
  await db.update(schema.users).set({ walletAddress }).where(eq(schema.users.id, ownerUserId));
  let role = (await db.select().from(schema.roles).where(eq(schema.roles.name, "sysop")))[0];
  if (!role) {
    role = (await db.insert(schema.roles).values({
      id: randomUUID(),
      name: "sysop",
      description: "System operator",
    }).returning())[0]!;
  }
  await db.insert(schema.addressRoles).values({ walletAddress, roleId: role.id });
}
