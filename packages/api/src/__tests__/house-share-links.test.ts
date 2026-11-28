import { beforeEach, expect, test } from "bun:test";
import { eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { createSessionToken } from "../middleware/auth.js";
import { createHouseShareRoutes } from "../routes/house-share-links.js";
import { createCampaignAttributionRoutes } from "../routes/campaign-attribution.js";
import { deliverPendingConversions, recordAuthenticationTracking, recordConversion, syncAnalyticsPreference } from "../services/campaign-conversions.js";
import { deleteAccount } from "../services/account-deletion.js";
import { admitShareCreation, saveShareLink } from "../services/house-share-links.js";
import { parseHouseShareTarget } from "@influence/engine/house-share-target";
import { setupTestDB } from "./test-utils.js";
import { schema, type DrizzleDB } from "../db/index.js";
import { grantTestAuthority } from "./rbac-fixtures.js";
let db: DrizzleDB;
beforeEach(async () => {
  db = await setupTestDB(); process.env.JWT_SECRET = "short-share-tests";
  await db.insert(schema.games).values({id: "share-game", slug: "red-fox", gameKind: "werewolf", status: "completed", config: JSON.stringify({visibility: "unlisted"})});
});
const post = (app: ReturnType<typeof createHouseShareRoutes>, path: string, headers = {}) => app.request("/api/share-links", {method: "POST", headers: {"Content-Type": "application/json", ...headers}, body: JSON.stringify({path})});

test("anonymous creation deduplicates immutable replay coordinates across instances", async () => {
  const target = parseHouseShareTarget("/games/red-fox/replay?audience=omniscient&cursor=3&cue=id%3A3&t=1.25&speed=2&thinking=1&muted=0&volume=0.6");
  const links = await Promise.all(Array.from({length: 12}, () => saveShareLink(db, target)));
  expect(new Set(links.map(link => link.code)).size).toBe(1);
  expect(links[0]!.code).toMatch(/^[1-9A-HJ-NP-Za-km-z]{10}$/);
  const app = createHouseShareRoutes(db), response = await post(app, target.path);
  expect(response.status).toBe(200);
  const created = await response.json() as {code:string;path:string}; expect(created.path).toBe(`/s/${links[0]!.code}`);
  const resolved = await app.request(`/api/share-links/${links[0]!.code}?t=99&redirect=https://evil.test`);
  expect(((await resolved.json()) as {path:string}).path).toBe(target.path);
  expect((await db.select().from(schema.houseShareLinks))).toHaveLength(1);
});

test("live moment codes keep their exact replay destination after completion", async () => {
  const app = createHouseShareRoutes(db);
  await db.update(schema.games).set({ status: "in_progress" }).where(eq(schema.games.id, "share-game"));
  await db.insert(schema.games).values({
    id: "share-influence", slug: "blue-fox", gameKind: "influence", status: "in_progress",
    config: JSON.stringify({ visibility: "public" }),
  });
  const paths = [
    "/games/blue-fox/replay/16?cue=format%3A16&muted=1&speed=2&t=1.25&thinking=1&volume=0.6",
    "/games/blue-fox/replay/16",
    "/games/blue-fox/replay?cue=opening%3Atitle&t=0.5",
    "/games/red-fox/replay?audience=mystery&cursor=12",
    "/games/red-fox/replay?audience=omniscient&cue=share-game%3Aomniscient%3A12&cursor=12&t=3.25",
    "/games/red-fox/replay?audience=mystery&cue=share-game%3Aopening%3Atitle%3A&t=0.5",
  ];
  const links = [];
  for (const path of paths) {
    const response = await post(app, path);
    expect(response.status).toBe(200);
    const { code } = await response.json() as { code: string };
    const resolver = `/api/share-links/${code}`;
    expect(await (await app.request(resolver)).json()).toEqual({ code, path });
    links.push({ code, path, resolver });
  }

  await db.update(schema.games).set({ status: "completed" })
    .where(inArray(schema.games.id, ["share-game", "share-influence"]));
  for (const { code, path, resolver } of links) {
    expect(await (await app.request(resolver)).json()).toEqual({ code, path });
    expect(await (await post(app, path)).json()).toMatchObject({ code });
  }
});

test("live sharing requires a moment for the right game and audience", async () => {
  const app = createHouseShareRoutes(db);
  const game = eq(schema.games.id, "share-game");
  await db.update(schema.games).set({ status: "in_progress" }).where(game);
  const moment = "/games/red-fox/replay?audience=mystery&cursor=3";
  for (const path of [
    "/games/red-fox/replay?audience=mystery&speed=2", "/games/red-fox/replay?cue=opening",
    "/games/red-fox/replay/3", "/games/red-fox/results", "/games/red-fox/highlights",
  ]) expect((await post(app, path)).status).toBe(404);
  const created = await post(app, moment);
  expect(created.status).toBe(200);
  const { code } = await created.json() as { code: string };
  await db.update(schema.games).set({ hiddenAt: new Date().toISOString() }).where(game);
  expect((await post(app, moment)).status).toBe(404);
  expect((await app.request(`/api/share-links/${code}`)).status).toBe(404);
  await db.update(schema.games).set({ hiddenAt: null, gameKind: "influence" }).where(game);
  expect((await post(app, moment)).status).toBe(404);
  for (const status of ["waiting", "suspended", "cancelled"] as const) {
    await db.update(schema.games).set({ status }).where(game);
    expect((await post(app, "/games/red-fox/replay/3")).status).toBe(404);
  }
});

test("share links respect game visibility, status and game-specific coordinates", async () => {
  const app = createHouseShareRoutes(db);
  for (const path of ["https://thehouse.game/rules", "//evil.test", "/admin", "/games/red-fox/replay?token=secret"]) expect((await post(app, path)).status).toBe(400);
  for (const path of ["/games/missing", "/profile/missing", "/games/red-fox/replay/3"]) expect((await post(app, path)).status).toBe(404);
  await db.update(schema.games).set({status:"in_progress"}).where(eq(schema.games.id,"share-game"));
  expect((await post(app,"/games/red-fox/replay")).status).toBe(404);
  expect((await post(app,"/games/red-fox")).status).toBe(200);
  await db.update(schema.games).set({status:"completed"}).where(eq(schema.games.id,"share-game"));
  const response = await post(app, "/games/red-fox/replay"); const {code} = await response.json() as {code:string;path:string};
  await db.update(schema.games).set({hiddenAt: new Date().toISOString()}).where(eq(schema.games.id, "share-game"));
  expect((await app.request(`/api/share-links/${code}`)).status).toBe(404);
  expect((await post(app, "/games/red-fox")).status).toBe(404);
  expect((await app.request("/api/share-links/123456789A")).status).toBe(404);
});

test("agent shares resolve anonymously and follow current publication eligibility", async () => {
  await db.insert(schema.users).values({ id: "share-architect", displayName: "Architect" });
  await db.insert(schema.agentProfiles).values([
    { id: "published-agent", userId: "share-architect", name: "Published", personality: "Patient" },
    { id: "unpublished-agent", userId: "share-architect", name: "Draft", personality: "Patient", moderationRequired: true },
  ]);
  const app = createHouseShareRoutes(db);
  expect((await post(app, "/agents/unpublished-agent")).status).toBe(404);
  expect((await post(app, "/dashboard/agents/published-agent/profile")).status).toBe(400);
  const created = await post(app, "/agents/published-agent");
  expect(created.status).toBe(200);
  const { code } = await created.json() as { code: string };
  const resolve = () => app.request(`/api/share-links/${code}`);
  expect(await (await resolve()).json()).toEqual({ code, path: "/agents/published-agent" });
  await db.update(schema.agentProfiles).set({ archivedAt: new Date().toISOString() }).where(eq(schema.agentProfiles.id, "published-agent"));
  expect((await resolve()).status).toBe(404);
});

test("creation rejects unexpected fields and oversized or malformed bodies", async () => {
  const app=createHouseShareRoutes(db);
  for(const body of ['{"path":"/rules","redirect":"https://evil.test"}',"null","[]","invalid"]){
    expect((await app.request("/api/share-links",{method:"POST",headers:{"Content-Type":"application/json"},body})).status).toBe(400);
  }
  expect((await post(app,"/rules?"+"a".repeat(5000))).status).toBe(413);
});

test("shared atomic minute allowance rejects automation and expires without daily caps", async () => {
  await db.insert(schema.houseShareRateLimits).values({key: "visitor:v", count: 119, resetAt: new Date(Date.now() + 60_000)});
  const outcomes = await Promise.allSettled(Array.from({length: 8}, () => admitShareCreation(db, "v", "source")));
  expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
  await db.execute(sql`UPDATE house_share_rate_limits SET reset_at = now() - interval '1 second'`);
  await admitShareCreation(db, "v", "source");
  await db.insert(schema.houseShareRateLimits).values({key: "source:blocked", count: 6000, resetAt: new Date(Date.now() + 60_000)});
  await expect(admitShareCreation(db, "new-cookie", "blocked")).rejects.toThrow("Too many");
});

test("forged forwarding headers do not evade the ingress limit; reads remain available", async () => {
  const app = createHouseShareRoutes(db);
  const response = await post(app, "/rules"); const {code} = await response.json() as {code:string;path:string};
  await db.execute(sql`UPDATE house_share_rate_limits SET count = 6000 WHERE key LIKE 'source:%'`);
  const blocked = await post(createHouseShareRoutes(db), "/about", {"X-Forwarded-For": "1.2.3.4", "CF-Connecting-IP": "4.3.2.1"});
  expect(blocked.status).toBe(429); expect(blocked.headers.get("retry-after")).toBe("60");
  expect((await app.request(`/api/share-links/${code}`)).status).toBe(200);
});

async function shareUser(id: string, admin = false) {
  const [user] = await db.insert(schema.users).values({ id, displayName: id }).returning();
  await grantTestAuthority(db, id, admin ? ["view_admin"] : [], admin ? "admin" : "player");
  const headers = { Authorization: `Bearer ${await createSessionToken(id)}` };
  return { user: user!, headers };
}

test("owned links deduplicate per account, and only eligible browser opens create idempotent receipts", async () => {
  const app = createHouseShareRoutes(db);
  const first = await shareUser("first sharer"), second = await shareUser("second sharer");
  const make = async (headers?: Record<string, string>) => (await post(app, "/rules", headers)).json() as Promise<{ code: string }>;
  const [a, b, guest, aAgain] = await Promise.all([make(first.headers), make(second.headers), make(), make(first.headers)]);
  expect(aAgain.code).toBe(a.code);
  expect(new Set([a.code, b.code, guest.code]).size).toBe(3);

  const read = async (code: string) => (await app.request(`/api/share-links/${code}`)).json() as Promise<{ code: string; path: string; openTicket?: string }>;
  expect(await read(guest.code)).toEqual({ code: guest.code, path: "/rules" });
  const landing = await read(a.code);
  expect(landing.path).toBe("/rules");
  expect(landing.openTicket).toBeString();
  expect(landing).not.toHaveProperty("ownerId");
  expect((await db.select().from(schema.houseShareOpens))).toHaveLength(0);

  const open = async (ticket: string, analytics: boolean, headers = {}) => (await app.request("/api/share-links/open", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ ticket, analytics }),
  })).json() as Promise<{ openId: string; sharing_account_id: string; share_link_id: string; openedAt: string | null } | null>;
  const ticket = landing.openTicket!;
  expect(await open(ticket, false)).toBeNull();
  expect(await open(ticket, true, { "Sec-GPC": "1" })).toBeNull();
  expect(await open(ticket, true, { DNT: "1" })).toBeNull();
  expect(await open(ticket.replace(a.code, b.code), true)).toBeNull();
  await db.transaction(tx => syncAnalyticsPreference(tx, first.user.id, true));
  expect(await open(ticket, true, first.headers)).toBeNull();
  const [one, two] = await Promise.all([open(ticket, true), open(ticket, true)]);
  const [sharingIdentity] = await db.select().from(schema.houseShareAccounts).where(eq(schema.houseShareAccounts.userId, first.user.id));
  expect(one?.sharing_account_id).toBe(sharingIdentity?.analyticsId);
  expect(one?.sharing_account_id).not.toBe(first.user.publicId);
  expect(one?.share_link_id).not.toBe(a.code);
  expect(two?.openId).toBe(one?.openId);
  expect([one?.openedAt, two?.openedAt].filter(Boolean)).toHaveLength(1);
  expect((await db.select().from(schema.houseShareOpens))).toHaveLength(1);

  await deleteAccount(db, first.user.id);
  expect(await read(a.code)).toEqual({ code: a.code, path: "/rules" });
  expect(await open(ticket, true)).toBeNull();
  expect((await make()).code).toBe(guest.code);
});

test("first-touch signup receipts power private reports and PostHog without changing paid campaign data", async () => {
  const links = createHouseShareRoutes(db);
  const admin = await shareUser("share admin", true);
  const owner = await shareUser("sharing account");
  const posthog = new Map<string, Record<string, unknown>>();
  const ads: string[] = [];
  const app = new Hono();
  app.route("/", createCampaignAttributionRoutes(db));
  const reportPath = "/api/admin/share-attribution";
  expect((await app.request(reportPath)).status).toBe(401);
  expect((await app.request(reportPath, { headers: owner.headers })).status).toBe(403);

  const link = await saveShareLink(db, parseHouseShareTarget("/rules"), owner.user.id);
  const laterLink = await saveShareLink(db, parseHouseShareTarget("/about"), owner.user.id);
  const [sharingIdentity] = await db.select().from(schema.houseShareAccounts).where(eq(schema.houseShareAccounts.userId, owner.user.id));
  const open = async (code: string) => {
    const { openTicket } = await (await links.request(`/api/share-links/${code}`)).json() as { openTicket: string };
    const response = await links.request("/api/share-links/open", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analytics: true, ticket: openTicket }),
    });
    return (await response.json() as { openId: string }).openId;
  };
  const [firstOpen, laterOpen] = await Promise.all([open(link.code), open(laterLink.code)]);
  const signup = async (id: string, attribution: Record<string, string>, analytics = true) => {
    const [user] = await db.insert(schema.users).values({ id }).returning();
    await recordAuthenticationTracking(db, { userId: id, publicId: user!.publicId, created: true, analytics, advertising: true, attribution });
    return user!;
  };
  const laterCampaign = { source: "meta", campaign: "later", touchedAt: new Date(Date.now() + 1000).toISOString() };
  const earlierCampaign = { source: "search", campaign: "earlier", touchedAt: new Date(Date.now() - 86_400_000).toISOString() };
  const visitor = await signup("referred visitor", { ...laterCampaign, shareOpenId: firstOpen });
  await signup("receipt copied", { shareOpenId: firstOpen });
  await signup("paid first", { ...earlierCampaign, shareOpenId: laterOpen });
  await signup("analytics denied", { shareOpenId: laterOpen }, false);
  await signup("receipt forged", { shareOpenId: randomUUID() });
  for (const [eventName, id] of [["agent_ready", "ready-a"], ["agent_ready", "ready-b"], ["season_entry", "entry"]] as const) {
    await recordConversion(db, { eventName, id, userId: visitor.id, publicId: visitor.publicId, channel: "api" });
  }
  const rows = await db.select().from(schema.campaignConversionEvents);
  expect(rows.filter(row => row.eventName === "signup_completed")).toHaveLength(5);
  expect(rows.filter(row => row.shareOpenId).map(row => row.userId)).toEqual(Array(4).fill(visitor.id));
  expect(rows.find(row => row.id === `signup:${visitor.id}`)?.attribution?.utm_campaign).toBe("later");

  const accounts = await (await app.request(reportPath, { headers: admin.headers })).json();
  expect(accounts).toEqual({ level: "account", hasNext: false, rows: [{
    displayName: owner.user.displayName, handle: null, publicId: owner.user.publicId, sharingAccountId: sharingIdentity!.analyticsId,
    links: 2, opens: 2, signups: 1, agentReady: 1, seasonEntries: 1,
  }] });
  const accountReport = await (await app.request(`${reportPath}?account=${owner.user.publicId}`, { headers: admin.headers })).json() as { rows: unknown[] };
  expect(accountReport.rows).toEqual([
    { code: link.code, path: "/rules", shareLinkId: link.analyticsId, opens: 1, signups: 1, agentReady: 1, seasonEntries: 1 },
    { code: laterLink.code, path: "/about", shareLinkId: laterLink.analyticsId, opens: 1, signups: 0, agentReady: 0, seasonEntries: 0 },
  ]);

  await deliverPendingConversions(db, { posthogProjectToken: "ph-test", metaPixelId: "pixel", metaAccessToken: "meta-test" }, async (url, init) => {
    const payload = String(init?.body);
    if (url.includes("posthog")) {
      const { event, distinct_id, properties } = JSON.parse(payload);
      if (distinct_id === visitor.publicId) posthog.set(event, properties);
    } else ads.push(payload);
    return Response.json({ events_received: 1 });
  });
  expect([...posthog.keys()].toSorted()).toEqual(["agent_ready", "season_entry", "signup_completed"]);
  for (const properties of posthog.values()) {
    expect(properties).toMatchObject({ share_link_id: link.analyticsId, sharing_account_id: sharingIdentity!.analyticsId });
  }
  expect(ads.length).toBeGreaterThan(0);
  expect(ads.join(" ")).not.toContain(owner.user.publicId);
  expect(ads.join(" ")).not.toContain(sharingIdentity!.analyticsId);
  expect(ads.join(" ")).not.toContain(link.analyticsId!);

  await db.transaction(tx => syncAnalyticsPreference(tx, visitor.id, false, false, undefined, false, true));
  await signup("receipt replayed after withdrawal", { shareOpenId: firstOpen });
  const afterWithdrawal = await (await app.request(reportPath, { headers: admin.headers })).json() as { rows: unknown[] };
  expect(afterWithdrawal.rows[0]).toMatchObject({ opens: 2, signups: 0, agentReady: 0, seasonEntries: 0 });
});
