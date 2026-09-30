import { beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { SignJWT } from "jose";
import { schema, type DrizzleDB } from "../db/index.js";
import { seedRBAC, bootstrapSysop } from "../db/rbac-seed.js";
import { getPermissionsForUser, userHasRole } from "../db/rbac.js";
import { createSessionToken, requireAuth, requirePermission, requireServiceAuth, optionalAuth, type AuthEnv } from "../middleware/auth.js";
import { createAdminRoutes } from "../routes/admin.js";
import { issueInfluenceSession } from "../services/session-issuance.js";
import { hasCurrentProducerRoleForUserId } from "../services/mcp-oauth.js";
import { moderationAuthority } from "../services/moderation-intake.js";
import { setupTestDB } from "./test-utils.js";

let db: DrizzleDB, app: Hono<AuthEnv>, sysop: string, target: string, token: string;
const zero = "0x0000000000000000000000000000000000000000";
beforeEach(async () => {
  process.env.JWT_SECRET = "account-rbac-regression";
  db = await setupTestDB(); await seedRBAC(db);
  sysop = randomUUID(); target = randomUUID();
  await db.insert(schema.users).values([{ id: sysop }, { id: target, email: "walletless@example.test" }]);
  await grant(sysop, "sysop"); token = await createSessionToken(sysop);
  app = new Hono<AuthEnv>().route("/", createAdminRoutes(db));
  app.get("/human", requireAuth(db), requirePermission("create_game"), c => c.json({ ok: true }));
  app.get("/optional", optionalAuth(db), c => c.json({ permissions: c.get("userPermissions") ?? [] }));
  app.post("/queue", requireServiceAuth(db), requirePermission("schedule_free_game"), c => c.json({ permissions: c.get("userPermissions"), roles: c.get("userRoles") }));
});
async function grant(userId: string, name: string) {
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, name));
  await db.insert(schema.userRoles).values({ userId, roleId: role!.id }); return role!.id;
}
function request(method: string, body: unknown, bearer = token) {
  return app.request("/api/admin/user-roles", { method, headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function headers(bearer: string) { return { Authorization: `Bearer ${bearer}` }; }

test("walletless account can receive an existing least-privilege role and immediately use it", async () => {
  await db.insert(schema.authenticationCredentials).values({ userId: target, provider: "clerk", providerSubject: "clerk-walletless" });
  const [gamer] = await db.select().from(schema.roles).where(eq(schema.roles.name, "gamer"));
  const oldToken = await createSessionToken(target);
  const response = await request("POST", { userId: target, roleId: gamer!.id });
  expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ userId: target, grantedBy: sysop });
  expect((await request("POST", { userId: target, roleId: gamer!.id })).status).toBe(409);
  expect((await app.request("/human", { headers: headers(oldToken) })).status).toBe(200);
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, target));
  const session = await issueInfluenceSession(db, user!);
  expect(session.user.roles).toEqual(["gamer"]); expect(session.user.permissions.sort()).toEqual(["create_game", "fill_game", "start_game"]);
  expect(session.user.loginMethods.emailPassword).toBe(true);
  expect((await request("POST", { userId: sysop, roleId: gamer!.id }, oldToken)).status).toBe(403);
  expect((await request("DELETE", { userId: target, roleId: gamer!.id })).status).toBe(200);
  expect((await app.request("/human", { headers: headers(session.token) })).status).toBe(403);
  expect(await (await app.request("/optional", { headers: headers(session.token) })).json()).toEqual({ permissions: [] });
});

test("credential links and wallet changes do not transfer or lose account grants", async () => {
  await grant(target, "producer");
  await db.insert(schema.authenticationCredentials).values([{ userId: target, provider: "clerk", providerSubject: "clerk-linked" }, { userId: target, provider: "privy", providerSubject: "privy-linked" }]);
  await db.update(schema.users).set({ walletAddress: "0xformer" }).where(eq(schema.users.id, target));
  await db.update(schema.users).set({ walletAddress: null }).where(eq(schema.users.id, target));
  await db.insert(schema.users).values({ id: "replacement", walletAddress: "0xformer" });
  expect(await hasCurrentProducerRoleForUserId(db, target)).toBe(true);
  expect(await userHasRole(db, "replacement", "producer")).toBe(false);
  await grant(target, "moderator"); expect(await moderationAuthority(db, target)).toEqual({ canEscalateReview: false, canUndo: false });
});

test("rejects invalid targets, forged role claims, and the last sysop revoke", async () => {
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "sysop"));
  expect((await request("POST", { userId: "missing", roleId: role!.id })).status).toBe(404);
  expect((await request("POST", { walletAddress: zero, roleId: role!.id })).status).toBe(400);
  expect((await request("POST", { userId: target, roleId: "missing" })).status).toBe(404);
  const forged = await createSessionToken(target, { roles: ["sysop"], permissions: ["manage_roles"] });
  expect((await request("POST", { userId: target, roleId: role!.id }, forged)).status).toBe(403);
  expect((await request("DELETE", { userId: sysop, roleId: role!.id })).status).toBe(403);
});

test("serializes competing sysop revokes and refuses an old granter token after revocation", async () => {
  const roleId = await grant(target, "sysop"); const secondToken = await createSessionToken(target);
  const responses = await Promise.all([request("DELETE", { userId: target, roleId }, token), request("DELETE", { userId: sysop, roleId }, secondToken)]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 403]);
  expect(await db.select().from(schema.userRoles).where(eq(schema.userRoles.roleId, roleId))).toHaveLength(1);
  const revoked = (await getPermissionsForUser(db, sysop)).roles.length ? secondToken : token;
  expect((await request("POST", { userId: target, roleId }, revoked)).status).toBe(403);
});

test("legacy scheduler token is restricted by explicit principal state and signed scope", async () => {
  const scheduler = randomUUID(); await db.insert(schema.users).values({ id: scheduler, walletAddress: zero });
  const legacy = await createSessionToken(scheduler, { permissions: ["schedule_free_game", "manage_roles", "create_game"], roles: ["sysop"], legalAcceptance: null });
  expect((await app.request("/queue", { method: "POST", headers: headers(legacy) })).status).toBe(403); // zero alone is not authority
  await db.insert(schema.servicePrincipals).values({ userId: scheduler });
  const accepted = await app.request("/queue", { method: "POST", headers: headers(legacy) });
  expect(accepted.status).toBe(200); expect(await accepted.json()).toEqual({ permissions: ["schedule_free_game"], roles: [] });
  expect((await app.request("/human", { headers: headers(legacy) })).status).toBe(403);
  expect((await app.request("/api/admin/users", { headers: headers(legacy) })).status).toBe(403);
  const [gamer] = await db.select().from(schema.roles).where(eq(schema.roles.name, "gamer"));
  expect((await request("POST", { userId: scheduler, roleId: gamer!.id })).status).toBe(400);
  expect(await (await app.request("/optional", { headers: headers(legacy) })).json()).toEqual({ permissions: [] });
  const noScope = await createSessionToken(scheduler);
  expect((await app.request("/queue", { method: "POST", headers: headers(noScope) })).status).toBe(403);
  const wrongIssuer = await new SignJWT({ sub: scheduler, perms: ["schedule_free_game"] }).setProtectedHeader({ alg: "HS256" }).setIssuer("other").setExpirationTime("1h").sign(new TextEncoder().encode(process.env.JWT_SECRET));
  expect((await app.request("/queue", { method: "POST", headers: headers(wrongIssuer) })).status).toBe(401);
  const malformed = await new SignJWT({ sub: scheduler, perms: "schedule_free_game" }).setProtectedHeader({ alg: "HS256" }).setIssuer("influence-api").setExpirationTime("1h").sign(new TextEncoder().encode(process.env.JWT_SECRET));
  expect((await app.request("/queue", { method: "POST", headers: headers(malformed) })).status).toBe(401);
  const expired = await new SignJWT({ sub: scheduler, perms: ["schedule_free_game"] }).setProtectedHeader({ alg: "HS256" }).setIssuer("influence-api").setExpirationTime(1).sign(new TextEncoder().encode(process.env.JWT_SECRET));
  expect((await app.request("/queue", { method: "POST", headers: headers(expired) })).status).toBe(401);
  const unsigned = legacy.slice(0, legacy.lastIndexOf(".") + 1) + "invalid";
  expect((await app.request("/queue", { method: "POST", headers: headers(unsigned) })).status).toBe(401);
  await db.update(schema.servicePrincipals).set({ enabled: false }).where(eq(schema.servicePrincipals.userId, scheduler));
  expect((await app.request("/queue", { method: "POST", headers: headers(legacy) })).status).toBe(403);
});

test("migration discovers account grants, preserves unmatched/ambiguous rows and classifies existing scheduler", async () => {
  const migration = await Bun.file(new URL("../../drizzle/0103_account_roles.sql", import.meta.url)).text();
  await db.transaction(async tx => {
    await tx.execute(sql`CREATE SCHEMA rbac_migration_fixture`);
    await tx.execute(sql`SET LOCAL search_path TO rbac_migration_fixture`);
    await tx.execute(sql`CREATE TABLE users (id text PRIMARY KEY, wallet_address text UNIQUE)`);
    await tx.execute(sql`CREATE TABLE roles (id text PRIMARY KEY)`);
    await tx.execute(sql`CREATE TABLE address_roles (wallet_address text, role_id text, granted_by text, granted_at text)`);
    await tx.execute(sql`INSERT INTO users VALUES ('owner','0xAbC'), ('granter','0xdef'), ('scheduler',${zero}), ('ambiguous1','0xCASE'), ('ambiguous2','0xcase')`);
    await tx.execute(sql`INSERT INTO roles VALUES ('gamer')`);
    await tx.execute(sql`INSERT INTO address_roles VALUES ('0xabc','gamer','0xdef','original-time'), ('0xmissing','gamer','system','unmatched-time'), (${zero},'gamer','system','scheduler-time'), ('0xcase','gamer','system','ambiguous-time')`);
    for (const statement of migration.split('--> statement-breakpoint')) await tx.execute(sql.raw(statement));
    const grants = await tx.execute(sql`SELECT * FROM user_roles`);
    expect([...grants]).toEqual([{ user_id: "owner", role_id: "gamer", granted_by: "granter", granted_at: "original-time" }]);
    expect([...(await tx.execute(sql`SELECT * FROM service_principals`))]).toEqual([{ user_id: "scheduler", purpose: "free_queue", enabled: true }]);
    expect([...(await tx.execute(sql`SELECT * FROM address_roles`))]).toHaveLength(4);
    // Backfill retry is idempotent; Drizzle journals table creation transactionally.
    await tx.execute(sql.raw(migration.split('--> statement-breakpoint')[1]!));
    expect([...(await tx.execute(sql`SELECT * FROM user_roles`))]).toHaveLength(1);
    // Legacy mutations fail during overlap and rollback; savepoints keep the
    // fixture transaction usable after PostgreSQL rejects each statement.
    for (const mutation of [
      "INSERT INTO address_roles VALUES ('0xnew','gamer','system','later')",
      "UPDATE address_roles SET granted_by = 'changed'",
      "DELETE FROM address_roles",
    ]) {
      await expect(tx.transaction(async nested => {
        await nested.execute(sql.raw(mutation));
      })).rejects.toThrow();
    }
    await tx.execute(sql`DELETE FROM user_roles WHERE user_id = 'owner'`);
    expect([...(await tx.execute(sql`SELECT * FROM user_roles`))]).toHaveLength(0);
    expect([...(await tx.execute(sql`SELECT * FROM address_roles`))]).toHaveLength(4);
    await tx.execute(sql`DROP SCHEMA rbac_migration_fixture CASCADE`);
  });
});

test("bootstrap waits for a unique existing account and never restores a removed grant", async () => {
  const previous = process.env.ADMIN_ADDRESS;
  try {
    process.env.ADMIN_ADDRESS = "0xbootstrap";
    await db.delete(schema.userRoles); await db.delete(schema.appSettings).where(eq(schema.appSettings.key, "rbac_bootstrap_completed"));
    await bootstrapSysop(db); expect(await db.select().from(schema.userRoles)).toHaveLength(0);
    await db.update(schema.users).set({ walletAddress: "0xBOOTSTRAP" }).where(eq(schema.users.id, target));
    await bootstrapSysop(db); expect(await userHasRole(db, target, "sysop")).toBe(true);
    await db.delete(schema.userRoles); await bootstrapSysop(db);
    expect(await db.select().from(schema.userRoles)).toHaveLength(0);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_ADDRESS; else process.env.ADMIN_ADDRESS = previous;
  }
});
