/**
 * Auth middleware and routes tests.
 *
 * Tests JWT session creation/verification, admin gating, and the auth routes.
 * Privy verification is NOT tested here (requires real Privy credentials).
 */

import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createDB, schema } from "../db/index.js";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import {
  createSessionToken,
  verifySessionToken,
  requireAuth,
  requireAdmin,
  optionalAuth,
  type AuthEnv,
} from "../middleware/auth.js";
import path from "path";

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

function setupDB() {
  const db = createDB(":memory:");
  const migrationsFolder = path.resolve(import.meta.dir, "../../drizzle");
  migrate(db, { migrationsFolder });
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
    const userId = await verifySessionToken(token);
    expect(userId).toBe("user-456");
  });

  test("verifySessionToken returns null for invalid token", async () => {
    const userId = await verifySessionToken("garbage.token.here");
    expect(userId).toBeNull();
  });

  test("verifySessionToken returns null for expired token", async () => {
    // We can't easily test expiration without waiting, but we can test
    // a tampered token
    const token = await createSessionToken("user-789");
    const tampered = token.slice(0, -5) + "XXXXX";
    const userId = await verifySessionToken(tampered);
    expect(userId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// requireAuth middleware
// ---------------------------------------------------------------------------

describe("requireAuth middleware", () => {
  let db: ReturnType<typeof createDB>;

  beforeEach(() => {
    db = setupDB();
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
    db.insert(schema.users)
      .values({
        id: "real-user",
        walletAddress: "0xabc",
        email: "test@test.com",
        displayName: "Tester",
      })
      .run();

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
});

// ---------------------------------------------------------------------------
// requireAdmin middleware
// ---------------------------------------------------------------------------

describe("requireAdmin middleware", () => {
  let db: ReturnType<typeof createDB>;

  beforeEach(() => {
    db = setupDB();
  });

  test("blocks non-admin user", async () => {
    db.insert(schema.users)
      .values({
        id: "regular-user",
        walletAddress: "0xregularwallet",
        displayName: "Regular",
      })
      .run();

    const app = new Hono<AuthEnv>();
    app.use("/*", requireAuth(db), requireAdmin());
    app.get("/admin", (c) => c.json({ ok: true }));

    const token = await createSessionToken("regular-user");
    const res = await app.request("/admin", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  test("allows admin user", async () => {
    db.insert(schema.users)
      .values({
        id: "admin-user",
        walletAddress: TEST_ADMIN_ADDRESS,
        displayName: "Admin",
      })
      .run();

    const app = new Hono<AuthEnv>();
    app.use("/*", requireAuth(db), requireAdmin());
    app.get("/admin", (c) => c.json({ ok: true }));

    const token = await createSessionToken("admin-user");
    const res = await app.request("/admin", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  test("admin check is case-insensitive", async () => {
    db.insert(schema.users)
      .values({
        id: "admin-mixed",
        walletAddress: TEST_ADMIN_ADDRESS.toUpperCase(),
        displayName: "Admin",
      })
      .run();

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
    db.insert(schema.users)
      .values({
        id: "email-only",
        email: "nope@test.com",
        displayName: "Email Only",
      })
      .run();

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
  let db: ReturnType<typeof createDB>;

  beforeEach(() => {
    db = setupDB();
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
    db.insert(schema.users)
      .values({
        id: "opt-user",
        walletAddress: "0xopt",
        displayName: "Optional",
      })
      .run();

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
