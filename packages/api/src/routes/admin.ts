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
import { sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { getPermissionsForAddress } from "../db/rbac.js";
import {
  requireAuth,
  requirePermission,
  type AuthEnv,
} from "../middleware/auth.js";

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
    const allRoles = db.select().from(schema.roles).all();

    const rolesWithPerms = allRoles.map((role) => {
      const permRows = db
        .select({ name: schema.permissions.name })
        .from(schema.rolePermissions)
        .innerJoin(
          schema.permissions,
          sql`${schema.rolePermissions.permissionId} = ${schema.permissions.id}`,
        )
        .where(sql`${schema.rolePermissions.roleId} = ${role.id}`)
        .all();

      return {
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem === 1,
        permissions: permRows.map((p) => p.name),
        createdAt: role.createdAt,
      };
    });

    return c.json(rolesWithPerms);
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/permissions — list all permissions
  // -------------------------------------------------------------------------

  app.get("/api/admin/permissions", async (c) => {
    const allPerms = db.select().from(schema.permissions).all();
    return c.json(allPerms);
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/address-roles — list all address-role assignments
  // -------------------------------------------------------------------------

  app.get("/api/admin/address-roles", async (c) => {
    const assignments = db
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
      )
      .all();

    return c.json(assignments);
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/address-roles — assign role to address
  // -------------------------------------------------------------------------

  app.post("/api/admin/address-roles", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.walletAddress || !body?.roleId) {
      return c.json(
        { error: "walletAddress and roleId are required" },
        400,
      );
    }

    const walletAddress = (body.walletAddress as string).toLowerCase();
    const roleId = body.roleId as string;

    // Verify role exists
    const role = db
      .select()
      .from(schema.roles)
      .where(sql`${schema.roles.id} = ${roleId}`)
      .get();

    if (!role) {
      return c.json({ error: "Role not found" }, 404);
    }

    // Check if already assigned
    const existing = db
      .select()
      .from(schema.addressRoles)
      .where(
        sql`${schema.addressRoles.walletAddress} = ${walletAddress} AND ${schema.addressRoles.roleId} = ${roleId}`,
      )
      .get();

    if (existing) {
      return c.json({ error: "Role already assigned to this address" }, 409);
    }

    const granter = c.get("user");
    db.insert(schema.addressRoles)
      .values({
        walletAddress,
        roleId,
        grantedBy: granter.walletAddress ?? granter.id,
      })
      .run();

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
    const body = await c.req.json().catch(() => null);
    if (!body?.walletAddress || !body?.roleId) {
      return c.json(
        { error: "walletAddress and roleId are required" },
        400,
      );
    }

    const walletAddress = (body.walletAddress as string).toLowerCase();
    const roleId = body.roleId as string;

    // Sysop lockout protection: cannot revoke sysop from yourself if you're the last sysop
    const role = db
      .select()
      .from(schema.roles)
      .where(sql`${schema.roles.id} = ${roleId}`)
      .get();

    if (role?.name === "sysop") {
      const currentUser = c.get("user");
      const isSelf =
        currentUser.walletAddress?.toLowerCase() === walletAddress;

      if (isSelf) {
        // Count remaining sysops
        const sysopCount = db
          .select({ count: sql<number>`count(*)` })
          .from(schema.addressRoles)
          .where(sql`${schema.addressRoles.roleId} = ${roleId}`)
          .get();

        if (sysopCount && sysopCount.count <= 1) {
          return c.json(
            { error: "Cannot revoke sysop role — you are the last sysop" },
            403,
          );
        }
      }
    }

    // Check if assignment exists
    const existing = db
      .select()
      .from(schema.addressRoles)
      .where(
        sql`${schema.addressRoles.walletAddress} = ${walletAddress} AND ${schema.addressRoles.roleId} = ${roleId}`,
      )
      .get();

    if (!existing) {
      return c.json({ error: "Role assignment not found" }, 404);
    }

    // Delete the assignment
    db.delete(schema.addressRoles)
      .where(
        sql`${schema.addressRoles.walletAddress} = ${walletAddress} AND ${schema.addressRoles.roleId} = ${roleId}`,
      )
      .run();

    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/users — list all users with their resolved roles
  // -------------------------------------------------------------------------

  app.get("/api/admin/users", async (c) => {
    const allUsers = db.select().from(schema.users).all();

    const usersWithRoles = allUsers.map((user) => {
      const resolved = user.walletAddress
        ? getPermissionsForAddress(db, user.walletAddress)
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
    });

    return c.json(usersWithRoles);
  });

  return app;
}
