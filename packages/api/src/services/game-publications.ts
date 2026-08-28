import {
  assertCanonicalGameEvent,
  projectViewerDecisionEvent,
  type GamePublicationPayloadV1,
} from "@influence/engine";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNotNull,
  lte,
} from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type {
  PublicWsTranscriptEntry,
  WsPublicationEvent,
  WsPublicationPayload,
} from "./ws-manager.js";
import { getGameWatchState } from "./game-watch-state.js";
import { isDialogueTranscriptScope } from "./transcript-capture.js";

const DEFAULT_PUBLICATION_BATCH_SIZE = 200;
const DEFAULT_PUBLICATION_POLL_MS = 100;
const MAX_PUBLICATION_CATCHUP = 2_000;

type StoredPublicationRow = typeof schema.gamePublications.$inferSelect;

export class GamePublicationIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GamePublicationIntegrityError";
  }
}

export interface ReadDueGamePublicationsOptions {
  afterPublicationSequence?: number;
  limit?: number;
  now?: Date;
}

/**
 * Read and materialize one contiguous due suffix. Stored references never cross
 * the public boundary: transcript and canonical rows are resolved server-side.
 */
export async function readDueGamePublications(
  db: DrizzleDB,
  gameId: string,
  options: ReadDueGamePublicationsOptions = {},
): Promise<WsPublicationEvent[]> {
  const afterPublicationSequence = options.afterPublicationSequence ?? 0;
  const limit = options.limit ?? DEFAULT_PUBLICATION_BATCH_SIZE;
  assertCursor(afterPublicationSequence);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("publication limit must be an integer from 1 through 1000");
  }
  const nowIso = (options.now ?? new Date()).toISOString();
  const rows = await db.select()
    .from(schema.gamePublications)
    .where(and(
      eq(schema.gamePublications.gameId, gameId),
      gt(schema.gamePublications.publicationSequence, afterPublicationSequence),
      isNotNull(schema.gamePublications.availableAt),
      lte(schema.gamePublications.availableAt, nowIso),
    ))
    .orderBy(asc(schema.gamePublications.publicationSequence))
    .limit(limit);

  let expectedSequence = afterPublicationSequence + 1;
  for (const row of rows) {
    if (row.publicationSequence !== expectedSequence) {
      throw new GamePublicationIntegrityError(
        `Due publication suffix for ${gameId} is not contiguous: expected ${expectedSequence}, got ${row.publicationSequence}`,
      );
    }
    expectedSequence += 1;
  }
  return Promise.all(rows.map((row) => materializeGamePublication(db, row)));
}

/** Read the complete currently due suffix in bounded database pages. */
export async function readDueGamePublicationSuffix(
  db: DrizzleDB,
  gameId: string,
  options: Omit<ReadDueGamePublicationsOptions, "limit"> & { maxTotal?: number } = {},
): Promise<WsPublicationEvent[]> {
  let cursor = options.afterPublicationSequence ?? 0;
  const maxTotal = options.maxTotal ?? MAX_PUBLICATION_CATCHUP;
  assertCursor(cursor);
  if (!Number.isSafeInteger(maxTotal) || maxTotal < 1 || maxTotal > MAX_PUBLICATION_CATCHUP) {
    throw new Error(`publication catch-up limit must be an integer from 1 through ${MAX_PUBLICATION_CATCHUP}`);
  }
  const publications: WsPublicationEvent[] = [];
  while (true) {
    const page = await readDueGamePublications(db, gameId, {
      afterPublicationSequence: cursor,
      limit: DEFAULT_PUBLICATION_BATCH_SIZE,
      ...(options.now && { now: options.now }),
    });
    if (publications.length + page.length > maxTotal) {
      throw new GamePublicationIntegrityError(
        `Due publication suffix for ${gameId} exceeds the ${maxTotal}-frame catch-up limit`,
      );
    }
    publications.push(...page);
    if (page.length < DEFAULT_PUBLICATION_BATCH_SIZE) return publications;
    cursor = page.at(-1)!.publicationSequence;
  }
}

/** Highest currently due durable publication sequence. */
export async function getDueGamePublicationHead(
  db: DrizzleDB,
  gameId: string,
  now: Date = new Date(),
): Promise<number> {
  const row = (await db.select({
    publicationSequence: schema.gamePublications.publicationSequence,
  })
    .from(schema.gamePublications)
    .where(and(
      eq(schema.gamePublications.gameId, gameId),
      isNotNull(schema.gamePublications.availableAt),
      lte(schema.gamePublications.availableAt, now.toISOString()),
    ))
    .orderBy(desc(schema.gamePublications.publicationSequence))
    .limit(1))[0];
  return row?.publicationSequence ?? 0;
}

/** Resolve one durable reference into the exact viewer-safe WebSocket payload. */
export async function materializeGamePublication(
  db: DrizzleDB,
  row: StoredPublicationRow,
): Promise<WsPublicationEvent> {
  const payload = assertStoredPublicationPayload(row);
  const viewerPayload = await materializePayload(db, row.gameId, payload);
  return {
    type: "publication",
    gameId: row.gameId,
    publicationSequence: row.publicationSequence,
    turnSequence: row.turnSequence,
    payload: viewerPayload,
  };
}

async function materializePayload(
  db: DrizzleDB,
  gameId: string,
  payload: GamePublicationPayloadV1,
): Promise<WsPublicationPayload> {
  switch (payload.kind) {
    case "canonical_event": {
      const row = (await db.select({ envelope: schema.gameEvents.envelope })
        .from(schema.gameEvents)
        .where(and(
          eq(schema.gameEvents.gameId, gameId),
          eq(schema.gameEvents.sequence, payload.eventSequence),
        ))
        .limit(1))[0];
      if (!row) {
        throw new GamePublicationIntegrityError(
          `Canonical publication ${gameId}:${payload.eventSequence} has no committed event`,
        );
      }
      assertCanonicalGameEvent(row.envelope);
      const event = projectViewerDecisionEvent(row.envelope);
      if (!event) {
        throw new GamePublicationIntegrityError(
          `Canonical publication ${gameId}:${payload.eventSequence} has no viewer-safe projection`,
        );
      }
      if (event.type === "game.phase_entered") {
        return {
          type: "phase_change",
          phase: event.payload.phase,
          round: event.round,
          alivePlayers: event.payload.remainingPlayers.map((player) => player.id),
        };
      }
      if (event.type === "player.eliminated") {
        return {
          type: "player_eliminated",
          playerId: event.payload.playerId,
          playerName: event.payload.playerName,
          round: event.round,
        };
      }
      return { type: "viewer_decision_event", gameId, event };
    }

    case "transcript_entry": {
      const row = (await db.select({
        entrySequence: schema.transcripts.entrySequence,
        round: schema.transcripts.round,
        phase: schema.transcripts.phase,
        fromPlayerId: schema.transcripts.fromPlayerId,
        speakerPlayerId: schema.transcripts.speakerPlayerId,
        scope: schema.transcripts.scope,
        toPlayerIds: schema.transcripts.toPlayerIds,
        roomId: schema.transcripts.roomId,
        roomMetadata: schema.transcripts.roomMetadata,
        text: schema.transcripts.text,
        thinking: schema.transcripts.thinking,
        timestamp: schema.transcripts.timestamp,
        dialogueKind: schema.transcripts.dialogueKind,
      })
        .from(schema.transcripts)
        .where(and(
          eq(schema.transcripts.gameId, gameId),
          eq(schema.transcripts.gameTurnId, payload.turnId),
          eq(schema.transcripts.gameTurnTranscriptOrdinal, payload.transcriptOrdinal),
        ))
        .limit(1))[0];
      if (!row) {
        throw new GamePublicationIntegrityError(
          `Transcript publication ${gameId}:${payload.turnId}:${payload.transcriptOrdinal} has no committed entry`,
        );
      }
      if (row.scope === "huddle") {
        throw new GamePublicationIntegrityError(
          `Transcript publication ${gameId}:${payload.turnId}:${payload.transcriptOrdinal} exposes a private huddle`,
        );
      }
      if (row.scope !== "diary" && !isDialogueTranscriptScope(row.scope)) {
        throw new GamePublicationIntegrityError(
          `Transcript publication ${gameId}:${payload.turnId}:${payload.transcriptOrdinal} has a private scope`,
        );
      }
      return {
        type: "message",
        entry: publicTranscriptEntry(row),
      };
    }

    case "completion": {
      const state = await getGameWatchState(db, gameId);
      if (!state || state.status !== "completed") {
        throw new GamePublicationIntegrityError(
          `Completion publication for ${gameId} became due before settlement completed`,
        );
      }
      return {
        type: "game_over",
        ...(state.winner && {
          winner: state.winner.id,
          winnerName: state.winner.name,
        }),
        totalRounds: state.currentRound,
      };
    }

  }
}

function assertStoredPublicationPayload(
  row: StoredPublicationRow,
): GamePublicationPayloadV1 {
  const payload = row.payload;
  if (!isRecord(payload) || payload.version !== 1 || payload.kind !== row.kind) {
    throw new GamePublicationIntegrityError(
      `Publication ${row.gameId}:${row.publicationSequence} has an invalid payload`,
    );
  }
  const valid = (() => {
    switch (payload.kind) {
      case "canonical_event":
        return hasExactKeys(payload, ["version", "kind", "eventSequence"])
          && isPositiveSafeInteger(payload.eventSequence);
      case "transcript_entry":
        return hasExactKeys(payload, ["version", "kind", "turnId", "transcriptOrdinal"])
          && isNonEmptyString(payload.turnId)
          && isPositiveSafeInteger(payload.transcriptOrdinal);
      case "completion":
        return hasExactKeys(payload, ["version", "kind", "eventSequence"])
          && (payload.eventSequence === null || isPositiveSafeInteger(payload.eventSequence));
      default:
        return false;
    }
  })();
  if (!valid) {
    throw new GamePublicationIntegrityError(
      `Publication ${row.gameId}:${row.publicationSequence} has an invalid payload`,
    );
  }
  return payload as GamePublicationPayloadV1;
}

function publicTranscriptEntry(row: {
  entrySequence: number | null;
  round: number;
  phase: string;
  fromPlayerId: string | null;
  speakerPlayerId: string | null;
  scope: string;
  toPlayerIds: string | null;
  roomId: number | null;
  roomMetadata: string | null;
  text: string;
  thinking: string | null;
  timestamp: number;
  dialogueKind: string | null;
}): PublicWsTranscriptEntry {
  const from = row.speakerPlayerId
    ?? row.fromPlayerId
    ?? (row.dialogueKind === "house_summary" ? "House" : "SYSTEM");
  const to = parseStringArray(row.toPlayerIds);
  const roomMetadata = parseRoomMetadata(row.roomMetadata);
  return {
    ...(row.entrySequence !== null && { entrySequence: row.entrySequence }),
    round: row.round,
    phase: row.phase as PublicWsTranscriptEntry["phase"],
    from,
    scope: row.scope as PublicWsTranscriptEntry["scope"],
    ...(to && { to }),
    ...(row.roomId !== null && { roomId: row.roomId }),
    ...(roomMetadata && { roomMetadata }),
    text: row.text,
    ...(row.thinking !== null && { thinking: row.thinking }),
    timestamp: row.timestamp,
  };
}

function parseStringArray(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function parseRoomMetadata(
  value: string | null,
): PublicWsTranscriptEntry["roomMetadata"] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || !Array.isArray(parsed.rooms) || !Array.isArray(parsed.excluded)) {
      return null;
    }
    const rooms = parsed.rooms.flatMap((room) =>
      isRecord(room)
      && Number.isInteger(room.roomId)
      && Number.isInteger(room.round)
      && Number.isInteger(room.beat)
      && Array.isArray(room.playerIds)
      && room.playerIds.every((playerId) => typeof playerId === "string")
        ? [{
            roomId: Number(room.roomId),
            round: Number(room.round),
            beat: Number(room.beat),
            playerIds: [...room.playerIds] as string[],
          }]
        : [],
    );
    if (rooms.length !== parsed.rooms.length || !parsed.excluded.every((entry) => typeof entry === "string")) {
      return null;
    }
    return { rooms, excluded: [...parsed.excluded] as string[] };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => key in value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) && value > 0;
}

function assertCursor(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("afterPublicationSequence must be a non-negative safe integer");
  }
}

export interface DueGamePublicationRuntime {
  flushDue(): Promise<number>;
  stop(): Promise<void>;
}

/**
 * Release due rows over the live pub/sub lane. Nothing is marked published:
 * reconnect catch-up remains authoritative and live delivery is at-least-once.
 */
export async function startDueGamePublicationRuntime(
  db: DrizzleDB,
  options: {
    broadcast(publication: WsPublicationEvent): void | Promise<void>;
    pollIntervalMs?: number;
    batchSize?: number;
    now?: () => Date;
    skipExistingAtStartup?: boolean;
    logger?: Pick<Console, "error">;
  },
): Promise<DueGamePublicationRuntime> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_PUBLICATION_POLL_MS;
  const batchSize = options.batchSize ?? DEFAULT_PUBLICATION_BATCH_SIZE;
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? console;
  const cursorByGameId = new Map<string, number>();
  let stopped = false;
  let draining: Promise<number> | null = null;

  if (options.skipExistingAtStartup !== false) {
    for (const gameId of await dueGameIds(db, now())) {
      cursorByGameId.set(gameId, await getDueGamePublicationHead(db, gameId, now()));
    }
  }

  const flushDue = async (): Promise<number> => {
    if (stopped) return 0;
    if (draining) return draining;
    draining = (async () => {
      let released = 0;
      for (const gameId of await dueGameIds(db, now())) {
        let cursor = cursorByGameId.get(gameId) ?? 0;
        while (!stopped) {
          const publications = await readDueGamePublications(db, gameId, {
            afterPublicationSequence: cursor,
            limit: batchSize,
            now: now(),
          });
          if (publications.length === 0) break;
          for (const publication of publications) {
            await options.broadcast(publication);
            cursor = publication.publicationSequence;
            cursorByGameId.set(gameId, cursor);
            released += 1;
          }
          if (publications.length < batchSize) break;
        }
      }
      return released;
    })().finally(() => {
      draining = null;
    });
    return draining;
  };

  const timer = setInterval(() => {
    void flushDue().catch((error) => {
      logger.error("[game-publications] Due publication release failed", error);
    });
  }, pollIntervalMs);
  timer.unref();

  return {
    flushDue,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await draining;
    },
  };
}

async function dueGameIds(db: DrizzleDB, now: Date): Promise<string[]> {
  const rows = await db.selectDistinct({ gameId: schema.gamePublications.gameId })
    .from(schema.gamePublications)
    .where(and(
      isNotNull(schema.gamePublications.availableAt),
      lte(schema.gamePublications.availableAt, now.toISOString()),
    ))
    .orderBy(asc(schema.gamePublications.gameId));
  return rows.map((row) => row.gameId);
}
