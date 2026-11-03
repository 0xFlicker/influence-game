import { and, asc, eq } from "drizzle-orm";
import type { GameModelRouting } from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";
import { readJson } from "./payload-storage.js";
type Tx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

/** Membership, rather than a client-controlled configuration flag, selects frozen admission. */
export async function championshipGameRoster(tx: Pick<DrizzleDB, "select">, gameId: string) {
  const [attempt] = await tx.select().from(schema.championshipMatchAttempts).where(eq(schema.championshipMatchAttempts.gameId, gameId));
  const [match] = await tx.select().from(schema.championshipMatches).where(attempt ? eq(schema.championshipMatches.id, attempt.matchId) : eq(schema.championshipMatches.gameId, gameId));
  if (!match) return null;
  const [event] = await tx.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, match.eventId));
  if (!event?.execution) throw new Error("Competition execution recipe is missing");
  const execution = await readJson(event.execution);
  if (execution.version !== 1) throw new Error("Unsupported competition execution recipe");
  const entries = await tx.select().from(schema.championshipEntries).where(eq(schema.championshipEntries.eventId, match.eventId)).orderBy(asc(schema.championshipEntries.qualificationRank));
  if (entries.length !== 8) throw new Error("Championship field is incomplete");
  const cast = await Promise.all(entries.map(async entry => {
    const build = await readJson(entry.build);
    if (build.version !== 1 || build.competitionRevisionId !== entry.id || build.agentId !== entry.agentId || build.ownerId !== entry.ownerId) throw new Error("Championship build identity mismatch");
    return { entry, build, seatId: `${attempt?.seatPrefix ?? match.id}:${entry.id}` };
  }));
  const base = structuredClone(cast[0]!.build.modelRouting);
  if (!base.frozenRoutes) throw new Error("Competition routing was not frozen");
  const modelRouting: GameModelRouting = { ...base, overrides: {}, contestants: {}, frozenRoutes: { ...base.frozenRoutes, contestants: {} } };
  for (const { entry, build, seatId } of cast) {
    const route = build.modelRouting.frozenRoutes?.contestants[entry.id];
    if (!route) throw new Error("Competition contestant route is missing");
    modelRouting.contestants![seatId] = build.contestantManifest;
    modelRouting.frozenRoutes!.contestants[seatId] = route;
  }
  return { match, cast, modelRouting, execution };
}

/** Reconstruct every execution input from the competition snapshot at the atomic start boundary. */
export async function freezeChampionshipInfluenceRoster(tx: Tx, gameId: string) {
  const roster = await championshipGameRoster(tx, gameId);
  if (!roster) return null;
  const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, gameId));
  if (!game || game.seasonId || game.gameKind !== "influence" || game.minPlayers !== 8 || game.maxPlayers !== 8) throw new Error("Invalid championship game binding");
  const seats = await tx.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, gameId));
  if (seats.some(seat => !roster.cast.some(item => item.seatId === seat.id))) throw new Error("Unexpected championship seat");
  for (const { entry, build, seatId } of roster.cast) {
    const c = build.character;
    if (!entry.sourceRevisionId) throw new Error("Competition revision evidence is missing");
    const values = { id: seatId, gameId, userId: entry.ownerId, agentProfileId: entry.agentId, agentRevisionId: entry.sourceRevisionId,
      persona: JSON.stringify({ name: c.name, gender: c.gender, personality: c.personality, backstory: c.backstory, strategyHints: c.strategyStyle ?? "", personaKey: c.personaKey, avatarUrl: c.avatarUrl, fullBodyReferenceUrl: c.fullBodyReferenceUrl, contentRevisionId: c.contentRevisionId, headPosition: c.headPosition, portraitCrop: c.portraitCrop, performanceInstructions: c.performanceInstructions, competitionRevisionId: entry.id }),
      agentConfig: JSON.stringify({ temperature: 0.9 }), modelPreference: "default" as const };
    await tx.insert(schema.gamePlayers).values(values).onConflictDoUpdate({ target: schema.gamePlayers.id, set: values,
      setWhere: and(eq(schema.gamePlayers.id, seatId), eq(schema.gamePlayers.gameId, gameId)) });
  }
  return { game, seats: await tx.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, gameId)), competitionSnapshotCount: 0 };
}
