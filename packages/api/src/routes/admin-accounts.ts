import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { schema, type DrizzleDB } from "../db/index.js";
import { getPermissionsForUser } from "../db/rbac.js";
import { containsEmailLike } from "../lib/display-name.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import { isUuidShapedPublicIdentity } from "../lib/public-player-identity.js";
import { hashAccountEmail } from "../lib/verified-email.js";
import { requirePermission, requireRole, type AuthEnv } from "../middleware/auth.js";
import { countSysops, deleteAccountInTransaction } from "../services/account-deletion.js";
import { parseHistoryCursor, readHouseParticipationPage } from "../services/house-participation.js";
import { changeSignupRate, createSignupCampaign, signupAvailability } from "../services/signup-admission.js";

const operator = requireRole("admin", "sysop");
const ZERO_WALLET = "0x0000000000000000000000000000000000000000";

function accountName(name: string | null) {
  return containsEmailLike(name) ? null : name?.trim() || null;
}

export function createAdminAccountRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  app.onError((_error, c) => {
    console.error("[admin-accounts] Request failed");
    return c.json({ error: "Account administration is temporarily unavailable." }, 500);
  });
  app.use("/api/admin/accounts/*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });

  app.post("/api/admin/accounts/lookup", operator, async c => {
    const body = await parseJsonBody(c, "account lookup");
    if (typeof body?.email !== "string" || body.email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(body.email.trim())) {
      return c.json({ error: "Enter a complete email address." }, 400);
    }
    const hash = hashAccountEmail(body.email);
    const matches = await db.execute<{ public_id: string | null; conflict: boolean }>(sql`
      SELECT u.public_id, false AS conflict FROM users u
      WHERE u.legacy_email_hash = ${hash} AND u.deleted_at IS NULL
      UNION
      SELECT u.public_id, c.state = 'conflict'
      FROM verified_email_claims c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.email_hash = ${hash} AND (c.state = 'conflict' OR (u.id IS NOT NULL AND u.deleted_at IS NULL))
      LIMIT 2`);
    if (matches.length > 1 || matches.some(row => row.conflict)) {
      return c.json({ error: "This address matches conflicting account records." }, 409);
    }
    const match = matches[0]?.public_id;
    if (!match) return c.json({ error: "No account matches that email." }, 404);
    return c.json({ publicId: match });
  });

  app.get("/api/admin/accounts/:publicId", operator, async c => {
    const publicId = c.req.param("publicId");
    if (!isUuidShapedPublicIdentity(publicId)) return c.json({ error: "Account not found." }, 404);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.publicId, publicId));
    if (!user) return c.json({ error: "Account not found." }, 404);
    const [{ roles }, providers, agents, services] = await Promise.all([
      getPermissionsForUser(db, user.id),
      db.selectDistinct({ provider: schema.authenticationCredentials.provider }).from(schema.authenticationCredentials)
        .where(and(eq(schema.authenticationCredentials.userId, user.id), isNull(schema.authenticationCredentials.retiredAt))),
      db.select({ id: schema.agentProfiles.id, name: schema.agentProfiles.name, archivedAt: schema.agentProfiles.archivedAt })
        .from(schema.agentProfiles).where(eq(schema.agentProfiles.userId, user.id)).orderBy(schema.agentProfiles.name),
      db.select({ id: schema.servicePrincipals.userId }).from(schema.servicePrincipals).where(eq(schema.servicePrincipals.userId, user.id)),
    ]);
    const name = accountName(user.displayName);
    const privileged = roles.includes("admin") || roles.includes("sysop");
    const sysop = c.get("userRoles").includes("sysop");
    const lastSysop = roles.includes("sysop") && await countSysops(db) <= 1;
    return c.json({
      publicId, name, handle: user.handle, createdAt: user.createdAt, deletedAt: user.deletedAt,
      roles, providers: providers.map(item => item.provider), agents,
      confirmationName: name ?? user.handle ?? publicId,
      canDelete: !user.deletedAt && !services.length && user.walletAddress?.toLowerCase() !== ZERO_WALLET && !lastSysop && (!privileged || sysop),
    });
  });

  app.get("/api/admin/accounts/:publicId/games", operator, async c => {
    const publicId = c.req.param("publicId");
    if (!isUuidShapedPublicIdentity(publicId)) return c.json({ error: "Account not found." }, 404);
    const raw = c.req.query("cursor");
    const cursor = raw ? parseHistoryCursor(raw) : null;
    if (raw && !cursor) return c.json({ error: "Invalid games cursor." }, 400);
    const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.publicId, publicId));
    if (!user) return c.json({ error: "Account not found." }, 404);
    return c.json(await readHouseParticipationPage(db, user.id, 20, cursor));
  });

  app.post("/api/admin/accounts/:publicId/deletion", operator, async c => {
    const publicId = c.req.param("publicId");
    if (!isUuidShapedPublicIdentity(publicId)) return c.json({ error: "Account not found." }, 404);
    const body = await parseJsonBody(c, "account deletion");
    if (typeof body?.confirmation !== "string") return c.json({ error: "Enter the displayed account name." }, 400);
    const actorId = c.get("user").id;
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('influence:role-management', 0))`);
      const [user] = await tx.select().from(schema.users).where(eq(schema.users.publicId, publicId)).for("no key update");
      if (!user) return c.json({ error: "Account not found." }, 404);
      const actor = await getPermissionsForUser(tx, actorId);
      const sysop = actor.roles.includes("sysop");
      if (!sysop && !actor.roles.includes("admin")) return c.json({ error: "Insufficient role." }, 403);
      if (user.deletedAt) return c.json({ error: "This account is already closed." }, 409);
      const { roles } = await getPermissionsForUser(tx, user.id);
      if ((!sysop && (roles.includes("sysop") || roles.includes("admin")))
        || (roles.includes("sysop") && await countSysops(tx) <= 1)) {
        return c.json({ error: "This operator account is protected." }, 403);
      }
      const [service] = await tx.select({ id: schema.servicePrincipals.userId }).from(schema.servicePrincipals)
        .where(eq(schema.servicePrincipals.userId, user.id));
      if (service || user.walletAddress?.toLowerCase() === ZERO_WALLET) return c.json({ error: "Service accounts are protected." }, 403);
      if (body.confirmation !== (accountName(user.displayName) ?? user.handle ?? publicId)) {
        return c.json({ error: "The confirmation does not match the current account name. Reload the page and try again." }, 409);
      }
      const removed = await deleteAccountInTransaction(tx, user.id, actorId);
      return c.json({ ...removed, status: "deleted", providerCleanup: "pending" }, 202);
    });
  });

  app.get("/api/admin/signup-settings", operator, async c => c.json(await signupAvailability(db)));
  app.patch("/api/admin/signup-settings", operator, async c => {
    const body = await parseJsonBody(c, "signup settings");
    if (!Number.isSafeInteger(body?.rate) || body.rate < 1) {
      return c.json({ error: "Enter a positive whole-number rate." }, 400);
    }
    return c.json(await changeSignupRate(db, body.rate));
  });
  app.get("/api/admin/signup-campaigns", requirePermission("manage_invites"), async c => {
    const { id, label, startsAt, endsAt, closedAt } = schema.signupCampaigns;
    return c.json(await db.select({ id, label, startsAt, endsAt, closedAt }).from(schema.signupCampaigns).orderBy(startsAt));
  });
  app.post("/api/admin/signup-campaigns", requirePermission("manage_invites"), async c => {
    const body = await parseJsonBody(c, "signup campaign");
    const label = typeof body?.label === "string" ? body.label.trim() : "";
    const start = new Date(typeof body?.startsAt === "string" ? body.startsAt : "");
    const end = new Date(typeof body?.endsAt === "string" ? body.endsAt : "");
    if (!label || label.length > 100 || containsEmailLike(label) || !(start < end) || end.getTime() <= Date.now()) {
      return c.json({ error: "Enter a campaign name and an active or future date range." }, 400);
    }
    c.header("Cache-Control", "private, no-store");
    return c.json(await createSignupCampaign(db, label, start, end), 201);
  });
  app.post("/api/admin/signup-campaigns/:id/close", requirePermission("manage_invites"), async c => {
    const id = c.req.param("id");
    if (!isUuidShapedPublicIdentity(id)) return c.json({ error: "Campaign not found." }, 404);
    const [campaign] = await db.update(schema.signupCampaigns).set({ closedAt: sql`coalesce(closed_at, clock_timestamp())` })
      .where(eq(schema.signupCampaigns.id, id)).returning({ id: schema.signupCampaigns.id });
    return campaign ? c.json({ closed: true }) : c.json({ error: "Campaign not found." }, 404);
  });
  return app;
}
