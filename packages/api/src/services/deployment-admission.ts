import { and, asc, eq, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type {
  DeploymentAdmissionLeaseStatus,
  DeploymentAdmissionPhase,
} from "../db/schema.js";

type DrizzleTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
type LeaseRow = typeof schema.deploymentAdmissionLeases.$inferSelect;

const ADMISSION_STATE_ID = 1;
const OPERATIONAL_LEASE_SECONDS = 120;
const ABSOLUTE_LEASE_SECONDS = 4 * 60 * 60;
const PRE_SWITCH_PHASES = new Set<DeploymentAdmissionPhase>(["draining", "validating"]);

export const DEPLOYMENT_CONTROL_REPOSITORY = "0xFlicker/linode-iac";

export type DeploymentAdmissionErrorCode =
  | "active_lease_exists"
  | "active_games_remaining"
  | "deployment_admission_closed"
  | "deployment_admission_unavailable"
  | "invalid_provenance"
  | "invalid_transition"
  | "lease_expired"
  | "lease_not_found"
  | "lease_revision_changed"
  | "resume_too_late"
  | "stale_lease";

export type DeploymentAdmissionFailure = {
  ok: false;
  code: DeploymentAdmissionErrorCode;
  error: string;
  retryable: boolean;
};

export type DeploymentAdmissionLease = {
  id: string;
  fencingToken: number;
  candidateSha: string;
  sourceRepository: string;
  workflowRunId: number;
  workflowRunAttempt: number;
  actor: string;
  phase: DeploymentAdmissionPhase;
  status: DeploymentAdmissionLeaseStatus;
  revision: number;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  absoluteDeadlineAt: string;
};

export type DeploymentAdmissionProvenance = {
  candidateSha: string;
  sourceRepository: string;
  workflowRunId: number;
  workflowRunAttempt: number;
  actor: string;
};

export type DeploymentAdmissionFence = {
  leaseId: string;
  fencingToken: number;
};

export type DeploymentAdmissionStatus = {
  admissionBlocked: boolean;
  lease: DeploymentAdmissionLease | null;
  activeGameCount: number;
  activeGames: Array<{
    id: string;
    slug: string;
    status: "in_progress";
    startedAt: string | null;
  }>;
};

export type GameStartAdmissionResult =
  | { ok: true }
  | {
    ok: false;
    code: "deployment_admission_closed" | "deployment_admission_unavailable";
    error: string;
    retryable: true;
  };

const ALLOWED_TRANSITIONS: Record<DeploymentAdmissionPhase, DeploymentAdmissionPhase[]> = {
  draining: ["validating"],
  validating: ["switching"],
  switching: ["accepting", "restoring"],
  accepting: ["restoring"],
  restoring: [],
};

export async function acquireDeploymentAdmissionLease(
  db: DrizzleDB,
  provenance: DeploymentAdmissionProvenance,
): Promise<{ ok: true; lease: DeploymentAdmissionLease } | DeploymentAdmissionFailure> {
  const provenanceError = validateProvenance(provenance);
  if (provenanceError) return provenanceError;

  try {
    return await db.transaction(async (tx) => {
      const state = await lockAdmissionState(tx);
      const now = await databaseTimes(tx);
      const activeLease = await effectiveActiveLease(tx, now.now);
      if (activeLease) {
        return failure("active_lease_exists", "A production release admission lease is already active", true);
      }

      const fencingToken = state.nextFencingToken;
      await tx.update(schema.deploymentAdmissionState).set({
        nextFencingToken: fencingToken + 1,
        updatedAt: now.now,
      }).where(eq(schema.deploymentAdmissionState.id, ADMISSION_STATE_ID));

      const lease = (await tx.insert(schema.deploymentAdmissionLeases).values({
        fencingToken,
        candidateSha: provenance.candidateSha,
        sourceRepository: provenance.sourceRepository,
        workflowRunId: provenance.workflowRunId,
        workflowRunAttempt: provenance.workflowRunAttempt,
        actor: provenance.actor,
        acquiredAt: now.now,
        heartbeatAt: now.now,
        expiresAt: now.operationalExpiry,
        absoluteDeadlineAt: now.absoluteDeadline,
        updatedAt: now.now,
      }).returning())[0];
      if (!lease) throw new Error("Deployment admission lease insert returned no row");
      return { ok: true as const, lease: projectLease(lease) };
    });
  } catch {
    return unavailableFailure();
  }
}

export async function heartbeatDeploymentAdmissionLease(
  db: DrizzleDB,
  fence: DeploymentAdmissionFence,
): Promise<{ ok: true; lease: DeploymentAdmissionLease } | DeploymentAdmissionFailure> {
  try {
    return await db.transaction(async (tx) => {
      await lockAdmissionState(tx);
      const now = await databaseTimes(tx);
      const lease = await effectiveActiveLease(tx, now.now);
      const exact = matchFence(lease, fence);
      if (!exact.ok) return exact;
      if (PRE_SWITCH_PHASES.has(exact.lease.phase) && isExpired(exact.lease, now.now)) {
        await expireLease(tx, exact.lease, now.now);
        return failure("lease_expired", "The deployment admission lease expired", false);
      }

      const expiresAt = PRE_SWITCH_PHASES.has(exact.lease.phase)
        ? earlierTimestamp(now.operationalExpiry, exact.lease.absoluteDeadlineAt)
        : exact.lease.expiresAt;
      const updated = (await tx.update(schema.deploymentAdmissionLeases).set({
        heartbeatAt: now.now,
        expiresAt,
        revision: sql`${schema.deploymentAdmissionLeases.revision} + 1`,
        updatedAt: now.now,
      }).where(and(
        eq(schema.deploymentAdmissionLeases.id, exact.lease.id),
        eq(schema.deploymentAdmissionLeases.fencingToken, exact.lease.fencingToken),
        eq(schema.deploymentAdmissionLeases.status, "active"),
      )).returning())[0];
      if (!updated) return staleLeaseFailure();
      return { ok: true as const, lease: projectLease(updated) };
    });
  } catch {
    return unavailableFailure();
  }
}

export async function advanceDeploymentAdmissionPhase(
  db: DrizzleDB,
  input: DeploymentAdmissionFence & {
    expectedPhase: DeploymentAdmissionPhase;
    nextPhase: DeploymentAdmissionPhase;
  },
): Promise<{ ok: true; lease: DeploymentAdmissionLease } | DeploymentAdmissionFailure> {
  if (!ALLOWED_TRANSITIONS[input.expectedPhase]?.includes(input.nextPhase)) {
    return failure("invalid_transition", "The requested deployment phase transition is not allowed", false);
  }

  try {
    return await db.transaction(async (tx) => {
      await lockAdmissionState(tx);
      const now = await databaseTimes(tx);
      const lease = await effectiveActiveLease(tx, now.now);
      const exact = matchFence(lease, input);
      if (!exact.ok) return exact;
      if (PRE_SWITCH_PHASES.has(exact.lease.phase) && isExpired(exact.lease, now.now)) {
        await expireLease(tx, exact.lease, now.now);
        return failure("lease_expired", "The deployment admission lease expired", false);
      }
      if (exact.lease.phase !== input.expectedPhase) {
        return failure("stale_lease", "The deployment lease phase changed", false);
      }
      if (input.nextPhase === "switching") {
        const activeGames = await loadActiveGames(tx);
        if (activeGames.length > 0) {
          return failure("active_games_remaining", "Active games remain inside the deployment drain", true);
        }
      }

      const updated = (await tx.update(schema.deploymentAdmissionLeases).set({
        phase: input.nextPhase,
        revision: sql`${schema.deploymentAdmissionLeases.revision} + 1`,
        updatedAt: now.now,
      }).where(and(
        eq(schema.deploymentAdmissionLeases.id, exact.lease.id),
        eq(schema.deploymentAdmissionLeases.fencingToken, exact.lease.fencingToken),
        eq(schema.deploymentAdmissionLeases.status, "active"),
        eq(schema.deploymentAdmissionLeases.phase, input.expectedPhase),
      )).returning())[0];
      if (!updated) return staleLeaseFailure();
      return { ok: true as const, lease: projectLease(updated) };
    });
  } catch {
    return unavailableFailure();
  }
}

export async function completeDeploymentAdmissionLease(
  db: DrizzleDB,
  input: DeploymentAdmissionFence & {
    outcome: "accepted" | "restored" | "aborted";
    reason: string;
  },
): Promise<{ ok: true; lease: DeploymentAdmissionLease } | DeploymentAdmissionFailure> {
  if (!validAuditReason(input.reason)) {
    return failure("invalid_transition", "A bounded completion reason is required", false);
  }

  try {
    return await db.transaction(async (tx) => {
      await lockAdmissionState(tx);
      const now = await databaseTimes(tx);
      const lease = await effectiveActiveLease(tx, now.now);
      const exact = matchFence(lease, input);
      if (!exact.ok) return exact;
      const outcomeAllowed = input.outcome === "aborted"
        ? PRE_SWITCH_PHASES.has(exact.lease.phase)
        : input.outcome === "accepted"
          ? exact.lease.phase === "accepting"
          : exact.lease.phase === "restoring";
      if (!outcomeAllowed) {
        return failure("invalid_transition", "The lease cannot complete with that outcome from its current phase", false);
      }

      const updated = (await tx.update(schema.deploymentAdmissionLeases).set({
        status: input.outcome,
        completedAt: now.now,
        completionReason: input.reason,
        revision: sql`${schema.deploymentAdmissionLeases.revision} + 1`,
        updatedAt: now.now,
      }).where(and(
        eq(schema.deploymentAdmissionLeases.id, exact.lease.id),
        eq(schema.deploymentAdmissionLeases.fencingToken, exact.lease.fencingToken),
        eq(schema.deploymentAdmissionLeases.status, "active"),
      )).returning())[0];
      if (!updated) return staleLeaseFailure();
      return { ok: true as const, lease: projectLease(updated) };
    });
  } catch {
    return unavailableFailure();
  }
}

export async function revokeDeploymentAdmissionLease(
  db: DrizzleDB,
  input: {
    leaseId: string;
    expectedRevision: number;
    revokedBy: string;
    reason: string;
  },
): Promise<
  | { ok: true; outcome: "revoked" | "already_resumed"; lease: DeploymentAdmissionLease }
  | DeploymentAdmissionFailure
> {
  if (
    !Number.isSafeInteger(input.expectedRevision)
    || input.expectedRevision < 1
    || !validAuditActor(input.revokedBy)
    || !validAuditReason(input.reason)
  ) {
    return failure("invalid_transition", "A valid lease revision, actor, and Resume reason are required", false);
  }

  try {
    return await db.transaction(async (tx) => {
      await lockAdmissionState(tx);
      const now = await databaseTimes(tx);
      const activeLease = await effectiveActiveLease(tx, now.now);
      const requestedLease = (await tx.select().from(schema.deploymentAdmissionLeases)
        .where(eq(schema.deploymentAdmissionLeases.id, input.leaseId))
        .limit(1)
        .for("update"))[0];
      if (!requestedLease) {
        return failure("lease_not_found", "The deployment admission lease was not found", false);
      }
      if (requestedLease.status !== "active") {
        if (activeLease && activeLease.id !== requestedLease.id) return staleLeaseFailure();
        return {
          ok: true as const,
          outcome: "already_resumed" as const,
          lease: projectLease(requestedLease),
        };
      }
      if (!activeLease || activeLease.id !== requestedLease.id) return staleLeaseFailure();
      if (!PRE_SWITCH_PHASES.has(requestedLease.phase)) {
        return failure(
          "resume_too_late",
          "Resume is unavailable after the production route switch begins",
          false,
        );
      }
      if (requestedLease.revision !== input.expectedRevision) {
        return failure(
          "lease_revision_changed",
          "The deployment admission lease changed; refresh status before resuming",
          true,
        );
      }

      const updated = (await tx.update(schema.deploymentAdmissionLeases).set({
        status: "revoked",
        completedAt: now.now,
        completionReason: "admin_resume",
        revokedAt: now.now,
        revokedBy: input.revokedBy,
        revocationReason: input.reason,
        revision: sql`${schema.deploymentAdmissionLeases.revision} + 1`,
        updatedAt: now.now,
      }).where(and(
        eq(schema.deploymentAdmissionLeases.id, requestedLease.id),
        eq(schema.deploymentAdmissionLeases.status, "active"),
        eq(schema.deploymentAdmissionLeases.revision, input.expectedRevision),
        eq(schema.deploymentAdmissionLeases.phase, requestedLease.phase),
      )).returning())[0];
      if (!updated) return staleLeaseFailure();
      return { ok: true as const, outcome: "revoked" as const, lease: projectLease(updated) };
    });
  } catch {
    return unavailableFailure();
  }
}

export async function getDeploymentAdmissionStatus(
  db: DrizzleDB,
): Promise<DeploymentAdmissionStatus> {
  return db.transaction(async (tx) => {
    await lockAdmissionState(tx);
    const now = await databaseTimes(tx);
    const lease = await effectiveActiveLease(tx, now.now);
    const activeGames = await loadActiveGames(tx);
    return {
      admissionBlocked: lease !== null,
      lease: lease ? projectLease(lease) : null,
      activeGameCount: activeGames.length,
      activeGames,
    };
  });
}

/**
 * Activation is valid only after the host has accepted routing ownership for
 * this exact fence. Post-switch leases do not expire operationally, so the
 * successful check cannot be displaced by a newer lease before completion.
 */
export async function validateDeploymentAdmissionActivationFence(
  db: DrizzleDB,
  fence: DeploymentAdmissionFence,
): Promise<{ ok: true } | DeploymentAdmissionFailure> {
  try {
    return await db.transaction(async (tx) => {
      await lockAdmissionState(tx);
      const now = await databaseTimes(tx);
      const lease = await effectiveActiveLease(tx, now.now);
      const exact = matchFence(lease, fence);
      if (!exact.ok) return exact;
      if (exact.lease.phase !== "accepting") {
        return failure(
          "invalid_transition",
          "Candidate runtime activation requires an accepting deployment lease",
          false,
        );
      }
      return { ok: true as const };
    });
  } catch {
    return unavailableFailure();
  }
}

export async function checkGameStartAdmission(
  db: DrizzleDB,
): Promise<GameStartAdmissionResult> {
  try {
    return await db.transaction((tx) => checkGameStartAdmissionInTransaction(tx));
  } catch {
    return unavailableStartFailure();
  }
}

/**
 * Authoritative start seam. The singleton row lock stays held through the
 * caller's waiting-to-in-progress update, serializing lease acquisition and starts.
 */
export async function checkGameStartAdmissionInTransaction(
  tx: DrizzleTransaction,
): Promise<GameStartAdmissionResult> {
  try {
    await lockAdmissionState(tx);
    const now = await databaseTimes(tx);
    const lease = await effectiveActiveLease(tx, now.now);
    if (lease) {
      return {
        ok: false,
        code: "deployment_admission_closed",
        error: "New game starts are temporarily paused for a production release",
        retryable: true,
      };
    }
    return { ok: true };
  } catch {
    return unavailableStartFailure();
  }
}

async function lockAdmissionState(tx: DrizzleTransaction) {
  await tx.insert(schema.deploymentAdmissionState).values({ id: ADMISSION_STATE_ID })
    .onConflictDoNothing();
  const state = (await tx.select().from(schema.deploymentAdmissionState)
    .where(eq(schema.deploymentAdmissionState.id, ADMISSION_STATE_ID))
    .for("update"))[0];
  if (!state) throw new Error("Deployment admission singleton is missing");
  return state;
}

async function effectiveActiveLease(
  tx: DrizzleTransaction,
  now: string,
): Promise<LeaseRow | null> {
  const lease = (await tx.select().from(schema.deploymentAdmissionLeases)
    .where(eq(schema.deploymentAdmissionLeases.status, "active"))
    .limit(1)
    .for("update"))[0] ?? null;
  if (!lease || !PRE_SWITCH_PHASES.has(lease.phase) || !isExpired(lease, now)) return lease;
  await expireLease(tx, lease, now);
  return null;
}

async function expireLease(tx: DrizzleTransaction, lease: LeaseRow, now: string): Promise<void> {
  await tx.update(schema.deploymentAdmissionLeases).set({
    status: "expired",
    completedAt: now,
    completionReason: "lease_expired_before_switch",
    revision: sql`${schema.deploymentAdmissionLeases.revision} + 1`,
    updatedAt: now,
  }).where(and(
    eq(schema.deploymentAdmissionLeases.id, lease.id),
    eq(schema.deploymentAdmissionLeases.fencingToken, lease.fencingToken),
    eq(schema.deploymentAdmissionLeases.status, "active"),
  ));
}

async function databaseTimes(tx: DrizzleTransaction): Promise<{
  now: string;
  operationalExpiry: string;
  absoluteDeadline: string;
}> {
  const [row] = await tx.execute<{
    now: string;
    operational_expiry: string;
    absolute_deadline: string;
  }>(sql`
    SELECT
      clock_timestamp()::text AS now,
      (clock_timestamp() + make_interval(secs => ${OPERATIONAL_LEASE_SECONDS}))::text AS operational_expiry,
      (clock_timestamp() + make_interval(secs => ${ABSOLUTE_LEASE_SECONDS}))::text AS absolute_deadline
  `);
  if (!row) throw new Error("Database time query returned no row");
  return {
    now: row.now,
    operationalExpiry: row.operational_expiry,
    absoluteDeadline: row.absolute_deadline,
  };
}

async function loadActiveGames(tx: DrizzleTransaction): Promise<DeploymentAdmissionStatus["activeGames"]> {
  const rows = await tx.select({
    id: schema.games.id,
    slug: schema.games.slug,
    status: schema.games.status,
    startedAt: schema.games.startedAt,
  }).from(schema.games)
    .where(eq(schema.games.status, "in_progress"))
    .orderBy(asc(schema.games.startedAt), asc(schema.games.id));
  return rows.map((game) => ({ ...game, status: "in_progress" as const }));
}

function matchFence(
  lease: LeaseRow | null,
  fence: DeploymentAdmissionFence,
): { ok: true; lease: LeaseRow } | DeploymentAdmissionFailure {
  if (!lease) return failure("lease_expired", "The deployment admission lease is no longer active", false);
  if (lease.id !== fence.leaseId || lease.fencingToken !== fence.fencingToken) {
    return staleLeaseFailure();
  }
  return { ok: true, lease };
}

function projectLease(row: LeaseRow): DeploymentAdmissionLease {
  return {
    id: row.id,
    fencingToken: row.fencingToken,
    candidateSha: row.candidateSha,
    sourceRepository: row.sourceRepository,
    workflowRunId: row.workflowRunId,
    workflowRunAttempt: row.workflowRunAttempt,
    actor: row.actor,
    phase: row.phase,
    status: row.status,
    revision: row.revision,
    acquiredAt: row.acquiredAt,
    heartbeatAt: row.heartbeatAt,
    expiresAt: row.expiresAt,
    absoluteDeadlineAt: row.absoluteDeadlineAt,
  };
}

function validateProvenance(provenance: DeploymentAdmissionProvenance): DeploymentAdmissionFailure | null {
  if (
    !/^[0-9a-f]{40}$/.test(provenance.candidateSha)
    || provenance.sourceRepository !== DEPLOYMENT_CONTROL_REPOSITORY
    || !Number.isSafeInteger(provenance.workflowRunId)
    || provenance.workflowRunId < 1
    || !Number.isSafeInteger(provenance.workflowRunAttempt)
    || provenance.workflowRunAttempt < 1
    || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(provenance.actor)
  ) {
    return failure("invalid_provenance", "Deployment lease provenance is invalid", false);
  }
  return null;
}

function isExpired(lease: LeaseRow, now: string): boolean {
  const nowMs = Date.parse(now);
  return Date.parse(lease.expiresAt) <= nowMs || Date.parse(lease.absoluteDeadlineAt) <= nowMs;
}

function earlierTimestamp(left: string, right: string): string {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function validAuditReason(reason: string): boolean {
  return reason.length >= 1
    && reason.length <= 240
    && /^[A-Za-z0-9 ._/@,:#+()-]+$/.test(reason);
}

function validAuditActor(actor: string): boolean {
  return actor.length >= 1
    && actor.length <= 200
    && /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(actor);
}

function failure(
  code: DeploymentAdmissionErrorCode,
  error: string,
  retryable: boolean,
): DeploymentAdmissionFailure {
  return { ok: false, code, error, retryable };
}

function staleLeaseFailure(): DeploymentAdmissionFailure {
  return failure("stale_lease", "The deployment admission fence is stale", false);
}

function unavailableFailure(): DeploymentAdmissionFailure {
  return failure(
    "deployment_admission_unavailable",
    "Deployment admission state is temporarily unavailable",
    true,
  );
}

function unavailableStartFailure(): GameStartAdmissionResult {
  return {
    ok: false,
    code: "deployment_admission_unavailable",
    error: "New game starts are temporarily unavailable",
    retryable: true,
  };
}
