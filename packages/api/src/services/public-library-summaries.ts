import { LEGACY_FORMAT_MANIFEST, resolveFormatManifest } from "@influence/engine";
import { resolveEmpowerRevoteVersion } from "@influence/engine/empower-revote-rules";
import { count, inArray } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import type { GameCompletionSettlementState, GameStatus } from "../db/schema.js";
import { modelLabelFromConfig } from "../lib/model-label.js";
import { getGameSeasonIdentityMap } from "../lib/game-season.js";
import { getGameCompletionSettlementStateMap } from "./game-completion-settlement.js";
import { getRedactedKernelHealthByGameId, type RedactedKernelHealth } from "./game-kernel-health.js";
import { buildFallbackGameWatchStateSummary, getGameWatchStateSummaryReadsByGameIds } from "./game-watch-state-summary.js";
import { readEpisodePresentations } from "./episode-presentation.js";

const PUBLIC_SUSPENDED_ERROR_INFO = "Execution is paused. Committed play remains available.";

export function publicErrorInfo(
  status: GameStatus,
  config: Record<string, unknown>,
  settlementState?: GameCompletionSettlementState | "not_applicable",
): string | undefined {
  if (status === "suspended") {
    if (config.visualPause) return "Visual preparation is paused for repair.";
    if (settlementState === "pending") return "Finalizing results.";
    if (settlementState === "repair_required") return "Results under review.";
    return PUBLIC_SUSPENDED_ERROR_INFO;
  }
  return typeof config.errorInfo === "string" ? config.errorInfo : undefined;
}

/** Enrich only the already-selected Influence rows; selection and visibility are caller responsibilities. */
export async function readPublicInfluenceSummaries(db: Pick<DrizzleDB, "select" | "selectDistinctOn">, rows: Array<typeof schema.games.$inferSelect>, options: { includeEpisodeNumbers: boolean; includeKernelHealth?: boolean }) {
  const episodes = await readEpisodePresentations(db, rows, { includeEpisodeNumbers: options.includeEpisodeNumbers });
  const gameIds = rows.map((game) => game.id);
  const [kernelHealthByGameId, watchSummaryReadsByGameId, seasonById, settlementStateByGameId] = await Promise.all([
    options.includeKernelHealth === false ? Promise.resolve(new Map<string, RedactedKernelHealth>()) : getRedactedKernelHealthByGameId(db, gameIds),
    getGameWatchStateSummaryReadsByGameIds(db, gameIds),
    getGameSeasonIdentityMap(db, rows.map((game) => game.seasonId)),
    getGameCompletionSettlementStateMap(db, gameIds),
  ]);

  const summaries = rows.flatMap((game) => {
    try {
      const config = JSON.parse(game.config);
      const formatManifest = resolveFormatManifest(
        config.formatManifest ?? LEGACY_FORMAT_MANIFEST,
      );
      const summaryRead = watchSummaryReadsByGameId.get(game.id) ?? { status: "missing" as const };
      const watchState = summaryRead.status === "current"
        ? summaryRead.summary
        : buildFallbackGameWatchStateSummary(game, config);

      return [{
        id: game.id,
        slug: game.slug,
        episode: episodes.get(game.id),
        status: game.status,
        playerCount: game.maxPlayers ?? config.maxPlayers ?? watchState.counts.totalPlayers,
        currentRound: watchState.currentRound,
        maxRounds: config.maxRounds ?? 10,
        currentPhase: watchState.currentPhase,
        phaseTimeRemaining: null,
        alivePlayers: watchState.counts.alivePlayers,
        eliminatedPlayers: watchState.counts.eliminatedPlayers,
        modelLabel: modelLabelFromConfig(config),
        visibility: config.visibility ?? "public",
        audioMode: config.audioMode === true,
        visualMode: config.visualMode === true,
        visualFailurePolicy: config.visualFailurePolicy === "require_visuals" ? "require_visuals" : "best_effort",
        visualPaused: game.status === "suspended" && Boolean(config.visualPause),
        formatManifest,
        empowerRevoteVersion: resolveEmpowerRevoteVersion(config.empowerRevoteVersion),
        gameSchemaVersion: config.gameSchemaVersion ?? 1,
        trackType: game.trackType,
        seasonId: game.seasonId ?? undefined,
        season: game.seasonId ? seasonById.get(game.seasonId) : undefined,
        rated: Boolean(game.seasonId),
        winner: watchState.winner?.name,
        errorInfo: publicErrorInfo(game.status, config, settlementStateByGameId.get(game.id)),
        kernelHealth: kernelHealthByGameId.get(game.id),
        watchState,
        watchStateSummaryStatus: summaryRead.status,
        createdAt: game.createdAt,
        startedAt: game.startedAt ?? undefined,
        completedAt: game.endedAt ?? undefined,
      }];
    } catch (error) {
      console.warn(
        `[games] Skipping corrupt list row for game ${game.id}:`,
        error instanceof Error ? error.message : error,
      );
      return [];
    }
  });

  return summaries;
}

type WerewolfSummaryRow = Pick<typeof schema.games.$inferSelect, "id" | "slug" | "status" | "gameKind" | "seasonId" | "config" | "createdAt"> & { playerCount: number };

/** Enrich only selected Werewolf rows; selection and visibility are caller responsibilities. */
export async function readPublicWerewolfSummaries(db: Pick<DrizzleDB, "select" | "selectDistinctOn">, rows: WerewolfSummaryRow[], options: { includeEpisodeNumbers: boolean }) {
  const seats = rows.length ? await db.select({ gameId: schema.werewolfLobbySeats.gameId, total: count() }).from(schema.werewolfLobbySeats)
    .where(inArray(schema.werewolfLobbySeats.gameId, rows.map(game => game.id))).groupBy(schema.werewolfLobbySeats.gameId) : [];
  const joined = new Map(seats.map(row => [row.gameId, row.total]));
  const episodes = await readEpisodePresentations(db, rows, { includeEpisodeNumbers: options.includeEpisodeNumbers });
  return rows.flatMap(({ config, ...game }) => {
    try {
      return [{ ...game, episode: episodes.get(game.id), gameKind: "werewolf" as const, joinedPlayers: game.status === "waiting" ? joined.get(game.id) ?? 0 : game.playerCount, modelLabel: modelLabelFromConfig(JSON.parse(config)) }];
    } catch {
      console.warn(`[werewolf] Skipping corrupt list row for game ${game.id}: invalid model configuration`);
      return [];
    }
  });
}
