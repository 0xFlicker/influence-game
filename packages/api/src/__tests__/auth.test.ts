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
} from "../middleware/auth.js";
import { createAuthRoutes } from "../routes/auth.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { setupTestDB } from "./test-utils.js";
import {
  authorizeMcpOAuth,
  exchangeMcpOAuthCode,
  MCP_OAUTH_CLIENT_ID,
} from "../services/mcp-oauth.js";

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
      return c.json({ userId: user.id, wallet: user.walletAddress });
    });

    const token = await createSessionToken("real-user");
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; wallet: string };
    expect(body.userId).toBe("real-user");
    expect(body.wallet).toBe("0xabc");
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
    expect(body.user.walletAddress).toBe(walletAddress);
    expect(body.user.publicId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.user.displayName).toBe("Anonymous");
    expect(body.user.publicIdentityOnboarding.state).toBe("required");
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
    email: null,
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
        displayName: "Optional",
      });

    const app = new Hono<AuthEnv>();
    app.use("/*", optionalAuth(db));
    app.get("/test", (c) => {
      const user = c.get("user");
      return c.json({ hasUser: !!user, userId: user?.id });
    });

    const token = await createSessionToken("opt-user");
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hasUser: boolean; userId: string };
    expect(body.hasUser).toBe(true);
    expect(body.userId).toBe("opt-user");
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
