import { and, desc, eq, or } from "drizzle-orm";
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
  type CognitiveArtifactAccessor,
} from "./cognitive-artifact-policy.js";
import { COGNITIVE_ARTIFACT_CAPTURE_VERSION } from "./cognitive-artifact-writer.js";

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const USER_LIST_SCAN_LIMIT = 500;

type CognitiveArtifactRow = typeof schema.gameCognitiveArtifacts.$inferSelect;

export interface CognitiveArtifactGameIdentity {
  id: string;
  slug?: string;
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

export type CognitiveArtifactListResult =
  | {
    ok: true;
    game: CognitiveArtifactGameIdentity;
    artifacts: CognitiveArtifactIndexEntry[];
  }
  | {
    ok: false;
    status: "denied" | "not_found" | "not_captured_for_game";
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
  constructor(private readonly db: DrizzleDB) {}

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

    const limit = clamp(params.limit ?? DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
    const conditions = [
      eq(schema.gameCognitiveArtifacts.gameId, game.id),
    ];
    if (params.artifactType) {
      conditions.push(eq(schema.gameCognitiveArtifacts.artifactType, params.artifactType));
    }
    if (params.actorPlayerId) {
      conditions.push(eq(schema.gameCognitiveArtifacts.actorPlayerId, params.actorPlayerId));
    }

    const rows = await this.db
      .select()
      .from(schema.gameCognitiveArtifacts)
      .where(and(...conditions))
      .orderBy(desc(schema.gameCognitiveArtifacts.createdAt))
      .limit(hasProducerCognitiveArtifactAccess(access) ? limit : USER_LIST_SCAN_LIMIT);

    const producer = hasProducerCognitiveArtifactAccess(access);
    const artifacts = rows
      .filter((row) => canReadCognitiveArtifact(access, artifactPolicyContext(row)))
      .slice(0, limit)
      .map((row) => indexEntry(row, producer));

    return {
      ok: true,
      game,
      artifacts,
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
      ...(row.slug && { slug: row.slug }),
      status: row.status,
      cognitiveArtifactCaptureVersion: row.cognitiveArtifactCaptureVersion,
    };
  }

  private async withClaims(accessor: CognitiveArtifactAccessor): Promise<CognitiveArtifactAccessor> {
    if (accessor.authProfile !== "subject" || accessor.claims || !accessor.userId) {
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

function artifactPolicyContext(row: CognitiveArtifactRow) {
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

function artifactUri(row: CognitiveArtifactRow): string {
  return `influence-game://deployed/games/${row.gameId}/cognitive-artifacts/${row.id}`;
}

function indexEntry(row: CognitiveArtifactRow, includeDiagnostics: boolean): CognitiveArtifactIndexEntry {
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
