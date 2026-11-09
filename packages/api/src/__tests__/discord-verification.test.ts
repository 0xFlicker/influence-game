import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { createSessionToken } from "../middleware/auth.js";
import { createDiscordRoutes } from "../routes/discord.js";
import { claimDiscordRoleWork, completeDiscordRoleWork, resolveDiscordAuthority } from "../services/discord-verification.js";
import { DiscordVerificationError } from "../services/discord-oauth.js";
import { runDiscordRoleWorker } from "../discord/worker.js";
import { setupTestDB } from "./test-utils.js";

const guildId = "1521918107554152468";
const discordId = "931691901592145930";
const config = { applicationId: "1521918515752472606", guildId, clientSecret: "test-only", redirectUri: "http://localhost:3001/discord/callback" };
const workerToken = "w".repeat(43);
const controllerToken = "c".repeat(43);
const originalEnv = { JWT_SECRET: process.env.JWT_SECRET, DISCORD_WORKER_TOKEN: process.env.DISCORD_WORKER_TOKEN,
  DISCORD_CONTROLLER_TOKEN: process.env.DISCORD_CONTROLLER_TOKEN, DISCORD_HOUSE_GUILD_ID: process.env.DISCORD_HOUSE_GUILD_ID };
let db: DrizzleDB;
let app: ReturnType<typeof createDiscordRoutes>;
let tokens: Record<string, string>;
let exchangeCount = 0;
let failExchange = false;
const opaque = () => randomBytes(32).toString("base64url");

beforeEach(async () => {
  process.env.JWT_SECRET = "discord-test-session-secret";
  process.env.DISCORD_WORKER_TOKEN = workerToken;
  process.env.DISCORD_CONTROLLER_TOKEN = controllerToken;
  process.env.DISCORD_HOUSE_GUILD_ID = guildId;
  db = await setupTestDB();
  await seedRBAC(db);
  await db.insert(schema.users).values([{ id: "alice", displayName: "Alice" }, { id: "bob", displayName: "Bob" }]);
  tokens = { alice: await createSessionToken("alice"), bob: await createSessionToken("bob") };
  exchangeCount = 0; failExchange = false;
  app = createDiscordRoutes(db, { config: () => config, exchange: async () => {
    exchangeCount++;
    if (failExchange) throw new DiscordVerificationError("discord_exchange_failed", 502, "Start again.");
    return { id: discordId, username: "test-discord" };
  } });
});
afterAll(() => { for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

function call(path: string, body?: object, user = "alice", token = tokens[user]) {
  return app.request(path, { method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
}
async function begin(user = "alice") {
  const nonce = opaque();
  const response = await call("/api/discord/start", { nonce }, user);
  expect(response.status).toBe(200);
  const result = await response.json() as { state: string; authorizationUrl: string };
  return { nonce, ...result };
}
async function verified(user = "alice") {
  const attempt = await begin(user);
  const response = await call("/api/discord/exchange", { state: attempt.state, nonce: attempt.nonce, code: "code", issuer: "https://discord.com" }, user);
  expect(response.status).toBe(200);
  return { state: attempt.state, nonce: attempt.nonce };
}
async function connected() {
  const attempt = await verified();
  expect((await call("/api/discord/confirm", attempt)).status).toBe(200);
  return attempt;
}

describe("Discord account verification", () => {
  it("requires House authentication, rejects service accounts and preserves legal acceptance", async () => {
    expect((await call("/api/discord/start", { nonce: opaque() }, "", "")).status).toBe(401);
    await db.insert(schema.servicePrincipals).values({ userId: "alice" });
    expect((await call("/api/discord/start", { nonce: opaque() })).status).toBe(403);
    expect((await call("/api/discord/start", { nonce: opaque() }, "bob", await createSessionToken("bob", { legalAcceptance: null }))).status).toBe(403);
  });
  it("binds state to the House account and browser, with no link before confirmation", async () => {
    const attempt = await begin();
    const url = new URL(attempt.authorizationUrl);
    expect(url.searchParams.get("scope")).toBe("identify");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    const input = { state: attempt.state, nonce: attempt.nonce, code: "code", issuer: "https://discord.com" };
    expect((await call("/api/discord/exchange", input, "bob")).status).toBe(400);
    expect((await call("/api/discord/exchange", { ...input, nonce: opaque() })).status).toBe(400);
    expect((await call("/api/discord/exchange", { ...input, issuer: "https://evil.example" })).status).toBe(400);
    expect(exchangeCount).toBe(0);
    expect((await call("/api/discord/exchange", input)).status).toBe(200);
    expect((await db.select().from(schema.discordConnections)).length).toBe(0);
    expect((await call("/api/discord/exchange", input)).status).toBe(200);
    expect(exchangeCount).toBe(1);
    const saved = (await db.select().from(schema.discordVerificationAttempts))[0]!;
    expect(saved.stateHash).not.toBe(attempt.state);
    expect(saved.nonceHash).not.toBe(attempt.nonce);
    expect(JSON.stringify(saved)).not.toContain("clientSecret");
  });
  it("does not accept expired, forged, failed or malformed exchanges", async () => {
    const attempt = await begin();
    expect((await call("/api/discord/confirm", { state: attempt.state, nonce: attempt.nonce })).status).toBe(400);
    expect((await call("/api/discord/start", { nonce: opaque(), discordId })).status).toBe(400);
    await db.update(schema.discordVerificationAttempts).set({ expiresAt: new Date(0) });
    const expired = await call("/api/discord/exchange", { state: attempt.state, nonce: attempt.nonce, code: "code", issuer: "https://discord.com" });
    expect(expired.status).toBe(400);
    expect(await expired.json()).toMatchObject({ code: "invalid_attempt" });
    const second = await begin();
    failExchange = true;
    expect((await call("/api/discord/exchange", { state: second.state, nonce: second.nonce, code: "code", issuer: "https://discord.com" })).status).toBe(502);
    expect((await db.select().from(schema.discordConnections)).length).toBe(0);
    expect((await call("/api/discord/confirm", { state: second.state, nonce: second.nonce })).status).toBe(400);
  });
  it("enforces one-to-one identity under simultaneous confirmation and hides the conflicting owner", async () => {
    const alice = await verified("alice");
    const bob = await verified("bob");
    const results = await Promise.all([call("/api/discord/confirm", alice), call("/api/discord/confirm", bob, "bob")]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const rejected = await results.find(r => r.status === 409)!.text();
    expect(rejected).not.toContain("alice"); expect(rejected).not.toContain("bob");
    expect((await db.select().from(schema.discordConnections)).length).toBe(1);
  });
  it("makes confirmation idempotent and keeps authority current after a role change", async () => {
    const attempt = await connected();
    expect((await call("/api/discord/confirm", attempt)).status).toBe(200);
    const [sysop] = await db.select().from(schema.roles).where(eq(schema.roles.name, "sysop"));
    await db.insert(schema.userRoles).values({ userId: "alice", roleId: sysop!.id });
    const authority = await resolveDiscordAuthority(db, discordId, guildId);
    expect(authority.connected && authority.communityRoles).toEqual(["user", "moderator", "admin", "sysop"]);
    expect(authority.connected && authority.permissions.includes("manage_roles")).toBe(true);
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, "alice"));
    const revoked = await resolveDiscordAuthority(db, discordId, guildId);
    expect(revoked.connected && revoked.communityRoles).toEqual(["user"]);
    expect(revoked.connected && revoked.permissions).toEqual([]);
    expect((await db.select().from(schema.discordConnectionAudit)).length).toBe(1);
  });
  it("isolates worker and controller credentials from human sessions and each other", async () => {
    await connected();
    const identity = { discordId, guildId };
    expect((await call("/api/internal/discord/identity", identity)).status).toBe(401);
    expect((await call("/api/internal/discord/identity", identity, "", workerToken)).status).toBe(401);
    expect((await call("/api/internal/discord/identity", identity, "", controllerToken)).status).toBe(200);
    expect((await call("/api/internal/discord/work/claim", {}, "", controllerToken)).status).toBe(401);
    expect((await call("/api/internal/discord/work/claim", {}, "", workerToken)).status).toBe(200);
    expect((await call("/api/discord/start", { nonce: opaque() }, "", workerToken)).status).toBe(401);
  });
  it("leases delivery once, survives restart, rejects stale completion and retries uncertain writes", async () => {
    await connected();
    const work = await claimDiscordRoleWork(db, guildId);
    expect(work).not.toBeNull();
    expect(await claimDiscordRoleWork(db, guildId)).toBeNull();
    await call("/api/discord/refresh", {});
    expect(await completeDiscordRoleWork(db, { ...work! })).toBe(false);
    const newer = await claimDiscordRoleWork(db, guildId);
    expect(newer!.revision).toBe(2);
    await db.update(schema.discordConnections).set({ leaseUntil: new Date(0) });
    const recovered = await claimDiscordRoleWork(db, guildId);
    expect(recovered!.lease).not.toBe(newer!.lease);
    expect(await completeDiscordRoleWork(db, newer!)).toBe(false);
    expect(await completeDiscordRoleWork(db, recovered!)).toBe(true);
    expect(await claimDiscordRoleWork(db, guildId)).toBeNull();
  });
  it("disconnect revokes authority immediately, retains cleanup and prevents stale relinking", async () => {
    const attempt = await connected();
    const old = await claimDiscordRoleWork(db, guildId);
    await call("/api/discord/disconnect", {});
    expect(await resolveDiscordAuthority(db, discordId, guildId)).toEqual({ connected: false });
    expect((await call("/api/discord/start", { nonce: opaque() })).status).toBe(409);
    expect(await completeDiscordRoleWork(db, old!)).toBe(false);
    const cleanup = await claimDiscordRoleWork(db, guildId);
    expect(cleanup!.roles).toEqual([]);
    await completeDiscordRoleWork(db, { ...cleanup!, error: "permissions" });
    expect((await db.select().from(schema.discordConnections)).length).toBe(1);
    await db.update(schema.discordConnections).set({ nextAttemptAt: new Date(0) });
    await completeDiscordRoleWork(db, (await claimDiscordRoleWork(db, guildId))!);
    expect((await db.select().from(schema.discordConnections)).length).toBe(0);
    expect((await call("/api/discord/confirm", attempt)).status).toBe(400);
  });
  it("rate-limits starts without dropping verification state", async () => {
    for (let i = 0; i < 10; i++) await begin();
    expect((await call("/api/discord/start", { nonce: opaque() })).status).toBe(429);
    expect((await db.select().from(schema.discordVerificationAttempts)).length).toBe(10);
  });
});

describe("Discord role delivery through the actual API", () => {
  const roleIds = { user: "100000000000000001", moderator: "100000000000000002", admin: "100000000000000003", sysop: "100000000000000004" };
  const botId = "200000000000000001";
  const botRole = "200000000000000002";
  const unrelated = "300000000000000001";
  async function fixture(options: { fail?: number; discordErrorCode?: number; administrator?: boolean; pending?: boolean; unusableRole?: "missing" | "managed" | "higher"; disconnectOnGrant?: boolean } = {}) {
    await connected();
    const memberRoles = new Set([unrelated, roleIds.admin]);
    const writes: string[] = [];
    const request = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.origin === "http://house.test") return app.request(request);
      const path = url.pathname.replace("/api/v10", "");
      if (options.fail) return Response.json({ code: options.discordErrorCode ?? 10007 }, { status: options.fail, headers: { "Retry-After": "90" } });
      if (path === "/users/@me") return Response.json({ id: botId });
      if (path === `/guilds/${guildId}/members/${botId}`) return Response.json({ roles: [botRole] });
      if (path === `/guilds/${guildId}/roles`) return Response.json([
        ...Object.values(roleIds).filter(id => options.unusableRole !== "missing" || id !== roleIds.user).map(id => ({
          id, position: options.unusableRole === "higher" && id === roleIds.user ? 11 : 1,
          permissions: options.administrator ? "8" : "0", managed: options.unusableRole === "managed" && id === roleIds.user,
        })),
        { id: botRole, position: 10, permissions: "268435456", managed: true },
      ]);
      if (path === `/guilds/${guildId}/members/${discordId}`) return Response.json({ roles: [...memberRoles], pending: options.pending });
      const role = path.split("/roles/")[1];
      if (role && ["PUT", "DELETE"].includes(request.method)) {
        if (request.method === "PUT" && options.disconnectOnGrant) {
          options.disconnectOnGrant = false;
          await call("/api/discord/disconnect", {});
        }
        writes.push(`${request.method}:${role}`);
        if (request.method === "PUT") memberRoles.add(role); else memberRoles.delete(role);
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected test request ${path}`);
    }) as typeof fetch;
    const worker = () => runDiscordRoleWorker({ apiUrl: "http://house.test", botToken: "fixture", workerToken, guildId, roleIds }, request);
    return { worker, memberRoles, writes };
  }
  it("removes obsolete roles before adding current roles and preserves unrelated roles", async () => {
    const f = await fixture();
    expect(await f.worker()).toEqual({ status: "delivered" });
    expect(f.writes).toEqual([`DELETE:${roleIds.admin}`, `PUT:${roleIds.user}`]);
    expect([...f.memberRoles].sort()).toEqual([unrelated, roleIds.user].sort());
    expect((await call("/api/discord/connection")).status).toBe(200);
    expect((await db.select().from(schema.discordConnections))[0]!.deliveredRevision).toBe(1);
  });
  it("compensates an in-flight role grant after disconnect before freeing the link", async () => {
    const f = await fixture({ disconnectOnGrant: true });
    expect(await f.worker()).toEqual({ status: "superseded" });
    expect(f.memberRoles.has(roleIds.user)).toBe(true);
    expect(await resolveDiscordAuthority(db, discordId, guildId)).toEqual({ connected: false });
    expect((await db.select().from(schema.discordConnections))[0]!.disconnecting).toBe(true);
    expect(await f.worker()).toEqual({ status: "delivered" });
    expect([...f.memberRoles]).toEqual([unrelated]);
    expect((await db.select().from(schema.discordConnections)).length).toBe(0);
  });
  it("honors rate limits and retains a pending delivery", async () => {
    const f = await fixture({ fail: 429 });
    const [clock] = await db.execute<{ time: string }>(sql`SELECT now()::text AS time`);
    const before = new Date(clock!.time).getTime();
    expect(await f.worker()).toEqual({ status: "retry" });
    const [row] = await db.select().from(schema.discordConnections);
    expect(row!.lastError).toBe("rate_limited");
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 90_000);
    expect(row!.deliveredRevision).toBe(0);
  });
  it.each([[403, "permissions"], [503, "discord_unavailable"]] as const)("retains pending delivery after Discord HTTP %i", async (status, code) => {
    const f = await fixture({ fail: status });
    expect(await f.worker()).toEqual({ status: "retry" });
    const [row] = await db.select().from(schema.discordConnections);
    expect(row!.lastError).toBe(code);
    expect(row!.deliveredRevision).toBe(0);
  });
  it.each(["missing", "managed", "higher"] as const)("rejects a %s configured role before any writes", async unusableRole => {
    const f = await fixture({ unusableRole });
    expect(await f.worker()).toEqual({ status: "retry" });
    expect(f.writes).toEqual([]);
    expect((await db.select().from(schema.discordConnections))[0]!.lastError).toBe("configuration");
  });
  it("never assigns Administrator roles", async () => {
    const f = await fixture({ administrator: true });
    expect(await f.worker()).toEqual({ status: "retry" });
    expect(f.writes).toEqual([]);
    expect((await db.select().from(schema.discordConnections))[0]!.lastError).toBe("configuration");
  });
  it("waits for membership screening before granting roles", async () => {
    const f = await fixture({ pending: true });
    expect(await f.worker()).toEqual({ status: "retry" });
    expect(f.writes).toEqual([]);
    expect((await db.select().from(schema.discordConnections))[0]!.lastError).toBe("member_pending");
  });
  it("removes an obsolete Administrator grant during disconnect", async () => {
    const f = await fixture({ administrator: true });
    await call("/api/discord/disconnect", {});
    expect(await f.worker()).toEqual({ status: "delivered" });
    expect(f.writes).toEqual([`DELETE:${roleIds.admin}`]);
    expect([...f.memberRoles]).toEqual([unrelated]);
    expect((await db.select().from(schema.discordConnections)).length).toBe(0);
  });
  it("acknowledges removal when the linked account is no longer human", async () => {
    const f = await fixture();
    await db.insert(schema.servicePrincipals).values({ userId: "alice" });
    expect(await f.worker()).toEqual({ status: "delivered" });
    expect([...f.memberRoles]).toEqual([unrelated]);
    expect((await db.select().from(schema.discordConnections))[0]!.deliveredRevision).toBe(1);
    expect(await resolveDiscordAuthority(db, discordId, guildId)).toEqual({ connected: false });
  });
  it("keeps absent guild members linked until they join and retry", async () => {
    const f = await fixture({ fail: 404 });
    expect(await f.worker()).toEqual({ status: "retry" });
    expect((await db.select().from(schema.discordConnections))[0]!.lastError).toBe("member_missing");
    await call("/api/discord/disconnect", {});
    expect(await f.worker()).toEqual({ status: "delivered" });
    expect((await db.select().from(schema.discordConnections)).length).toBe(0);
  });
  it.each([10004, 10011, 0])("does not mistake Discord 404 code %i for completed member cleanup", async discordErrorCode => {
    const f = await fixture({ fail: 404, discordErrorCode });
    await call("/api/discord/disconnect", {});
    expect(await f.worker()).toEqual({ status: "retry" });
    const [row] = await db.select().from(schema.discordConnections);
    expect(row!.disconnecting).toBe(true);
    expect(row!.lastError).toBe("configuration");
    expect(row!.deliveredRevision).toBe(0);
    expect((await call("/api/discord/start", { nonce: opaque() })).status).toBe(409);
  });
  it("expires abandoned verification evidence", async () => {
    await begin();
    await db.update(schema.discordVerificationAttempts).set({ expiresAt: sql`now() - interval '1 minute'` });
    await begin();
    expect((await db.select().from(schema.discordVerificationAttempts)).length).toBe(1);
  });
});
