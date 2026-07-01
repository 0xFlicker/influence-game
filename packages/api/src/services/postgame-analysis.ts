import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  buildCompletedGameResults,
  buildPostgameAnalysisProjection,
  type PostgameAnalysisDetailLevel,
  type PostgameAnalysisProjection,
  type PostgameJuryBreakdown,
  type PostgamePlayerGameSummary,
  type PostgameTurningPoint,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { GameStatus } from "../db/schema.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import { getPersistedGameProjection } from "./game-projection-read-model.js";

const DEFAULT_AGENT_GAME_LIMIT = 20;
const MAX_AGENT_GAME_LIMIT = 100;

type PostgameDB = DrizzleDB;

export type PostgameReadStatus =
  | "not_found"
  | "not_completed"
  | "unavailable"
  | "player_not_found"
  | "agent_not_found";

export interface PostgameGameReadOptions {
  detailLevel?: PostgameAnalysisDetailLevel;
  includeEvidence?: boolean;
}

export interface PostgameGameMetadata {
  id: string;
  slug?: string;
  status: GameStatus;
  trackType: string;
  startedAt?: string;
  endedAt?: string;
  playerCount: number;
  roundCount: number;
}

export type PostgameGameAnalysisResult =
  | {
      ok: true;
      schemaVersion: 1;
      game: PostgameGameMetadata;
      analysis: PostgameAnalysisProjection;
    }
  | {
      ok: false;
      status: Exclude<PostgameReadStatus, "player_not_found" | "agent_not_found">;
      error: string;
    };

export type PostgameJuryBreakdownResult =
  | {
      ok: true;
      schemaVersion: 1;
      game: PostgameGameMetadata;
      jury: PostgameJuryBreakdown;
    }
  | {
      ok: false;
      status: Exclude<PostgameReadStatus, "player_not_found" | "agent_not_found">;
      error: string;
    };

export type PostgamePlayerSummaryResult =
  | {
      ok: true;
      schemaVersion: 1;
      game: PostgameGameMetadata;
      player: PostgamePlayerGameSummary;
    }
  | {
      ok: false;
      status: PostgameReadStatus;
      error: string;
    };

export type PostgameTurningPointsResult =
  | {
      ok: true;
      schemaVersion: 1;
      game: PostgameGameMetadata;
      turningPoints: PostgameTurningPoint[];
      diagnostics: PostgameAnalysisProjection["diagnostics"];
    }
  | {
      ok: false;
      status: Exclude<PostgameReadStatus, "player_not_found" | "agent_not_found">;
      error: string;
    };

export interface ListAgentGamesInput {
  agentId?: string;
  agentName?: string;
  limit?: number;
  visibleGameIds?: readonly string[] | null;
}

export type PostgameAgentGameRow = {
  gameId: string;
  slug?: string;
  status: GameStatus;
  trackType: string;
  startedAt?: string;
  endedAt?: string;
  placement: number | null;
  survivedToEnd: boolean;
  won: boolean;
  eliminatedRound: number | null;
  winnerName?: string;
  finalistNames: string[];
  juryVoteCount?: number;
  ratingDelta?: number | null;
  diagnostics: Array<{ code: string; severity: "info" | "warning" | "error"; message: string }>;
};

export type PostgameAgentGamesResult =
  | {
      ok: true;
      schemaVersion: 1;
      agent: {
        id?: string;
        name: string;
      };
      games: PostgameAgentGameRow[];
      diagnostics: Array<{ code: string; severity: "info" | "warning" | "error"; message: string }>;
    }
  | {
      ok: false;
      status: "agent_not_found";
      error: string;
    };

export type PostgameDominantVotingBloc = {
  players: Array<{ id: string; name: string }>;
  roundsControlled: number[];
  targets: Array<{ round: number; target: { id: string; name: string } | null; basis: string }>;
  confidence: "high" | "medium" | "low";
};

type GameRow = Pick<
  typeof schema.games.$inferSelect,
  "id" | "slug" | "status" | "trackType" | "startedAt" | "endedAt"
>;
type PlayerRow = Pick<
  typeof schema.gamePlayers.$inferSelect,
  "id" | "gameId" | "userId" | "agentProfileId" | "persona"
> & { agentProfileName: string | null };
type ResultRow = Pick<typeof schema.gameResults.$inferSelect, "winnerId" | "roundsPlayed">;

export async function getPostgameAnalysis(
  db: PostgameDB,
  idOrSlug: string,
  options: PostgameGameReadOptions = {},
): Promise<PostgameGameAnalysisResult> {
  const loaded = await loadPostgameAnalysis(db, idOrSlug, options);
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    schemaVersion: 1,
    game: loaded.game,
    analysis: loaded.analysis,
  };
}

export async function getPostgameJuryBreakdown(
  db: PostgameDB,
  idOrSlug: string,
  options: PostgameGameReadOptions = {},
): Promise<PostgameJuryBreakdownResult> {
  const loaded = await loadPostgameAnalysis(db, idOrSlug, options);
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    schemaVersion: 1,
    game: loaded.game,
    jury: loaded.analysis.jury,
  };
}

export async function getPostgamePlayerSummary(
  db: PostgameDB,
  idOrSlug: string,
  playerQuery: string,
  options: PostgameGameReadOptions = {},
): Promise<PostgamePlayerSummaryResult> {
  const loaded = await loadPostgameAnalysis(db, idOrSlug, options);
  if (!loaded.ok) return loaded;
  const normalized = normalize(playerQuery);
  const player = loaded.analysis.playerSummaries.find((entry) =>
    entry.player.id === playerQuery || normalize(entry.player.name) === normalized
  );
  if (!player) {
    return {
      ok: false,
      status: "player_not_found",
      error: `Player not found in postgame analysis: ${playerQuery}`,
    };
  }
  return {
    ok: true,
    schemaVersion: 1,
    game: loaded.game,
    player,
  };
}

export async function getPostgameTurningPoints(
  db: PostgameDB,
  idOrSlug: string,
  options: PostgameGameReadOptions = {},
): Promise<PostgameTurningPointsResult> {
  const loaded = await loadPostgameAnalysis(db, idOrSlug, options);
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    schemaVersion: 1,
    game: loaded.game,
    turningPoints: loaded.analysis.turningPoints,
    diagnostics: loaded.analysis.diagnostics,
  };
}

export async function listPostgameAgentGames(
  db: PostgameDB,
  input: ListAgentGamesInput,
): Promise<PostgameAgentGamesResult> {
  const limit = clamp(input.limit ?? DEFAULT_AGENT_GAME_LIMIT, 1, MAX_AGENT_GAME_LIMIT);
  const candidates = await loadAgentGameCandidates(db, input.visibleGameIds);
  const normalizedName = input.agentName ? normalize(input.agentName) : null;
  const matches = candidates
    .filter((row) => {
      if (input.agentId && row.id !== input.agentId && row.agentProfileId !== input.agentId) {
        return false;
      }
      if (normalizedName) {
        const persona = parsePersona(row.persona);
        const rowNames = [persona.name, row.agentProfileName].filter((name): name is string => Boolean(name));
        return rowNames.some((name) => normalize(name) === normalizedName);
      }
      return true;
    })
    .slice(0, limit);

  if (matches.length === 0) {
    return {
      ok: false,
      status: "agent_not_found",
      error: "No completed games were found for that agent.",
    };
  }

  const diagnostics: Array<{ code: string; severity: "info" | "warning" | "error"; message: string }> = [];
  const games: PostgameAgentGameRow[] = [];
  for (const row of matches) {
    const analysis = await getPostgameAnalysis(db, row.gameId);
    if (!analysis.ok) {
      diagnostics.push({
        code: `postgame_${analysis.status}`,
        severity: analysis.status === "unavailable" ? "warning" : "info",
        message: analysis.error,
      });
      continue;
    }
    const player = analysis.analysis.playerSummaries.find((entry) => entry.player.id === row.id);
    if (!player) continue;
    const finalVote = analysis.analysis.summary.finalVote;
    games.push({
      gameId: analysis.game.id,
      ...(analysis.game.slug && { slug: analysis.game.slug }),
      status: analysis.game.status,
      trackType: analysis.game.trackType,
      ...(analysis.game.startedAt && { startedAt: analysis.game.startedAt }),
      ...(analysis.game.endedAt && { endedAt: analysis.game.endedAt }),
      placement: player.placement,
      survivedToEnd: player.status === "winner" || player.status === "finalist",
      won: player.won,
      eliminatedRound: player.eliminatedRound,
      ...(analysis.analysis.summary.winner?.name && { winnerName: analysis.analysis.summary.winner.name }),
      finalistNames: analysis.analysis.summary.finalists.map((finalist) => finalist.name),
      ...(finalVote.status === "available" && { juryVoteCount: finalVote.totalVotes }),
      ratingDelta: null,
      diagnostics: [
        ...analysis.analysis.diagnostics,
        {
          code: "rating_delta_unavailable",
          severity: "info",
          message: "Per-game rating deltas are not persisted yet.",
        },
      ],
    });
  }

  const first = matches[0];
  const firstPersona = first ? parsePersona(first.persona) : {};
  return {
    ok: true,
    schemaVersion: 1,
    agent: {
      ...(first?.agentProfileId && { id: first.agentProfileId }),
      name: input.agentName ?? firstPersona.name ?? first?.agentProfileName ?? input.agentId ?? "Unknown Agent",
    },
    games,
    diagnostics,
  };
}

export function buildPostgameDominantVotingBlocs(analysis: PostgameAnalysisProjection): PostgameDominantVotingBloc[] {
  const blocs = new Map<string, {
    players: Array<{ id: string; name: string }>;
    roundsControlled: number[];
    targets: Array<{ round: number; target: { id: string; name: string } | null; basis: string }>;
    highConfidenceRounds: number;
  }>();

  for (const round of analysis.roundSummaries) {
    const cohort = round.majorityCohort;
    if (cohort.basis === "unavailable" || cohort.alignedPlayers.length === 0) continue;
    const players = [...cohort.alignedPlayers].sort((left, right) => left.name.localeCompare(right.name));
    const key = players.map((player) => player.id).join("|");
    const current = blocs.get(key) ?? {
      players,
      roundsControlled: [],
      targets: [],
      highConfidenceRounds: 0,
    };
    current.roundsControlled.push(round.round);
    current.targets.push({
      round: round.round,
      target: cohort.target,
      basis: cohort.basis,
    });
    if (cohort.confidence === "high") current.highConfidenceRounds += 1;
    blocs.set(key, current);
  }

  return Array.from(blocs.values())
    .sort((left, right) =>
      right.roundsControlled.length - left.roundsControlled.length ||
      right.highConfidenceRounds - left.highConfidenceRounds ||
      left.players.map((player) => player.name).join(",").localeCompare(
        right.players.map((player) => player.name).join(","),
      )
    )
    .slice(0, 5)
    .map((bloc) => ({
      players: bloc.players,
      roundsControlled: bloc.roundsControlled,
      targets: bloc.targets,
      confidence: bloc.highConfidenceRounds === bloc.roundsControlled.length
        ? "high"
        : bloc.highConfidenceRounds > 0
          ? "medium"
          : "low",
    }));
}

async function loadPostgameAnalysis(
  db: PostgameDB,
  idOrSlug: string,
  options: PostgameGameReadOptions,
): Promise<PostgameGameAnalysisResult> {
  const game = await loadGame(db, idOrSlug);
  if (!game) {
    return { ok: false, status: "not_found", error: "Game not found" };
  }
  if (game.status !== "completed") {
    return {
      ok: false,
      status: "not_completed",
      error: "Postgame analysis is only available for completed games.",
    };
  }

  const [players, terminalResult, persistedEvents] = await Promise.all([
    loadPlayers(db, game.id),
    loadTerminalResult(db, game.id),
    getPersistedGameEvents(db, game.id),
  ]);
  const persistedProjection = getPersistedGameProjection(persistedEvents);
  const playerNames = playerNameMap(players);
  const completedResults = buildCompletedGameResults({
    events: persistedEvents.events.map((event) => event.envelope),
    eventLogStatus: persistedEvents.status,
    projectionStatus: persistedProjection.status,
    terminalResult: terminalResult
      ? {
          winnerId: terminalResult.winnerId,
          winnerName: terminalResult.winnerId ? playerNames.get(terminalResult.winnerId) ?? terminalResult.winnerId : null,
          roundsPlayed: terminalResult.roundsPlayed,
        }
      : null,
  });

  if (completedResults.availability.status === "unavailable") {
    return {
      ok: false,
      status: "unavailable",
      error: "Postgame analysis is not available for this game.",
    };
  }

  const analysis = buildPostgameAnalysisProjection({
    completedResults,
    events: options.includeEvidence
      ? persistedEvents.events.map((event) => event.envelope)
      : undefined,
    includeEvidence: options.includeEvidence,
  });

  return {
    ok: true,
    schemaVersion: 1,
    game: {
      id: game.id,
      ...(game.slug && { slug: game.slug }),
      status: game.status,
      trackType: game.trackType,
      ...(game.startedAt && { startedAt: game.startedAt }),
      ...(game.endedAt && { endedAt: game.endedAt }),
      playerCount: analysis.summary.playerCount,
      roundCount: analysis.summary.roundCount,
    },
    analysis,
  };
}

async function loadGame(db: PostgameDB, idOrSlug: string): Promise<GameRow | null> {
  return (await db
    .select({
      id: schema.games.id,
      slug: schema.games.slug,
      status: schema.games.status,
      trackType: schema.games.trackType,
      startedAt: schema.games.startedAt,
      endedAt: schema.games.endedAt,
    })
    .from(schema.games)
    .where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug)))
    .limit(1))[0] ?? null;
}

async function loadPlayers(db: PostgameDB, gameId: string): Promise<Array<Pick<PlayerRow, "id" | "persona">>> {
  return db
    .select({
      id: schema.gamePlayers.id,
      persona: schema.gamePlayers.persona,
    })
    .from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.gameId, gameId));
}

async function loadTerminalResult(db: PostgameDB, gameId: string): Promise<ResultRow | null> {
  return (await db
    .select({
      winnerId: schema.gameResults.winnerId,
      roundsPlayed: schema.gameResults.roundsPlayed,
    })
    .from(schema.gameResults)
    .where(eq(schema.gameResults.gameId, gameId))
    .limit(1))[0] ?? null;
}

async function loadAgentGameCandidates(
  db: PostgameDB,
  visibleGameIds: readonly string[] | null | undefined,
): Promise<PlayerRow[]> {
  if (visibleGameIds && visibleGameIds.length === 0) return [];
  const conditions = [
    eq(schema.games.status, "completed"),
    ...(visibleGameIds ? [inArray(schema.games.id, [...visibleGameIds])] : []),
  ];
  return db
    .select({
      id: schema.gamePlayers.id,
      gameId: schema.gamePlayers.gameId,
      userId: schema.gamePlayers.userId,
      agentProfileId: schema.gamePlayers.agentProfileId,
      persona: schema.gamePlayers.persona,
      agentProfileName: schema.agentProfiles.name,
    })
    .from(schema.gamePlayers)
    .innerJoin(schema.games, eq(schema.gamePlayers.gameId, schema.games.id))
    .leftJoin(schema.agentProfiles, eq(schema.gamePlayers.agentProfileId, schema.agentProfiles.id))
    .where(and(...conditions))
    .orderBy(desc(schema.games.endedAt), desc(schema.games.createdAt));
}

function playerNameMap(players: ReadonlyArray<Pick<PlayerRow, "id" | "persona">>): Map<string, string> {
  const names = new Map<string, string>();
  for (const player of players) {
    const persona = parsePersona(player.persona);
    names.set(player.id, persona.name ?? player.id);
  }
  return names;
}

function parsePersona(value: string): { name?: string } {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (isRecord(parsed) && typeof parsed.name === "string") return { name: parsed.name };
  } catch {
    // Fall through to unknown identity.
  }
  return {};
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(Math.floor(value), max));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
