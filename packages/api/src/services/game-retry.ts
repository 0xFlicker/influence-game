import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { replayWerewolf, startWerewolf } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { ChampionshipError } from "./championships.js";
import { prepareChampionshipMatch } from "./championship-dispatch.js";
import { checkGameStartAdmissionInTransaction } from "./deployment-admission.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import { getPersistedGameProjection } from "./game-projection-read-model.js";
import { readWerewolfEvents } from "./werewolf-games.js";
import { currentCaptureVersionFields, initialGameTranscriptStateValues } from "./transcript-capture.js";
import { requestGameStart } from "./game-ownership.js";
import { queueEpisodeCopy } from "./episode-presentation.js";

/** Remap only routing coordinates; never rewrite character text or consult mutable profiles. */
function remapRouting(config: Record<string, unknown>, seats: Map<string, string>) {
  const routing = config.modelRouting as Record<string, unknown> | undefined;
  if (!routing) return config;
  const remap = (value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [seats.get(key) ?? key, entry])) : value;
  const frozen = routing.frozenRoutes as Record<string, unknown> | undefined;
  return { ...config, modelRouting: { ...routing, overrides: remap(routing.overrides), contestants: remap(routing.contestants),
    ...(frozen ? { frozenRoutes: { ...frozen, contestants: remap(frozen.contestants) } } : {}) } };
}

/** Atomic replacement acceptance. A response loss always resolves to the same replacement. */
export async function retryFailedGame(db: DrizzleDB, originalGameId: string, actorId: string) {
  const replacement = await db.transaction(async tx => {
    // Match dispatch locks event before game. Keep the same order here.
    const [match] = await tx.select().from(schema.championshipMatches).where(eq(schema.championshipMatches.gameId, originalGameId));
    if (match) await tx.select().from(schema.championshipEvents).where(eq(schema.championshipEvents.id, match.eventId)).for("update");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('influence.game-turn'), hashtext(${originalGameId}))`);
    const [old] = await tx.select().from(schema.games).where(eq(schema.games.id, originalGameId)).for("update");
    if (!old) throw new ChampionshipError("Game not found", 404);
    const [existing] = await tx.select().from(schema.gameRetries).where(eq(schema.gameRetries.originalGameId, originalGameId));
    if (existing) return existing;
    const [priorAttempt] = await tx.select().from(schema.championshipMatchAttempts).where(eq(schema.championshipMatchAttempts.gameId, old.id));
    if (priorAttempt && !match) throw new ChampionshipError("This championship attempt has already been replaced; use the current match", 409);
    if (match) {
      const [currentMatch] = await tx.select().from(schema.championshipMatches).where(eq(schema.championshipMatches.id, match.id)).for("update");
      if (currentMatch?.gameId !== old.id) throw new ChampionshipError("This championship attempt has already been replaced; use the current match", 409);
    }
    if (!["suspended", "cancelled"].includes(old.status)) throw new ChampionshipError("Only failed or void games can be retried", 409);
    const [sealed] = await tx.select().from(schema.gameCompletionSettlements).where(eq(schema.gameCompletionSettlements.gameId, old.id));
    const [result] = await tx.select().from(schema.gameResults).where(eq(schema.gameResults.gameId, old.id));
    if (sealed || result) throw new ChampionshipError("Gameplay already has a result. Retry settlement instead of replaying gameplay.", 409);
    if (old.gameKind === "werewolf") {
      const events = await readWerewolfEvents(tx, old.id);
      if (events.length && replayWerewolf(events).outcome) throw new ChampionshipError("Gameplay already has an outcome. Recover completion instead of replaying gameplay.", 409);
    } else {
      const history = await getPersistedGameEvents(tx, old.id);
      const projection = getPersistedGameProjection(history);
      if (history.status === "invalid" || projection.status === "failed") throw new ChampionshipError("Canonical history needs repair before retry", 409);
      if (projection.summary?.retrospective.outcome) throw new ChampionshipError("Gameplay already has an outcome. Recover completion instead of replaying gameplay.", 409);
    }
    const admission = await checkGameStartAdmissionInTransaction(tx);
    if (!admission.ok) throw new ChampionshipError(admission.error, 409);
    if (old.seasonId) {
      const [season] = await tx.select().from(schema.seasons).where(eq(schema.seasons.id, old.seasonId)).for("update");
      if (season?.status === "final") throw new ChampionshipError("This season is finalized; a rated replay needs a season correction", 409);
    }
    const now = new Date().toISOString();
    await tx.update(schema.gameRunOwners).set({ status: "revoked", revokedAt: now, kernelHealth: "suspended", failureReason: sql`COALESCE(${schema.gameRunOwners.failureReason}, 'admin_retry')` })
      .where(and(eq(schema.gameRunOwners.gameId, old.id), eq(schema.gameRunOwners.status, "active")));
    await tx.update(schema.games).set({ status: "cancelled", hiddenAt: old.hiddenAt ?? now, endedAt: old.endedAt ?? now }).where(eq(schema.games.id, old.id));
    let replacementGameId: string;
    if (match) {
      if (match.status === "completed") throw new ChampionshipError("Scored matches require result correction", 409);
      await tx.update(schema.championshipMatches).set({ gameId: null, status: "scheduled" }).where(eq(schema.championshipMatches.id, match.id));
      await tx.insert(schema.championshipMatchAttempts).values({ gameId: old.id, matchId: match.id, seatPrefix: match.id }).onConflictDoNothing();
      const prepared = await prepareChampionshipMatch(tx, match.eventId, match.ordinal, now);
      if (!prepared.gameId) throw new ChampionshipError("Match is not due", 409);
      replacementGameId = prepared.gameId;
      await tx.insert(schema.competitionAudit).values({ id: randomUUID(), eventId: match.eventId, actorId,
        requestId: `retry:${old.id}`, action: "match_retried", reason: `Replaced failed attempt ${old.id} with ${replacementGameId}; original hidden and retained` });
    } else {
      replacementGameId = randomUUID();
      // Existing seats/config are the admitted build. Bypass mutable-profile reprojection.
      const seats = await tx.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, old.id));
      const ids = new Map(seats.map(seat => [seat.id, `${replacementGameId}:${seat.id}`]));
      const events = old.gameKind === "werewolf" ? await readWerewolfEvents(tx, old.id) : [];
      const opening = events[0];
      if (old.gameKind === "werewolf") {
        if (opening?.type !== "werewolf.started") throw new ChampionshipError("Missing frozen Werewolf opening", 409);
        for (const player of opening.payload.players) ids.set(player.id, `${replacementGameId}:${player.id}`);
      } else if (seats.length < old.minPlayers || !old.startedAt) throw new ChampionshipError("Missing admitted roster; cannot reconstruct the same game", 409);
      const { visualPause: _pause, ...config } = JSON.parse(old.config) as Record<string, unknown>;
      await tx.insert(schema.games).values({ id: replacementGameId, slug: `retry-${replacementGameId}`, gameKind: old.gameKind,
        config: JSON.stringify(remapRouting(config, ids)), status: "in_progress", trackType: old.trackType, seasonId: old.seasonId,
        minPlayers: old.minPlayers, maxPlayers: old.maxPlayers, createdById: old.createdById,
        startedAt: now, ...currentCaptureVersionFields(), gameKernel: old.gameKernel });
      if (seats.length) await tx.insert(schema.gamePlayers).values(seats.map(seat => ({ ...seat, id: ids.get(seat.id)!, gameId: replacementGameId, joinedAt: now })));
      const ratings = await tx.select().from(schema.competitionRatingSnapshots).where(eq(schema.competitionRatingSnapshots.gameId, old.id));
      if (ratings.length) await tx.insert(schema.competitionRatingSnapshots).values(ratings.map(row => ({ ...row, id: randomUUID(), gameId: replacementGameId })));
      if (opening?.type === "werewolf.started") {
        const initial = startWerewolf(replacementGameId, opening.payload.players.map(player => ({ ...player, id: ids.get(player.id)! })), opening.payload.config, opening.payload.seed);
        if (initial.type !== "werewolf.started" || opening.payload.players.some(player => opening.payload.roles[player.id] !== initial.payload.roles[ids.get(player.id)!])) throw new ChampionshipError("Could not preserve the frozen roles", 409);
        await tx.insert(schema.werewolfEvents).values({ gameId: replacementGameId, sequence: 1, event: initial });
        const originalSeats = await tx.select().from(schema.werewolfLobbySeats).where(eq(schema.werewolfLobbySeats.gameId, old.id));
        await tx.insert(schema.werewolfLobbySeats).values(initial.payload.players.map((player, index) => {
          const originalPlayer = opening.payload.players[index]!;
          const originalSeat = originalSeats.find(seat => seat.id === originalPlayer.id);
          const { id: _id, agentProfileId: _profile, contentRevisionId: _revision, ...houseCharacter } = originalPlayer;
          return { id: player.id, gameId: replacementGameId, agentProfileId: player.agentProfileId ?? null,
            modelPreference: originalSeat?.modelPreference ?? "default",
            houseCharacter: player.agentProfileId ? null : houseCharacter };
        }));
      } else await tx.insert(schema.gameTranscriptStates).values(initialGameTranscriptStateValues(replacementGameId));
      await queueEpisodeCopy(tx, replacementGameId);
    }
    const [record] = await tx.insert(schema.gameRetries).values({ originalGameId, replacementGameId, actorId, createdAt: now }).returning();
    return record!;
  });
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, replacement.replacementGameId));
  if (game?.status === "waiting") {
    const started = await requestGameStart(db, game.id);
    if (!started.ok) throw new ChampionshipError(started.error, 409);
  }
  return { originalGameId, gameId: replacement.replacementGameId };
}
