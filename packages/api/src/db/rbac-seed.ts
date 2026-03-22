/**
 * Influence Game — RBAC Seed Data
 *
 * Seeds permissions, roles, role-permission mappings, and the initial sysop
 * assignment. Idempotent — safe to run on every startup.
 */

import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import type { DrizzleDB } from "./index.js";
import { schema } from "./index.js";

// ---------------------------------------------------------------------------
// Seed definitions
// ---------------------------------------------------------------------------

const PERMISSIONS = [
  { name: "manage_roles", description: "Assign and revoke roles to addresses" },
  { name: "create_game", description: "Create new games" },
  { name: "start_game", description: "Start waiting games" },
  { name: "join_game", description: "Join open games" },
  { name: "stop_game", description: "Stop or cancel running games" },
  { name: "fill_game", description: "Fill AI player slots" },
  { name: "view_admin", description: "Access the admin panel" },
  { name: "schedule_free_game", description: "Trigger daily free game draw and start" },
] as const;

const ROLES = [
  {
    name: "sysop",
    description: "Super-admin with all permissions",
    isSystem: 1,
    permissions: PERMISSIONS.map((p) => p.name),
  },
  {
    name: "admin",
    description: "Game operations and admin panel access",
    isSystem: 1,
    permissions: [
      "create_game",
      "start_game",
      "stop_game",
      "fill_game",
      "view_admin",
      "schedule_free_game",
    ],
  },
  {
    name: "player",
    description: "Standard player who can join games",
    isSystem: 0,
    permissions: ["join_game"],
  },
] as const;

// ---------------------------------------------------------------------------
// Seed runner
// ---------------------------------------------------------------------------

export function seedRBAC(db: DrizzleDB): void {
  // 1. Seed permissions — upsert by name
  const permissionIds = new Map<string, string>();

  for (const perm of PERMISSIONS) {
    // Check if permission already exists
    const existing = db
      .select({ id: schema.permissions.id })
      .from(schema.permissions)
      .where(sql`${schema.permissions.name} = ${perm.name}`)
      .get();

    if (existing) {
      permissionIds.set(perm.name, existing.id);
    } else {
      const id = randomUUID();
      db.insert(schema.permissions)
        .values({ id, name: perm.name, description: perm.description })
        .run();
      permissionIds.set(perm.name, id);
    }
  }

  // 2. Seed roles — upsert by name
  const roleIds = new Map<string, string>();

  for (const role of ROLES) {
    const existing = db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(sql`${schema.roles.name} = ${role.name}`)
      .get();

    if (existing) {
      roleIds.set(role.name, existing.id);
    } else {
      const id = randomUUID();
      db.insert(schema.roles)
        .values({
          id,
          name: role.name,
          description: role.description,
          isSystem: role.isSystem,
        })
        .run();
      roleIds.set(role.name, id);
    }
  }

  // 3. Seed role_permissions — skip duplicates via select-then-insert
  for (const role of ROLES) {
    const roleId = roleIds.get(role.name)!;
    for (const permName of role.permissions) {
      const permId = permissionIds.get(permName)!;

      const existing = db
        .select({ roleId: schema.rolePermissions.roleId })
        .from(schema.rolePermissions)
        .where(
          sql`${schema.rolePermissions.roleId} = ${roleId} AND ${schema.rolePermissions.permissionId} = ${permId}`,
        )
        .get();

      if (!existing) {
        db.insert(schema.rolePermissions)
          .values({ roleId, permissionId: permId })
          .run();
      }
    }
  }

  // 4. Auto-assign sysop role to ADMIN_ADDRESS if set
  const adminAddress = process.env.ADMIN_ADDRESS?.toLowerCase();
  const sysopRoleId = roleIds.get("sysop");

  if (adminAddress && sysopRoleId) {
    const existing = db
      .select({ walletAddress: schema.addressRoles.walletAddress })
      .from(schema.addressRoles)
      .where(
        sql`${schema.addressRoles.walletAddress} = ${adminAddress} AND ${schema.addressRoles.roleId} = ${sysopRoleId}`,
      )
      .get();

    if (!existing) {
      db.insert(schema.addressRoles)
        .values({
          walletAddress: adminAddress,
          roleId: sysopRoleId,
          grantedBy: "system",
        })
        .run();
      console.log(
        `[rbac-seed] Assigned sysop role to ADMIN_ADDRESS: ${adminAddress}`,
      );
    }
  }

  console.log(
    `[rbac-seed] Seeded ${PERMISSIONS.length} permissions, ${ROLES.length} roles`,
  );
}
