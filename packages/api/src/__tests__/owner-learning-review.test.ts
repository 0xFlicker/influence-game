import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import {
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
      expect(await db.select().from(schema.agentLearningReviews)).toHaveLength(0);
      expect(await db.select().from(schema.agentLearningReviewEntitlements)).toHaveLength(0);
    }
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
