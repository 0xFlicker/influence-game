import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type {
  ProviderAttemptIntent,
  ProviderAttemptRecord,
  ProviderExecutionHooks,
  ProviderLogicalCallCoordinate,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { recordProviderSpendForAttempt } from "./provider-cost-accounting.js";
import {
  prepareProviderAttemptEvidence,
  PROVIDER_ATTEMPT_EVIDENCE_TYPE,
  writePreparedProviderAttemptObject,
  type PreparedProviderAttemptEvidence,
  type ProviderAttemptManifestMetadata,
  type WriteProviderAttemptEvidenceResult,
} from "./private-trace-writer.js";
import type { PrivateTraceStorageAdapter } from "./private-trace-storage.js";
import { sha256StableJson, stableJson } from "./stable-hash.js";

type AttemptRow = typeof schema.providerCallAttempts.$inferSelect;
type LogicalCallRow = typeof schema.providerLogicalCalls.$inferSelect;
type EvidenceOutboxRow = typeof schema.providerAttemptEvidenceOutbox.$inferSelect;

export interface ProviderEvidenceReconciliationDependencies {
  load?: (
    db: DrizzleDB,
    input: { attemptId?: string; limit: number },
  ) => Promise<EvidenceOutboxRow[]>;
  write?: (
    db: DrizzleDB,
    prepared: PreparedProviderAttemptEvidence,
    options: { storage?: PrivateTraceStorageAdapter },
  ) => Promise<WriteProviderAttemptEvidenceResult>;
  createManifest?: (
    db: DrizzleDB,
    row: EvidenceOutboxRow,
    written: Extract<WriteProviderAttemptEvidenceResult, { ok: true }>,
  ) => Promise<string>;
  finalize?: (
    db: DrizzleDB,
    row: EvidenceOutboxRow,
    manifestId: string,
  ) => Promise<void>;
  markDegraded?: (
    db: DrizzleDB,
    row: EvidenceOutboxRow,
    error: string,
  ) => Promise<void>;
}

export interface CreateApiProviderExecutionHooksOptions {
  gameId: string;
  ownerEpoch: string;
  evidenceStorage?: PrivateTraceStorageAdapter;
  projectSpend?: (
    db: DrizzleDB,
    attempt: AttemptRow,
    logicalCall: LogicalCallRow,
  ) => Promise<unknown>;
  evidenceDependencies?: ProviderEvidenceReconciliationDependencies;
}

export interface ProviderSpendReconciliationResult {
  attempted: number;
  projected: number;
  failed: number;
}

export interface ProviderSpendReconciliationDependencies {
  beforeProject?: (attempt: AttemptRow) => Promise<void> | void;
}

export interface ProviderEvidenceReconciliationResult {
  attempted: number;
  stored: number;
  failed: number;
}

function logicalCallId(
  coordinate: ProviderLogicalCallCoordinate,
  options: Pick<CreateApiProviderExecutionHooksOptions, "gameId">,
): string {
  return sha256StableJson({
    domain: "influence.provider.logical-call.v1",
    coordinate: {
      gameId: options.gameId,
      actor: coordinate.actor,
      action: coordinate.action,
      phase: coordinate.phase,
      round: coordinate.round,
      logicalCallOrdinal: coordinate.logicalCallOrdinal,
    },
  });
}

function attemptJournalId(callId: string, attemptOrdinal: number): string {
  return sha256StableJson({
    domain: "influence.provider.attempt.v1",
    logicalCallId: callId,
    attemptOrdinal,
  });
}

function reservationHash(intent: ProviderAttemptIntent): string {
  return sha256StableJson({
    coordinate: intent.coordinate,
    attemptOrdinal: intent.attemptOrdinal,
    preparedRequest: intent.preparedRequest,
    startedAt: intent.startedAt,
  });
}

function terminalHash(record: ProviderAttemptRecord): string {
  return sha256StableJson(record);
}

function assertCoordinate(
  intent: Pick<ProviderAttemptIntent, "coordinate"> | { coordinate: ProviderLogicalCallCoordinate },
  options: CreateApiProviderExecutionHooksOptions,
): void {
  if (intent.coordinate.gameId !== undefined && intent.coordinate.gameId !== options.gameId) {
    throw new Error("Provider attempt game id does not match journal authority");
  }
  if (intent.coordinate.ownerEpoch !== undefined && intent.coordinate.ownerEpoch !== options.ownerEpoch) {
    throw new Error("Provider attempt owner epoch does not match journal authority");
  }
}

function logicalCallIdentity(
  coordinate: ProviderLogicalCallCoordinate,
  gameId: string,
): Record<string, unknown> {
  return {
    gameId,
    actorId: coordinate.actor.id,
    actorName: coordinate.actor.name,
    actorRole: coordinate.actor.role,
    action: coordinate.action,
    phase: coordinate.phase,
    round: coordinate.round,
    logicalCallOrdinal: coordinate.logicalCallOrdinal,
  };
}

async function assertActiveOwner(
  tx: Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0],
  options: CreateApiProviderExecutionHooksOptions,
): Promise<void> {
  const owners = await tx.execute<{ status: string; expires_at: string | null }>(sql`
    SELECT status, expires_at
    FROM game_run_owners
    WHERE game_id = ${options.gameId}
      AND owner_epoch = ${options.ownerEpoch}
    FOR UPDATE
  `);
  const owner = owners[0];
  if (!owner) throw new Error("Provider journal owner not found");
  if (owner.status !== "active") throw new Error(`Provider journal owner is ${owner.status}`);
  if (owner.expires_at && new Date(owner.expires_at).getTime() <= Date.now()) {
    throw new Error("Provider journal owner expired");
  }
}

async function allocateAttemptOrdinal(
  db: DrizzleDB,
  options: CreateApiProviderExecutionHooksOptions,
  coordinate: ProviderLogicalCallCoordinate,
): Promise<number> {
  assertCoordinate({ coordinate }, options);
  const callId = logicalCallId(coordinate, options);
  const now = new Date().toISOString();
  return db.transaction(async (tx) => {
    await assertActiveOwner(tx, options);
    await tx.insert(schema.providerLogicalCalls).values({
      id: callId,
      gameId: options.gameId,
      actorId: coordinate.actor.id,
      actorName: coordinate.actor.name,
      actorRole: coordinate.actor.role,
      action: coordinate.action,
      phase: coordinate.phase,
      round: coordinate.round,
      logicalCallOrdinal: coordinate.logicalCallOrdinal,
      updatedAt: now,
    }).onConflictDoNothing({ target: schema.providerLogicalCalls.id });

    const existing = (await tx.select().from(schema.providerLogicalCalls)
      .where(eq(schema.providerLogicalCalls.id, callId)))[0];
    if (!existing || stableJson({
      gameId: existing.gameId,
      actorId: existing.actorId ?? undefined,
      actorName: existing.actorName,
      actorRole: existing.actorRole,
      action: existing.action,
      phase: existing.phase ?? undefined,
      round: existing.round ?? undefined,
      logicalCallOrdinal: existing.logicalCallOrdinal,
    }) !== stableJson(logicalCallIdentity(coordinate, options.gameId))) {
      throw new Error("Provider logical call id has conflicting immutable identity");
    }

    await tx.update(schema.providerCallAttempts).set({
      status: "indeterminate",
      indeterminateAt: now,
      indeterminateReason: "owner_lost_before_terminal",
      evidenceState: "not_required",
      spendProjectionState: "pending",
      spendProjectionError: null,
      updatedAt: now,
    }).where(and(
      eq(schema.providerCallAttempts.logicalCallId, callId),
      eq(schema.providerCallAttempts.status, "reserved"),
      ne(schema.providerCallAttempts.ownerEpoch, options.ownerEpoch),
    ));

    const allocated = (await tx.update(schema.providerLogicalCalls).set({
      nextAttemptOrdinal: sql`${schema.providerLogicalCalls.nextAttemptOrdinal} + 1`,
      updatedAt: now,
    }).where(eq(schema.providerLogicalCalls.id, callId)).returning({
      nextAttemptOrdinal: schema.providerLogicalCalls.nextAttemptOrdinal,
    }))[0];
    if (!allocated) throw new Error("Provider logical call ordinal allocation failed");
    return allocated.nextAttemptOrdinal - 1;
  });
}

async function reserveAttempt(
  db: DrizzleDB,
  options: CreateApiProviderExecutionHooksOptions,
  intent: ProviderAttemptIntent,
): Promise<void> {
  assertCoordinate(intent, options);
  const callId = logicalCallId(intent.coordinate, options);
  const attemptId = attemptJournalId(callId, intent.attemptOrdinal);
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await assertActiveOwner(tx, options);
    const existingCall = (await tx.select().from(schema.providerLogicalCalls)
      .where(eq(schema.providerLogicalCalls.id, callId)))[0];
    if (!existingCall) {
      throw new Error("Provider attempt ordinal was not allocated");
    }
    if (intent.attemptOrdinal >= existingCall.nextAttemptOrdinal) {
      throw new Error("Provider attempt ordinal was not durably allocated");
    }

    const inserted = await tx.insert(schema.providerCallAttempts).values({
      id: attemptId,
      logicalCallId: callId,
      gameId: options.gameId,
      ownerEpoch: options.ownerEpoch,
      attemptOrdinal: intent.attemptOrdinal,
      transportAttemptId: intent.attemptId,
      reservationHash: reservationHash(intent),
      requestShape: intent.preparedRequest.requestShape,
      providerProfileId: intent.preparedRequest.providerProfileId,
      catalogId: intent.preparedRequest.catalogId,
      modelName: intent.preparedRequest.model,
      startedAt: intent.startedAt,
      updatedAt: now,
    }).onConflictDoNothing({ target: schema.providerCallAttempts.id })
      .returning({ id: schema.providerCallAttempts.id });
    if (inserted.length === 0) {
      throw new Error(`Provider attempt ${attemptId} is already reserved`);
    }
  });
}

async function loadAttemptWithCall(
  db: DrizzleDB,
  attemptId: string,
): Promise<{ attempt: AttemptRow; logicalCall: LogicalCallRow }> {
  const row = (await db
    .select({
      attempt: schema.providerCallAttempts,
      logicalCall: schema.providerLogicalCalls,
    })
    .from(schema.providerCallAttempts)
    .innerJoin(
      schema.providerLogicalCalls,
      eq(schema.providerCallAttempts.logicalCallId, schema.providerLogicalCalls.id),
    )
    .where(eq(schema.providerCallAttempts.id, attemptId)))[0];
  if (!row) throw new Error("Provider attempt was not reserved");
  return row;
}

async function terminalizeAttempt(
  db: DrizzleDB,
  options: CreateApiProviderExecutionHooksOptions,
  record: ProviderAttemptRecord,
): Promise<{ attempt: AttemptRow; logicalCall: LogicalCallRow }> {
  assertCoordinate(record, options);
  const callId = logicalCallId(record.coordinate, options);
  const attemptId = attemptJournalId(callId, record.attemptOrdinal);
  const hash = terminalHash(record);
  const existing = await loadAttemptWithCall(db, attemptId);
  if (existing.attempt.status === "terminal") {
    if (existing.attempt.terminalHash !== hash) {
      throw new Error("Provider attempt terminal facts conflict with the journal");
    }
    return existing;
  }
  if (existing.attempt.reservationHash !== reservationHash(record)) {
    throw new Error("Provider attempt terminal facts do not match its reservation");
  }

  const evidenceState = record.outcome.kind === "rate_limit"
    ? "aggregated"
    : record.outcome.kind === "usable"
      ? "not_required"
      : "pending";
  const preparedEvidence =
    record.outcome.kind !== "usable" && record.outcome.kind !== "rate_limit"
      ? prepareProviderAttemptEvidence({
          gameId: options.gameId,
          ownerEpoch: options.ownerEpoch,
          logicalCallId: callId,
          attemptJournalId: attemptId,
          record,
        })
      : undefined;
  return db.transaction(async (tx) => {
    const rows = await tx.update(schema.providerCallAttempts).set({
      terminalHash: hash,
      status: "terminal",
      completedAt: record.completedAt,
      latencyMs: record.latencyMs,
      outcomeKind: record.outcome.kind,
      outcomeMessage: record.outcome.kind === "usable" ? null : record.outcome.message,
      retryable: record.outcome.kind === "usable" ? false : record.outcome.retryable,
      disposition: record.disposition,
      providerRequestId: record.requestId,
      accounting: record.accounting,
      evidenceState,
      spendProjectionState: "pending",
      spendProjectionError: null,
      updatedAt: record.completedAt,
    }).where(and(
      eq(schema.providerCallAttempts.id, attemptId),
      inArray(schema.providerCallAttempts.status, ["reserved", "indeterminate"]),
    )).returning();
    if (rows.length === 0) {
      const current = (await tx.select({
        attempt: schema.providerCallAttempts,
        logicalCall: schema.providerLogicalCalls,
      }).from(schema.providerCallAttempts).innerJoin(
        schema.providerLogicalCalls,
        eq(schema.providerCallAttempts.logicalCallId, schema.providerLogicalCalls.id),
      ).where(eq(schema.providerCallAttempts.id, attemptId)))[0];
      if (!current || current.attempt.status !== "terminal") {
        throw new Error("Provider attempt terminal update lost its reservation");
      }
      if (current.attempt.terminalHash !== hash) {
        throw new Error("Provider attempt terminal facts conflict with the journal");
      }
      return current;
    }

    if (preparedEvidence) {
      await tx.insert(schema.providerAttemptEvidenceOutbox).values({
        attemptId,
        logicalCallId: callId,
        gameId: options.gameId,
        ownerEpoch: options.ownerEpoch,
        body: preparedEvidence.body,
        bodySha256: preparedEvidence.bodySha256,
        byteLength: preparedEvidence.byteLength,
        storageKey: preparedEvidence.storageKey,
        manifestId: preparedEvidence.manifestId,
        manifestMetadata: preparedEvidence.metadata as unknown as Record<string, unknown>,
        updatedAt: record.completedAt,
      });
    }

    if (record.outcome.kind === "rate_limit") {
      await tx.update(schema.providerLogicalCalls).set({
        rateLimitCount: sql`${schema.providerLogicalCalls.rateLimitCount} + 1`,
        rateLimitOutcome: record.disposition === "exhausted" ? "exhausted" : "pending",
        rateLimitTerminalReason: record.disposition === "exhausted" ? record.outcome.message : null,
        updatedAt: record.completedAt,
      }).where(eq(schema.providerLogicalCalls.id, callId));
    } else {
      await tx.update(schema.providerLogicalCalls).set({
        rateLimitOutcome: sql`CASE
          WHEN ${schema.providerLogicalCalls.rateLimitCount} > 0
            AND ${schema.providerLogicalCalls.rateLimitOutcome} = 'pending'
          THEN 'recovered'
          ELSE ${schema.providerLogicalCalls.rateLimitOutcome}
        END`,
        updatedAt: record.completedAt,
      }).where(eq(schema.providerLogicalCalls.id, callId));
    }
    const logicalCall = (await tx.select().from(schema.providerLogicalCalls)
      .where(eq(schema.providerLogicalCalls.id, callId)))[0];
    if (!logicalCall) throw new Error("Provider logical call disappeared during terminalization");
    return { attempt: rows[0]!, logicalCall };
  });
}

async function defaultProjectSpend(
  db: DrizzleDB,
  attempt: AttemptRow,
  logicalCall: LogicalCallRow,
): Promise<unknown> {
  if (attempt.status === "indeterminate") {
    if (!attempt.indeterminateAt || !attempt.indeterminateReason) {
      throw new Error("Indeterminate provider attempt lacks recovery facts");
    }
    return recordProviderSpendForAttempt(db, {
      id: attempt.id,
      logicalCallId: attempt.logicalCallId,
      gameId: attempt.gameId,
      ownerEpoch: attempt.ownerEpoch,
      attemptOrdinal: attempt.attemptOrdinal,
      actorId: logicalCall.actorId,
      actorName: logicalCall.actorName,
      actorRole: logicalCall.actorRole,
      action: logicalCall.action,
      phase: logicalCall.phase,
      round: logicalCall.round,
      requestShape: attempt.requestShape as "chat_completions" | "responses",
      providerProfileId: attempt.providerProfileId,
      catalogId: attempt.catalogId,
      modelName: attempt.modelName,
      completedAt: attempt.indeterminateAt,
      outcomeKind: "indeterminate",
      attemptStatus: "indeterminate",
      indeterminateReason: attempt.indeterminateReason,
    });
  }
  if (attempt.status !== "terminal" || !attempt.completedAt || attempt.latencyMs == null || !attempt.outcomeKind) {
    throw new Error("Provider attempt is not terminal");
  }
  return recordProviderSpendForAttempt(db, {
    id: attempt.id,
    logicalCallId: attempt.logicalCallId,
    gameId: attempt.gameId,
    ownerEpoch: attempt.ownerEpoch,
    attemptOrdinal: attempt.attemptOrdinal,
    actorId: logicalCall.actorId,
    actorName: logicalCall.actorName,
    actorRole: logicalCall.actorRole,
    action: logicalCall.action,
    phase: logicalCall.phase,
    round: logicalCall.round,
    requestShape: attempt.requestShape as "chat_completions" | "responses",
    providerProfileId: attempt.providerProfileId,
    catalogId: attempt.catalogId,
    modelName: attempt.modelName,
    completedAt: attempt.completedAt,
    latencyMs: attempt.latencyMs,
    outcomeKind: attempt.outcomeKind,
    attemptStatus: "terminal",
    providerRequestId: attempt.providerRequestId,
    accounting: attempt.accounting,
  });
}

async function projectAttemptSpend(
  db: DrizzleDB,
  attempt: AttemptRow,
  logicalCall: LogicalCallRow,
  projector = defaultProjectSpend,
): Promise<boolean> {
  try {
    await projector(db, attempt, logicalCall);
    await db.update(schema.providerCallAttempts).set({
      spendProjectionState: "projected",
      spendProjectionError: null,
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.providerCallAttempts.id, attempt.id));
    return true;
  } catch (error) {
    try {
      await db.update(schema.providerCallAttempts).set({
        spendProjectionState: "failed",
        spendProjectionError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      }).where(eq(schema.providerCallAttempts.id, attempt.id));
    } catch {
      // The terminal journal remains authoritative and pending reconciliation.
    }
    return false;
  }
}

async function loadEvidenceOutboxRows(
  db: DrizzleDB,
  input: { attemptId?: string; limit: number },
): Promise<EvidenceOutboxRow[]> {
  const query = db.select().from(schema.providerAttemptEvidenceOutbox)
    .where(input.attemptId
      ? eq(schema.providerAttemptEvidenceOutbox.attemptId, input.attemptId)
      : undefined)
    .orderBy(schema.providerAttemptEvidenceOutbox.createdAt)
    .limit(input.limit);
  return query;
}

function preparedEvidenceFromOutbox(
  row: EvidenceOutboxRow,
): PreparedProviderAttemptEvidence {
  const metadata = row.manifestMetadata as unknown as ProviderAttemptManifestMetadata;
  return {
    gameId: row.gameId,
    ownerEpoch: row.ownerEpoch,
    logicalCallId: row.logicalCallId,
    attemptJournalId: row.attemptId,
    attemptOrdinal: metadata.attemptOrdinal,
    body: row.body,
    bodySha256: row.bodySha256,
    byteLength: row.byteLength,
    storageKey: row.storageKey,
    manifestId: row.manifestId,
    metadata,
  };
}

async function finalizeEvidenceOutbox(
  db: DrizzleDB,
  row: EvidenceOutboxRow,
  manifestId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx.update(schema.providerCallAttempts).set({
      evidenceState: "stored",
      evidenceManifestId: manifestId,
      evidenceError: null,
      updatedAt: new Date().toISOString(),
    }).where(and(
      eq(schema.providerCallAttempts.id, row.attemptId),
      eq(schema.providerCallAttempts.gameId, row.gameId),
      inArray(schema.providerCallAttempts.evidenceState, ["pending", "degraded"]),
    )).returning({ id: schema.providerCallAttempts.id });
    if (updated.length === 0) {
      const existing = (await tx.select({
        evidenceState: schema.providerCallAttempts.evidenceState,
        evidenceManifestId: schema.providerCallAttempts.evidenceManifestId,
      }).from(schema.providerCallAttempts).where(and(
        eq(schema.providerCallAttempts.id, row.attemptId),
        eq(schema.providerCallAttempts.gameId, row.gameId),
      )))[0];
      if (existing?.evidenceState !== "stored" || existing.evidenceManifestId !== manifestId) {
        throw new Error("Provider evidence attempt state could not be finalized");
      }
    }
    await tx.delete(schema.providerAttemptEvidenceOutbox)
      .where(eq(schema.providerAttemptEvidenceOutbox.attemptId, row.attemptId));
  });
}

function providerAttemptManifestValues(
  row: EvidenceOutboxRow,
  written: Extract<WriteProviderAttemptEvidenceResult, { ok: true }>,
) {
  return {
    id: row.manifestId,
    gameId: row.gameId,
    ownerEpoch: row.ownerEpoch,
    evidenceType: PROVIDER_ATTEMPT_EVIDENCE_TYPE,
    retentionClass: "debug",
    accessScope: "producer_admin" as const,
    storageProvider: written.storage.provider,
    storageBucket: written.storage.bucket,
    storageKey: written.storage.key,
    sourcePointers: [{
      kind: "provider_attempt_failure",
      logicalCallId: row.logicalCallId,
      attemptJournalId: row.attemptId,
      attemptOrdinal: (row.manifestMetadata as unknown as ProviderAttemptManifestMetadata)
        .attemptOrdinal,
    }],
    metadata: row.manifestMetadata,
  } as const;
}

async function createEvidenceManifestFromOutbox(
  db: DrizzleDB,
  row: EvidenceOutboxRow,
  written: Extract<WriteProviderAttemptEvidenceResult, { ok: true }>,
): Promise<string> {
  const values = providerAttemptManifestValues(row, written);
  await db.transaction(async (tx) => {
    const outbox = (await tx.select({ attemptId: schema.providerAttemptEvidenceOutbox.attemptId })
      .from(schema.providerAttemptEvidenceOutbox)
      .where(eq(schema.providerAttemptEvidenceOutbox.attemptId, row.attemptId)))[0];
    if (!outbox) {
      const attempt = (await tx.select({
        evidenceState: schema.providerCallAttempts.evidenceState,
        evidenceManifestId: schema.providerCallAttempts.evidenceManifestId,
      }).from(schema.providerCallAttempts).where(and(
        eq(schema.providerCallAttempts.id, row.attemptId),
        eq(schema.providerCallAttempts.gameId, row.gameId),
      )))[0];
      if (attempt?.evidenceState !== "stored" || attempt.evidenceManifestId !== row.manifestId) {
        throw new Error("Provider evidence outbox authority disappeared");
      }
      await assertMatchingEvidenceManifest(tx, row.manifestId, values);
      return;
    }

    const inserted = await tx.insert(schema.gameEvidenceManifests).values(values)
      .onConflictDoNothing({ target: schema.gameEvidenceManifests.id })
      .returning({ id: schema.gameEvidenceManifests.id });
    if (inserted.length > 0) return;

    await assertMatchingEvidenceManifest(tx, row.manifestId, values);
  });
  return row.manifestId;
}

async function assertMatchingEvidenceManifest(
  tx: Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0],
  manifestId: string,
  values: ReturnType<typeof providerAttemptManifestValues>,
): Promise<void> {
    const existing = (await tx.select().from(schema.gameEvidenceManifests)
      .where(eq(schema.gameEvidenceManifests.id, manifestId)))[0];
    if (!existing) throw new Error("Provider evidence manifest conflict could not be resolved");
    const existingIdentity = {
      gameId: existing.gameId,
      ownerEpoch: existing.ownerEpoch,
      evidenceType: existing.evidenceType,
      retentionClass: existing.retentionClass,
      accessScope: existing.accessScope,
      storageProvider: existing.storageProvider ?? undefined,
      storageBucket: existing.storageBucket ?? undefined,
      storageKey: existing.storageKey ?? undefined,
      sourcePointers: existing.sourcePointers ?? undefined,
      metadata: existing.metadata,
    };
    const expectedIdentity = {
      gameId: values.gameId,
      ownerEpoch: values.ownerEpoch,
      evidenceType: values.evidenceType,
      retentionClass: values.retentionClass,
      accessScope: values.accessScope,
      storageProvider: values.storageProvider,
      storageBucket: values.storageBucket,
      storageKey: values.storageKey,
      sourcePointers: values.sourcePointers,
      metadata: values.metadata,
    };
    if (stableJson(existingIdentity) !== stableJson(expectedIdentity)) {
      throw new Error("Provider evidence manifest has conflicting immutable identity");
    }
}

async function markEvidenceOutboxDegraded(
  db: DrizzleDB,
  row: EvidenceOutboxRow,
  error: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx.update(schema.providerCallAttempts).set({
      evidenceState: "degraded",
      evidenceError: error,
      updatedAt: new Date().toISOString(),
    }).where(and(
      eq(schema.providerCallAttempts.id, row.attemptId),
      inArray(schema.providerCallAttempts.evidenceState, ["pending", "degraded"]),
      sql`EXISTS (
        SELECT 1 FROM ${schema.providerAttemptEvidenceOutbox}
        WHERE ${schema.providerAttemptEvidenceOutbox.attemptId} = ${row.attemptId}
      )`,
    )).returning({ id: schema.providerCallAttempts.id });
    if (updated.length === 0) return;
    await tx.update(schema.providerLogicalCalls).set({
      diagnosticsDegraded: true,
      evidenceFailureCount: sql`${schema.providerLogicalCalls.evidenceFailureCount} + 1`,
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.providerLogicalCalls.id, row.logicalCallId));
  });
}

export async function reconcileProviderAttemptEvidence(
  db: DrizzleDB,
  options: {
    attemptId?: string;
    limit?: number;
    evidenceStorage?: PrivateTraceStorageAdapter;
    dependencies?: ProviderEvidenceReconciliationDependencies;
  } = {},
): Promise<ProviderEvidenceReconciliationResult> {
  const limit = Math.max(1, Math.min(1_000, Math.floor(options.limit ?? 100)));
  const load = options.dependencies?.load ?? loadEvidenceOutboxRows;
  const write = options.dependencies?.write ?? writePreparedProviderAttemptObject;
  const createManifest = options.dependencies?.createManifest ??
    createEvidenceManifestFromOutbox;
  const finalize = options.dependencies?.finalize ?? finalizeEvidenceOutbox;
  const markDegraded = options.dependencies?.markDegraded ?? markEvidenceOutboxDegraded;
  let rows: EvidenceOutboxRow[];
  try {
    rows = await load(db, { attemptId: options.attemptId, limit });
  } catch {
    return { attempted: 0, stored: 0, failed: 1 };
  }

  let stored = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const result = await write(db, preparedEvidenceFromOutbox(row), {
        storage: options.evidenceStorage,
      });
      if (!result.ok) {
        failed += 1;
        try {
          await markDegraded(db, row, result.error);
        } catch {
          // The durable outbox remains pending for a later reconciliation.
        }
        continue;
      }
      const manifestId = await createManifest(db, row, result);
      await finalize(db, row, manifestId);
      stored += 1;
    } catch (error) {
      failed += 1;
      try {
        await markDegraded(
          db,
          row,
          error instanceof Error ? error.message : String(error),
        );
      } catch {
        // The durable outbox remains pending for a later reconciliation.
      }
    }
  }
  return { attempted: rows.length, stored, failed };
}

export function createApiProviderExecutionHooks(
  db: DrizzleDB,
  options: CreateApiProviderExecutionHooksOptions,
): ProviderExecutionHooks {
  return {
    onAllocateAttemptOrdinal: (coordinate) =>
      allocateAttemptOrdinal(db, options, coordinate),
    onReserve: (intent) => reserveAttempt(db, options, intent),
    onTerminal: async (record) => {
      const journaled = await terminalizeAttempt(db, options, record);
      if (journaled.attempt.evidenceState !== "stored") {
        await reconcileProviderAttemptEvidence(db, {
          attemptId: journaled.attempt.id,
          limit: 1,
          evidenceStorage: options.evidenceStorage,
          dependencies: options.evidenceDependencies,
        });
      }
      if (journaled.attempt.spendProjectionState !== "projected") {
        await projectAttemptSpend(
          db,
          journaled.attempt,
          journaled.logicalCall,
          options.projectSpend ?? defaultProjectSpend,
        );
      }
    },
  };
}

export async function reconcileProviderAttemptSpend(
  db: DrizzleDB,
  limit = 100,
  dependencies: ProviderSpendReconciliationDependencies = {},
): Promise<ProviderSpendReconciliationResult> {
  const rows = await db.select({
    attempt: schema.providerCallAttempts,
    logicalCall: schema.providerLogicalCalls,
  }).from(schema.providerCallAttempts)
    .innerJoin(
      schema.providerLogicalCalls,
      eq(schema.providerCallAttempts.logicalCallId, schema.providerLogicalCalls.id),
    )
    .where(and(
      inArray(schema.providerCallAttempts.status, ["indeterminate", "terminal"]),
      inArray(schema.providerCallAttempts.spendProjectionState, ["pending", "failed"]),
    ))
    .limit(Math.max(1, Math.min(1_000, Math.floor(limit))));

  let projected = 0;
  for (const row of rows) {
    await dependencies.beforeProject?.(row.attempt);
    if (await projectAttemptSpend(db, row.attempt, row.logicalCall)) projected += 1;
  }
  return {
    attempted: rows.length,
    projected,
    failed: rows.length - projected,
  };
}

export interface ProviderAttemptReconciliationRuntime {
  runOnce(): Promise<{
    evidence: ProviderEvidenceReconciliationResult;
    spend: ProviderSpendReconciliationResult;
  }>;
  stop(): Promise<void>;
}

/**
 * Extends reconciliation ownership across the rest of background startup. If
 * any later startup step fails before a composite stop handle can be returned,
 * the already-started reconciliation timer is still torn down.
 */
export async function finishRuntimeStartupWithProviderAttemptReconciliation<T>(
  reconciliation: ProviderAttemptReconciliationRuntime,
  finishStartup: () => Promise<T>,
): Promise<T> {
  try {
    return await finishStartup();
  } catch (error) {
    await reconciliation.stop();
    throw error;
  }
}

/**
 * Active-runtime reconciliation for durable attempt work left by an earlier
 * process. Runtime activation owns the lifecycle; validation-only candidates
 * never call this until durable acceptance starts their background runtime.
 */
export async function startProviderAttemptReconciliationRuntime(
  db: DrizzleDB,
  options: {
    intervalMs?: number;
    limit?: number;
    signal?: AbortSignal;
    evidenceStorage?: PrivateTraceStorageAdapter;
    logger?: Pick<Console, "warn">;
  } = {},
): Promise<ProviderAttemptReconciliationRuntime> {
  const intervalMs = Math.max(1_000, Math.floor(options.intervalMs ?? 15_000));
  const limit = Math.max(1, Math.min(1_000, Math.floor(options.limit ?? 100)));
  const logger = options.logger ?? console;
  let stopped = false;
  let stopPromise: Promise<void> | null = null;
  let inFlight: Promise<{
    evidence: ProviderEvidenceReconciliationResult;
    spend: ProviderSpendReconciliationResult;
  }> | null = null;

  const runOnce = () => {
    if (stopped || options.signal?.aborted) {
      return Promise.resolve({
        evidence: { attempted: 0, stored: 0, failed: 0 },
        spend: { attempted: 0, projected: 0, failed: 0 },
      });
    }
    if (inFlight) return inFlight;
    inFlight = Promise.all([
      reconcileProviderAttemptEvidence(db, {
        limit,
        evidenceStorage: options.evidenceStorage,
      }).catch((error) => {
        logger.warn("[provider-journal] Evidence reconciliation deferred", error);
        return { attempted: 0, stored: 0, failed: 1 };
      }),
      reconcileProviderAttemptSpend(db, limit).catch((error) => {
        logger.warn("[provider-journal] Spend reconciliation deferred", error);
        return { attempted: 0, projected: 0, failed: 1 };
      }),
    ]).then(([evidence, spend]) => ({ evidence, spend })).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  await runOnce();
  let timer: ReturnType<typeof setInterval> | null = null;
  if (!options.signal?.aborted) {
    timer = setInterval(() => {
      void runOnce();
    }, intervalMs);
    timer.unref();
  } else {
    stopped = true;
  }

  const stop = () => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      stopped = true;
      if (timer) clearInterval(timer);
      options.signal?.removeEventListener("abort", onAbort);
      await inFlight;
    })();
    return stopPromise;
  };
  const onAbort = () => {
    void stop();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  return { runOnce, stop };
}
