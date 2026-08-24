import { randomUUID } from "crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  ProviderCircuitOpenError,
  type ProviderAttemptFailureKind,
  type ProviderAttemptOutcome,
  type ProviderAttemptRecord,
  type ResolvedProviderManifestEntry,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { sha256StableJson } from "./stable-hash.js";
import type {
  ProviderHealthReason,
  ProviderHealthScopeKind,
  ProviderHealthState,
} from "../db/schema.js";

type DrizzleTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
type HealthRow = typeof schema.providerHealthStates.$inferSelect;

export interface ProviderHealthPolicy {
  transientFailureThreshold: number;
  transientWindowMs: number;
  transientCooldownMs: number;
  probeLeaseMs: number;
}

export const DEFAULT_PROVIDER_HEALTH_POLICY: ProviderHealthPolicy = {
  transientFailureThreshold: 3,
  transientWindowMs: 5 * 60 * 1_000,
  transientCooldownMs: 2 * 60 * 1_000,
  probeLeaseMs: 30 * 1_000,
};

export interface ProviderHealthScope {
  scopeKey: string;
  scopeKind: ProviderHealthScopeKind;
  providerProfileId: string;
  catalogId: string | null;
}

export interface ProviderHealthStatus extends ProviderHealthScope {
  state: ProviderHealthState;
  reason: ProviderHealthReason | null;
  revision: number;
  consecutiveFailureCount: number;
  windowStartedAt: string | null;
  openedAt: string | null;
  cooldownUntil: string | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  lastAttemptId: string | null;
  lastProbeEvidenceId: string | null;
  probeLeaseOwner: string | null;
  probeLeaseExpiresAt: string | null;
  lastProbeAt: string | null;
  updatedAt: string;
}

export type ProviderHealthAdmissionResult =
  | { ok: true }
  | {
      ok: false;
      code: "provider_admission_closed" | "provider_admission_unavailable";
      error: string;
      retryable: true;
      scopeKey?: string;
      revision?: number;
    };

export class ProviderHealthOperationError extends Error {
  constructor(
    readonly code:
      | "healthy"
      | "cooldown_active"
      | "probe_active"
      | "probe_expired"
      | "stale_probe"
      | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "ProviderHealthOperationError";
  }
}

export interface ProviderHealthProbeLease {
  scopeKey: string;
  token: string;
  owner: string;
  revision: number;
  expiresAt: string;
}

export function providerHealthProviderScope(
  providerProfileId: string,
): ProviderHealthScope {
  return {
    scopeKey: `provider:${providerProfileId}`,
    scopeKind: "provider",
    providerProfileId,
    catalogId: null,
  };
}

export function providerHealthEntryScope(
  providerProfileId: string,
  catalogId: string,
): ProviderHealthScope {
  return {
    scopeKey: `entry:${catalogId}`,
    scopeKind: "entry",
    providerProfileId,
    catalogId,
  };
}

export async function assertProviderDispatchHealthInTransaction(
  tx: DrizzleTransaction,
  input: {
    providerProfileId: string;
    catalogId: string;
  },
): Promise<void> {
  const scopes = [
    providerHealthProviderScope(input.providerProfileId),
    providerHealthEntryScope(input.providerProfileId, input.catalogId),
  ];
  for (const scope of scopes) {
    const row = await loadDispatchState(tx, scope);
    if (row.state === "closed") continue;
    throw new ProviderCircuitOpenError(
      input.catalogId,
      row.scopeKey,
      row.revision,
      row.scopeKind === "provider",
    );
  }
}

async function loadDispatchState(
  tx: DrizzleTransaction,
  scope: ProviderHealthScope,
): Promise<HealthRow> {
  await tx.insert(schema.providerHealthStates).values(scope).onConflictDoNothing({
    target: schema.providerHealthStates.scopeKey,
  });
  const row = (await tx.select().from(schema.providerHealthStates)
    .where(eq(schema.providerHealthStates.scopeKey, scope.scopeKey))
    .limit(1)
    .for("share"))[0];
  if (!row) throw new Error("Provider health state disappeared");
  if (
    row.scopeKind !== scope.scopeKind
    || row.providerProfileId !== scope.providerProfileId
    || row.catalogId !== scope.catalogId
  ) {
    throw new Error("Provider health scope has conflicting immutable identity");
  }
  return row;
}

export async function recordProviderHealthOutcomeInTransaction(
  tx: DrizzleTransaction,
  input: {
    attemptId?: string;
    providerProfileId: string;
    catalogId: string | null;
    outcome: ProviderAttemptOutcome;
  },
  policy: ProviderHealthPolicy = DEFAULT_PROVIDER_HEALTH_POLICY,
): Promise<{
  circuit?: {
    scopeKey: string;
    revision: number;
    haltManifest: boolean;
  };
}> {
  const now = await databaseNow(tx);
  if (input.outcome.kind === "usable") {
    const scope = providerHealthProviderScope(input.providerProfileId);
    const row = await loadEffectiveState(tx, scope, now);
    if (row.state !== "closed" || row.consecutiveFailureCount === 0) return {};
    const updated = await updateHealthState(tx, row, {
      consecutiveFailureCount: 0,
      windowStartedAt: null,
      lastSuccessAt: now,
      updatedAt: now,
    });
    await appendHealthEvent(tx, updated, "success_recorded", row.state, {
      attemptId: input.attemptId,
    });
    return {};
  }

  const reason = breakerReason(input.outcome.kind);
  if (!reason) return {};
  const scope = reason === "configuration" && input.catalogId
    ? providerHealthEntryScope(input.providerProfileId, input.catalogId)
    : providerHealthProviderScope(input.providerProfileId);
  const row = await loadEffectiveState(tx, scope, now);

  // A call reserved before a newer open/probe may finish, but it cannot
  // overwrite that newer health revision.
  if (row.state !== "closed") {
    await appendHealthEvent(tx, row, "failure_recorded", row.state, {
      reason,
      attemptId: input.attemptId,
      safeMetadata: { ignoredAsStale: true, outcomeKind: input.outcome.kind },
    });
    return {
      circuit: {
        scopeKey: row.scopeKey,
        revision: row.revision,
        haltManifest: row.scopeKind === "provider",
      },
    };
  }

  const immediate = reason === "authentication" || reason === "configuration";
  const windowActive = row.windowStartedAt !== null
    && Date.parse(now) - Date.parse(row.windowStartedAt) <= policy.transientWindowMs;
  const nextCount = immediate
    ? 1
    : windowActive
      ? row.consecutiveFailureCount + 1
      : 1;
  const opens = immediate || nextCount >= policy.transientFailureThreshold;
  const nextRevision = row.revision + 1;
  const updated = await updateHealthState(tx, row, {
    state: opens ? "open" : "closed",
    reason,
    revision: nextRevision,
    consecutiveFailureCount: nextCount,
    windowStartedAt: immediate ? now : windowActive ? row.windowStartedAt : now,
    openedAt: opens ? now : null,
    cooldownUntil: opens && !immediate
      ? new Date(Date.parse(now) + policy.transientCooldownMs).toISOString()
      : null,
    lastFailureAt: now,
    lastAttemptId: input.attemptId,
    probeLeaseToken: null,
    probeLeaseOwner: null,
    probeLeaseExpiresAt: null,
    updatedAt: now,
  });
  await appendHealthEvent(
    tx,
    updated,
    opens ? "opened" : "failure_recorded",
    row.state,
    {
      reason,
      attemptId: input.attemptId,
      safeMetadata: { outcomeKind: input.outcome.kind, consecutiveFailureCount: nextCount },
    },
  );
  return opens
    ? {
        circuit: {
          scopeKey: updated.scopeKey,
          revision: updated.revision,
          haltManifest: updated.scopeKind === "provider",
        },
      }
    : {};
}

export async function getProviderCircuitForOutcomeInTransaction(
  tx: DrizzleTransaction,
  input: {
    providerProfileId: string;
    catalogId: string | null;
    outcome: ProviderAttemptOutcome;
  },
): Promise<{
  scopeKey: string;
  revision: number;
  haltManifest: boolean;
} | undefined> {
  if (input.outcome.kind === "usable") return undefined;
  const reason = breakerReason(input.outcome.kind);
  if (!reason) return undefined;
  const scope = reason === "configuration" && input.catalogId
    ? providerHealthEntryScope(input.providerProfileId, input.catalogId)
    : providerHealthProviderScope(input.providerProfileId);
  const row = await loadEffectiveState(tx, scope, await databaseNow(tx));
  if (row.state === "closed") return undefined;
  return {
    scopeKey: row.scopeKey,
    revision: row.revision,
    haltManifest: row.scopeKind === "provider",
  };
}

export async function checkDailyProviderAdmission(
  db: DrizzleDB,
  manifest: readonly ResolvedProviderManifestEntry[],
): Promise<ProviderHealthAdmissionResult> {
  try {
    return await db.transaction((tx) =>
      checkDailyProviderAdmissionInTransaction(tx, manifest));
  } catch {
    return {
      ok: false,
      code: "provider_admission_unavailable",
      error: "Daily game admission is temporarily unavailable",
      retryable: true,
    };
  }
}

export async function checkDailyProviderAdmissionInTransaction(
  tx: DrizzleTransaction,
  manifest: readonly ResolvedProviderManifestEntry[],
): Promise<ProviderHealthAdmissionResult> {
  const primary = manifest[0];
  if (!primary) {
    return {
      ok: false,
      code: "provider_admission_unavailable",
      error: "Daily game provider configuration is unavailable",
      retryable: true,
    };
  }
  const now = await databaseNow(tx);
  const scopes = [
    providerHealthProviderScope(primary.providerProfile.id),
    providerHealthEntryScope(primary.providerProfile.id, primary.catalogId),
  ];
  for (const scope of scopes) {
    const row = await loadEffectiveState(tx, scope, now);
    if (row.state === "closed") continue;
    return {
      ok: false,
      code: "provider_admission_closed",
      error: "Daily game starts are paused while the primary provider is unavailable",
      retryable: true,
      scopeKey: row.scopeKey,
      revision: row.revision,
    };
  }
  return { ok: true };
}

export async function acquireProviderHealthProbe(
  db: DrizzleDB,
  input: {
    scopeKey: string;
    owner: string;
    allowBeforeCooldown: boolean;
  },
  policy: ProviderHealthPolicy = DEFAULT_PROVIDER_HEALTH_POLICY,
): Promise<ProviderHealthProbeLease> {
  return db.transaction(async (tx) => {
    const now = await databaseNow(tx);
    let row = await loadExistingState(tx, input.scopeKey);
    if (!row) throw new ProviderHealthOperationError("not_found", "Provider health scope was not found");
    row = await expireProbeIfNeeded(tx, row, now);
    if (row.state === "closed") {
      throw new ProviderHealthOperationError("healthy", "Provider health is already closed");
    }
    if (row.state === "probing") {
      throw new ProviderHealthOperationError("probe_active", "A provider health probe is already active");
    }
    if (
      !input.allowBeforeCooldown
      && row.cooldownUntil
      && Date.parse(row.cooldownUntil) > Date.parse(now)
    ) {
      throw new ProviderHealthOperationError("cooldown_active", "Provider health cooldown is still active");
    }
    const token = randomUUID();
    const expiresAt = new Date(Date.parse(now) + policy.probeLeaseMs).toISOString();
    const updated = await updateHealthState(tx, row, {
      state: "probing",
      revision: row.revision + 1,
      probeLeaseToken: token,
      probeLeaseOwner: input.owner,
      probeLeaseExpiresAt: expiresAt,
      lastProbeAt: now,
      updatedAt: now,
    });
    await appendHealthEvent(tx, updated, "probe_started", row.state, {
      actor: input.owner,
    });
    return {
      scopeKey: updated.scopeKey,
      token,
      owner: input.owner,
      revision: updated.revision,
      expiresAt,
    };
  });
}

export async function completeProviderHealthProbe(
  db: DrizzleDB,
  input: ProviderHealthProbeLease & {
    outcome: ProviderAttemptOutcome;
    attemptId?: string;
    evidence?: ProviderAttemptRecord;
  },
  policy: ProviderHealthPolicy = DEFAULT_PROVIDER_HEALTH_POLICY,
): Promise<ProviderHealthStatus> {
  return db.transaction(async (tx) => {
    const now = await databaseNow(tx);
    const row = await loadExistingState(tx, input.scopeKey);
    if (!row) throw new ProviderHealthOperationError("not_found", "Provider health scope was not found");
    if (
      row.state !== "probing"
      || row.probeLeaseToken !== input.token
      || row.probeLeaseOwner !== input.owner
      || row.revision !== input.revision
    ) {
      throw new ProviderHealthOperationError("stale_probe", "Provider health probe lease changed");
    }
    if (!row.probeLeaseExpiresAt || Date.parse(row.probeLeaseExpiresAt) <= Date.parse(now)) {
      await expireProbeIfNeeded(tx, row, now);
      throw new ProviderHealthOperationError("probe_expired", "Provider health probe lease expired");
    }

    const succeeded = input.outcome.kind === "usable";
    const evidenceId = input.evidence
      ? sha256StableJson({
          domain: "influence.provider-health.probe-evidence.v1",
          scopeKey: input.scopeKey,
          leaseRevision: input.revision,
        })
      : null;
    if (input.evidence) {
      assertProbeEvidence(input.evidence, input);
      await tx.insert(schema.providerHealthProbeEvidence).values({
        id: evidenceId!,
        scopeKey: input.scopeKey,
        leaseRevision: input.revision,
        recordSha256: sha256StableJson(input.evidence),
        record: input.evidence,
      }).onConflictDoNothing({
        target: [
          schema.providerHealthProbeEvidence.scopeKey,
          schema.providerHealthProbeEvidence.leaseRevision,
        ],
      });
    }
    const nextReason = input.outcome.kind === "usable"
      ? null
      : breakerReason(input.outcome.kind) ?? row.reason;
    const transient = nextReason === "service_error"
      || nextReason === "transport_timeout"
      || nextReason === "transport_error";
    const updated = await updateHealthState(tx, row, {
      state: succeeded ? "closed" : "open",
      reason: nextReason,
      revision: row.revision + 1,
      consecutiveFailureCount: succeeded ? 0 : Math.max(1, row.consecutiveFailureCount),
      windowStartedAt: succeeded ? null : row.windowStartedAt ?? now,
      openedAt: succeeded ? null : row.openedAt ?? now,
      cooldownUntil: !succeeded && transient
        ? new Date(Date.parse(now) + policy.transientCooldownMs).toISOString()
        : null,
      lastFailureAt: succeeded ? row.lastFailureAt : now,
      lastSuccessAt: succeeded ? now : row.lastSuccessAt,
      lastAttemptId: input.attemptId ?? row.lastAttemptId,
      lastProbeEvidenceId: evidenceId ?? row.lastProbeEvidenceId,
      probeLeaseToken: null,
      probeLeaseOwner: null,
      probeLeaseExpiresAt: null,
      updatedAt: now,
    });
    await appendHealthEvent(
      tx,
      updated,
      succeeded ? "probe_succeeded" : "probe_failed",
      row.state,
      {
        ...(nextReason && { reason: nextReason }),
        ...(input.attemptId && { attemptId: input.attemptId }),
        actor: input.owner,
        safeMetadata: {
          outcomeKind: input.outcome.kind,
          ...(evidenceId && { probeEvidenceId: evidenceId }),
        },
      },
    );
    return projectHealthStatus(updated);
  });
}

export async function listProviderHealth(
  db: DrizzleDB,
): Promise<ProviderHealthStatus[]> {
  return db.transaction(async (tx) => {
    const now = await databaseNow(tx);
    const rows = await tx.select().from(schema.providerHealthStates)
      .orderBy(asc(schema.providerHealthStates.scopeKind), asc(schema.providerHealthStates.scopeKey));
    const statuses: ProviderHealthStatus[] = [];
    for (const row of rows) {
      statuses.push(projectHealthStatus(await expireProbeIfNeeded(tx, row, now)));
    }
    return statuses;
  });
}

async function loadEffectiveState(
  tx: DrizzleTransaction,
  scope: ProviderHealthScope,
  now: string,
): Promise<HealthRow> {
  let row = await loadExistingState(tx, scope.scopeKey);
  if (!row) {
    await tx.insert(schema.providerHealthStates).values(scope).onConflictDoNothing({
      target: schema.providerHealthStates.scopeKey,
    });
    row = await loadExistingState(tx, scope.scopeKey);
  }
  if (!row) throw new Error("Provider health state disappeared");
  if (
    row.scopeKind !== scope.scopeKind
    || row.providerProfileId !== scope.providerProfileId
    || row.catalogId !== scope.catalogId
  ) {
    throw new Error("Provider health scope has conflicting immutable identity");
  }
  return expireProbeIfNeeded(tx, row, now);
}

async function loadExistingState(
  tx: DrizzleTransaction,
  scopeKey: string,
): Promise<HealthRow | null> {
  return (await tx.select().from(schema.providerHealthStates)
    .where(eq(schema.providerHealthStates.scopeKey, scopeKey))
    .limit(1)
    .for("update"))[0] ?? null;
}

async function expireProbeIfNeeded(
  tx: DrizzleTransaction,
  row: HealthRow,
  now: string,
): Promise<HealthRow> {
  if (
    row.state !== "probing"
    || !row.probeLeaseExpiresAt
    || Date.parse(row.probeLeaseExpiresAt) > Date.parse(now)
  ) {
    return row;
  }
  const updated = await updateHealthState(tx, row, {
    state: "open",
    revision: row.revision + 1,
    probeLeaseToken: null,
    probeLeaseOwner: null,
    probeLeaseExpiresAt: null,
    updatedAt: now,
  });
  await appendHealthEvent(tx, updated, "probe_expired", row.state);
  return updated;
}

async function updateHealthState(
  tx: DrizzleTransaction,
  row: HealthRow,
  updates: Partial<typeof schema.providerHealthStates.$inferInsert>,
): Promise<HealthRow> {
  const updated = (await tx.update(schema.providerHealthStates).set(updates)
    .where(and(
      eq(schema.providerHealthStates.scopeKey, row.scopeKey),
      eq(schema.providerHealthStates.revision, row.revision),
    ))
    .returning())[0];
  if (!updated) throw new Error("Provider health state revision changed");
  return updated;
}

async function appendHealthEvent(
  tx: DrizzleTransaction,
  row: HealthRow,
  eventKind: (typeof schema.providerHealthEvents.$inferInsert)["eventKind"],
  fromState: ProviderHealthState | null,
  options: {
    reason?: ProviderHealthReason;
    attemptId?: string;
    actor?: string;
    safeMetadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  await tx.insert(schema.providerHealthEvents).values({
    scopeKey: row.scopeKey,
    eventKind,
    fromState,
    toState: row.state,
    reason: options.reason ?? row.reason,
    revision: row.revision,
    attemptId: options.attemptId,
    actor: options.actor,
    safeMetadata: options.safeMetadata,
  });
}

function breakerReason(kind: ProviderAttemptFailureKind): ProviderHealthReason | null {
  switch (kind) {
    case "authentication":
    case "configuration":
    case "service_error":
    case "transport_timeout":
    case "transport_error":
      return kind;
    default:
      return null;
  }
}

function projectHealthStatus(row: HealthRow): ProviderHealthStatus {
  return {
    scopeKey: row.scopeKey,
    scopeKind: row.scopeKind,
    providerProfileId: row.providerProfileId,
    catalogId: row.catalogId,
    state: row.state,
    reason: row.reason,
    revision: row.revision,
    consecutiveFailureCount: row.consecutiveFailureCount,
    windowStartedAt: row.windowStartedAt,
    openedAt: row.openedAt,
    cooldownUntil: row.cooldownUntil,
    lastFailureAt: row.lastFailureAt,
    lastSuccessAt: row.lastSuccessAt,
    lastAttemptId: row.lastAttemptId,
    lastProbeEvidenceId: row.lastProbeEvidenceId,
    probeLeaseOwner: row.probeLeaseOwner,
    probeLeaseExpiresAt: row.probeLeaseExpiresAt,
    lastProbeAt: row.lastProbeAt,
    updatedAt: row.updatedAt,
  };
}

const MAX_PROVIDER_HEALTH_PROBE_EVIDENCE_BYTES = 1_048_576;

function assertProbeEvidence(
  evidence: ProviderAttemptRecord,
  lease: ProviderHealthProbeLease & { outcome: ProviderAttemptOutcome },
): void {
  if (
    evidence.coordinate.action !== "provider_health_probe"
    || evidence.coordinate.logicalCallOrdinal !== lease.revision
    || evidence.coordinate.actor.id !== lease.owner
  ) {
    throw new Error("Provider health probe evidence does not match its lease");
  }
  if (evidence.outcome.kind !== lease.outcome.kind) {
    throw new Error("Provider health probe evidence outcome does not match completion");
  }
  const bytes = Buffer.byteLength(JSON.stringify(evidence), "utf8");
  if (bytes > MAX_PROVIDER_HEALTH_PROBE_EVIDENCE_BYTES) {
    throw new Error("Provider health probe evidence exceeds the private record limit");
  }
}

async function databaseNow(tx: DrizzleTransaction): Promise<string> {
  const row = (await tx.execute<{ now: string }>(sql`
    SELECT clock_timestamp()::text AS now
  `))[0];
  if (!row) throw new Error("Provider health database time is unavailable");
  return row.now;
}
