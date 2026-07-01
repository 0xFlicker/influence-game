import { desc, eq, inArray, or } from "drizzle-orm";
import {
  buildRevealedRoundFacts,
  canonicalEventIsVisibleTo,
  type CanonicalEventQueryMode,
  type CanonicalGameEvent,
  type CanonicalGameEventType,
  type PostgameAnalysisDetailLevel,
  type PostgameAnalysisProjection,
  type PostgamePlayerGameSummary,
  type RevealedRoundFactsRead,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { getDurableRunInspection } from "../services/game-durable-run.js";
import {
  getPersistedGameEvents,
  type TrustedPersistedGameEvent,
} from "../services/game-event-read-model.js";
import { getPersistedGameProjection } from "../services/game-projection-read-model.js";
import type { PersistedGameProjectionRead } from "../services/game-projection-read-model.js";
import { MAX_TRACE_MANIFEST_LIMIT, PrivateTraceReadModel } from "../services/private-trace-read-model.js";
import {
  CognitiveArtifactReadModel,
  type ListCognitiveArtifactsParams,
  type ReadCognitiveArtifactParams,
} from "../services/cognitive-artifact-read-model.js";
import {
  buildCompactPostgameBrief,
  buildPostgameDerivedVoteCohorts,
  getPostgameAnalysis,
  getPostgameJuryBreakdown,
  getPostgamePlayerSummary,
  getPostgameTurningPoints,
  listPostgameAgentGames,
} from "../services/postgame-analysis.js";
import type { GameMcpAuthContext } from "./auth.js";
import { resolveGamesMcpClaims } from "./claims.js";

const DEFAULT_EVENT_LIMIT = 50;
const MAX_EVENT_LIMIT = 200;
const DEFAULT_GAME_LIMIT = 20;
const MAX_GAME_LIMIT = 100;
const DEFAULT_TRACE_CONTENT_BYTES = 8 * 1024 * 1024;
const MAX_TRACE_CONTENT_BYTES = 64 * 1024 * 1024;
const DEVELOPER_EVIDENCE_NOTE =
  "Private reasoning tools are available as explicit tool calls behind the producer MCP scope.";

export type ProductionGameMcpAccess = Pick<GameMcpAuthContext, "authProfile" | "userId">;

export interface ProductionGameMcpGameIdentity {
  id: string;
  slug?: string;
  status: string;
  trackType: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface ProductionGameEventResult {
  gameId: string;
  sequence: number;
  eventType: string;
  round: number;
  phase: string | null;
  visibility: string;
  createdAt: string;
  event: CanonicalGameEvent;
  matchSources?: string[];
}

export interface ProductionGameMcpEventFilter {
  gameIdOrSlug: string;
  eventType?: string;
  phase?: string;
  actor?: string;
  visibilityMode?: CanonicalEventQueryMode;
  fromSequence?: number;
  toSequence?: number;
  limit?: number;
}

export interface ProductionGameMcpPlayerTimelineOptions {
  gameIdOrSlug: string;
  player: string;
  visibilityMode?: CanonicalEventQueryMode;
  limit?: number;
}

export interface ProductionGameMcpRoundFactsOptions {
  gameIdOrSlug: string;
  round?: number;
}

export interface ProductionGameMcpPostgameOptions {
  gameIdOrSlug: string;
  detailLevel?: PostgameAnalysisDetailLevel;
  includeEvidence?: boolean;
}

export interface ProductionGameMcpAgentGamesOptions {
  agentId?: string;
  agentName?: string;
  limit?: number;
}

export interface ProductionGameMcpPlayerGameSummaryOptions extends ProductionGameMcpPostgameOptions {
  player: string;
}

type PostgameAnalysisOk = Extract<Awaited<ReturnType<typeof getPostgameAnalysis>>, { ok: true }>;
type PostgameAnalysisError = Exclude<Awaited<ReturnType<typeof getPostgameAnalysis>>, { ok: true }>;

export class ProductionGameMcpReadModel {
  constructor(
    private readonly db: DrizzleDB,
    private readonly privateTrace = new PrivateTraceReadModel(db),
    private readonly cognitiveArtifacts = new CognitiveArtifactReadModel(db),
  ) {}

  async resolveGame(idOrSlug: string): Promise<ProductionGameMcpGameIdentity | null> {
    const row = (await this.db
      .select({
        id: schema.games.id,
        slug: schema.games.slug,
        status: schema.games.status,
        trackType: schema.games.trackType,
        createdAt: schema.games.createdAt,
        startedAt: schema.games.startedAt,
        endedAt: schema.games.endedAt,
      })
      .from(schema.games)
      .where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug)))
      .limit(1))[0];

    return row ? gameIdentity(row) : null;
  }

  async listGames(access: ProductionGameMcpAccess, limit = DEFAULT_GAME_LIMIT): Promise<{
    schemaVersion: 1;
    canonicalGameFacts: { games: Array<ProductionGameMcpGameIdentity & {
      eventLog: {
        status: string;
        rowCount: number;
        trustedEventCount: number;
        lastTrustedSequence: number;
      };
      projection: {
        status: string;
        round?: number;
        phase?: string;
        alivePlayers?: string[];
        winner?: string;
      };
    }> };
    developerEvidence?: { note: string };
  }> {
    const accessibleGameIds = await this.accessibleGameIds(access);
    if (accessibleGameIds && accessibleGameIds.length === 0) {
      return {
        schemaVersion: 1,
        canonicalGameFacts: { games: [] },
      };
    }

    const selection = {
      id: schema.games.id,
      slug: schema.games.slug,
      status: schema.games.status,
      trackType: schema.games.trackType,
      createdAt: schema.games.createdAt,
      startedAt: schema.games.startedAt,
      endedAt: schema.games.endedAt,
    };
    const rows = accessibleGameIds
      ? await this.db
          .select(selection)
          .from(schema.games)
          .where(inArray(schema.games.id, accessibleGameIds))
          .orderBy(desc(schema.games.createdAt))
          .limit(clamp(limit, 1, MAX_GAME_LIMIT))
      : await this.db
          .select(selection)
          .from(schema.games)
          .orderBy(desc(schema.games.createdAt))
          .limit(clamp(limit, 1, MAX_GAME_LIMIT));

    const games = [];
    for (const row of rows) {
      const events = await getPersistedGameEvents(this.db, row.id);
      const projection = getPersistedGameProjection(events);
      games.push({
        ...gameIdentity(row),
        eventLog: {
          status: events.status,
          rowCount: events.eventCount,
          trustedEventCount: events.events.length,
          lastTrustedSequence: events.lastTrustedSequence,
        },
        projection: {
          status: projection.status,
          ...(projection.summary && {
            round: projection.summary.round,
            ...(projection.summary.phase && { phase: projection.summary.phase }),
            alivePlayers: projection.summary.players.aliveNames,
            winner: projection.summary.winner?.name,
          }),
        },
      });
    }

    const result: {
      schemaVersion: 1;
      canonicalGameFacts: { games: typeof games };
    } = {
      schemaVersion: 1,
      canonicalGameFacts: { games },
    };
    if (!isGamesSubjectAccess(access)) {
      return {
        ...result,
        developerEvidence: { note: DEVELOPER_EVIDENCE_NOTE },
      };
    }
    return result;
  }

  async readProjection(gameIdOrSlug: string, access: ProductionGameMcpAccess): Promise<{
    schemaVersion: 1;
    game: ProductionGameMcpGameIdentity;
    canonicalGameFacts: {
      projection: ReturnType<typeof getPersistedGameProjection>;
    };
  }> {
    const game = await this.requireGame(gameIdOrSlug, access);
    const events = await getPersistedGameEvents(this.db, game.id);
    const projection = getPersistedGameProjection(events);
    return {
      schemaVersion: 1,
      game,
      canonicalGameFacts: {
        projection: isGamesSubjectAccess(access)
          ? redactGamesScopeProjection(projection)
          : projection,
      },
    };
  }

  async readRoundFacts(
    options: ProductionGameMcpRoundFactsOptions,
    access: ProductionGameMcpAccess,
  ): Promise<{
    schemaVersion: 1;
    game: ProductionGameMcpGameIdentity;
    canonicalGameFacts: RevealedRoundFactsRead;
  }> {
    const game = await this.requireGame(options.gameIdOrSlug, access);
    const events = await getPersistedGameEvents(this.db, game.id);
    const projection = getPersistedGameProjection(events);
    return {
      schemaVersion: 1,
      game,
      canonicalGameFacts: buildRevealedRoundFacts({
        events: events.events.map((event) => event.envelope),
        round: options.round,
        eventLogStatus: events.status,
        projectionStatus: projection.status,
      }),
    };
  }

  async filterEvents(options: ProductionGameMcpEventFilter, access: ProductionGameMcpAccess): Promise<{
    schemaVersion: 1;
    game: ProductionGameMcpGameIdentity;
    canonicalGameFacts: {
      eventLogStatus: string;
      validPrefixLength: number;
      events: ProductionGameEventResult[];
    };
    diagnostics: unknown[];
  }> {
    const game = await this.requireGame(options.gameIdOrSlug, access);
    const eventRead = await getPersistedGameEvents(this.db, game.id);
    if (isGamesSubjectAccess(access) && options.visibilityMode === "producer") {
      throw new Error("producer visibility requires MCP scope: producer");
    }
    const visibilityMode = options.visibilityMode ?? (
      isGamesSubjectAccess(access) ? "player" : "producer"
    );
    const eventType = normalizeEventType(options.eventType);
    const limit = clamp(options.limit ?? DEFAULT_EVENT_LIMIT, 1, MAX_EVENT_LIMIT);
    const actor = options.actor?.trim();

    const events: ProductionGameEventResult[] = [];
    for (const row of eventRead.events) {
      const event = row.envelope;
      if (eventType && event.type !== eventType) continue;
      if (options.phase && String(event.phase ?? "") !== options.phase) continue;
      if (options.fromSequence !== undefined && event.sequence < options.fromSequence) continue;
      if (options.toSequence !== undefined && event.sequence > options.toSequence) continue;
      if (!canonicalEventIsVisibleTo(event, visibilityMode)) continue;
      const matchSources = actor ? eventMatchSources(event, actor) : [];
      if (actor && matchSources.length === 0) continue;

      events.push(eventResult(row, matchSources));
      if (events.length >= limit) break;
    }

    return {
      schemaVersion: 1,
      game,
      canonicalGameFacts: {
        eventLogStatus: eventRead.status,
        validPrefixLength: eventRead.validPrefixLength,
        events,
      },
      diagnostics: eventRead.diagnostics,
    };
  }

  async playerTimeline(options: ProductionGameMcpPlayerTimelineOptions, access: ProductionGameMcpAccess): Promise<{
    schemaVersion: 1;
    game: ProductionGameMcpGameIdentity;
    canonicalGameFacts: {
      player: string;
      eventLogStatus: string;
      validPrefixLength: number;
      events: ProductionGameEventResult[];
    };
    diagnostics: unknown[];
  }> {
    const filtered = await this.filterEvents({
      gameIdOrSlug: options.gameIdOrSlug,
      actor: options.player,
      visibilityMode: options.visibilityMode,
      limit: options.limit ?? DEFAULT_EVENT_LIMIT,
    }, access);
    return {
      schemaVersion: 1,
      game: filtered.game,
      canonicalGameFacts: {
        player: options.player,
        eventLogStatus: filtered.canonicalGameFacts.eventLogStatus,
        validPrefixLength: filtered.canonicalGameFacts.validPrefixLength,
        events: filtered.canonicalGameFacts.events,
      },
      diagnostics: filtered.diagnostics,
    };
  }

  async listAgentGames(
    options: ProductionGameMcpAgentGamesOptions,
    access: ProductionGameMcpAccess,
  ): Promise<Awaited<ReturnType<typeof listPostgameAgentGames>>> {
    const visibleGameIds = await this.accessibleGameIds(access);
    return listPostgameAgentGames(this.db, {
      agentId: options.agentId,
      agentName: options.agentName,
      limit: options.limit,
      visibleGameIds,
    });
  }

  async readGameBrief(
    options: ProductionGameMcpPostgameOptions,
    access: ProductionGameMcpAccess,
  ): Promise<{
    schemaVersion: 1;
    ok: true;
    game: PostgameAnalysisOk["game"];
    postgame: ReturnType<typeof buildCompactPostgameBrief>;
  } | PostgameAnalysisError> {
    const game = await this.requireGame(options.gameIdOrSlug, access);
    const result = await getPostgameAnalysis(this.db, game.id, {
      detailLevel: options.detailLevel,
      includeEvidence: options.includeEvidence,
    });
    if (!result.ok) return result;
    return {
      schemaVersion: 1,
      ok: true,
      game: result.game,
      postgame: buildCompactPostgameBrief(result.analysis, options.detailLevel ?? "standard"),
    };
  }

  async readJuryBreakdown(
    options: ProductionGameMcpPostgameOptions,
    access: ProductionGameMcpAccess,
  ): Promise<Awaited<ReturnType<typeof getPostgameJuryBreakdown>>> {
    const game = await this.requireGame(options.gameIdOrSlug, access);
    return getPostgameJuryBreakdown(this.db, game.id, {
      detailLevel: options.detailLevel,
      includeEvidence: options.includeEvidence,
    });
  }

  async readPlayerGameSummary(
    options: ProductionGameMcpPlayerGameSummaryOptions,
    access: ProductionGameMcpAccess,
  ): Promise<Awaited<ReturnType<typeof getPostgamePlayerSummary>>> {
    const game = await this.requireGame(options.gameIdOrSlug, access);
    return getPostgamePlayerSummary(this.db, game.id, options.player, {
      detailLevel: options.detailLevel,
      includeEvidence: options.includeEvidence,
    });
  }

  async readGameTurningPoints(
    options: ProductionGameMcpPostgameOptions,
    access: ProductionGameMcpAccess,
  ): Promise<Awaited<ReturnType<typeof getPostgameTurningPoints>>> {
    const game = await this.requireGame(options.gameIdOrSlug, access);
    return getPostgameTurningPoints(this.db, game.id, {
      detailLevel: options.detailLevel,
      includeEvidence: options.includeEvidence,
    });
  }

  async readProducerGameAnalysis(
    options: ProductionGameMcpPostgameOptions,
    access: ProductionGameMcpAccess,
  ): Promise<{
    schemaVersion: 1;
    ok: true;
    game: PostgameAnalysisOk["game"];
    producerAnalysis: ReturnType<typeof buildProducerPostgameAnalysis>;
    developerEvidence: {
      cognitiveArtifacts: unknown;
      traceManifests: unknown;
    };
  } | PostgameAnalysisError> {
    requireProducerAccess(access);
    const game = await this.requireGame(options.gameIdOrSlug, access);
    const result = await getPostgameAnalysis(this.db, game.id, {
      detailLevel: options.detailLevel ?? "full",
      includeEvidence: options.includeEvidence ?? true,
    });
    if (!result.ok) return result;
    const [cognitiveArtifacts, traceManifests] = await Promise.all([
      this.cognitiveArtifacts.listArtifacts({
        gameIdOrSlug: game.id,
        limit: 50,
      }, access),
      this.privateTrace.listManifests(game.id, 50),
    ]);
    return {
      schemaVersion: 1,
      ok: true,
      game: result.game,
      producerAnalysis: buildProducerPostgameAnalysis(result.analysis),
      developerEvidence: {
        cognitiveArtifacts,
        traceManifests,
      },
    };
  }

  async inspectDurableRun(gameIdOrSlug: string, access: ProductionGameMcpAccess): Promise<{
    schemaVersion: 1;
    developerEvidence: {
      durableRun: unknown;
    };
  }> {
    requireProducerAccess(access);
    const result = await getDurableRunInspection(this.db, gameIdOrSlug);
    if (!result.ok) throw new Error(result.error);
    return {
      schemaVersion: 1,
      developerEvidence: {
        durableRun: result.response,
      },
    };
  }

  async listTraceManifests(
    gameIdOrSlug: string,
    access: ProductionGameMcpAccess,
    limit?: number,
  ): Promise<{
    schemaVersion: 1;
    developerEvidence: unknown;
  }> {
    requireProducerAccess(access);
    return {
      schemaVersion: 1,
      developerEvidence: await this.privateTrace.listManifests(
        gameIdOrSlug,
        clamp(limit ?? 50, 1, MAX_TRACE_MANIFEST_LIMIT),
      ),
    };
  }

  async readTraceContent(params: {
    manifestId: string;
    gameId?: string;
    purpose?: string;
    maxBytes?: number;
  }, access: ProductionGameMcpAccess): Promise<{
    schemaVersion: 1;
    privateReasoning: unknown;
  }> {
    requireProducerAccess(access);
    return {
      schemaVersion: 1,
      privateReasoning: await this.privateTrace.readContent(params.manifestId, {
        gameId: params.gameId,
        purpose: params.purpose ?? "production_game_mcp_read_trace_content",
        maxBytes: clamp(params.maxBytes ?? DEFAULT_TRACE_CONTENT_BYTES, 1, MAX_TRACE_CONTENT_BYTES),
      }),
    };
  }

  async searchReasoningTraces(params: {
    gameIdOrSlug: string;
    query: string;
    actor?: string;
    action?: string;
    phase?: string;
    limit?: number;
    maxBytes?: number;
  }, access: ProductionGameMcpAccess): Promise<{
    schemaVersion: 1;
    privateReasoning: unknown;
  }> {
    requireProducerAccess(access);
    return {
      schemaVersion: 1,
      privateReasoning: await this.privateTrace.searchReasoningTraces({
        ...params,
        limit: clamp(params.limit ?? 20, 1, 100),
        maxBytes: clamp(params.maxBytes ?? DEFAULT_TRACE_CONTENT_BYTES, 1, MAX_TRACE_CONTENT_BYTES),
      }),
    };
  }

  async listCognitiveArtifacts(
    params: ListCognitiveArtifactsParams,
    access: ProductionGameMcpAccess,
  ): Promise<{
    schemaVersion: 1;
    cognitiveArtifacts: unknown;
  }> {
    return {
      schemaVersion: 1,
      cognitiveArtifacts: await this.cognitiveArtifacts.listArtifacts(params, access),
    };
  }

  async readCognitiveArtifact(
    params: ReadCognitiveArtifactParams,
    access: ProductionGameMcpAccess,
  ): Promise<{
    schemaVersion: 1;
    cognitiveArtifacts: unknown;
  }> {
    return {
      schemaVersion: 1,
      cognitiveArtifacts: await this.cognitiveArtifacts.readArtifact(params, access),
    };
  }

  private async requireGame(
    gameIdOrSlug: string,
    access: ProductionGameMcpAccess,
  ): Promise<ProductionGameMcpGameIdentity> {
    const game = await this.resolveGame(gameIdOrSlug);
    if (isGamesSubjectAccess(access)) {
      if (!game) throw new Error("Game is not accessible for MCP scope: games:read");
      const claims = await resolveGamesMcpClaims(this.db, access.userId);
      if (!claims.gameIds.has(game.id)) {
        throw new Error("Game is not accessible for MCP scope: games:read");
      }
    } else if (!game) {
      throw new Error(`Unknown game: ${gameIdOrSlug}`);
    }
    return game;
  }

  private async accessibleGameIds(access: ProductionGameMcpAccess): Promise<string[] | null> {
    if (!isGamesSubjectAccess(access)) return null;
    const claims = await resolveGamesMcpClaims(this.db, access.userId);
    return Array.from(claims.gameIds);
  }
}

function buildProducerPostgameAnalysis(analysis: PostgameAnalysisProjection) {
  return {
    derivedVoteCohorts: buildPostgameDerivedVoteCohorts(analysis),
    inferredAlliances: {
      status: "not_inferred_from_public_facts",
      note: "Use derivedVoteCohorts for deterministic shared-vote groups; confirmed alliance inference requires private producer evidence.",
    },
    actualPrivateStrategyPivots: {
      status: "available_via_developerEvidence",
      note: "Use developerEvidence.cognitiveArtifacts or read_cognitive_artifact for explicit private strategy artifacts.",
    },
    publicPrivateDiscrepancy: {
      status: "requires_artifact_read",
      note: "This v0 report does not infer discrepancies without reading explicit private artifacts.",
    },
    betrayalMoments: analysis.turningPoints.filter((point) => point.type === "alliance_member_cut"),
    threatManagementAnalysis: {
      majorEliminations: analysis.summary.majorEliminations,
      threatRemovedTurningPoints: analysis.turningPoints.filter((point) => point.type === "threat_removed"),
    },
    juryManagementAnalysis: {
      finalVote: analysis.summary.finalVote,
      narrativeHints: analysis.jury.narrativeHints,
      nonWinnerSupporters: analysis.jury.nonWinnerSupporters,
    },
    playerByPlayerStrategicGrades: analysis.playerSummaries.map(strategicGradeForPlayer),
    modelAgentBehaviorObservations: {
      status: "derived_from_postgame_projection",
      diagnostics: analysis.diagnostics,
    },
    debuggingNotes: analysis.diagnostics,
  };
}

function strategicGradeForPlayer(player: PostgamePlayerGameSummary): {
  player: { id: string; name: string };
  placement: number | null;
  score: number;
  grade: "A" | "B" | "C" | "D";
  method: "deterministic_v0_score";
  signals: {
    majorityAlignedRounds: number;
    majorityAlignmentRate: number;
    timesNominated: number;
    juryVotesReceived: number;
    won: boolean;
  };
} {
  const alignmentRounds = player.majorityAlignmentByRound.filter((round) => round.aligned !== null);
  const majorityAlignedRounds = alignmentRounds.filter((round) => round.aligned === true).length;
  const majorityAlignmentRate = alignmentRounds.length > 0
    ? majorityAlignedRounds / alignmentRounds.length
    : 0;
  const finalistBonus = player.status === "finalist" ? 18 : 0;
  const winBonus = player.won ? 30 : 0;
  const juryBonus = Math.min(player.jury.votesReceived * 4, 24);
  const riskPenalty = Math.min(player.timesNominated.length * 3, 15);
  const score = Math.max(0, Math.min(100, Math.round(
    45 + (majorityAlignmentRate * 20) + finalistBonus + winBonus + juryBonus - riskPenalty,
  )));
  return {
    player: player.player,
    placement: player.placement,
    score,
    grade: score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : "D",
    method: "deterministic_v0_score",
    signals: {
      majorityAlignedRounds,
      majorityAlignmentRate,
      timesNominated: player.timesNominated.length,
      juryVotesReceived: player.jury.votesReceived,
      won: player.won,
    },
  };
}

function gameIdentity(row: {
  id: string;
  slug: string | null;
  status: string;
  trackType: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}): ProductionGameMcpGameIdentity {
  return {
    id: row.id,
    ...(row.slug && { slug: row.slug }),
    status: row.status,
    trackType: row.trackType,
    createdAt: row.createdAt,
    ...(row.startedAt && { startedAt: row.startedAt }),
    ...(row.endedAt && { endedAt: row.endedAt }),
  };
}

function eventResult(
  row: TrustedPersistedGameEvent,
  matchSources: string[] = [],
): ProductionGameEventResult {
  return {
    gameId: row.gameId,
    sequence: row.sequence,
    eventType: row.eventType,
    round: row.envelope.round,
    phase: row.envelope.phase,
    visibility: row.visibility,
    createdAt: row.createdAt,
    event: row.envelope,
    ...(matchSources.length > 0 && { matchSources }),
  };
}

function eventMatchSources(event: CanonicalGameEvent, needle: string): string[] {
  const lowerNeedle = needle.toLowerCase();
  const sources = new Set<string>();
  if (event.sourcePointers.some((pointer) =>
    String(pointer.actorId ?? "").toLowerCase() === lowerNeedle
  )) {
    sources.add("sourcePointers.actorId");
  }
  const payloadText = JSON.stringify(event.payload).toLowerCase();
  if (payloadText.includes(lowerNeedle)) sources.add("canonicalPayload");
  if (event.sourcePointers.some((pointer) =>
    JSON.stringify(pointer).toLowerCase().includes(lowerNeedle)
  )) {
    sources.add("sourcePointers");
  }
  return Array.from(sources);
}

function normalizeEventType(value: string | undefined): CanonicalGameEventType | undefined {
  return value && value.length > 0 ? value as CanonicalGameEventType : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(Math.floor(value), max));
}

function isGamesSubjectAccess(
  access: ProductionGameMcpAccess,
): access is ProductionGameMcpAccess {
  return access.authProfile === "subject";
}

function requireProducerAccess(access: ProductionGameMcpAccess): void {
  if (access.authProfile !== "producer") {
    throw new Error("Producer-only MCP evidence requires MCP scope: producer");
  }
}

function redactGamesScopeProjection(
  projection: PersistedGameProjectionRead,
): PersistedGameProjectionRead {
  if (!projection.summary) return projection;
  return {
    ...projection,
    summary: {
      ...projection.summary,
      voteState: {
        empowerVotes: {},
        exposeVotes: {},
        councilVotes: {},
        endgameEliminationVotes: {},
        juryVotes: {},
        empoweredId: null,
        empoweredName: null,
        councilCandidates: null,
        councilCandidateNames: null,
        candidateResolution: null,
        powerAction: null,
      },
    },
  };
}
