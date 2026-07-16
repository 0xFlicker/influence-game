import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import {
  buildRevealedRoundFacts,
  canonicalEventIsVisibleTo,
  Phase,
  type AllianceHuddleOutcome,
  type AllianceProposalLineage,
  type AllianceRecord,
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
import {
  getDurableRunInspection,
} from "../services/game-durable-run.js";
import {
  getPersistedGameEvents,
  type TrustedPersistedGameEvent,
} from "../services/game-event-read-model.js";
import {
  getPersistedGameProjection,
  getPersistedGameProjectionBeforeTerminalOutcome,
} from "../services/game-projection-read-model.js";
import type { PersistedGameProjectionRead } from "../services/game-projection-read-model.js";
import {
  getGameCompletionSettlementState,
  getGameCompletionSettlementStateMap,
} from "../services/game-completion-settlement.js";
import type { GameCompletionSettlementState } from "../db/schema.js";
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
import {
  exportOwnedSeasonReceipts,
  getOwnedAgentSeasonAnalysis,
  getProducerSeasonDiagnostics,
  getPublicGameCompetitionReceipts,
  getPublicSeasonDashboard,
  listPublicSeasons,
} from "../services/season-read-model.js";

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
  slug: string;
  status: string;
  trackType: string;
  rated: boolean;
  seasonId?: string;
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

export interface ProductionGameMcpAgentAlliancesOptions {
  gameIdOrSlug: string;
  player?: string;
  playerId?: string;
  agentId?: string;
  detailLevel?: "compact" | "full";
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
type GamePlayerRow = typeof schema.gamePlayers.$inferSelect;

interface AgentAlliancePlayerRead {
  id: string;
  name: string;
  agentProfileId?: string;
}

interface AgentAllianceTermsRead {
  name: string;
  memberIds: string[];
  memberNames: string[];
  purpose: string;
  timebox: string | null;
}

interface AgentAllianceProposalRead {
  lineageId: string;
  allianceId: string;
  name: string;
  status: string;
  proposedRound: number;
  resolvedRound?: number;
  memberNames: string[];
  currentVersionId: string;
  currentTerms: AgentAllianceTermsRead;
  proposer: { id: string; name: string };
  yourResponse: string | null;
  finalResult: string;
}

interface AgentAllianceCompactProposalRead {
  lineageId: string;
  allianceId: string;
  name: string;
  status: string;
  proposedRound: number;
  resolvedRound?: number;
  memberNames: string[];
  proposer: { id: string; name: string };
  yourResponse: string | null;
  finalResult: string;
}

interface AgentAllianceOutcomeRead {
  id: string;
  round: number;
  window: string;
  ask: string;
  plan: string;
  promises: string[];
  dissent: string[];
  confidence: string;
  posture: string;
  leakOrBetrayalClaims: string[];
}

interface AgentAllianceCompactOutcomeRead {
  id: string;
  round: number;
  window: string;
  plan: string;
  confidence: string;
  posture: string;
  leakOrBetrayalClaims: string[];
}

interface AgentAllianceRecordRead extends AgentAllianceTermsRead {
  id: string;
  status: string;
  createdRound: number;
  updatedRound: number;
  huddleOutcomes: AgentAllianceOutcomeRead[];
}

interface AgentAllianceCompactRecordRead {
  id: string;
  name: string;
  status: string;
  memberNames: string[];
  purpose: string;
  timebox: string | null;
  createdRound: number;
  updatedRound: number;
  huddleOutcomeCount: number;
  latestOutcome?: AgentAllianceCompactOutcomeRead;
}

interface AgentAllianceHuddleRead {
  allianceId: string;
  allianceName: string;
  round: number;
  window: string;
  pass: number;
  speakers: Array<{ id: string; name: string }>;
  messages: Array<{ from: { id?: string; name: string }; text: string; timestamp: number; thinking?: string }>;
  outcome?: AgentAllianceOutcomeRead;
}

interface AgentAllianceCompactHuddleRead {
  allianceId: string;
  allianceName: string;
  round: number;
  window: string;
  pass: number;
  speakers: Array<{ id: string; name: string }>;
  messageCount: number;
  outcomeSummary?: AgentAllianceCompactOutcomeRead;
}

interface AgentAllianceFactsSummaryRead {
  proposalCount: number;
  activeAllianceCount: number;
  closedAllianceCount: number;
  archivedAllianceCount: number;
  huddleCount: number;
  latestHuddleRound: number | null;
}

interface AgentAllianceFullFactsRead {
  summary: AgentAllianceFactsSummaryRead;
  proposals: AgentAllianceProposalRead[];
  alliances: AgentAllianceRecordRead[];
  huddles: AgentAllianceHuddleRead[];
}

interface AgentAllianceCompactFactsRead {
  summary: AgentAllianceFactsSummaryRead;
  proposals: AgentAllianceCompactProposalRead[];
  alliances: AgentAllianceCompactRecordRead[];
  huddles: AgentAllianceCompactHuddleRead[];
}

type ProductionGameMcpAgentAlliancesRead = {
  schemaVersion: 1;
  game: ProductionGameMcpGameIdentity;
  player?: AgentAlliancePlayerRead;
  selectablePlayers?: AgentAlliancePlayerRead[];
  detailLevel?: "compact" | "full";
  allianceFacts?: AgentAllianceFullFactsRead | AgentAllianceCompactFactsRead;
  availability: {
    status: "available" | "agent_ambiguous" | "agent_not_authorized" | "agent_not_found";
    eventLogStatus?: string;
    transcriptStatus?: "available" | "not_available";
    diagnostics: Array<{ code: string; severity: "info" | "warning"; message: string }>;
  };
};

type ProductionGameMcpAllianceContextRead = AgentAllianceCompactFactsRead & {
  player: AgentAlliancePlayerRead;
};

export class ProductionGameMcpReadModel {
  constructor(
    private readonly db: DrizzleDB,
    private readonly privateTrace = new PrivateTraceReadModel(db),
    private readonly cognitiveArtifacts = new CognitiveArtifactReadModel(db),
  ) {}

  async listSeasons(): Promise<{ schemaVersion: 1; seasons: Awaited<ReturnType<typeof listPublicSeasons>> }> {
    return { schemaVersion: 1, seasons: await listPublicSeasons(this.db) };
  }

  async readSeason(seasonIdOrSlug: string) {
    const season = await getPublicSeasonDashboard(this.db, seasonIdOrSlug);
    if (!season) throw new Error("Season not found");
    return season;
  }

  async readSeasonGameReceipts(seasonIdOrSlug: string, gameIdOrSlug: string) {
    const result = await getPublicGameCompetitionReceipts(this.db, seasonIdOrSlug, gameIdOrSlug);
    if (!result) throw new Error("Season or game not found");
    return { schemaVersion: 1 as const, ...result };
  }

  async readOwnedAgentSeason(
    seasonIdOrSlug: string,
    agentId: string,
    access: ProductionGameMcpAccess,
  ) {
    if (!access.userId) throw new Error("Owned agent season reads require a user subject");
    const result = await getOwnedAgentSeasonAnalysis(this.db, {
      seasonIdOrSlug,
      agentId,
      ownerId: access.userId,
    });
    if (!result) throw new Error("Owned agent or season not found");
    return result;
  }

  async exportOwnedSeason(
    seasonIdOrSlug: string,
    format: "json" | "csv",
    access: ProductionGameMcpAccess,
    limit?: number,
    agentId?: string,
  ) {
    if (!access.userId) throw new Error("Season exports require a user subject");
    const result = await exportOwnedSeasonReceipts(this.db, {
      seasonIdOrSlug,
      ownerId: access.userId,
      agentId,
      format,
      limit,
    });
    if (!result) throw new Error("Season not found");
    return { schemaVersion: 1 as const, ...result };
  }

  async readProducerSeasonDiagnostics(seasonIdOrSlug: string) {
    const result = await getProducerSeasonDiagnostics(this.db, seasonIdOrSlug);
    if (!result) throw new Error("Season not found");
    return result;
  }

  async resolveGame(idOrSlug: string): Promise<ProductionGameMcpGameIdentity | null> {
    const row = (await this.db
      .select({
        id: schema.games.id,
        slug: schema.games.slug,
        status: schema.games.status,
        trackType: schema.games.trackType,
        seasonId: schema.games.seasonId,
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
      seasonId: schema.games.seasonId,
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
    const settlementStates = await getGameCompletionSettlementStateMap(
      this.db,
      rows.map((row) => row.id),
    );

    const games = [];
    for (const row of rows) {
      const events = await getPersistedGameEvents(this.db, row.id);
      const safeProjection = redactProjectionForSettlement(
        events,
        settlementStates.get(row.id),
      );
      games.push({
        ...gameIdentity(row),
        eventLog: {
          status: events.status,
          rowCount: events.eventCount,
          trustedEventCount: events.events.length,
          lastTrustedSequence: events.lastTrustedSequence,
        },
        projection: {
          status: safeProjection.status,
          ...(safeProjection.summary && {
            round: safeProjection.summary.round,
            ...(safeProjection.summary.phase && { phase: safeProjection.summary.phase }),
            alivePlayers: safeProjection.summary.players.aliveNames,
            ...(safeProjection.summary.winner?.name && {
              winner: safeProjection.summary.winner.name,
            }),
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
    const [events, settlementState] = await Promise.all([
      getPersistedGameEvents(this.db, game.id),
      getGameCompletionSettlementState(this.db, game.id),
    ]);
    const projection = redactProjectionForSettlement(
      events,
      settlementState,
    );
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
    const [events, settlementState] = await Promise.all([
      getPersistedGameEvents(this.db, game.id),
      getGameCompletionSettlementState(this.db, game.id),
    ]);
    const terminalOutcomeSequence = firstTerminalOutcomeSequence(events.events);
    const terminalSafeEvents = events.events.filter((row) =>
      terminalEventIsVisibleForSettlement(
        row.envelope,
        settlementState,
        terminalOutcomeSequence,
      ));
    const projection = getPersistedGameProjection({
      ...events,
      events: terminalSafeEvents,
    });
    return {
      schemaVersion: 1,
      game,
      canonicalGameFacts: buildRevealedRoundFacts({
        events: terminalSafeEvents.map((event) => event.envelope),
        round: options.round,
        eventLogStatus: events.status,
        projectionStatus: projection.status,
      }),
    };
  }

  async readAgentAlliances(
    options: ProductionGameMcpAgentAlliancesOptions,
    access: ProductionGameMcpAccess,
  ): Promise<ProductionGameMcpAgentAlliancesRead> {
    const game = await this.requireGame(options.gameIdOrSlug, access);
    const players = await this.loadGamePlayers(game.id);
    const playerNames = playerNameMap(players);
    const selectablePlayers = await this.selectableAlliancePlayers(game.id, players, access);
    const selected = selectAlliancePlayer(players, selectablePlayers, options);
    if (selected.status !== "available") {
      return {
        schemaVersion: 1,
        game,
        ...(selected.selectablePlayers && { selectablePlayers: selected.selectablePlayers.map((player) => playerRead(player, playerNames)) }),
        availability: {
          status: selected.status,
          diagnostics: [{
            code: selected.status,
            severity: "info",
            message: selected.message,
          }],
        },
      };
    }

    const detailLevel = options.detailLevel ?? "compact";
    const eventRead = await getPersistedGameEvents(this.db, game.id);
    const fullFacts = buildAgentAllianceFacts({
      events: eventRead.events.map((row) => row.envelope),
      player: selected.player,
      playerNames,
      transcriptRows: await this.loadHuddleTranscriptRows(game.id),
    });
    const facts = detailLevel === "full" ? fullFacts : compactAgentAllianceFacts(fullFacts);

    return {
      schemaVersion: 1,
      game,
      player: playerRead(selected.player, playerNames),
      detailLevel,
      allianceFacts: facts,
      availability: {
        status: "available",
        eventLogStatus: eventRead.status,
        transcriptStatus: fullFacts.huddles.some((huddle) => huddle.messages.length > 0) ? "available" : "not_available",
        diagnostics: [
          ...eventRead.diagnostics.map((diagnostic) => ({
            code: "event_log_diagnostic",
            severity: "warning" as const,
            message: JSON.stringify(diagnostic),
          })),
          ...(fullFacts.huddles.length > 0 && fullFacts.huddles.every((huddle) => huddle.messages.length === 0)
            ? [{
              code: "missing_huddle_chat",
              severity: "info" as const,
              message: "Alliance huddle sessions were recorded, but no persisted huddle transcript rows were available.",
            }]
            : []),
        ],
      },
    };
  }

  async filterEvents(options: ProductionGameMcpEventFilter, access: ProductionGameMcpAccess): Promise<{
    schemaVersion: 1;
    game: ProductionGameMcpGameIdentity;
    canonicalGameFacts: {
      eventLogStatus: string;
      validPrefixLength: number;
      events: ProductionGameEventResult[];
      allianceContext?: ProductionGameMcpAllianceContextRead;
    };
    diagnostics: unknown[];
  }> {
    const game = await this.requireGame(options.gameIdOrSlug, access);
    const players = await this.loadGamePlayers(game.id);
    const playerNames = playerNameMap(players);
    const [eventRead, settlementState] = await Promise.all([
      getPersistedGameEvents(this.db, game.id),
      getGameCompletionSettlementState(this.db, game.id),
    ]);
    const terminalOutcomeSequence = firstTerminalOutcomeSequence(eventRead.events);
    if (isGamesSubjectAccess(access) && options.visibilityMode === "producer") {
      throw new Error("producer visibility requires MCP scope: producer");
    }
    const visibilityMode = options.visibilityMode ?? (
      isGamesSubjectAccess(access) ? "player" : "producer"
    );
    const eventType = normalizeEventType(options.eventType);
    const limit = clamp(options.limit ?? DEFAULT_EVENT_LIMIT, 1, MAX_EVENT_LIMIT);
    const actor = options.actor?.trim();
    const allianceContext = actor
      ? await this.compactAllianceContextForActor({
          game,
          players,
          playerNames,
          events: eventRead.events.map((row) => row.envelope),
          actor,
          access,
        })
      : undefined;

    const events: ProductionGameEventResult[] = [];
    for (const row of eventRead.events) {
      const event = row.envelope;
      if (eventType && event.type !== eventType) continue;
      if (options.phase && String(event.phase ?? "") !== options.phase) continue;
      if (options.fromSequence !== undefined && event.sequence < options.fromSequence) continue;
      if (options.toSequence !== undefined && event.sequence > options.toSequence) continue;
      if (!terminalEventIsVisibleForSettlement(
        event,
        settlementState,
        terminalOutcomeSequence,
      )) continue;
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
        ...(allianceContext && { allianceContext }),
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
      allianceTimeline?: ProductionGameMcpAllianceContextRead;
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
        ...(filtered.canonicalGameFacts.allianceContext && {
          allianceTimeline: filtered.canonicalGameFacts.allianceContext,
        }),
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

  private async loadGamePlayers(gameId: string): Promise<GamePlayerRow[]> {
    return await this.db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, gameId))
      .orderBy(asc(schema.gamePlayers.joinedAt), asc(schema.gamePlayers.id));
  }

  private async selectableAlliancePlayers(
    gameId: string,
    players: readonly GamePlayerRow[],
    access: ProductionGameMcpAccess,
  ): Promise<GamePlayerRow[]> {
    if (!isGamesSubjectAccess(access)) return [...players];
    const claims = await resolveGamesMcpClaims(this.db, access.userId);
    if (!claims.gameIds.has(gameId)) return [];
    return players.filter((player) =>
      claims.playerIds.has(player.id) ||
      Boolean(player.agentProfileId && claims.agentProfileIds.has(player.agentProfileId))
    );
  }

  private async loadHuddleTranscriptRows(gameId: string): Promise<Array<typeof schema.transcripts.$inferSelect>> {
    return await this.db
      .select()
      .from(schema.transcripts)
      .where(and(
        eq(schema.transcripts.gameId, gameId),
        eq(schema.transcripts.scope, "huddle"),
      ))
      .orderBy(asc(schema.transcripts.timestamp), asc(schema.transcripts.id));
  }

  private async compactAllianceContextForActor(params: {
    game: ProductionGameMcpGameIdentity;
    players: readonly GamePlayerRow[];
    playerNames: Map<string, string>;
    events: readonly CanonicalGameEvent[];
    actor: string;
    access: ProductionGameMcpAccess;
  }): Promise<ProductionGameMcpAllianceContextRead | undefined> {
    const selectablePlayers = await this.selectableAlliancePlayers(params.game.id, params.players, params.access);
    const exactPlayerId = params.players.some((player) => player.id === params.actor);
    const selected = selectAlliancePlayer(params.players, selectablePlayers, exactPlayerId
      ? { gameIdOrSlug: params.game.id, playerId: params.actor }
      : { gameIdOrSlug: params.game.id, player: params.actor });
    if (selected.status !== "available") return undefined;
    const fullFacts = buildAgentAllianceFacts({
      events: params.events,
      player: selected.player,
      playerNames: params.playerNames,
      transcriptRows: await this.loadHuddleTranscriptRows(params.game.id),
    });
    return {
      player: playerRead(selected.player, params.playerNames),
      ...compactAgentAllianceFacts(fullFacts),
    };
  }
}

function selectAlliancePlayer(
  players: readonly GamePlayerRow[],
  selectablePlayers: readonly GamePlayerRow[],
  options: ProductionGameMcpAgentAlliancesOptions,
): {
  status: "available";
  player: GamePlayerRow;
} | {
  status: "agent_ambiguous" | "agent_not_authorized" | "agent_not_found";
  message: string;
  selectablePlayers?: readonly GamePlayerRow[];
} {
  if (options.playerId) {
    const player = selectablePlayers.find((candidate) => candidate.id === options.playerId);
    if (player) return { status: "available", player };
    if (players.some((candidate) => candidate.id === options.playerId)) {
      return { status: "agent_not_authorized", message: "That player exists in this game, but this caller is not authorized to read their alliance facts." };
    }
    return { status: "agent_not_found", message: "No player in this game matched playerId." };
  }
  if (options.agentId) {
    const matches = selectablePlayers.filter((candidate) =>
      candidate.agentProfileId === options.agentId || candidate.id === options.agentId
    );
    if (matches.length === 1) return { status: "available", player: matches[0]! };
    const allMatches = players.filter((candidate) =>
      candidate.agentProfileId === options.agentId || candidate.id === options.agentId
    );
    if (allMatches.length > 0 && matches.length === 0) {
      return { status: "agent_not_authorized", message: "That agent exists in this game, but this caller is not authorized to read their alliance facts." };
    }
    return {
      status: matches.length > 1 ? "agent_ambiguous" : "agent_not_found",
      message: matches.length > 1
        ? "Multiple owned players matched agentId. Call again with playerId."
        : "No player in this game matched agentId.",
      ...(matches.length > 1 && { selectablePlayers: matches }),
    };
  }
  if (options.player) {
    const matches = selectablePlayers.filter((candidate) =>
      playerName(candidate).trim().toLowerCase() === options.player!.trim().toLowerCase()
    );
    if (matches.length === 1) return { status: "available", player: matches[0]! };
    const allMatches = players.filter((candidate) =>
      playerName(candidate).trim().toLowerCase() === options.player!.trim().toLowerCase()
    );
    if (allMatches.length > 0 && matches.length === 0) {
      return { status: "agent_not_authorized", message: "That player exists in this game, but this caller is not authorized to read their alliance facts." };
    }
    return {
      status: matches.length > 1 ? "agent_ambiguous" : "agent_not_found",
      message: matches.length > 1
        ? "Multiple owned players matched player. Call again with playerId or agentId."
        : "No player in this game matched player.",
      ...(matches.length > 1 && { selectablePlayers: matches }),
    };
  }
  if (selectablePlayers.length === 1) {
    return { status: "available", player: selectablePlayers[0]! };
  }
  if (selectablePlayers.length > 1) {
    return {
      status: "agent_ambiguous",
      message: "Multiple owned agents are in this game. Call again with playerId or agentId.",
      selectablePlayers,
    };
  }
  return {
    status: "agent_not_found",
    message: "No owned agent player was found for this game.",
  };
}

function buildAgentAllianceFacts(params: {
  events: readonly CanonicalGameEvent[];
  player: GamePlayerRow;
  playerNames: Map<string, string>;
  transcriptRows: ReadonlyArray<typeof schema.transcripts.$inferSelect>;
}): AgentAllianceFullFactsRead {
  const proposalByLineageId = new Map<string, AgentAllianceProposalRead>();
  const allianceById = new Map<string, AgentAllianceRecordRead>();
  const outcomeBySessionId = new Map<string, AgentAllianceOutcomeRead>();
  const outcomeByAllianceId = new Map<string, AgentAllianceOutcomeRead>();
  const huddleSessions: Array<{
    id: string;
    allianceId: string;
    round: number;
    window: string;
    pass: number;
    speakerIds: string[];
  }> = [];

  for (const event of params.events) {
    switch (event.type) {
      case "alliance.proposal_submitted":
      case "alliance.response_recorded":
      case "alliance.counter_submitted":
      case "alliance.proposal_expired": {
        const lineage = event.payload.lineage;
        if (!agentParticipatedInLineage(lineage, params.player.id)) break;
        const proposal = proposalReadFromLineage(lineage, params.player.id, params.playerNames);
        if (proposal) proposalByLineageId.set(lineage.id, proposal);
        break;
      }
      case "alliance.activated":
      case "alliance.amendment_resolved":
      case "alliance.closed":
      case "alliance.archived": {
        if ("lineage" in event.payload && agentParticipatedInLineage(event.payload.lineage, params.player.id)) {
          const proposal = proposalReadFromLineage(event.payload.lineage, params.player.id, params.playerNames);
          if (proposal) proposalByLineageId.set(event.payload.lineage.id, proposal);
        }
        const alliance = event.payload.alliance;
        if (alliance.memberIds.includes(params.player.id)) {
          allianceById.set(alliance.id, allianceRead(alliance, params.playerNames, []));
        }
        break;
      }
      case "alliance.huddle_completed": {
        const session = event.payload.session;
        if (session.speakerIds.includes(params.player.id)) {
          huddleSessions.push({
            id: session.id,
            allianceId: session.allianceId,
            round: session.round,
            window: session.window,
            pass: session.pass,
            speakerIds: [...session.speakerIds],
          });
        }
        break;
      }
      case "alliance.huddle_outcome_recorded": {
        const outcome = outcomeRead(event.payload.outcome);
        outcomeBySessionId.set(event.payload.outcome.sessionId, outcome);
        outcomeByAllianceId.set(event.payload.outcome.allianceId, outcome);
        if (event.payload.alliance?.memberIds.includes(params.player.id)) {
          const existing = allianceById.get(event.payload.alliance.id);
          const outcomes = existing?.huddleOutcomes ?? [];
          allianceById.set(event.payload.alliance.id, allianceRead(event.payload.alliance, params.playerNames, [
            ...outcomes.filter((item) => item.id !== outcome.id),
            outcome,
          ]));
        }
        break;
      }
    }
  }

  const huddles = huddleSessions
    .filter((session) => allianceById.has(session.allianceId))
    .map((session) => {
      const alliance = allianceById.get(session.allianceId)!;
      const speakers = session.speakerIds.map((id) => ({ id, name: nameForPlayer(params.playerNames, id) }));
      const messages = huddleMessagesForSession(params.transcriptRows, session, params.playerNames, params.player.id);
      const outcome = outcomeBySessionId.get(session.id) ?? outcomeByAllianceId.get(session.allianceId);
      return {
        allianceId: session.allianceId,
        allianceName: alliance.name,
        round: session.round,
        window: session.window,
        pass: session.pass,
        speakers,
        messages,
        ...(outcome && { outcome }),
      };
    });

  const facts = {
    proposals: Array.from(proposalByLineageId.values()),
    alliances: Array.from(allianceById.values()).map((alliance) => ({
      ...alliance,
      huddleOutcomes: huddles
        .filter((huddle) => huddle.allianceId === alliance.id && huddle.outcome)
        .map((huddle) => huddle.outcome!),
    })),
    huddles,
  };
  return {
    summary: allianceFactsSummary(facts),
    ...facts,
  };
}

function proposalReadFromLineage(
  lineage: AllianceProposalLineage,
  selectedPlayerId: string,
  playerNames: Map<string, string>,
): AgentAllianceProposalRead | null {
  const currentVersion = currentAllianceVersion(lineage);
  if (!currentVersion) return null;
  const responses = lineage.responsesByVersion[lineage.currentVersionId] ?? {};
  return {
    lineageId: lineage.id,
    allianceId: lineage.allianceId,
    name: currentVersion.terms.name,
    status: lineage.status,
    proposedRound: lineage.createdRound,
    ...(lineage.resolvedRound !== null && { resolvedRound: lineage.resolvedRound }),
    memberNames: currentVersion.terms.memberIds.map((id) => nameForPlayer(playerNames, id)),
    currentVersionId: lineage.currentVersionId,
    currentTerms: termsRead(currentVersion.terms, playerNames),
    proposer: {
      id: currentVersion.proposerId,
      name: nameForPlayer(playerNames, currentVersion.proposerId),
    },
    yourResponse: responses[selectedPlayerId] ?? null,
    finalResult: lineage.status,
  };
}

function compactAgentAllianceFacts(facts: AgentAllianceFullFactsRead): AgentAllianceCompactFactsRead {
  return {
    summary: facts.summary,
    proposals: facts.proposals.map((proposal) => ({
      lineageId: proposal.lineageId,
      allianceId: proposal.allianceId,
      name: proposal.currentTerms.name,
      status: proposal.status,
      proposedRound: proposal.proposedRound,
      ...(proposal.resolvedRound !== undefined && { resolvedRound: proposal.resolvedRound }),
      memberNames: proposal.currentTerms.memberNames,
      proposer: proposal.proposer,
      yourResponse: proposal.yourResponse,
      finalResult: proposal.finalResult,
    })),
    alliances: facts.alliances.map((alliance) => {
      const latestOutcome = latestOutcomeForAlliance(alliance.huddleOutcomes);
      return {
        id: alliance.id,
        status: alliance.status,
        name: alliance.name,
        memberNames: [...alliance.memberNames],
        purpose: alliance.purpose,
        timebox: alliance.timebox,
        createdRound: alliance.createdRound,
        updatedRound: alliance.updatedRound,
        huddleOutcomeCount: alliance.huddleOutcomes.length,
        ...(latestOutcome && { latestOutcome: compactOutcome(latestOutcome) }),
      };
    }),
    huddles: facts.huddles.map((huddle) => ({
      allianceId: huddle.allianceId,
      allianceName: huddle.allianceName,
      round: huddle.round,
      window: huddle.window,
      pass: huddle.pass,
      speakers: huddle.speakers,
      messageCount: huddle.messages.length,
      ...(huddle.outcome && { outcomeSummary: compactOutcome(huddle.outcome) }),
    })),
  };
}

function allianceFactsSummary(facts: {
  proposals: readonly AgentAllianceProposalRead[];
  alliances: readonly AgentAllianceRecordRead[];
  huddles: readonly AgentAllianceHuddleRead[];
}): AgentAllianceFactsSummaryRead {
  return {
    proposalCount: facts.proposals.length,
    activeAllianceCount: facts.alliances.filter((alliance) => alliance.status === "active").length,
    closedAllianceCount: facts.alliances.filter((alliance) => alliance.status === "closed").length,
    archivedAllianceCount: facts.alliances.filter((alliance) => alliance.status === "archived").length,
    huddleCount: facts.huddles.length,
    latestHuddleRound: facts.huddles.length > 0
      ? Math.max(...facts.huddles.map((huddle) => huddle.round))
      : null,
  };
}

function latestOutcomeForAlliance(
  outcomes: readonly AgentAllianceOutcomeRead[],
): AgentAllianceOutcomeRead | undefined {
  return [...outcomes].sort((left, right) =>
    right.round - left.round ||
    right.id.localeCompare(left.id)
  )[0];
}

function compactOutcome(outcome: AgentAllianceOutcomeRead): AgentAllianceCompactOutcomeRead {
  return {
    id: outcome.id,
    round: outcome.round,
    window: outcome.window,
    plan: outcome.plan,
    confidence: outcome.confidence,
    posture: outcome.posture,
    leakOrBetrayalClaims: [...outcome.leakOrBetrayalClaims],
  };
}

function huddleMessagesForSession(
  rows: ReadonlyArray<typeof schema.transcripts.$inferSelect>,
  session: { round: number; window: string; speakerIds: string[] },
  playerNames: Map<string, string>,
  selectedPlayerId: string,
): AgentAllianceHuddleRead["messages"] {
  const phase = session.window === "pre_vote" ? Phase.PRE_VOTE_HUDDLE : Phase.PRE_COUNCIL_HUDDLE;
  const expectedParticipants = new Set([
    ...session.speakerIds,
    ...session.speakerIds.map((id) => nameForPlayer(playerNames, id)),
  ]);
  return rows
    .filter((row) => row.round === session.round && row.phase === phase)
    .filter((row) => {
      const participants = new Set<string>();
      if (row.fromPlayerId) participants.add(row.fromPlayerId);
      const fromId = playerIdForName(playerNames, row.fromPlayerId ?? "");
      if (fromId) participants.add(fromId);
      for (const target of parseStringArray(row.toPlayerIds)) {
        participants.add(target);
        const targetId = playerIdForName(playerNames, target);
        if (targetId) participants.add(targetId);
      }
      return session.speakerIds.every((id) =>
        participants.has(id) || participants.has(nameForPlayer(playerNames, id))
      ) && Array.from(participants).some((item) => expectedParticipants.has(item));
    })
    .map((row) => {
      const fromId = row.fromPlayerId && playerNames.has(row.fromPlayerId)
        ? row.fromPlayerId
        : playerIdForName(playerNames, row.fromPlayerId ?? "");
      return {
        from: {
          ...(fromId && { id: fromId }),
          name: fromId ? nameForPlayer(playerNames, fromId) : row.fromPlayerId ?? "Unknown",
        },
        text: row.text,
        timestamp: row.timestamp,
        ...(fromId === selectedPlayerId && row.thinking && { thinking: row.thinking }),
      };
    });
}

function currentAllianceVersion(lineage: AllianceProposalLineage) {
  return lineage.versions.find((version) => version.versionId === lineage.currentVersionId) ?? lineage.versions.at(-1) ?? null;
}

function agentParticipatedInLineage(
  lineage: AllianceProposalLineage,
  playerId: string,
): boolean {
  for (const version of lineage.versions) {
    if (version.proposerId === playerId) return true;
    if (version.terms.memberIds.includes(playerId)) return true;
    if ((version.requiredConsentMemberIds ?? version.terms.memberIds).includes(playerId)) return true;
  }
  return Object.values(lineage.responsesByVersion).some((responses) => playerId in responses);
}

function termsRead(
  terms: { name: string; memberIds: string[]; purpose: string; timebox: string | null },
  playerNames: Map<string, string>,
): AgentAllianceTermsRead {
  return {
    name: terms.name,
    memberIds: [...terms.memberIds],
    memberNames: terms.memberIds.map((id) => nameForPlayer(playerNames, id)),
    purpose: terms.purpose,
    timebox: terms.timebox,
  };
}

function allianceRead(
  alliance: AllianceRecord,
  playerNames: Map<string, string>,
  huddleOutcomes: AgentAllianceOutcomeRead[],
): AgentAllianceRecordRead {
  return {
    id: alliance.id,
    status: alliance.status,
    ...termsRead(alliance, playerNames),
    createdRound: alliance.createdRound,
    updatedRound: alliance.updatedRound,
    huddleOutcomes,
  };
}

function outcomeRead(
  outcome: AllianceHuddleOutcome,
): AgentAllianceOutcomeRead {
  return {
    id: outcome.id,
    round: outcome.round,
    window: outcome.window,
    ask: outcome.ask,
    plan: outcome.plan,
    promises: [...outcome.promises],
    dissent: [...outcome.dissent],
    confidence: outcome.confidence,
    posture: outcome.posture,
    leakOrBetrayalClaims: [...outcome.leakOrBetrayalClaims],
  };
}

function playerRead(player: GamePlayerRow, playerNames: Map<string, string>): AgentAlliancePlayerRead {
  return {
    id: player.id,
    name: nameForPlayer(playerNames, player.id),
    ...(player.agentProfileId && { agentProfileId: player.agentProfileId }),
  };
}

function playerNameMap(players: readonly GamePlayerRow[]): Map<string, string> {
  return new Map(players.map((player) => [player.id, playerName(player)]));
}

function playerName(player: GamePlayerRow): string {
  try {
    const parsed = JSON.parse(player.persona) as { name?: unknown };
    if (typeof parsed.name === "string" && parsed.name.trim().length > 0) return parsed.name;
  } catch {
    // Fall through to id.
  }
  return player.id;
}

function nameForPlayer(playerNames: Map<string, string>, id: string): string {
  return playerNames.get(id) ?? id;
}

function playerIdForName(playerNames: Map<string, string>, name: string): string | undefined {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return undefined;
  for (const [id, playerNameValue] of playerNames) {
    if (playerNameValue.trim().toLowerCase() === normalized) return id;
  }
  return undefined;
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function buildProducerPostgameAnalysis(analysis: PostgameAnalysisProjection) {
  return {
    executiveSummary: analysis.executiveSummary,
    gameMomentum: analysis.gameMomentum,
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
      highlightedEliminations: analysis.summary.highlightedEliminations,
      majorEliminations: analysis.summary.majorEliminations,
      threatRemovedTurningPoints: analysis.turningPoints.filter((point) => point.type === "threat_removed"),
    },
    juryManagementAnalysis: {
      finalVote: analysis.summary.finalVote,
      juryNarrative: analysis.jury.juryNarrative,
      winnerSupporters: analysis.jury.winnerSupporters,
      runnerUpSupporters: analysis.jury.runnerUpSupporters,
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
  slug: string;
  status: string;
  trackType: string;
  seasonId: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}): ProductionGameMcpGameIdentity {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    trackType: row.trackType,
    rated: row.seasonId !== null,
    ...(row.seasonId && { seasonId: row.seasonId }),
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

function settlementHoldsTerminalOutcome(
  state: GameCompletionSettlementState | undefined,
): boolean {
  return state === "pending" || state === "repair_required";
}

function redactProjectionForSettlement(
  events: Awaited<ReturnType<typeof getPersistedGameEvents>>,
  state: GameCompletionSettlementState | undefined,
): PersistedGameProjectionRead {
  return settlementHoldsTerminalOutcome(state)
    ? getPersistedGameProjectionBeforeTerminalOutcome(events)
    : getPersistedGameProjection(events);
}

function terminalEventIsVisibleForSettlement(
  event: Pick<CanonicalGameEvent, "type" | "sequence">,
  state: GameCompletionSettlementState | undefined,
  terminalOutcomeSequence: number | undefined,
): boolean {
  if (!settlementHoldsTerminalOutcome(state)) return true;
  if (terminalOutcomeSequence !== undefined && event.sequence >= terminalOutcomeSequence) {
    return false;
  }
  return event.type !== "jury.vote_cast"
    && event.type !== "jury.winner_determined";
}

function firstTerminalOutcomeSequence(
  events: readonly TrustedPersistedGameEvent[],
): number | undefined {
  return events.find((row) => row.envelope.type === "jury.winner_determined")
    ?.envelope.sequence;
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
