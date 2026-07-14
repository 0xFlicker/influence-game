import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { createSessionToken } from "../middleware/auth.js";
import { createFreeQueueRoutes } from "../routes/free-queue.js";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";
import { abortAllGames } from "../services/game-lifecycle.js";
import { createSeason } from "../services/seasons.js";
import { setupTestDB } from "./test-utils.js";

const savedMockRunner = process.env.INFLUENCE_API_TEST_MOCK_RUNNER;

beforeAll(() => {
  process.env.JWT_SECRET = "free-queue-season-test-secret";
  process.env.INFLUENCE_API_TEST_MOCK_RUNNER = "true";
});

afterAll(async () => {
  await abortAllGames();
  if (savedMockRunner === undefined) delete process.env.INFLUENCE_API_TEST_MOCK_RUNNER;
  else process.env.INFLUENCE_API_TEST_MOCK_RUNNER = savedMockRunner;
});

describe("free queue season admission", () => {
  test("REST join preserves its response id and maps owned-agent errors", async () => {
    const db = await setupTestDB();
    const ownerId = await insertUser(db, "rest-owner");
    await createSeason(db, { slug: "rest-season", name: "REST Season" });
    const ownProfile = (await createOwnedAgentProfile(db, { userId: ownerId }, {
      name: "REST Atlas",
      personality: "Patient",
    })).profile;
    const other = await createQueuedAgent(db, "rest-other", "Other Agent");
    await db.delete(schema.freeGameQueue).where(eq(schema.freeGameQueue.userId, other.userId));
    const token = await createSessionToken(ownerId, { roles: ["player"], permissions: [] });
    const app = new Hono().route("/", createFreeQueueRoutes(db));

    for (const agentProfileId of ["missing-agent", other.profileId]) {
      const rejected = await app.request("/api/free-queue/join", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ agentProfileId }),
      });
      expect(rejected.status).toBe(404);
      expect(await rejected.json()).toMatchObject({ code: "agent_not_found" });
    }

    const joined = await app.request("/api/free-queue/join", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ agentProfileId: ownProfile.id }),
    });
    expect(joined.status).toBe(201);
    const body = await joined.json() as { id: string; agentProfileId: string };
    const entry = (await db.select().from(schema.freeGameQueue)
      .where(eq(schema.freeGameQueue.userId, ownerId)))[0]!;
    expect(body).toEqual(expect.objectContaining({ id: entry.id, agentProfileId: ownProfile.id }));
  });

  test("draw atomically binds an active season and every owned revision", async () => {
    const db = await setupTestDB();
    const operatorId = await insertUser(db, "operator");
    const queued = await Promise.all([
      createQueuedAgent(db, "alice", "Atlas Daily"),
      createQueuedAgent(db, "bob", "Mira Daily"),
    ]);
    const season = await createSeason(db, {
      slug: "daily-summer",
      name: "Daily Summer",
      createdById: operatorId,
    });

    const token = await createSessionToken(operatorId, {
      roles: ["scheduler"],
      permissions: ["schedule_free_game"],
    });
    const app = new Hono().route("/", createFreeQueueRoutes(db));
    const standingBefore = await db.select().from(schema.freeGameQueue);
    const response = await app.request("/api/free-queue/draw", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(201);
    const body = await response.json() as {
      gameId: string;
      rated: boolean;
      seasonId: string | null;
      playersDrawn: number;
    };
    expect(body).toMatchObject({
      rated: true,
      seasonId: season.id,
      playersDrawn: 2,
    });

    const game = (await db.select().from(schema.games).where(eq(schema.games.id, body.gameId)))[0];
    const seats = await db.select().from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, body.gameId));
    expect(game?.seasonId).toBe(season.id);
    const statusResponse = await app.request("/api/free-queue", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const status = await statusResponse.json() as {
      todayGame: Record<string, unknown> | null;
    };
    expect(status.todayGame).toMatchObject({
      id: body.gameId,
      slug: game?.slug,
      season: { id: season.id, slug: "daily-summer", name: "Daily Summer" },
    });
    expect(status.todayGame).not.toHaveProperty("gameNumber");
    for (const item of queued) {
      const seat = seats.find((candidate) => candidate.agentProfileId === item.profileId);
      expect(seat?.userId).toBe(item.userId);
      expect(seat?.agentRevisionId).toBeTruthy();
    }
    const standingEntries = await db.select().from(schema.freeGameQueue);
    expect(standingEntries).toEqual(standingBefore);
    expect(standingEntries.every((entry) => entry.consecutiveMisses === 0)).toBe(true);
    expect(await db.select().from(schema.competitionRatingSnapshots)).toEqual([]);
  });

  test("starts an already-drawn Daily Free game after its season begins closing", async () => {
    const db = await setupTestDB();
    const operatorId = await insertUser(db, "closing-operator");
    await createQueuedAgent(db, "closing-a", "Aster Closing");
    await createQueuedAgent(db, "closing-b", "Maris Closing");
    const season = await createSeason(db, {
      slug: "daily-closing",
      name: "Daily Closing",
      createdById: operatorId,
    });
    const token = await createSessionToken(operatorId, {
      roles: ["scheduler"],
      permissions: ["schedule_free_game"],
    });
    const app = new Hono().route("/", createFreeQueueRoutes(db));
    const draw = await app.request("/api/free-queue/draw", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const drawn = await draw.json() as { gameId: string };
    await db.update(schema.seasons).set({ status: "closing" })
      .where(eq(schema.seasons.id, season.id));

    const started = await app.request("/api/free-queue/start", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(started.status).toBe(200);
    expect(await started.json()).toMatchObject({ started: true, gameId: drawn.gameId });
    const seats = await db.select().from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, drawn.gameId));
    const snapshots = await db.select().from(schema.competitionRatingSnapshots)
      .where(eq(schema.competitionRatingSnapshots.gameId, drawn.gameId));
    expect(snapshots).toHaveLength(2);
    expect(snapshots.every((snapshot) => seats.some((seat) => (
      seat.agentProfileId === snapshot.agentProfileId
        && seat.agentRevisionId === snapshot.agentRevisionId
    )))).toBe(true);
    await abortAllGames();
  });

  test("draw remains available but explicitly unrated without an active season", async () => {
    const db = await setupTestDB();
    const operatorId = await insertUser(db, "operator-unrated");
    await createQueuedAgent(db, "carol", "Vera Daily");
    await createQueuedAgent(db, "dan", "Echo Daily");
    const token = await createSessionToken(operatorId, {
      roles: ["scheduler"],
      permissions: ["schedule_free_game"],
    });
    const app = new Hono().route("/", createFreeQueueRoutes(db));

    const response = await app.request("/api/free-queue/draw", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(201);
    const body = await response.json() as { gameId: string; rated: boolean; seasonId: string | null };
    expect(body).toMatchObject({ rated: false, seasonId: null });
    const seats = await db.select().from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, body.gameId));
    expect(seats.filter((seat) => seat.agentProfileId).every((seat) => seat.agentRevisionId !== null)).toBe(true);
  });

  test("concurrent draw requests create only one Daily Free game", async () => {
    const db = await setupTestDB();
    const operatorId = await insertUser(db, "operator-race");
    await createQueuedAgent(db, "race-alice", "Nova Daily");
    await createQueuedAgent(db, "race-bob", "Orion Daily");
    const token = await createSessionToken(operatorId, {
      roles: ["scheduler"],
      permissions: ["schedule_free_game"],
    });
    const app = new Hono().route("/", createFreeQueueRoutes(db));
    const request = () => app.request("/api/free-queue/draw", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const bodies = await Promise.all(responses.map((response) => response.json())) as Array<{
      drawn: boolean;
      gameId: string;
    }>;
    expect(bodies.filter((body) => body.drawn)).toHaveLength(1);
    expect(new Set(bodies.map((body) => body.gameId))).toEqual(new Set([bodies[0]!.gameId]));
    expect(await db.select().from(schema.games)).toHaveLength(1);
  });

  test("keeps all standing entries and increments only the eligible owner who misses", async () => {
    const db = await setupTestDB();
    const operatorId = await insertUser(db, "operator-misses");
    await createSeason(db, { slug: "miss-season", name: "Miss Season", createdById: operatorId });
    for (let index = 0; index < 13; index += 1) {
      await createQueuedAgent(db, `owner-${index}`, `Agent ${index}`);
    }
    const token = await createSessionToken(operatorId, {
      roles: ["scheduler"],
      permissions: ["schedule_free_game"],
    });
    const app = new Hono().route("/", createFreeQueueRoutes(db));

    const response = await app.request("/api/free-queue/draw", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(201);
    const entries = await db.select().from(schema.freeGameQueue);
    expect(entries).toHaveLength(13);
    expect(entries.filter((entry) => entry.consecutiveMisses === 1)).toHaveLength(1);
    expect(entries.filter((entry) => entry.consecutiveMisses === 0)).toHaveLength(12);
  });

  test("draw excludes nonterminal owners and admits terminal owners without charging misses", async () => {
    const db = await setupTestDB();
    const operatorId = await insertUser(db, "operator-eligibility");
    await createSeason(db, { slug: "eligibility-season", name: "Eligibility Season" });
    const waiting = await createQueuedAgent(db, "waiting-owner", "Waiting Agent");
    const active = await createQueuedAgent(db, "active-owner", "Active Agent");
    const suspended = await createQueuedAgent(db, "suspended-owner", "Suspended Agent");
    const completed = await createQueuedAgent(db, "completed-owner", "Completed Agent");
    const cancelled = await createQueuedAgent(db, "cancelled-owner", "Cancelled Agent");
    const eligibleA = await createQueuedAgent(db, "eligible-a", "Eligible A");
    const eligibleB = await createQueuedAgent(db, "eligible-b", "Eligible B");
    await assignOwnerToFreeGame(db, waiting, "waiting");
    await assignOwnerToFreeGame(db, active, "in_progress");
    await assignOwnerToFreeGame(db, suspended, "suspended");
    await assignOwnerToFreeGame(db, completed, "completed");
    await assignOwnerToFreeGame(db, cancelled, "cancelled");
    const token = await createSessionToken(operatorId, {
      roles: ["scheduler"],
      permissions: ["schedule_free_game"],
    });
    const app = new Hono().route("/", createFreeQueueRoutes(db));

    const response = await app.request("/api/free-queue/draw", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(201);
    const body = await response.json() as { gameId: string };
    const seats = await db.select().from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, body.gameId));
    const seatedAgentIds = new Set(seats.flatMap((seat) => seat.agentProfileId ? [seat.agentProfileId] : []));
    expect(seatedAgentIds).toEqual(new Set([
      completed.profileId,
      cancelled.profileId,
      eligibleA.profileId,
      eligibleB.profileId,
    ]));
    const entries = await db.select().from(schema.freeGameQueue);
    expect(entries).toHaveLength(7);
    expect(entries.every((entry) => entry.consecutiveMisses === 0)).toBe(true);
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

async function createQueuedAgent(
  db: DrizzleDB,
  ownerLabel: string,
  agentName: string,
): Promise<{ userId: string; profileId: string }> {
  const userId = await insertUser(db, ownerLabel);
  const profile = (await createOwnedAgentProfile(db, { userId }, {
    name: agentName,
    personality: `${agentName} personality`,
  })).profile;
  await db.insert(schema.freeGameQueue).values({
    id: randomUUID(),
    userId,
    agentProfileId: profile.id,
  });
  return { userId, profileId: profile.id };
}

async function assignOwnerToFreeGame(
  db: DrizzleDB,
  owner: { userId: string; profileId: string },
  status: "waiting" | "in_progress" | "suspended" | "completed" | "cancelled",
): Promise<void> {
  const gameId = randomUUID();
  await db.insert(schema.games).values({
    id: gameId,
    slug: `eligibility-${status}-${gameId.slice(0, 6)}`,
    config: "{}",
    status,
    trackType: "free",
    minPlayers: 2,
    maxPlayers: 12,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  await db.insert(schema.gamePlayers).values({
    id: randomUUID(),
    gameId,
    userId: owner.userId,
    agentProfileId: owner.profileId,
    persona: JSON.stringify({ name: status, personality: status }),
    agentConfig: "{}",
  });
}
