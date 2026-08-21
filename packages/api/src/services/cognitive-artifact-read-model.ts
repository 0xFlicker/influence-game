import { and, count, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type {
  CognitiveArtifactActorRole,
  CognitiveArtifactReadOutcome,
  CognitiveArtifactType,
} from "../db/schema.js";
import { resolveGamesMcpClaims } from "../game-mcp/claims.js";
import {
  canListCognitiveArtifactsForGame,
  canReadCognitiveArtifact,
  hasProducerCognitiveArtifactAccess,
  isSubjectVisibleActorRole,
  type CognitiveArtifactAccessor,
} from "./cognitive-artifact-policy.js";
import { COGNITIVE_ARTIFACT_CAPTURE_VERSION } from "./cognitive-artifact-writer.js";
import {
  bindProducerIndexCursor,
  decodeProducerIndexCursor,
  issueProducerIndexCursor,
  type ProducerIndexCursorClaims,
  type ProducerIndexCursorFilters,
  type ProducerIndexCursorPosition,
} from "./producer-index-cursor.js";
import { sha256StableJson } from "./stable-hash.js";

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const USER_LIST_SCAN_LIMIT = 500;

type CognitiveArtifactRow = typeof schema.gameCognitiveArtifacts.$inferSelect;
type CognitiveArtifactIndexRow = Pick<
  CognitiveArtifactRow,
  | "id"
  | "indexInsertXid"
  | "gameId"
  | "artifactType"
  | "actorRole"
  | "actorPlayerId"
  | "actorUserId"
  | "actorAgentProfileId"
  | "action"
  | "phase"
  | "round"
  | "eventSequence"
  | "visibilityStatus"
  | "redactionStatus"
  | "payloadByteLength"
  | "diagnostics"
  | "createdAt"
>;

export interface CognitiveArtifactGameIdentity {
  id: string;
  slug: string;
  status: string;
  cognitiveArtifactCaptureVersion: number;
}

export interface CognitiveArtifactIndexEntry {
  id: string;
  uri: string;
  gameId: string;
  artifactType: CognitiveArtifactType;
  actorRole: CognitiveArtifactActorRole;
  actorPlayerId?: string;
  actorUserId?: string;
  actorAgentProfileId?: string;
  action: string;
  phase?: string;
  round?: number;
  eventSequence?: number;
  visibilityStatus: string;
  redactionStatus: string;
  payloadByteLength: number;
  diagnostics?: Record<string, unknown>;
  createdAt: string;
}

export interface CognitiveArtifactPayloadRead extends CognitiveArtifactIndexEntry {
  payload: Record<string, unknown>;
}

interface CognitiveArtifactPage {
  artifacts: CognitiveArtifactIndexEntry[];
  pageSize: number;
  totalCount: number;
  nextCursor: string | null;
}

export type CognitiveArtifactListResult =
  | {
    ok: true;
    game: CognitiveArtifactGameIdentity;
    artifacts: CognitiveArtifactIndexEntry[];
    pageSize: number;
    totalCount: number;
    nextCursor: string | null;
  }
  | {
    ok: true;
    game: CognitiveArtifactGameIdentity;
    artifacts: CognitiveArtifactIndexEntry[];
    pageSize?: never;
    totalCount?: never;
    nextCursor?: never;
  }
  | {
    ok: false;
    status: "denied" | "not_found" | "not_captured_for_game" | "cursor_invalid_or_stale";
    error: string;
  };

export type CognitiveArtifactReadResult =
  | {
    ok: true;
    game: CognitiveArtifactGameIdentity;
    artifact: CognitiveArtifactPayloadRead;
  }
  | {
    ok: false;
    status: "denied" | "not_found" | "not_captured" | "not_captured_for_game" | "capture_degraded" | "expired" | "redacted";
    error: string;
    game?: CognitiveArtifactGameIdentity;
    artifact?: CognitiveArtifactIndexEntry;
    diagnostics?: Record<string, unknown>;
  };

export interface ListCognitiveArtifactsParams {
  gameIdOrSlug: string;
  artifactType?: CognitiveArtifactType;
  actorPlayerId?: string;
  limit?: number;
  cursor?: string;
}

export interface ReadCognitiveArtifactParams {
  gameIdOrSlug: string;
  artifactId: string;
  artifactType?: CognitiveArtifactType;
  actorRole?: CognitiveArtifactActorRole;
  actorPlayerId?: string;
  purpose?: string;
}

export class CognitiveArtifactReadModel {
  constructor(
    private readonly db: DrizzleDB,
    private readonly cursorSecret?: string,
  ) {}

  async listArtifacts(
    params: ListCognitiveArtifactsParams,
    accessor: CognitiveArtifactAccessor,
  ): Promise<CognitiveArtifactListResult> {
    const game = await this.resolveGame(params.gameIdOrSlug);
    if (!game) {
      return isProducer(accessor)
        ? { ok: false, status: "not_found", error: "Game not found" }
        : { ok: false, status: "denied", error: "Game is not accessible" };
    }

    const access = await this.withClaims(accessor);
    if (!canListCognitiveArtifactsForGame(access, game.id)) {
      return { ok: false, status: "denied", error: "Cognitive artifacts are not accessible for this game" };
    }

    if (game.cognitiveArtifactCaptureVersion !== COGNITIVE_ARTIFACT_CAPTURE_VERSION) {
      return {
        ok: false,
        status: "not_captured_for_game",
        error: "Cognitive artifacts were not captured for this game",
      };
    }

    const decodedCursor = params.cursor
      ? decodeProducerIndexCursor(params.cursor, {
          expectedKind: "cognitive_artifact",
          secretMaterial: this.cursorSecret,
        })
      : null;
    if (decodedCursor?.status === "invalid") {
      return invalidCursor();
    }

    const filters = effectiveCognitiveFilters(params, decodedCursor?.claims ?? null);
    if (!filters) return invalidCursor();

    const limit = clamp(params.limit ?? DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
    const conditions: SQL[] = [
      eq(schema.gameCognitiveArtifacts.gameId, game.id),
    ];
    if (filters.artifactType) {
      conditions.push(eq(schema.gameCognitiveArtifacts.artifactType, filters.artifactType));
    }
    if (filters.actorPlayerId) {
      conditions.push(eq(schema.gameCognitiveArtifacts.actorPlayerId, filters.actorPlayerId));
    }

    const producer = hasProducerCognitiveArtifactAccess(access);
    const subjectOwner = access.surfaceCapability === "subject_owner";

    // subject_owner: apply ownership + actor-role filters in SQL before limit so
    // non-owned rows cannot exhaust a scan window (U5 / KTD11).
    if (subjectOwner && !producer) {
      const ownership = ownershipSqlConditions(access);
      if (!ownership) {
        return {
          ok: true,
          game,
          artifacts: [],
          pageSize: 0,
          totalCount: 0,
          nextCursor: null,
        };
      }
      conditions.push(ownership);
      conditions.push(inArray(schema.gameCognitiveArtifacts.actorRole, ["player", "juror"]));
    }

    if (!producer && !subjectOwner) {
      if (params.cursor) return invalidCursor();
      const rows = await this.db
        .select(cognitiveArtifactIndexSelection(false))
        .from(schema.gameCognitiveArtifacts)
        .where(and(...conditions))
        .orderBy(
          desc(schema.gameCognitiveArtifacts.createdAt),
          desc(schema.gameCognitiveArtifacts.id),
        )
        .limit(USER_LIST_SCAN_LIMIT);
      const artifacts = rows
        .filter((row) => canReadCognitiveArtifact(access, artifactPolicyContext(row)))
        .slice(0, limit)
        .map((row) => indexEntry(row, false));
      return {
        ok: true,
        game,
        artifacts,
      };
    }

    const bindingFingerprint = cognitiveCursorBinding(access, producer);
    if (decodedCursor?.status === "ok" && !bindProducerIndexCursor({
      claims: decodedCursor.claims,
      kind: "cognitive_artifact",
      bindingFingerprint,
      gameId: game.id,
      filters,
    })) {
      return invalidCursor();
    }

    const page = await this.listSqlAuthorizedPage({
      conditions,
      access,
      producer,
      gameId: game.id,
      filters,
      bindingFingerprint,
      cursor: decodedCursor?.status === "ok" ? decodedCursor.claims : null,
      limit,
    });

    return {
      ok: true,
      game,
      ...page,
    };
  }

  private async listSqlAuthorizedPage(params: {
    conditions: SQL[];
    access: CognitiveArtifactAccessor;
    producer: boolean;
    gameId: string;
    filters: ProducerIndexCursorFilters;
    bindingFingerprint: string;
    cursor: ProducerIndexCursorClaims | null;
    limit: number;
  }): Promise<CognitiveArtifactPage> {
    const databaseSnapshot = params.cursor?.databaseSnapshot
      ?? await readCurrentDatabaseSnapshot(this.db);
    const pageConditions = [...params.conditions];
    addDatabaseSnapshotCondition(pageConditions, databaseSnapshot);
    if (params.cursor) {
      addReadThroughCondition(pageConditions, params.cursor.readThrough);
      addKeysetCondition(pageConditions, params.cursor.keyset);
    }

    const rows = await this.db
      .select(cognitiveArtifactIndexSelection(params.producer))
      .from(schema.gameCognitiveArtifacts)
      .where(and(...pageConditions))
      .orderBy(
        desc(schema.gameCognitiveArtifacts.createdAt),
        desc(schema.gameCognitiveArtifacts.id),
      )
      .limit(params.limit + 1);

    const readThrough = params.cursor?.readThrough ?? positionFor(rows[0]);
    const snapshotConditions = [...params.conditions];
    addDatabaseSnapshotCondition(snapshotConditions, databaseSnapshot);
    addReadThroughCondition(snapshotConditions, readThrough);
    const totalCount = params.cursor?.totalCount ?? (await this.db
      .select({ value: count() })
      .from(schema.gameCognitiveArtifacts)
      .where(and(...snapshotConditions)))[0]?.value ?? 0;
    const hasMore = rows.length > params.limit;
    const pageRows = rows.slice(0, params.limit)
      .filter((row) => canReadCognitiveArtifact(params.access, artifactPolicyContext(row)));
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last
      ? issueProducerIndexCursor({
          kind: "cognitive_artifact",
          bindingFingerprint: params.bindingFingerprint,
          gameId: params.gameId,
          filters: params.filters,
          databaseSnapshot,
          readThrough,
          keyset: positionFor(last),
          totalCount,
        }, this.cursorSecret)
      : null;

    return {
      artifacts: pageRows.map((row) => indexEntry(row, params.producer)),
      pageSize: pageRows.length,
      totalCount,
      nextCursor,
    };
  }

  async readArtifact(
    params: ReadCognitiveArtifactParams,
    accessor: CognitiveArtifactAccessor,
  ): Promise<CognitiveArtifactReadResult> {
    const purpose = params.purpose ?? "read_cognitive_artifact";
    const game = await this.resolveGame(params.gameIdOrSlug);
    if (!game) {
      return isProducer(accessor)
        ? { ok: false, status: "not_found", error: "Game not found" }
        : { ok: false, status: "denied", error: "Game is not accessible" };
    }

    const access = await this.withClaims(accessor);
    if (!canListCognitiveArtifactsForGame(access, game.id)) {
      await this.audit({
        gameId: game.id,
        accessor: access,
        purpose,
        outcome: "denied",
        denialReason: "game_not_accessible",
      });
      return {
        ok: false,
        status: "denied",
        error: "Cognitive artifacts are not accessible for this game",
        game,
      };
    }

    if (
      access.authProfile === "subject" &&
      (!params.artifactType || !params.actorPlayerId)
    ) {
      await this.audit({
        gameId: game.id,
        actorPlayerId: params.actorPlayerId,
        artifactType: params.artifactType,
        accessor: access,
        purpose,
        outcome: "denied",
        denialReason: "artifact_context_required",
      });
      return {
        ok: false,
        status: "denied",
        error: "Cognitive artifact context is required",
        game,
      };
    }

    if (
      access.authProfile === "subject" &&
      params.artifactType &&
      params.actorPlayerId
    ) {
      const contextAllowed = canReadCognitiveArtifact(access, {
        gameId: game.id,
        artifactType: params.artifactType,
        actorRole: params.actorRole ?? "player",
        actorPlayerId: params.actorPlayerId,
      });
      if (!contextAllowed) {
        await this.audit({
          gameId: game.id,
          actorPlayerId: params.actorPlayerId,
          artifactType: params.artifactType,
          accessor: access,
          purpose,
          outcome: "denied",
          denialReason: "artifact_context_not_accessible",
        });
        // subject_owner: non-owned context is non-enumerating (same as denied).
        return {
          ok: false,
          status: "denied",
          error: "Cognitive artifact is not accessible",
          game,
        };
      }
    }

    if (game.cognitiveArtifactCaptureVersion !== COGNITIVE_ARTIFACT_CAPTURE_VERSION) {
      await this.audit({
        gameId: game.id,
        actorPlayerId: params.actorPlayerId,
        artifactType: params.artifactType,
        accessor: access,
        purpose,
        outcome: "not_captured_for_game",
      });
      return {
        ok: false,
        status: "not_captured_for_game",
        error: "Cognitive artifacts were not captured for this game",
        game,
      };
    }

    const rowConditions = [
      eq(schema.gameCognitiveArtifacts.id, params.artifactId),
      eq(schema.gameCognitiveArtifacts.gameId, game.id),
    ];
    if (access.authProfile === "subject") {
      rowConditions.push(eq(schema.gameCognitiveArtifacts.artifactType, params.artifactType!));
      rowConditions.push(eq(schema.gameCognitiveArtifacts.actorPlayerId, params.actorPlayerId!));
    }

    const row = (await this.db
      .select()
      .from(schema.gameCognitiveArtifacts)
      .where(and(...rowConditions))
      .limit(1))[0];

    if (!row) {
      await this.audit({
        gameId: game.id,
        actorPlayerId: params.actorPlayerId,
        artifactType: params.artifactType,
        accessor: access,
        purpose,
        outcome: "not_captured",
      });
      return {
        ok: false,
        status: "not_captured",
        error: "Cognitive artifact was not captured",
        game,
      };
    }

    if (!canReadCognitiveArtifact(access, artifactPolicyContext(row))) {
      await this.audit({
        artifact: row,
        accessor: access,
        purpose,
        outcome: "denied",
        denialReason: "artifact_not_accessible",
      });
      return {
        ok: false,
        status: "denied",
        error: "Cognitive artifact is not accessible",
        game,
      };
    }

    // subject surfaces never reveal house/system/producer rows even if mis-tagged.
    if (
      access.authProfile === "subject"
      && !isSubjectVisibleActorRole(row.actorRole)
    ) {
      await this.audit({
        artifact: row,
        accessor: access,
        purpose,
        outcome: "denied",
        denialReason: "artifact_not_accessible",
      });
      return {
        ok: false,
        status: "denied",
        error: "Cognitive artifact is not accessible",
        game,
      };
    }

    const unavailable = unavailableStatus(row);
    if (unavailable) {
      await this.audit({
        artifact: row,
        accessor: access,
        purpose,
        outcome: unavailable,
      });
      return {
        ok: false,
        status: unavailable,
        error: `Cognitive artifact is ${unavailable}`,
        game,
        artifact: indexEntry(row, hasProducerCognitiveArtifactAccess(access)),
        ...(hasProducerCognitiveArtifactAccess(access) && row.diagnostics && {
          diagnostics: row.diagnostics,
        }),
      };
    }

    await this.audit({
      artifact: row,
      accessor: access,
      purpose,
      outcome: "allowed",
    });

    return {
      ok: true,
      game,
      artifact: {
        ...indexEntry(row, hasProducerCognitiveArtifactAccess(access)),
        payload: row.payload,
      },
    };
  }

  async resolveGame(idOrSlug: string): Promise<CognitiveArtifactGameIdentity | null> {
    const row = (await this.db
      .select({
        id: schema.games.id,
        slug: schema.games.slug,
        status: schema.games.status,
        cognitiveArtifactCaptureVersion: schema.games.cognitiveArtifactCaptureVersion,
      })
      .from(schema.games)
      .where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug)))
      .limit(1))[0];
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      status: row.status,
      cognitiveArtifactCaptureVersion: row.cognitiveArtifactCaptureVersion,
    };
  }

  private async withClaims(accessor: CognitiveArtifactAccessor): Promise<CognitiveArtifactAccessor> {
    if (accessor.authProfile !== "subject" || accessor.claims || !accessor.userId) {
      return accessor;
    }
    // subject_owner prefers MatchAccessContext; skip cross-game claims when present.
    if (accessor.surfaceCapability === "subject_owner" && accessor.matchAccess) {
      return accessor;
    }
    return {
      ...accessor,
      claims: await resolveGamesMcpClaims(this.db, accessor.userId),
    };
  }

  private async audit(params: {
    artifact?: CognitiveArtifactRow;
    gameId?: string;
    actorPlayerId?: string;
    artifactType?: CognitiveArtifactType;
    accessor: CognitiveArtifactAccessor;
    purpose: string;
    outcome: CognitiveArtifactReadOutcome;
    denialReason?: string;
  }): Promise<void> {
    await this.db.insert(schema.gameCognitiveArtifactReads)
      .values({
        ...(params.artifact && { artifactId: params.artifact.id }),
        gameId: params.artifact?.gameId ?? params.gameId ?? "",
        actorPlayerId: params.artifact?.actorPlayerId ?? params.actorPlayerId,
        artifactType: params.artifact?.artifactType ?? params.artifactType,
        accessorUserId: params.accessor.userId,
        authProfile: params.accessor.authProfile,
        purpose: params.purpose,
        outcome: params.outcome,
        denialReason: params.denialReason,
      });
  }
}

/**
 * Build SQL ownership predicate for subject_owner list. Returns null when the
 * accessor has no ownership material (empty page, not a scan of all rows).
 */
function ownershipSqlConditions(access: CognitiveArtifactAccessor): SQL | null {
  const clauses: SQL[] = [];
  if (access.userId) {
    clauses.push(eq(schema.gameCognitiveArtifacts.actorUserId, access.userId));
  }
  const matchAccess = access.matchAccess;
  if (matchAccess) {
    const playerIds = [...matchAccess.ownedPlayerIds];
    const profileIds = [...matchAccess.ownedAgentProfileIds];
    if (playerIds.length > 0) {
      clauses.push(inArray(schema.gameCognitiveArtifacts.actorPlayerId, playerIds));
    }
    if (profileIds.length > 0) {
      clauses.push(inArray(schema.gameCognitiveArtifacts.actorAgentProfileId, profileIds));
    }
  } else if (access.claims) {
    const playerIds = [...access.claims.playerIds];
    const profileIds = [...access.claims.agentProfileIds];
    if (playerIds.length > 0) {
      clauses.push(inArray(schema.gameCognitiveArtifacts.actorPlayerId, playerIds));
    }
    if (profileIds.length > 0) {
      clauses.push(inArray(schema.gameCognitiveArtifacts.actorAgentProfileId, profileIds));
    }
  }
  if (clauses.length === 0) return null;
  return or(...clauses) ?? null;
}

function effectiveCognitiveFilters(
  params: ListCognitiveArtifactsParams,
  cursor: ProducerIndexCursorClaims | null,
): ProducerIndexCursorFilters | null {
  if (!cursor) {
    return {
      artifactType: params.artifactType ?? null,
      actorPlayerId: params.actorPlayerId ?? null,
    };
  }
  if (params.artifactType !== undefined && params.artifactType !== cursor.filters.artifactType) {
    return null;
  }
  if (params.actorPlayerId !== undefined && params.actorPlayerId !== cursor.filters.actorPlayerId) {
    return null;
  }
  return cursor.filters;
}

function cognitiveCursorBinding(
  access: CognitiveArtifactAccessor,
  producer: boolean,
): string {
  return sha256StableJson({
    domain: "influence.cognitive_artifact.index_binding.v1",
    surface: producer ? "producer" : access.surfaceCapability ?? "participant_web",
    userId: access.userId ?? null,
    ownershipFingerprint: access.matchAccess?.ownershipFingerprint ?? null,
    claimPlayerIds: [...(access.claims?.playerIds ?? [])].sort(),
    claimAgentProfileIds: [...(access.claims?.agentProfileIds ?? [])].sort(),
  });
}

function invalidCursor(): Extract<CognitiveArtifactListResult, { ok: false }> {
  return {
    ok: false,
    status: "cursor_invalid_or_stale",
    error: "Cognitive artifact cursor is invalid or stale",
  };
}

function addReadThroughCondition(
  conditions: SQL[],
  readThrough: ProducerIndexCursorPosition,
): void {
  if (readThrough.createdAt === null || readThrough.id === null) {
    conditions.push(sql`false`);
    return;
  }
  conditions.push(sql`(
    ${schema.gameCognitiveArtifacts.createdAt} < ${readThrough.createdAt}
    OR (
      ${schema.gameCognitiveArtifacts.createdAt} = ${readThrough.createdAt}
      AND ${schema.gameCognitiveArtifacts.id} <= ${readThrough.id}
    )
  )`);
}

function addDatabaseSnapshotCondition(
  conditions: SQL[],
  databaseSnapshot: string,
): void {
  conditions.push(sql`(
    ${schema.gameCognitiveArtifacts.indexInsertXid} IS NULL
    OR pg_visible_in_snapshot(
      ${schema.gameCognitiveArtifacts.indexInsertXid}::xid8,
      ${databaseSnapshot}::pg_snapshot
    )
  )`);
}

async function readCurrentDatabaseSnapshot(db: DrizzleDB): Promise<string> {
  const [row] = await db.execute<{ snapshot: string }>(sql`
    SELECT pg_current_snapshot()::text AS snapshot
  `);
  if (!row?.snapshot) throw new Error("Could not capture producer index database snapshot");
  return row.snapshot;
}

function addKeysetCondition(
  conditions: SQL[],
  keyset: ProducerIndexCursorPosition,
): void {
  if (keyset.createdAt === null || keyset.id === null) return;
  conditions.push(sql`(
    ${schema.gameCognitiveArtifacts.createdAt} < ${keyset.createdAt}
    OR (
      ${schema.gameCognitiveArtifacts.createdAt} = ${keyset.createdAt}
      AND ${schema.gameCognitiveArtifacts.id} < ${keyset.id}
    )
  )`);
}

function positionFor(
  row: Pick<CognitiveArtifactIndexRow, "createdAt" | "id"> | undefined,
): ProducerIndexCursorPosition {
  return row
    ? { createdAt: row.createdAt, id: row.id }
    : { createdAt: null, id: null };
}

function artifactPolicyContext(row: CognitiveArtifactIndexRow) {
  return {
    gameId: row.gameId,
    artifactType: row.artifactType,
    actorRole: row.actorRole,
    action: row.action,
    phase: row.phase,
    actorPlayerId: row.actorPlayerId,
    actorUserId: row.actorUserId,
    actorAgentProfileId: row.actorAgentProfileId,
  };
}

function artifactUri(row: CognitiveArtifactIndexRow): string {
  return `influence-game://deployed/games/${row.gameId}/cognitive-artifacts/${row.id}`;
}

function indexEntry(row: CognitiveArtifactIndexRow, includeDiagnostics: boolean): CognitiveArtifactIndexEntry {
  return {
    id: row.id,
    uri: artifactUri(row),
    gameId: row.gameId,
    artifactType: row.artifactType,
    actorRole: row.actorRole,
    ...(row.actorPlayerId && { actorPlayerId: row.actorPlayerId }),
    ...(row.actorUserId && { actorUserId: row.actorUserId }),
    ...(row.actorAgentProfileId && { actorAgentProfileId: row.actorAgentProfileId }),
    action: row.action,
    ...(row.phase && { phase: row.phase }),
    ...(row.round !== null && { round: row.round }),
    ...(row.eventSequence !== null && { eventSequence: row.eventSequence }),
    visibilityStatus: row.visibilityStatus,
    redactionStatus: row.redactionStatus,
    payloadByteLength: row.payloadByteLength,
    ...(includeDiagnostics && row.diagnostics && { diagnostics: row.diagnostics }),
    createdAt: row.createdAt,
  };
}

function cognitiveArtifactIndexSelection(includeDiagnostics: boolean) {
  return {
    id: schema.gameCognitiveArtifacts.id,
    indexInsertXid: schema.gameCognitiveArtifacts.indexInsertXid,
    gameId: schema.gameCognitiveArtifacts.gameId,
    artifactType: schema.gameCognitiveArtifacts.artifactType,
    actorRole: schema.gameCognitiveArtifacts.actorRole,
    actorPlayerId: schema.gameCognitiveArtifacts.actorPlayerId,
    actorUserId: schema.gameCognitiveArtifacts.actorUserId,
    actorAgentProfileId: schema.gameCognitiveArtifacts.actorAgentProfileId,
    action: schema.gameCognitiveArtifacts.action,
    phase: schema.gameCognitiveArtifacts.phase,
    round: schema.gameCognitiveArtifacts.round,
    eventSequence: schema.gameCognitiveArtifacts.eventSequence,
    visibilityStatus: schema.gameCognitiveArtifacts.visibilityStatus,
    redactionStatus: schema.gameCognitiveArtifacts.redactionStatus,
    payloadByteLength: schema.gameCognitiveArtifacts.payloadByteLength,
    diagnostics: includeDiagnostics
      ? schema.gameCognitiveArtifacts.diagnostics
      : sql<Record<string, unknown> | null>`null`,
    createdAt: schema.gameCognitiveArtifacts.createdAt,
  };
}

function unavailableStatus(row: CognitiveArtifactRow): "capture_degraded" | "expired" | "redacted" | null {
  if (row.redactionStatus !== "active") return "redacted";
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return "expired";
  if (row.visibilityStatus === "capture_degraded") return "capture_degraded";
  return null;
}

function isProducer(accessor: CognitiveArtifactAccessor): boolean {
  return hasProducerCognitiveArtifactAccess(accessor);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(Math.floor(value), max));
}
