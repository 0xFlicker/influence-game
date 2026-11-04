import type { ChampionshipScheduledMatch } from "./championship-scheduling.js";
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

type ChampionshipTx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
/** Shared transaction boundary used by dispatch and audited replacement. */
export async function prepareChampionshipMatch(tx: ChampionshipTx, eventId: string, ordinal: number, now: string, expected?: ChampionshipScheduledMatch) {
    const [event] = await tx.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, eventId)).for("update");
    if (expected) {
      if (!event || !["running", "paused"].includes(event.status)) return { deferred: false as const, gameId: null, obsolete: true as const };
      const matches = await tx.select().from(schema.championshipMatches).where(eq(schema.championshipMatches.eventId, eventId)).orderBy(asc(schema.championshipMatches.ordinal));
      const version = createHash("sha256").update(JSON.stringify(["running", matches.map(m => [m.id, m.scheduledAt, m.resultRevision])])).digest("hex");
      const target = matches.find(m => m.ordinal === ordinal);
      if (version !== expected.version || target?.id !== expected.matchId || target.resultRevision !== expected.revision || target.scheduledAt !== expected.scheduledAt || target.status === "void") return { deferred: false as const, gameId: null, obsolete: true as const };
      // Pause fences new admission, not launch delivery for a game already accepted.
      if (event.status === "paused") return target.gameId ? { deferred: false as const, gameId: target.gameId } : { deferred: false as const, gameId: null, obsolete: true as const };
    }
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
    await tx.insert(schema.games).values({ id: gameId, slug: `championship-${match.id}-${gameId}`, gameKind: match.gameKind, seasonId: null, trackType: "custom",
      status: "waiting", minPlayers: 8, maxPlayers: 8, createdById: event.createdById, config: "{}", ...currentCaptureVersionFields() });
    const previousAttempts = await tx.select({ gameId: schema.championshipMatchAttempts.gameId }).from(schema.championshipMatchAttempts).where(eq(schema.championshipMatchAttempts.matchId, match.id));
    await tx.insert(schema.championshipMatchAttempts).values({ gameId, matchId: match.id, seatPrefix: previousAttempts.length ? gameId : match.id });
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
}

/** Exact event/match identity, transaction-serialized creation, and normal durable worker adoption. */
export async function dispatchChampionshipMatch(db: DrizzleDB, eventId: string, ordinal: number, now = new Date().toISOString(), expected?: ChampionshipScheduledMatch) {
  const prepared = await db.transaction(tx => prepareChampionshipMatch(tx, eventId, ordinal, now, expected));
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

export async function dispatchDueChampionshipMatches(db: DrizzleDB, now = new Date().toISOString(), eventId?: string) {
  const due = await db.select({ eventId: schema.championshipMatches.eventId, ordinal: schema.championshipMatches.ordinal }).from(schema.championshipMatches)
    .innerJoin(schema.championshipEvents, eq(schema.championshipEvents.id, schema.championshipMatches.eventId))
    .where(and(eq(schema.championshipEvents.status, "running"), eq(schema.championshipMatches.status, "scheduled"), lte(schema.championshipMatches.scheduledAt, now), eventId ? eq(schema.championshipEvents.id, eventId) : undefined))
    .orderBy(asc(schema.championshipMatches.scheduledAt));
  const results = [];
  for (const match of due) {
    try { results.push({ ...match, ...await dispatchChampionshipMatch(db, match.eventId, match.ordinal, now) }); }
    catch (error) { results.push({ ...match, error: error instanceof Error ? error.message : "Dispatch failed" }); }
  }
  return results;
}

/** Explicit replay of a cancelled attempt, never a draw or a rewrite of accepted history. */
export async function replayCancelledChampionshipMatch(db: DrizzleDB, input: {
  eventId: string; ordinal: number; expectedGameId: string; actorId: string; requestId: string; reason: string;
}, now = new Date().toISOString()) {
  if (!input.requestId.trim() || !input.reason.trim() || !input.expectedGameId) throw new ChampionshipError("Replay requires an exact game, reason and idempotency key");
  await db.transaction(async tx => {
    const [event] = await tx.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, input.eventId)).for("update");
    if (!event || event.status !== "running") throw new ChampionshipError("Activate the event before replaying a cancelled match", 409);
    const action = `match_replay:${input.ordinal}:${input.expectedGameId}`;
    const [prior] = await tx.select().from(schema.competitionAudit).where(and(eq(schema.competitionAudit.actorId, input.actorId), eq(schema.competitionAudit.requestId, input.requestId)));
    if (prior) {
      if (prior.eventId !== input.eventId || prior.action !== action || prior.reason !== input.reason.trim()) throw new ChampionshipError("Idempotency key already belongs to another operation", 409);
      return;
    }
    const [match] = await tx.select().from(schema.championshipMatches).where(and(eq(schema.championshipMatches.eventId, input.eventId), eq(schema.championshipMatches.ordinal, input.ordinal))).for("update");
    if (!match || match.gameId !== input.expectedGameId || match.status === "completed") throw new ChampionshipError("The exact unsettled match attempt changed", 409);
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, input.expectedGameId)).for("update");
    if (game?.status !== "cancelled") throw new ChampionshipError("Only cancelled games can be replayed; recover interrupted games from their existing cursor", 409);
    const settled = await tx.select().from(schema.championshipResults).where(and(eq(schema.championshipResults.matchId, match.id), eq(schema.championshipResults.revision, match.resultRevision)));
    if (settled.length) throw new ChampionshipError("Scored matches require a separate result correction", 409);
    await tx.insert(schema.championshipMatchAttempts).values({ gameId: game.id, matchId: match.id, seatPrefix: match.id }).onConflictDoNothing();
    await tx.update(schema.championshipMatches).set({ gameId: null, status: "scheduled" }).where(eq(schema.championshipMatches.id, match.id));
    await tx.insert(schema.competitionAudit).values({ id: randomUUID(), eventId: event.id, actorId: input.actorId, requestId: input.requestId, action, reason: input.reason.trim() });
  });
  // If a process exits here, the ordinary dispatcher adopts this same scheduled match.
  return dispatchChampionshipMatch(db, input.eventId, input.ordinal, now);
}
