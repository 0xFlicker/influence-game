import { createHash, randomUUID } from "crypto";
import type {
  PrivateDecisionTrace,
  PrivateDecisionTraceBoundary,
  ProviderAttemptRecord,
} from "@influence/engine";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { assertPrivateContentStoragePointer, createEvidenceManifest, markEvidenceDegraded } from "./game-evidence.js";
import {
  createPrivateTraceStorageAdapter,
  getPrivateTraceBucket,
  PRIVATE_TRACE_CONTENT_TYPE,
  PRIVATE_TRACE_STORAGE_PROVIDER,
  type PrivateTraceStorageAdapter,
} from "./private-trace-storage.js";

export const PRIVATE_TRACE_EVIDENCE_TYPE = "private_decision_trace";
export const PROVIDER_ATTEMPT_EVIDENCE_TYPE = "provider_attempt_failure";

export interface WritePrivateTraceInput {
  gameId: string;
  ownerEpoch: string;
  trace: PrivateDecisionTrace;
  eventSequence?: number;
  expiresAt?: string;
}

export interface PrivateTraceWriteOptions {
  storage?: PrivateTraceStorageAdapter;
  now?: () => Date;
}

export interface WriteProviderAttemptEvidenceInput {
  gameId: string;
  ownerEpoch: string;
  logicalCallId: string;
  attemptJournalId: string;
  record: ProviderAttemptRecord;
}

export interface PreparedProviderAttemptEvidence {
  gameId: string;
  ownerEpoch: string;
  logicalCallId: string;
  attemptJournalId: string;
  attemptOrdinal: number;
  body: string;
  bodySha256: string;
  byteLength: number;
  storageKey: string;
  manifestId: string;
  metadata: ProviderAttemptManifestMetadata;
}

export type WritePrivateTraceResult =
  | {
    ok: true;
    manifestId: string;
    storage: {
      provider: typeof PRIVATE_TRACE_STORAGE_PROVIDER;
      bucket: string;
      key: string;
    };
    metadata: PrivateTraceManifestMetadata;
  }
  | { ok: false; error: string };

export interface ProviderAttemptManifestMetadata {
  formatVersion: 1;
  contentType: typeof PRIVATE_TRACE_CONTENT_TYPE;
  byteLength: number;
  recordCount: 1;
  sha256: string;
  actor: ProviderAttemptRecord["coordinate"]["actor"];
  action: string;
  phase?: string;
  round?: number;
  model: {
    name: string;
    providerProfileId: string;
    catalogId?: string;
  };
  modelName: string;
  outcomeKind: ProviderAttemptRecord["outcome"]["kind"];
  disposition: ProviderAttemptRecord["disposition"];
  attemptOrdinal: number;
  logicalCallId: string;
  createdAt: string;
}

export type WriteProviderAttemptEvidenceResult =
  | {
      ok: true;
      manifestId: string;
      storage: {
        provider: typeof PRIVATE_TRACE_STORAGE_PROVIDER;
        bucket: string;
        key: string;
      };
      metadata: ProviderAttemptManifestMetadata;
    }
  | { ok: false; error: string };

export interface PrivateTraceManifestMetadata {
  formatVersion: 2;
  contentType: typeof PRIVATE_TRACE_CONTENT_TYPE;
  byteLength: number;
  recordCount: 1;
  sha256: string;
  actor: {
    id?: string;
    name: string;
    role: string;
  };
  action: string;
  phase?: string;
  round?: number;
  model: {
    name: string;
    provider?: string;
    providerProfileId?: string;
    catalogId?: string;
  };
  modelName: string;
  effectiveServiceTier?: string;
  requestedReasoningEffort?: string;
  reasoningPolicy?: string;
  promptMessageCount: number;
  promptByteLength: number;
  requestByteLength: number;
  responseByteLength: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    cachedTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
    routerBilling?: Record<string, unknown>;
    diagnostics?: string[];
  };
  toolArgumentByteLength: number;
  emittedThinkingByteLength: number;
  reasoningContextByteLength: number;
  providerReasoningSummaryByteLength: number;
  toolName?: string;
  strategyCandidate?: {
    operation: "replace" | "delta";
    submittedValueByteLength: number;
  };
  boundary?: PrivateDecisionTraceBoundary;
  createdAt: string;
}

function sha256Text(body: string): string {
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

function byteLength(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

function sanitizeKeyPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "trace";
}

function traceStorageKey(gameId: string, trace: PrivateDecisionTrace, now: Date): string {
  const roundPart = trace.round === undefined ? "round-unknown" : `round-${trace.round}`;
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const actor = sanitizeKeyPart(trace.actor.name);
  const action = sanitizeKeyPart(trace.action);
  return `content/${gameId}/private-traces/${roundPart}/${timestamp}-${actor}-${action}-${randomUUID()}.json`;
}

function buildTraceMetadata(trace: PrivateDecisionTrace, body: string, createdAt: string): PrivateTraceManifestMetadata {
  const rawResponse = trace.response.raw && typeof trace.response.raw === "object" && !Array.isArray(trace.response.raw)
    ? trace.response.raw as Record<string, unknown>
    : undefined;
  const effectiveServiceTier = trace.model.provider === "openai" && typeof rawResponse?.service_tier === "string"
    ? rawResponse.service_tier
    : undefined;
  return {
    formatVersion: 2,
    contentType: PRIVATE_TRACE_CONTENT_TYPE,
    byteLength: Buffer.byteLength(body, "utf8"),
    recordCount: 1,
    sha256: sha256Text(body),
    actor: {
      ...(trace.actor.id && { id: trace.actor.id }),
      name: trace.actor.name,
      role: trace.actor.role,
    },
    action: trace.action,
    ...(trace.phase && { phase: trace.phase }),
    ...(trace.round !== undefined && { round: trace.round }),
    model: {
      name: trace.model.name,
      ...(trace.model.provider && { provider: trace.model.provider }),
      ...(trace.model.providerProfileId && { providerProfileId: trace.model.providerProfileId }),
      ...(trace.model.catalogId && { catalogId: trace.model.catalogId }),
    },
    modelName: trace.model.name,
    ...(effectiveServiceTier && { effectiveServiceTier }),
    ...(trace.requestedReasoningEffort && { requestedReasoningEffort: trace.requestedReasoningEffort }),
    ...(trace.reasoningPolicy && { reasoningPolicy: trace.reasoningPolicy }),
    promptMessageCount: trace.prompt.messages.length,
    promptByteLength: byteLength(trace.prompt),
    requestByteLength: byteLength(trace.request),
    responseByteLength: byteLength(trace.response),
    ...(trace.usage && { usage: trace.usage }),
    toolArgumentByteLength: byteLength(trace.toolArguments),
    emittedThinkingByteLength: byteLength(trace.emittedThinking),
    reasoningContextByteLength: byteLength(trace.reasoningContext),
    providerReasoningSummaryByteLength: byteLength(trace.providerReasoningSummary),
    ...(trace.toolName && { toolName: trace.toolName }),
    ...(trace.strategyCandidate && {
      strategyCandidate: {
        operation: trace.strategyCandidate.operation,
        submittedValueByteLength: byteLength(trace.strategyCandidate.submittedValue),
      },
    }),
    ...(trace.boundary && { boundary: trace.boundary }),
    createdAt,
  };
}

function sourcePointersForTrace(trace: PrivateDecisionTrace): ReadonlyArray<Record<string, unknown>> {
  const pointers: Record<string, unknown>[] = [];
  if (trace.boundary?.sourcePointer) {
    pointers.push(trace.boundary.sourcePointer as unknown as Record<string, unknown>);
  }
  pointers.push({
    kind: "private_decision_trace",
    actorId: trace.actor.id,
    actorName: trace.actor.name,
    action: trace.action,
    phase: trace.phase,
    round: trace.round,
  });
  return pointers;
}

export async function writePrivateDecisionTrace(
  db: DrizzleDB,
  input: WritePrivateTraceInput,
  options: PrivateTraceWriteOptions = {},
): Promise<WritePrivateTraceResult> {
  const now = options.now?.() ?? new Date();
  const createdAt = now.toISOString();
  const body = JSON.stringify({
    ...input.trace,
    gameId: input.gameId,
    ownerEpoch: input.ownerEpoch,
    createdAt: input.trace.createdAt || createdAt,
  }, null, 2);

  const bucket = getPrivateTraceBucket();
  const key = traceStorageKey(input.gameId, input.trace, now);
  const storage: {
    provider: typeof PRIVATE_TRACE_STORAGE_PROVIDER;
    bucket: string;
    key: string;
  } = {
    provider: PRIVATE_TRACE_STORAGE_PROVIDER,
    bucket,
    key,
  };
  const metadata = buildTraceMetadata(input.trace, body, createdAt);

  try {
    assertPrivateContentStoragePointer(storage);
    const adapter = options.storage ?? createPrivateTraceStorageAdapter();
    await adapter.putObject({
      bucket,
      key,
      body,
      contentType: PRIVATE_TRACE_CONTENT_TYPE,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markEvidenceDegraded(db, input.gameId, input.ownerEpoch, `private_trace_storage_failed: ${message}`).catch(() => {});
    return { ok: false, error: message };
  }

  const manifest = await createEvidenceManifest(db, {
    gameId: input.gameId,
    ownerEpoch: input.ownerEpoch,
    eventSequence: input.eventSequence,
    decisionId: input.trace.decisionId,
    evidenceType: PRIVATE_TRACE_EVIDENCE_TYPE,
    retentionClass: "debug",
    accessScope: "producer_admin",
    expiresAt: input.expiresAt,
    storage,
    sourcePointers: sourcePointersForTrace(input.trace),
    metadata: metadata as unknown as Record<string, unknown>,
  });
  if (!manifest.ok) {
    return { ok: false, error: manifest.error };
  }

  return {
    ok: true,
    manifestId: manifest.manifestId,
    storage,
    metadata,
  };
}

function providerAttemptStorageKey(
  gameId: string,
  logicalCallId: string,
  attemptOrdinal: number,
): string {
  const safeLogicalCallId = logicalCallId.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `content/${gameId}/provider-attempts/${safeLogicalCallId}/attempt-${attemptOrdinal}.json`;
}

function providerAttemptManifestId(attemptJournalId: string): string {
  return `provider-attempt:${createHash("sha256").update(attemptJournalId).digest("hex")}`;
}

export function prepareProviderAttemptEvidence(
  input: WriteProviderAttemptEvidenceInput,
): PreparedProviderAttemptEvidence {
  const body = JSON.stringify({
    gameId: input.gameId,
    ownerEpoch: input.ownerEpoch,
    logicalCallId: input.logicalCallId,
    attemptJournalId: input.attemptJournalId,
    attempt: input.record,
  }, null, 2);
  const bodySha256 = sha256Text(body);
  const byteLength = Buffer.byteLength(body, "utf8");
  const metadata = {
    formatVersion: 1,
    contentType: PRIVATE_TRACE_CONTENT_TYPE,
    byteLength,
    recordCount: 1,
    sha256: bodySha256,
    actor: input.record.coordinate.actor,
    action: input.record.coordinate.action,
    phase: input.record.coordinate.phase,
    round: input.record.coordinate.round,
    model: {
      name: input.record.preparedRequest.model,
      providerProfileId: input.record.preparedRequest.providerProfileId,
      catalogId: input.record.preparedRequest.catalogId,
    },
    modelName: input.record.preparedRequest.model,
    outcomeKind: input.record.outcome.kind,
    disposition: input.record.disposition,
    attemptOrdinal: input.record.attemptOrdinal,
    logicalCallId: input.logicalCallId,
    createdAt: input.record.completedAt,
  } satisfies ProviderAttemptManifestMetadata;
  return {
    gameId: input.gameId,
    ownerEpoch: input.ownerEpoch,
    logicalCallId: input.logicalCallId,
    attemptJournalId: input.attemptJournalId,
    attemptOrdinal: input.record.attemptOrdinal,
    body,
    bodySha256,
    byteLength,
    storageKey: providerAttemptStorageKey(
      input.gameId,
      input.logicalCallId,
      input.record.attemptOrdinal,
    ),
    manifestId: providerAttemptManifestId(input.attemptJournalId),
    metadata,
  };
}

export async function writePreparedProviderAttemptEvidence(
  db: DrizzleDB,
  prepared: PreparedProviderAttemptEvidence,
  options: PrivateTraceWriteOptions = {},
): Promise<WriteProviderAttemptEvidenceResult> {
  const written = await writePreparedProviderAttemptObject(db, prepared, options);
  if (!written.ok) return written;
  const manifest = await createEvidenceManifest(db, {
    manifestId: prepared.manifestId,
    gameId: prepared.gameId,
    ownerEpoch: prepared.ownerEpoch,
    evidenceType: PROVIDER_ATTEMPT_EVIDENCE_TYPE,
    retentionClass: "debug",
    accessScope: "producer_admin",
    storage: written.storage,
    sourcePointers: [{
      kind: "provider_attempt_failure",
      logicalCallId: prepared.logicalCallId,
      attemptJournalId: prepared.attemptJournalId,
      attemptOrdinal: prepared.attemptOrdinal,
    }],
    metadata: prepared.metadata as unknown as Record<string, unknown>,
  });
  if (!manifest.ok) return manifest;
  return written;
}

/**
 * Writes only the deterministic object. The durable provider-attempt outbox
 * owns manifest creation so it can reconcile after the originating owner is
 * no longer active.
 */
export async function writePreparedProviderAttemptObject(
  db: DrizzleDB,
  prepared: PreparedProviderAttemptEvidence,
  options: PrivateTraceWriteOptions = {},
): Promise<WriteProviderAttemptEvidenceResult> {
  const bucket = getPrivateTraceBucket();
  const storage = {
    provider: PRIVATE_TRACE_STORAGE_PROVIDER,
    bucket,
    key: prepared.storageKey,
  } as const;
  const existing = (await db
    .select({
      id: schema.gameEvidenceManifests.id,
      storageProvider: schema.gameEvidenceManifests.storageProvider,
      storageBucket: schema.gameEvidenceManifests.storageBucket,
      storageKey: schema.gameEvidenceManifests.storageKey,
    })
    .from(schema.gameEvidenceManifests)
    .where(eq(schema.gameEvidenceManifests.id, prepared.manifestId)))[0];
  if (existing) {
    if (
      existing.storageProvider !== PRIVATE_TRACE_STORAGE_PROVIDER ||
      !existing.storageBucket ||
      existing.storageKey !== prepared.storageKey
    ) {
      return {
        ok: false,
        error: "Provider attempt manifest has conflicting storage identity",
      };
    }
    return {
      ok: true,
      manifestId: prepared.manifestId,
      storage: {
        provider: PRIVATE_TRACE_STORAGE_PROVIDER,
        bucket: existing.storageBucket,
        key: existing.storageKey,
      },
      metadata: prepared.metadata,
    };
  }

  try {
    assertPrivateContentStoragePointer(storage);
    const adapter = options.storage ?? createPrivateTraceStorageAdapter();
    await adapter.putObject({
      bucket,
      key: prepared.storageKey,
      body: prepared.body,
      contentType: PRIVATE_TRACE_CONTENT_TYPE,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markEvidenceDegraded(
      db,
      prepared.gameId,
      prepared.ownerEpoch,
      `provider_attempt_storage_failed: ${message}`,
    ).catch(() => {});
    return { ok: false, error: message };
  }

  return {
    ok: true,
    manifestId: prepared.manifestId,
    storage,
    metadata: prepared.metadata,
  };
}

/**
 * Stores the exact coordinator-sanitized failure envelope. The deterministic
 * object and manifest identities make terminal-hook replay idempotent.
 */
export async function writeProviderAttemptEvidence(
  db: DrizzleDB,
  input: WriteProviderAttemptEvidenceInput,
  options: PrivateTraceWriteOptions = {},
): Promise<WriteProviderAttemptEvidenceResult> {
  return writePreparedProviderAttemptEvidence(
    db,
    prepareProviderAttemptEvidence(input),
    options,
  );
}
