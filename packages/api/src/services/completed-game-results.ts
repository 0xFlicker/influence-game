import { eq, or } from "drizzle-orm";
import {
  buildCompletedGameResults,
  type CompletedGameResultsRead,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { GameStatus } from "../db/schema.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import { getPersistedGameProjection } from "./game-projection-read-model.js";

type CompletedResultsDB = Pick<DrizzleDB, "select">;

export type CompletedGameResultsReadStatus =
  | "not_found"
  | "not_completed"
  | "unavailable";

export type CompletedGameResultsServiceResult =
  | {
      ok: true;
      schemaVersion: 1;
      game: {
        id: string;
        slug: string;
        status: GameStatus;
        completedAt?: string;
      };
      results: CompletedGameResultsRead;
    }
  | {
      ok: false;
      status: CompletedGameResultsReadStatus;
      error: string;
    };

type GameRow = Pick<typeof schema.games.$inferSelect, "id" | "slug" | "status" | "endedAt">;
type PlayerRow = Pick<typeof schema.gamePlayers.$inferSelect, "id" | "persona">;
type ResultRow = Pick<typeof schema.gameResults.$inferSelect, "winnerId" | "roundsPlayed">;

export async function getCompletedGameResults(
  db: CompletedResultsDB,
  idOrSlug: string,
): Promise<CompletedGameResultsServiceResult> {
  const game = await loadGame(db, idOrSlug);
  if (!game) {
    return { ok: false, status: "not_found", error: "Game not found" };
  }
  if (game.status !== "completed") {
    return {
      ok: false,
      status: "not_completed",
      error: "Completed results are only available for completed games.",
    };
  }

  const [players, terminalResult, persistedEvents] = await Promise.all([
    loadPlayers(db, game.id),
    loadTerminalResult(db, game.id),
    getPersistedGameEvents(db, game.id),
  ]);
  const projection = getPersistedGameProjection(persistedEvents);
  const playerNames = playerNameMap(players);
  const results = buildCompletedGameResults({
    events: persistedEvents.events.map((event) => event.envelope),
    eventLogStatus: persistedEvents.status,
    projectionStatus: projection.status,
    terminalResult: terminalResult
      ? {
          winnerId: terminalResult.winnerId,
          winnerName: terminalResult.winnerId ? playerNames.get(terminalResult.winnerId) ?? terminalResult.winnerId : null,
          roundsPlayed: terminalResult.roundsPlayed,
        }
      : null,
  });

  if (results.availability.status === "unavailable") {
    return {
      ok: false,
      status: "unavailable",
      error: "Completed results are not available for this game.",
    };
  }

  return {
    ok: true,
    schemaVersion: 1,
    game: {
      id: game.id,
      slug: game.slug,
      status: game.status,
      ...(game.endedAt && { completedAt: game.endedAt }),
    },
    results,
  };
}

async function loadGame(db: CompletedResultsDB, idOrSlug: string): Promise<GameRow | null> {
  return (await db
    .select({
      id: schema.games.id,
      slug: schema.games.slug,
      status: schema.games.status,
      endedAt: schema.games.endedAt,
    })
    .from(schema.games)
    .where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug)))
    .limit(1))[0] ?? null;
}

async function loadPlayers(db: CompletedResultsDB, gameId: string): Promise<PlayerRow[]> {
  return db
    .select({
      id: schema.gamePlayers.id,
      persona: schema.gamePlayers.persona,
    })
    .from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.gameId, gameId));
}

async function loadTerminalResult(db: CompletedResultsDB, gameId: string): Promise<ResultRow | null> {
  return (await db
    .select({
      winnerId: schema.gameResults.winnerId,
      roundsPlayed: schema.gameResults.roundsPlayed,
    })
    .from(schema.gameResults)
    .where(eq(schema.gameResults.gameId, gameId))
    .limit(1))[0] ?? null;
}

function playerNameMap(players: readonly PlayerRow[]): Map<string, string> {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
