/**
 * Influence Game — RBAC Role Resolution
 *
 * Resolves wallet address -> roles -> permissions by joining
 * address_roles, role_permissions, and permissions tables.
 */

import { sql } from "drizzle-orm";
import type { DrizzleDB } from "./index.js";
import { schema } from "./index.js";

export interface ResolvedPermissions {
  roles: string[];
  permissions: string[];
}

/**
 * Resolve all roles and permissions for a given wallet address.
 * Returns deduplicated arrays of role names and permission names.
 */
export function getPermissionsForAddress(
  db: DrizzleDB,
  walletAddress: string,
): ResolvedPermissions {
  const addr = walletAddress.toLowerCase();

  // Join address_roles -> roles to get role names
  const roleRows = db
    .select({ name: schema.roles.name })
    .from(schema.addressRoles)
    .innerJoin(schema.roles, sql`${schema.addressRoles.roleId} = ${schema.roles.id}`)
    .where(sql`${schema.addressRoles.walletAddress} = ${addr}`)
    .all();

  const roles = roleRows.map((r) => r.name);

  if (roles.length === 0) {
    return { roles: [], permissions: [] };
  }

  // Join address_roles -> role_permissions -> permissions to get permission names
  const permRows = db
    .select({ name: schema.permissions.name })
    .from(schema.addressRoles)
    .innerJoin(
      schema.rolePermissions,
      sql`${schema.addressRoles.roleId} = ${schema.rolePermissions.roleId}`,
    )
    .innerJoin(
      schema.permissions,
      sql`${schema.rolePermissions.permissionId} = ${schema.permissions.id}`,
    )
    .where(sql`${schema.addressRoles.walletAddress} = ${addr}`)
    .all();

  // Deduplicate permission names (user may have overlapping roles)
  const permissions = [...new Set(permRows.map((p) => p.name))];

  return { roles, permissions };
}
