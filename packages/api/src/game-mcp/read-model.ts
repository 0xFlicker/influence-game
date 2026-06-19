import { desc, eq, or } from "drizzle-orm";
import {
  canonicalEventIsVisibleTo,
  type CanonicalEventQueryMode,
  type CanonicalGameEvent,
  type CanonicalGameEventType,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { getDurableRunInspection } from "../services/game-durable-run.js";
import {
  getPersistedGameEvents,
  type TrustedPersistedGameEvent,
} from "../services/game-event-read-model.js";
import { getPersistedGameProjection } from "../services/game-projection-read-model.js";
import { PrivateTraceReadModel } from "../services/private-trace-read-model.js";

const DEFAULT_EVENT_LIMIT = 50;
const MAX_EVENT_LIMIT = 200;
const DEFAULT_GAME_LIMIT = 20;
const MAX_GAME_LIMIT = 100;
const DEFAULT_TRACE_CONTENT_BYTES = 8 * 1024 * 1024;
const MAX_TRACE_CONTENT_BYTES = 64 * 1024 * 1024;

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

export class ProductionGameMcpReadModel {
  constructor(
    private readonly db: DrizzleDB,
    private readonly privateTrace = new PrivateTraceReadModel(db),
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

  async listGames(limit = DEFAULT_GAME_LIMIT): Promise<{
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
    developerEvidence: { note: string };
  }> {
    const rows = await this.db
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

    return {
      schemaVersion: 1,
      canonicalGameFacts: { games },
      developerEvidence: {
        note: "Private reasoning tools are available as explicit tool calls behind the same global scope=mcp gate.",
      },
    };
  }

  async readProjection(gameIdOrSlug: string): Promise<{
    schemaVersion: 1;
    game: ProductionGameMcpGameIdentity;
    canonicalGameFacts: {
      projection: ReturnType<typeof getPersistedGameProjection>;
    };
  }> {
    const game = await this.requireGame(gameIdOrSlug);
    const events = await getPersistedGameEvents(this.db, game.id);
    return {
      schemaVersion: 1,
      game,
      canonicalGameFacts: {
        projection: getPersistedGameProjection(events),
      },
    };
  }

  async filterEvents(options: ProductionGameMcpEventFilter): Promise<{
    schemaVersion: 1;
    game: ProductionGameMcpGameIdentity;
    canonicalGameFacts: {
      eventLogStatus: string;
      validPrefixLength: number;
      events: ProductionGameEventResult[];
    };
    diagnostics: unknown[];
  }> {
    const game = await this.requireGame(options.gameIdOrSlug);
    const eventRead = await getPersistedGameEvents(this.db, game.id);
    const visibilityMode = options.visibilityMode ?? "producer";
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

  async playerTimeline(options: ProductionGameMcpPlayerTimelineOptions): Promise<{
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
      visibilityMode: options.visibilityMode ?? "producer",
      limit: options.limit ?? DEFAULT_EVENT_LIMIT,
    });
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

  async inspectDurableRun(gameIdOrSlug: string): Promise<{
    schemaVersion: 1;
    developerEvidence: {
      durableRun: unknown;
    };
  }> {
    const result = await getDurableRunInspection(this.db, gameIdOrSlug);
    if (!result.ok) throw new Error(result.error);
    return {
      schemaVersion: 1,
      developerEvidence: {
        durableRun: result.response,
      },
    };
  }

  async listTraceManifests(gameIdOrSlug: string, limit?: number): Promise<{
    schemaVersion: 1;
    developerEvidence: unknown;
  }> {
    return {
      schemaVersion: 1,
      developerEvidence: await this.privateTrace.listManifests(
        gameIdOrSlug,
        clamp(limit ?? 50, 1, 200),
      ),
    };
  }

  async readTraceContent(params: {
    manifestId: string;
    gameId?: string;
    purpose?: string;
    maxBytes?: number;
  }): Promise<{
    schemaVersion: 1;
    privateReasoning: unknown;
  }> {
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
  }): Promise<{
    schemaVersion: 1;
    privateReasoning: unknown;
  }> {
    return {
      schemaVersion: 1,
      privateReasoning: await this.privateTrace.searchReasoningTraces({
        ...params,
        limit: clamp(params.limit ?? 20, 1, 100),
      }),
    };
  }

  private async requireGame(gameIdOrSlug: string): Promise<ProductionGameMcpGameIdentity> {
    const game = await this.resolveGame(gameIdOrSlug);
    if (!game) throw new Error(`Unknown game: ${gameIdOrSlug}`);
    return game;
  }
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
