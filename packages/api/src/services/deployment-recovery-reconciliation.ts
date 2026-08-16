import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { getDeploymentAdmissionStatus } from "./deployment-admission.js";

type RecoveryResult = {
  attempted: number;
  recovered: number;
  skipped: Array<{ gameId: string; reason: string }>;
};

export type DeploymentRecoveryReconciliationResult =
  | { outcome: "deferred" | "idle" }
  | { outcome: "succeeded"; leaseId: string; recovery: RecoveryResult }
  | { outcome: "retry"; leaseId: string; error: string };

/**
 * Claims one terminal pre-switch reconciliation with a DB lease. The accepted
 * runtime is the only caller, and it rechecks that admission is open before
 * and after claiming so recovery never runs inside a later deployment drain.
 */
export async function runPendingDeploymentRecoveryReconciliation(
  db: DrizzleDB,
  recover: () => Promise<RecoveryResult>,
  signal?: AbortSignal,
): Promise<DeploymentRecoveryReconciliationResult> {
  signal?.throwIfAborted();
  if ((await getDeploymentAdmissionStatus(db)).admissionBlocked) return { outcome: "deferred" };
  signal?.throwIfAborted();

  const claim = await claimPendingReconciliation(db);
  if (!claim) return { outcome: "idle" };
  signal?.throwIfAborted();

  try {
    const recovery = await recover();
    signal?.throwIfAborted();
    await finishReconciliation(db, claim, null);
    return { outcome: "succeeded", leaseId: claim.leaseId, recovery };
  } catch (error) {
    const message = boundedError(error);
    await finishReconciliation(db, claim, message);
    return { outcome: "retry", leaseId: claim.leaseId, error: message };
  }
}

async function claimPendingReconciliation(
  db: DrizzleDB,
): Promise<{ leaseId: string; claimToken: string } | null> {
  return db.transaction(async (tx) => {
    await tx.insert(schema.deploymentAdmissionState).values({ id: 1 }).onConflictDoNothing();
    await tx.select().from(schema.deploymentAdmissionState)
      .where(eq(schema.deploymentAdmissionState.id, 1)).for("update");
    const activeLease = (await tx.select({ id: schema.deploymentAdmissionLeases.id })
      .from(schema.deploymentAdmissionLeases)
      .where(eq(schema.deploymentAdmissionLeases.status, "active"))
      .limit(1))[0];
    if (activeLease) return null;

    const [clock] = await tx.execute<{ now: string; claim_expires_at: string }>(sql`
      SELECT now()::text AS now, (now() + interval '5 minutes')::text AS claim_expires_at
    `);
    if (!clock) throw new Error("Deployment reconciliation database clock is unavailable");
    const pending = (await tx.select().from(schema.deploymentRecoveryReconciliations)
      .where(or(
        eq(schema.deploymentRecoveryReconciliations.status, "pending"),
        and(
          eq(schema.deploymentRecoveryReconciliations.status, "running"),
          lte(schema.deploymentRecoveryReconciliations.claimExpiresAt, clock.now),
        ),
      ))
      .orderBy(asc(schema.deploymentRecoveryReconciliations.requestedAt))
      .limit(1)
      .for("update"))[0];
    if (!pending) return null;

    const claimToken = crypto.randomUUID();
    const claimed = (await tx.update(schema.deploymentRecoveryReconciliations).set({
      status: "running",
      attempts: sql`${schema.deploymentRecoveryReconciliations.attempts} + 1`,
      claimToken,
      claimExpiresAt: clock.claim_expires_at,
      updatedAt: clock.now,
    }).where(eq(schema.deploymentRecoveryReconciliations.leaseId, pending.leaseId)).returning({
      leaseId: schema.deploymentRecoveryReconciliations.leaseId,
    }))[0];
    return claimed ? { leaseId: claimed.leaseId, claimToken } : null;
  });
}

async function finishReconciliation(
  db: DrizzleDB,
  claim: { leaseId: string; claimToken: string },
  error: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(schema.deploymentAdmissionState).values({ id: 1 }).onConflictDoNothing();
    await tx.select().from(schema.deploymentAdmissionState)
      .where(eq(schema.deploymentAdmissionState.id, 1)).for("update");
    const activeLease = (await tx.select({ id: schema.deploymentAdmissionLeases.id })
      .from(schema.deploymentAdmissionLeases)
      .where(eq(schema.deploymentAdmissionLeases.status, "active"))
      .limit(1))[0];
    if (activeLease && error === null) throw new Error("Deployment admission closed during recovery reconciliation");

    const [clock] = await tx.execute<{ now: string }>(sql`SELECT now()::text AS now`);
    if (!clock) throw new Error("Deployment reconciliation database clock is unavailable");
    const updated = await tx.update(schema.deploymentRecoveryReconciliations).set({
      status: error ? "pending" : "succeeded",
      claimToken: null,
      claimExpiresAt: null,
      lastError: error,
      completedAt: error ? null : clock.now,
      updatedAt: clock.now,
    }).where(and(
      eq(schema.deploymentRecoveryReconciliations.leaseId, claim.leaseId),
      eq(schema.deploymentRecoveryReconciliations.status, "running"),
      eq(schema.deploymentRecoveryReconciliations.claimToken, claim.claimToken),
    )).returning({ leaseId: schema.deploymentRecoveryReconciliations.leaseId });
    if (updated.length !== 1) throw new Error("Deployment reconciliation claim changed");
  });
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1000) || "deployment recovery reconciliation failed";
}
