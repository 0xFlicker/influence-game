/**
 * Auth middleware and routes tests.
 *
 * Tests JWT session creation/verification, RBAC permission gating, and the auth routes.
 * Privy verification is NOT tested here (requires real Privy credentials).
 */

import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import { createHash } from "crypto";
import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import { schema } from "../db/index.js";
import type { DrizzleDB } from "../db/index.js";
import {
  createSessionToken,
  verifySessionToken,
  requireAuth,
  requireAdmin,
  requirePermission,
  requireRole,
  optionalAuth,
  type AuthEnv,
  type AuthUser,
} from "../middleware/auth.js";
import { createAuthRoutes } from "../routes/auth.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { setupTestDB } from "./test-utils.js";
import {
  authorizeMcpOAuth,
  exchangeMcpOAuthCode,
  MCP_OAUTH_CLIENT_ID,
} from "../services/mcp-oauth.js";
import type {
  ClerkAuthenticationProviderVerifier,
  ProviderVerificationResult,
} from "../services/authentication-providers.js";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const TEST_ADMIN_ADDRESS = "0xadmin000000000000000000000000000000dead";

beforeAll(() => {
  process.env.JWT_SECRET = "test-jwt-secret-auth-tests";
  process.env.ADMIN_ADDRESS = TEST_ADMIN_ADDRESS;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupDB() {
  const db = await setupTestDB();
  await seedRBAC(db);
  return db;
}

// ---------------------------------------------------------------------------
// JWT session tokens
// ---------------------------------------------------------------------------

describe("JWT session tokens", () => {
  test("createSessionToken produces a valid JWT", async () => {
    const token = await createSessionToken("user-123");
    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
  });

  test("verifySessionToken decodes a valid token", async () => {
    const token = await createSessionToken("user-456");
    const session = await verifySessionToken(token);
    expect(session).not.toBeNull();
    expect(session!.userId).toBe("user-456");
    expect(session!.roles).toEqual([]);
    expect(session!.permissions).toEqual([]);
  });

  test("verifySessionToken decodes roles and permissions", async () => {
    const token = await createSessionToken("user-789", {
      roles: ["sysop"],
      permissions: ["manage_roles", "create_game"],
    });
    const session = await verifySessionToken(token);
    expect(session).not.toBeNull();
    expect(session!.userId).toBe("user-789");
    expect(session!.roles).toEqual(["sysop"]);
    expect(session!.permissions).toContain("manage_roles");
    expect(session!.permissions).toContain("create_game");
  });

  test("verifySessionToken returns null for invalid token", async () => {
    const session = await verifySessionToken("garbage.token.here");
    expect(session).toBeNull();
  });

  test("verifySessionToken returns null for tampered token", async () => {
    const token = await createSessionToken("user-abc");
    const tampered = token.slice(0, -5) + "XXXXX";
    const session = await verifySessionToken(tampered);
    expect(session).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// requireAuth middleware
// ---------------------------------------------------------------------------

describe("requireAuth middleware", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupDB();
  });

  test("blocks request without Authorization header", async () => {
    const app = new Hono<AuthEnv>();
    app.use("/*", requireAuth(db));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Authentication required");
  });

  test("blocks request with invalid token", async () => {
    const app = new Hono<AuthEnv>();
    app.use("/*", requireAuth(db));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      headers: { Authorization: "Bearer invalid-token" },
    });
    expect(res.status).toBe(401);
  });

  test("blocks request if user not in database", async () => {
    const app = new Hono<AuthEnv>();
    app.use("/*", requireAuth(db));
    app.get("/test", (c) => c.json({ ok: true }));

    const token = await createSessionToken("nonexistent-user");
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  test("allows request with valid token and existing user", async () => {
    await db.insert(schema.users)
      .values({
        id: "real-user",
        walletAddress: "0xabc",
        email: "test@test.com",
        displayName: "Tester",
      });

    const app = new Hono<AuthEnv>();
    app.use("/*", requireAuth(db));
    app.get("/test", (c) => {
      const user = c.get("user");
      return c.json({ user });
    });

    const token = await createSessionToken("real-user");
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: AuthUser };
    expect(body.user).toEqual({
      id: "real-user",
      walletAddress: "0xabc",
      displayName: "Tester",
    });
    expect(body.user).not.toHaveProperty("email");
  });

  test("attaches roles and permissions from JWT to context", async () => {
    await db.insert(schema.users)
      .values({
        id: "rbac-user",
        walletAddress: "0xrbac",
        displayName: "RBAC User",
      });

    const app = new Hono<AuthEnv>();
    app.use("/*", requireAuth(db));
    app.get("/test", (c) => {
      return c.json({
        roles: c.get("userRoles"),
        permissions: c.get("userPermissions"),
      });
    });

    const token = await createSessionToken("rbac-user", {
      roles: ["admin"],
      permissions: ["create_game", "view_admin"],
    });
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roles: string[]; permissions: string[] };
    expect(body.roles).toEqual(["admin"]);
    expect(body.permissions).toContain("create_game");
    expect(body.permissions).toContain("view_admin");
  });
});

// ---------------------------------------------------------------------------
// requirePermission middleware
// ---------------------------------------------------------------------------

describe("requirePermission middleware", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupDB();
  });

  test("blocks user without required permission", async () => {
    await db.insert(schema.users)
      .values({ id: "no-perm", walletAddress: "0xnoperm", displayName: "No Perm" });

    const app = new Hono<AuthEnv>();
    app.use("/*", requireAuth(db), requirePermission("create_game"));
    app.get("/test", (c) => c.json({ ok: true }));

    const token = await createSessionToken("no-perm", {
      roles: ["player"],
      permissions: ["join_game"],
    });
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  test("allows user with matching permission", async () => {
    await db.insert(schema.users)
      .values({ id: "has-perm", walletAddress: "0xhasperm", displayName: "Has Perm" });

    const app = new Hono<AuthEnv>();
    app.use("/*", requireAuth(db), requirePermission("create_game"));
    app.get("/test", (c) => c.json({ ok: true }));

    const token = await createSessionToken("has-perm", {
      roles: ["admin"],
      permissions: ["create_game", "view_admin"],
    });
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  test("allows if user has any of multiple required permissions", async () => {
    await db.insert(schema.users)
      .values({ id: "multi-perm", walletAddress: "0xmulti", displayName: "Multi" });

    const app = new Hono<AuthEnv>();
    app.use("/*", requireAuth(db), requirePermission("start_game", "stop_game"));
    app.get("/test", (c) => c.json({ ok: true }));

    const token = await createSessionToken("multi-perm", {
      roles: ["admin"],
      permissions: ["stop_game"],
    });
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Local CLI session exchange
// ---------------------------------------------------------------------------

describe("local CLI session exchange", () => {
  let db: DrizzleDB;
  let app: Hono;

  beforeEach(async () => {
    db = await setupDB();
    app = new Hono();
    app.route("/", createAuthRoutes(db));
  });

  test("exchanges a loopback producer MCP token for a normal app session", async () => {
    const walletAddress = "0xproducer00000000000000000000000000000001";
    await db.insert(schema.users).values({
      id: "producer-cli-user",
      walletAddress,
      displayName: "Producer CLI",
      createdAt: "2026-07-17T00:00:00.000Z",
    });
    await assignRoles(db, walletAddress, ["producer", "gamer"]);
    const mcpToken = await issueProducerMcpToken(db, {
      userId: "producer-cli-user",
      walletAddress,
    });

    const res = await app.request("http://127.0.0.1/api/auth/local-cli-session", {
      method: "POST",
      headers: { Authorization: `Bearer ${mcpToken}` },
      body: JSON.stringify({}),
    });

    if (res.status !== 200) {
      console.error("local CLI exchange failure", await res.clone().text());
    }
    expect(res.status).toBe(200);
    const body = await res.json() as {
      token: string;
      user: {
        publicId: string;
        handle: string | null;
        displayName: string;
        publicIdentityOnboarding: { state: string };
        roles: string[];
        permissions: string[];
      };
    };
    expect(body.user.roles).toContain("producer");
    expect(body.user.roles).toContain("gamer");
    expect(body.user.permissions).toContain("create_game");
    expect(body.user.permissions).toContain("fill_game");
    expect(body.user.permissions).toContain("start_game");
    expect(body.user.publicId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.user.handle).toBeNull();
    expect(body.user.displayName).toBe("Producer CLI");
    expect(body.user.publicIdentityOnboarding.state).toBe("required");
    const session = await verifySessionToken(body.token);
    expect(session?.userId).toBe("producer-cli-user");
    expect(session?.permissions).toContain("create_game");
  });

  test("rejects the exchange away from loopback hosts", async () => {
    const res = await app.request("https://influence.example/api/auth/local-cli-session", {
      method: "POST",
      headers: { Authorization: "Bearer anything" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Local CLI session exchange is loopback-only" });
  });
});

describe("authenticated public identity session projection", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupDB();
  });

  test("/auth/me returns the same safe identity enforcement fields as login", async () => {
    await db.insert(schema.users).values({
      id: "identity-session-user",
      walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
      email: "identity@example.com",
      displayName: "0x1234...5678",
      createdAt: "2026-07-17T00:00:00.000Z",
    });
    const token = await createSessionToken("identity-session-user");
    const app = new Hono();
    app.route("/", createAuthRoutes(db));

    const res = await app.request("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      publicId: string;
      handle: string | null;
      displayName: string;
      publicIdentityOnboarding: { state: string };
    };
    expect(body.publicId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.handle).toBeNull();
    expect(body.displayName).toBe("Anonymous");
    expect(body.publicIdentityOnboarding.state).toBe("required");
  });

  test("login returns the updated row and retains the resolved user projection", async () => {
    await db.insert(schema.users).values({
      id: "did:privy:existing-user",
      email: "identity@example.com",
      displayName: "identity@example.com",
      createdAt: "2026-07-17T00:00:00.000Z",
    });
    const walletAddress = "0x1234567890abcdef1234567890abcdef12345678";
    const app = new Hono();
    app.route("/", createAuthRoutes(db, {
      verifyPrivyToken: async () => "did:privy:existing-user",
      getPrivyUser: async () => ({
        id: "did:privy:existing-user",
        createdAt: new Date(),
        isGuest: false,
        customMetadata: {},
        linkedAccounts: [
          {
            type: "wallet",
            address: walletAddress,
            chainType: "ethereum",
            walletClientType: "privy",
            verifiedAt: new Date(),
            firstVerifiedAt: new Date(),
            latestVerifiedAt: new Date(),
          },
          {
            type: "email",
            address: "identity@example.com",
            verifiedAt: new Date(),
            firstVerifiedAt: new Date(),
            latestVerifiedAt: new Date(),
          },
        ],
      }),
      isInviteRequired: async () => false,
    }));

    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "valid-test-token" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      token: string;
      user: {
        walletAddress: string | null;
        publicId: string;
        displayName: string;
        publicIdentityOnboarding: { state: string };
      };
    };
    expect(body.token).toBeTruthy();
    expect(body.user.walletAddress).toBeNull();
    expect(body.user.publicId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.user.displayName).toBe("Anonymous");
    expect(body.user.publicIdentityOnboarding.state).toBe("required");
    expect(await db.select().from(schema.authenticationCredentials)).toHaveLength(1);
    expect(await db.select().from(schema.verifiedEmailClaims)).toHaveLength(1);
  });

  test("login route passes the disabled compatibility bridge to account resolution", async () => {
    const subject = "did:privy:route-bridge-disabled";
    await db.insert(schema.users).values({
      id: subject,
      email: "legacy-route@example.com",
    });
    const app = new Hono();
    app.route("/", createAuthRoutes(db, {
      verifyPrivyToken: async () => subject,
      getPrivyUser: async () => ({
        id: subject,
        createdAt: new Date(),
        isGuest: false,
        customMetadata: {},
        linkedAccounts: [{
          type: "email",
          address: "legacy-route@example.com",
          verifiedAt: new Date(),
          firstVerifiedAt: new Date(),
          latestVerifiedAt: new Date(),
        }],
      }),
      isInviteRequired: async () => false,
      compatibilityBridgeEnabled: false,
    }));

    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "verified-token" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This account needs support before it can sign in",
      code: "ACCOUNT_SUPPORT_REQUIRED",
    });
    expect(await db.select().from(schema.authenticationCredentials)).toHaveLength(0);
    expect(await db.select().from(schema.users)).toHaveLength(1);
  });

  test("known Privy credentials ignore profile and invite-service outages", async () => {
    await db.insert(schema.users).values({
      id: "durable-known-user",
      displayName: "Known",
    });
    await db.insert(schema.authenticationCredentials).values({
      userId: "durable-known-user",
      provider: "privy",
      providerSubject: "did:privy:known-outage",
    });
    const app = new Hono();
    app.route("/", createAuthRoutes(db, {
      verifyPrivyToken: async () => "did:privy:known-outage",
      getPrivyUser: async () => {
        throw new Error("profile unavailable");
      },
      isInviteRequired: async () => {
        throw new Error("invite setting should not be read for an existing account");
      },
    }));

    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "valid-test-token" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { token: string; user: { id: string } };
    expect(body.token).toBeTruthy();
    expect(body.user.id).toBe("durable-known-user");
  });
});

describe("managed authentication routes", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupDB();
  });

  test("mode gates hide disabled routes and make existing-only mutation-free", async () => {
    let calls = 0;
    const verifier = clerkVerifier(async () => {
      calls += 1;
      return verifiedClerk("clerk-mode", "mode@example.com");
    });
    const disabled = new Hono();
    disabled.route("/", createAuthRoutes(db, {
      managedAuthMode: "disabled",
      clerkVerifier: verifier,
    }));
    expect((await disabled.request("/api/auth/managed/exchange", {
      method: "POST",
      body: JSON.stringify({ token: "token" }),
    })).status).toBe(404);

    const existingOnly = new Hono();
    existingOnly.route("/", createAuthRoutes(db, {
      managedAuthMode: "existing-only",
      clerkVerifier: verifier,
    }));
    const mutation = await existingOnly.request("/api/auth/managed/create", {
      method: "POST",
      body: JSON.stringify({ token: "token", confirm: true }),
    });
    expect(mutation.status).toBe(403);
    expect(calls).toBe(0);

    await db.insert(schema.users).values({
      id: "existing-only-user",
      email: "mode@example.com",
      displayName: "Existing password user",
    });
    await db.insert(schema.authenticationCredentials).values({
      userId: "existing-only-user",
      provider: "clerk",
      providerSubject: "clerk-mode",
    });
    await db.insert(schema.verifiedEmailClaims).values({
      normalizedEmail: "mode@example.com",
      userId: "existing-only-user",
      state: "active",
    });

    const exchange = await managedRequest(
      existingOnly,
      "/api/auth/managed/exchange",
      { token: "token" },
    );
    expect(exchange.status).toBe(200);
    expect(calls).toBe(1);
    const exchangeBody = await exchange.json() as {
      token: string;
      user: { id: string };
    };
    expect(exchangeBody.user.id).toBe("existing-only-user");
    expect((await verifySessionToken(exchangeBody.token))?.userId)
      .toBe("existing-only-user");
  });

  test("unknown completed session requires explicit create and then exchanges repeatably", async () => {
    const verifier = clerkVerifier(async () => (
      verifiedClerk("clerk-create", "created@example.com")
    ));
    const app = new Hono();
    app.route("/", createAuthRoutes(db, {
      managedAuthMode: "full",
      clerkVerifier: verifier,
    }));

    const exchangeBefore = await managedRequest(
      app,
      "/api/auth/managed/exchange",
      { token: "completed" },
    );
    expect(exchangeBefore.status).toBe(409);
    expect(await exchangeBefore.json()).toMatchObject({
      code: "ACCOUNT_SETUP_INCOMPLETE",
    });

    const [first, second] = await Promise.all([
      managedRequest(app, "/api/auth/managed/create", {
        token: "completed",
        confirm: true,
      }),
      managedRequest(app, "/api/auth/managed/create", {
        token: "completed",
        confirm: true,
      }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = await first.json() as { token: string; user: { id: string } };
    const secondBody = await second.json() as { token: string; user: { id: string } };
    expect(firstBody.user.id).toBe(secondBody.user.id);
    expect((await verifySessionToken(firstBody.token))?.userId).toBe(firstBody.user.id);
    expect(await db.select().from(schema.users)).toHaveLength(1);

    const later = await managedRequest(
      app,
      "/api/auth/managed/exchange",
      { token: "completed" },
    );
    expect(later.status).toBe(200);
  });

  test("email collision asks for confirmation and authenticated link preserves the account", async () => {
    await db.insert(schema.users).values({
      id: "email-owner",
      email: "owner@example.com",
      displayName: "Owner",
    });
    await db.insert(schema.authenticationCredentials).values({
      userId: "email-owner",
      provider: "privy",
      providerSubject: "did:privy:email-owner",
    });
    await db.insert(schema.verifiedEmailClaims).values({
      normalizedEmail: "owner@example.com",
      userId: "email-owner",
      state: "active",
    });
    const app = new Hono();
    app.route("/", createAuthRoutes(db, {
      managedAuthMode: "full",
      clerkVerifier: clerkVerifier(async () => (
        verifiedClerk("clerk-owner", "owner@example.com")
      )),
    }));

    const collision = await managedRequest(
      app,
      "/api/auth/managed/exchange",
      { token: "completed" },
    );
    expect(collision.status).toBe(409);
    expect(await collision.json()).toMatchObject({
      code: "ACCOUNT_LINK_CONFIRMATION_REQUIRED",
    });
    expect(await db.select().from(schema.authenticationCredentials)).toHaveLength(1);

    const linked = await managedRequest(
      app,
      "/api/auth/managed/link",
      { token: "completed", confirm: true },
    );
    expect(linked.status).toBe(200);
    expect(await db.select().from(schema.authenticationCredentials)).toHaveLength(2);
  });

  test("wallet link survives expired Privy proof and succeeds after matching owner reauth", async () => {
    const embedded = "0x1111111111111111111111111111111111111111";
    const external = "0x2222222222222222222222222222222222222222";
    await db.insert(schema.users).values({
      id: "wallet-owner",
      walletAddress: embedded,
      displayName: "Wallet owner",
    });
    await db.insert(schema.authenticationCredentials).values({
      userId: "wallet-owner",
      provider: "privy",
      providerSubject: "did:privy:wallet-owner",
    });
    const app = new Hono();
    app.route("/", createAuthRoutes(db, {
      managedAuthMode: "full",
      clerkVerifier: clerkVerifier(async () => (
        verifiedClerk("clerk-wallet-owner", "wallet-owner@example.com")
      )),
      verifyPrivyToken: async (token) => (
        token === "fresh-privy" ? "did:privy:wallet-owner" : null
      ),
      getPrivyUser: async () => ({
        id: "did:privy:wallet-owner",
        createdAt: new Date(),
        isGuest: false,
        customMetadata: {},
        linkedAccounts: [
          {
            type: "wallet",
            address: embedded,
            chainType: "ethereum",
            walletClientType: "privy",
            verifiedAt: new Date(),
            firstVerifiedAt: new Date(),
            latestVerifiedAt: new Date(),
          },
          {
            type: "wallet",
            address: external,
            chainType: "ethereum",
            walletClientType: "metamask",
            verifiedAt: new Date(),
            firstVerifiedAt: new Date(),
            latestVerifiedAt: new Date(),
          },
        ],
      }),
    }));
    const influenceToken = await createSessionToken("wallet-owner");

    const expired = await managedRequest(
      app,
      "/api/auth/managed/link",
      { token: "clerk", privyToken: "expired", confirm: true },
      influenceToken,
    );
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({ code: "WALLET_REAUTH_REQUIRED" });
    expect(await db.select().from(schema.authenticationCredentials)).toHaveLength(1);

    const linked = await managedRequest(
      app,
      "/api/auth/managed/link",
      { token: "clerk", privyToken: "fresh-privy", confirm: true },
      influenceToken,
    );
    expect(linked.status).toBe(200);
    expect(await db.select().from(schema.authenticationCredentials)).toHaveLength(2);
  });

  test("pending, locked, malformed, oversized, timed-out, and burst requests issue no session", async () => {
    let calls = 0;
    let result: ProviderVerificationResult = { status: "invalid" };
    const app = new Hono();
    app.route("/", createAuthRoutes(db, {
      managedAuthMode: "full",
      clerkVerifier: clerkVerifier(async () => {
        calls += 1;
        return result;
      }),
      managedRateLimits: {
        preVerification: 4,
        postVerification: 4,
        windowMs: 60_000,
      },
    }));

    const malformed = await app.request("/api/auth/managed/exchange", {
      method: "POST",
      body: "{",
    });
    expect(malformed.status).toBe(400);
    const oversized = await app.request("/api/auth/managed/exchange", {
      method: "POST",
      headers: { "content-length": "20000" },
      body: JSON.stringify({ token: "tiny" }),
    });
    expect(oversized.status).toBe(413);
    expect(calls).toBe(0);

    result = { status: "setup_incomplete" };
    expect((await managedRequest(app, "/api/auth/managed/exchange", {
      token: "pending",
    })).status).toBe(409);
    result = { status: "locked" };
    expect((await managedRequest(app, "/api/auth/managed/exchange", {
      token: "locked",
    })).status).toBe(423);
    result = {
      status: "profile_unavailable",
    };
    expect((await managedRequest(app, "/api/auth/managed/exchange", {
      token: "timeout",
    })).status).toBe(503);

    result = { status: "invalid" };
    expect((await managedRequest(app, "/api/auth/managed/exchange", {
      token: "one-more",
    })).status).toBe(401);
    const limited = await managedRequest(app, "/api/auth/managed/exchange", {
      token: "limited",
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(calls).toBe(4);
    expect(await db.select().from(schema.users)).toHaveLength(0);
  });
});

async function assignRoles(db: DrizzleDB, walletAddress: string, roleNames: string[]): Promise<void> {
  const roles = await db
    .select({ id: schema.roles.id, name: schema.roles.name })
    .from(schema.roles)
    .where(inArray(schema.roles.name, roleNames));
  await db.insert(schema.addressRoles).values(roles.map((role) => ({
    walletAddress: walletAddress.toLowerCase(),
    roleId: role.id,
    grantedBy: "test",
  })));
}

function clerkVerifier(
  verify: (token: string) => Promise<ProviderVerificationResult>,
): ClerkAuthenticationProviderVerifier {
  return { provider: "clerk", verify };
}

function verifiedClerk(
  subject: string,
  normalizedEmail: string,
): ProviderVerificationResult {
  return {
    status: "verified",
    evidence: {
      provider: "clerk",
      subject,
      owner: { kind: "email", normalizedEmail },
      productWalletAddress: null,
    },
  };
}

async function managedRequest(
  app: Hono,
  path: string,
  body: Record<string, unknown>,
  influenceToken?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": "203.0.113.10",
  };
  if (influenceToken) headers.authorization = `Bearer ${influenceToken}`;
  return app.request(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function issueProducerMcpToken(
  db: DrizzleDB,
  user: { userId: string; walletAddress: string },
): Promise<string> {
  const redirectUri = "http://127.0.0.1:49111/oauth/callback";
  const state = "test-state";
  const codeVerifier = "test-code-verifier";
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const authorization = await authorizeMcpOAuth(db, {
    id: user.userId,
    walletAddress: user.walletAddress,
    displayName: "Producer CLI",
  }, {
    client_id: MCP_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "producer",
    selected_scope: "producer",
    resource: "http://127.0.0.1:3000/mcp",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    decision: "approve",
  });
  expect(authorization.status).toBe(200);
  const redirectTo = (authorization.body as { redirectTo: string }).redirectTo;
  const code = new URL(redirectTo).searchParams.get("code");
  expect(code).toBeTruthy();

  const token = await exchangeMcpOAuthCode(db, {
    grant_type: "authorization_code",
    client_id: MCP_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    resource: "http://127.0.0.1:3000/mcp",
    code: code!,
    code_verifier: codeVerifier,
  });
  expect(token.status).toBe(200);
  return (token.body as { access_token: string }).access_token;
}

// ---------------------------------------------------------------------------
// requireRole middleware
// ---------------------------------------------------------------------------

describe("requireRole middleware", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupDB();
  });

  test("blocks user without required role", async () => {
    await db.insert(schema.users)
      .values({ id: "no-role", walletAddress: "0xnorole", displayName: "No Role" });

    const app = new Hono<AuthEnv>();
    app.use("/*", requireAuth(db), requireRole("sysop"));
    app.get("/test", (c) => c.json({ ok: true }));

    const token = await createSessionToken("no-role", {
      roles: ["player"],
      permissions: ["join_game"],
    });
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  test("allows user with matching role", async () => {
    await db.insert(schema.users)
      .values({ id: "sysop-user", walletAddress: "0xsysop", displayName: "Sysop" });

    const app = new Hono<AuthEnv>();
    app.use("/*", requireAuth(db), requireRole("sysop"));
    app.get("/test", (c) => c.json({ ok: true }));

    const token = await createSessionToken("sysop-user", {
      roles: ["sysop"],
      permissions: ["manage_roles"],
    });
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// requireAdmin middleware (backward compatibility)
// ---------------------------------------------------------------------------

describe("requireAdmin middleware", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupDB();
  });

  test("blocks non-admin user without RBAC roles", async () => {
    await db.insert(schema.users)
      .values({
        id: "regular-user",
        walletAddress: "0xregularwallet",
        displayName: "Regular",
      });

    const app = new Hono<AuthEnv>();
    app.use("/*", requireAuth(db), requireAdmin());
    app.get("/admin", (c) => c.json({ ok: true }));

    const token = await createSessionToken("regular-user");
    const res = await app.request("/admin", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  test("allows admin user via RBAC permissions", async () => {
    await db.insert(schema.users)
      .values({
        id: "admin-user",
        walletAddress: TEST_ADMIN_ADDRESS,
        displayName: "Admin",
      });

    const app = new Hono<AuthEnv>();
    app.use("/*", requireAuth(db), requireAdmin());
    app.get("/admin", (c) => c.json({ ok: true }));

    const token = await createSessionToken("admin-user", {
      roles: ["sysop"],
      permissions: ["manage_roles", "view_admin"],
    });
    const res = await app.request("/admin", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  test("allows admin via legacy ADMIN_ADDRESS fallback", async () => {
    await db.insert(schema.users)
      .values({
        id: "legacy-admin",
        walletAddress: TEST_ADMIN_ADDRESS,
        displayName: "Legacy Admin",
      });

    const app = new Hono<AuthEnv>();
    app.use("/*", requireAuth(db), requireAdmin());
    app.get("/admin", (c) => c.json({ ok: true }));

    // Token without RBAC roles — falls back to ADMIN_ADDRESS check
    const token = await createSessionToken("legacy-admin");
    const res = await app.request("/admin", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  test("admin check is case-insensitive for legacy fallback", async () => {
    await db.insert(schema.users)
      .values({
        id: "admin-mixed",
        walletAddress: TEST_ADMIN_ADDRESS.toUpperCase(),
        displayName: "Admin",
      });

    const app = new Hono<AuthEnv>();
    app.use("/*", requireAuth(db), requireAdmin());
    app.get("/admin", (c) => c.json({ ok: true }));

    const token = await createSessionToken("admin-mixed");
    const res = await app.request("/admin", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  test("blocks user without wallet address", async () => {
    await db.insert(schema.users)
      .values({
        id: "email-only",
        email: "nope@test.com",
        displayName: "Email Only",
      });

    const app = new Hono<AuthEnv>();
    app.use("/*", requireAuth(db), requireAdmin());
    app.get("/admin", (c) => c.json({ ok: true }));

    const token = await createSessionToken("email-only");
    const res = await app.request("/admin", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// optionalAuth middleware
// ---------------------------------------------------------------------------

describe("optionalAuth middleware", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupDB();
  });

  test("continues without auth header", async () => {
    const app = new Hono<AuthEnv>();
    app.use("/*", optionalAuth(db));
    app.get("/test", (c) => {
      const user = c.get("user");
      return c.json({ hasUser: !!user });
    });

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hasUser: boolean };
    expect(body.hasUser).toBe(false);
  });

  test("attaches user when valid token provided", async () => {
    await db.insert(schema.users)
      .values({
        id: "opt-user",
        walletAddress: "0xopt",
        email: "optional@example.test",
        displayName: "Optional",
      });

    const app = new Hono<AuthEnv>();
    app.use("/*", optionalAuth(db));
    app.get("/test", (c) => {
      const user = c.get("user");
      return c.json({ hasUser: !!user, user });
    });

    const token = await createSessionToken("opt-user");
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hasUser: boolean; user: AuthUser };
    expect(body.hasUser).toBe(true);
    expect(body.user).toEqual({
      id: "opt-user",
      walletAddress: "0xopt",
      displayName: "Optional",
    });
    expect(body.user).not.toHaveProperty("email");
  });

  test("continues without user for invalid token", async () => {
    const app = new Hono<AuthEnv>();
    app.use("/*", optionalAuth(db));
    app.get("/test", (c) => {
      const user = c.get("user");
      return c.json({ hasUser: !!user });
    });

    const res = await app.request("/test", {
      headers: { Authorization: "Bearer bad-token" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hasUser: boolean };
    expect(body.hasUser).toBe(false);
  });
});
