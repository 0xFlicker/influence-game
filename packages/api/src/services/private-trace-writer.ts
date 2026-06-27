import { createHash, randomUUID } from "crypto";
import type { PrivateDecisionTrace, PrivateDecisionTraceBoundary } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { assertPrivateContentStoragePointer, createEvidenceManifest, markEvidenceDegraded } from "./game-evidence.js";
import {
  createPrivateTraceStorageAdapter,
  getPrivateTraceBucket,
  PRIVATE_TRACE_CONTENT_TYPE,
  PRIVATE_TRACE_STORAGE_PROVIDER,
  type PrivateTraceStorageAdapter,
} from "./private-trace-storage.js";

export const PRIVATE_TRACE_EVIDENCE_TYPE = "private_decision_trace";

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
  strategicDecision?: {
    decisionLogBytes?: number;
  };
  strategyPacket?: {
    revision?: string;
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
    ...(trace.decisionLog && {
      strategicDecision: {
        decisionLogBytes: byteLength(trace.decisionLog),
      },
    }),
    ...(trace.strategyPacketRevision && {
      strategyPacket: {
        revision: trace.strategyPacketRevision,
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
