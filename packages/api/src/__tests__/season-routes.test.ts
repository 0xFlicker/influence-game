import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { schema, type DrizzleDB } from "../db/index.js";
import { createSessionToken } from "../middleware/auth.js";
import { createSeasonRoutes } from "../routes/seasons.js";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";
import { closeSeason, createSeason } from "../services/seasons.js";
import { setupTestDB } from "./test-utils.js";

beforeAll(() => {
  process.env.JWT_SECRET = "season-routes-test-secret";
});

describe("season routes", () => {
  test("serves public standings and receipts without producer evidence", async () => {
    const fixture = await seedRouteFixture();
    const app = new Hono().route("/", createSeasonRoutes(fixture.db));

    const dashboardResponse = await app.request(`/api/seasons/${fixture.seasonSlug}`);
    expect(dashboardResponse.status).toBe(200);
    const dashboard = await dashboardResponse.json() as {
      agentStandings: Array<{ agentName: string; totalPoints: number }>;
    };
    expect(dashboard.agentStandings[0]).toMatchObject({ agentName: "Atlas", totalPoints: 100 });
    expect(JSON.stringify(dashboard)).not.toContain("sigma");
    expect(JSON.stringify(dashboard)).not.toContain("opponentRatings");

    const receiptResponse = await app.request(
      `/api/seasons/${fixture.seasonSlug}/games/${fixture.gameId}/receipts`,
    );
    expect(receiptResponse.status).toBe(200);
    const receipt = await receiptResponse.json() as {
      receipts: Array<{ basePoints: number; fieldBonus: number; totalPoints: number }>;
    };
    expect(receipt.receipts[0]).toMatchObject({ basePoints: 100, fieldBonus: 0, totalPoints: 100 });
    expect(JSON.stringify(receipt)).not.toContain("pregameRating");
  });

  test("authorizes owned analysis and exports by authenticated owner", async () => {
    const fixture = await seedRouteFixture();
    const app = new Hono().route("/", createSeasonRoutes(fixture.db));
    const ownerToken = await token(fixture.ownerId, ["agents:read"]);
    const otherToken = await token(fixture.otherUserId, ["agents:read"]);

    const allowed = await app.request(
      `/api/seasons/${fixture.seasonSlug}/agents/${fixture.profileId}`,
      { headers: { Authorization: `Bearer ${ownerToken}` } },
    );
    const denied = await app.request(
      `/api/seasons/${fixture.seasonSlug}/agents/${fixture.profileId}`,
      { headers: { Authorization: `Bearer ${otherToken}` } },
    );
    expect(allowed.status).toBe(200);
    expect(denied.status).toBe(404);

    const exportResponse = await app.request(
      `/api/seasons/${fixture.seasonSlug}/export?format=csv`,
      { headers: { Authorization: `Bearer ${ownerToken}` } },
    );
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("content-disposition")).toContain("agent-data.csv");
    expect(await exportResponse.text()).toContain("Atlas");
  });

  test("requires producer authorization for hidden diagnostics", async () => {
    const fixture = await seedRouteFixture();
    const app = new Hono().route("/", createSeasonRoutes(fixture.db));
    const ownerToken = await token(fixture.ownerId, ["agents:read"]);
    const producerToken = await token(fixture.ownerId, ["view_admin"]);

    const denied = await app.request(
      `/api/admin/seasons/${fixture.seasonSlug}/diagnostics`,
      { headers: { Authorization: `Bearer ${ownerToken}` } },
    );
    const allowed = await app.request(
      `/api/admin/seasons/${fixture.seasonSlug}/diagnostics`,
      { headers: { Authorization: `Bearer ${producerToken}` } },
    );
    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(200);
    expect(JSON.stringify(await allowed.json())).toContain("sigma");
  });

  test("separates season observation from lifecycle management and creates an active season", async () => {
    const db = await setupTestDB();
    const userId = await insertUser(db, "operator");
    const app = new Hono().route("/", createSeasonRoutes(db));
    const observerToken = await token(userId, ["view_admin"]);
    const managerToken = await token(userId, ["manage_seasons"]);
    const body = JSON.stringify({ slug: "permission-season", name: "Permission Season" });

    const denied = await app.request("/api/admin/seasons", {
      method: "POST",
      headers: { Authorization: `Bearer ${observerToken}`, "Content-Type": "application/json" },
      body,
    });
    const created = await app.request("/api/admin/seasons", {
      method: "POST",
      headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
      body,
    });
    expect(denied.status).toBe(403);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ season: { status: "active" } });

    const removedActivation = await app.request("/api/admin/seasons/unused/activate", {
      method: "POST",
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(removedActivation.status).toBe(404);

    const duplicate = await app.request("/api/admin/seasons", {
      method: "POST",
      headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "second-season", name: "Second Season" }),
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: "invalid_state" });
  });

  test("returns a stable conflict when a closed season already uses the slug", async () => {
    const db = await setupTestDB();
    const userId = await insertUser(db, "operator");
    const existing = await createSeason(db, { slug: "reused-slug", name: "Original" });
    await closeSeason(db, existing.id);
    const app = new Hono().route("/", createSeasonRoutes(db));
    const managerToken = await token(userId, ["manage_seasons"]);

    const response = await app.request("/api/admin/seasons", {
      method: "POST",
      headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "reused-slug", name: "Replacement" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "season_slug_conflict" });
  });
});

async function seedRouteFixture() {
  const db = await setupTestDB();
  const ownerId = await insertUser(db, "owner");
  const otherUserId = await insertUser(db, "other");
  const profile = (await createOwnedAgentProfile(db, { userId: ownerId }, {
    name: "Atlas",
    personality: "Steady",
  })).profile;
  const revision = (await db.select().from(schema.agentRevisions))[0]!;
  const season = await createSeason(db, {
    slug: `routes-${randomUUID()}`,
    name: "Routes Season",
    createdById: ownerId,
  });
  const gameId = randomUUID();
  await db.insert(schema.games).values({
    id: gameId,
    slug: `route-game-${gameId}`,
    config: "{}",
    status: "completed",
    trackType: "free",
    seasonId: season.id,
    minPlayers: 2,
    maxPlayers: 4,
  });
  const receiptId = randomUUID();
  await db.insert(schema.competitionReceipts).values({
    id: receiptId,
    seasonId: season.id,
    gameId,
    ownerId,
    agentProfileId: profile.id,
    agentRevisionId: revision.id,
    ownerDisplayNameSnapshot: "owner",
    agentNameSnapshot: "Atlas",
    eligibilityStatus: "eligible",
    lobbySize: 4,
    placement: 1,
    basePoints: 100,
    fieldBonus: 0,
    totalPoints: 100,
    accountRatingDelta: 16,
    scoringPolicyVersion: "season-scoring-v1",
    earnedAt: "2026-07-10T00:00:00.000Z",
  });
  await db.insert(schema.competitionReceiptEvidence).values({
    receiptId,
    ratingPolicyVersion: "competition-rating-v1",
    pregameRating: { mu: 25, sigma: 25 / 3 },
    postgameRating: { mu: 26, sigma: 8 },
    opponentRatings: [{ mu: 25, sigma: 25 / 3 }],
    fieldStrengthEvidence: { bonusRate: 0 },
  });
  await db.insert(schema.competitionRatingEvents).values({
    id: randomUUID(),
    idempotencyKey: `route:${profile.id}`,
    agentProfileId: profile.id,
    agentRevisionId: revision.id,
    seasonId: season.id,
    gameId,
    eventType: "game_result",
    beforeMu: 25,
    beforeSigma: 25 / 3,
    afterMu: 26,
    afterSigma: 8,
    ratingPolicyVersion: "competition-rating-v1",
    revisionPolicyVersion: "agent-revision-v1",
    evidence: {},
  });
  await db.insert(schema.agentCompetitionRatings).values({
    agentProfileId: profile.id,
    effectiveRevisionId: revision.id,
    mu: 26,
    sigma: 8,
    gamesPlayed: 1,
    ratingPolicyVersion: "competition-rating-v1",
  });
  return { db, ownerId, otherUserId, profileId: profile.id, seasonSlug: season.slug, gameId };
}

async function insertUser(db: DrizzleDB, label: string): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.users).values({ id, displayName: label, email: `${id}@example.test` });
  return id;
}

function token(userId: string, permissions: string[]) {
  return createSessionToken(userId, { roles: ["test"], permissions });
}
