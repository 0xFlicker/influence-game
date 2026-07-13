import { and, desc, eq, or } from "drizzle-orm";
import { createHash } from "crypto";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { readEvidenceManifest, type EvidenceAccessor } from "./evidence-access.js";
import { getDurableRunInspection, type DurableRunInspectionResponse } from "./game-durable-run.js";
import {
  createPrivateTraceStorageAdapter,
  PRIVATE_TRACE_STORAGE_PROVIDER,
  type PrivateTraceStorageAdapter,
} from "./private-trace-storage.js";
import { PRIVATE_TRACE_EVIDENCE_TYPE } from "./private-trace-writer.js";

const LOCAL_PRODUCER_ACCESSOR: EvidenceAccessor = {
  roles: ["producer"],
};

const DEFAULT_TRACE_SEARCH_SCAN_BYTES = 8 * 1024 * 1024;
export const MAX_TRACE_MANIFEST_LIMIT = 500;

export interface PrivateTraceManifestIndexEntry {
  id: string;
  gameId: string;
  ownerEpoch: string;
  eventSequence?: number;
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
  strategicDecision?: unknown;
  strategyPacket?: unknown;
  boundary?: unknown;
}

export interface PrivateTraceContentRead {
  manifest: PrivateTraceManifestIndexEntry;
  content: string;
  contentType?: string;
  byteLength: number;
  returnedByteLength: number;
  totalByteLength?: number;
  truncated: boolean;
  sha256: string;
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

function sha256Text(body: string): string {
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
    strategicDecision: metadata.strategicDecision,
    strategyPacket: metadata.strategyPacket,
    boundary: metadata.boundary,
  };
}

export class PrivateTraceReadModel {
  private storage?: PrivateTraceStorageAdapter;

  constructor(
    private readonly db: DrizzleDB,
    private readonly storageFactory: () => PrivateTraceStorageAdapter = createPrivateTraceStorageAdapter,
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
      const traceManifestCount = (await this.listManifests(game.id, 1)).totalCount;
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

  async listManifests(gameIdOrSlug: string, limit = 50): Promise<{ gameId: string; totalCount: number; manifests: PrivateTraceManifestIndexEntry[] }> {
    const gameId = await this.resolveGameId(gameIdOrSlug);
    if (!gameId) return { gameId: gameIdOrSlug, totalCount: 0, manifests: [] };

    const rows = await this.db
      .select()
      .from(schema.gameEvidenceManifests)
      .where(and(
        eq(schema.gameEvidenceManifests.gameId, gameId),
        eq(schema.gameEvidenceManifests.evidenceType, PRIVATE_TRACE_EVIDENCE_TYPE),
      ))
      .orderBy(desc(schema.gameEvidenceManifests.createdAt))
      .limit(Math.max(1, Math.min(limit, MAX_TRACE_MANIFEST_LIMIT)));

    return {
      gameId,
      totalCount: rows.length,
      manifests: rows.map(manifestIndexEntry),
    };
  }

  async readContent(
    manifestId: string,
    params: {
      gameId?: string;
      purpose?: string;
      accessor?: EvidenceAccessor;
      maxBytes?: number;
    } = {},
  ): Promise<PrivateTraceContentReadResult> {
    const read = await readEvidenceManifest(this.db, {
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
      const object = await storage.getObject({
        bucket: manifest.storageBucket,
        key: manifest.storageKey,
        maxBytes,
      });
      const returnedByteLength = object.contentLength ?? Buffer.byteLength(object.body, "utf8");
      const totalByteLength = expectedBytes ?? head.contentLength;
      const truncated = maxBytes !== undefined && (
        totalByteLength !== undefined
          ? returnedByteLength < totalByteLength
          : returnedByteLength >= maxBytes
      );
      const sha256 = sha256Text(object.body);
      if (!truncated && expectedBytes !== undefined && returnedByteLength !== expectedBytes) {
        return { ok: false, status: "integrity_mismatch", error: "Private trace content size does not match manifest metadata" };
      }
      const expectedHash = typeof manifest.metadata.sha256 === "string" ? manifest.metadata.sha256 : undefined;
      if (!truncated && expectedHash && sha256 !== expectedHash) {
        return { ok: false, status: "integrity_mismatch", error: "Private trace content hash does not match manifest metadata" };
      }

      return {
        ok: true,
        response: {
          manifest: manifestIndexEntry({
            ...manifest,
            redactedAt: null,
          } as typeof schema.gameEvidenceManifests.$inferSelect),
          content: object.body,
          contentType: object.contentType ?? head.contentType,
          byteLength: totalByteLength ?? returnedByteLength,
          returnedByteLength,
          ...(totalByteLength !== undefined && { totalByteLength }),
          truncated,
          sha256,
        },
      };
    } catch (error) {
      return { ok: false, status: "storage_error", error: error instanceof Error ? error.message : String(error) };
    }
  }

  async searchReasoningTraces(options: PrivateTraceSearchOptions): Promise<PrivateTraceSearchResult> {
    const listed = await this.listManifests(options.gameIdOrSlug, MAX_TRACE_MANIFEST_LIMIT);
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
