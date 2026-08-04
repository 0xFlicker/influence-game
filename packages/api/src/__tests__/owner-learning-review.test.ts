import { describe, expect, test } from "bun:test";
import { schema } from "../db/index.js";
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
});
