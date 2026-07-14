import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { GameState, type CanonicalGameEvent } from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";
import { completeCompetitionGame } from "../services/competition-completion.js";
import {
  closeSeason,
  createSeason,
  finalizeSeason,
} from "../services/seasons.js";
import { COMPETITION_RATING_POLICY_VERSION } from "../services/season-policy.js";
import {
  insertCanonicalEventRows,
  insertOwner,
} from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

describe("competition completion", () => {
  test("writes exactly-once receipts, private evidence, ratings, and career counters", async () => {
    const fixture = await createRatedFixture({ duplicateNames: true });
    const first = await completeCompetitionGame(fixture.db, {
      gameId: fixture.gameId,
      winnerId: "atlas",
      roundsPlayed: 1,
      earnedAt: "2026-07-10T20:00:00.000Z",
    });
    const second = await completeCompetitionGame(fixture.db, {
      gameId: fixture.gameId,
      winnerId: "atlas",
      roundsPlayed: 1,
      earnedAt: "2026-07-10T20:00:01.000Z",
    });

    expect(first).toMatchObject({ processed: true, rated: true, eligible: true, receiptCount: 2 });
    expect(second).toMatchObject({ processed: false, rated: true, eligible: true, receiptCount: 2 });
    const receipts = await fixture.db.select().from(schema.competitionReceipts);
    const evidence = await fixture.db.select().from(schema.competitionReceiptEvidence);
    const ratings = await fixture.db.select().from(schema.agentCompetitionRatings);
    const events = await fixture.db.select().from(schema.competitionRatingEvents);
    expect(receipts).toHaveLength(2);
    expect(evidence).toHaveLength(2);
    expect(ratings).toHaveLength(2);
    expect(events.filter((event) => event.eventType === "initialization")).toHaveLength(2);
    expect(events.filter((event) => event.eventType === "game_result")).toHaveLength(2);
    expect(receipts.find((receipt) => receipt.agentProfileId === fixture.atlasProfileId)).toMatchObject({
      placement: 1,
      basePoints: 100,
      totalPoints: 100,
      eligibilityStatus: "eligible",
    });
    expect(evidence[0]).toHaveProperty("opponentRatings");

    const profiles = await fixture.db.select().from(schema.agentProfiles);
    expect(profiles.find((profile) => profile.id === fixture.atlasProfileId)).toMatchObject({
      gamesPlayed: 1,
      gamesWon: 1,
    });
    expect(profiles.find((profile) => profile.id === fixture.miraProfileId)).toMatchObject({
      gamesPlayed: 1,
      gamesWon: 0,
    });
  });

  test("uses House seats in the multiplayer field without persisting House state", async () => {
    const fixture = await createRatedFixture();
    await completeCompetitionGame(fixture.db, {
      gameId: fixture.gameId,
      winnerId: "atlas",
      roundsPlayed: 1,
      earnedAt: "2026-07-10T20:00:00.000Z",
    });

    const evidence = await fixture.db.select().from(schema.competitionReceiptEvidence);
    expect(evidence).toHaveLength(2);
    expect(evidence.every((row) => row.opponentRatings.length === 3)).toBe(true);
    const events = await fixture.db.select().from(schema.competitionRatingEvents);
    expect(events.every((event) => event.agentProfileId === fixture.atlasProfileId
      || event.agentProfileId === fixture.miraProfileId)).toBe(true);
  });

  test("scores field quality from the recorded admission snapshot", async () => {
    const fixture = await createRatedFixture();
    const miraSnapshot = (await fixture.db.select().from(schema.competitionRatingSnapshots))
      .find((snapshot) => snapshot.agentProfileId === fixture.miraProfileId)!;
    await fixture.db.update(schema.competitionRatingSnapshots).set({ mu: 100, sigma: 1 })
      .where(eq(schema.competitionRatingSnapshots.id, miraSnapshot.id));
    await fixture.db.insert(schema.agentCompetitionRatings).values({
      agentProfileId: fixture.miraProfileId,
      effectiveRevisionId: miraSnapshot.agentRevisionId,
      mu: 10,
      sigma: 8,
      gamesPlayed: 0,
      ratingPolicyVersion: "competition-rating-v1",
    });

    await completeCompetitionGame(fixture.db, {
      gameId: fixture.gameId,
      winnerId: "atlas",
      roundsPlayed: 1,
      earnedAt: "2026-07-10T20:00:00.000Z",
    });

    const atlasReceipt = (await fixture.db.select().from(schema.competitionReceipts))
      .find((receipt) => receipt.agentProfileId === fixture.atlasProfileId)!;
    expect(atlasReceipt).toMatchObject({ basePoints: 100, fieldBonus: 20, totalPoints: 120 });
    const atlasEvidence = (await fixture.db.select().from(schema.competitionReceiptEvidence))
      .find((row) => row.receiptId === atlasReceipt.id)!;
    expect(atlasEvidence.opponentRatings).toContainEqual(expect.objectContaining({ mu: 100, sigma: 1 }));
    const miraEvent = (await fixture.db.select().from(schema.competitionRatingEvents))
      .find((event) => event.eventType === "game_result"
        && event.agentProfileId === fixture.miraProfileId)!;
    expect(miraEvent).toMatchObject({ beforeMu: 10, beforeSigma: 8 });
  });

  test("records an ineligible decision when an admission snapshot is missing", async () => {
    const fixture = await createRatedFixture();
    await fixture.db.delete(schema.competitionRatingSnapshots)
      .where(eq(schema.competitionRatingSnapshots.agentProfileId, fixture.miraProfileId));
    const result = await completeCompetitionGame(fixture.db, {
      gameId: fixture.gameId,
      winnerId: "atlas",
      roundsPlayed: 1,
      earnedAt: "2026-07-10T20:00:00.000Z",
    });
    expect(result).toMatchObject({
      eligible: false,
      eligibilityReason: "pregame_rating_snapshot_missing",
    });
    expect((await fixture.db.select().from(schema.competitionReceipts))
      .every((receipt) => receipt.totalPoints === 0)).toBe(true);
  });

  test("serializes concurrent completion retries without double settlement", async () => {
    const fixture = await createRatedFixture();
    const results = await Promise.all([
      completeCompetitionGame(fixture.db, {
        gameId: fixture.gameId,
        winnerId: "atlas",
        roundsPlayed: 1,
        earnedAt: "2026-07-10T20:00:00.000Z",
      }),
      completeCompetitionGame(fixture.db, {
        gameId: fixture.gameId,
        winnerId: "atlas",
        roundsPlayed: 1,
        earnedAt: "2026-07-10T20:00:01.000Z",
      }),
    ]);

    expect(results.map((result) => result.processed).sort()).toEqual([false, true]);
    expect(await fixture.db.select().from(schema.competitionReceipts)).toHaveLength(2);
    expect((await fixture.db.select().from(schema.competitionRatingEvents))
      .filter((event) => event.eventType === "game_result")).toHaveLength(2);
    const profiles = await fixture.db.select().from(schema.agentProfiles);
    expect(profiles.find((profile) => profile.id === fixture.atlasProfileId)?.gamesPlayed).toBe(1);
    expect(profiles.find((profile) => profile.id === fixture.miraProfileId)?.gamesPlayed).toBe(1);
  });

  test("records zero-point decisions and skips game rating updates for an ineligible duplicate-owner roster", async () => {
    const fixture = await createRatedFixture({ sameOwner: true });
    const result = await completeCompetitionGame(fixture.db, {
      gameId: fixture.gameId,
      winnerId: "atlas",
      roundsPlayed: 1,
      earnedAt: "2026-07-10T20:00:00.000Z",
    });

    expect(result).toMatchObject({
      processed: true,
      rated: true,
      eligible: false,
      eligibilityReason: "duplicate_owner_seats",
    });
    const receipts = await fixture.db.select().from(schema.competitionReceipts);
    expect(receipts).toHaveLength(2);
    expect(receipts.every((receipt) => receipt.eligibilityStatus === "ineligible"
      && receipt.totalPoints === 0
      && receipt.placement === null)).toBe(true);
    const ratings = await fixture.db.select().from(schema.agentCompetitionRatings);
    expect(ratings.every((rating) => rating.gamesPlayed === 0)).toBe(true);
    const events = await fixture.db.select().from(schema.competitionRatingEvents);
    expect(events.some((event) => event.eventType === "game_result")).toBe(false);
  });

  test("does not invent placement when canonical completion evidence is absent", async () => {
    const fixture = await createRatedFixture({ omitEvents: true });
    const result = await completeCompetitionGame(fixture.db, {
      gameId: fixture.gameId,
      winnerId: "atlas",
      roundsPlayed: 1,
      earnedAt: "2026-07-10T20:00:00.000Z",
    });

    expect(result).toMatchObject({
      eligible: false,
      eligibilityReason: "canonical_results_unavailable",
    });
    const receipts = await fixture.db.select().from(schema.competitionReceipts);
    expect(receipts.every((receipt) => receipt.placement === null && receipt.totalPoints === 0)).toBe(true);
  });

  test("fails scoring closed on a stale terminal winner but keeps canonical career truth", async () => {
    const fixture = await createRatedFixture();
    const result = await completeCompetitionGame(fixture.db, {
      gameId: fixture.gameId,
      winnerId: "mira",
      roundsPlayed: 1,
      earnedAt: "2026-07-10T20:00:00.000Z",
    });

    expect(result).toMatchObject({ eligible: false, eligibilityReason: "canonical_terminal_mismatch" });
    const receipts = await fixture.db.select().from(schema.competitionReceipts);
    expect(receipts.every((receipt) => receipt.totalPoints === 0)).toBe(true);
    const profiles = await fixture.db.select().from(schema.agentProfiles);
    expect(profiles.find((profile) => profile.id === fixture.atlasProfileId)?.gamesWon).toBe(1);
    expect(profiles.find((profile) => profile.id === fixture.miraProfileId)?.gamesWon).toBe(0);
  });

  test("closes and finalizes a settled season exactly once", async () => {
    const fixture = await createRatedFixture();
    await completeCompetitionGame(fixture.db, {
      gameId: fixture.gameId,
      winnerId: "atlas",
      roundsPlayed: 1,
      earnedAt: "2026-07-10T20:00:00.000Z",
    });
    await fixture.db.update(schema.games).set({
      status: "completed",
      endedAt: "2026-07-10T20:00:01.000Z",
    }).where(eq(schema.games.id, fixture.gameId));

    await closeSeason(fixture.db, fixture.seasonId, "2026-07-10T21:00:00.000Z");
    const first = await finalizeSeason(fixture.db, fixture.seasonId, "2026-07-10T22:00:00.000Z");
    const second = await finalizeSeason(fixture.db, fixture.seasonId, "2026-07-10T23:00:00.000Z");

    expect(second).toEqual(first);
    expect(first.agentChampionAgentProfileId).toBe(fixture.atlasProfileId);
    expect(first.architectContributions[0]).toMatchObject({
      agentId: fixture.atlasProfileId,
      agentName: "Aster Crown",
    });
    expect((await fixture.db.select().from(schema.seasonHonors))).toHaveLength(1);
    expect((await fixture.db.select().from(schema.seasons)
      .where(eq(schema.seasons.id, fixture.seasonId)))[0]?.status).toBe("final");
  });
});

async function createRatedFixture(options: {
  duplicateNames?: boolean;
  sameOwner?: boolean;
  omitEvents?: boolean;
} = {}) {
  const db = await setupTestDB();
  const ownerA = await insertUser(db, "owner-a");
  const ownerB = options.sameOwner ? ownerA : await insertUser(db, "owner-b");
  const atlas = (await createOwnedAgentProfile(db, { userId: ownerA }, {
    name: "Aster Crown",
    personality: "Atlas personality",
  })).profile;
  const mira = (await createOwnedAgentProfile(db, { userId: ownerB }, {
    name: "Maris Crown",
    personality: "Mira personality",
  })).profile;
  const revisions = await db.select().from(schema.agentRevisions);
  const atlasRevision = revisions.find((revision) => revision.agentProfileId === atlas.id)!;
  const miraRevision = revisions.find((revision) => revision.agentProfileId === mira.id)!;
  const season = await createSeason(db, {
    slug: `season-${randomUUID()}`,
    name: "Test Season",
    createdById: ownerA,
  });
  const gameId = randomUUID();
  await db.insert(schema.games).values({
    id: gameId,
    slug: `rated-${gameId}`,
    config: JSON.stringify({ modelTier: "budget" }),
    status: "in_progress",
    trackType: "free",
    seasonId: season.id,
    minPlayers: 4,
    maxPlayers: 4,
    startedAt: "2026-07-10T19:00:00.000Z",
  });
  await db.insert(schema.gamePlayers).values([
    ownedSeat(
      "atlas",
      gameId,
      ownerA,
      atlas.id,
      atlasRevision.id,
      options.duplicateNames ? "Same Name" : "Atlas",
    ),
    houseSeat("echo", gameId, options.duplicateNames ? "Same Name" : "Echo"),
    ownedSeat(
      "mira",
      gameId,
      ownerB,
      mira.id,
      miraRevision.id,
      options.duplicateNames ? "Same Name" : "Mira",
    ),
    houseSeat("nyx", gameId, "Nyx"),
  ]);
  await db.insert(schema.competitionRatingSnapshots).values([
    {
      id: randomUUID(), gameId, agentProfileId: atlas.id, agentRevisionId: atlasRevision.id,
      mu: 25, sigma: 25 / 3, ratingPolicyVersion: COMPETITION_RATING_POLICY_VERSION,
      capturedAt: "2026-07-10T19:00:00.000Z",
    },
    {
      id: randomUUID(), gameId, agentProfileId: mira.id, agentRevisionId: miraRevision.id,
      mu: 25, sigma: 25 / 3, ratingPolicyVersion: COMPETITION_RATING_POLICY_VERSION,
      capturedAt: "2026-07-10T19:00:00.000Z",
    },
  ]);
  if (!options.omitEvents) {
    const events = createTerminalEvents(gameId);
    const ownerEpoch = await insertOwner(db, gameId, { lastPersistedEventSequence: events.at(-1)!.sequence });
    await insertCanonicalEventRows(db, gameId, ownerEpoch, events);
  }
  return {
    db,
    gameId,
    seasonId: season.id,
    atlasProfileId: atlas.id,
    miraProfileId: mira.id,
  };
}

function createTerminalEvents(gameId: string): readonly CanonicalGameEvent[] {
  let tick = 0;
  const state = new GameState([
    { id: "atlas", name: "Same Name" },
    { id: "echo", name: "Same Name" },
    { id: "mira", name: "Same Name" },
    { id: "nyx", name: "Nyx" },
  ], { gameId, now: () => 1_720_000_000_000 + tick++ });
  state.startRound();
  state.recordVote("atlas", "mira", "echo");
  state.recordVote("echo", "mira", "atlas");
  state.recordVote("mira", "echo", "atlas");
  state.recordVote("nyx", "mira", "echo");
  state.tallyEmpowerVotes();
  state.eliminatePlayer("nyx");
  state.setEndgameStage("reckoning");
  state.recordEndgameEliminationVote("atlas", "echo");
  state.recordEndgameEliminationVote("echo", "mira");
  state.recordEndgameEliminationVote("mira", "echo");
  state.tallyEndgameEliminationVotes();
  state.eliminatePlayer("echo");
  state.setEndgameStage("judgment");
  state.recordJuryVote("nyx", "atlas");
  state.recordJuryVote("echo", "atlas");
  state.tallyJuryVotes();
  state.eliminatePlayer("mira");
  return state.getCanonicalEvents();
}

function ownedSeat(
  id: string,
  gameId: string,
  userId: string,
  agentProfileId: string,
  agentRevisionId: string,
  name: string,
): typeof schema.gamePlayers.$inferInsert {
  return {
    id,
    gameId,
    userId,
    agentProfileId,
    agentRevisionId,
    persona: JSON.stringify({ name, personality: `${name} personality` }),
    agentConfig: JSON.stringify({ model: "gpt-5-nano", temperature: 0.9 }),
  };
}

function houseSeat(id: string, gameId: string, name: string): typeof schema.gamePlayers.$inferInsert {
  return {
    id,
    gameId,
    persona: JSON.stringify({ name, personality: "strategic" }),
    agentConfig: JSON.stringify({ model: "gpt-5-nano", temperature: 0.9 }),
  };
}

async function insertUser(db: DrizzleDB, label: string): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.users).values({
    id,
    email: `${label}-${id}@example.test`,
    displayName: label,
  });
  return id;
}
