import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { Hono } from "hono";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { createAuthRoutes } from "../routes/auth.js";
import { createProfileRoutes } from "../routes/profile.js";
import { createPublicPlayerRoutes } from "../routes/public-players.js";
import { createSessionToken } from "../middleware/auth.js";
import { deleteAccount } from "../services/account-deletion.js";
import { processAccountDeletionTask } from "../services/account-deletion-worker.js";
import { getPublicReplayAgentPreviewsByProfileIds } from "../services/public-agent-preview.js";
import { eligibleAgentContent } from "../services/agent-content-eligibility.js";
import { resolveAccountAuthentication } from "../services/account-authentication.js";
import { recordConversion, syncAnalyticsPreference } from "../services/campaign-conversions.js";
import { introspectMcpAccessToken } from "../services/mcp-oauth.js";
import { createHash } from "node:crypto";

describe("account deletion", () => {
  let db: DrizzleDB;
  let app: Hono;
  let publicId: string;
  let token: string;
  beforeEach(async () => {
    db = await setupTestDB();
    process.env.JWT_SECRET = "account-deletion-test-secret-at-least-32-characters";
    const [user] = await db.insert(schema.users).values({ id: "owner", handle: "former-owner", displayName: "Former Owner", email: "former@example.test", walletAddress: "0xformer", gamesPlayed: 1 }).returning();
    publicId = user!.publicId;
    await db.insert(schema.authenticationCredentials).values({ userId: "owner", provider: "clerk", providerSubject: "user_former" });
    await db.insert(schema.verifiedEmailClaims).values({ userId: "owner", normalizedEmail: "former@example.test", state: "active" });
    await db.insert(schema.agentProfiles).values({ id: "agent", userId: "owner", name: "Lady Macbeth", personality: "An ambitious fictional character", avatarUrl: "/portraits/macbeth.png" });
    await db.insert(schema.freeGameQueue).values({ id: "queue", userId: "owner", agentProfileId: "agent" });
    for (const status of ["waiting", "in_progress", "completed"] as const) {
      await db.insert(schema.games).values({ id: status, slug: status, status, config: "{}" });
      await db.insert(schema.gamePlayers).values({ id: `${status}-seat`, gameId: status, userId: "owner", agentProfileId: "agent", persona: JSON.stringify({ name: "Lady Macbeth", avatarUrl: "/portraits/macbeth.png" }), agentConfig: "{}" });
    }
    await db.insert(schema.transcripts).values({ gameId: "completed", round: 1, phase: "MINGLE", fromPlayerId: "completed-seat", text: "What is done cannot be undone.", timestamp: 1 });
    app = new Hono().route("/", createAuthRoutes(db, { managedAuthMode: "disabled" }))
      .route("/", createProfileRoutes(db)).route("/", createPublicPlayerRoutes(db));
    token = await createSessionToken("owner");
  });

  const request = (token: string, body: unknown = { confirmation: "DELETE" }) => new Request("http://localhost/api/account", { method: "DELETE", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });

  test("requires authentication, exact confirmation, and a recent session", async () => {
    expect((await app.request(request("invalid"))).status).toBe(401);
    for (const body of [{}, { confirmation: "delete" }, { confirmation: "DELETE", userId: "someone-else" }]) {
      expect((await app.request(request(token, body))).status).toBe(400);
    }
    const oldToken = await new SignJWT({ sub: "owner" }).setProtectedHeader({ alg: "HS256" }).setIssuer("influence-api")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600).setExpirationTime("1h").sign(new TextEncoder().encode(process.env.JWT_SECRET));
    const result = await app.request(request(oldToken));
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
    expect((await db.select().from(schema.users))[0]!.deletedAt).toBeNull();
  });

  test("deletes identity and public profiles, revokes access, and preserves every game and queued entry", async () => {
    const seats = await db.select().from(schema.gamePlayers);
    const games = await db.select().from(schema.games);
    const dialogue = await db.select().from(schema.transcripts);
    const queue = await db.select().from(schema.freeGameQueue);
    const response = await app.request(request(token));
    expect(response.status).toBe(202);
    const [user] = await db.select().from(schema.users);
    expect(user).toMatchObject({ email: null, walletAddress: null, handle: null, displayName: null });
    expect(user!.deletedAt).toBeTruthy();
    expect(await db.select().from(schema.authenticationCredentials)).toEqual([]);
    expect(await db.select().from(schema.verifiedEmailClaims)).toEqual([]);
    expect((await app.request("/api/profile", { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
    for (const path of [`/api/players/${publicId}`, "/api/players/former-owner", "/api/public/agents/agent", "/api/public/agents/agent/card", "/api/public/agents/agent/art?kind=portrait"]) {
      expect((await app.request(path)).status).toBe(404);
    }
    expect(await (await app.request("/api/leaderboard")).json()).toEqual([]);
    expect(await db.select().from(schema.games)).toEqual(games);
    expect(await db.select().from(schema.gamePlayers)).toEqual(seats);
    expect(await db.select().from(schema.transcripts)).toEqual(dialogue);
    expect(await db.select().from(schema.freeGameQueue)).toEqual(queue);
    // The draw uses this predicate. Deletion does not archive or disqualify an entry.
    expect(await db.select().from(schema.agentProfiles).where(eligibleAgentContent())).toHaveLength(1);
    const preview = (await getPublicReplayAgentPreviewsByProfileIds(db, ["agent"])).get("agent");
    expect(preview).toMatchObject({ name: "Lady Macbeth", avatarUrl: "/portraits/macbeth.png", owner: null });
    expect(preview?.profileHref).toBeUndefined();
    await expect(db.update(schema.users).set({ displayName: "Resurrected" }).where(eq(schema.users.id, "owner")).execute()).rejects.toThrow();
    await expect(db.insert(schema.authenticationCredentials).values({ userId: "owner", provider: "clerk", providerSubject: "late_login" }).execute()).rejects.toThrow();
  });

  test("retries provider cleanup without retaining credentials or reattaching the former account", async () => {
    await deleteAccount(db, "owner");
    await deleteAccount(db, "owner");
    expect(await db.select().from(schema.accountDeletionTasks)).toHaveLength(2);
    const evidence = { provider: "clerk" as const, subject: "user_former", owner: { kind: "email" as const, normalizedEmail: "former@example.test" }, productWalletAddress: null };
    expect(await resolveAccountAuthentication(db, { provider: "clerk", subject: evidence.subject, evidence })).toEqual({ status: "support_blocked" });
    await processAccountDeletionTask(db, async () => { throw new Error("secret provider details"); });
    const failed = (await db.select().from(schema.accountDeletionTasks)).find(task => task.attempts === 1)!;
    expect(failed.lastError).toBe("provider_cleanup_failed");
    expect(failed.completedAt).toBeNull();
    await db.update(schema.accountDeletionTasks).set({ nextAttemptAt: new Date(0) });
    while (await processAccountDeletionTask(db, async () => {})) { /* drain deterministic tasks */ }
    const completed = await db.select().from(schema.accountDeletionTasks);
    expect(completed.every(task => task.target === null && task.completedAt)).toBe(true);
    const recreated = await resolveAccountAuthentication(db, { provider: "clerk", subject: "user_new", evidence: { ...evidence, subject: "user_new" } });
    expect(recreated.status).toBe("authenticated");
    if (recreated.status !== "authenticated") throw new Error("Expected new account");
    expect(recreated.user.id).not.toBe("owner");
    expect(recreated.created).toBe(true);
  });

  test("removes advertising identifiers without dropping campaign totals and prevents tracking resurrection", async () => {
    await db.insert(schema.userAnalyticsPreferences).values({ userId: "owner", analytics: true });
    await db.insert(schema.campaignConversionEvents).values({ id: "conversion", eventName: "signup_completed", userId: "owner", publicId, channel: "web", attribution: { utm_campaign: "launch", gclid: "click", starter_skill: "strategy" }, clientUserAgent: "browser" });
    await deleteAccount(db, "owner");
    const [conversion] = await db.select().from(schema.campaignConversionEvents);
    expect(conversion).toMatchObject({ publicId: "", clientUserAgent: null, attribution: { utm_campaign: "launch", starter_skill: "strategy" }, posthogStatus: "suppressed", platformStatus: "suppressed" });
    expect(await syncAnalyticsPreference(db, "owner", true, true)).toBe(false);
    expect(await recordConversion(db, { id: "late", eventName: "game_placed", userId: "owner", publicId, channel: "api", mcpClientId: "stale-client" })).toBe(true);
    expect((await db.select().from(schema.campaignConversionEvents).where(eq(schema.campaignConversionEvents.id, "late")))[0]).toMatchObject({ publicId: "", attribution: null, mcpClientId: null, posthogStatus: "suppressed" });
    expect(await db.select().from(schema.userAnalyticsPreferences)).toEqual([]);
  });

  test("revokes MCP access and outstanding refresh credentials", async () => {
    const raw = "mcp-token";
    await db.insert(schema.mcpOauthAccessTokens).values({ id: "access", tokenHash: `sha256:${createHash("sha256").update(raw).digest("hex")}`, userId: "owner", clientId: "test", resourceUri: "https://the-house.ai/mcp", scope: "games:read", audience: "game-mcp", purpose: "mcp_access", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await deleteAccount(db, "owner");
    expect(await introspectMcpAccessToken(db, raw)).toEqual({ active: false });
    expect(await db.select().from(schema.mcpOauthAccessTokens)).toEqual([]);
    expect(await db.select().from(schema.mcpOauthRefreshTokens)).toEqual([]);
  });
});
