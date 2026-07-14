import { beforeEach, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import {
  AgentProfileManagementError,
  createOwnedAgentProfile,
  updateOwnedAgent,
  updateOwnedAgentProfile,
} from "../services/agent-profile-management.js";
import { admitOwnedSeatInTransaction } from "../services/owned-seat-projection.js";
import { setupTestDB } from "./test-utils.js";

const OWNER_ID = "revision-loop-owner";

describe("agent revision update loop", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
    await db.insert(schema.users).values({
      id: OWNER_ID,
      email: "revision-loop-owner@test.example",
      displayName: "Revision Loop Owner",
    });
  });

  test("updates one Lillith-shaped identity while preserving history and standing membership", async () => {
    const profile = await createAgent("Lillith Voss");
    await db.update(schema.agentProfiles).set({ gamesPlayed: 8, gamesWon: 3 })
      .where(eq(schema.agentProfiles.id, profile.id));
    await db.insert(schema.freeGameQueue).values({
      id: "lillith-standing",
      userId: OWNER_ID,
      agentProfileId: profile.id,
      joinedAt: "2026-07-01T12:34:56.000Z",
      consecutiveMisses: 4,
    });
    await insertGame("lillith-waiting", "lillith-waiting");
    await admit(profile.id, "lillith-waiting");

    const standingBefore = await db.select().from(schema.freeGameQueue);
    const revisionsBefore = await db.select().from(schema.agentRevisions)
      .where(eq(schema.agentRevisions.agentProfileId, profile.id));

    const result = await updateOwnedAgentProfile(db, { userId: OWNER_ID }, profile.id, {
      personality: "Patiently maps every promise, then strikes when the coalition is committed.",
      strategyStyle: "Keep precise social receipts and force decisive endgames.",
    });

    const persisted = (await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profile.id)))[0]!;
    const standingAfter = await db.select().from(schema.freeGameQueue);
    const seat = (await db.select().from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, "lillith-waiting")))[0]!;
    const persona = JSON.parse(seat.persona) as { personality: string; strategyHints: string };
    const revisionsAfter = await db.select().from(schema.agentRevisions)
      .where(eq(schema.agentRevisions.agentProfileId, profile.id));

    expect(persisted.id).toBe(profile.id);
    expect(persisted.gamesPlayed).toBe(8);
    expect(persisted.gamesWon).toBe(3);
    expect(standingAfter).toEqual(standingBefore);
    expect(revisionsAfter.length).toBeGreaterThan(revisionsBefore.length);
    expect(revisionsAfter.every((revision) => revision.agentProfileId === profile.id)).toBe(true);
    expect(persona).toMatchObject({
      personality: "Patiently maps every promise, then strikes when the coalition is committed.",
      strategyHints: "Keep precise social receipts and force decisive endgames.",
    });
    expect(result.receipt).toEqual({
      schemaVersion: 1,
      operation: "updated",
      agent: { agentProfileId: profile.id, identityDisposition: "preserved" },
      profileRevision: {
        revisionId: result.profileRevision.revisionId,
        ordinal: result.profileRevision.ordinal,
        outcome: "created",
        active: true,
      },
      dailyFree: "preserved_follows_profile",
      waitingSeats: {
        total: 1,
        reconciled: 1,
        alreadyCurrent: 0,
        crossedFreeze: 0,
        games: [{
          gameId: "lillith-waiting",
          slug: "lillith-waiting",
          disposition: "reconciled",
          effectiveRevisionId: seat.agentRevisionId,
        }],
        truncatedCount: 0,
      },
      frozenSeats: { unchanged: 0 },
      warnings: [],
    });
  });

  test("rejects a cross-owner update before contending on the foreign waiting game", async () => {
    const foreignOwnerId = "revision-loop-foreign-owner";
    await db.insert(schema.users).values({
      id: foreignOwnerId,
      email: "revision-loop-foreign@test.example",
      displayName: "Foreign Owner",
    });
    const foreign = await createOwnedAgentProfile(db, { userId: foreignOwnerId }, {
      name: "Foreign Waiting Agent",
      personality: "Must remain private and unchanged.",
      personaKey: "strategic",
    });
    await insertGame("foreign-waiting", "foreign-waiting");
    await admit(foreign.profile.id, "foreign-waiting", foreignOwnerId);
    const profileBefore = (await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, foreign.profile.id)))[0]!;
    const seatBefore = (await db.select().from(schema.gamePlayers))[0]!;
    const revisionsBefore = await db.select().from(schema.agentRevisions);

    const gameLocked = deferred<void>();
    const releaseGame = deferred<void>();
    const locker = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM games WHERE id = 'foreign-waiting' FOR UPDATE`);
      gameLocked.resolve(undefined);
      await releaseGame.promise;
    });
    await gameLocked.promise;

    const attemptedUpdate = updateOwnedAgentProfile(db, { userId: OWNER_ID }, foreign.profile.id, {
      personality: "Unauthorized mutation.",
    }).then(
      () => ({ kind: "unexpected-success" as const }),
      (error: unknown) => ({ kind: "error" as const, error }),
    );
    const outcome = await Promise.race([
      attemptedUpdate,
      new Promise<{ kind: "blocked" }>((resolve) => {
        setTimeout(() => resolve({ kind: "blocked" }), 250);
      }),
    ]);
    releaseGame.resolve(undefined);
    await locker;

    expect(outcome.kind).toBe("error");
    if (outcome.kind !== "error") {
      await attemptedUpdate;
      throw new Error("Cross-owner update blocked on a foreign game");
    }
    expect(outcome.error).toMatchObject({
      code: "agent_not_found",
      statusCode: 404,
    } satisfies Partial<AgentProfileManagementError>);
    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, foreign.profile.id)))[0]).toEqual(profileBefore);
    expect((await db.select().from(schema.gamePlayers))[0]).toEqual(seatBefore);
    expect(await db.select().from(schema.agentRevisions)).toEqual(revisionsBefore);
  });

  test("presentation-only edits preserve the active revision and current waiting tuple", async () => {
    const profile = await createAgent("Presentation Agent");
    await insertGame("presentation-waiting", "presentation-waiting");
    await admit(profile.id, "presentation-waiting");
    const seatBefore = (await db.select().from(schema.gamePlayers))[0]!;

    const result = await updateOwnedAgentProfile(db, {
      userId: OWNER_ID,
      avatarChangeSource: "web_manual_update",
    }, profile.id, {
      avatarUrl: "https://example.test/avatar.png",
    });

    const seatAfter = (await db.select().from(schema.gamePlayers))[0]!;
    expect(result.profileRevision.outcome).toBe("preserved");
    expect(result.receipt.waitingSeats).toMatchObject({
      total: 1,
      reconciled: 0,
      alreadyCurrent: 1,
      crossedFreeze: 0,
    });
    expect(result.receipt.waitingSeats.games[0]).toMatchObject({
      disposition: "already_current",
      effectiveRevisionId: seatBefore.agentRevisionId,
    });
    expect(seatAfter).toEqual(seatBefore);
    expect(await db.select().from(schema.avatarChangeEvents)).toHaveLength(1);
  });

  test("reconciles every waiting follower and leaves frozen execution byte-for-byte unchanged", async () => {
    const profile = await createAgent("Many Games Agent");
    await insertGame("waiting-a", "waiting-a", { modelTier: "budget" });
    await insertGame("waiting-b", "waiting-b", { modelTier: "premium" });
    await insertGame("frozen-game", "frozen-game", { modelTier: "budget" });
    await insertGame("suspended-game", "suspended-game", { modelTier: "premium" });
    await admit(profile.id, "waiting-a");
    await admit(profile.id, "waiting-b");
    await admit(profile.id, "frozen-game");
    await admit(profile.id, "suspended-game");
    await db.update(schema.games).set({
      status: "in_progress",
      startedAt: "2026-07-14T01:00:00.000Z",
    }).where(eq(schema.games.id, "frozen-game"));
    await db.update(schema.games).set({
      status: "suspended",
      startedAt: "2026-07-14T00:30:00.000Z",
    }).where(eq(schema.games.id, "suspended-game"));
    const frozenBefore = await db.select().from(schema.gamePlayers)
      .where(sql`${schema.gamePlayers.gameId} IN ('frozen-game', 'suspended-game')`)
      .orderBy(schema.gamePlayers.gameId);

    const result = await updateOwnedAgentProfile(db, { userId: OWNER_ID }, profile.id, {
      personality: "New behavior for every future follower.",
    });

    const waitingSeats = await db.select().from(schema.gamePlayers)
      .where(sql`${schema.gamePlayers.gameId} IN ('waiting-a', 'waiting-b')`)
      .orderBy(schema.gamePlayers.gameId);
    const frozenAfter = await db.select().from(schema.gamePlayers)
      .where(sql`${schema.gamePlayers.gameId} IN ('frozen-game', 'suspended-game')`)
      .orderBy(schema.gamePlayers.gameId);
    expect(waitingSeats.map((seat) => JSON.parse(seat.persona).personality)).toEqual([
      "New behavior for every future follower.",
      "New behavior for every future follower.",
    ]);
    expect(frozenAfter).toEqual(frozenBefore);
    expect(result.receipt.waitingSeats).toMatchObject({
      total: 2,
      reconciled: 2,
      alreadyCurrent: 0,
      crossedFreeze: 0,
    });
    expect(result.receipt.frozenSeats).toEqual({ unchanged: 2 });
  });

  test("reports a real PostgreSQL follower that crosses freeze while the update waits on the game lock", async () => {
    const profile = await createAgent("Freeze Race Agent");
    await insertGame("freeze-race", "freeze-race");
    await admit(profile.id, "freeze-race");
    const seatBefore = (await db.select().from(schema.gamePlayers))[0]!;
    const gameLocked = deferred<void>();
    const releaseFreeze = deferred<void>();
    const freezer = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM games WHERE id = 'freeze-race' FOR UPDATE`);
      gameLocked.resolve(undefined);
      await releaseFreeze.promise;
      await tx.update(schema.games).set({
        status: "in_progress",
        startedAt: "2026-07-14T02:00:00.000Z",
      }).where(eq(schema.games.id, "freeze-race"));
    });
    await gameLocked.promise;

    const update = updateOwnedAgentProfile(db, { userId: OWNER_ID }, profile.id, {
      personality: "This becomes current for future games only.",
    });
    let lockWaitError: unknown;
    try {
      await waitForBlockedDatabaseLock(db);
    } catch (error) {
      lockWaitError = error;
    } finally {
      releaseFreeze.resolve(undefined);
      await freezer;
    }
    const result = await update;
    if (lockWaitError) throw lockWaitError;

    const seatAfter = (await db.select().from(schema.gamePlayers))[0]!;
    expect(seatAfter).toEqual(seatBefore);
    expect(result.receipt.waitingSeats).toMatchObject({
      total: 1,
      reconciled: 0,
      alreadyCurrent: 0,
      crossedFreeze: 1,
      truncatedCount: 0,
    });
    expect(result.receipt.waitingSeats.games).toEqual([{
      gameId: "freeze-race",
      slug: "freeze-race",
      disposition: "crossed_freeze",
      effectiveRevisionId: seatBefore.agentRevisionId,
    }]);
    expect(result.receipt.frozenSeats).toEqual({ unchanged: 1 });
  });

  test("rolls back profile, revision, seat, and avatar audit on a waiting-roster name conflict", async () => {
    const profile = await createAgent("Original Name");
    await insertGame("rename-conflict", "rename-conflict");
    await admit(profile.id, "rename-conflict");
    await db.insert(schema.gamePlayers).values({
      id: "house-conflict",
      gameId: "rename-conflict",
      persona: JSON.stringify({ name: "Conflict Name", personality: "House seat" }),
      agentConfig: JSON.stringify({ model: "test", temperature: 0.9 }),
    });
    const profileBefore = (await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profile.id)))[0]!;
    const seatBefore = (await db.select().from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.agentProfileId, profile.id)))[0]!;
    const revisionsBefore = await db.select().from(schema.agentRevisions);

    await expect(updateOwnedAgentProfile(db, {
      userId: OWNER_ID,
      avatarChangeSource: "mcp_update",
    }, profile.id, {
      name: " conflict name ",
      personality: "This must roll back too.",
      avatarUrl: "https://example.test/should-not-commit.png",
    })).rejects.toMatchObject({
      code: "waiting_roster_name_conflict",
      statusCode: 409,
    } satisfies Partial<AgentProfileManagementError>);

    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profile.id)))[0]).toEqual(profileBefore);
    expect((await db.select().from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.agentProfileId, profile.id)))[0]).toEqual(seatBefore);
    expect(await db.select().from(schema.agentRevisions)).toEqual(revisionsBefore);
    expect(await db.select().from(schema.avatarChangeEvents)).toHaveLength(0);
  });

  test("rolls the active update back when a waiting seat cannot be reconciled", async () => {
    const profile = await createAgent("Broken Follower");
    await insertGame("broken-follower", "broken-follower");
    await admit(profile.id, "broken-follower");
    await db.update(schema.gamePlayers).set({ agentConfig: "not-json" })
      .where(eq(schema.gamePlayers.gameId, "broken-follower"));
    const profileBefore = (await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profile.id)))[0]!;
    const revisionsBefore = await db.select().from(schema.agentRevisions);

    await expect(updateOwnedAgentProfile(db, { userId: OWNER_ID }, profile.id, {
      personality: "Must not become active without the follower.",
    })).rejects.toMatchObject({
      code: "agent_update_reconciliation_failed",
      statusCode: 409,
    } satisfies Partial<AgentProfileManagementError>);

    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profile.id)))[0]).toEqual(profileBefore);
    expect(await db.select().from(schema.agentRevisions)).toEqual(revisionsBefore);
  });

  test("rolls the complete update back when the local avatar audit cannot be written", async () => {
    const profile = await createAgent("Atomic Avatar");
    await insertGame("atomic-avatar", "atomic-avatar");
    await admit(profile.id, "atomic-avatar");
    const profileBefore = (await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profile.id)))[0]!;
    const seatBefore = (await db.select().from(schema.gamePlayers))[0]!;
    const revisionsBefore = await db.select().from(schema.agentRevisions);

    await expect(updateOwnedAgentProfile(db, {
      userId: OWNER_ID,
      avatarChangeSource: "mcp_update",
      avatarGenerationRequestId: "missing-generation-request",
    }, profile.id, {
      personality: "This edit must vanish with the failed audit.",
      avatarUrl: "https://example.test/atomic.png",
    })).rejects.toBeTruthy();

    expect((await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profile.id)))[0]).toEqual(profileBefore);
    expect((await db.select().from(schema.gamePlayers))[0]).toEqual(seatBefore);
    expect(await db.select().from(schema.agentRevisions)).toEqual(revisionsBefore);
    expect(await db.select().from(schema.avatarChangeEvents)).toHaveLength(0);
  });

  test("commits the update and reports a warning when external avatar generation fails", async () => {
    const profile = await createAgent("Avatar Warning");
    const result = await updateOwnedAgent(db, {
      userId: OWNER_ID,
      avatarCompletion: {
        triggerSource: "mcp_create_default",
        request: async () => ({
          status: "failed",
          failureCode: "provider_unavailable",
          failureStage: "provider_submit",
          retryable: true,
        }),
      },
    }, {
      agentId: profile.id,
      personalityPrompt: "The behavior update still commits.",
    });

    expect(result.agent.personalityPrompt).toBe("The behavior update still commits.");
    expect(result.receipt.warnings).toEqual(["avatar_generation_failed"]);
    expect(result.receipt.avatarCompletion).toEqual({
      status: "failed",
      failureCode: "provider_unavailable",
      failureStage: "provider_submit",
      retryable: true,
    });
    expect(result.avatarCompletion).toEqual(result.receipt.avatarCompletion);
  });

  test("bounds waiting-game receipt details without losing exact counts", async () => {
    const profile = await createAgent("Bounded Receipt");
    for (let index = 0; index < 12; index += 1) {
      const suffix = String(index).padStart(2, "0");
      await insertGame(`bounded-${suffix}`, `bounded-${suffix}`);
      await admit(profile.id, `bounded-${suffix}`);
    }

    const result = await updateOwnedAgentProfile(db, { userId: OWNER_ID }, profile.id, {
      personality: "One update reaches all twelve waiting seats.",
    });

    expect(result.receipt.waitingSeats).toMatchObject({
      total: 12,
      reconciled: 12,
      alreadyCurrent: 0,
      crossedFreeze: 0,
      truncatedCount: 2,
    });
    expect(result.receipt.waitingSeats.games).toHaveLength(10);
    expect(result.receipt.waitingSeats.games.map((game) => game.gameId)).toEqual(
      Array.from({ length: 10 }, (_, index) => `bounded-${String(index).padStart(2, "0")}`),
    );
  });

  async function createAgent(name: string) {
    const result = await createOwnedAgentProfile(db, { userId: OWNER_ID }, {
      name,
      personality: `${name} original personality`,
      backstory: `${name} history`,
      strategyStyle: "Original strategy",
      personaKey: "strategic",
    });
    return result.profile;
  }

  async function insertGame(
    id: string,
    slug: string,
    config: { modelTier?: string } = {},
  ): Promise<void> {
    await db.insert(schema.games).values({
      id,
      slug,
      config: JSON.stringify({ modelTier: config.modelTier ?? "budget" }),
      status: "waiting",
      trackType: "custom",
      minPlayers: 2,
      maxPlayers: 12,
    });
  }

  async function admit(
    agentProfileId: string,
    gameId: string,
    userId = OWNER_ID,
  ): Promise<void> {
    await db.transaction((tx) => admitOwnedSeatInTransaction(tx, {
      gameId,
      userId,
      agentProfileId,
    }));
  }
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function waitForBlockedDatabaseLock(db: DrizzleDB): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await db.execute<{ waiting: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND query LIKE '%FROM games%'
          AND query LIKE '%ORDER BY id%'
          AND query LIKE '%FOR UPDATE%'
      ) AS waiting
    `);
    if (row?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the profile update to contend on the game lock");
}
