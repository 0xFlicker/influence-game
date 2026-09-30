/**
 * Influence Game — RBAC Seed Data
 *
 * Seeds permissions, roles, role-permission mappings, and the initial sysop
 * assignment. Idempotent — safe to run on every startup.
 */

import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import type { DrizzleDB } from "./index.js";
import { schema } from "./index.js";

// ---------------------------------------------------------------------------
// Seed definitions
// ---------------------------------------------------------------------------

const PERMISSIONS = [
  { name: "manage_game_assets", description: "Manage editorial game images" },
  { name: "review_agent_content", description: "Claim and review character content revisions" },
  { name: "review_moderation_escalations", description: "Review content escalated to admins" },
  { name: "undo_moderation", description: "Undo character moderation decisions with an audit trail" },
  { name: "manage_roles", description: "Assign and revoke roles to accounts" },
  { name: "create_game", description: "Create new games" },
  { name: "start_game", description: "Start waiting games" },
  { name: "join_game", description: "Join open games" },
  { name: "stop_game", description: "Stop or cancel running games" },
  { name: "fill_game", description: "Fill AI player slots" },
  { name: "view_admin", description: "Access the admin panel" },
  { name: "manage_cost_accounting", description: "Backfill, rebuild, and reconcile admin game cost accounting" },
  { name: "manage_postgame_media", description: "Backfill and rerender House Highlights postgame media" },
  { name: "manage_deployment_admission", description: "Inspect and Resume production release admission" },
  { name: "manage_provider_health", description: "Run fenced provider health probes and resume provider-backed admission" },
  { name: "manage_seasons", description: "Create, close, and finalize rated Influence seasons" },
  { name: "retry_game_settlement", description: "Retry a sealed completion settlement" },
  { name: "schedule_free_game", description: "Trigger daily free game draw and start" },
  { name: "hide_game", description: "Hide/unhide games from public lists" },
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
      "review_agent_content",
      "review_moderation_escalations",
      "undo_moderation",
      "create_game",
      "start_game",
      "stop_game",
      "fill_game",
      "view_admin",
      "schedule_free_game",
      "hide_game",
      "manage_postgame_media",
      "manage_deployment_admission",
      "manage_provider_health",
      "manage_seasons",
      "retry_game_settlement",
    ],
  },
  {
    name: "moderator",
    description: "Review character submissions without general admin access",
    isSystem: 1,
    permissions: ["review_agent_content"],
  },
  {
    name: "gamer",
    description: "Limited game operator who can create, fill, and start games",
    isSystem: 1,
    permissions: [
      "create_game",
      "start_game",
      "fill_game",
    ],
  },
  {
    name: "producer",
    description: "Can authorize producer MCP access and manage game images",
    isSystem: 1,
    permissions: ["manage_game_assets"],
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

export async function seedRBAC(db: DrizzleDB): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Seed permissions — upsert by name
    const permissionIds = new Map<string, string>();

    for (const perm of PERMISSIONS) {
      const existing = (await tx
        .select({ id: schema.permissions.id })
        .from(schema.permissions)
        .where(sql`${schema.permissions.name} = ${perm.name}`))[0];

      if (existing) {
        permissionIds.set(perm.name, existing.id);
      } else {
        const id = randomUUID();
        await tx.insert(schema.permissions)
          .values({ id, name: perm.name, description: perm.description });
        permissionIds.set(perm.name, id);
      }
    }

    // 2. Seed roles — upsert by name
    const roleIds = new Map<string, string>();

    for (const role of ROLES) {
      const existing = (await tx
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(sql`${schema.roles.name} = ${role.name}`))[0];

      if (existing) {
        if (role.name === "producer") {
          await tx.update(schema.roles).set({ description: role.description }).where(sql`${schema.roles.id} = ${existing.id}`);
        }
        roleIds.set(role.name, existing.id);
      } else {
        const id = randomUUID();
        await tx.insert(schema.roles)
          .values({
            id,
            name: role.name,
            description: role.description,
            isSystem: role.isSystem,
          });
        roleIds.set(role.name, id);
      }
    }

    // 3. Seed role_permissions — skip duplicates via select-then-insert
    for (const role of ROLES) {
      const roleId = roleIds.get(role.name)!;
      for (const permName of role.permissions) {
        const permId = permissionIds.get(permName)!;

        const existing = (await tx
          .select({ roleId: schema.rolePermissions.roleId })
          .from(schema.rolePermissions)
          .where(
            sql`${schema.rolePermissions.roleId} = ${roleId} AND ${schema.rolePermissions.permissionId} = ${permId}`,
          ))[0];

        if (!existing) {
          await tx.insert(schema.rolePermissions)
            .values({ roleId, permissionId: permId });
        }
      }
    }
  });

  await bootstrapSysop(db);

  console.log(
    `[rbac-seed] Seeded ${PERMISSIONS.length} permissions, ${ROLES.length} roles`,
  );
}

/** Initial bootstrap only. Final-sysop protection prevents startup resurrection. */
export async function bootstrapSysop(db: DrizzleDB): Promise<void> {
  const address = process.env.ADMIN_ADDRESS?.toLowerCase();
  if (!address || address === "0x0000000000000000000000000000000000000000") return;
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('influence:role-management', 0))`);
    const [completed] = await tx.select().from(schema.appSettings).where(eq(schema.appSettings.key, "rbac_bootstrap_completed"));
    if (completed) return;
    const markCompleted = () => tx.insert(schema.appSettings).values({ key: "rbac_bootstrap_completed", value: "true" }).onConflictDoNothing();
    const [role] = await tx.select().from(schema.roles).where(eq(schema.roles.name, "sysop"));
    if (!role) return;
    const [existing] = await tx.select().from(schema.userRoles).where(eq(schema.userRoles.roleId, role.id));
    if (existing) { await markCompleted(); return; }
    const owners = await tx.select().from(schema.users).where(sql`lower(${schema.users.walletAddress}) = ${address}`);
    if (owners.length !== 1) return;
    await tx.insert(schema.userRoles).values({ userId: owners[0]!.id, roleId: role.id, grantedBy: "system" });
    await markCompleted();
  });
}
