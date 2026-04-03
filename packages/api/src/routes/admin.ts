/**
 * Admin routes for RBAC management.
 *
 * All endpoints require the `manage_roles` permission.
 *
 * GET    /api/admin/roles           — List all roles with their permissions
 * GET    /api/admin/permissions     — List all permissions
 * GET    /api/admin/address-roles   — List all address-role assignments
 * POST   /api/admin/address-roles   — Assign role to address
 * DELETE /api/admin/address-roles   — Revoke role from address
 * GET    /api/admin/users           — List all users with their resolved roles
 */

import { Hono } from "hono";
import { eq, sql, isNull, and } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { getPermissionsForAddress } from "../db/rbac.js";
import {
  requireAuth,
  requirePermission,
  type AuthEnv,
} from "../middleware/auth.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import { generateInviteCode } from "../lib/invite-codes.js";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAdminRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  // All admin routes require authentication + manage_roles permission
  app.use("/api/admin/*", requireAuth(db), requirePermission("manage_roles"));

  // -------------------------------------------------------------------------
  // GET /api/admin/roles — list all roles with their permissions
  // -------------------------------------------------------------------------

  app.get("/api/admin/roles", async (c) => {
    const allRoles = await db.select().from(schema.roles);

    const rolesWithPerms = await Promise.all(allRoles.map(async (role) => {
      const permRows = await db
        .select({ name: schema.permissions.name })
        .from(schema.rolePermissions)
        .innerJoin(
          schema.permissions,
          sql`${schema.rolePermissions.permissionId} = ${schema.permissions.id}`,
        )
        .where(sql`${schema.rolePermissions.roleId} = ${role.id}`);

      return {
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem === 1,
        permissions: permRows.map((p) => p.name),
        createdAt: role.createdAt,
      };
    }));

    return c.json(rolesWithPerms);
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/permissions — list all permissions
  // -------------------------------------------------------------------------

  app.get("/api/admin/permissions", async (c) => {
    const allPerms = await db.select().from(schema.permissions);
    return c.json(allPerms);
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/address-roles — list all address-role assignments
  // -------------------------------------------------------------------------

  app.get("/api/admin/address-roles", async (c) => {
    const assignments = await db
      .select({
        walletAddress: schema.addressRoles.walletAddress,
        roleId: schema.addressRoles.roleId,
        roleName: schema.roles.name,
        grantedBy: schema.addressRoles.grantedBy,
        grantedAt: schema.addressRoles.grantedAt,
      })
      .from(schema.addressRoles)
      .innerJoin(
        schema.roles,
        sql`${schema.addressRoles.roleId} = ${schema.roles.id}`,
      );

    return c.json(assignments);
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/address-roles — assign role to address
  // -------------------------------------------------------------------------

  app.post("/api/admin/address-roles", async (c) => {
    const body = await parseJsonBody(c, "POST /api/admin/address-roles");
    if (!body?.walletAddress || !body?.roleId) {
      return c.json(
        { error: "walletAddress and roleId are required" },
        400,
      );
    }

    const walletAddress = (body.walletAddress as string).toLowerCase();
    const roleId = body.roleId as string;

    // Verify role exists
    const role = (await db
      .select()
      .from(schema.roles)
      .where(sql`${schema.roles.id} = ${roleId}`))[0];

    if (!role) {
      return c.json({ error: "Role not found" }, 404);
    }

    // Check if already assigned
    const existing = (await db
      .select()
      .from(schema.addressRoles)
      .where(
        sql`${schema.addressRoles.walletAddress} = ${walletAddress} AND ${schema.addressRoles.roleId} = ${roleId}`,
      ))[0];

    if (existing) {
      return c.json({ error: "Role already assigned to this address" }, 409);
    }

    const granter = c.get("user");
    await db.insert(schema.addressRoles)
      .values({
        walletAddress,
        roleId,
        grantedBy: granter.walletAddress ?? granter.id,
      });

    return c.json({
      walletAddress,
      roleId,
      roleName: role.name,
      grantedBy: granter.walletAddress ?? granter.id,
    }, 201);
  });

  // -------------------------------------------------------------------------
  // DELETE /api/admin/address-roles — revoke role from address
  // -------------------------------------------------------------------------

  app.delete("/api/admin/address-roles", async (c) => {
    const body = await parseJsonBody(c, "DELETE /api/admin/address-roles");
    if (!body?.walletAddress || !body?.roleId) {
      return c.json(
        { error: "walletAddress and roleId are required" },
        400,
      );
    }

    const walletAddress = (body.walletAddress as string).toLowerCase();
    const roleId = body.roleId as string;

    // Sysop lockout protection: cannot revoke sysop from yourself if you're the last sysop
    const role = (await db
      .select()
      .from(schema.roles)
      .where(sql`${schema.roles.id} = ${roleId}`))[0];

    if (role?.name === "sysop") {
      const currentUser = c.get("user");
      const isSelf =
        currentUser.walletAddress?.toLowerCase() === walletAddress;

      if (isSelf) {
        // Count remaining sysops
        const sysopCount = (await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.addressRoles)
          .where(sql`${schema.addressRoles.roleId} = ${roleId}`))[0];

        if (sysopCount && sysopCount.count <= 1) {
          return c.json(
            { error: "Cannot revoke sysop role — you are the last sysop" },
            403,
          );
        }
      }
    }

    // Check if assignment exists
    const existing = (await db
      .select()
      .from(schema.addressRoles)
      .where(
        sql`${schema.addressRoles.walletAddress} = ${walletAddress} AND ${schema.addressRoles.roleId} = ${roleId}`,
      ))[0];

    if (!existing) {
      return c.json({ error: "Role assignment not found" }, 404);
    }

    // Delete the assignment
    await db.delete(schema.addressRoles)
      .where(
        sql`${schema.addressRoles.walletAddress} = ${walletAddress} AND ${schema.addressRoles.roleId} = ${roleId}`,
      );

    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/users — list all users with their resolved roles
  // -------------------------------------------------------------------------

  app.get("/api/admin/users", async (c) => {
    const allUsers = await db.select().from(schema.users);

    const usersWithRoles = await Promise.all(allUsers.map(async (user) => {
      const resolved = user.walletAddress
        ? await getPermissionsForAddress(db, user.walletAddress)
        : { roles: [], permissions: [] };

      return {
        id: user.id,
        walletAddress: user.walletAddress,
        email: user.email,
        displayName: user.displayName,
        roles: resolved.roles,
        permissions: resolved.permissions,
        createdAt: user.createdAt,
      };
    }));

    return c.json(usersWithRoles);
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/agents — list all agent profiles across all users
  // -------------------------------------------------------------------------

  app.get("/api/admin/agents", async (c) => {
    const profiles = await db
      .select({
        id: schema.agentProfiles.id,
        userId: schema.agentProfiles.userId,
        name: schema.agentProfiles.name,
        backstory: schema.agentProfiles.backstory,
        personality: schema.agentProfiles.personality,
        strategyStyle: schema.agentProfiles.strategyStyle,
        personaKey: schema.agentProfiles.personaKey,
        avatarUrl: schema.agentProfiles.avatarUrl,
        gamesPlayed: schema.agentProfiles.gamesPlayed,
        gamesWon: schema.agentProfiles.gamesWon,
        createdAt: schema.agentProfiles.createdAt,
        updatedAt: schema.agentProfiles.updatedAt,
        ownerWallet: schema.users.walletAddress,
        ownerDisplayName: schema.users.displayName,
        ownerEmail: schema.users.email,
      })
      .from(schema.agentProfiles)
      .innerJoin(schema.users, sql`${schema.agentProfiles.userId} = ${schema.users.id}`);

    return c.json(profiles);
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/games — list all games including hidden ones
  // -------------------------------------------------------------------------

  app.get("/api/admin/games", async (c) => {
    const rows = await db.select().from(schema.games);

    const summaries = await Promise.all(rows.map(async (game) => {
      const config = JSON.parse(game.config);
      const players = await db
        .select()
        .from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.gameId, game.id));

      const result = await db
        .select()
        .from(schema.gameResults)
        .where(eq(schema.gameResults.gameId, game.id));

      const winnerPlayer = result[0]?.winnerId
        ? players.find((p) => p.id === result[0]!.winnerId)
        : null;
      const winnerPersona = winnerPlayer
        ? JSON.parse(winnerPlayer.persona)
        : null;

      return {
        id: game.id,
        slug: game.slug ?? undefined,
        gameNumber: 0, // populated below
        status: game.status,
        playerCount: players.length,
        currentRound: 0,
        maxRounds: config.maxRounds ?? 10,
        currentPhase: game.status === "completed" ? "END" : "INIT",
        phaseTimeRemaining: null,
        alivePlayers: players.length,
        eliminatedPlayers: 0,
        modelTier: config.modelTier ?? "budget",
        visibility: config.visibility ?? "public",
        viewerMode: config.viewerMode ?? "speedrun",
        trackType: game.trackType,
        winner: winnerPersona?.name ?? undefined,
        winnerPersona: winnerPersona?.personality ?? undefined,
        errorInfo: config.errorInfo ?? undefined,
        createdAt: game.createdAt,
        startedAt: game.startedAt ?? undefined,
        completedAt: game.endedAt ?? undefined,
        hidden: !!game.hiddenAt,
        hiddenAt: game.hiddenAt ?? undefined,
      };
    }));

    // Assign game numbers by creation order
    summaries.forEach((s, i) => {
      s.gameNumber = i + 1;
    });

    return c.json(summaries);
  });

  // =========================================================================
  // Invite Code Management
  // =========================================================================

  // -------------------------------------------------------------------------
  // GET /api/admin/settings/invite — get invite code settings
  // -------------------------------------------------------------------------

  app.get("/api/admin/settings/invite", async (c) => {
    const setting = (await db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, "invite_required")))[0];

    return c.json({
      inviteRequired: setting?.value === "true",
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/admin/settings/invite — toggle invite code requirement
  // -------------------------------------------------------------------------

  app.patch("/api/admin/settings/invite", async (c) => {
    const body = await parseJsonBody(c, "PATCH /api/admin/settings/invite");
    if (body?.inviteRequired === undefined) {
      return c.json({ error: "inviteRequired is required" }, 400);
    }

    const value = body.inviteRequired ? "true" : "false";
    const now = new Date().toISOString();

    await db
      .insert(schema.appSettings)
      .values({ key: "invite_required", value, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: { value, updatedAt: now },
      });

    return c.json({ inviteRequired: body.inviteRequired });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/invite-codes — list invite codes with filters
  // -------------------------------------------------------------------------

  app.get("/api/admin/invite-codes", async (c) => {
    const userId = c.req.query("userId");
    const status = c.req.query("status"); // "available" | "used" | undefined (all)

    let query = db
      .select({
        id: schema.inviteCodes.id,
        code: schema.inviteCodes.code,
        ownerId: schema.inviteCodes.ownerId,
        usedById: schema.inviteCodes.usedById,
        usedAt: schema.inviteCodes.usedAt,
        createdAt: schema.inviteCodes.createdAt,
        ownerDisplayName: schema.users.displayName,
      })
      .from(schema.inviteCodes)
      .innerJoin(schema.users, eq(schema.inviteCodes.ownerId, schema.users.id))
      .$dynamic();

    const conditions = [];
    if (userId) conditions.push(eq(schema.inviteCodes.ownerId, userId));
    if (status === "available") conditions.push(isNull(schema.inviteCodes.usedById));
    if (status === "used") conditions.push(sql`${schema.inviteCodes.usedById} IS NOT NULL`);
    if (conditions.length > 0) query = query.where(and(...conditions));

    const rows = await query;
    return c.json(rows);
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/invite-codes — generate codes for a user
  // -------------------------------------------------------------------------

  app.post("/api/admin/invite-codes", async (c) => {
    const body = await parseJsonBody(c, "POST /api/admin/invite-codes");
    if (!body?.userId) {
      return c.json({ error: "userId is required" }, 400);
    }

    const count = Math.min(Math.max(Number(body.count) || 5, 1), 100);
    const userId = body.userId as string;

    // Verify user exists
    const user = (await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId)))[0];

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    const codes = Array.from({ length: count }, () => ({
      id: randomUUID(),
      code: generateInviteCode(),
      ownerId: userId,
    }));

    await db.insert(schema.inviteCodes).values(codes);

    return c.json({
      generated: count,
      codes: codes.map((c) => c.code),
    }, 201);
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/invite-codes/refill — bulk refill: ensure min codes
  // -------------------------------------------------------------------------

  app.post("/api/admin/invite-codes/refill", async (c) => {
    const body = await parseJsonBody(c, "POST /api/admin/invite-codes/refill");
    const minCodes = Math.min(Math.max(Number(body?.minCodes) || 5, 1), 100);
    const minAgeDays = Number(body?.minAgeDays) || 0;

    // Get eligible users
    const cutoff = minAgeDays > 0
      ? new Date(Date.now() - minAgeDays * 86400000).toISOString()
      : null;

    let usersQuery = db
      .select({ id: schema.users.id })
      .from(schema.users)
      .$dynamic();

    if (cutoff) {
      usersQuery = usersQuery.where(
        sql`${schema.users.createdAt} <= ${cutoff}`,
      );
    }

    const eligibleUsers = await usersQuery;
    let totalGenerated = 0;

    for (const user of eligibleUsers) {
      // Count available (unused) codes
      const countResult = (await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.inviteCodes)
        .where(
          and(
            eq(schema.inviteCodes.ownerId, user.id),
            isNull(schema.inviteCodes.usedById),
          ),
        ))[0];

      const available = Number(countResult?.count ?? 0);
      const needed = minCodes - available;

      if (needed > 0) {
        const codes = Array.from({ length: needed }, () => ({
          id: randomUUID(),
          code: generateInviteCode(),
          ownerId: user.id,
        }));
        await db.insert(schema.inviteCodes).values(codes);
        totalGenerated += needed;
      }
    }

    return c.json({
      usersProcessed: eligibleUsers.length,
      totalGenerated,
    });
  });

  return app;
}
