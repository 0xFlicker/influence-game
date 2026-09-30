import { sql } from "drizzle-orm";

/** Legacy fixture callers identify their existing account by wallet. */
export function testUserIdForWallet(wallet: string) {
  return sql<string>`(SELECT id FROM users WHERE lower(wallet_address) = lower(${wallet}))`;
}

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";

/** Explicit database authority for tests that previously relied on JWT claims. */
export async function grantTestAuthority(db: DrizzleDB, userId: string, permissions: string[], name = `test-authority-${randomUUID()}`) {
  const [existing] = await db.select().from(schema.roles).where(eq(schema.roles.name, name));
  const roleId = existing?.id ?? randomUUID();
  if (!existing) await db.insert(schema.roles).values({ id: roleId, name });
  for (const permission of permissions) {
    let [row] = await db.select().from(schema.permissions).where(eq(schema.permissions.name, permission));
    if (!row) [row] = await db.insert(schema.permissions).values({ id: randomUUID(), name: permission }).returning();
    await db.insert(schema.rolePermissions).values({ roleId, permissionId: row!.id }).onConflictDoNothing();
  }
  await db.insert(schema.userRoles).values({ userId, roleId, grantedBy: "test" }).onConflictDoNothing();
}
