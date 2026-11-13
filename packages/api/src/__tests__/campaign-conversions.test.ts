import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
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
  syncAnalyticsPreference,
  recordConversion,
  reconcileSignupConversions,
  retainBrowserUserAgent, recordAuthenticationTracking,
  type ConversionFetch,
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

  await db.transaction(tx => syncAnalyticsPreference(tx, userId, true, false, undefined, false, true));

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
  await db.transaction(tx => syncAnalyticsPreference(tx, userId, true, false, undefined, false, true));
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

async function conversionFixture(allowed = true) {
  const db = await setupTestDB();
  const [user] = await db.insert(schema.users).values({ id: randomUUID(), displayName: "Conversion regression" }).returning();
  await db.transaction(tx => syncAnalyticsPreference(tx, user!.id, allowed, false, undefined, false, allowed));
  await db.transaction(tx => retainBrowserUserAgent(tx, user!.id, "Mozilla/5.0 TestBrowser/1.0"));
  return { db, user: user! };
}
const deliveryEnv = { posthogProjectToken: "test", posthogHost: "https://posthog.example", metaPixelId: "pixel", metaAccessToken: "test" };

test("each destination retries independently and missing configuration consumes no budget", async () => {
  const { db, user } = await conversionFixture();
  await recordSignupCompleted(db, { userId: user.id, channel: "web" });
  const calls: string[] = [];
  let metaFails = true;
  const fetchFn: ConversionFetch = async url => {
    calls.push(String(url));
    return new Response("{}", { status: String(url).includes("facebook") && metaFails ? 503 : 200 });
  };
  await deliverPendingConversions(db, {}, fetchFn);
  let [event] = await db.select().from(schema.campaignConversionEvents);
  expect(event).toMatchObject({ posthogAttempts: 0, platformAttempts: 0, posthogStatus: "unconfigured", platformStatus: "unconfigured" });
  expect(calls).toHaveLength(0);
  await deliverPendingConversions(db, deliveryEnv, fetchFn);
  metaFails = false;
  await deliverPendingConversions(db, deliveryEnv, fetchFn);
  expect(calls.filter(url => url.includes("posthog"))).toHaveLength(1);
  expect(calls.filter(url => url.includes("facebook"))).toHaveLength(2);
  [event] = await db.select().from(schema.campaignConversionEvents);
  expect(event).toMatchObject({ posthogStatus: "delivered", platformStatus: "delivered", posthogAttempts: 1, platformAttempts: 2 });
  await deliverPendingConversions(db, deliveryEnv, fetchFn);
  expect(calls).toHaveLength(3);
});

test("PostHog retries independently after Meta succeeds and keeps a stable UUID", async () => {
  const { db, user } = await conversionFixture();
  await recordSignupCompleted(db, { userId: user.id, channel: "web" });
  const ids: unknown[] = [];
  let posthogFails = true;
  let metaCalls = 0;
  const fetchFn: ConversionFetch = async (url, init) => {
    if (String(url).includes("facebook")) { metaCalls++; return new Response("{}"); }
    ids.push(JSON.parse(String(init?.body)).uuid);
    return new Response("{}", { status: posthogFails ? 503 : 200 });
  };
  await deliverPendingConversions(db, deliveryEnv, fetchFn);
  posthogFails = false;
  await deliverPendingConversions(db, deliveryEnv, fetchFn);
  expect(metaCalls).toBe(1);
  expect(ids).toHaveLength(2);
  expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(ids[1]).toBe(ids[0]);
});

test("withdrawal suppresses pending events, strips attribution, and never backfills after re-enable", async () => {
  const { db, user } = await conversionFixture();
  await recordSignupCompleted(db, { userId: user.id, channel: "web", attribution: { campaign: "season1" } });
  await db.transaction(tx => syncAnalyticsPreference(tx, user.id, false));
  expect(await db.select().from(schema.userCampaignAttribution)).toHaveLength(0);
  const [signup] = await db.select().from(schema.campaignConversionEvents);
  expect(signup).toMatchObject({ attribution: null, posthogStatus: "suppressed", platformStatus: "suppressed" });
  // A stale tab's automatic enable cannot undo account withdrawal.
  expect(await db.transaction(tx => syncAnalyticsPreference(tx, user.id, true))).toBe(false);
  await recordConversion(db, { id: "declined-mcp", eventName: "agent_created", userId: user.id, publicId: user.publicId, channel: "mcp" });
  const [deniedPreference] = await db.select().from(schema.userAnalyticsPreferences).where(eq(schema.userAnalyticsPreferences.userId, user.id));
  await db.transaction(tx => syncAnalyticsPreference(tx, user.id, true, true, deniedPreference!.updatedAt, false, true));
  await recordConversion(db, { id: "allowed-mcp", eventName: "agent_created", userId: user.id, publicId: user.publicId, channel: "mcp" });
  const sent: string[] = [];
  await deliverPendingConversions(db, deliveryEnv, async (_url, init) => { sent.push(String(init?.body)); return new Response("{}"); });
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain("allowed-mcp");
  expect(sent[0]).not.toContain("season1");
  const report = await getCampaignReport(db);
  expect(report.find(row => row.level === "campaign")?.newAccounts).toBe(1);
});

test("unknown preference still records business outcomes but cannot retain attribution or deliver", async () => {
  const db = await setupTestDB();
  const [user] = await db.insert(schema.users).values({ id: randomUUID() }).returning();
  await recordAuthenticationTracking(db, { userId: user!.id, publicId: user!.publicId, created: true, userAgent: "Mozilla/5.0 UnknownConsent", attribution: { campaign: "declined" } });
  expect(await db.select().from(schema.userAnalyticsPreferences)).toHaveLength(0);
  expect(await db.select().from(schema.userCampaignAttribution)).toHaveLength(0);
  const [event] = await db.select().from(schema.campaignConversionEvents);
  expect(event).toMatchObject({ attribution: null, clientUserAgent: null, posthogStatus: "suppressed", platformStatus: "suppressed" });
  const result = await deliverPendingConversions(db, deliveryEnv, async () => { throw new Error("Must not send"); });
  expect(result.claimed).toBe(0);
  expect(await db.transaction(tx => syncAnalyticsPreference(tx, user!.id, true))).toBe(true);
  expect((await deliverPendingConversions(db, deliveryEnv, async () => { throw new Error("No backfill"); })).claimed).toBe(0);
});

test("campaign costs use campaign totals and creative rows never duplicate spend", async () => {
  const { db } = await conversionFixture();
  for (const [creative, count] of [["drama", 6], ["strategist", 2]] as const) {
    for (let i = 0; i < count; i++) {
      const [user] = await db.insert(schema.users).values({ id: randomUUID() }).returning();
      await db.transaction(tx => syncAnalyticsPreference(tx, user!.id, true));
      await recordSignupCompleted(db, { userId: user!.id, channel: "web", attribution: { campaign: "season1", creative } });
    }
  }
  const report = await getCampaignReport(db, { spendByCampaign: { season1: 100 } });
  expect(report.find(row => row.level === "campaign")).toMatchObject({ newAccounts: 8, spend: 100, costPerSignup: 12.5 });
  const creatives = report.filter(row => row.level === "creative");
  expect(creatives.map(row => row.newAccounts).sort()).toEqual([2, 6]);
  for (const row of creatives) expect(row).toMatchObject({ spend: null, costPerSignup: null, costPerReadyAgent: null, costPerSeasonEntrant: null });
});

test("signup issues a session despite conversion write failure, then recovers an internal-only total", async () => {
  const db = await setupTestDB();
  const { createAuthRoutes } = await import("../routes/auth.js");
  const { verifySessionToken } = await import("../middleware/auth.js");
  process.env.JWT_SECRET = "campaign-auth-regression";
  const app = new Hono().route("/", createAuthRoutes(db, {
    verifyPrivyToken: async () => "did:privy:tracking-failure",
    getPrivyUser: async () => ({ id: "did:privy:tracking-failure", createdAt: new Date(), isGuest: false, customMetadata: {},
      linkedAccounts: [{ type: "email", address: "tracking-failure@example.com", verifiedAt: new Date(), firstVerifiedAt: new Date(), latestVerifiedAt: new Date() }] }),
    isInviteRequired: async () => false,
  }));
  await db.execute(sql`CREATE FUNCTION campaign_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test conversion failure'; END $$`);
  await db.execute(sql`CREATE TRIGGER campaign_test_fail BEFORE INSERT ON campaign_conversion_events FOR EACH ROW EXECUTE FUNCTION campaign_test_fail()`);
  try {
    const response = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "test", intent: "create_account", acceptTerms: true,
        termsVersion: "2026-11-12", privacyVersion: "2026-11-12", deploymentSha: "0123456789abcdef0123456789abcdef01234567",
        analytics: true, attribution: { campaign: "season1" } }) });
    expect(response.status).toBe(200);
    const body = await response.json() as { token: string };
    expect(await verifySessionToken(body.token)).not.toBeNull();
    expect(await db.select().from(schema.users)).toHaveLength(1);
    expect(await db.select().from(schema.campaignConversionEvents)).toHaveLength(0);
  } finally {
    await db.execute(sql`DROP TRIGGER campaign_test_fail ON campaign_conversion_events`);
    await db.execute(sql`DROP FUNCTION campaign_test_fail()`);
  }
  // Let the auth path finish before reconciliation considers a committed account.
  await db.update(schema.users).set({ createdAt: new Date(Date.now() - 120_000).toISOString() });
  await reconcileSignupConversions(db);
  await reconcileSignupConversions(db);
  const events = await db.select().from(schema.campaignConversionEvents);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ eventName: "signup_completed", attribution: null, posthogStatus: "suppressed", platformStatus: "suppressed" });
});

test("authenticated preference endpoint persists rejection and lets GPC override explicit acceptance", async () => {
  const { db, user } = await conversionFixture();
  await recordSignupCompleted(db, { userId: user.id, channel: "web" });
  const { createCampaignAttributionRoutes } = await import("../routes/campaign-attribution.js");
  const app = new Hono().route("/", createCampaignAttributionRoutes(db));
  process.env.JWT_SECRET = "campaign-preference-regression";
  const token = await createSessionToken(user.id);
  const post = (body: unknown, extraHeaders: Record<string, string> = {}) => app.request("/api/attribution/retain", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", "User-Agent": "Mozilla/5.0 RouteBrowser/1.0", ...extraHeaders }, body: JSON.stringify(body),
  });
  expect((await post({ firstTouch: { campaign: "missing-choice" } })).status).toBe(400);
  const rejected = await post({ advertising: false, analytics: false, firstTouch: { campaign: "not-permitted" } });
  const denial = await rejected.json() as { analytics: boolean; version: string };
  expect(denial.analytics).toBe(false);
  expect(await db.select().from(schema.userCampaignAttribution)).toHaveLength(0);
  expect(await (await post({ advertising: true, analytics: true })).json()).toMatchObject({ analytics: false, advertising: false });
  const enabledResponse = await post({ advertising: true, analytics: true, analyticsExplicit: true, explicitChoice: true, expectedVersion: denial.version });
  const enabled = await enabledResponse.json() as { analytics: boolean; version: string };
  expect(enabled.analytics).toBe(true);
  expect((await db.select().from(schema.userAnalyticsPreferences))[0]?.analyticsExplicit).toBe(true);
  await post({ advertising: true, analytics: true, expectedVersion: denial.version, firstTouch: { campaign: "stale" } });
  expect(await db.select().from(schema.userCampaignAttribution)).toHaveLength(0);
  expect((await db.select().from(schema.userAnalyticsPreferences))[0]?.webUserAgent).toBeNull();
  await post({ advertising: true, analytics: true, expectedVersion: enabled.version, firstTouch: { campaign: "current" } });
  const [retained] = await db.select().from(schema.userCampaignAttribution);
  expect(retained?.firstTouch?.utm_campaign).toBe("current");
  expect((await db.select().from(schema.userAnalyticsPreferences))[0]?.webUserAgent).toBe("Mozilla/5.0 RouteBrowser/1.0");
  expect(await (await post({ advertising: true, analytics: true, analyticsExplicit: true, explicitChoice: true }, { "Sec-GPC": "1" })).json()).toMatchObject({ analytics: false, advertising: false });
  expect(await (await post({ advertising: true, analytics: true, analyticsExplicit: true, explicitChoice: true }, { DNT: "1" })).json()).toMatchObject({ analytics: false, advertising: false });
  expect((await db.select().from(schema.userAnalyticsPreferences))[0]?.analyticsExplicit).toBe(false);
  expect((await db.select().from(schema.userAnalyticsPreferences))[0]?.webUserAgent).toBeNull();
  const [suppressed] = await db.select().from(schema.campaignConversionEvents);
  expect(suppressed).toMatchObject({ googleStatus: "suppressed", tiktokStatus: "suppressed", xStatus: "suppressed" });
});

test("concurrent delivery workers serialize the account and do not resend a committed success", async () => {
  const { db, user } = await conversionFixture();
  await recordSignupCompleted(db, { userId: user.id, channel: "web" });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  let posthogCalls = 0;
  let metaCalls = 0;
  const fetchFn: ConversionFetch = async url => {
    if (url.includes("posthog")) { posthogCalls++; started(); await gate; }
    else metaCalls++;
    return new Response("{}");
  };
  const first = deliverPendingConversions(db, deliveryEnv, fetchFn);
  await entered;
  const second = deliverPendingConversions(db, deliveryEnv, fetchFn);
  release();
  await Promise.all([first, second]);
  expect(posthogCalls).toBe(1);
  expect(metaCalls).toBe(1);
});


test("an enable request arriving after a newer withdrawal cannot restore tracking", async () => {
  const { db, user } = await conversionFixture(false);
  const [initialDenial] = await db.select().from(schema.userAnalyticsPreferences);
  const oldVersion = initialDenial!.updatedAt;
  expect(await db.transaction(tx => syncAnalyticsPreference(tx, user.id, true, true, oldVersion))).toBe(true);
  await db.transaction(tx => syncAnalyticsPreference(tx, user.id, false));
  // Simulate a retry of the earlier enable after its HTTP response timed out.
  expect(await db.transaction(tx => syncAnalyticsPreference(tx, user.id, true, true, oldVersion))).toBe(false);
  expect(await db.transaction(tx => syncAnalyticsPreference(tx, user.id, true, true))).toBe(false);
  const [current] = await db.select().from(schema.userAnalyticsPreferences);
  await db.transaction(tx => syncAnalyticsPreference(tx, user.id, false, true));
  expect(await db.transaction(tx => syncAnalyticsPreference(tx, user.id, true, true, current!.updatedAt))).toBe(false);
});


test("Meta web user agent is consented, frozen across retries, and removed on withdrawal", async () => {
  const { db, user } = await conversionFixture();
  await recordAuthenticationTracking(db, { userId: user.id, publicId: user.publicId, created: true,
    analytics: true, advertising: true, userAgent: "Mozilla/5.0 SignupBrowser/1.0" });
  await db.transaction(tx => retainBrowserUserAgent(tx, user.id, "Mozilla/5.0 LaterBrowser/2.0"));
  const calls: { url: string; body: string }[] = [];
  const fetchFn: ConversionFetch = async (url, init) => {
    calls.push({ url, body: String(init?.body) });
    return Response.json({}, { status: url.includes("graph.facebook") ? 500 : 200 });
  };
  await deliverPendingConversions(db, deliveryEnv, fetchFn);
  await deliverPendingConversions(db, deliveryEnv, fetchFn);
  const meta = calls.filter(call => call.url.includes("graph.facebook"));
  expect(meta).toHaveLength(2);
  for (const call of meta) expect(JSON.parse(call.body).data[0].user_data.client_user_agent).toBe("Mozilla/5.0 SignupBrowser/1.0");
  expect(calls.find(call => call.url.includes("posthog"))?.body).not.toContain("SignupBrowser");
  await db.transaction(tx => syncAnalyticsPreference(tx, user.id, false));
  expect((await db.select().from(schema.userAnalyticsPreferences))[0]?.webUserAgent).toBeNull();
  expect((await db.select().from(schema.campaignConversionEvents))[0]).toMatchObject({ clientUserAgent: null, platformStatus: "suppressed" });
  const before = calls.length;
  await deliverPendingConversions(db, deliveryEnv, fetchFn);
  expect(calls).toHaveLength(before);
});

test("missing browser metadata suppresses Meta only; API events never inherit a browser user agent", async () => {
  const { db, user } = await conversionFixture();
  await db.transaction(tx => retainBrowserUserAgent(tx, user.id, "bad\nheader"));
  await recordSignupCompleted(db, { userId: user.id, channel: "web" });
  await db.transaction(tx => retainBrowserUserAgent(tx, user.id, "Mozilla/5.0 LaterBrowser/2.0"));
  await recordConversion(db, { id: "api-ready", eventName: "agent_ready", userId: user.id, publicId: user.publicId, channel: "api" });
  const meta: Record<string, unknown>[] = [];
  await deliverPendingConversions(db, deliveryEnv, async (url, init) => {
    if (url.includes("graph.facebook")) meta.push(JSON.parse(String(init?.body)).data[0]);
    return Response.json({});
  });
  expect(meta).toHaveLength(1);
  expect(meta[0]).toMatchObject({ action_source: "system_generated" });
  expect(meta[0]?.user_data).not.toHaveProperty("client_user_agent");
  const [web] = await db.select().from(schema.campaignConversionEvents).where(eq(schema.campaignConversionEvents.id, `signup:${user.id}`));
  expect(web).toMatchObject({ clientUserAgent: null, platformStatus: "suppressed", platformAttempts: 0, posthogStatus: "delivered" });
});


test("browser metadata rejects oversized values and cannot be retained after denial", async () => {
  const { db, user } = await conversionFixture();
  for (const invalid of [undefined, "", "x".repeat(1025), "bad\rheader", "bad\u007fheader"]) {
    await db.transaction(tx => retainBrowserUserAgent(tx, user.id, invalid));
    expect((await db.select().from(schema.userAnalyticsPreferences))[0]?.webUserAgent).toBeNull();
  }
  await db.transaction(tx => syncAnalyticsPreference(tx, user.id, false));
  await recordAuthenticationTracking(db, { userId: user.id, publicId: user.publicId, created: true,
    analytics: true, advertising: true, userAgent: "Mozilla/5.0 StaleConsent" });
  expect((await db.select().from(schema.userAnalyticsPreferences))[0]).toMatchObject({ analytics: false, webUserAgent: null });
  expect((await db.select().from(schema.campaignConversionEvents))[0]).toMatchObject({ clientUserAgent: null, platformStatus: "suppressed" });
});

for (const analytics of [false, true]) for (const advertising of [false, true]) {
  test(`independent delivery and withdrawal: analytics=${analytics}, advertising=${advertising}`, async () => {
    const db = await setupTestDB();
    const [user] = await db.insert(schema.users).values({ id: randomUUID() }).returning();
    await db.transaction(tx => syncAnalyticsPreference(tx, user!.id, analytics, false, undefined, analytics, advertising, advertising));
    await retainUserAttribution(db, { userId: user!.id, channel: "web", firstTouch: { campaign: "independent", clickId: "click", clickIdParam: "fbclid" } });
    await retainBrowserUserAgent(db, user!.id, "TestBrowser");
    const input = { id: `signup:${user!.id}`, userId: user!.id, publicId: user!.publicId, eventName: "signup_completed" as const, channel: "mcp" as const };
    expect(await recordConversion(db, input)).toBe(true);
    expect(await recordConversion(db, input)).toBe(false);
    let [event] = await db.select().from(schema.campaignConversionEvents).where(eq(schema.campaignConversionEvents.id, input.id));
    expect(event!.posthogStatus).toBe(analytics ? "pending" : "suppressed");
    for (const status of [event!.platformStatus, event!.googleStatus, event!.tiktokStatus, event!.xStatus]) expect(status).toBe(advertising ? "pending" : "suppressed");
    expect(event!.googleAdUserDataGranted).toBe(advertising);
    expect(event!.attribution?.utm_campaign ?? null).toBe(analytics || advertising ? "independent" : null);
    const calls: string[] = [];
    const send: ConversionFetch = async url => { calls.push(String(url)); return new Response("{}"); };
    await deliverPendingConversions(db, deliveryEnv, send);
    expect(calls.some(url => url.includes("posthog"))).toBe(analytics);
    expect(calls.some(url => url.includes("facebook"))).toBe(advertising);
    const sent = calls.length;
    await deliverPendingConversions(db, deliveryEnv, send);
    expect(calls).toHaveLength(sent);
    await recordConversion(db, { ...input, id: `queued:${user!.id}` });
    await db.transaction(tx => syncAnalyticsPreference(tx, user!.id, analytics, false, undefined, false, false));
    [event] = await db.select().from(schema.campaignConversionEvents).where(eq(schema.campaignConversionEvents.id, `queued:${user!.id}`));
    expect(event!.posthogStatus).toBe(analytics ? "pending" : "suppressed");
    for (const status of [event!.platformStatus, event!.googleStatus, event!.tiktokStatus, event!.xStatus]) expect(status).toBe("suppressed");
    expect(event!.clientUserAgent).toBeNull();
    await db.transaction(tx => syncAnalyticsPreference(tx, user!.id, false));
    [event] = await db.select().from(schema.campaignConversionEvents).where(eq(schema.campaignConversionEvents.id, `queued:${user!.id}`));
    expect(event!.posthogStatus).toBe("suppressed");
    expect(event!.attribution).toBeNull();
    expect(await db.select().from(schema.userCampaignAttribution)).toHaveLength(0);
  });
}

test("analytics withdrawal preserves queued advertising and its matching identifiers", async () => {
  const { db, user } = await conversionFixture();
  await retainUserAttribution(db, { userId: user.id, channel: "web", firstTouch: { campaign: "ads-only", clickId: "matching", clickIdParam: "fbclid" } });
  await recordSignupCompleted(db, { userId: user.id, channel: "web" });
  await db.transaction(tx => syncAnalyticsPreference(tx, user.id, false, false, undefined, false, true));
  const [event] = await db.select().from(schema.campaignConversionEvents);
  expect(event).toMatchObject({ posthogStatus: "suppressed", platformStatus: "pending", googleStatus: "pending", tiktokStatus: "pending", xStatus: "pending" });
  expect(event!.attribution?.fbclid).toBe("matching");
  expect(event!.clientUserAgent).toBe("Mozilla/5.0 TestBrowser/1.0");
  const calls: string[] = [];
  await deliverPendingConversions(db, deliveryEnv, async url => { calls.push(String(url)); return new Response("{}"); });
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain("facebook");
});
