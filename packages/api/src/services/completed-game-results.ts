import { eq, or } from "drizzle-orm";
import {
  buildCompletedGameResults,
  resolveGameKernel,
  replayCanonicalEvents, retrospectiveProgress, Phase,
  type RetrospectiveProgress,
  type CompletedGameResultsRead,
  type GameKernel,
  type GameKernelContradictionDiagnostic,
  type GameKernelSource,
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
      schemaVersion: 3;
      game: {
        id: string;
        slug: string;
        status: GameStatus;
        completedAt?: string;
        gameKernel: GameKernel;
        gameKernelSource: GameKernelSource;
        gameKernelDiagnostics: GameKernelContradictionDiagnostic[];
      };
      results: CompletedGameResultsRead;
      retrospective: RetrospectiveProgress;
    }
  | {
      ok: false;
      status: CompletedGameResultsReadStatus;
      error: string;
    };

type GameRow = Pick<typeof schema.games.$inferSelect, "id" | "slug" | "status" | "endedAt" | "gameKernel">;

export async function getCompletedGameResults(
  db: CompletedResultsDB,
  idOrSlug: string,
): Promise<CompletedGameResultsServiceResult> {
  const game = await loadGame(db, idOrSlug);
  if (!game) {
    return { ok: false, status: "not_found", error: "Game not found" };
  }
  const persistedEvents = await getPersistedGameEvents(db, game.id);
  const projection = getPersistedGameProjection(persistedEvents);
  if (persistedEvents.status === "invalid" || projection.status === "failed") return { ok: false, status: "unavailable", error: "Canonical results failed validation." };
  const events = persistedEvents.events.map((event) => event.envelope);
  const canonical = events.length ? replayCanonicalEvents(events) : null;
  if (!canonical?.retrospectiveOutcomeSource) return { ok: false, status: game.status === "completed" ? "unavailable" : "not_completed", error: "Results are available after the canonical outcome is recorded." };
  const retrospective = retrospectiveProgress(canonical.retrospectiveOutcomeSource, canonical.retrospective, canonical.playerOrder.length);
  if (game.status === "completed" && (retrospective.status !== "completed" || canonical.phase !== Phase.END)) return { ok: false, status: "unavailable", error: "Completed execution has no retrospective completion proof." };
  const kernel = resolveGameKernel({ stored: game.gameKernel, events });
  const results = buildCompletedGameResults({
    events,
    eventLogStatus: persistedEvents.status,
    projectionStatus: projection.status,
    gameKernel: kernel.kernel,
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
    schemaVersion: 3,
    game: {
      id: game.id,
      slug: game.slug,
      status: game.status,
      ...(game.endedAt && { completedAt: game.endedAt }),
      gameKernel: kernel.kernel,
      gameKernelSource: kernel.source,
      gameKernelDiagnostics: kernel.diagnostics,
    },
    results,
    retrospective,
  };
}

async function loadGame(db: CompletedResultsDB, idOrSlug: string): Promise<GameRow | null> {
  return (await db
    .select({
      id: schema.games.id,
      slug: schema.games.slug,
      status: schema.games.status,
      endedAt: schema.games.endedAt,
      gameKernel: schema.games.gameKernel,
    })
    .from(schema.games)
    .where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug)))
    .limit(1))[0] ?? null;
}
