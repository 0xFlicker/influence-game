import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { schema } from "../db/index.js";
import type { DrizzleDB } from "../db/index.js";
import { getPermissionsForAddress } from "../db/rbac.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { createSessionToken } from "../middleware/auth.js";
import { createAdminRoutes } from "../routes/admin.js";
import { setupTestDB } from "./test-utils.js";

const ADMIN_ADDRESS = "0xadmin000000000000000000000000000000000001";
const GAMER_ADDRESS = "0xgamer000000000000000000000000000000000001";
const SYSOP_ADDRESS = "0xsysop000000000000000000000000000000000001";

beforeAll(() => {
  process.env.JWT_SECRET = "test-jwt-secret-admin-routes";
  process.env.ADMIN_ADDRESS = SYSOP_ADDRESS;
});

async function setupDB() {
  const db = await setupTestDB();
  await seedRBAC(db);
  return db;
}

async function assignRole(
  db: DrizzleDB,
  walletAddress: string,
  roleName: string,
) {
  const role = (await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(sql`${schema.roles.name} = ${roleName}`))[0];

  if (!role) {
    throw new Error(`Missing seeded role: ${roleName}`);
  }

  await db.insert(schema.addressRoles).values({
    walletAddress: walletAddress.toLowerCase(),
    roleId: role.id,
    grantedBy: "test",
  });
}

async function createUser(
  db: DrizzleDB,
  walletAddress: string,
  displayName: string,
) {
  const userId = randomUUID();
  await db.insert(schema.users).values({
    id: userId,
    walletAddress: walletAddress.toLowerCase(),
    displayName,
  });
  return userId;
}

describe("gamer role seed", () => {
  test("resolves to create, fill, and start only", async () => {
    const db = await setupDB();
    await createUser(db, GAMER_ADDRESS, "Gamer");
    await assignRole(db, GAMER_ADDRESS, "gamer");

    const resolved = await getPermissionsForAddress(db, GAMER_ADDRESS);

    expect(resolved.roles).toEqual(["gamer"]);
    expect([...resolved.permissions].sort()).toEqual([
      "create_game",
      "fill_game",
      "start_game",
    ]);
    expect(resolved.permissions).not.toContain("stop_game");
    expect(resolved.permissions).not.toContain("manage_roles");
    expect(resolved.permissions).not.toContain("view_admin");
  });
});

describe("admin route RBAC", () => {
  let db: DrizzleDB;
  let app: Hono;
  let adminToken: string;
  let gamerToken: string;
  let sysopToken: string;

  beforeEach(async () => {
    db = await setupDB();

    const adminUserId = await createUser(db, ADMIN_ADDRESS, "Admin");
    const gamerUserId = await createUser(db, GAMER_ADDRESS, "Gamer");
    const sysopUserId = await createUser(db, SYSOP_ADDRESS, "Sysop");

    adminToken = await createSessionToken(adminUserId, {
      roles: ["admin"],
      permissions: [
        "create_game",
        "start_game",
        "stop_game",
        "fill_game",
        "view_admin",
        "schedule_free_game",
        "hide_game",
      ],
    });

    gamerToken = await createSessionToken(gamerUserId, {
      roles: ["gamer"],
      permissions: [
        "create_game",
        "start_game",
        "fill_game",
      ],
    });

    sysopToken = await createSessionToken(sysopUserId, {
      roles: ["sysop"],
      permissions: [
        "manage_roles",
        "create_game",
        "start_game",
        "join_game",
        "stop_game",
        "fill_game",
        "view_admin",
        "schedule_free_game",
        "hide_game",
      ],
    });

    app = new Hono();
    app.route("/", createAdminRoutes(db));
  });

  test("allows admin read routes without manage_roles", async () => {
    const res = await app.request("/api/admin/games", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
  });

  test("keeps role-management routes locked to manage_roles", async () => {
    const res = await app.request("/api/admin/roles", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(403);
  });

  test("does not grant gamer access to admin read routes", async () => {
    const res = await app.request("/api/admin/games", {
      headers: { Authorization: `Bearer ${gamerToken}` },
    });

    expect(res.status).toBe(403);
  });

  test("allows sysop to access role-management routes", async () => {
    const res = await app.request("/api/admin/roles", {
      headers: { Authorization: `Bearer ${sysopToken}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body.some((role) => role.name === "gamer")).toBeTrue();
  });
});
