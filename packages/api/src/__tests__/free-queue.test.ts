import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { createSessionToken } from "../middleware/auth.js";
import { createFreeQueueRoutes } from "../routes/free-queue.js";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";
import { createSeason } from "../services/seasons.js";
import { setupTestDB } from "./test-utils.js";

beforeAll(() => {
  process.env.JWT_SECRET = "free-queue-season-test-secret";
});

describe("free queue season admission", () => {
  test("draw atomically binds an active season and every owned revision", async () => {
    const db = await setupTestDB();
    const operatorId = await insertUser(db, "operator");
    const queued = await Promise.all([
      createQueuedAgent(db, "alice", "Atlas"),
      createQueuedAgent(db, "bob", "Mira"),
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
    for (const item of queued) {
      const seat = seats.find((candidate) => candidate.agentProfileId === item.profileId);
      expect(seat?.userId).toBe(item.userId);
      expect(seat?.agentRevisionId).toBeTruthy();
    }
    expect(await db.select().from(schema.freeGameQueue)).toHaveLength(0);
  });

  test("draw remains available but explicitly unrated without an active season", async () => {
    const db = await setupTestDB();
    const operatorId = await insertUser(db, "operator-unrated");
    await createQueuedAgent(db, "carol", "Vera");
    await createQueuedAgent(db, "dan", "Echo");
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
    expect(seats.filter((seat) => seat.agentProfileId).every((seat) => seat.agentRevisionId === null)).toBe(true);
  });

  test("concurrent draw requests create only one Daily Free game", async () => {
    const db = await setupTestDB();
    const operatorId = await insertUser(db, "operator-race");
    await createQueuedAgent(db, "race-alice", "Nova");
    await createQueuedAgent(db, "race-bob", "Orion");
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
