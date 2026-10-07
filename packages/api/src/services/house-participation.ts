import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { HouseParticipation, ParticipationFilter } from "@influence/engine/house-participation";
import { schema, type DrizzleDB } from "../db/index.js";
import { isViewerGame, publicGameFilter } from "./game-visibility.js";
import { readHouseGameResultsInTransaction } from "./house-game-results.js";
import { readEpisodePresentations } from "./episode-presentation.js";

type Game = typeof schema.games.$inferSelect;
type Candidate = { game: Game; playerId: string; agentProfileId: string | null; agentName: string; totalPlayers: number };

/** Visibility and ownership precede limits. No scoring or completion side effects. */
interface ParticipationOptions {
  publicOnly?: boolean;
  gameKind?: ParticipationFilter;
  limit?: number;
}

export async function readHouseParticipation(db: DrizzleDB, ownerId: string, options: ParticipationOptions = {}): Promise<HouseParticipation[]> {
  return db.transaction(tx => readParticipationSnapshot(tx, ownerId, options), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

async function readParticipationSnapshot(db: Pick<DrizzleDB, "select" | "selectDistinctOn">, ownerId: string, options: ParticipationOptions): Promise<HouseParticipation[]> {
  const filter = options.gameKind ?? "all";
  const visible = options.publicOnly ? publicGameFilter() : isNull(schema.games.hiddenAt);
  const completed = and(eq(schema.games.status, "completed"), isNotNull(schema.games.endedAt), visible);
  const candidates: Candidate[] = [];
  if (filter !== "werewolf") {
    const query = db.select({ game: schema.games, player: schema.gamePlayers,
      totalPlayers: sql<number>`(SELECT count(*)::int FROM game_players seats WHERE seats.game_id = ${schema.games.id})`,
    }).from(schema.gamePlayers).innerJoin(schema.games, eq(schema.games.id, schema.gamePlayers.gameId))
      .where(and(completed, eq(schema.games.gameKind, "influence"), eq(schema.gamePlayers.userId, ownerId)))
      .orderBy(desc(schema.games.endedAt), desc(schema.games.id), desc(schema.gamePlayers.id));
    const rows = await (options.limit === undefined ? query : query.limit(options.limit));
    for (const { game, player, totalPlayers } of rows) {
      if (!isViewerGame(game)) continue;
      const persona: unknown = JSON.parse(player.persona);
      const name = persona && typeof persona === "object" && "name" in persona && typeof persona.name === "string" ? persona.name : "Unknown agent";
      candidates.push({ game, playerId: player.id, agentProfileId: player.agentProfileId, agentName: name, totalPlayers });
    }
  }
  if (filter !== "influence") {
    // Query only openings with an owned profile; direct-created games need no lobby seats.
    const query = db.select({ game: schema.games, event: schema.werewolfEvents.event })
      .from(schema.games).innerJoin(schema.werewolfEvents, and(eq(schema.games.id, schema.werewolfEvents.gameId), eq(schema.werewolfEvents.sequence, 1)))
      .where(and(completed, eq(schema.games.gameKind, "werewolf"), sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(${schema.werewolfEvents.event}->'payload'->'players') p
        JOIN agent_profiles a ON a.id = p->>'agentProfileId' WHERE a.user_id = ${ownerId}
      )`)).orderBy(desc(schema.games.endedAt), desc(schema.games.id));
    const rows = await (options.limit === undefined ? query : query.limit(options.limit));
    if (rows.length) {
      const owned = new Set((await db.select({ id: schema.agentProfiles.id }).from(schema.agentProfiles)
        .where(eq(schema.agentProfiles.userId, ownerId))).map(p => p.id));
      for (const { game, event } of rows) {
        if (!isViewerGame(game) || event.type !== "werewolf.started" || event.gameId !== game.id || event.sequence !== 1) continue;
        for (const player of event.payload.players) if (player.agentProfileId && owned.has(player.agentProfileId)) {
          candidates.push({ game, playerId: player.id, agentProfileId: player.agentProfileId, agentName: player.name, totalPlayers: event.payload.players.length });
        }
      }
    }
  }
  candidates.sort((a,b) => b.game.endedAt!.localeCompare(a.game.endedAt!) || b.game.id.localeCompare(a.game.id) || b.playerId.localeCompare(a.playerId));
  const selected = options.limit ? candidates.slice(0, options.limit) : candidates;
  const games = [...new Map(selected.map(row => [row.game.id, row.game])).values()];
  if (!games.length) return [];
  const [episodes, receipts] = await Promise.all([
    readEpisodePresentations(db, games),
    db.select().from(schema.competitionReceipts).where(and(inArray(schema.competitionReceipts.gameId, games.map(g => g.id)),
      eq(schema.competitionReceipts.ownerId, ownerId), eq(schema.competitionReceipts.eligibilityStatus, "eligible"))),
  ]);
  // One canonical read per selected game, not per owned seat. Public reads project at most five games.
  const outcomes = new Map<string, Awaited<ReturnType<typeof readHouseGameResultsInTransaction>>>();
  for (const game of games) outcomes.set(game.id, await readHouseGameResultsInTransaction(db, game.id));
  const points = new Map(receipts.map(r => [`${r.gameId}:${r.agentProfileId}`, r.totalPoints]));
  return selected.map(({ game, playerId, agentProfileId, agentName, totalPlayers }): HouseParticipation => {
    const identity = { gameId: game.id, gameSlug: game.slug, gameTitle: episodes.get(game.id)?.title ?? game.slug,
      playerId, agentProfileId, agentName, totalPlayers, completedAt: game.endedAt! };
    const read = outcomes.get(game.id)!;
    if (game.gameKind === "werewolf") {
      const result = read.ok && read.gameKind === "werewolf" ? read.results : null;
      const player = result?.players.find(p => p.id === playerId);
      return { ...identity, gameKind: "werewolf", result: result && player ? {
        outcome: result.outcome.faction === null ? "draw" : player.won ? "win" : "loss",
        faction: player.faction, alive: player.alive, eliminationDay: player.elimination?.day ?? null, days: result.day,
      } : null };
    }
    const result = read.ok && read.gameKind === "influence" ? read.results : null;
    const player = result?.players.find(p => p.id === playerId);
    return { ...identity, gameKind: "influence", result: result ? {
      outcome: result.summary.winner ? result.summary.winner.id === playerId ? "win" : "loss" : "unknown",
      placement: player?.placement ?? null,
      eliminated: player && player.status !== "unknown" ? player.status === "eliminated" : null,
      rounds: result.summary.roundsPlayed, totalPoints: points.get(`${game.id}:${agentProfileId}`) ?? null,
    } : null };
  });
}
