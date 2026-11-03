import { randomUUID, createHash } from "node:crypto";
import { and, asc, eq, lte } from "drizzle-orm";
import { assignWerewolfRoles, startWerewolf, resolveWerewolfStrategy, type WerewolfPlayer } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { readJson } from "./payload-storage.js";
import { ChampionshipError } from "./championships.js";
import { championshipGameRoster, freezeChampionshipInfluenceRoster } from "./championship-game-roster.js";
import { checkGameStartAdmissionInTransaction } from "./deployment-admission.js";
import { requestGameStart } from "./game-ownership.js";
import { currentCaptureVersionFields, initialGameTranscriptStateValues } from "./transcript-capture.js";
import { queueEpisodeCopy } from "./episode-presentation.js";

export async function activateChampionship(db: DrizzleDB, eventId: string, actorId: string, requestId: string) {
  if (!requestId.trim()) throw new ChampionshipError("Idempotency key required");
  return db.transaction(async tx => {
    const [event] = await tx.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, eventId)).for("update");
    const [prior] = await tx.select().from(schema.competitionAudit).where(and(eq(schema.competitionAudit.actorId, actorId), eq(schema.competitionAudit.requestId, requestId)));
    if (prior) {
      if (prior.eventId !== eventId || prior.action !== "event_activated") throw new ChampionshipError("Idempotency key already belongs to another operation", 409);
      return { status: event!.status };
    }
    if (!event || !event.execution || !event.roleSchedule) throw new ChampionshipError("Lock the complete event before activation", 409);
    if (event.status === "running") {
      await tx.insert(schema.competitionAudit).values({ id: randomUUID(), eventId, actorId, requestId, action: "event_activated", reason: "Explicit producer activation; already active" });
      return { status: event.status };
    }
    if (event.status !== "locked" && event.status !== "paused") throw new ChampionshipError("Event cannot be activated", 409);
    await tx.update(schema.championshipEvents).set({ status: "running" }).where(eq(schema.championshipEvents.id, eventId));
    await tx.insert(schema.competitionAudit).values({ id: randomUUID(), eventId, actorId, requestId, action: "event_activated", reason: "Explicit producer activation" });
    return { status: "running" as const };
  });
}

export async function pauseChampionship(db: DrizzleDB, eventId: string, actorId: string, requestId: string) {
  if (!requestId.trim()) throw new ChampionshipError("Idempotency key required");
  return db.transaction(async tx => {
    const [event] = await tx.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, eventId)).for("update");
    const [prior] = await tx.select().from(schema.competitionAudit).where(and(eq(schema.competitionAudit.actorId, actorId), eq(schema.competitionAudit.requestId, requestId)));
    if (prior) {
      if (prior.eventId !== eventId || prior.action !== "event_paused") throw new ChampionshipError("Idempotency key already belongs to another operation", 409);
      return { status: event!.status };
    }
    if (event?.status === "paused") {
      await tx.insert(schema.competitionAudit).values({ id: randomUUID(), eventId, actorId, requestId, action: "event_paused", reason: "Explicit producer pause; already paused" });
      return { status: "paused" as const };
    }
    if (event?.status !== "running") throw new ChampionshipError("Only an active event can be paused", 409);
    await tx.update(schema.championshipEvents).set({ status: "paused" }).where(eq(schema.championshipEvents.id, eventId));
    await tx.insert(schema.competitionAudit).values({ id: randomUUID(), eventId, actorId, requestId, action: "event_paused", reason: "Explicit producer pause of future starts; accepted games continue" });
    return { status: "paused" as const };
  });
}

/** Exact event/match identity, transaction-serialized creation, and normal durable worker adoption. */
export async function dispatchChampionshipMatch(db: DrizzleDB, eventId: string, ordinal: number, now = new Date().toISOString()) {
  const prepared = await db.transaction(async tx => {
    const [event] = await tx.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, eventId)).for("update");
    if (!event || event.status !== "running") throw new ChampionshipError("Event is not active", 409);
    const [match] = await tx.select().from(schema.championshipMatches).where(and(eq(schema.championshipMatches.eventId, eventId), eq(schema.championshipMatches.ordinal, ordinal))).for("update");
    if (!match) throw new ChampionshipError("Match not found", 404);
    if (Date.parse(match.scheduledAt) > Date.parse(now)) return { deferred: true as const, gameId: null };
    if (match.gameId) return { deferred: false as const, gameId: match.gameId };
    const admission = await checkGameStartAdmissionInTransaction(tx);
    if (!admission.ok) throw new ChampionshipError(admission.error, 409);
    if (!event.execution || !event.roleSchedule) throw new Error("Locked event lacks execution evidence");
    const recipe = await readJson(event.execution);
    if (recipe.version !== 1) throw new Error("Unknown championship execution version");
    const gameId = randomUUID();
    await tx.insert(schema.games).values({ id: gameId, slug: `championship-${match.id}`, gameKind: match.gameKind, seasonId: null, trackType: "custom",
      status: "waiting", minPlayers: 8, maxPlayers: 8, createdById: event.createdById, config: "{}", ...currentCaptureVersionFields() });
    await tx.update(schema.championshipMatches).set({ gameId }).where(eq(schema.championshipMatches.id, match.id));
    const roster = (await championshipGameRoster(tx, gameId))!;
    if (match.gameKind === "influence") {
      await tx.update(schema.games).set({ config: JSON.stringify({ ...recipe.influence, modelRouting: roster.modelRouting }) }).where(eq(schema.games.id, gameId));
      await tx.insert(schema.gameTranscriptStates).values(initialGameTranscriptStateValues(gameId));
      await freezeChampionshipInfluenceRoster(tx, gameId);
    } else {
      const players: WerewolfPlayer[] = roster.cast.map(({ seatId, entry, build }) => ({ id: seatId, agentProfileId: entry.agentId,
        name: build.character.name, personality: build.character.personality, gender: build.character.gender, personaKey: build.character.personaKey, contentRevisionId: build.character.contentRevisionId, avatarUrl: build.character.avatarUrl, fullBodyReferenceUrl: build.character.fullBodyReferenceUrl, backstory: build.character.backstory ?? "", strategy: resolveWerewolfStrategy(build.character.werewolfStrategyStyle, build.character.personaKey) }));
      const schedule = await readJson(event.roleSchedule);
      const lineup = schedule.matches[ordinal - 1];
      if (!lineup) throw new Error("Missing scheduled role lineup");
      // Find a private seed accepted by the existing canonical reducer. This preserves v7–v11 replay semantics.
      const expected = roster.cast.map(({ entry }) => lineup.roles[entry.agentId]);
      const sample = Object.values(assignWerewolfRoles(players, recipe.werewolf, "validate-lineup"));
      if (Object.keys(lineup.roles).length !== 8 || JSON.stringify([...expected].sort()) !== JSON.stringify(sample.sort())) throw new Error("Scheduled roles do not match the frozen rules");
      let seed = "";
      for (let attempt = 0; ; attempt++) {
        seed = createHash("sha256").update(`${schedule.seed}:${match.id}:${attempt}`).digest("hex");
        const roles = assignWerewolfRoles(players, recipe.werewolf, seed);
        if (roster.cast.every(({ seatId, entry }) => roles[seatId] === lineup.roles[entry.agentId])) break;
      }
      const initial = startWerewolf(gameId, players, recipe.werewolf, seed);
      await tx.insert(schema.werewolfLobbySeats).values(roster.cast.map(({ seatId, entry }) => ({ id: seatId, gameId, agentProfileId: entry.agentId })));
      await tx.insert(schema.werewolfEvents).values({ gameId, sequence: 1, event: initial });
      await tx.update(schema.games).set({ status: "in_progress", startedAt: now, config: JSON.stringify({ ...recipe.werewolf,
        modelRouting: roster.modelRouting, serviceTier: "flex", visibility: "public", audioMode: false, visualMode: false, visualFailurePolicy: "best_effort" }) }).where(eq(schema.games.id, gameId));
      await queueEpisodeCopy(tx, gameId);
      await tx.update(schema.championshipMatches).set({ status: "running" }).where(eq(schema.championshipMatches.id, match.id));
    }
    return { deferred: false as const, gameId };
  });
  if (!prepared.gameId) return prepared;
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, prepared.gameId));
  if (game?.status === "cancelled") throw new ChampionshipError("The exact championship game was cancelled; explicit producer recovery is required", 409);
  if (game?.gameKind === "influence" && game.status === "waiting") {
    const started = await requestGameStart(db, game.id);
    if (!started.ok) {
      const [current] = await db.select({ status: schema.games.status }).from(schema.games).where(eq(schema.games.id, game.id));
      if (!current || !["in_progress", "suspended", "completed"].includes(current.status)) throw new ChampionshipError(started.error, 409);
    }
  }
  if (game && (game.status !== "waiting" || game.gameKind === "influence")) {
    await db.update(schema.championshipMatches).set({ status: "running" }).where(and(eq(schema.championshipMatches.gameId, game.id), eq(schema.championshipMatches.status, "scheduled")));
  }
  return prepared;
}

export async function dispatchDueChampionshipMatches(db: DrizzleDB, now = new Date().toISOString()) {
  const due = await db.select({ eventId: schema.championshipMatches.eventId, ordinal: schema.championshipMatches.ordinal }).from(schema.championshipMatches)
    .innerJoin(schema.championshipEvents, eq(schema.championshipEvents.id, schema.championshipMatches.eventId))
    .where(and(eq(schema.championshipEvents.status, "running"), eq(schema.championshipMatches.status, "scheduled"), lte(schema.championshipMatches.scheduledAt, now)))
    .orderBy(asc(schema.championshipMatches.scheduledAt));
  const results = [];
  for (const match of due) {
    try { results.push({ ...match, ...await dispatchChampionshipMatch(db, match.eventId, match.ordinal, now) }); }
    catch (error) { results.push({ ...match, error: error instanceof Error ? error.message : "Dispatch failed" }); }
  }
  return results;
}
