import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "fs";
import { basename, join, relative } from "path";
import {
  assertCanonicalGameEvent,
  canonicalEventIsVisibleTo,
  type CanonicalEventQueryMode,
  type CanonicalGameEvent,
  type CanonicalSourcePointer,
} from "../canonical-events";
import { replayCanonicalEvents, type CanonicalGameProjection } from "../game-projection";
import type { Phase, UUID } from "../types";

export type GameMcpSessionStatus = "running" | "completed" | "failed" | "stale_running" | "unknown";

export type GameMcpSourceKind = "events" | "turns" | "progress" | "transcript" | "game_json";

export interface GameMcpSourceCitation {
  sessionId: string;
  gameNumber: number;
  sourceKind: GameMcpSourceKind;
  resourceUri: string;
  sourcePath: string;
  line?: number;
  eventSequence?: number;
}

export interface GameMcpSessionSummary {
  sessionId: string;
  sessionPath: string;
  status: GameMcpSessionStatus;
  startedAt: string | null;
  updatedAt: string | null;
  requestedGames: number | null;
  completedGames: number | null;
  failedGames: number | null;
  model: string | null;
  variant: string | null;
  gameCount: number;
  hasResults: boolean;
  hasStats: boolean;
}

export interface GameMcpGameSummary {
  sessionId: string;
  gameNumber: number;
  sessionPath: string;
  eventsPath: string | null;
  turnsPath: string | null;
  progressPath: string | null;
  transcriptPath: string | null;
  jsonPath: string | null;
  eventsUri: string | null;
  turnsUri: string | null;
  progressUri: string | null;
  transcriptUri: string | null;
  jsonUri: string | null;
  hasEvents: boolean;
  hasTurns: boolean;
  hasProgress: boolean;
  hasTranscript: boolean;
  hasJson: boolean;
  hasProjection: boolean;
  eventCount: number | null;
  lastEventSequence: number | null;
}

export interface GameMcpSessionFilter {
  status?: GameMcpSessionStatus;
  limit?: number;
}

export interface GameMcpGameFilter {
  sessionId?: string;
  withEventsOnly?: boolean;
}

export interface GameMcpEventFilter {
  sessionId?: string;
  gameNumber?: number;
  type?: string;
  phase?: Phase;
  actorId?: UUID;
  visibilityMode?: CanonicalEventQueryMode;
  sinceSequence?: number;
  limit?: number;
}

export interface GameMcpEventResult {
  citation: GameMcpSourceCitation;
  event: CanonicalGameEvent;
}

export interface GameMcpLogRecord {
  citation: GameMcpSourceCitation;
  text: string;
  record?: Record<string, unknown>;
}

export interface GameMcpSearchOptions {
  query: string;
  sessionId?: string;
  gameNumber?: number;
  sources?: GameMcpSourceKind[];
  limit?: number;
}

export interface GameMcpSearchResult {
  citation: GameMcpSourceCitation;
  text: string;
  event?: CanonicalGameEvent;
  record?: Record<string, unknown>;
}

export interface GameMcpProjectionResult {
  citation: GameMcpSourceCitation;
  projection: CanonicalGameProjection;
}

export interface GameMcpLinkedRecords {
  event: GameMcpEventResult;
  turns: GameMcpLogRecord[];
}

interface JsonlRecord {
  line: number;
  record: Record<string, unknown>;
}

interface CachedJsonl {
  size: number;
  mtimeMs: number;
  records: JsonlRecord[];
}

interface CachedText {
  size: number;
  mtimeMs: number;
  text: string;
}

interface SessionEntry {
  sessionId: string;
  sessionPath: string;
}

interface GamePaths {
  eventsPath: string | null;
  turnsPath: string | null;
  progressPath: string | null;
  transcriptPath: string | null;
  jsonPath: string | null;
}

const DEFAULT_STALE_RUNNING_MS = 15 * 60 * 1000;
const DEFAULT_SEARCH_SOURCES: GameMcpSourceKind[] = ["events", "turns", "progress", "transcript", "game_json"];

export type GameMcpArtifactKind = GameMcpSourceKind | "projection";

export function gameMcpSessionUri(sessionId: string): string {
  return `influence-game://sessions/${encodeURIComponent(sessionId)}`;
}

export function gameMcpSessionGamesUri(sessionId: string): string {
  return `${gameMcpSessionUri(sessionId)}/games`;
}

export function gameMcpGameArtifactUri(sessionId: string, gameNumber: number, artifact: GameMcpArtifactKind): string {
  const artifactPath = artifact === "game_json" ? "game-json" : artifact;
  return `${gameMcpSessionGamesUri(sessionId)}/${gameNumber}/${artifactPath}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isInsideDirectory(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith("/"));
}

function safeRealDirectory(path: string): string | null {
  try {
    const stats = statSync(path);
    if (!stats.isDirectory()) return null;
    return realpathSync(path);
  } catch {
    return null;
  }
}

function maybePath(dir: string, fileName: string): string | null {
  const path = join(dir, fileName);
  try {
    const stats = lstatSync(path);
    if (!stats.isFile()) return null;
    const realFilePath = realpathSync(path);
    const realDir = realpathSync(dir);
    return isInsideDirectory(realDir, realFilePath) ? path : null;
  } catch {
    return null;
  }
}

function readJsonObject(path: string | null): Record<string, unknown> | null {
  if (!path) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sessionHasKnownArtifacts(sessionPath: string): boolean {
  try {
    return readdirSync(sessionPath).some((fileName) => {
      if (fileName === "results.json" || fileName === "stats.json") {
        return maybePath(sessionPath, fileName) !== null;
      }
      return /^game-\d+(?:-(?:events|turns|progress)\.jsonl|\.json|\.txt)$/.test(fileName) &&
        maybePath(sessionPath, fileName) !== null;
    });
  } catch {
    return false;
  }
}

function gameNumberFromArtifact(fileName: string): number | null {
  const match = /^game-(\d+)(?:-(?:events|turns|progress)\.jsonl|\.json|\.txt)$/.exec(fileName);
  if (!match?.[1]) return null;
  return Number.parseInt(match[1], 10);
}

function maxTopLevelMtimeMs(sessionPath: string): number | null {
  try {
    let latest: number | null = null;
    for (const fileName of readdirSync(sessionPath)) {
      const path = join(sessionPath, fileName);
      const stats = statSync(path);
      if (!stats.isFile()) continue;
      latest = Math.max(latest ?? 0, stats.mtimeMs);
    }
    return latest;
  } catch {
    return null;
  }
}

function getNestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function getNumber(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function applyLimit<T>(items: T[], limit?: number): T[] {
  return typeof limit === "number" && Number.isFinite(limit) && limit > 0
    ? items.slice(0, limit)
    : items;
}

function extractCanonicalEvent(record: Record<string, unknown>): CanonicalGameEvent {
  const value = record.canonicalEvent ?? record;
  assertCanonicalGameEvent(value);
  return value;
}

function isTrailingPartialLine(index: number, lines: string[]): boolean {
  return lines.slice(index + 1).every((line) => line.trim().length === 0);
}

function eventMentionsActor(event: CanonicalGameEvent, actorId: UUID): boolean {
  if (event.sourcePointers.some((pointer) => pointer.actorId === actorId)) return true;
  const payload = event.payload;
  const payloadRecord = payload as Record<string, unknown>;

  if ("voterId" in payload && payload.voterId === actorId) return true;
  if ("playerId" in payload && payload.playerId === actorId) return true;
  if ("jurorId" in payload && payload.jurorId === actorId) return true;
  if ("empowered" in payload && payload.empowered === actorId) return true;
  if ("empoweredId" in payload && payload.empoweredId === actorId) return true;
  if ("eliminated" in payload && payload.eliminated === actorId) return true;
  if ("winnerId" in payload && payload.winnerId === actorId) return true;
  if ("finalistId" in payload && payload.finalistId === actorId) return true;
  if ("autoEliminated" in payload && payload.autoEliminated === actorId) return true;
  if ("shieldGranted" in payload && payload.shieldGranted === actorId) return true;
  if ("empowerTarget" in payload && payload.empowerTarget === actorId) return true;
  if ("exposeTarget" in payload && payload.exposeTarget === actorId) return true;
  if ("target" in payload && payload.target === actorId) return true;

  for (const key of ["expiredPlayerIds", "tied", "excluded", "lastSessionExcluded"] as const) {
    const value = payloadRecord[key];
    if (Array.isArray(value) && value.includes(actorId)) return true;
  }

  if ("action" in payload && payload.action !== null && typeof payload.action === "object" && !Array.isArray(payload.action)) {
    const action = payload.action as { target?: unknown };
    if (action.target === actorId) return true;
  }
  if ("candidates" in payload && Array.isArray(payload.candidates) && payload.candidates.includes(actorId)) {
    return true;
  }
  if ("rooms" in payload && Array.isArray(payload.rooms)) {
    return payload.rooms.some((room) => {
      if (room === null || typeof room !== "object" || Array.isArray(room)) return false;
      const maybeRoom = room as { playerIds?: unknown };
      return Array.isArray(maybeRoom.playerIds) && maybeRoom.playerIds.includes(actorId);
    });
  }
  if ("players" in payload && Array.isArray(payload.players)) {
    return payload.players.some((player) => isRecord(player) && player.id === actorId);
  }
  if ("voteCounts" in payload && Array.isArray(payload.voteCounts)) {
    return payload.voteCounts.some((voteCount) => isRecord(voteCount) && voteCount.id === actorId);
  }
  if ("tally" in payload && isRecord(payload.tally)) {
    const votes = payload.tally.votes;
    if (isRecord(votes) && Object.entries(votes).some(([voter, target]) => voter === actorId || target === actorId)) {
      return true;
    }
  }
  if ("juryTiebreakerVotes" in payload && isRecord(payload.juryTiebreakerVotes)) {
    return Object.entries(payload.juryTiebreakerVotes).some(([voter, target]) => voter === actorId || target === actorId);
  }

  return false;
}

function turnRecordActorId(record: Record<string, unknown>): string | null {
  if (isRecord(record.actor) && typeof record.actor.id === "string") return record.actor.id;
  return typeof record.actorId === "string" ? record.actorId : null;
}

function turnRecordMatchesPointer(
  record: Record<string, unknown>,
  line: number | undefined,
  pointer: CanonicalSourcePointer,
): boolean {
  if (typeof pointer.sequence === "number" && record.sequence === pointer.sequence) return true;
  if (typeof pointer.line === "number" && line === pointer.line) return true;
  if (!pointer.action || record.action !== pointer.action || record.round !== pointer.round) return false;
  if (pointer.actorId && turnRecordActorId(record) !== pointer.actorId) return false;
  if (pointer.phase && record.phase !== pointer.phase) return false;
  return true;
}

function resultKey(record: GameMcpLogRecord): string {
  return `${record.citation.sourcePath}:${record.citation.line ?? "unknown"}`;
}

export class GameMcpReadModel {
  private readonly jsonlCache = new Map<string, CachedJsonl>();
  private readonly textCache = new Map<string, CachedText>();

  constructor(private readonly simulationsRoot: string) {}

  listSessions(filter: GameMcpSessionFilter = {}): GameMcpSessionSummary[] {
    const sessions = this.discoverSessions()
      .map((session) => this.buildSessionSummary(session))
      .filter((session) => !filter.status || session.status === filter.status)
      .sort((a, b) => b.sessionId.localeCompare(a.sessionId));
    return applyLimit(sessions, filter.limit);
  }

  readSession(sessionId: string): GameMcpSessionSummary {
    return this.buildSessionSummary(this.requireSession(sessionId));
  }

  listGames(filter: GameMcpGameFilter = {}): GameMcpGameSummary[] {
    const sessions = filter.sessionId
      ? [this.requireSession(filter.sessionId)]
      : this.discoverSessions();
    const games = sessions.flatMap((session) => this.listSessionGames(session));
    return games
      .filter((game) => !filter.withEventsOnly || game.hasEvents)
      .sort((a, b) => a.sessionId.localeCompare(b.sessionId) || a.gameNumber - b.gameNumber);
  }

  readEvents(sessionId: string, gameNumber: number): CanonicalGameEvent[] {
    return this.readEventRecords(sessionId, gameNumber).map((entry) => entry.event);
  }

  readEventRecords(sessionId: string, gameNumber: number): GameMcpEventResult[] {
    const session = this.requireSession(sessionId);
    const eventsPath = this.gamePaths(session.sessionPath, gameNumber).eventsPath;
    if (!eventsPath) throw new Error(`No canonical event log for session ${sessionId} game ${gameNumber}`);
    return this.readJsonlRecords(eventsPath).map(({ line, record }) => {
      const event = extractCanonicalEvent(record);
      return {
        citation: {
          sessionId,
          gameNumber,
          sourceKind: "events",
          resourceUri: gameMcpGameArtifactUri(sessionId, gameNumber, "events"),
          sourcePath: eventsPath,
          line,
          eventSequence: event.sequence,
        },
        event,
      };
    });
  }

  readTurnRecords(sessionId: string, gameNumber: number): GameMcpLogRecord[] {
    const session = this.requireSession(sessionId);
    const turnsPath = this.gamePaths(session.sessionPath, gameNumber).turnsPath;
    if (!turnsPath) throw new Error(`No turn log for session ${sessionId} game ${gameNumber}`);
    return this.readJsonlLogRecords(sessionId, gameNumber, "turns", turnsPath);
  }

  readProgressRecords(sessionId: string, gameNumber: number): GameMcpLogRecord[] {
    const session = this.requireSession(sessionId);
    const progressPath = this.gamePaths(session.sessionPath, gameNumber).progressPath;
    if (!progressPath) throw new Error(`No progress log for session ${sessionId} game ${gameNumber}`);
    return this.readJsonlLogRecords(sessionId, gameNumber, "progress", progressPath);
  }

  readTranscript(sessionId: string, gameNumber: number): string {
    const session = this.requireSession(sessionId);
    const transcriptPath = this.gamePaths(session.sessionPath, gameNumber).transcriptPath;
    if (!transcriptPath) throw new Error(`No text transcript for session ${sessionId} game ${gameNumber}`);
    return this.readText(transcriptPath);
  }

  readGameJson(sessionId: string, gameNumber: number): string {
    const session = this.requireSession(sessionId);
    const jsonPath = this.gamePaths(session.sessionPath, gameNumber).jsonPath;
    if (!jsonPath) throw new Error(`No full game JSON for session ${sessionId} game ${gameNumber}`);
    return this.readText(jsonPath);
  }

  readProjection(sessionId: string, gameNumber: number): CanonicalGameProjection {
    return this.readProjectionRecord(sessionId, gameNumber).projection;
  }

  readProjectionRecord(sessionId: string, gameNumber: number): GameMcpProjectionResult {
    const events = this.readEventRecords(sessionId, gameNumber);
    const first = events[0];
    if (!first) throw new Error(`No canonical events for session ${sessionId} game ${gameNumber}`);
    const projection = replayCanonicalEvents(events.map(({ event }) => event));
    return {
      citation: {
        sessionId,
        gameNumber,
        sourceKind: "events",
        resourceUri: gameMcpGameArtifactUri(sessionId, gameNumber, "events"),
        sourcePath: first.citation.sourcePath,
        eventSequence: projection.lastSequence,
      },
      projection,
    };
  }

  filterEvents(filter: GameMcpEventFilter): GameMcpEventResult[] {
    const visibilityMode = filter.visibilityMode ?? "producer";
    const games = this.gamesForQuery(filter.sessionId, filter.gameNumber, true);
    const results: GameMcpEventResult[] = [];
    const rethrowReadErrors = filter.sessionId !== undefined && filter.gameNumber !== undefined;
    for (const game of games) {
      let records: GameMcpEventResult[];
      try {
        records = this.readEventRecords(game.sessionId, game.gameNumber);
      } catch (error) {
        if (rethrowReadErrors) throw error;
        continue;
      }
      for (const record of records) {
        const { event } = record;
        if (!canonicalEventIsVisibleTo(event, visibilityMode)) continue;
        if (filter.type && event.type !== filter.type) continue;
        if (filter.phase && event.phase !== filter.phase) continue;
        if (filter.actorId && !eventMentionsActor(event, filter.actorId)) continue;
        if (typeof filter.sinceSequence === "number" && event.sequence <= filter.sinceSequence) continue;
        results.push(record);
        if (typeof filter.limit === "number" && filter.limit > 0 && results.length >= filter.limit) {
          return results;
        }
      }
    }
    return results;
  }

  readPlayerTimeline(
    sessionId: string,
    gameNumber: number,
    playerIdOrName: string,
    visibilityMode: CanonicalEventQueryMode = "producer",
    limit?: number,
  ): GameMcpEventResult[] {
    const projection = this.readProjection(sessionId, gameNumber);
    const matchingPlayerId = projection.players[playerIdOrName]
      ? playerIdOrName
      : Object.values(projection.players).find((player) => player.name.toLowerCase() === playerIdOrName.toLowerCase())?.id;
    if (!matchingPlayerId) return [];
    return this.filterEvents({ sessionId, gameNumber, actorId: matchingPlayerId, visibilityMode, limit });
  }

  searchLogs(options: GameMcpSearchOptions): GameMcpSearchResult[] {
    const query = options.query.trim().toLowerCase();
    if (!query) return [];
    const sources = options.sources ?? DEFAULT_SEARCH_SOURCES;
    const results: GameMcpSearchResult[] = [];
    const rethrowReadErrors = options.sessionId !== undefined && options.gameNumber !== undefined;

    for (const game of this.gamesForQuery(options.sessionId, options.gameNumber, false)) {
      if (sources.includes("events") && game.hasEvents) {
        try {
          results.push(...this.searchEvents(game, query));
        } catch (error) {
          if (rethrowReadErrors) throw error;
        }
      }
      if (sources.includes("turns") && game.turnsPath) {
        try {
          results.push(...this.searchJsonlLog(game, "turns", game.turnsPath, query));
        } catch (error) {
          if (rethrowReadErrors) throw error;
        }
      }
      if (sources.includes("progress") && game.progressPath) {
        try {
          results.push(...this.searchJsonlLog(game, "progress", game.progressPath, query));
        } catch (error) {
          if (rethrowReadErrors) throw error;
        }
      }
      if (sources.includes("transcript") && game.transcriptPath) {
        try {
          results.push(...this.searchTextFile(game, "transcript", game.transcriptPath, query));
        } catch (error) {
          if (rethrowReadErrors) throw error;
        }
      }
      if (sources.includes("game_json") && game.jsonPath) {
        try {
          results.push(...this.searchTextFile(game, "game_json", game.jsonPath, query));
        } catch (error) {
          if (rethrowReadErrors) throw error;
        }
      }
      if (typeof options.limit === "number" && results.length >= options.limit) {
        return applyLimit(results, options.limit);
      }
    }

    return applyLimit(results, options.limit);
  }

  readLinkedRecords(sessionId: string, gameNumber: number, eventSequence: number): GameMcpLinkedRecords {
    const event = this.readEventRecords(sessionId, gameNumber).find((candidate) => candidate.event.sequence === eventSequence);
    if (!event) throw new Error(`No canonical event ${eventSequence} in session ${sessionId} game ${gameNumber}`);

    const game = this.readGame(sessionId, gameNumber);
    const turnRecords = game.turnsPath ? this.readJsonlLogRecords(sessionId, gameNumber, "turns", game.turnsPath) : [];
    const linked = event.event.sourcePointers
      .filter((pointer) => pointer.kind === "agent_turn")
      .flatMap((pointer) =>
        turnRecords.filter(({ citation, record }) => record && turnRecordMatchesPointer(record, citation.line, pointer)),
      );
    const seen = new Set<string>();
    const turns = linked.filter((record) => {
      const key = resultKey(record);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { event, turns };
  }

  private discoverSessions(): SessionEntry[] {
    const realRoot = safeRealDirectory(this.simulationsRoot);
    if (!realRoot) return [];

    if (sessionHasKnownArtifacts(this.simulationsRoot)) {
      return [{ sessionId: basename(this.simulationsRoot), sessionPath: this.simulationsRoot }];
    }

    return readdirSync(this.simulationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ sessionId: entry.name, sessionPath: join(this.simulationsRoot, entry.name) }))
      .filter((entry) => {
        const realSessionPath = safeRealDirectory(entry.sessionPath);
        return realSessionPath !== null && isInsideDirectory(realRoot, realSessionPath);
      })
      .filter((entry) => sessionHasKnownArtifacts(entry.sessionPath));
  }

  private requireSession(sessionId: string): SessionEntry {
    const session = this.discoverSessions().find((candidate) => candidate.sessionId === sessionId);
    if (!session) throw new Error(`Unknown simulation session: ${sessionId}`);
    return session;
  }

  private buildSessionSummary(session: SessionEntry): GameMcpSessionSummary {
    const results = readJsonObject(maybePath(session.sessionPath, "results.json"));
    const stats = readJsonObject(maybePath(session.sessionPath, "stats.json")) ?? getNestedRecord(results ?? {}, "stats");
    const metadata = getNestedRecord(results ?? {}, "metadata") ?? getNestedRecord(stats ?? {}, "metadata");
    const updatedAtMs = maxTopLevelMtimeMs(session.sessionPath);
    const partial = stats?.partial;
    const failedGames = getNumber(stats, "failedGames");
    const status = this.deriveSessionStatus(partial, failedGames, updatedAtMs);
    const args = getNestedRecord(metadata ?? {}, "args");

    return {
      sessionId: session.sessionId,
      sessionPath: session.sessionPath,
      status,
      startedAt: getString(metadata, "timestamp"),
      updatedAt: updatedAtMs === null ? null : new Date(updatedAtMs).toISOString(),
      requestedGames: getNumber(stats, "requestedGames") ?? getNumber(args, "games"),
      completedGames: getNumber(stats, "completedGames"),
      failedGames,
      model: getString(stats, "model") ?? getString(args, "model"),
      variant: getString(metadata, "variant") ?? getString(args, "variant"),
      gameCount: this.listSessionGames(session).length,
      hasResults: maybePath(session.sessionPath, "results.json") !== null,
      hasStats: maybePath(session.sessionPath, "stats.json") !== null,
    };
  }

  private deriveSessionStatus(partial: unknown, failedGames: number | null, updatedAtMs: number | null): GameMcpSessionStatus {
    if (partial === false) return failedGames && failedGames > 0 ? "failed" : "completed";
    if (partial === true) {
      return this.isStale(updatedAtMs) ? "stale_running" : "running";
    }
    if (updatedAtMs !== null) return this.isStale(updatedAtMs) ? "stale_running" : "running";
    return "unknown";
  }

  private isStale(updatedAtMs: number | null): boolean {
    return updatedAtMs !== null && Date.now() - updatedAtMs > DEFAULT_STALE_RUNNING_MS;
  }

  private listSessionGames(session: SessionEntry): GameMcpGameSummary[] {
    return this.discoverGameNumbers(session.sessionPath)
      .map((gameNumber) => this.buildGameSummary(session, gameNumber))
      .sort((a, b) => a.gameNumber - b.gameNumber);
  }

  private discoverGameNumbers(sessionPath: string): number[] {
    const gameNumbers = new Set<number>();
    for (const fileName of readdirSync(sessionPath)) {
      const gameNumber = gameNumberFromArtifact(fileName);
      if (gameNumber !== null && maybePath(sessionPath, fileName)) gameNumbers.add(gameNumber);
    }
    return [...gameNumbers].sort((a, b) => a - b);
  }

  private buildGameSummary(session: SessionEntry, gameNumber: number): GameMcpGameSummary {
    const paths = this.gamePaths(session.sessionPath, gameNumber);
    return {
      sessionId: session.sessionId,
      gameNumber,
      sessionPath: session.sessionPath,
      ...paths,
      eventsUri: paths.eventsPath ? gameMcpGameArtifactUri(session.sessionId, gameNumber, "events") : null,
      turnsUri: paths.turnsPath ? gameMcpGameArtifactUri(session.sessionId, gameNumber, "turns") : null,
      progressUri: paths.progressPath ? gameMcpGameArtifactUri(session.sessionId, gameNumber, "progress") : null,
      transcriptUri: paths.transcriptPath ? gameMcpGameArtifactUri(session.sessionId, gameNumber, "transcript") : null,
      jsonUri: paths.jsonPath ? gameMcpGameArtifactUri(session.sessionId, gameNumber, "game_json") : null,
      hasEvents: paths.eventsPath !== null,
      hasTurns: paths.turnsPath !== null,
      hasProgress: paths.progressPath !== null,
      hasTranscript: paths.transcriptPath !== null,
      hasJson: paths.jsonPath !== null,
      hasProjection: paths.eventsPath !== null,
      eventCount: null,
      lastEventSequence: null,
    };
  }

  private readGame(sessionId: string, gameNumber: number): GameMcpGameSummary {
    const game = this.listGames({ sessionId }).find((candidate) => candidate.gameNumber === gameNumber);
    if (!game) throw new Error(`Unknown game ${gameNumber} in session ${sessionId}`);
    return game;
  }

  private gamePaths(sessionPath: string, gameNumber: number): GamePaths {
    return {
      eventsPath: maybePath(sessionPath, `game-${gameNumber}-events.jsonl`),
      turnsPath: maybePath(sessionPath, `game-${gameNumber}-turns.jsonl`),
      progressPath: maybePath(sessionPath, `game-${gameNumber}-progress.jsonl`),
      transcriptPath: maybePath(sessionPath, `game-${gameNumber}.txt`),
      jsonPath: maybePath(sessionPath, `game-${gameNumber}.json`),
    };
  }

  private gamesForQuery(sessionId: string | undefined, gameNumber: number | undefined, eventsOnly: boolean): GameMcpGameSummary[] {
    return this.listGames({ sessionId, withEventsOnly: eventsOnly })
      .filter((game) => gameNumber === undefined || game.gameNumber === gameNumber);
  }

  private readJsonlRecords(path: string): JsonlRecord[] {
    const stats = statSync(path);
    const cached = this.jsonlCache.get(path);
    if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
      return cached.records;
    }

    const content = readFileSync(path, "utf8");
    const lines = content.split(/\r?\n/);
    const records: JsonlRecord[] = [];

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]?.trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (isRecord(parsed)) records.push({ line: index + 1, record: parsed });
      } catch (error) {
        if (isTrailingPartialLine(index, lines)) break;
        throw error;
      }
    }

    this.jsonlCache.set(path, { size: stats.size, mtimeMs: stats.mtimeMs, records });
    return records;
  }

  private readText(path: string): string {
    const stats = statSync(path);
    const cached = this.textCache.get(path);
    if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
      return cached.text;
    }

    const text = readFileSync(path, "utf8");
    this.textCache.set(path, { size: stats.size, mtimeMs: stats.mtimeMs, text });
    return text;
  }

  private readJsonlLogRecords(
    sessionId: string,
    gameNumber: number,
    sourceKind: GameMcpSourceKind,
    sourcePath: string,
  ): GameMcpLogRecord[] {
    return this.readJsonlRecords(sourcePath).map(({ line, record }) => ({
      citation: {
        sessionId,
        gameNumber,
        sourceKind,
        resourceUri: gameMcpGameArtifactUri(sessionId, gameNumber, sourceKind),
        sourcePath,
        line,
      },
      text: JSON.stringify(record),
      record,
    }));
  }

  private searchEvents(game: GameMcpGameSummary, query: string): GameMcpSearchResult[] {
    return this.readEventRecords(game.sessionId, game.gameNumber)
      .map(({ citation, event }) => ({ citation, event, text: JSON.stringify(event) }))
      .filter((result) => result.text.toLowerCase().includes(query));
  }

  private searchJsonlLog(
    game: GameMcpGameSummary,
    sourceKind: GameMcpSourceKind,
    sourcePath: string,
    query: string,
  ): GameMcpSearchResult[] {
    return this.readJsonlLogRecords(game.sessionId, game.gameNumber, sourceKind, sourcePath)
      .filter((entry) => entry.text.toLowerCase().includes(query))
      .map((entry) => ({ ...entry }));
  }

  private searchTextFile(
    game: GameMcpGameSummary,
    sourceKind: GameMcpSourceKind,
    sourcePath: string,
    query: string,
  ): GameMcpSearchResult[] {
    return this.readText(sourcePath)
      .split(/\r?\n/)
      .map((text, index) => ({
        citation: {
          sessionId: game.sessionId,
          gameNumber: game.gameNumber,
          sourceKind,
          resourceUri: gameMcpGameArtifactUri(game.sessionId, game.gameNumber, sourceKind),
          sourcePath,
          line: index + 1,
        },
        text,
      }))
      .filter((entry) => entry.text.toLowerCase().includes(query));
  }
}
