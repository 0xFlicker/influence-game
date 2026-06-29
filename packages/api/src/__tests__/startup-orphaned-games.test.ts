import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { suspendOrphanedInProgressGamesOnStartup } from "../services/startup-orphaned-games.js";
import { insertGame, insertOwner } from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

describe("startup orphaned game cleanup", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("suspends even recently started in_progress games because startup has no in-memory runner", async () => {
    const gameId = await insertGame(db, {
      id: "recent-startup-orphan",
      status: "in_progress",
    });
    const ownerEpoch = await insertOwner(db, gameId, { status: "active" });
    const startedAt = "2026-06-29T19:00:00.000Z";
    const now = new Date("2026-06-29T19:00:30.000Z");

    await db.update(schema.games)
      .set({ startedAt })
      .where(eq(schema.games.id, gameId));

    const result = await suspendOrphanedInProgressGamesOnStartup(db, { now });

    expect(result).toEqual({
      scanned: 1,
      suspended: [{ gameId, startedAt, ageMs: 30_000 }],
    });

    const [game] = await db.select({
      status: schema.games.status,
      endedAt: schema.games.endedAt,
    })
      .from(schema.games)
      .where(eq(schema.games.id, gameId));
    expect(game?.status).toBe("suspended");
    expect(game?.endedAt).toBeTruthy();

    const [owner] = await db.select({
      status: schema.gameRunOwners.status,
      kernelHealth: schema.gameRunOwners.kernelHealth,
      failureReason: schema.gameRunOwners.failureReason,
      failureDetails: schema.gameRunOwners.failureDetails,
    })
      .from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch));
    expect(owner).toMatchObject({
      status: "expired",
      kernelHealth: "suspended",
      failureReason: "startup_orphaned",
    });
    expect(owner?.failureDetails).toMatchObject({
      startedAt,
      ageMs: 30_000,
      reason: "api_startup_has_no_in_memory_runner",
    });
  });
});
