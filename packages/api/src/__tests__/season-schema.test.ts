import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { backfillAgentRevisions } from "../scripts/backfill-agent-revisions.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { setupTestDB } from "./test-utils.js";

describe("Dual Crown schema", () => {
  test("permits only one active season in a rated pool", async () => {
    const db = await setupTestDB();
    const userId = await insertUser(db, "season-owner");
    await insertSeason(db, userId, "first-season");
    await expectDatabaseRejection(() => insertSeason(db, userId, "second-season"));
  });

  test("backfills one complete revision and repairs lifetime counters idempotently", async () => {
    const db = await setupTestDB();
    const userId = await insertUser(db, "backfill-owner");
    const profileId = randomUUID();
    await db.insert(schema.agentProfiles).values({
      id: profileId,
      userId,
      name: "Mira",
      personality: "Calm and observant",
      backstory: "A patient negotiator.",
      strategyStyle: "Build trust before acting.",
      personaKey: "strategic",
      gamesPlayed: 99,
      gamesWon: 42,
    });

    const gameId = randomUUID();
    const playerId = randomUUID();
    await db.insert(schema.games).values({
      id: gameId,
      slug: `backfill-${gameId}`,
      config: "{}",
      status: "completed",
      trackType: "custom",
      minPlayers: 2,
      maxPlayers: 4,
    });
    await db.insert(schema.gamePlayers).values({
      id: playerId,
      gameId,
      userId,
      agentProfileId: profileId,
      agentRevisionId: null,
      persona: JSON.stringify({ name: "Mira" }),
      agentConfig: "{}",
    });
    await db.insert(schema.gameResults).values({
      id: randomUUID(),
      gameId,
      winnerId: playerId,
      roundsPlayed: 3,
      tokenUsage: "{}",
    });

    const first = await backfillAgentRevisions(db);
    const second = await backfillAgentRevisions(db);
    expect(first).toMatchObject({ profilesScanned: 1, revisionsCreated: 1, revisionsReused: 0 });
    expect(second).toMatchObject({ profilesScanned: 1, revisionsCreated: 0, revisionsReused: 1 });

    const revisions = await db.select().from(schema.agentRevisions);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      agentProfileId: profileId,
      ordinal: 1,
      trigger: "initial_backfill",
      magnitude: "initial",
      revisionPolicyVersion: "agent-revision-v1",
    });
    expect(revisions[0]!.effectiveRuntimeSnapshot).toMatchObject({
      model: "gpt-5-nano",
      providerProfileId: "openai",
      catalogId: "openai:gpt-5-nano",
    });

    const profile = (await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, profileId)))[0];
    expect(profile).toMatchObject({ gamesPlayed: 1, gamesWon: 1 });
  });

  test("keeps public receipts separate, unique, and audit-preserving", async () => {
    const db = await setupTestDB();
    const userId = await insertUser(db, "receipt-owner");
    const seasonId = await insertSeason(db, userId, "receipt-season");
    const profileId = randomUUID();
    await db.insert(schema.agentProfiles).values({
      id: profileId,
      userId,
      name: "Atlas",
      personality: "Careful",
    });
    await backfillAgentRevisions(db);
    const revision = (await db.select().from(schema.agentRevisions))[0]!;
    const gameId = randomUUID();
    await db.insert(schema.games).values({
      id: gameId,
      slug: `receipt-${gameId}`,
      config: "{}",
      status: "completed",
      trackType: "free",
      seasonId,
      minPlayers: 2,
      maxPlayers: 4,
    });

    const receiptId = randomUUID();
    const receipt = {
      id: receiptId,
      seasonId,
      gameId,
      ownerId: userId,
      agentProfileId: profileId,
      agentRevisionId: revision.id,
      agentNameSnapshot: "Atlas",
      eligibilityStatus: "eligible" as const,
      lobbySize: 4,
      placement: 1,
      basePoints: 100,
      fieldBonus: 0,
      totalPoints: 100,
      scoringPolicyVersion: "season-scoring-v1",
      earnedAt: "2026-07-10T00:00:00.000Z",
    };
    await db.insert(schema.competitionReceipts).values(receipt);
    await expectDatabaseRejection(() =>
      db.insert(schema.competitionReceipts).values({ ...receipt, id: randomUUID() })
    );
    await db.insert(schema.competitionReceiptEvidence).values({
      receiptId,
      ratingPolicyVersion: "competition-rating-v1",
      pregameRating: { mu: 25, sigma: 25 / 3 },
      postgameRating: { mu: 30, sigma: 8 },
      opponentRatings: [],
      fieldStrengthEvidence: { bonusRate: 0 },
    });

    const publicRows = await db.select().from(schema.competitionReceipts);
    expect(publicRows[0]).not.toHaveProperty("pregameRating");
    expect(publicRows[0]).not.toHaveProperty("opponentRatings");
    await expectDatabaseRejection(() =>
      db.delete(schema.agentRevisions).where(eq(schema.agentRevisions.id, revision.id))
    );
  });

  test("rejects malformed ineligible receipts and grants season management permission", async () => {
    const db = await setupTestDB();
    await seedRBAC(db);
    const permission = (await db.select().from(schema.permissions)
      .where(eq(schema.permissions.name, "manage_seasons")))[0];
    expect(permission?.description).toContain("Create");
    expect(permission?.description).not.toContain("Activate");

    const userId = await insertUser(db, "invalid-receipt-owner");
    const seasonId = await insertSeason(db, userId, "invalid-receipt-season");
    const profileId = randomUUID();
    await db.insert(schema.agentProfiles).values({
      id: profileId,
      userId,
      name: "Vera",
      personality: "Bold",
    });
    await backfillAgentRevisions(db);
    const revision = (await db.select().from(schema.agentRevisions))[0]!;
    const gameId = randomUUID();
    await db.insert(schema.games).values({
      id: gameId,
      slug: `invalid-${gameId}`,
      config: "{}",
      status: "completed",
      trackType: "free",
      seasonId,
      minPlayers: 2,
      maxPlayers: 4,
    });
    await expectDatabaseRejection(() => db.insert(schema.competitionReceipts).values({
      id: randomUUID(),
      seasonId,
      gameId,
      ownerId: userId,
      agentProfileId: profileId,
      agentRevisionId: revision.id,
      agentNameSnapshot: "Vera",
      eligibilityStatus: "ineligible",
      eligibilityReason: "missing_canonical_placement",
      lobbySize: 4,
      placement: null,
      basePoints: 1,
      fieldBonus: 0,
      totalPoints: 1,
      scoringPolicyVersion: "season-scoring-v1",
      earnedAt: "2026-07-10T00:00:00.000Z",
    }));
  });
});

async function insertUser(db: DrizzleDB, suffix: string): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.users).values({ id, walletAddress: `0x${suffix}` });
  return id;
}

async function insertSeason(db: DrizzleDB, userId: string, slug: string): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.seasons).values({
    id,
    slug,
    name: slug,
    status: "active",
    ratedPool: "free",
    createdById: userId,
  });
  return id;
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
