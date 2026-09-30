import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";

export interface InitialOperatorBootstrapInput {
  userId: string;
  operator: string;
  dryRun: boolean;
}

/** Host DB authority is the trust boundary. The operator label is self-reported. */
export async function bootstrapInitialOperator(db: DrizzleDB, input: InitialOperatorBootstrapInput) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('influence:role-management', 0))`);
    const blocked = (reason: string) => ({ status: "blocked" as const, reason, userId: input.userId });
    const [completed] = await tx.select().from(schema.appSettings).where(eq(schema.appSettings.key, "rbac_bootstrap_completed"));
    if (completed) return blocked("Initial bootstrap already completed; use an existing sysop or explicit recovery procedure");
    const [role] = await tx.select().from(schema.roles).where(eq(schema.roles.name, "sysop"));
    if (!role) return blocked("RBAC roles are not initialized; start the migrated app first");
    const [existing] = await tx.select().from(schema.userRoles).where(eq(schema.userRoles.roleId, role.id));
    if (existing) return blocked("A sysop already exists; use normal account role management");
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, input.userId));
    if (!user) return blocked("Account not found; the intended operator must log in first");
    const [service] = await tx.select().from(schema.servicePrincipals).where(eq(schema.servicePrincipals.userId, input.userId));
    if (service || user.walletAddress?.toLowerCase() === "0x0000000000000000000000000000000000000000") return blocked("Service identities cannot receive human sysop authority");
    if (input.dryRun) return { status: "eligible" as const, userId: input.userId, operator: input.operator, dryRun: true };
    const audit = {
      source: "host-operator-cli", operatorLabel: input.operator,
      operatorIdentityVerified: false, userId: input.userId,
      requestId: randomUUID(), grantedAt: new Date().toISOString(),
    };
    await tx.insert(schema.userRoles).values({ userId: input.userId, roleId: role.id, grantedBy: `host-operator:${input.operator}`, grantedAt: audit.grantedAt });
    // The same durable marker used by wallet bootstrap is also the audit record.
    // Deleting a later grant never resets this marker or re-enables bootstrap.
    await tx.insert(schema.appSettings).values({ key: "rbac_bootstrap_completed", value: JSON.stringify(audit) });
    return { status: "bootstrapped" as const, ...audit };
  });
}
