import { randomUUID } from "node:crypto";
import { HOUSE_AGENT_NAMES } from "@influence/engine";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  OwnedSeatProjectionError,
  lockWaitingGameForRosterWrite,
  projectWaitingOwnedRosterInTransaction,
} from "./owned-seat-projection.js";
import {
  COMPETITION_RATING_POLICY_VERSION,
  initialCompetitionRating,
} from "./season-policy.js";

type DrizzleTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
type GameRow = typeof schema.games.$inferSelect;
type PlayerRow = typeof schema.gamePlayers.$inferSelect;

export type RosterFreezeErrorCode = "invalid_state" | "rated_roster_invalid";
export type RosterFreezeErrorReason =
  | "game_not_found"
  | "game_not_waiting"
  | "not_enough_players"
  | "capacity"
  | "season_not_startable"
  | "malformed_owned_seat"
  | "duplicate_owner"
  | "name_conflict"
  | "invalid_game_config"
  | "invalid_seat_config"
  | "revision_mismatch";

export class RosterFreezeError extends Error {
  constructor(
    message: string,
    public readonly code: RosterFreezeErrorCode,
    public readonly reason: RosterFreezeErrorReason,
  ) {
    super(message);
    this.name = "RosterFreezeError";
  }
}

export interface FrozenRoster {
  game: GameRow;
  seats: PlayerRow[];
  competitionSnapshotCount: number;
}

/**
 * Locks, resolves, and validates the final roster inside a caller-owned
 * transaction. This helper deliberately does not change game state or create
 * the run owner lease; those remain the responsibility of game-ownership.ts.
 */
export async function freezeWaitingRosterInTransaction(
  tx: DrizzleTransaction,
  input: { gameId: string; frozenAt: string },
): Promise<FrozenRoster> {
  try {
    return await freezeWaitingRoster(tx, input);
  } catch (error) {
    throw asRosterFreezeError(error);
  }
}

async function freezeWaitingRoster(
  tx: DrizzleTransaction,
  input: { gameId: string; frozenAt: string },
): Promise<FrozenRoster> {
  const lockedGame = await lockWaitingGameForRosterWrite(tx, input.gameId);
  await validateSeasonForFreeze(tx, lockedGame);
  const { game, seats: projectedSeats } = await projectWaitingOwnedRosterInTransaction(
    tx,
    input.gameId,
    { allowHouseNameCollisions: true },
  );

  if (projectedSeats.length < game.minPlayers) {
    throw freezeError(
      `Not enough players. Need at least ${game.minPlayers}, have ${projectedSeats.length}.`,
      "rated_roster_invalid",
      "not_enough_players",
    );
  }
  if (projectedSeats.length > game.maxPlayers) {
    throw freezeError("This game is over capacity.", "rated_roster_invalid", "capacity");
  }

  validateOwnership(projectedSeats, Boolean(game.seasonId));
  await validateRevisionIdentity(tx, projectedSeats);
  const seats = await resolveHouseOnlyNameCollisions(tx, game.id, projectedSeats);
  const competitionSnapshotCount = game.seasonId
    ? await replaceCompetitionSnapshots(tx, game.id, seats, input.frozenAt)
    : await clearCompetitionSnapshots(tx, game.id);

  return { game, seats, competitionSnapshotCount };
}

async function validateSeasonForFreeze(tx: DrizzleTransaction, game: GameRow): Promise<void> {
  if (!game.seasonId) return;
  await tx.execute(sql`SELECT id FROM seasons WHERE id = ${game.seasonId} FOR UPDATE`);
  const season = (await tx.select({ status: schema.seasons.status }).from(schema.seasons)
    .where(eq(schema.seasons.id, game.seasonId)).limit(1))[0];
  if (!season || (season.status !== "active" && season.status !== "closing")) {
    throw freezeError(
      "This rated game is not assigned to a startable season.",
      "invalid_state",
      "season_not_startable",
    );
  }
}

function validateOwnership(seats: readonly PlayerRow[], rated: boolean): void {
  const ownerIds = new Set<string>();
  for (const seat of seats) {
    if (seat.agentRevisionId && !seat.agentProfileId) {
      throw freezeError(
        "A roster seat has revision evidence without a saved agent profile.",
        "rated_roster_invalid",
        "malformed_owned_seat",
      );
    }
    if (!rated) continue;
    if (Boolean(seat.userId) !== Boolean(seat.agentProfileId)) {
      throw freezeError(
        "Every owned rated seat must pair an owner with a saved agent profile.",
        "rated_roster_invalid",
        "malformed_owned_seat",
      );
    }
    if (!seat.userId) continue;
    if (ownerIds.has(seat.userId)) {
      throw freezeError(
        "Rated games allow only one owned agent per player account.",
        "rated_roster_invalid",
        "duplicate_owner",
      );
    }
    ownerIds.add(seat.userId);
  }
}

async function validateRevisionIdentity(
  tx: DrizzleTransaction,
  seats: readonly PlayerRow[],
): Promise<void> {
  const ownedSeats = seats.filter((seat): seat is PlayerRow & {
    agentProfileId: string;
    agentRevisionId: string;
  } => Boolean(seat.agentProfileId && seat.agentRevisionId));
  if (ownedSeats.length !== seats.filter((seat) => seat.agentProfileId).length) {
    throw freezeError(
      "An owned roster seat is missing its analytical revision.",
      "rated_roster_invalid",
      "revision_mismatch",
    );
  }
  const revisionIds = [...new Set(ownedSeats.map((seat) => seat.agentRevisionId))];
  if (revisionIds.length === 0) return;
  const revisions = await tx.select({
    id: schema.agentRevisions.id,
    agentProfileId: schema.agentRevisions.agentProfileId,
  }).from(schema.agentRevisions).where(inArray(schema.agentRevisions.id, revisionIds));
  const profileByRevision = new Map(revisions.map((revision) => [revision.id, revision.agentProfileId]));
  if (ownedSeats.some((seat) => profileByRevision.get(seat.agentRevisionId) !== seat.agentProfileId)) {
    throw freezeError(
      "An owned roster seat has a mismatched analytical revision.",
      "rated_roster_invalid",
      "revision_mismatch",
    );
  }
}

async function resolveHouseOnlyNameCollisions(
  tx: DrizzleTransaction,
  gameId: string,
  seats: readonly PlayerRow[],
): Promise<PlayerRow[]> {
  const sortedSeats = [...seats].sort((left, right) => left.id.localeCompare(right.id));
  const groups = new Map<string, Array<{ seat: PlayerRow; persona: Record<string, unknown> }>>();
  for (const seat of sortedSeats) {
    const persona = parsePersona(seat);
    const name = persona.name;
    const normalized = normalizeName(name);
    const group = groups.get(normalized) ?? [];
    group.push({ seat, persona });
    groups.set(normalized, group);
  }

  const usedNames = new Set([...groups.keys()]);
  const replacements = new Map<string, string>();
  let fallbackOrdinal = 1;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    if (group.some(({ seat }) => seat.agentProfileId || seat.userId)) {
      throw freezeError(
        "A player with that name already exists in this game.",
        "rated_roster_invalid",
        "name_conflict",
      );
    }
    for (const duplicate of group.slice(1)) {
      let replacement: string | undefined = HOUSE_AGENT_NAMES.find(
        (candidate) => !usedNames.has(normalizeName(candidate)),
      );
      while (!replacement) {
        const candidate = `Agent-${fallbackOrdinal++}`;
        if (!usedNames.has(normalizeName(candidate))) replacement = candidate;
      }
      usedNames.add(normalizeName(replacement));
      replacements.set(duplicate.seat.id, replacement);
      duplicate.persona.name = replacement;
      await tx.update(schema.gamePlayers).set({ persona: JSON.stringify(duplicate.persona) }).where(and(
        eq(schema.gamePlayers.id, duplicate.seat.id),
        eq(schema.gamePlayers.gameId, gameId),
      ));
    }
  }
  return sortedSeats.map((seat) => {
    const replacement = replacements.get(seat.id);
    if (!replacement) return seat;
    const persona = parsePersona(seat);
    persona.name = replacement;
    return { ...seat, persona: JSON.stringify(persona) };
  });
}

async function replaceCompetitionSnapshots(
  tx: DrizzleTransaction,
  gameId: string,
  seats: readonly PlayerRow[],
  capturedAt: string,
): Promise<number> {
  const ownedSeats = seats.filter((seat): seat is PlayerRow & {
    agentProfileId: string;
    agentRevisionId: string;
  } => Boolean(seat.agentProfileId && seat.agentRevisionId));
  const profileIds = ownedSeats.map((seat) => seat.agentProfileId).sort();
  if (profileIds.length > 0) {
    await tx.execute(sql`
      SELECT agent_profile_id
      FROM agent_competition_ratings
      WHERE agent_profile_id IN (${sql.join(profileIds.map((id) => sql`${id}`), sql`, `)})
      ORDER BY agent_profile_id
      FOR UPDATE
    `);
  }
  const ratings = profileIds.length === 0
    ? []
    : await tx.select().from(schema.agentCompetitionRatings)
      .where(inArray(schema.agentCompetitionRatings.agentProfileId, profileIds));
  const ratingByProfile = new Map(ratings.map((rating) => [rating.agentProfileId, rating]));
  const initial = initialCompetitionRating();

  await tx.delete(schema.competitionRatingSnapshots)
    .where(eq(schema.competitionRatingSnapshots.gameId, gameId));
  if (ownedSeats.length === 0) return 0;
  await tx.insert(schema.competitionRatingSnapshots).values(ownedSeats.map((seat) => {
    const rating = ratingByProfile.get(seat.agentProfileId);
    return {
      id: randomUUID(),
      gameId,
      agentProfileId: seat.agentProfileId,
      agentRevisionId: seat.agentRevisionId,
      mu: rating?.mu ?? initial.mu,
      sigma: rating?.sigma ?? initial.sigma,
      ratingPolicyVersion: COMPETITION_RATING_POLICY_VERSION,
      capturedAt,
    };
  }));
  return ownedSeats.length;
}

async function clearCompetitionSnapshots(
  tx: DrizzleTransaction,
  gameId: string,
): Promise<0> {
  await tx.delete(schema.competitionRatingSnapshots)
    .where(eq(schema.competitionRatingSnapshots.gameId, gameId));
  return 0;
}

function parsePersona(seat: PlayerRow): Record<string, unknown> & { name: string } {
  try {
    const persona = JSON.parse(seat.persona) as Record<string, unknown>;
    if (typeof persona.name !== "string" || !persona.name.trim()) throw new Error("name missing");
    return persona as Record<string, unknown> & { name: string };
  } catch {
    throw freezeError(
      "A roster seat has an invalid persona name.",
      "rated_roster_invalid",
      "name_conflict",
    );
  }
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function freezeError(
  message: string,
  code: RosterFreezeErrorCode,
  reason: RosterFreezeErrorReason,
): RosterFreezeError {
  return new RosterFreezeError(message, code, reason);
}

export function asRosterFreezeError(error: unknown): RosterFreezeError {
  if (error instanceof RosterFreezeError) return error;
  if (error instanceof OwnedSeatProjectionError) {
    return new RosterFreezeError(
      error.message,
      error.code,
      error.reason === "game_not_found"
        ? "game_not_found"
        : error.reason === "game_not_waiting"
          ? "game_not_waiting"
          : error.reason === "capacity"
            ? "capacity"
            : error.reason === "duplicate_owner"
              ? "duplicate_owner"
              : error.reason === "name_conflict"
                ? "name_conflict"
                : error.reason === "season_not_active"
                  ? "season_not_startable"
                  : error.reason === "profile_not_owned"
                    ? "malformed_owned_seat"
                    : error.reason,
    );
  }
  throw error;
}
