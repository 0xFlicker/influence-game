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
  getPersistedGameProjectionBeforeTerminalOutcome,
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
import { checkpointHasImplementedResumeSupport } from "./game-recovery-support.js";
import {
  getGameCompletionSettlementSummary,
  type GameCompletionSettlementSummary,
} from "./game-completion-settlement.js";

type DurableRunReadDB = Pick<DrizzleDB, "select">;

export type DurableRunDiagnostic =
  | PersistedEventDiagnostic
  | ProjectionReplayDiagnostic
  | {
      code:
        | "evidence_summary_unavailable"
        | "malformed_private_content_storage_provider"
        | "owner_epoch_expired";
      severity: "error";
      message: string;
      sequence?: number;
    };

export interface DurableRunGameIdentity {
  id: string;
  slug: string;
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
  actorCoordinate: string;
  phase: string | null;
  round: number | null;
  eventHeadHash: string;
  projectionHash: string;
  transcriptCursorPresent: boolean;
  tokenCostCursorPresent: boolean;
  createdAt: string;
  /** Validator-derived hydration passport (richer readiness model; candidate != resume). */
  passport: HydrationPassport;
  /** True only when the implemented startup recovery path supports this checkpoint. */
  resumeAvailable: boolean;
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

export type FinaleIntegrityCode =
  | "judgment_closing_argument_missing"
  | "judgment_opening_statement_missing";

export interface FinaleIntegrityFinding {
  code: FinaleIntegrityCode;
  severity: "warning";
  message: string;
}

export interface DurableRunFinaleIntegrity {
  /** Whether Judgment completion evidence was detected. */
  judgmentDetected: boolean;
  status: "not_applicable" | "complete" | "incomplete";
  openingStatementCount: number;
  closingArgumentCount: number;
  expectedOpeningStatements: number | null;
  expectedClosingArguments: number | null;
  findings: FinaleIntegrityFinding[];
}

export interface DurableRunInspectionResponse {
  schemaVersion: 2;
  game: DurableRunGameIdentity;
  completionSettlement: GameCompletionSettlementSummary;
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
  /** Separate from envelope eventLogStatus — missing speeches do not invalidate the log. */
  finaleIntegrity: DurableRunFinaleIntegrity;
  diagnostics: DurableRunDiagnostic[];
}

export function buildFinaleIntegrity(
  events: ReadonlyArray<{ type?: string; payload?: Record<string, unknown> }>,
): DurableRunFinaleIntegrity {
  const hasWinner = events.some((event) => event.type === "jury.winner_determined");
  if (!hasWinner) {
    return {
      judgmentDetected: false,
      status: "not_applicable",
      openingStatementCount: 0,
      closingArgumentCount: 0,
      expectedOpeningStatements: null,
      expectedClosingArguments: null,
      findings: [],
    };
  }

  let openingStatementCount = 0;
  let closingArgumentCount = 0;
  for (const event of events) {
    if (event.type !== "judgment.speech_recorded") continue;
    const kind = event.payload?.speechKind;
    if (kind === "opening_statement") openingStatementCount += 1;
    if (kind === "closing_argument") closingArgumentCount += 1;
  }

  // Two finalists reach Judgment in the current ruleset.
  const expectedOpeningStatements = 2;
  const expectedClosingArguments = 2;
  const findings: FinaleIntegrityFinding[] = [];
  if (openingStatementCount < expectedOpeningStatements) {
    findings.push({
      code: "judgment_opening_statement_missing",
      severity: "warning",
      message: `Expected ${expectedOpeningStatements} Judgment opening statements but found ${openingStatementCount}.`,
    });
  }
  if (closingArgumentCount < expectedClosingArguments) {
    findings.push({
      code: "judgment_closing_argument_missing",
      severity: "warning",
      message: `Expected ${expectedClosingArguments} Judgment closing arguments but found ${closingArgumentCount}.`,
    });
  }

  return {
    judgmentDetected: true,
    status: findings.length === 0 ? "complete" : "incomplete",
    openingStatementCount,
    closingArgumentCount,
    expectedOpeningStatements,
    expectedClosingArguments,
    findings,
  };
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
        code: "malformed_private_content_storage_provider",
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
  slug: string;
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

    const completionSettlement = await getGameCompletionSettlementSummary(tx, game.id);
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
        actorCoordinate: schema.gameCheckpoints.actorCoordinate,
        ownerEpoch: schema.gameCheckpoints.ownerEpoch,
        phase: schema.gameCheckpoints.phase,
        round: schema.gameCheckpoints.round,
        eventHeadHash: schema.gameCheckpoints.eventHeadHash,
        projectionHash: schema.gameCheckpoints.projectionHash,
        snapshot: schema.gameCheckpoints.snapshot,
        transcriptCursor: schema.gameCheckpoints.transcriptCursor,
        tokenCostCursor: schema.gameCheckpoints.tokenCostCursor,
        createdAt: schema.gameCheckpoints.createdAt,
      })
      .from(schema.gameCheckpoints)
      .where(eq(schema.gameCheckpoints.gameId, game.id))
      .orderBy(
        asc(schema.gameCheckpoints.lastEventSequence),
        asc(schema.gameCheckpoints.createdAt),
      );
    const evidence = await getEvidenceSummary(tx, game.id);

    const sealedNonfinal = completionSettlement.state === "pending"
      || completionSettlement.state === "repair_required";
    const projection = sealedNonfinal
      ? getPersistedGameProjectionBeforeTerminalOutcome(persistedEvents)
      : getPersistedGameProjection(persistedEvents);
    const projectionSummary = projection.summary;
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
      // Derive passport from persisted evidence; this is the checkpoint readiness source of truth.
      const passportResult = deriveHydrationPassport({
        lastEventSequence: checkpoint.lastEventSequence,
        checkpointKind: checkpoint.checkpointKind,
        snapshot: checkpoint.snapshot,
        transcriptCursor: checkpoint.transcriptCursor,
        tokenCostCursor: checkpoint.tokenCostCursor,
        eventHeadHash: checkpoint.eventHeadHash,
        projectionHash: checkpoint.projectionHash,
        checkpointPhase: checkpoint.phase,
        checkpointRound: checkpoint.round,
        checkpointOwnerEpoch: checkpoint.ownerEpoch,
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
        actorCoordinate: checkpoint.actorCoordinate,
        phase: checkpoint.phase,
        round: checkpoint.round,
        eventHeadHash: checkpoint.eventHeadHash,
        projectionHash: checkpoint.projectionHash,
        transcriptCursorPresent: checkpoint.transcriptCursor !== null,
        tokenCostCursorPresent: checkpoint.tokenCostCursor !== null,
        createdAt: checkpoint.createdAt,
        passport: passportResult.passport,
        resumeAvailable: checkpointHasImplementedResumeSupport({
          gameStatus: game.status,
          checkpoint,
          persistedEvents,
        }),
      };
    });

    const diagnostics: DurableRunDiagnostic[] = [
      ...projection.diagnostics,
      ...ownerSummary.diagnostics,
      ...checkpointDiagnostics,
      ...evidence.diagnostics,
    ];
    const finaleIntegrity = buildFinaleIntegrity(
      persistedEvents.events.map((event) => ({
        type: event.envelope.type,
        payload: event.envelope.payload as Record<string, unknown>,
      })),
    );

    return {
      ok: true,
      response: {
        schemaVersion: 2,
        game: {
          id: game.id,
          slug: game.slug,
          status: game.status,
          trackType: game.trackType,
          createdAt: game.createdAt,
          ...(game.startedAt && { startedAt: game.startedAt }),
          ...(game.endedAt && { endedAt: game.endedAt }),
        },
        completionSettlement,
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
          summary: projectionSummary,
        },
        checkpoints: {
          count: checkpoints.length,
          entries: checkpoints,
        },
        evidence: evidence.summary,
        finaleIntegrity,
        diagnostics,
      },
    };
  });
}
