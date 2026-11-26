import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { schema } from "../db/index.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { createSessionToken } from "../middleware/auth.js";
import { hashAccountEmail } from "../lib/verified-email.js";
import { createAdminRoutes } from "../routes/admin.js";
import { createAuthRoutes } from "../routes/auth.js";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "../services/legal-acceptance.js";
import { setupTestDB } from "./test-utils.js";

test("operators find a unique hashed email and close only the confirmed eligible account", async () => {
  const db = await setupTestDB();
  process.env.JWT_SECRET = "operator-account-support-test";
  await seedRBAC(db);
  const email = "target+tag@example.test";
  const hash = hashAccountEmail(email);
  const rows = await db.insert(schema.users).values([
    { id: "admin", displayName: "Admin" },
    { id: "sysop", displayName: "Sysop" },
    { id: "target", displayName: "Exact Name", legacyEmailHash: hash },
    { id: "player", displayName: "Player" },
  ]).returning();
  for (const name of ["admin", "sysop"]) {
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, name));
    await db.insert(schema.userRoles).values({ userId: name, roleId: role!.id });
  }
  await db.insert(schema.verifiedEmailClaims).values({ emailHash: hash, userId: "target", state: "active" });
  const app = new Hono().route("/", createAdminRoutes(db)).route("/", createAuthRoutes(db, { managedAuthMode: "disabled" }));
  const auth = async (id: string) => ({
    Authorization: `Bearer ${await createSessionToken(id, { legalAcceptance: {
      termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION,
    } })}`, "Content-Type": "application/json",
  });
  const headers = await auth("admin");
  const lookup = (emailAddress: string, authHeaders = headers) => app.request("/api/admin/accounts/lookup", {
    method: "POST", headers: authHeaders, body: JSON.stringify({ email: emailAddress }),
  });
  expect((await lookup(email, await auth("player"))).status).toBe(403);
  expect((await lookup("target@example.test")).status).toBe(404);
  const publicId = rows.find(row => row.id === "target")!.publicId;
  expect(await (await lookup(" TARGET+TAG@Example.Test ")).json()).toEqual({ publicId });
  await db.update(schema.users).set({ legacyEmailHash: hash }).where(eq(schema.users.id, "player"));
  expect((await lookup(email)).status).toBe(409);
  await db.update(schema.users).set({ legacyEmailHash: null }).where(eq(schema.users.id, "player"));

  const path = `/api/admin/accounts/${publicId}`;
  const detail = await app.request(path, { headers });
  expect(detail.status).toBe(200);
  const content = await detail.text();
  expect(content).not.toContain(email);
  expect(content).not.toContain(hash);
  const remove = (id: string, confirmation: string, authHeaders = headers) => app.request(`/api/admin/accounts/${id}/deletion`, {
    method: "POST", headers: authHeaders, body: JSON.stringify({ confirmation }),
  });
  expect((await remove(publicId, "exact name")).status).toBe(409);
  const sysopId = rows.find(row => row.id === "sysop")!.publicId;
  expect((await remove(sysopId, "Sysop")).status).toBe(403);
  expect((await remove(sysopId, "Sysop", await auth("sysop"))).status).toBe(403);
  expect((await app.request("/api/account", {
    method: "DELETE", headers: await auth("sysop"), body: JSON.stringify({ confirmation: "DELETE" }),
  })).status).toBe(403);
  expect((await remove(publicId, "Exact Name")).status).toBe(202);
  expect((await lookup(email)).status).toBe(404);
  const [closed] = await db.select().from(schema.users).where(eq(schema.users.id, "target"));
  expect(closed).toMatchObject({ deletedByUserId: "admin", legacyEmailHash: null });
});
