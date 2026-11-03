import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { CHAMPIONSHIP_POLICY_VERSION, compareChampionshipScores } from "@influence/engine/championship";
import { replayWerewolf } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { championshipGameRoster } from "./championship-game-roster.js";
import { readWerewolfEvents } from "./werewolf-games.js";

export async function settleChampionshipMatch(db: DrizzleDB, matchId: string) {
  return db.transaction(async tx => {
    const [match] = await tx.select().from(schema.championshipMatches).where(eq(schema.championshipMatches.id, matchId)).for("update");
    if (!match?.gameId || match.status === "completed") return false;
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, match.gameId));
    if (game?.status !== "completed") return false;
    const [event] = await tx.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, match.eventId));
    if (!event?.policies.points) return false;
    const roster = (await championshipGameRoster(tx, game.id))!;
    let winners: string[], draw: boolean, canonicalSequence: number | null = null;
    if (match.gameKind === "werewolf") {
      const state = replayWerewolf(await readWerewolfEvents(tx, game.id));
      if (!state.outcome) throw new Error("Completed championship match lacks a canonical outcome");
      winners = state.outcome.winnerIds; draw = state.outcome.faction === null; canonicalSequence = state.sequence;
      if (state.players.length !== 8 || state.players.some(player => !roster.cast.some(item => item.seatId === player.id))) throw new Error("Canonical championship cast mismatch");
    } else {
      const [result] = await tx.select().from(schema.gameResults).where(eq(schema.gameResults.gameId, game.id));
      if (!result) return false; // Completion settlement is still committing; retry the same match.
      winners = result.winnerId ? [result.winnerId] : []; draw = result.winnerId === null;
    }
    if (winners.some(id => !roster.cast.some(item => item.seatId === id))) throw new Error("Canonical winner is outside the championship field");
    await tx.insert(schema.championshipResults).values(roster.cast.map(({ entry, seatId }) => {
      const outcome = draw ? "draw" as const : winners.includes(seatId) ? "win" as const : "loss" as const;
      return { matchId, entryId: entry.id, outcome, points: event.policies.points![outcome], policyVersion: CHAMPIONSHIP_POLICY_VERSION, canonicalSequence };
    }));
    await tx.update(schema.championshipMatches).set({ status: "completed" }).where(eq(schema.championshipMatches.id, matchId));
    return true;
  });
}

export async function championshipStandings(db: Pick<DrizzleDB, "select">, eventId: string) {
  const [event] = await db.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, eventId));
  if (!event) return null;
  const entries = await db.select().from(schema.championshipEntries).where(eq(schema.championshipEntries.eventId, eventId));
  const results = await db.select({ entryId: schema.championshipResults.entryId, points: schema.championshipResults.points, outcome: schema.championshipResults.outcome,
    kind: schema.championshipMatches.gameKind }).from(schema.championshipResults).innerJoin(schema.championshipMatches, eq(schema.championshipMatches.id, schema.championshipResults.matchId))
    .where(eq(schema.championshipMatches.eventId, eventId));
  const matches = await db.select().from(schema.championshipMatches).where(eq(schema.championshipMatches.eventId, eventId)).orderBy(asc(schema.championshipMatches.ordinal));
  const series = entries.map(entry => {
    const rows = results.filter(row => row.entryId === entry.id && row.kind === "werewolf");
    return { agentId: entry.agentId, ownerId: entry.ownerId, name: entry.name, rank: entry.qualificationRank, seasonPoints: entry.seasonPoints,
      points: rows.reduce((sum, row) => sum + row.points, 0), played: rows.length, wins: rows.filter(row => row.outcome === "win").length };
  });
  // An undecided equal-score rule remains visible rather than preventing match settlement.
  series.sort((a, b) => compareChampionshipScores(a, b, event.policies.equalScoreFallback ?? "shared_place"));
  const tied = (a: typeof series[number], b: typeof series[number]) => compareChampionshipScores(a, b, event.policies.equalScoreFallback ?? "shared_place") === 0;
  const werewolfComplete = matches.filter(match => match.gameKind === "werewolf" && match.status === "completed").length === 16;
  const werewolfWinners = werewolfComplete && series[0] ? series.filter(row => tied(row, series[0]!)).map(row => row.agentId) : [];
  const influenceWinners = results.filter(row => row.kind === "influence" && row.outcome === "win").map(row => entries.find(entry => entry.id === row.entryId)!.agentId);
  const influenceComplete = matches.some(match => match.ordinal === 17 && match.status === "completed");
  return { series, werewolfWinners, influenceWinners, werewolfComplete, influenceComplete,
    resolutionPending: (werewolfWinners.length > 1 && event.policies.equalScoreFallback === null) || (influenceComplete && influenceWinners.length === 0) };
}

export async function reconcileChampionshipResults(db: DrizzleDB, eventId: string) {
  const matches = await db.select().from(schema.championshipMatches).where(eq(schema.championshipMatches.eventId, eventId));
  for (const match of matches) await settleChampionshipMatch(db, match.id);
  const standings = await championshipStandings(db, eventId);
  if (standings?.werewolfComplete && standings.influenceComplete && !standings.resolutionPending) {
    await db.transaction(async tx => {
      const [event] = await tx.update(schema.championshipEvents).set({ status: "final" }).where(and(eq(schema.championshipEvents.id, eventId), eq(schema.championshipEvents.status, "running"))).returning();
      if (event) await tx.insert(schema.competitionAudit).values({ id: randomUUID(), eventId, actorId: event.createdById,
        requestId: `event-final:${eventId}`, action: "event_finalized", reason: "All 17 canonical results settled under the frozen policy" });
    });
  }
  return standings;
}
