import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import {
  createOwnedAgentProfile,
  updateOwnedAgentProfile,
} from "../services/agent-profile-management.js";
import {
  acquireGameRunOwner,
  acquireRecoveryGameRunOwner,
  markOwnerStartupFailed,
  revokeActiveGameRunOwner,
} from "../services/game-ownership.js";
import { createSeason } from "../services/seasons.js";
import { COMPETITION_RATING_POLICY_VERSION } from "../services/season-policy.js";
import { setupTestDB } from "./test-utils.js";

describe("atomic game owner claim and roster freeze", () => {
  test("serializes update-before-freeze into one coherent new tuple and snapshot", async () => {
    const fixture = await createRatedWaitingFixture();
    const locked = deferred<void>();
    const release = deferred<void>();
    const blocker = fixture.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM games WHERE id = ${fixture.gameId} FOR UPDATE`);
      locked.resolve(undefined);
      await release.promise;
    });
    await locked.promise;

    const update = updateOwnedAgentProfile(
      fixture.db,
      { userId: fixture.ownerA },
      fixture.profileA.id,
      { personality: "Update wins before freeze." },
    );
    let start: ReturnType<typeof acquireGameRunOwner> | undefined;
    try {
      await waitForBlockedGameLocks(fixture.db, 1);
      start = acquireGameRunOwner(fixture.db, fixture.gameId);
      await waitForBlockedGameLocks(fixture.db, 2);
    } finally {
      release.resolve(undefined);
      await blocker;
    }
    if (!start) throw new Error("Start did not enter the update-first race");

    const [updated, owner] = await Promise.all([update, start]);
    expect(owner.ok).toBeTrue();
    const seat = await ownedSeatFor(fixture.db, fixture.gameId, fixture.profileA.id);
    expect(JSON.parse(seat.persona).personality).toBe("Update wins before freeze.");
    expect(updated.receipt.waitingSeats.games[0]?.effectiveRevisionId).toBe(seat.agentRevisionId!);
    await expectCoherentFrozenSeat(fixture.db, fixture.gameId, seat);
  });

  test("serializes freeze-before-update into one coherent old tuple without a hybrid", async () => {
    const fixture = await createRatedWaitingFixture();
    const locked = deferred<void>();
    const release = deferred<void>();
    const blocker = fixture.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM games WHERE id = ${fixture.gameId} FOR UPDATE`);
      locked.resolve(undefined);
      await release.promise;
    });
    await locked.promise;

    const start = acquireGameRunOwner(fixture.db, fixture.gameId);
    let update: ReturnType<typeof updateOwnedAgentProfile> | undefined;
    try {
      await waitForBlockedGameLocks(fixture.db, 1);
      update = updateOwnedAgentProfile(
        fixture.db,
        { userId: fixture.ownerA },
        fixture.profileA.id,
        { personality: "Update commits after freeze." },
      );
      await waitForBlockedGameLocks(fixture.db, 2);
    } finally {
      release.resolve(undefined);
      await blocker;
    }
    if (!update) throw new Error("Update did not enter the freeze-first race");

    const [owner, updated] = await Promise.all([start, update]);
    expect(owner.ok).toBeTrue();
    expect(updated.receipt.waitingSeats).toMatchObject({ crossedFreeze: 1, reconciled: 0 });
    const seat = await ownedSeatFor(fixture.db, fixture.gameId, fixture.profileA.id);
    expect(JSON.parse(seat.persona).personality).toBe("Original A behavior.");
    expect((await fixture.db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, fixture.profileA.id)))[0]?.personality)
      .toBe("Update commits after freeze.");
    await expectCoherentFrozenSeat(fixture.db, fixture.gameId, seat);
  });

  test("freezes a closing-season roster with exact current rating and revision evidence", async () => {
    const fixture = await createRatedWaitingFixture();
    await fixture.db.insert(schema.agentCompetitionRatings).values({
      agentProfileId: fixture.profileA.id,
      effectiveRevisionId: fixture.profileA.currentRevisionId!,
      mu: 41,
      sigma: 4,
      gamesPlayed: 3,
      ratingPolicyVersion: COMPETITION_RATING_POLICY_VERSION,
    });
    await fixture.db.update(schema.seasons).set({ status: "closing" })
      .where(eq(schema.seasons.id, fixture.seasonId));

    const owner = await acquireGameRunOwner(fixture.db, fixture.gameId);

    expect(owner.ok).toBeTrue();
    const game = await gameRow(fixture.db, fixture.gameId);
    expect(game).toMatchObject({ status: "in_progress" });
    const seats = await fixture.db.select().from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, fixture.gameId));
    const snapshots = await fixture.db.select().from(schema.competitionRatingSnapshots)
      .where(eq(schema.competitionRatingSnapshots.gameId, fixture.gameId));
    expect(snapshots).toHaveLength(2);
    for (const snapshot of snapshots) {
      const seat = seats.find((candidate) => candidate.agentProfileId === snapshot.agentProfileId)!;
      expect(seat.agentRevisionId).toBe(snapshot.agentRevisionId);
    }
    expect(snapshots.find((snapshot) => snapshot.agentProfileId === fixture.profileA.id))
      .toMatchObject({ mu: 41, sigma: 4 });
  });

  test("freezes the environment-resolved tool choice used by owned agents", async () => {
    const savedToolChoice = process.env.INFLUENCE_LLM_TOOL_CHOICE_MODE;
    process.env.INFLUENCE_LLM_TOOL_CHOICE_MODE = "required";
    try {
      const fixture = await createRatedWaitingFixture();
      const owner = await acquireGameRunOwner(fixture.db, fixture.gameId);
      expect(owner.ok).toBeTrue();

      const seat = await ownedSeatFor(fixture.db, fixture.gameId, fixture.profileA.id);
      expect(JSON.parse(seat.agentConfig).toolChoiceMode).toBe("required");
      const revision = (await fixture.db.select().from(schema.agentRevisions)
        .where(eq(schema.agentRevisions.id, seat.agentRevisionId!)))[0]!;
      expect(revision.effectiveRuntimeSnapshot.toolChoiceMode).toBe("required");
    } finally {
      if (savedToolChoice === undefined) delete process.env.INFLUENCE_LLM_TOOL_CHOICE_MODE;
      else process.env.INFLUENCE_LLM_TOOL_CHOICE_MODE = savedToolChoice;
    }
  });

  test("rejects final or missing rated season state without freezing anything", async () => {
    for (const state of ["final", "missing"] as const) {
      const fixture = await createRatedWaitingFixture();
      if (state === "final") {
        await fixture.db.update(schema.seasons).set({ status: "final" })
          .where(eq(schema.seasons.id, fixture.seasonId));
      } else {
        await fixture.db.transaction(async (tx) => {
          // The FK models normal integrity; a transaction-local replica role
          // simulates a legacy/migrated game whose season record is missing.
          await tx.execute(sql`SET LOCAL session_replication_role = replica`);
          await tx.update(schema.games).set({ seasonId: "missing-season" })
            .where(eq(schema.games.id, fixture.gameId));
        });
      }

      const owner = await acquireGameRunOwner(fixture.db, fixture.gameId);

      expect(owner).toMatchObject({
        ok: false,
        statusCode: 409,
        code: "invalid_state",
        reason: "season_not_startable",
        retryable: false,
      });
      expect(await gameRow(fixture.db, fixture.gameId)).toMatchObject({ status: "waiting" });
      expect(await fixture.db.select().from(schema.gameRunOwners)).toHaveLength(0);
      expect(await fixture.db.select().from(schema.competitionRatingSnapshots)).toHaveLength(0);
    }
  });

  test("rejects any name collision involving an owned seat", async () => {
    const fixture = await createRatedWaitingFixture();
    const house = (await fixture.db.select().from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.id, "house-a")))[0]!;
    await fixture.db.update(schema.gamePlayers).set({
      persona: JSON.stringify({ name: fixture.profileA.name, personality: "legacy collision" }),
    }).where(eq(schema.gamePlayers.id, house.id));

    const owner = await acquireGameRunOwner(fixture.db, fixture.gameId);

    expect(owner).toMatchObject({
      ok: false,
      statusCode: 400,
      code: "rated_roster_invalid",
      reason: "name_conflict",
      retryable: false,
      error: expect.stringContaining("name"),
    });
    expect(await gameRow(fixture.db, fixture.gameId)).toMatchObject({ status: "waiting" });
  });

  test("renames only House-to-House collisions deterministically inside freeze", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db, { minPlayers: 4, maxPlayers: 4 });
    await db.insert(schema.gamePlayers).values([
      houseSeat("a", gameId, "Repeat"),
      houseSeat("b", gameId, " repeat "),
      houseSeat("c", gameId, "Echo"),
      houseSeat("d", gameId, "Mira"),
    ]);

    const owner = await acquireGameRunOwner(db, gameId);

    expect(owner.ok).toBeTrue();
    const seats = await db.select().from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, gameId));
    const names = seats.sort((left, right) => left.id.localeCompare(right.id))
      .map((seat) => JSON.parse(seat.persona).name as string);
    expect(names).toEqual(["Repeat", "Atlas", "Echo", "Mira"]);
  });

  test("startup failure closes exactly one owner, voids evidence, and resumes following current behavior", async () => {
    const fixture = await createRatedWaitingFixture();
    const firstOwner = await acquireGameRunOwner(fixture.db, fixture.gameId);
    expect(firstOwner.ok).toBeTrue();
    if (!firstOwner.ok) throw new Error(firstOwner.error);
    const frozenSeat = await ownedSeatFor(fixture.db, fixture.gameId, fixture.profileA.id);

    await updateOwnedAgentProfile(
      fixture.db,
      { userId: fixture.ownerA },
      fixture.profileA.id,
      { personality: "Current behavior after startup failure." },
    );
    expect(await ownedSeatFor(fixture.db, fixture.gameId, fixture.profileA.id)).toEqual(frozenSeat);

    await markOwnerStartupFailed(
      fixture.db,
      fixture.gameId,
      firstOwner.claim.ownerEpoch,
      "provider unavailable before play",
    );

    expect(await gameRow(fixture.db, fixture.gameId)).toMatchObject({ status: "waiting", startedAt: null });
    expect(await fixture.db.select().from(schema.competitionRatingSnapshots)).toHaveLength(0);
    const followingSeat = await ownedSeatFor(fixture.db, fixture.gameId, fixture.profileA.id);
    expect(JSON.parse(followingSeat.persona).personality).toBe("Current behavior after startup failure.");
    expect(followingSeat.agentRevisionId).not.toBe(frozenSeat.agentRevisionId);

    const secondOwner = await acquireGameRunOwner(fixture.db, fixture.gameId);
    expect(secondOwner.ok).toBeTrue();
    const restartedSeat = await ownedSeatFor(fixture.db, fixture.gameId, fixture.profileA.id);
    const snapshot = (await fixture.db.select().from(schema.competitionRatingSnapshots))
      .find((candidate) => candidate.agentProfileId === fixture.profileA.id)!;
    expect(restartedSeat.agentRevisionId).toBe(snapshot.agentRevisionId);

    await expect(markOwnerStartupFailed(
      fixture.db,
      fixture.gameId,
      firstOwner.claim.ownerEpoch,
      "stale retry",
    )).rejects.toMatchObject({ code: "stale_owner" });
    expect(await gameRow(fixture.db, fixture.gameId)).toMatchObject({ status: "in_progress" });
  });

  test("startup teardown commits even when the waiting roster needs profile repair", async () => {
    const fixture = await createRatedWaitingFixture();
    const owner = await acquireGameRunOwner(fixture.db, fixture.gameId);
    expect(owner.ok).toBeTrue();
    if (!owner.ok) throw new Error(owner.error);
    const frozenSeat = await ownedSeatFor(fixture.db, fixture.gameId, fixture.profileA.id);

    await updateOwnedAgentProfile(
      fixture.db,
      { userId: fixture.ownerA },
      fixture.profileA.id,
      { name: "House Quartz" },
    );
    const cleanup = await markOwnerStartupFailed(
      fixture.db,
      fixture.gameId,
      owner.claim.ownerEpoch,
      "provider unavailable before play",
    );

    expect(cleanup).toMatchObject({
      rosterDisposition: "repair_required",
      reconciliationError: { reason: "name_conflict" },
    });
    expect(await gameRow(fixture.db, fixture.gameId)).toMatchObject({ status: "waiting", startedAt: null });
    expect(await fixture.db.select().from(schema.competitionRatingSnapshots)).toHaveLength(0);
    expect(await ownedSeatFor(fixture.db, fixture.gameId, fixture.profileA.id)).toEqual(frozenSeat);
    expect((await fixture.db.select().from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.ownerEpoch, owner.claim.ownerEpoch)))[0])
      .toMatchObject({ status: "closed" });

    expect(await acquireGameRunOwner(fixture.db, fixture.gameId)).toMatchObject({
      ok: false,
      reason: "name_conflict",
    });
    await updateOwnedAgentProfile(
      fixture.db,
      { userId: fixture.ownerA },
      fixture.profileA.id,
      { name: "Aster Repaired" },
    );
    expect((await acquireGameRunOwner(fixture.db, fixture.gameId)).ok).toBeTrue();
  });

  test("never lifts the pin after the owner persisted gameplay", async () => {
    const fixture = await createRatedWaitingFixture();
    const owner = await acquireGameRunOwner(fixture.db, fixture.gameId);
    expect(owner.ok).toBeTrue();
    if (!owner.ok) throw new Error(owner.error);
    const frozenSeat = await ownedSeatFor(fixture.db, fixture.gameId, fixture.profileA.id);
    const snapshotsBefore = await fixture.db.select().from(schema.competitionRatingSnapshots);
    await fixture.db.update(schema.gameRunOwners).set({ lastPersistedEventSequence: 1 })
      .where(eq(schema.gameRunOwners.ownerEpoch, owner.claim.ownerEpoch));

    await expect(markOwnerStartupFailed(
      fixture.db,
      fixture.gameId,
      owner.claim.ownerEpoch,
      "too late to call this startup failure",
    )).rejects.toMatchObject({ code: "stale_owner" });

    expect(await gameRow(fixture.db, fixture.gameId)).toMatchObject({ status: "in_progress" });
    expect(await ownedSeatFor(fixture.db, fixture.gameId, fixture.profileA.id)).toEqual(frozenSeat);
    expect(await fixture.db.select().from(schema.competitionRatingSnapshots)).toEqual(snapshotsBefore);
  });

  test("suspended recovery preserves the frozen seat bytes", async () => {
    const fixture = await createRatedWaitingFixture();
    const owner = await acquireGameRunOwner(fixture.db, fixture.gameId);
    expect(owner.ok).toBeTrue();
    const frozenSeat = await ownedSeatFor(fixture.db, fixture.gameId, fixture.profileA.id);
    await revokeActiveGameRunOwner(fixture.db, fixture.gameId, "test suspension");
    await fixture.db.update(schema.games).set({ status: "suspended" })
      .where(eq(schema.games.id, fixture.gameId));
    await updateOwnedAgentProfile(
      fixture.db,
      { userId: fixture.ownerA },
      fixture.profileA.id,
      { personality: "Future games only." },
    );

    const recovery = await acquireRecoveryGameRunOwner(fixture.db, fixture.gameId, 0);

    expect(recovery.ok).toBeTrue();
    expect(await ownedSeatFor(fixture.db, fixture.gameId, fixture.profileA.id)).toEqual(frozenSeat);
  });
});

async function createRatedWaitingFixture() {
  const db = await setupTestDB();
  const ownerA = await insertUser(db, "freeze-owner-a");
  const ownerB = await insertUser(db, "freeze-owner-b");
  const profileA = (await createOwnedAgentProfile(db, { userId: ownerA }, {
    name: "Aster Freeze",
    personality: "Original A behavior.",
  })).profile;
  const profileB = (await createOwnedAgentProfile(db, { userId: ownerB }, {
    name: "Maris Freeze",
    personality: "Original B behavior.",
  })).profile;
  const season = await createSeason(db, {
    slug: `freeze-${randomUUID()}`,
    name: "Freeze Season",
    createdById: ownerA,
  });
  const gameId = await insertGame(db, {
    seasonId: season.id,
    trackType: "free",
    minPlayers: 4,
    maxPlayers: 4,
  });
  await db.insert(schema.gamePlayers).values([
    provisionalOwnedSeat("owned-a", gameId, ownerA, profileA.id, "Stale A"),
    provisionalOwnedSeat("owned-b", gameId, ownerB, profileB.id, "Stale B"),
    houseSeat("house-a", gameId, "House Quartz"),
    houseSeat("house-b", gameId, "House Onyx"),
  ]);
  return { db, ownerA, ownerB, profileA, profileB, seasonId: season.id, gameId };
}

async function insertUser(db: DrizzleDB, label: string): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.users).values({ id, email: `${label}-${id}@test.invalid`, displayName: label });
  return id;
}

async function insertGame(
  db: DrizzleDB,
  overrides: Partial<typeof schema.games.$inferInsert> = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.games).values({
    id,
    slug: `freeze-game-${id}`,
    config: JSON.stringify({ modelTier: "budget" }),
    status: "waiting",
    minPlayers: 2,
    maxPlayers: 12,
    ...overrides,
  });
  return id;
}

function provisionalOwnedSeat(
  id: string,
  gameId: string,
  userId: string,
  agentProfileId: string,
  name: string,
): typeof schema.gamePlayers.$inferInsert {
  return {
    id,
    gameId,
    userId,
    agentProfileId,
    persona: JSON.stringify({ name, personality: "stale" }),
    agentConfig: JSON.stringify({ model: "stale", temperature: 0.9 }),
  };
}

function houseSeat(
  id: string,
  gameId: string,
  name: string,
): typeof schema.gamePlayers.$inferInsert {
  return {
    id,
    gameId,
    persona: JSON.stringify({ name, personality: "House" }),
    agentConfig: JSON.stringify({ model: "mock", temperature: 0.9 }),
  };
}

async function gameRow(db: DrizzleDB, gameId: string) {
  return (await db.select().from(schema.games).where(eq(schema.games.id, gameId)))[0];
}

async function ownedSeatFor(db: DrizzleDB, gameId: string, profileId: string) {
  return (await db.select().from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.gameId, gameId)))
    .find((seat) => seat.agentProfileId === profileId)!;
}

async function expectCoherentFrozenSeat(
  db: DrizzleDB,
  gameId: string,
  seat: typeof schema.gamePlayers.$inferSelect,
): Promise<void> {
  expect(seat.agentRevisionId).toBeTruthy();
  const revision = (await db.select().from(schema.agentRevisions)
    .where(eq(schema.agentRevisions.id, seat.agentRevisionId!)))[0]!;
  const snapshot = (await db.select().from(schema.competitionRatingSnapshots)
    .where(eq(schema.competitionRatingSnapshots.gameId, gameId)))
    .find((candidate) => candidate.agentProfileId === seat.agentProfileId)!;
  const persona = JSON.parse(seat.persona) as { name: string; personality: string };
  const config = JSON.parse(seat.agentConfig) as { model: string; temperature: number };
  expect(snapshot.agentRevisionId).toBe(revision.id);
  expect(seat.agentProfileId).toBe(revision.agentProfileId);
  expect(revision.effectiveRuntimeSnapshot).toMatchObject({
    name: persona.name,
    personality: persona.personality,
    model: config.model,
    temperature: config.temperature,
  });
}

function deferred<T>() {
  return Promise.withResolvers<T>();
}

async function waitForBlockedGameLocks(db: DrizzleDB, expected: number): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const [row] = await db.execute<{ waiting: number }>(sql`
      SELECT count(*)::int AS waiting
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND datname = current_database()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%games%'
    `);
    if ((row?.waiting ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${expected} blocked game-row transactions`);
}
