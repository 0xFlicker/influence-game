import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";
import {
  SeasonStateError,
  bindFreeGameToActiveSeason,
  closeSeason,
  createSeason,
  finalizeSeason,
  prepareOwnedSeatAdmission,
  validateRatedGameRoster,
} from "../services/seasons.js";
import { setupTestDB } from "./test-utils.js";

describe("season admission and state", () => {
  test("creates an active season immediately and closes admission explicitly", async () => {
    const db = await setupTestDB();
    const userId = await insertUser(db, "season-operator");
    const season = await createSeason(db, {
      slug: "summer-2026",
      name: "Summer 2026",
      createdById: userId,
    });

    expect(season.status).toBe("active");
    await expect(createSeason(db, { slug: "another", name: "Another" }))
      .rejects.toMatchObject({ code: "invalid_state" });
    const closing = await closeSeason(db, season.id, "2026-07-20T00:00:00.000Z");
    expect(closing.status).toBe("closing");
    expect(closing.admissionClosesAt).toBe("2026-07-20T00:00:00.000Z");
    expect(await closeSeason(db, season.id, "2026-07-21T00:00:00.000Z")).toEqual(closing);
  });

  test("closing a season clears standing entries and prompt suppressions", async () => {
    const db = await setupTestDB();
    const ownerId = await insertUser(db, "standing-owner");
    const profile = await createProfile(db, ownerId, "Standing Atlas");
    const season = await createSeason(db, { slug: "standing-season", name: "Standing Season" });
    await db.insert(schema.freeGameQueue).values({
      id: randomUUID(),
      userId: ownerId,
      agentProfileId: profile.id,
    });
    await db.insert(schema.freeQueuePromptSuppressions).values({
      id: randomUUID(),
      userId: ownerId,
      seasonId: season.id,
      reason: "left_queue",
    });

    await closeSeason(db, season.id);

    expect(await db.select().from(schema.freeGameQueue)).toEqual([]);
    expect(await db.select().from(schema.freeQueuePromptSuppressions)).toEqual([]);
  });

  test("normalizes season boundaries and rejects malformed or reversed windows", async () => {
    const db = await setupTestDB();
    const owner = await insertUser(db, "timestamp-owner");
    const normalized = await createSeason(db, {
      slug: "normalized-window",
      name: "Normalized Window",
      createdById: owner,
      admissionStartsAt: "2026-07-10T10:00:00-07:00",
      admissionClosesAt: "2026-07-10T12:00:00-07:00",
    });
    expect(normalized.admissionStartsAt).toBe("2026-07-10T17:00:00.000Z");
    expect(normalized.admissionClosesAt).toBe("2026-07-10T19:00:00.000Z");
    await closeSeason(db, normalized.id);
    await expect(createSeason(db, {
      slug: "malformed-window",
      name: "Malformed Window",
      admissionStartsAt: "yesterday-ish",
    })).rejects.toMatchObject({ code: "invalid_state" });
    await expect(createSeason(db, {
      slug: "reversed-window",
      name: "Reversed Window",
      admissionStartsAt: "2026-07-11T00:00:00Z",
      admissionClosesAt: "2026-07-10T00:00:00Z",
    })).rejects.toMatchObject({ code: "invalid_state" });
  });

  test("serializes concurrent season creation into one active season and one conflict", async () => {
    const db = await setupTestDB();
    const results = await Promise.allSettled([
      createSeason(db, { slug: "concurrent-a", name: "Concurrent A" }),
      createSeason(db, { slug: "concurrent-b", name: "Concurrent B" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null)
      .toMatchObject({ code: "invalid_state" });
    expect(await db.select().from(schema.seasons)).toHaveLength(1);
  });

  test("binds a free roster to the active season and pins exact owned revisions", async () => {
    const db = await setupTestDB();
    const ownerA = await insertUser(db, "owner-a");
    const ownerB = await insertUser(db, "owner-b");
    const profileA = await createProfile(db, ownerA, "Atlas");
    const profileB = await createProfile(db, ownerB, "Mira");
    const season = await activeSeason(db, ownerA, "rated-roster");
    const gameId = await insertWaitingFreeGame(db);
    await insertOwnedSeat(db, gameId, ownerA, profileA.id, "Atlas");
    await insertOwnedSeat(db, gameId, ownerB, profileB.id, "Mira");
    await insertHouseSeat(db, gameId, "House Nyx");

    const admission = await db.transaction((tx) => bindFreeGameToActiveSeason(tx, gameId));
    expect(admission).toEqual({ rated: true, seasonId: season.id });

    const game = (await db.select().from(schema.games).where(eq(schema.games.id, gameId)))[0];
    const players = await db.select().from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, gameId));
    expect(game?.seasonId).toBe(season.id);
    expect(players.filter((player) => player.agentProfileId).every((player) => player.agentRevisionId)).toBe(true);
    expect(players.find((player) => !player.agentProfileId)?.agentRevisionId).toBeNull();
    expect(await db.select().from(schema.competitionRatingSnapshots)).toHaveLength(2);
    expect(await validateRatedGameRoster(db, gameId)).toEqual({ rated: true });
  });

  test("leaves free games explicitly unrated when no season is active", async () => {
    const db = await setupTestDB();
    const owner = await insertUser(db, "unrated-owner");
    const profile = await createProfile(db, owner, "Vera");
    const gameId = await insertWaitingFreeGame(db);
    await insertOwnedSeat(db, gameId, owner, profile.id, "Vera");

    const admission = await db.transaction((tx) => bindFreeGameToActiveSeason(tx, gameId));
    expect(admission).toEqual({ rated: false, seasonId: null });
    const player = (await db.select().from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, gameId)))[0];
    expect(player?.agentRevisionId).toBeNull();
    expect(await validateRatedGameRoster(db, gameId)).toEqual({ rated: false });
  });

  test("rejects duplicate owners at admission and through a later generic join", async () => {
    const db = await setupTestDB();
    const owner = await insertUser(db, "duplicate-owner");
    const first = await createProfile(db, owner, "First");
    const second = await createProfile(db, owner, "Second");
    await activeSeason(db, owner, "duplicate-season");
    const gameId = await insertWaitingFreeGame(db);
    await insertOwnedSeat(db, gameId, owner, first.id, "First");
    await insertOwnedSeat(db, gameId, owner, second.id, "Second");

    await expect(db.transaction((tx) => bindFreeGameToActiveSeason(tx, gameId)))
      .rejects.toBeInstanceOf(SeasonStateError);

    await db.delete(schema.gamePlayers).where(eq(schema.gamePlayers.agentProfileId, second.id));
    await db.transaction((tx) => bindFreeGameToActiveSeason(tx, gameId));
    await expect(db.transaction((tx) => prepareOwnedSeatAdmission(tx, {
      gameId,
      userId: owner,
      profile: second,
    }))).rejects.toMatchObject({ code: "rated_roster_invalid" });
  });

  test("rejects rated seats that do not pair an owner with a saved profile", async () => {
    const db = await setupTestDB();
    const owner = await insertUser(db, "unpaired-owner");
    await activeSeason(db, owner, "unpaired-season");
    const gameId = await insertWaitingFreeGame(db);
    await db.insert(schema.gamePlayers).values({
      id: randomUUID(),
      gameId,
      userId: owner,
      persona: JSON.stringify({ name: "Unsaved", personality: "invalid rated seat" }),
      agentConfig: "{}",
    });

    await expect(db.transaction((tx) => bindFreeGameToActiveSeason(tx, gameId)))
      .rejects.toMatchObject({ code: "rated_roster_invalid" });
  });

  test("rechecks game state while holding the rated admission lock", async () => {
    const db = await setupTestDB();
    const owner = await insertUser(db, "started-owner");
    const profile = await createProfile(db, owner, "Latecomer");
    const season = await activeSeason(db, owner, "started-season");
    const gameId = await insertWaitingFreeGame(db);
    await db.update(schema.games).set({
      status: "in_progress",
      startedAt: new Date().toISOString(),
      seasonId: season.id,
    }).where(eq(schema.games.id, gameId));

    await expect(db.transaction((tx) => prepareOwnedSeatAdmission(tx, {
      gameId,
      userId: owner,
      profile,
    }))).rejects.toMatchObject({ code: "rated_roster_invalid" });
  });

  test("keeps admitted games in a closing season and blocks premature finalization", async () => {
    const db = await setupTestDB();
    const owner = await insertUser(db, "boundary-owner");
    const profile = await createProfile(db, owner, "Boundary");
    const season = await activeSeason(db, owner, "boundary-season");
    const gameId = await insertWaitingFreeGame(db);
    await insertOwnedSeat(db, gameId, owner, profile.id, "Boundary");
    await insertHouseSeat(db, gameId, "House");
    await db.transaction((tx) => bindFreeGameToActiveSeason(tx, gameId));

    await closeSeason(db, season.id);
    expect(await validateRatedGameRoster(db, gameId)).toEqual({ rated: true });
    await expect(finalizeSeason(db, season.id)).rejects.toMatchObject({ code: "season_not_ready" });

    const game = (await db.select().from(schema.games).where(eq(schema.games.id, gameId)))[0];
    expect(game?.seasonId).toBe(season.id);
    await expect(db.transaction((tx) => prepareOwnedSeatAdmission(tx, {
      gameId,
      userId: owner,
      profile,
    }))).rejects.toMatchObject({ code: "invalid_state" });
  });
});

async function insertUser(db: DrizzleDB, label: string): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.users).values({
    id,
    email: `${label}@example.test`,
    displayName: label,
  });
  return id;
}

async function createProfile(db: DrizzleDB, userId: string, name: string) {
  return (await createOwnedAgentProfile(db, { userId }, {
    name,
    personality: `${name} personality`,
  })).profile;
}

async function activeSeason(db: DrizzleDB, userId: string, slug: string) {
  return createSeason(db, { slug, name: slug, createdById: userId });
}

async function insertWaitingFreeGame(db: DrizzleDB): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.games).values({
    id,
    slug: `game-${id}`,
    config: JSON.stringify({ modelTier: "budget" }),
    status: "waiting",
    trackType: "free",
    minPlayers: 2,
    maxPlayers: 12,
  });
  return id;
}

async function insertOwnedSeat(
  db: DrizzleDB,
  gameId: string,
  userId: string,
  profileId: string,
  name: string,
): Promise<void> {
  await db.insert(schema.gamePlayers).values({
    id: randomUUID(),
    gameId,
    userId,
    agentProfileId: profileId,
    persona: JSON.stringify({ name, personality: `${name} personality` }),
    agentConfig: JSON.stringify({ model: "gpt-5-nano", temperature: 0.9 }),
  });
}

async function insertHouseSeat(db: DrizzleDB, gameId: string, name: string): Promise<void> {
  await db.insert(schema.gamePlayers).values({
    id: randomUUID(),
    gameId,
    persona: JSON.stringify({ name, personality: "strategic" }),
    agentConfig: JSON.stringify({ model: "gpt-5-nano", temperature: 0.9 }),
  });
}
