import { expect, test } from "bun:test";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import OAuth from "oauth-1.0a";
import { schema } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import {
  conversionDeliveryEnvFromProcess, deliverPendingConversions, recordConversion,
  retainBrowserUserAgent, recordAuthenticationTracking, retainUserAttribution, syncAnalyticsPreference,
  type ConversionDeliveryEnv, type ConversionFetch,
} from "../services/campaign-conversions.js";

const env: ConversionDeliveryEnv = {
  posthogProjectToken: "test-posthog", metaPixelId: "test-meta", metaAccessToken: "test-meta-token",
  googleClientId: "test-client", googleClientSecret: "test-secret", googleRefreshToken: "test-refresh",
  googleCustomerId: "1234567890", googleLoginCustomerId: "9876543210",
  googleConversionActions: { signup_completed: "101", agent_ready: "102", season_entry: "103" },
  tiktokPixelId: "test-tiktok", tiktokAccessToken: "test-tiktok-token",
  xPixelId: "test-x", xConsumerKey: "test-key", xConsumerSecret: "test-secret",
  xAccessToken: "test-token", xAccessTokenSecret: "test-token-secret",
  xEventIds: { signup_completed: "signup-id", agent_ready: "agent-id", season_entry: "season-id" },
};
const oauthUrl = "https://oauth2.googleapis.com/token";
const success: ConversionFetch = async (url) => {
  if (url === oauthUrl) return Response.json({ access_token: "test-access", expires_in: 3600 });
  if (url.includes("events:ingest")) return Response.json({ requestId: "google-request-1" });
  if (url.includes("tiktok")) return Response.json({ code: 0 });
  if (url.includes("ads-api.x.com")) return Response.json({ data: { conversions_processed: 1 } });
  return Response.json({});
};

async function fixture(clickIdParam = "gclid", allowed = true, explicit = true) {
  const db = await setupTestDB();
  const [user] = await db.insert(schema.users).values({ id: randomUUID(), displayName: "Ad delivery fixture" }).returning();
  await db.transaction(tx => syncAnalyticsPreference(tx, user!.id, allowed, false, undefined, explicit, allowed, explicit));
  await db.transaction(tx => retainBrowserUserAgent(tx, user!.id, "Mozilla/5.0 TestBrowser/1.0"));
  await retainUserAttribution(db, { userId: user!.id, channel: "web",
    firstTouch: { source: "test", campaign: "season1", clickIdParam, clickId: "click-123" } });
  const id = `signup:${user!.id}`;
  await recordConversion(db, { id, userId: user!.id, publicId: user!.publicId, eventName: "signup_completed",
    channel: "web", occurredAt: "2026-11-08T12:00:00.000Z" });
  const row = async () => (await db.select().from(schema.campaignConversionEvents).where(eq(schema.campaignConversionEvents.id, id)))[0]!;
  const due = () => db.update(schema.campaignConversionEvents).set({ googleNextPollAt: "2020-01-01T00:00:00Z" })
    .where(eq(schema.campaignConversionEvents.id, id));
  return { db, user: user!, id, row, due };
}

function diagnostics(destination: unknown, requestStatus: string): Response {
  return Response.json({ requestStatusPerDestination: [{ destination, requestStatus }] });
}

test("Google snapshots affirmative consent, maps all funnel actions and supported click identifiers", async () => {
  const { db, user, id } = await fixture();
  const bodies: unknown[] = [];
  let refreshes = 0;
  const fetchFn: ConversionFetch = async (url, init) => {
    if (url === oauthUrl) {
      refreshes++;
      const params = new URLSearchParams(String(init?.body));
      expect(params.get("grant_type")).toBe("refresh_token");
      expect(params.get("refresh_token")).toBe("test-refresh");
    }
    if (url.includes("events:ingest")) {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-access");
      bodies.push(JSON.parse(String(init?.body)));
    }
    return success(url, init);
  };
  const cases = [["agent_ready", "gbraid"], ["season_entry", "wbraid"]] as const;
  for (const [eventName, click] of cases) {
    // Each event freezes its own acquisition snapshot, including retained identifiers.
    await db.update(schema.userCampaignAttribution).set({ firstTouch: { [click]: "click-123" } })
      .where(eq(schema.userCampaignAttribution.userId, user.id));
    await recordConversion(db, { id: `${eventName}:${user.id}`, userId: user.id, publicId: user.publicId,
      eventName, channel: "mcp" });
  }
  const summary = await deliverPendingConversions(db, env, fetchFn);
  expect(refreshes).toBe(1);
  expect(summary.googleDelivered).toBe(0); // HTTP acceptance is not processing success.
  expect(summary.tiktokDelivered).toBe(3);
  expect(bodies).toHaveLength(3);
  expect(bodies).toContainEqual({ destinations: [{ operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" },
    loginAccount: { accountType: "GOOGLE_ADS", accountId: "9876543210" }, productDestinationId: "101" }],
    events: [{ transactionId: id, eventTimestamp: "2026-11-08T12:00:00.000Z", eventSource: "WEB", adIdentifiers: { gclid: "click-123" },
      consent: { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_DENIED" } }] });
  for (const [index, [event, click]] of cases.entries()) {
    expect(bodies).toContainEqual(expect.objectContaining({ destinations: [expect.objectContaining({ productDestinationId: String(102 + index) })],
      events: [expect.objectContaining({ transactionId: `${event}:${user.id}`, eventSource: "OTHER", adIdentifiers: { [click]: "click-123" } })] }));
  }
});

test("regional permission is not misreported as affirmative Google consent; later consent never rewrites an event", async () => {
  const { db, user, row } = await fixture("gclid", true, false);
  const [preference] = await db.select().from(schema.userAnalyticsPreferences).where(eq(schema.userAnalyticsPreferences.userId, user.id));
  await db.transaction(tx => syncAnalyticsPreference(tx, user.id, true, true, preference!.updatedAt, true, true, true));
  expect((await row()).googleAdUserDataGranted).toBe(false);
  await deliverPendingConversions(db, env, async (url, init) => {
    if (url.includes("events:ingest")) expect(JSON.parse(String(init?.body))).toMatchObject({ events: [{
      consent: { adUserData: "CONSENT_STATUS_UNSPECIFIED", adPersonalization: "CONSENT_DENIED" },
    }] });
    return success(url, init);
  });
});

test("auth captures explicit browser choice without reviving previously denied permission", async () => {
  const db = await setupTestDB();
  const [user] = await db.insert(schema.users).values({ id: randomUUID() }).returning();
  await recordAuthenticationTracking(db, { userId: user!.id, publicId: user!.publicId, created: true,
    analytics: true, analyticsExplicit: true, advertising: true, advertisingExplicit: true, attribution: { clickIdParam: "gclid", clickId: "auth-click" } });
  const [event] = await db.select().from(schema.campaignConversionEvents);
  expect(event?.googleAdUserDataGranted).toBe(true);
  await db.transaction(tx => syncAnalyticsPreference(tx, user!.id, false));
  await recordAuthenticationTracking(db, { userId: user!.id, publicId: user!.publicId, created: false, analytics: true, analyticsExplicit: true });
  const [preference] = await db.select().from(schema.userAnalyticsPreferences);
  expect(preference).toMatchObject({ analytics: false, analyticsExplicit: false });
});

test("Google diagnostics failures and PROCESSING never resend the accepted upload; successful destinations stay delivered", async () => {
  const { db, row, due } = await fixture();
  await deliverPendingConversions(db, env, success);
  expect(await row()).toMatchObject({ googleStatus: "processing", googleAttempts: 1, googleRequestId: "google-request-1" });
  expect((await deliverPendingConversions(db, env, async () => { throw new Error("Unexpected early poll"); })).claimed).toBe(0);
  await due();
  const requests: string[] = [];
  await deliverPendingConversions(db, env, async (url, init) => {
    requests.push(url);
    return url.includes("requestStatus") ? new Response("unavailable", { status: 503 }) : success(url, init);
  });
  expect(await row()).toMatchObject({ googleStatus: "processing", googleAttempts: 1, googlePollCount: 1, googleRequestId: "google-request-1" });
  expect(requests.filter(url => url !== oauthUrl)).toEqual([expect.stringContaining("requestStatus:retrieve?requestId=google-request-1")]);
  await due();
  const destination = (await row()).googleDestination;
  await deliverPendingConversions(db, env, async (url, init) => url.includes("requestStatus") ? diagnostics(destination, "PROCESSING") : success(url, init));
  expect(await row()).toMatchObject({ googleStatus: "processing", googleAttempts: 1, googlePollCount: 2 });
  await due();
  const summary = await deliverPendingConversions(db, env, async (url, init) => url.includes("requestStatus") ? diagnostics(destination, "SUCCESS") : success(url, init));
  expect(summary.googleDelivered).toBe(1);
  expect(summary.posthogDelivered).toBe(0);
  expect(await row()).toMatchObject({ googleStatus: "delivered", googleAttempts: 1, googlePollCount: 3, deliveredAt: expect.any(String) });
});

test("Google all-record failure retries the same destination and identity after configuration changes", async () => {
  const { db, row, due, id } = await fixture();
  await deliverPendingConversions(db, env, success);
  await due();
  const destination = (await row()).googleDestination;
  await deliverPendingConversions(db, env, async (url, init) => url.includes("requestStatus") ? diagnostics(destination, "FAILED") : success(url, init));
  expect((await row()).googleStatus).toBe("failed");
  await deliverPendingConversions(db, { ...env, googleCustomerId: "1111111111", googleConversionActions: { signup_completed: "999" } }, async (url, init) => {
    if (url.includes("events:ingest")) expect(JSON.parse(String(init?.body))).toMatchObject({ destinations: [destination], events: [{ transactionId: id }] });
    return success(url, init);
  });
  expect(await row()).toMatchObject({ googleStatus: "processing", googleAttempts: 2, googlePollCount: 0 });
});

test("Google partial success and exhausted diagnostics require inspection without blind reupload", async () => {
  const { db, row, due, id } = await fixture();
  await deliverPendingConversions(db, env, success);
  await due();
  const destination = (await row()).googleDestination;
  await deliverPendingConversions(db, env, async (url, init) => url.includes("requestStatus") ? diagnostics(destination, "PARTIAL_SUCCESS") : success(url, init));
  expect((await row()).googleStatus).toBe("review_required");
  expect((await deliverPendingConversions(db, env, success)).claimed).toBe(0);
  await db.update(schema.campaignConversionEvents).set({ googleStatus: "processing", googlePollCount: 24 }).where(eq(schema.campaignConversionEvents.id, id));
  await due();
  await deliverPendingConversions(db, env, async (url, init) => url.includes("requestStatus") ? diagnostics(destination, "PROCESSING") : success(url, init));
  expect(await row()).toMatchObject({ googleStatus: "review_required", googleAttempts: 1, googlePollCount: 25 });
});

test("Google missing config consumes no budget and malformed acceptance exhausts only its upload budget", async () => {
  const { db, row } = await fixture();
  await deliverPendingConversions(db, { ...env, posthogProjectToken: undefined, metaAccessToken: undefined,
    googleRefreshToken: undefined, tiktokAccessToken: undefined, xAccessToken: undefined },
    async () => { throw new Error("No credentials"); });
  expect(await row()).toMatchObject({ googleDestination: null, tiktokPixelId: null, xPixelId: null, xEventId: null });
  expect(await row()).toMatchObject({ googleStatus: "unconfigured", googleAttempts: 0, tiktokStatus: "unconfigured", tiktokAttempts: 0 });
  expect((await deliverPendingConversions(db, {}, success)).claimed).toBe(0);
  let meta = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    await deliverPendingConversions(db, env, async (url, init) => {
      if (url.includes("facebook")) meta++;
      if (url.includes("events:ingest")) return Response.json({});
      return success(url, init);
    });
  }
  expect(meta).toBe(1);
  expect(await row()).toMatchObject({ googleStatus: "failed", googleAttempts: 5, tiktokStatus: "delivered", tiktokAttempts: 1 });
});

test("Google authorization failure does not block TikTok, Meta or PostHog", async () => {
  const { db, row } = await fixture();
  const summary = await deliverPendingConversions(db, env, async (url, init) => url === oauthUrl ? Response.json({ error: "invalid_grant" }, { status: 400 }) : success(url, init));
  expect(summary).toMatchObject({ posthogDelivered: 1, platformDelivered: 1, tiktokDelivered: 1, googleDelivered: 0 });
  expect(await row()).toMatchObject({ googleStatus: "failed", googleAttempts: 1, googleLastError: "Google upload failed" });
});

test("TikTok validates HTTP-200 errors and retries identical funnel events without resending Meta", async () => {
  const { db, user, id, row } = await fixture("ttclid");
  let meta = 0;
  const tiktokBodies: string[] = [];
  let reject = true;
  const fetchFn: ConversionFetch = async (url, init) => {
    if (url.includes("facebook")) meta++;
    if (url.includes("tiktok")) {
      tiktokBodies.push(String(init?.body));
      expect(new Headers(init?.headers).get("Access-Token")).toBe("test-tiktok-token");
      return Response.json({ code: reject ? 40002 : 0, message: "not persisted" });
    }
    return success(url, init);
  };
  await deliverPendingConversions(db, env, fetchFn);
  expect(await row()).toMatchObject({ tiktokStatus: "failed", tiktokAttempts: 1, googleStatus: "not_applicable" });
  reject = false;
  await deliverPendingConversions(db, { ...env, tiktokPixelId: "replacement" }, fetchFn);
  expect(meta).toBe(1);
  expect(tiktokBodies[0]).toBe(tiktokBodies[1]);
  expect(JSON.parse(tiktokBodies[0]!)).toEqual({ event_source: "web", event_source_id: "test-tiktok", data: [{
    event: "CompleteRegistration", event_id: id, event_time: 1794139200,
    user: { external_id: createHash("sha256").update(user.publicId).digest("hex"), ttclid: "click-123" },
    page: { url: "https://thehouse.game" },
  }] });
  expect(await row()).toMatchObject({ tiktokStatus: "delivered", tiktokAttempts: 2 });
});

test("X uses signed JSON requests, twclid and stable conversion IDs; rejects unsuccessful acknowledgements", async () => {
  const { db, id, row } = await fixture("twclid");
  let reject = true;
  const bodies: string[] = [];
  const fetchFn: ConversionFetch = async (url, init) => {
    if (url.includes("ads-api.x.com")) {
      bodies.push(String(init?.body));
      expect(url).toBe("https://ads-api.x.com/12/measurement/conversions/test-x");
      const header = new Headers(init?.headers).get("Authorization")!;
      const fields = Object.fromEntries(header.replace(/^OAuth /, "").split(", ").map(part => {
        const [name, value] = part.split("="); return [name!, decodeURIComponent(value!.slice(1, -1))];
      }));
      const oauth = new OAuth({ consumer: { key: "test-key", secret: "test-secret" }, signature_method: "HMAC-SHA1",
        hash_function: (base, key) => createHmac("sha1", key).update(base).digest("base64") });
      oauth.getNonce = () => fields.oauth_nonce!;
      oauth.getTimeStamp = () => Number(fields.oauth_timestamp);
      expect(header).toBe(oauth.toHeader(oauth.authorize({ url, method: "POST" }, { key: "test-token", secret: "test-token-secret" })).Authorization);
      return Response.json({ data: { conversions_processed: reject ? 0 : 1 } });
    }
    return success(url, init);
  };
  await deliverPendingConversions(db, env, fetchFn);
  expect(await row()).toMatchObject({ xStatus: "failed", xAttempts: 1 });
  reject = false;
  await deliverPendingConversions(db, { ...env, xPixelId: "different", xEventIds: { signup_completed: "different" } }, fetchFn);
  expect(bodies[0]).toBe(bodies[1]);
  expect(JSON.parse(bodies[0]!)).toEqual({ conversions: [{ event_id: "signup-id", conversion_id: id,
    conversion_time: "2026-11-08T12:00:00.000Z", identifiers: [{ twclid: "click-123" }] }] });
  expect(await row()).toMatchObject({ xStatus: "delivered", xAttempts: 2 });
});

test("denied events stay suppressed across re-enable for all new destinations", async () => {
  const { db, user, id, row } = await fixture("gclid", false);
  expect(await row()).toMatchObject({ googleStatus: "suppressed", tiktokStatus: "suppressed", xStatus: "suppressed" });
  const [preference] = await db.select().from(schema.userAnalyticsPreferences);
  await db.transaction(tx => syncAnalyticsPreference(tx, user.id, true, true, preference!.updatedAt, true, true, true));
  expect((await deliverPendingConversions(db, env, async () => { throw new Error("Must not send"); })).claimed).toBe(0);
  expect(await recordConversion(db, { id, userId: user.id, publicId: user.publicId, eventName: "signup_completed", channel: "mcp" })).toBe(false);
  expect((await row()).googleStatus).toBe("suppressed");
});

test("withdrawal suppresses Google polling and failed TikTok and X delivery without backfill", async () => {
  const { db, user, row, due, id } = await fixture();
  await deliverPendingConversions(db, env, async (url, init) => url.includes("tiktok") ? Response.json({ code: 1 }) : success(url, init));
  await db.update(schema.campaignConversionEvents).set({ xStatus: "failed", xAttempts: 1 }).where(eq(schema.campaignConversionEvents.id, id));
  await db.transaction(tx => syncAnalyticsPreference(tx, user.id, false));
  await due();
  expect((await deliverPendingConversions(db, env, async () => { throw new Error("Withdrawn"); })).claimed).toBe(0);
  expect(await row()).toMatchObject({ googleStatus: "suppressed", tiktokStatus: "suppressed", xStatus: "suppressed", attribution: null });
  const [preference] = await db.select().from(schema.userAnalyticsPreferences);
  await db.transaction(tx => syncAnalyticsPreference(tx, user.id, true, true, preference!.updatedAt, true, true, true));
  expect((await deliverPendingConversions(db, env, success)).claimed).toBe(0);
});

test("concurrent workers send each new destination only once", async () => {
  const { db, row } = await fixture();
  const requests: string[] = [];
  const fetchFn: ConversionFetch = async (url, init) => { requests.push(url); return success(url, init); };
  await Promise.all([deliverPendingConversions(db, env, fetchFn), deliverPendingConversions(db, env, fetchFn)]);
  expect(requests.filter(url => url.includes("events:ingest"))).toHaveLength(1);
  expect(requests.filter(url => url.includes("tiktok"))).toHaveLength(1);
  expect(await row()).toMatchObject({ googleAttempts: 1, tiktokAttempts: 1 });
});

test("new destination defaults suppress pre-integration records and configuration maps all funnel steps", async () => {
  const { db, user } = await fixture();
  const [legacy] = await db.insert(schema.campaignConversionEvents).values({ id: "legacy-event", eventName: "agent_ready",
    userId: user.id, publicId: user.publicId, channel: "api" }).returning();
  expect(legacy).toMatchObject({ googleStatus: "suppressed", tiktokStatus: "suppressed", xStatus: "suppressed" });
  const configured = conversionDeliveryEnvFromProcess({ GOOGLE_ADS_CUSTOMER_ID: "1234567890", GOOGLE_ADS_SIGNUP_ACTION_ID: "1",
    GOOGLE_ADS_AGENT_READY_ACTION_ID: "2", GOOGLE_ADS_SEASON_ENTRY_ACTION_ID: "3", TIKTOK_PIXEL_ID: "tik",
    X_ADS_SIGNUP_EVENT_ID: "a", X_ADS_AGENT_READY_EVENT_ID: "b", X_ADS_SEASON_ENTRY_EVENT_ID: "c" });
  expect(configured).toMatchObject({ googleCustomerId: "1234567890", tiktokPixelId: "tik",
    googleConversionActions: { signup_completed: "1", agent_ready: "2", season_entry: "3" },
    xEventIds: { signup_completed: "a", agent_ready: "b", season_entry: "c" } });
  // Confirm database-level defaults, not only service defaults.
  const defaults = await db.execute(sql`SELECT column_default FROM information_schema.columns WHERE table_name = 'campaign_conversion_events' AND column_name IN ('google_status', 'tiktok_status', 'x_status')`);
  expect(defaults).toHaveLength(3);
  for (const value of defaults) expect(value.column_default).toContain("suppressed");
});

test("TikTok and X map MCP readiness and enrollment without treating either as a purchase", async () => {
  const { db, user } = await fixture("twclid");
  for (const eventName of ["agent_ready", "season_entry", "owner_returned"] as const) {
    await recordConversion(db, { id: `${eventName}:${user.id}`, userId: user.id, publicId: user.publicId, eventName, channel: "mcp" });
  }
  const tiktok: unknown[] = [];
  const x: unknown[] = [];
  await deliverPendingConversions(db, env, async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (url.includes("tiktok")) tiktok.push(body);
    if (url.includes("ads-api.x.com")) x.push(body);
    return success(url, init);
  });
  expect(tiktok).toHaveLength(3);
  expect(x).toHaveLength(3);
  for (const [event, id] of [["AgentReady", "agent-id"], ["SeasonEntry", "season-id"]]) {
    expect(tiktok).toContainEqual(expect.objectContaining({ data: [expect.objectContaining({ event })] }));
    expect(x).toContainEqual(expect.objectContaining({ conversions: [expect.objectContaining({ event_id: id })] }));
  }
  expect(JSON.stringify([...tiktok, ...x])).not.toMatch(/Purchase|currency|value|mcpClientId/);
});

test("TikTok and X missing credentials spend no attempts; malformed acknowledgements stop at five", async () => {
  const { db, row } = await fixture("twclid");
  await deliverPendingConversions(db, {}, success);
  expect(await row()).toMatchObject({ xStatus: "unconfigured", xAttempts: 0, tiktokStatus: "unconfigured", tiktokAttempts: 0 });
  const calls: string[] = [];
  for (let i = 0; i < 6; i++) {
    await deliverPendingConversions(db, env, async (url, init) => {
      if (url.includes("tiktok") || url.includes("ads-api.x.com")) {
        calls.push(url);
        return new Response("not-json");
      }
      return success(url, init);
    });
  }
  expect(calls.filter(url => url.includes("tiktok"))).toHaveLength(5);
  expect(calls.filter(url => url.includes("ads-api.x.com"))).toHaveLength(5);
  expect(await row()).toMatchObject({ xStatus: "failed", xAttempts: 5, tiktokStatus: "failed", tiktokAttempts: 5 });
});

test("Google rejects mismatched diagnostic destinations and keeps accepted requests while credentials are absent", async () => {
  const { db, row, due } = await fixture();
  await deliverPendingConversions(db, env, success);
  await due();
  expect((await deliverPendingConversions(db, {}, async () => { throw new Error("No credentials"); })).claimed).toBe(0);
  const destination = (await row()).googleDestination!;
  await deliverPendingConversions(db, env, async (url, init) => url.includes("requestStatus")
    ? diagnostics({ ...destination, productDestinationId: "wrong" }, "SUCCESS") : success(url, init));
  expect(await row()).toMatchObject({ googleStatus: "processing", googleRequestId: "google-request-1", googleAttempts: 1,
    googleLastError: "Google status check failed; accepted request retained" });
});

test("adding affirmative metadata to an allowed account preserves the attribution sync version", async () => {
  const { db, user } = await fixture("gclid", true, false);
  const [before] = await db.select().from(schema.userAnalyticsPreferences);
  await db.transaction(tx => syncAnalyticsPreference(tx, user.id, true, false, before!.updatedAt, true, true, true));
  const [after] = await db.select().from(schema.userAnalyticsPreferences);
  expect(after).toMatchObject({ analytics: true, analyticsExplicit: true, updatedAt: before!.updatedAt });
  await db.transaction(tx => syncAnalyticsPreference(tx, user.id, false, true));
  const [denied] = await db.select().from(schema.userAnalyticsPreferences);
  expect(denied!.updatedAt).not.toBe(before!.updatedAt);
  await db.transaction(tx => syncAnalyticsPreference(tx, user.id, true, true, before!.updatedAt, true, true, true));
  expect((await db.select().from(schema.userAnalyticsPreferences))[0]).toMatchObject({ analytics: false, analyticsExplicit: false });
});


test("migration preserves existing delivery history while suppressing every new destination", async () => {
  const db = await setupTestDB();
  const migration = readFileSync(new URL("../../drizzle/0169_ad_platform_conversions.sql", import.meta.url), "utf8");
  await db.transaction(async tx => {
    // Temporary tables shadow the real names on this transaction's connection.
    await tx.execute(sql`CREATE TEMP TABLE user_analytics_preferences (user_id text, analytics boolean) ON COMMIT DROP`);
    await tx.execute(sql`CREATE TEMP TABLE campaign_conversion_events (id text, posthog_status text, platform_status text) ON COMMIT DROP`);
    await tx.execute(sql`INSERT INTO user_analytics_preferences VALUES ('existing', true)`);
    await tx.execute(sql`INSERT INTO campaign_conversion_events VALUES ('existing', 'delivered', 'failed')`);
    for (const statement of migration.split("--> statement-breakpoint")) await tx.execute(sql.raw(statement));
    const [event] = await tx.execute(sql`SELECT * FROM campaign_conversion_events`);
    expect(event).toMatchObject({ id: "existing", posthog_status: "delivered", platform_status: "failed",
      google_status: "suppressed", tiktok_status: "suppressed", x_status: "suppressed",
      google_attempts: 0, tiktok_attempts: 0, x_attempts: 0, google_ad_user_data_granted: false });
    const [preference] = await tx.execute(sql`SELECT * FROM user_analytics_preferences`);
    expect(preference).toMatchObject({ user_id: "existing", analytics: true, analytics_explicit: false });
  });
});

test("purpose migration preserves legacy rejection and never converts PostHog acceptance to ad consent", async () => {
  const db = await setupTestDB();
  const migration = readFileSync(new URL("../../drizzle/0173_tracking_purposes.sql", import.meta.url), "utf8");
  await db.transaction(async tx => {
    await tx.execute(sql`CREATE TEMP TABLE user_analytics_preferences (user_id text, analytics boolean, web_user_agent text) ON COMMIT DROP`);
    await tx.execute(sql`CREATE TEMP TABLE campaign_conversion_events (id text, posthog_status text, platform_status text, google_status text, tiktok_status text, x_status text, client_user_agent text, google_ad_user_data_granted boolean, google_next_poll_at text) ON COMMIT DROP`);
    await tx.execute(sql`INSERT INTO user_analytics_preferences VALUES ('accepted', true, 'browser'), ('rejected', false, NULL)`);
    await tx.execute(sql`INSERT INTO campaign_conversion_events VALUES ('pending', 'pending', 'pending', 'processing', 'failed', 'unconfigured', 'browser', true, 'later'), ('delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'browser', true, NULL)`);
    for (const statement of migration.split("--> statement-breakpoint")) await tx.execute(sql.raw(statement));
    const preferences = await tx.execute(sql`SELECT * FROM user_analytics_preferences ORDER BY user_id`);
    expect(preferences[0]).toMatchObject({ analytics: true, advertising: null, advertising_explicit: false, web_user_agent: null });
    expect(preferences[1]).toMatchObject({ analytics: false, advertising: false, advertising_explicit: false });
    const events = await tx.execute(sql`SELECT * FROM campaign_conversion_events ORDER BY id`);
    expect(events[0]).toMatchObject({ posthog_status: "delivered", platform_status: "delivered", google_status: "delivered" });
    expect(events[1]).toMatchObject({ posthog_status: "pending", platform_status: "suppressed", google_status: "suppressed", tiktok_status: "suppressed", x_status: "suppressed", client_user_agent: null, google_ad_user_data_granted: false, google_next_poll_at: null });
  });
});
