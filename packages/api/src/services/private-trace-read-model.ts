import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { createHash } from "crypto";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { acceptedActionDecisionRefs } from "./accepted-action-correlation.js";
import {
  readEvidenceManifest,
  readEvidenceManifestForExperiment,
  type EvidenceAccessor,
} from "./evidence-access.js";
import { getDurableRunInspection, type DurableRunInspectionResponse } from "./game-durable-run.js";
import { getTrustedCanonicalEventPrefix } from "./game-event-read-model.js";
import {
  createPrivateTraceStorageAdapter,
  PRIVATE_TRACE_STORAGE_PROVIDER,
  type PrivateTraceStorageAdapter,
} from "./private-trace-storage.js";
import {
  PRIVATE_TRACE_EVIDENCE_TYPE,
  PROVIDER_ATTEMPT_EVIDENCE_TYPE,
} from "./private-trace-writer.js";
import {
  bindProducerIndexCursor,
  decodeProducerIndexCursor,
  issueProducerIndexCursor,
  type ProducerIndexCursorClaims,
  type ProducerIndexCursorPosition,
  type ProducerIndexTraceLinkageSummary,
} from "./producer-index-cursor.js";
import { sha256StableJson } from "./stable-hash.js";

const LOCAL_PRODUCER_ACCESSOR: EvidenceAccessor = {
  roles: ["producer"],
};

type PrivateTraceIndexDB = Pick<DrizzleDB, "select" | "execute">;

const DEFAULT_TRACE_SEARCH_SCAN_BYTES = 8 * 1024 * 1024;
export const MAX_TRACE_MANIFEST_LIMIT = 500;

const PRIVATE_TRACE_CURSOR_FILTERS = {
  artifactType: null,
  actorPlayerId: null,
} as const;
const LOCAL_TRACE_CURSOR_BINDING = sha256StableJson({
  domain: "influence.private_trace.index_binding.v1",
  surface: "local_producer",
});

export interface PrivateTraceManifestIndexEntry {
  id: string;
  gameId: string;
  ownerEpoch: string;
  eventSequence?: number;
  decisionId?: string;
  evidenceType: string;
  retentionClass: string;
  redactionStatus: string;
  createdAt: string;
  actor?: unknown;
  action?: unknown;
  phase?: unknown;
  round?: unknown;
  model?: unknown;
  modelName?: unknown;
  requestedReasoningEffort?: unknown;
  reasoningPolicy?: unknown;
  usage?: unknown;
  byteLength?: unknown;
  recordCount?: unknown;
  sha256?: unknown;
  contentType?: unknown;
  strategyCandidate?: unknown;
  boundary?: unknown;
}

export type PrivateTraceLinkageSummary = ProducerIndexTraceLinkageSummary;

export interface PrivateTraceManifestIndex {
  ok: true;
  gameId: string;
  totalCount: number;
  pageSize: number;
  nextCursor: string | null;
  linkageSummary: PrivateTraceLinkageSummary;
  manifests: PrivateTraceManifestIndexEntry[];
}

export type PrivateTraceManifestIndexResult =
  | PrivateTraceManifestIndex
  | {
    ok: false;
    status: "cursor_invalid_or_stale";
    error: string;
  };

export interface ListPrivateTraceManifestsOptions {
  limit?: number;
  cursor?: string;
  evidenceType?: typeof PRIVATE_TRACE_EVIDENCE_TYPE | typeof PROVIDER_ATTEMPT_EVIDENCE_TYPE;
  /** Authorization/surface fingerprint supplied by the producer transport. */
  cursorBinding?: string;
}

export interface PrivateTraceContentRead {
  manifest: PrivateTraceManifestIndexEntry;
  content: string;
  contentType?: string;
  byteLength: number;
  returnedByteLength: number;
  totalByteLength?: number;
  offsetBytes: number;
  nextOffsetBytes?: number;
  truncated: boolean;
  sha256: string;
  hashScope: "complete_object" | "chunk";
}

export type PrivateTraceContentReadResult =
  | { ok: true; response: PrivateTraceContentRead }
  | {
    ok: false;
    status: "not_found" | "denied" | "expired" | "redacted" | "missing_storage" | "integrity_mismatch" | "storage_error";
    error: string;
  };

export interface PrivateTraceSearchMatch {
  manifestId: string;
  gameId: string;
  recordIndex: number;
  actor?: unknown;
  action?: unknown;
  phase?: unknown;
  round?: unknown;
  preview: string;
}

export interface PrivateTraceSearchSkippedManifest {
  manifestId: string;
  gameId: string;
  actor?: unknown;
  action?: unknown;
  phase?: unknown;
  round?: unknown;
  status: Extract<PrivateTraceContentReadResult, { ok: false }>["status"];
  error: string;
}

export interface PrivateTraceSearchResult {
  gameId: string;
  matches: PrivateTraceSearchMatch[];
  diagnostics?: {
    skippedManifestCount: number;
    skippedManifests: PrivateTraceSearchSkippedManifest[];
  };
}

export interface PrivateTraceSearchOptions {
  gameIdOrSlug: string;
  query: string;
  actor?: string;
  action?: string;
  phase?: string;
  limit?: number;
  maxBytes?: number;
}

function sha256Bytes(body: Uint8Array): string {
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textPreview(value: unknown, query: string, maxLength = 280): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  const start = index < 0 ? 0 : Math.max(0, index - 80);
  return text.slice(start, start + maxLength);
}

function parseJsonOrJsonl(content: string): unknown[] {
  const trimmed = content.trim();
  if (!trimmed) return [];
  try {
    return [JSON.parse(trimmed)];
  } catch {
    const records: unknown[] = [];
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!.trim();
      if (!line) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        if (lines.slice(index + 1).every((candidate) => candidate.trim().length === 0)) {
          break;
        }
        throw new Error(`Invalid JSONL at line ${index + 1}`);
      }
    }
    return records;
  }
}

function normalizeMaxBytes(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.floor(value));
}

function searchRecordsForContent(content: PrivateTraceContentRead): unknown[] {
  try {
    return parseJsonOrJsonl(content.content);
  } catch (error) {
    if (content.truncated) return [content.content];
    throw error;
  }
}

function manifestIndexEntry(row: typeof schema.gameEvidenceManifests.$inferSelect): PrivateTraceManifestIndexEntry {
  const metadata = row.metadata ?? {};
  return {
    id: row.id,
    gameId: row.gameId,
    ownerEpoch: row.ownerEpoch,
    eventSequence: row.eventSequence ?? undefined,
    decisionId: row.decisionId ?? undefined,
    evidenceType: row.evidenceType,
    retentionClass: row.retentionClass,
    redactionStatus: row.redactionStatus,
    createdAt: row.createdAt,
    actor: metadata.actor,
    action: metadata.action,
    phase: metadata.phase,
    round: metadata.round,
    model: metadata.model,
    modelName: metadata.modelName,
    requestedReasoningEffort: metadata.requestedReasoningEffort,
    reasoningPolicy: metadata.reasoningPolicy,
    usage: metadata.usage,
    byteLength: metadata.byteLength,
    recordCount: metadata.recordCount,
    sha256: metadata.sha256,
    contentType: metadata.contentType,
    strategyCandidate: metadata.strategyCandidate,
    boundary: metadata.boundary,
  };
}

export class PrivateTraceReadModel {
  private storage?: PrivateTraceStorageAdapter;

  constructor(
    private readonly db: DrizzleDB,
    private readonly storageFactory: () => PrivateTraceStorageAdapter = createPrivateTraceStorageAdapter,
    private readonly cursorSecret?: string,
  ) {}

  async resolveGameId(idOrSlug: string): Promise<string | null> {
    const row = (await this.db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug))))[0];
    return row?.id ?? null;
  }

  async listDurableRuns(limit = 20): Promise<Array<{
    id: string;
    slug: string;
    status: string;
    startedAt?: string;
    ownerStatus?: string;
    ownerHealth?: string;
    traceManifestCount: number;
  }>> {
    const games = await this.db
      .select({
        id: schema.games.id,
        slug: schema.games.slug,
        status: schema.games.status,
        startedAt: schema.games.startedAt,
        ownerStatus: schema.gameRunOwners.status,
        ownerHealth: schema.gameRunOwners.kernelHealth,
      })
      .from(schema.games)
      .leftJoin(schema.gameRunOwners, eq(schema.gameRunOwners.gameId, schema.games.id))
      .orderBy(desc(schema.games.createdAt))
      .limit(Math.max(1, Math.min(limit, 100)));

    const result = [];
    for (const game of games) {
      const traceManifestIndex = await this.listManifests(game.id, { limit: 1 });
      const traceManifestCount = traceManifestIndex.ok ? traceManifestIndex.totalCount : 0;
      result.push({
        id: game.id,
        slug: game.slug,
        status: game.status,
        ...(game.startedAt && { startedAt: game.startedAt }),
        ...(game.ownerStatus && { ownerStatus: game.ownerStatus }),
        ...(game.ownerHealth && { ownerHealth: game.ownerHealth }),
        traceManifestCount,
      });
    }
    return result;
  }

  async inspectDurableRun(gameIdOrSlug: string): Promise<DurableRunInspectionResponse | null> {
    const result = await getDurableRunInspection(this.db, gameIdOrSlug);
    return result.ok ? result.response : null;
  }

  async listManifests(
    gameIdOrSlug: string,
    options: ListPrivateTraceManifestsOptions = {},
  ): Promise<PrivateTraceManifestIndexResult> {
    const gameId = await this.resolveGameId(gameIdOrSlug);
    if (!gameId) {
      if (options.cursor) return invalidManifestCursor();
      return {
        ok: true,
        gameId: gameIdOrSlug,
        totalCount: 0,
        pageSize: 0,
        nextCursor: null,
        linkageSummary: emptyLinkageSummary(),
        manifests: [],
      };
    }

    const decodedCursor = options.cursor
      ? decodeProducerIndexCursor(options.cursor, {
          expectedKind: "private_trace",
          secretMaterial: this.cursorSecret,
        })
      : null;
    if (decodedCursor?.status === "invalid") return invalidManifestCursor();

    const evidenceType = options.evidenceType ?? PRIVATE_TRACE_EVIDENCE_TYPE;
    const cursorBinding = sha256StableJson({
      domain: "influence.private_trace.index_binding.v2",
      binding: options.cursorBinding ?? LOCAL_TRACE_CURSOR_BINDING,
      evidenceType,
    });
    if (decodedCursor?.status === "ok" && !bindProducerIndexCursor({
      claims: decodedCursor.claims,
      kind: "private_trace",
      bindingFingerprint: cursorBinding,
      gameId,
      filters: PRIVATE_TRACE_CURSOR_FILTERS,
    })) {
      return invalidManifestCursor();
    }

    if (decodedCursor?.status === "ok") {
      return this.listManifestPage(
        this.db,
        gameId,
        options,
        cursorBinding,
        decodedCursor.claims,
        decodedCursor.claims.databaseSnapshot,
      );
    }

    return this.db.transaction(async (tx) => {
      const databaseSnapshot = await readCurrentDatabaseSnapshot(tx);
      return this.listManifestPage(
        tx,
        gameId,
        options,
        cursorBinding,
        null,
        databaseSnapshot,
      );
    }, {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
  }

  private async listManifestPage(
    db: PrivateTraceIndexDB,
    gameId: string,
    options: ListPrivateTraceManifestsOptions,
    cursorBinding: string,
    cursor: ProducerIndexCursorClaims | null,
    databaseSnapshot: string,
  ): Promise<PrivateTraceManifestIndexResult> {
    const baseConditions: SQL[] = [
      eq(schema.gameEvidenceManifests.gameId, gameId),
      eq(
        schema.gameEvidenceManifests.evidenceType,
        options.evidenceType ?? PRIVATE_TRACE_EVIDENCE_TYPE,
      ),
    ];
    addTraceDatabaseSnapshotCondition(baseConditions, databaseSnapshot);
    const pageConditions = [...baseConditions];
    if (cursor) {
      addTraceReadThroughCondition(pageConditions, cursor.readThrough);
      addTraceKeysetCondition(pageConditions, cursor.keyset);
    }
    const limit = Math.max(1, Math.min(options.limit ?? 50, MAX_TRACE_MANIFEST_LIMIT));
    const rows = await db
      .select()
      .from(schema.gameEvidenceManifests)
      .where(and(...pageConditions))
      .orderBy(
        desc(schema.gameEvidenceManifests.createdAt),
        desc(schema.gameEvidenceManifests.id),
      )
      .limit(limit + 1);

    const readThrough = cursor
      ? cursor.readThrough
      : tracePositionFor(rows[0]);
    const snapshot = cursor
      ? {
          totalCount: cursor.totalCount,
          linkageSummary: cursor.traceLinkageSummary!,
        }
      : await this.readTraceSnapshotMetadata(db, gameId, baseConditions, readThrough);
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last
      ? issueProducerIndexCursor({
          kind: "private_trace",
          bindingFingerprint: cursorBinding,
          gameId,
          filters: PRIVATE_TRACE_CURSOR_FILTERS,
          databaseSnapshot,
          readThrough,
          keyset: tracePositionFor(last),
          totalCount: snapshot.totalCount,
          traceLinkageSummary: snapshot.linkageSummary,
        }, this.cursorSecret)
      : null;

    return {
      ok: true,
      gameId,
      totalCount: snapshot.totalCount,
      pageSize: pageRows.length,
      nextCursor,
      linkageSummary: snapshot.linkageSummary,
      manifests: pageRows.map(manifestIndexEntry),
    };
  }

  private async readTraceSnapshotMetadata(
    db: PrivateTraceIndexDB,
    gameId: string,
    baseConditions: SQL[],
    readThrough: ProducerIndexCursorPosition,
  ): Promise<{ totalCount: number; linkageSummary: PrivateTraceLinkageSummary }> {
    const snapshotConditions = [...baseConditions];
    addTraceReadThroughCondition(snapshotConditions, readThrough);
    const [identityRows, trustedPrefix] = await Promise.all([
      db
        .select({
          ownerEpoch: schema.gameEvidenceManifests.ownerEpoch,
          decisionId: schema.gameEvidenceManifests.decisionId,
          eventSequence: schema.gameEvidenceManifests.eventSequence,
        })
        .from(schema.gameEvidenceManifests)
        .where(and(...snapshotConditions)),
      getTrustedCanonicalEventPrefix(db, gameId),
    ]);
    return {
      totalCount: identityRows.length,
      linkageSummary: summarizePrivateTraceLinkage(
        identityRows,
        acceptedActionDecisionRefs(trustedPrefix.events),
        trustedPrefix.status,
      ),
    };
  }

  async readContent(
    manifestId: string,
    params: {
      gameId?: string;
      purpose?: string;
      accessor?: EvidenceAccessor;
      maxBytes?: number;
      offsetBytes?: number;
    } = {},
  ): Promise<PrivateTraceContentReadResult> {
    return this.readContentInternal(manifestId, params, false);
  }

  async readProviderAttemptContent(
    manifestId: string,
    params: {
      gameId?: string;
      purpose?: string;
      accessor?: EvidenceAccessor;
      maxBytes?: number;
      offsetBytes?: number;
    } = {},
  ): Promise<PrivateTraceContentReadResult> {
    return this.readContentInternal(
      manifestId,
      {
        ...params,
        purpose: params.purpose ?? "local_provider_attempt_mcp_read_content",
      },
      false,
      PROVIDER_ATTEMPT_EVIDENCE_TYPE,
    );
  }

  /**
   * Full-object producer read for immutable experiment materialization.
   * The source database is not mutated; the caller must retain the returned
   * structural receipt in its external private workspace.
   */
  async readCompleteContentForExperiment(
    manifestId: string,
    params: { gameId: string },
  ): Promise<PrivateTraceContentReadResult> {
    const result = await this.readContentInternal(manifestId, {
      gameId: params.gameId,
    }, true);
    if (result.ok && result.response.truncated) {
      return {
        ok: false,
        status: "integrity_mismatch",
        error: "Experiment trace object read was truncated",
      };
    }
    return result;
  }

  private async readContentInternal(
    manifestId: string,
    params: {
      gameId?: string;
      purpose?: string;
      accessor?: EvidenceAccessor;
      maxBytes?: number;
      offsetBytes?: number;
    },
    experimentNoAudit: boolean,
    expectedEvidenceType?: string,
  ): Promise<PrivateTraceContentReadResult> {
    const read = experimentNoAudit
      ? await readEvidenceManifestForExperiment(this.db, {
          manifestId,
          gameId: params.gameId,
        })
      : await readEvidenceManifest(this.db, {
          manifestId,
          gameId: params.gameId,
          accessor: params.accessor ?? LOCAL_PRODUCER_ACCESSOR,
          purpose: params.purpose ?? "local_trace_mcp_read_content",
        });
    if (!read.ok) {
      if (read.status === "expired" || read.status === "redacted") {
        return { ok: false, status: read.status, error: `Evidence manifest is ${read.status}` };
      }
      if (read.status === "not_found" || read.status === "denied") {
        return { ok: false, status: read.status, error: read.error };
      }
      return { ok: false, status: "storage_error", error: "Unknown evidence manifest read failure" };
    }

    const manifest = read.manifest;
    if (expectedEvidenceType && manifest.evidenceType !== expectedEvidenceType) {
      return { ok: false, status: "not_found", error: "Provider attempt evidence not found" };
    }
    if (
      manifest.storageProvider !== PRIVATE_TRACE_STORAGE_PROVIDER ||
      !manifest.storageBucket ||
      !manifest.storageKey
    ) {
      return { ok: false, status: "missing_storage", error: "Trace manifest has no private storage pointer" };
    }

    try {
      const storage = this.getStorage();
      const head = await storage.headObject({
        bucket: manifest.storageBucket,
        key: manifest.storageKey,
      });
      const expectedBytes = typeof manifest.metadata.byteLength === "number" ? manifest.metadata.byteLength : undefined;
      if (expectedBytes !== undefined && head.contentLength !== undefined && head.contentLength !== expectedBytes) {
        return { ok: false, status: "integrity_mismatch", error: "Private trace object size does not match manifest metadata" };
      }

      const maxBytes = normalizeMaxBytes(params.maxBytes);
      const offsetBytes = normalizeOffsetBytes(params.offsetBytes);
      const object = await storage.getObject({
        bucket: manifest.storageBucket,
        key: manifest.storageKey,
        offsetBytes,
        // Read up to three look-ahead bytes so a nominal byte limit that lands
        // inside a UTF-8 code point can return that character losslessly.
        maxBytes: maxBytes === undefined ? undefined : maxBytes + 3,
      });
      const fetchedBytes = object.bodyBytes
        ?? (object.body !== undefined ? new TextEncoder().encode(object.body) : undefined);
      if (!fetchedBytes) {
        throw new Error("private trace object body missing");
      }
      const chunkBytes = maxBytes === undefined
        ? validateUtf8Chunk(fetchedBytes, offsetBytes)
        : boundedUtf8Chunk(fetchedBytes, maxBytes, offsetBytes);
      const content = new TextDecoder("utf-8", { fatal: true }).decode(chunkBytes);
      const returnedByteLength = chunkBytes.byteLength;
      const totalByteLength = expectedBytes ?? head.contentLength;
      const nextOffsetBytes = offsetBytes + returnedByteLength;
      const truncated = (
        totalByteLength !== undefined
          ? nextOffsetBytes < totalByteLength
          : maxBytes !== undefined && returnedByteLength >= maxBytes
      );
      const sha256 = sha256Bytes(chunkBytes);
      const completeObject = offsetBytes === 0 && !truncated;
      if (completeObject && expectedBytes !== undefined && returnedByteLength !== expectedBytes) {
        return { ok: false, status: "integrity_mismatch", error: "Private trace content size does not match manifest metadata" };
      }
      const expectedHash = typeof manifest.metadata.sha256 === "string" ? manifest.metadata.sha256 : undefined;
      if (completeObject && expectedHash && sha256 !== expectedHash) {
        return { ok: false, status: "integrity_mismatch", error: "Private trace content hash does not match manifest metadata" };
      }

      return {
        ok: true,
        response: {
          manifest: manifestIndexEntry({
            ...manifest,
            redactedAt: null,
          } as typeof schema.gameEvidenceManifests.$inferSelect),
          content,
          contentType: object.contentType ?? head.contentType,
          byteLength: totalByteLength ?? returnedByteLength,
          returnedByteLength,
          ...(totalByteLength !== undefined && { totalByteLength }),
          offsetBytes,
          ...(truncated && { nextOffsetBytes }),
          truncated,
          sha256,
          hashScope: completeObject ? "complete_object" : "chunk",
        },
      };
    } catch (error) {
      return { ok: false, status: "storage_error", error: error instanceof Error ? error.message : String(error) };
    }
  }

  async searchReasoningTraces(options: PrivateTraceSearchOptions): Promise<PrivateTraceSearchResult> {
    const listed = await this.listManifests(options.gameIdOrSlug, { limit: MAX_TRACE_MANIFEST_LIMIT });
    if (!listed.ok) {
      return { gameId: options.gameIdOrSlug, matches: [] };
    }
    const query = options.query.trim().toLowerCase();
    if (!query) return { gameId: listed.gameId, matches: [] };

    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
    const matches: PrivateTraceSearchMatch[] = [];
    const skippedManifests: PrivateTraceSearchSkippedManifest[] = [];
    for (const manifest of listed.manifests) {
      if (options.action && String(manifest.action ?? "") !== options.action) continue;
      if (options.phase && String(manifest.phase ?? "") !== options.phase) continue;
      if (options.actor) {
        const actor = asRecord(manifest.actor);
        if (String(actor.name ?? actor.id ?? "") !== options.actor) continue;
      }

      const content = await this.readContent(manifest.id, {
        gameId: listed.gameId,
        purpose: "local_trace_mcp_search_reasoning_traces",
        maxBytes: options.maxBytes ?? DEFAULT_TRACE_SEARCH_SCAN_BYTES,
      });
      if (!content.ok) {
        skippedManifests.push({
          manifestId: manifest.id,
          gameId: manifest.gameId,
          actor: manifest.actor,
          action: manifest.action,
          phase: manifest.phase,
          round: manifest.round,
          status: content.status,
          error: content.error,
        });
        continue;
      }

      const records = searchRecordsForContent(content.response);
      for (let index = 0; index < records.length; index++) {
        const record = records[index];
        const haystack = JSON.stringify(record).toLowerCase();
        if (!haystack.includes(query)) continue;
        matches.push({
          manifestId: manifest.id,
          gameId: manifest.gameId,
          recordIndex: index,
          actor: manifest.actor,
          action: manifest.action,
          phase: manifest.phase,
          round: manifest.round,
          preview: textPreview(record, options.query),
        });
        if (matches.length >= limit) return searchResult(listed.gameId, matches, skippedManifests);
      }
    }

    return searchResult(listed.gameId, matches, skippedManifests);
  }

  private getStorage(): PrivateTraceStorageAdapter {
    this.storage ??= this.storageFactory();
    return this.storage;
  }
}

function validateUtf8Chunk(bytes: Uint8Array, offsetBytes: number): Uint8Array {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return bytes;
  } catch {
    throw new Error(`Private trace offset ${offsetBytes} is not aligned to UTF-8 content`);
  }
}

function boundedUtf8Chunk(
  bytes: Uint8Array,
  requestedMaxBytes: number,
  offsetBytes: number,
): Uint8Array {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const preferredEnd = Math.min(requestedMaxBytes, bytes.byteLength);
  for (let end = preferredEnd; end > 0; end -= 1) {
    try {
      decoder.decode(bytes.subarray(0, end));
      return bytes.subarray(0, end);
    } catch {
      // Try the previous byte boundary.
    }
  }
  for (let end = preferredEnd + 1; end <= bytes.byteLength; end += 1) {
    try {
      decoder.decode(bytes.subarray(0, end));
      return bytes.subarray(0, end);
    } catch {
      // A single UTF-8 code point may exceed the caller's nominal byte cap.
    }
  }
  throw new Error(`Private trace offset ${offsetBytes} is not aligned to UTF-8 content`);
}

function normalizeOffsetBytes(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function emptyLinkageSummary(): PrivateTraceLinkageSummary {
  return {
    trustedCanonicalPrefixStatus: "empty",
    eligibleAcceptedDecisionCount: 0,
    linkedAcceptedDecisionCount: 0,
    degradedAcceptedDecisionCount: 0,
    intentionallyUnlinkedTraceCount: 0,
    unclassifiedTraceCount: 0,
  };
}

function invalidManifestCursor(): Extract<PrivateTraceManifestIndexResult, { ok: false }> {
  return {
    ok: false,
    status: "cursor_invalid_or_stale",
    error: "Private trace manifest cursor is invalid or stale",
  };
}

function addTraceReadThroughCondition(
  conditions: SQL[],
  readThrough: ProducerIndexCursorPosition,
): void {
  if (readThrough.createdAt === null || readThrough.id === null) {
    conditions.push(sql`false`);
    return;
  }
  conditions.push(sql`(
    ${schema.gameEvidenceManifests.createdAt} < ${readThrough.createdAt}
    OR (
      ${schema.gameEvidenceManifests.createdAt} = ${readThrough.createdAt}
      AND ${schema.gameEvidenceManifests.id} <= ${readThrough.id}
    )
  )`);
}

function addTraceDatabaseSnapshotCondition(
  conditions: SQL[],
  databaseSnapshot: string,
): void {
  conditions.push(sql`(
    ${schema.gameEvidenceManifests.indexInsertXid} IS NULL
    OR pg_visible_in_snapshot(
      ${schema.gameEvidenceManifests.indexInsertXid}::xid8,
      ${databaseSnapshot}::pg_snapshot
    )
  )`);
}

async function readCurrentDatabaseSnapshot(db: PrivateTraceIndexDB): Promise<string> {
  const [row] = await db.execute<{ snapshot: string }>(sql`
    SELECT pg_current_snapshot()::text AS snapshot
  `);
  if (!row?.snapshot) throw new Error("Could not capture producer index database snapshot");
  return row.snapshot;
}

function addTraceKeysetCondition(
  conditions: SQL[],
  keyset: ProducerIndexCursorPosition,
): void {
  if (keyset.createdAt === null || keyset.id === null) return;
  conditions.push(sql`(
    ${schema.gameEvidenceManifests.createdAt} < ${keyset.createdAt}
    OR (
      ${schema.gameEvidenceManifests.createdAt} = ${keyset.createdAt}
      AND ${schema.gameEvidenceManifests.id} < ${keyset.id}
    )
  )`);
}

function tracePositionFor(
  row: Pick<typeof schema.gameEvidenceManifests.$inferSelect, "createdAt" | "id"> | undefined,
): ProducerIndexCursorPosition {
  return row
    ? { createdAt: row.createdAt, id: row.id }
    : { createdAt: null, id: null };
}

function summarizePrivateTraceLinkage(
  manifests: ReadonlyArray<{
    ownerEpoch: string;
    decisionId: string | null;
    eventSequence: number | null;
  }>,
  acceptedRefs: ReturnType<typeof acceptedActionDecisionRefs>,
  trustedCanonicalPrefixStatus: "empty" | "complete" | "invalid",
): PrivateTraceLinkageSummary {
  const keyFor = (ownerEpoch: string, decisionId: string) => (
    `${ownerEpoch}\u0000${decisionId}`
  );
  const refsByKey = new Map(
    acceptedRefs.map((ref) => [keyFor(ref.ownerEpoch, ref.decisionId), ref]),
  );
  const manifestsByKey = new Map<string, Array<(typeof manifests)[number]>>();
  let intentionallyUnlinkedTraceCount = 0;
  let unclassifiedTraceCount = 0;

  for (const manifest of manifests) {
    if (!manifest.decisionId) {
      intentionallyUnlinkedTraceCount += 1;
      continue;
    }
    const key = keyFor(manifest.ownerEpoch, manifest.decisionId);
    if (!refsByKey.has(key)) {
      if (trustedCanonicalPrefixStatus === "invalid") {
        unclassifiedTraceCount += 1;
      } else {
        intentionallyUnlinkedTraceCount += 1;
      }
      continue;
    }
    const rows = manifestsByKey.get(key) ?? [];
    rows.push(manifest);
    manifestsByKey.set(key, rows);
  }

  let linkedAcceptedDecisionCount = 0;
  let degradedAcceptedDecisionCount = 0;
  for (const [key, ref] of refsByKey) {
    const exactManifestExists = (manifestsByKey.get(key) ?? []).some(
      (manifest) => manifest.eventSequence === ref.eventSequence,
    );
    if (!ref.canonicalConflict && exactManifestExists) {
      linkedAcceptedDecisionCount += 1;
    } else {
      degradedAcceptedDecisionCount += 1;
    }
  }

  return {
    trustedCanonicalPrefixStatus,
    eligibleAcceptedDecisionCount: refsByKey.size,
    linkedAcceptedDecisionCount,
    degradedAcceptedDecisionCount,
    intentionallyUnlinkedTraceCount,
    unclassifiedTraceCount,
  };
}

function searchResult(
  gameId: string,
  matches: PrivateTraceSearchMatch[],
  skippedManifests: PrivateTraceSearchSkippedManifest[],
): PrivateTraceSearchResult {
  if (skippedManifests.length === 0) {
    return { gameId, matches };
  }
  return {
    gameId,
    matches,
    diagnostics: {
      skippedManifestCount: skippedManifests.length,
      skippedManifests: skippedManifests.slice(0, 20),
    },
  };
}
