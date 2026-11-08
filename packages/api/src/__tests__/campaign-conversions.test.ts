import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { setupTestDB, acceptTestAgent } from "./test-utils.js";
import { grantTestAuthority } from "./rbac-fixtures.js";
import { createSessionToken } from "../middleware/auth.js";
import { createAgentProfileRoutes } from "../routes/agent-profiles.js";
import { createFreeQueueRoutes } from "../routes/free-queue.js";
import { createSeason } from "../services/seasons.js";
import { contentImageFixture, headPositionFixture } from "./content-image-fixture.js";
import {
  deliverPendingConversions,
  getCampaignReport,
  recordSeasonEntry,
  recordSignupCompleted,
  retainUserAttribution,
  validateCampaignTouch,
} from "../services/campaign-conversions.js";

test("validation keeps campaign attribution and drops secrets or arbitrary fields", () => {
  expect(validateCampaignTouch({
    source: "meta",
    campaign: "season1",
    creative: "video-a",
    audience: "strategy-fans",
    clickId: "fb.123",
    clickIdParam: "fbclid",
    landingVariant: "hero-b",
    token: "secret-token",
    prompt: "private prompt text",
    email: "person@example.com",
  })).toEqual({
    utm_source: "meta",
    utm_campaign: "season1",
    utm_content: "video-a",
    utm_term: "strategy-fans",
    landing_variant: "hero-b",
    fbclid: "fb.123",
  });
  expect(validateCampaignTouch({ source: "bad source!" })).toBeNull();
  expect(validateCampaignTouch(null)).toBeNull();
});

test("tagged journey records deduplicated server conversions and reports by creative", async () => {
  const db = await setupTestDB();
  process.env.JWT_SECRET = "disposable-campaign-test";
  const userId = randomUUID();
  await db.insert(schema.users).values({ id: userId, displayName: "Campaign fixture" });
  await grantTestAuthority(db, userId, ["join_game"], "player");
  const token = await createSessionToken(userId);
  const app = new Hono();
  app.route("/", createAgentProfileRoutes(db));
  app.route("/", createFreeQueueRoutes(db));
  const post = (url: string, body: unknown) => app.request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  // Signup conversion is recorded once even if the auth path retries.
  const touch = { source: "meta", medium: "cpc", campaign: "season1", creative: "video-a", clickId: "fb.123", clickIdParam: "fbclid" };
  expect(await recordSignupCompleted(db, { userId, channel: "web", attribution: touch })).toBe(true);
  expect(await recordSignupCompleted(db, { userId, channel: "web", attribution: touch })).toBe(false);

  // A later direct visit must not replace first acquisition or last non-direct.
  await retainUserAttribution(db, { userId, channel: "web", firstTouch: null, lastTouch: null });
  const [attribution] = await db.select().from(schema.userCampaignAttribution)
    .where(eq(schema.userCampaignAttribution.userId, userId));
  expect(attribution?.firstTouch?.utm_campaign).toBe("season1");
  expect(attribution?.lastTouch?.fbclid).toBe("fb.123");

  const season = await createSeason(db, { slug: "campaign-entry", name: "Campaign entry" });
  const fullBodyReferenceUrl = await contentImageFixture("pfp/campaign-newcomer.png");
  const body = {
    creationRequestId: randomUUID(), name: "Campaign Newcomer", gender: "non-binary",
    personality: "Patient", personaKey: "strategic",
    fullBodyReferenceUrl, headPosition: await headPositionFixture(fullBodyReferenceUrl),
  };
  const created = await post("/api/agent-profiles", body);
  expect(created.status).toBe(201);
  const agent = await created.json() as { id: string };
  const duplicate = await post("/api/agent-profiles", body);
  expect(duplicate.status).toBe(201);

  await acceptTestAgent(db, agent.id);
  const entry = { agentProfileId: agent.id, expectedSeasonId: season.id };
  expect((await post("/api/free-queue/join", entry)).status).toBe(201);
  expect((await post("/api/free-queue/join", entry)).status).toBe(200);

  const events = await db.select().from(schema.campaignConversionEvents)
    .where(eq(schema.campaignConversionEvents.userId, userId));
  const byName = (name: string) => events.filter((event) => event.eventName === name);
  expect(byName("signup_completed")).toHaveLength(1);
  expect(byName("agent_created")).toHaveLength(1);
  expect(byName("agent_ready").length).toBeGreaterThanOrEqual(1);
  expect(byName("season_entry")).toHaveLength(1);
  expect(byName("season_entry")[0]?.attribution?.utm_content).toBe("video-a");
  // Enrollment is not placement.
  expect(byName("game_placed")).toHaveLength(0);

  const report = await getCampaignReport(db, { spendByCampaign: { season1: 100 } });
  const row = report.find((candidate) => candidate.campaign === "season1");
  expect(row?.newAccounts).toBe(1);
  expect(row?.readyAgents).toBe(1);
  expect(row?.uniqueSeasonEntrants).toBe(1);
  expect(row?.costPerSignup).toBe(100);
  expect(row?.costPerSeasonEntrant).toBe(100);
});

test("MCP channel conversions keep client identity and delivery deduplicates by event id", async () => {
  const db = await setupTestDB();
  const userId = randomUUID();
  await db.insert(schema.users).values({ id: userId, displayName: "MCP fixture" });
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  const season = await createSeason(db, { slug: "campaign-mcp", name: "Campaign MCP" });
  await db.insert(schema.agentProfiles).values({
    id: randomUUID(), userId, name: "MCP Agent", personality: "Calm",
  });
  const [agent] = await db.select().from(schema.agentProfiles)
    .where(eq(schema.agentProfiles.userId, userId));

  expect(await recordSeasonEntry(db, {
    userId, agentProfileId: agent!.id, seasonId: season.id, channel: "mcp", mcpClientId: "client-1",
  })).toBe(true);
  expect(await recordSeasonEntry(db, {
    userId, agentProfileId: agent!.id, seasonId: season.id, channel: "mcp", mcpClientId: "client-1",
  })).toBe(false);

  const calls: Array<{ url: string; body: string }> = [];
  const fetchFn = (async (url: string, init?: { body?: string }) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const summary = await deliverPendingConversions(db, {
    posthogProjectToken: "test-token",
    posthogHost: "https://posthog.example",
    // No Meta credentials: platform delivery must stay unconfigured, never
    // be reported as delivered.
  }, fetchFn);
  expect(summary.posthogDelivered).toBeGreaterThanOrEqual(1);
  expect(summary.platformDelivered).toBe(0);
  const seasonCall = calls.find((call) => call.body.includes("season_entry"));
  expect(seasonCall?.body).toContain(`season_entry:${userId}:${season.id}`);
  expect(seasonCall?.body).toContain('"channel":"mcp"');
  expect(user?.publicId).toBeTruthy();

  const [row] = await db.select().from(schema.campaignConversionEvents)
    .where(eq(schema.campaignConversionEvents.eventName, "season_entry"));
  expect(row?.posthogStatus).toBe("delivered");
  expect(row?.platformStatus).toBe("unconfigured");
});
