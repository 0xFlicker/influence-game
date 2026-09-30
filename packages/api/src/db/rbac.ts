/**
 * Influence Game — RBAC Role Resolution
 *
 * Resolves account ID -> roles -> permissions by joining
 * user_roles, role_permissions, and permissions tables.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import type { DrizzleDB } from "./index.js";
import { schema } from "./index.js";

export interface ResolvedPermissions {
  roles: string[];
  permissions: string[];
}

export async function userHasRole(
  db: Pick<DrizzleDB, "select">,
  userId: string,
  roleName: string,
): Promise<boolean> {
  return userHasAnyRole(db, userId, [roleName]);
}

/** Resolve current role assignments, including changes since session issuance. */
export async function userHasAnyRole(
  db: Pick<DrizzleDB, "select">,
  userId: string,
  roleNames: string[],
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(schema.userRoles, eq(schema.users.id, schema.userRoles.userId))
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(and(
      eq(schema.users.id, userId),
      inArray(schema.roles.name, roleNames),
    ))
    .limit(1);

  return Boolean(row);
}

/**
 * Resolve all roles and permissions for a given account ID.
 * Returns deduplicated arrays of role names and permission names.
 */
export async function getPermissionsForUser(
  db: Pick<DrizzleDB, "select">,
  userId: string,
): Promise<ResolvedPermissions> {
  // Join user_roles -> roles to get role names
  const roleRows = await db
    .select({ name: schema.roles.name })
    .from(schema.userRoles)
    .innerJoin(schema.roles, sql`${schema.userRoles.roleId} = ${schema.roles.id}`)
    .where(sql`${schema.userRoles.userId} = ${userId}`);

  const roles = roleRows.map((r) => r.name);

  if (roles.length === 0) {
    return { roles: [], permissions: [] };
  }

  // Join user_roles -> role_permissions -> permissions to get permission names
  const permRows = await db
    .select({ name: schema.permissions.name })
    .from(schema.userRoles)
    .innerJoin(
      schema.rolePermissions,
      sql`${schema.userRoles.roleId} = ${schema.rolePermissions.roleId}`,
    )
    .innerJoin(
      schema.permissions,
      sql`${schema.rolePermissions.permissionId} = ${schema.permissions.id}`,
    )
    .where(sql`${schema.userRoles.userId} = ${userId}`);

  // Deduplicate permission names (user may have overlapping roles)
  const permissions = [...new Set(permRows.map((p) => p.name))];

  return { roles, permissions };
}
