import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type {
  GameRunOwnerStatus,
  GameStatus,
  KernelHealthStatus,
  TrackType,
} from "../db/schema.js";
import {
  getPersistedGameEvents,
  type PersistedEventDiagnostic,
  type PersistedEventHead,
} from "./game-event-read-model.js";
import {
  getPersistedGameProjection,
  type DurableProjectionSummary,
  type ProjectionReplayDiagnostic,
  type ProjectionReplayStatus,
} from "./game-projection-read-model.js";
import {
  buildRedactedKernelHealth,
  type RedactedKernelHealth,
} from "./game-kernel-health.js";
import {
  deriveHydrationPassport,
  type HydrationPassport,
} from "./checkpoint-hydration-passport.js";

type DurableRunReadDB = Pick<DrizzleDB, "select">;

export type DurableRunDiagnostic =
  | PersistedEventDiagnostic
  | ProjectionReplayDiagnostic
  | {
      code:
        | "evidence_summary_unavailable"
        | "malformed_checkpoint_hydration_status"
        | "malformed_evidence_storage_provider"
        | "owner_epoch_expired";
      severity: "error";
      message: string;
      sequence?: number;
    };

export interface DurableRunGameIdentity {
  id: string;
  slug?: string;
  status: GameStatus;
  trackType: TrackType;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface DurableRunOwnerSummary {
  status: GameRunOwnerStatus;
  runSource: string;
  kernelHealth: KernelHealthStatus;
  lastPersistedEventSequence: number;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt?: string;
  closedAt?: string;
  revokedAt?: string;
  failureReason?: string;
}

export interface DurableRunEventLogSummary {
  status: "empty" | "complete" | "invalid";
  rowCount: number;
  trustedEventCount: number;
  validPrefixLength: number;
  lastTrustedSequence: number;
  firstInvalidSequence?: number;
  persistedHead?: PersistedEventHead;
}

export interface DurableRunProjectionSummary {
  status: ProjectionReplayStatus;
  replayedEventCount: number;
  summary: DurableProjectionSummary | null;
}

export interface DurableCheckpointSummary {
  lastEventSequence: number;
  checkpointKind: string;
  phase: string | null;
  round: number | null;
  eventHeadHash: string;
  projectionHash: string;
  hydrateable: boolean;
  hydrationStatus: {
    replayableProjection?: boolean;
    missingInputs: string[];
  };
  transcriptCursorPresent: boolean;
  tokenCostCursorPresent: boolean;
  degradedReason?: string;
  createdAt: string;
  /** Validator-derived hydration passport (richer readiness model; candidate != resume). */
  passport: HydrationPassport;
}

export interface DurableEvidenceSummary {
  totalCount: number;
  byEvidenceType: Record<string, number>;
  byRetentionClass: Record<string, number>;
  byRedactionStatus: Record<string, number>;
  storage: {
    withStorageCount: number;
    providerCounts: Record<string, number>;
  };
  eventSequenceCoverage: {
    linkedCount: number;
    minSequence?: number;
    maxSequence?: number;
  };
}

export interface DurableRunInspectionResponse {
  schemaVersion: 1;
  game: DurableRunGameIdentity;
  kernel: {
    health: RedactedKernelHealth;
    owner: DurableRunOwnerSummary | null;
  };
  eventLog: DurableRunEventLogSummary;
  projection: DurableRunProjectionSummary;
  checkpoints: {
    count: number;
    entries: DurableCheckpointSummary[];
  };
  evidence: DurableEvidenceSummary;
  diagnostics: DurableRunDiagnostic[];
}

export type GetDurableRunInspectionResult =
  | { ok: true; response: DurableRunInspectionResponse }
  | { ok: false; statusCode: 404; error: string };

// Re-export passport types for route responses and tests
export type {
  HydrationPassport,
  HydrationPassportVerdict,
  PassportStamp,
  PassportStampId,
  PassportStampStatus,
} from "./checkpoint-hydration-passport.js";

function addCount(target: Record<string, number>, key: string, count: number): void {
  target[key] = (target[key] ?? 0) + count;
}

function toCount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function nullableCount(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const count = toCount(value);
  return Number.isFinite(count) ? count : undefined;
}

function stringArrayFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function summarizeHydrationStatus(
  value: unknown,
  checkpointHydrateable: boolean,
  sequence: number,
): {
  hydrateable: boolean;
  hydrationStatus: DurableCheckpointSummary["hydrationStatus"];
  diagnostics: DurableRunDiagnostic[];
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      hydrateable: false,
      hydrationStatus: { missingInputs: ["malformed_hydration_status"] },
      diagnostics: [{
        code: "malformed_checkpoint_hydration_status",
        severity: "error",
        message: "Checkpoint hydration status is not a JSON object",
        sequence,
      }],
    };
  }

  const record = value as Record<string, unknown>;
  const missingInputsRaw = record.missingInputs;
  const missingInputs = stringArrayFromUnknown(missingInputsRaw);
  const malformedMissingInputs = !Array.isArray(missingInputsRaw) ||
    missingInputs.length !== missingInputsRaw.length;
  const hasMissingInputs = missingInputs.length > 0;
  const diagnostics: DurableRunDiagnostic[] = [];

  if (malformedMissingInputs || (checkpointHydrateable && hasMissingInputs)) {
    diagnostics.push({
      code: "malformed_checkpoint_hydration_status",
      severity: "error",
      message: "Checkpoint hydration status cannot support hydrateable=true",
      sequence,
    });
  }

  return {
    hydrateable: checkpointHydrateable && !malformedMissingInputs && !hasMissingInputs,
    hydrationStatus: {
      ...(typeof record.replayableProjection === "boolean" && {
        replayableProjection: record.replayableProjection,
      }),
      missingInputs: malformedMissingInputs
        ? ["malformed_hydration_status", ...missingInputs]
        : missingInputs,
    },
    diagnostics,
  };
}

function safeStorageProvider(provider: string | null): "linode_object_storage" | "unknown" | null {
  if (!provider) return null;
  return provider === "linode_object_storage" ? "linode_object_storage" : "unknown";
}

function emptyEvidenceSummary(): DurableEvidenceSummary {
  return {
    totalCount: 0,
    byEvidenceType: {},
    byRetentionClass: {},
    byRedactionStatus: {},
    storage: {
      withStorageCount: 0,
      providerCounts: {},
    },
    eventSequenceCoverage: {
      linkedCount: 0,
    },
  };
}

async function getEvidenceSummary(
  db: DurableRunReadDB,
  gameId: string,
): Promise<{ summary: DurableEvidenceSummary; diagnostics: DurableRunDiagnostic[] }> {
  try {
    const [totals] = await db
      .select({
        totalCount: sql<number>`count(*)::int`,
        withStorageCount: sql<number>`count(${schema.gameEvidenceManifests.storageProvider})::int`,
        linkedCount: sql<number>`count(${schema.gameEvidenceManifests.eventSequence})::int`,
        minSequence: sql<number | null>`min(${schema.gameEvidenceManifests.eventSequence})::int`,
        maxSequence: sql<number | null>`max(${schema.gameEvidenceManifests.eventSequence})::int`,
      })
      .from(schema.gameEvidenceManifests)
      .where(eq(schema.gameEvidenceManifests.gameId, gameId));

    const evidenceTypeRows = await db
      .select({
        key: schema.gameEvidenceManifests.evidenceType,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.gameEvidenceManifests)
      .where(eq(schema.gameEvidenceManifests.gameId, gameId))
      .groupBy(schema.gameEvidenceManifests.evidenceType);

    const retentionClassRows = await db
      .select({
        key: schema.gameEvidenceManifests.retentionClass,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.gameEvidenceManifests)
      .where(eq(schema.gameEvidenceManifests.gameId, gameId))
      .groupBy(schema.gameEvidenceManifests.retentionClass);

    const redactionStatusRows = await db
      .select({
        key: schema.gameEvidenceManifests.redactionStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.gameEvidenceManifests)
      .where(eq(schema.gameEvidenceManifests.gameId, gameId))
      .groupBy(schema.gameEvidenceManifests.redactionStatus);

    const storageProviderRows = await db
      .select({
        provider: schema.gameEvidenceManifests.storageProvider,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.gameEvidenceManifests)
      .where(and(
        eq(schema.gameEvidenceManifests.gameId, gameId),
        isNotNull(schema.gameEvidenceManifests.storageProvider),
      ))
      .groupBy(schema.gameEvidenceManifests.storageProvider);

    const summary = emptyEvidenceSummary();
    summary.totalCount = toCount(totals?.totalCount);
    summary.storage.withStorageCount = toCount(totals?.withStorageCount);
    summary.eventSequenceCoverage.linkedCount = toCount(totals?.linkedCount);
    const minSequence = nullableCount(totals?.minSequence);
    const maxSequence = nullableCount(totals?.maxSequence);

    for (const row of evidenceTypeRows) {
      summary.byEvidenceType[row.key] = toCount(row.count);
    }
    for (const row of retentionClassRows) {
      summary.byRetentionClass[row.key] = toCount(row.count);
    }
    for (const row of redactionStatusRows) {
      summary.byRedactionStatus[row.key] = toCount(row.count);
    }

    if (minSequence !== undefined) {
      summary.eventSequenceCoverage.minSequence = minSequence;
    }
    if (maxSequence !== undefined) {
      summary.eventSequenceCoverage.maxSequence = maxSequence;
    }

    const diagnostics: DurableRunDiagnostic[] = [];
    let malformedStorageProviderCount = 0;
    for (const row of storageProviderRows) {
      const provider = safeStorageProvider(row.provider);
      if (!provider) continue;
      const count = toCount(row.count);
      addCount(summary.storage.providerCounts, provider, count);
      if (provider === "unknown") {
        malformedStorageProviderCount += count;
      }
    }

    if (malformedStorageProviderCount > 0) {
      diagnostics.push({
        code: "malformed_evidence_storage_provider",
        severity: "error",
        message: `${malformedStorageProviderCount} evidence manifest storage provider values were unsupported`,
      });
    }

    return { summary, diagnostics };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      summary: emptyEvidenceSummary(),
      diagnostics: [{
        code: "evidence_summary_unavailable",
        severity: "error",
        message,
      }],
    };
  }
}

interface DurableRunGameRow {
  id: string;
  slug: string | null;
  status: GameStatus;
  trackType: TrackType;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

interface DurableRunOwnerRow {
  status: GameRunOwnerStatus;
  runSource: string;
  kernelHealth: KernelHealthStatus;
  lastPersistedEventSequence: number;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string | null;
  closedAt: string | null;
  revokedAt: string | null;
  failureReason: string | null;
}

async function resolveGameByIdOrSlug(
  db: DurableRunReadDB,
  idOrSlug: string,
): Promise<DurableRunGameRow | null> {
  const selection = {
    id: schema.games.id,
    slug: schema.games.slug,
    status: schema.games.status,
    trackType: schema.games.trackType,
    createdAt: schema.games.createdAt,
    startedAt: schema.games.startedAt,
    endedAt: schema.games.endedAt,
  };
  const byId = (await db
    .select(selection)
    .from(schema.games)
    .where(eq(schema.games.id, idOrSlug))
    .limit(1))[0];
  if (byId) return byId;

  return (await db
    .select(selection)
    .from(schema.games)
    .where(eq(schema.games.slug, idOrSlug))
    .limit(1))[0] ?? null;
}

function ownerIsExpiredAtInspection(owner: DurableRunOwnerRow): boolean {
  if (owner.status !== "active" || !owner.expiresAt) return false;
  const expiresAtMs = Date.parse(owner.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
}

function summarizeOwnerAtInspection(
  owner: DurableRunOwnerRow | null,
): {
  owner: DurableRunOwnerSummary | null;
  healthStatus: KernelHealthStatus | undefined;
  diagnostics: DurableRunDiagnostic[];
} {
  if (!owner) {
    return { owner: null, healthStatus: undefined, diagnostics: [] };
  }

  const expired = ownerIsExpiredAtInspection(owner);
  const effectiveStatus: GameRunOwnerStatus = expired ? "expired" : owner.status;
  const effectiveKernelHealth: KernelHealthStatus = expired ? "suspended" : owner.kernelHealth;
  const diagnostics: DurableRunDiagnostic[] = expired
    ? [{
        code: "owner_epoch_expired",
        severity: "error",
        message: "Active durable owner epoch is expired at inspection time",
      }]
    : [];

  return {
    owner: {
      status: effectiveStatus,
      runSource: owner.runSource,
      kernelHealth: effectiveKernelHealth,
      lastPersistedEventSequence: owner.lastPersistedEventSequence,
      acquiredAt: owner.acquiredAt,
      heartbeatAt: owner.heartbeatAt,
      ...(owner.expiresAt && { expiresAt: owner.expiresAt }),
      ...(owner.closedAt && { closedAt: owner.closedAt }),
      ...(owner.revokedAt && { revokedAt: owner.revokedAt }),
      ...(owner.failureReason && { failureReason: owner.failureReason }),
    },
    healthStatus: effectiveKernelHealth,
    diagnostics,
  };
}

export async function getDurableRunInspection(
  db: DrizzleDB,
  idOrSlug: string,
): Promise<GetDurableRunInspectionResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);

    const game = await resolveGameByIdOrSlug(tx, idOrSlug);

    if (!game) {
      return { ok: false, statusCode: 404, error: "Game not found" };
    }

    const persistedEvents = await getPersistedGameEvents(tx, game.id);
    const owner = (await tx
      .select({
        status: schema.gameRunOwners.status,
        runSource: schema.gameRunOwners.runSource,
        kernelHealth: schema.gameRunOwners.kernelHealth,
        lastPersistedEventSequence: schema.gameRunOwners.lastPersistedEventSequence,
        acquiredAt: schema.gameRunOwners.acquiredAt,
        heartbeatAt: schema.gameRunOwners.heartbeatAt,
        expiresAt: schema.gameRunOwners.expiresAt,
        closedAt: schema.gameRunOwners.closedAt,
        revokedAt: schema.gameRunOwners.revokedAt,
        failureReason: schema.gameRunOwners.failureReason,
      })
      .from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.gameId, game.id))
      .orderBy(desc(schema.gameRunOwners.acquiredAt), desc(schema.gameRunOwners.createdAt))
      .limit(1)
    )[0] ?? null;
    const checkpointRows = await tx
      .select({
        lastEventSequence: schema.gameCheckpoints.lastEventSequence,
        checkpointKind: schema.gameCheckpoints.checkpointKind,
        ownerEpoch: schema.gameCheckpoints.ownerEpoch,
        phase: schema.gameCheckpoints.phase,
        round: schema.gameCheckpoints.round,
        eventHeadHash: schema.gameCheckpoints.eventHeadHash,
        projectionHash: schema.gameCheckpoints.projectionHash,
        hydrateable: schema.gameCheckpoints.hydrateable,
        hydrationStatus: schema.gameCheckpoints.hydrationStatus,
        snapshot: schema.gameCheckpoints.snapshot,
        transcriptCursor: schema.gameCheckpoints.transcriptCursor,
        tokenCostCursor: schema.gameCheckpoints.tokenCostCursor,
        degradedReason: schema.gameCheckpoints.degradedReason,
        createdAt: schema.gameCheckpoints.createdAt,
      })
      .from(schema.gameCheckpoints)
      .where(eq(schema.gameCheckpoints.gameId, game.id))
      .orderBy(
        asc(schema.gameCheckpoints.lastEventSequence),
        asc(schema.gameCheckpoints.createdAt),
      );
    const evidence = await getEvidenceSummary(tx, game.id);

    const projection = getPersistedGameProjection(persistedEvents);
    const ownerSummary = summarizeOwnerAtInspection(owner);
    const kernelHealth = buildRedactedKernelHealth({
      status: ownerSummary.healthStatus,
      ownerLastPersistedEventSequence: owner?.lastPersistedEventSequence,
      maxEventSequence: persistedEvents.persistedHead?.sequence,
      durableEventCount: persistedEvents.eventCount,
      checkpointCount: checkpointRows.length,
      evidenceManifestCount: evidence.summary.totalCount,
    });
    const checkpointDiagnostics: DurableRunDiagnostic[] = [];

    const checkpoints: DurableCheckpointSummary[] = checkpointRows.map((checkpoint) => {
      const hydration = summarizeHydrationStatus(
        checkpoint.hydrationStatus,
        checkpoint.hydrateable,
        checkpoint.lastEventSequence,
      );
      checkpointDiagnostics.push(...hydration.diagnostics);

      // Derive passport (U1 skeleton uses current forensic shape; later units populate manifest/boundary/continuity)
      const passportResult = deriveHydrationPassport({
        lastEventSequence: checkpoint.lastEventSequence,
        checkpointKind: checkpoint.checkpointKind,
        hydrateable: checkpoint.hydrateable,
        hydrationStatus: checkpoint.hydrationStatus,
        snapshot: checkpoint.snapshot,
        transcriptCursor: checkpoint.transcriptCursor,
        tokenCostCursor: checkpoint.tokenCostCursor,
        eventHeadHash: checkpoint.eventHeadHash,
        checkpointOwnerEpoch: checkpoint.ownerEpoch,
        degradedReason: checkpoint.degradedReason ?? null,
        createdAt: checkpoint.createdAt,
        eventLogStatus: persistedEvents.status,
        projectionStatus: projection.status,
        hasValidEventPrefixUpTo: (seq) =>
          persistedEvents.status !== "invalid" && persistedEvents.lastTrustedSequence >= seq,
        hasValidProjectionUpTo: (seq) => {
          const st = projection.status as string;
          return (st === "replayed" || st === "complete") && projection.replayedEventCount >= seq;
        },
      });
      checkpointDiagnostics.push(...passportResult.diagnostics);

      return {
        lastEventSequence: checkpoint.lastEventSequence,
        checkpointKind: checkpoint.checkpointKind,
        phase: checkpoint.phase,
        round: checkpoint.round,
        eventHeadHash: checkpoint.eventHeadHash,
        projectionHash: checkpoint.projectionHash,
        hydrateable: hydration.hydrateable,
        hydrationStatus: hydration.hydrationStatus,
        transcriptCursorPresent: checkpoint.transcriptCursor !== null,
        tokenCostCursorPresent: checkpoint.tokenCostCursor !== null,
        ...(checkpoint.degradedReason && { degradedReason: checkpoint.degradedReason }),
        createdAt: checkpoint.createdAt,
        passport: passportResult.passport,
      };
    });

    const diagnostics: DurableRunDiagnostic[] = [
      ...projection.diagnostics,
      ...ownerSummary.diagnostics,
      ...checkpointDiagnostics,
      ...evidence.diagnostics,
    ];

    return {
      ok: true,
      response: {
        schemaVersion: 1,
        game: {
          id: game.id,
          ...(game.slug && { slug: game.slug }),
          status: game.status,
          trackType: game.trackType,
          createdAt: game.createdAt,
          ...(game.startedAt && { startedAt: game.startedAt }),
          ...(game.endedAt && { endedAt: game.endedAt }),
        },
        kernel: {
          health: kernelHealth,
          owner: ownerSummary.owner,
        },
        eventLog: {
          status: persistedEvents.status,
          rowCount: persistedEvents.eventCount,
          trustedEventCount: persistedEvents.events.length,
          validPrefixLength: persistedEvents.validPrefixLength,
          lastTrustedSequence: persistedEvents.lastTrustedSequence,
          ...(persistedEvents.firstInvalidSequence !== undefined && {
            firstInvalidSequence: persistedEvents.firstInvalidSequence,
          }),
          ...(persistedEvents.persistedHead && { persistedHead: persistedEvents.persistedHead }),
        },
        projection: {
          status: projection.status,
          replayedEventCount: projection.replayedEventCount,
          summary: projection.summary,
        },
        checkpoints: {
          count: checkpoints.length,
          entries: checkpoints,
        },
        evidence: evidence.summary,
        diagnostics,
      },
    };
  });
}
