import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import { setupTestDB } from "./test-utils.js";
import { grantTestAuthority } from "./rbac-fixtures.js";
import { schema, type DrizzleDB } from "../db/index.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { createSessionToken } from "../middleware/auth.js";
import { createAdminRoutes } from "../routes/admin.js";

describe("admin security boundaries", () => {
  let db: DrizzleDB;
  let token: string;
  let previousJwtSecret: string | undefined;
  beforeEach(async () => {
    previousJwtSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "admin-security-test-secret";
    db = await setupTestDB();
    await seedRBAC(db);
    await db.insert(schema.users).values({ id: "observer", displayName: "Observer" });
    token = await createSessionToken("observer");
  });

  afterEach(() => {
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
  });

  function request(path: string, method = "GET", body?: unknown) {
    return createAdminRoutes(db).request(path, {
      method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  test.each(["view_admin", "manage_roles"])("%s cannot mutate invites/imports or read codes; no state or outbound effects", async (permission) => {
    await grantTestAuthority(db, "observer", [permission]);
    const snapshot = async () => ({
      settings: await db.select().from(schema.appSettings), codes: await db.select().from(schema.inviteCodes),
      games: await db.select().from(schema.games), players: await db.select().from(schema.gamePlayers),
    });
    const before = await snapshot();
    const fetchSpy = spyOn(globalThis, "fetch");
    try {
      for (const [path, method, body] of [
        ["/api/admin/settings/invite", "PATCH", { inviteRequired: false }],
        ["/api/admin/invite-codes", "POST", { userId: "observer", count: 1 }],
        ["/api/admin/invite-codes/refill", "POST", { minCodes: 1 }],
        ["/api/admin/invite-codes", "GET", undefined],
        ["/api/admin/import-game", "POST", { version: 1, game: {}, players: [], transcripts: [] }],
        ["/api/admin/import-game", "POST", { sourceUrl: "https://source.example", slug: "game" }],
      ] as const) expect((await request(path, method, body)).status).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await snapshot()).toEqual(before);
      expect((await request("/api/admin/settings/invite")).status).toBe(200);
    } finally { fetchSpy.mockRestore(); }
  });

  test.each(["admin", "sysop", "delegated"])("%s receives explicit capabilities and revocation is immediate", async (role) => {
    if (role === "delegated") await grantTestAuthority(db, "observer", ["manage_invites", "manage_game_imports"]);
    else {
      const [row] = await db.select().from(schema.roles).where(eq(schema.roles.name, role));
      await db.insert(schema.userRoles).values({ userId: "observer", roleId: row!.id, grantedBy: "test" });
    }
    expect((await request("/api/admin/settings/invite", "PATCH", { inviteRequired: true })).status).toBe(200);
    expect((await request("/api/admin/invite-codes", "POST", { userId: "observer", count: 1 })).status).toBe(201);
    expect((await request("/api/admin/invite-codes/refill", "POST", { minCodes: 1 })).status).toBe(200);
    expect((await request("/api/admin/invite-codes")).status).toBe(200);
    // An invalid file reaches import validation, rather than authorization denial.
    expect((await request("/api/admin/import-game", "POST", {})).status).toBe(400);
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, "observer"));
    expect((await request("/api/admin/invite-codes")).status).toBe(403);
    expect((await request("/api/admin/import-game", "POST", {})).status).toBe(403);
  });

  test("delegating either capability does not grant the other", async () => {
    await grantTestAuthority(db, "observer", ["manage_invites"]);
    expect((await request("/api/admin/invite-codes")).status).toBe(200);
    expect((await request("/api/admin/settings/invite")).status).toBe(200);
    expect((await request("/api/admin/import-game", "POST", {})).status).toBe(403);
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, "observer"));
    await grantTestAuthority(db, "observer", ["manage_game_imports"]);
    expect((await request("/api/admin/import-game", "POST", {})).status).toBe(400);
    expect((await request("/api/admin/invite-codes")).status).toBe(403);
  });

  test("remote browse routes are absent and old remote import payloads cannot fetch", async () => {
    await grantTestAuthority(db, "observer", ["manage_game_imports"]);
    const fetchSpy = spyOn(globalThis, "fetch");
    try {
      expect((await request("/api/admin/remote-games?url=http://127.0.0.1")).status).toBe(404);
      expect((await request("/api/admin/import-source")).status).toBe(404);
      const response = await request("/api/admin/import-game", "POST", { sourceUrl: "http://127.0.0.1", slug: "game" });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Unsupported export version" });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await db.select().from(schema.games)).toHaveLength(0);
    } finally { fetchSpy.mockRestore(); }
  });
});
