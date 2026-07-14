import { randomUUID } from "node:crypto";
import {
  normalizeGameModelSelection,
  resolveModelSelection,
} from "@influence/engine";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  resolveFreeTrackEffectiveRuntimeSnapshot,
  resolveGameEffectiveAgentRevisionInTransaction,
} from "./agent-revisions.js";

type DrizzleTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
type GameRow = typeof schema.games.$inferSelect;
type PlayerRow = typeof schema.gamePlayers.$inferSelect;
type ProfileRow = typeof schema.agentProfiles.$inferSelect;

export type OwnedSeatProjectionErrorCode = "invalid_state" | "rated_roster_invalid";
export type OwnedSeatProjectionErrorReason =
  | "game_not_found"
  | "game_not_waiting"
  | "season_not_active"
  | "capacity"
  | "duplicate_owner"
  | "profile_not_owned"
  | "name_conflict"
  | "invalid_game_config"
  | "invalid_seat_config";

export class OwnedSeatProjectionError extends Error {
  constructor(
    message: string,
    public readonly code: OwnedSeatProjectionErrorCode,
    public readonly reason: OwnedSeatProjectionErrorReason,
  ) {
    super(message);
    this.name = "OwnedSeatProjectionError";
  }
}

export interface OwnedSeatOverrides {
  temperature?: number;
}

export interface OwnedSeatProjection {
  profile: ProfileRow;
  revision: typeof schema.agentRevisions.$inferSelect;
  persona: string;
  agentConfig: string;
}

export interface OwnedSeatReconciliation {
  seat: PlayerRow;
  projection: OwnedSeatProjection;
  disposition: "reconciled" | "already_current";
}

/**
 * Locks a known game set in stable order without assuming the rows are still
 * waiting. Callers use the returned state to distinguish reconciliation from
 * a roster that crossed the freeze boundary while the lock was contended.
 */
export async function lockRosterGamesInTransaction(
  tx: DrizzleTransaction,
  gameIds: readonly string[],
): Promise<GameRow[]> {
  const sortedIds = [...new Set(gameIds)].sort();
  if (sortedIds.length === 0) return [];
  await tx.execute(sql`
    SELECT id
    FROM games
    WHERE id IN (${sql.join(sortedIds.map((id) => sql`${id}`), sql`, `)})
    ORDER BY id
    FOR UPDATE
  `);
  return tx.select().from(schema.games)
    .where(inArray(schema.games.id, sortedIds))
    .orderBy(asc(schema.games.id));
}

/**
 * Locks the game before any profile row and makes the waiting boundary
 * authoritative for a live roster write.
 */
export async function lockWaitingGameForRosterWrite(
  tx: DrizzleTransaction,
  gameId: string,
): Promise<GameRow> {
  await tx.execute(sql`SELECT id FROM games WHERE id = ${gameId} FOR UPDATE`);
  const game = (await tx.select().from(schema.games)
    .where(eq(schema.games.id, gameId)).limit(1))[0];
  if (!game) {
    throw projectionError("Game not found.", "rated_roster_invalid", "game_not_found");
  }
  if (game.status !== "waiting" || game.startedAt) {
    throw projectionError(
      "This game is no longer accepting roster changes.",
      "invalid_state",
      "game_not_waiting",
    );
  }
  return game;
}

/**
 * Builds the only tuple an owned waiting seat may persist. The game must
 * already be locked, so the next contended row is always the profile.
 */
export async function projectOwnedSeatInTransaction(
  tx: DrizzleTransaction,
  input: {
    game: GameRow;
    userId: string;
    agentProfileId: string;
    overrides?: OwnedSeatOverrides;
  },
): Promise<OwnedSeatProjection> {
  await tx.execute(sql`
    SELECT id
    FROM agent_profiles
    WHERE id = ${input.agentProfileId}
    FOR UPDATE
  `);
  const profile = (await tx.select().from(schema.agentProfiles).where(and(
    eq(schema.agentProfiles.id, input.agentProfileId),
    eq(schema.agentProfiles.userId, input.userId),
  )).limit(1))[0];
  if (!profile) {
    throw projectionError(
      "The seat agent is not owned by this player account.",
      "rated_roster_invalid",
      "profile_not_owned",
    );
  }

  const gameConfig = parseGameConfig(input.game.config);
  const modelSelection = resolveModelSelection(
    normalizeGameModelSelection(gameConfig.modelSelection),
    gameConfig.modelTier,
  );
  const temperature = normalizeTemperature(input.overrides?.temperature);
  const persona = JSON.stringify({
    name: profile.name,
    personality: profile.personality,
    backstory: profile.backstory,
    strategyHints: profile.strategyStyle,
    personaKey: profile.personaKey,
  });
  const agentConfig = JSON.stringify({
    model: modelSelection.modelId,
    temperature,
  });
  const effectiveRuntimeSnapshot = resolveFreeTrackEffectiveRuntimeSnapshot(profile, {
    modelSelection: normalizeGameModelSelection(gameConfig.modelSelection),
    modelTier: gameConfig.modelTier,
    temperature,
  });
  const resolvedRevision = await resolveGameEffectiveAgentRevisionInTransaction(tx, {
    profile,
    effectiveRuntimeSnapshot,
  });

  return {
    profile,
    revision: resolvedRevision.revision,
    persona,
    agentConfig,
  };
}

export async function admitOwnedSeatInTransaction(
  tx: DrizzleTransaction,
  input: {
    gameId: string;
    userId: string;
    agentProfileId: string;
    playerId?: string;
    overrides?: OwnedSeatOverrides;
  },
): Promise<{ game: GameRow; seat: PlayerRow; projection: OwnedSeatProjection }> {
  const game = await lockWaitingGameForRosterWrite(tx, input.gameId);
  await assertRatedAdmissionSeason(tx, game);
  const players = await tx.select().from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.gameId, game.id))
    .orderBy(asc(schema.gamePlayers.id));
  if (players.length >= game.maxPlayers) {
    throw projectionError("This game is full.", "rated_roster_invalid", "capacity");
  }
  if (game.seasonId && players.some((player) => player.userId === input.userId)) {
    throw projectionError(
      "Rated games allow only one owned agent per player account.",
      "rated_roster_invalid",
      "duplicate_owner",
    );
  }

  const projection = await projectOwnedSeatInTransaction(tx, {
    game,
    userId: input.userId,
    agentProfileId: input.agentProfileId,
    overrides: input.overrides,
  });
  assertNameAvailable(players, projection.profile.name);
  const seat = (await tx.insert(schema.gamePlayers).values({
    id: input.playerId ?? randomUUID(),
    gameId: game.id,
    userId: input.userId,
    agentProfileId: projection.profile.id,
    agentRevisionId: projection.revision.id,
    persona: projection.persona,
    agentConfig: projection.agentConfig,
  }).returning())[0];
  if (!seat) throw new Error("Owned seat insert returned no row");
  return { game, seat, projection };
}

/**
 * Reprojects every owned seat in one already-waiting roster. House seats are
 * deliberately untouched. Profiles are locked in stable ID order.
 */
export async function projectWaitingOwnedRosterInTransaction(
  tx: DrizzleTransaction,
  gameId: string,
): Promise<{ game: GameRow; seats: PlayerRow[] }> {
  const game = await lockWaitingGameForRosterWrite(tx, gameId);
  const players = await tx.select().from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.gameId, game.id))
    .orderBy(asc(schema.gamePlayers.id));
  if (players.length > game.maxPlayers) {
    throw projectionError("This game is over capacity.", "rated_roster_invalid", "capacity");
  }
  if (players.some((player) => player.agentProfileId && !player.userId)) {
    throw projectionError(
      "An owned roster seat is missing its owner.",
      "rated_roster_invalid",
      "profile_not_owned",
    );
  }

  const ownedPlayers = players
    .filter((player): player is PlayerRow & { userId: string; agentProfileId: string } => (
      Boolean(player.userId && player.agentProfileId)
    ))
    .sort((left, right) => left.agentProfileId.localeCompare(right.agentProfileId));
  if (game.seasonId) assertOneOwnedSeatPerUser(ownedPlayers);

  const projections = new Map<string, OwnedSeatProjection>();
  for (const player of ownedPlayers) {
    projections.set(player.id, await projectOwnedSeatInTransaction(tx, {
      game,
      userId: player.userId,
      agentProfileId: player.agentProfileId,
      overrides: parseSeatOverrides(player.agentConfig),
    }));
  }

  const projectedNames = new Map<string, string>();
  for (const player of players) {
    const projection = projections.get(player.id);
    const name = projection?.profile.name ?? personaName(player.persona);
    const normalized = normalizeName(name);
    if (projectedNames.has(normalized)) {
      throw projectionError(
        "A player with that name already exists in this game.",
        "rated_roster_invalid",
        "name_conflict",
      );
    }
    projectedNames.set(normalized, player.id);
  }

  for (const player of ownedPlayers) {
    const projection = projections.get(player.id)!;
    await tx.update(schema.gamePlayers).set({
      agentRevisionId: projection.revision.id,
      persona: projection.persona,
      agentConfig: projection.agentConfig,
    }).where(and(
      eq(schema.gamePlayers.id, player.id),
      eq(schema.gamePlayers.gameId, game.id),
    ));
  }
  const seats = await tx.select().from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.gameId, game.id))
    .orderBy(asc(schema.gamePlayers.id));
  return { game, seats };
}

/**
 * Reconciles one profile's follower seats inside a game the caller already
 * locked. The helper owns tuple construction and roster-name validation, but
 * deliberately does not open a transaction or widen the lock set.
 */
export async function reconcileOwnedProfileSeatsInLockedGame(
  tx: DrizzleTransaction,
  input: {
    game: GameRow;
    userId: string;
    agentProfileId: string;
  },
): Promise<OwnedSeatReconciliation[]> {
  if (input.game.status !== "waiting" || input.game.startedAt) {
    throw projectionError(
      "This game is no longer accepting roster changes.",
      "invalid_state",
      "game_not_waiting",
    );
  }
  const players = await tx.select().from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.gameId, input.game.id))
    .orderBy(asc(schema.gamePlayers.id));
  const followers = players.filter((player) => player.agentProfileId === input.agentProfileId);
  if (followers.length === 0) return [];
  if (followers.some((player) => player.userId !== input.userId)) {
    throw projectionError(
      "The seat agent is not owned by this player account.",
      "rated_roster_invalid",
      "profile_not_owned",
    );
  }

  const projections: Array<{ player: PlayerRow; projection: OwnedSeatProjection }> = [];
  for (const player of followers) {
    projections.push({
      player,
      projection: await projectOwnedSeatInTransaction(tx, {
        game: input.game,
        userId: input.userId,
        agentProfileId: input.agentProfileId,
        overrides: parseSeatOverrides(player.agentConfig),
      }),
    });
  }

  const projectedNames = new Map<string, string>();
  for (const player of players) {
    const projected = projections.find((entry) => entry.player.id === player.id);
    const name = projected?.projection.profile.name ?? personaName(player.persona);
    const normalized = normalizeName(name);
    if (projectedNames.has(normalized)) {
      throw projectionError(
        "A player with that name already exists in this game.",
        "rated_roster_invalid",
        "name_conflict",
      );
    }
    projectedNames.set(normalized, player.id);
  }

  const reconciled: OwnedSeatReconciliation[] = [];
  for (const { player, projection } of projections) {
    const alreadyCurrent = player.agentRevisionId === projection.revision.id
      && player.persona === projection.persona
      && player.agentConfig === projection.agentConfig;
    if (!alreadyCurrent) {
      await tx.update(schema.gamePlayers).set({
        agentRevisionId: projection.revision.id,
        persona: projection.persona,
        agentConfig: projection.agentConfig,
      }).where(and(
        eq(schema.gamePlayers.id, player.id),
        eq(schema.gamePlayers.gameId, input.game.id),
      ));
    }
    reconciled.push({
      seat: alreadyCurrent ? player : {
        ...player,
        agentRevisionId: projection.revision.id,
        persona: projection.persona,
        agentConfig: projection.agentConfig,
      },
      projection,
      disposition: alreadyCurrent ? "already_current" : "reconciled",
    });
  }
  return reconciled;
}

export async function assertUnownedSeatAdmissionInTransaction(
  tx: DrizzleTransaction,
  input: { gameId: string; name: string },
): Promise<GameRow> {
  const game = await lockWaitingGameForRosterWrite(tx, input.gameId);
  if (game.seasonId) {
    throw projectionError(
      "Rated games require an owned saved agent.",
      "rated_roster_invalid",
      "profile_not_owned",
    );
  }
  const players = await tx.select().from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.gameId, game.id));
  if (players.length >= game.maxPlayers) {
    throw projectionError("This game is full.", "rated_roster_invalid", "capacity");
  }
  assertNameAvailable(players, input.name);
  return game;
}

/** A generated House persona may only enrich an unfrozen House seat. */
export async function updateWaitingHouseSeatPersonaInTransaction(
  tx: DrizzleTransaction,
  input: { gameId: string; playerId: string; persona: string },
): Promise<boolean> {
  await lockWaitingGameForRosterWrite(tx, input.gameId);
  const updated = await tx.update(schema.gamePlayers)
    .set({ persona: input.persona })
    .where(and(
      eq(schema.gamePlayers.id, input.playerId),
      eq(schema.gamePlayers.gameId, input.gameId),
      isNull(schema.gamePlayers.agentProfileId),
    ))
    .returning({ id: schema.gamePlayers.id });
  return updated.length === 1;
}

/**
 * Deletion uses the same game-before-profile order. After the profile lock,
 * any live seat is a hard conflict; historical seats may still be detached.
 */
export async function lockProfileAfterLiveRosterGames(
  tx: DrizzleTransaction,
  input: { profileId: string; userId: string },
): Promise<{ profile: ProfileRow | null; liveGameIds: string[] }> {
  const discovered = await liveGameIdsForProfile(tx, input.profileId);
  if (discovered.length > 0) {
    await tx.execute(sql`
      SELECT id
      FROM games
      WHERE id IN (${sql.join(discovered.map((id) => sql`${id}`), sql`, `)})
      ORDER BY id
      FOR UPDATE
    `);
  }
  await tx.execute(sql`
    SELECT id
    FROM agent_profiles
    WHERE id = ${input.profileId}
    FOR UPDATE
  `);
  const profile = (await tx.select().from(schema.agentProfiles).where(and(
    eq(schema.agentProfiles.id, input.profileId),
    eq(schema.agentProfiles.userId, input.userId),
  )).limit(1))[0] ?? null;
  return {
    profile,
    liveGameIds: profile ? await liveGameIdsForProfile(tx, input.profileId) : [],
  };
}

async function assertRatedAdmissionSeason(tx: DrizzleTransaction, game: GameRow): Promise<void> {
  if (!game.seasonId) return;
  await tx.execute(sql`SELECT id FROM seasons WHERE id = ${game.seasonId} FOR UPDATE`);
  const season = (await tx.select({ status: schema.seasons.status }).from(schema.seasons)
    .where(eq(schema.seasons.id, game.seasonId)).limit(1))[0];
  if (!season || season.status !== "active") {
    throw projectionError(
      "This season is no longer accepting roster changes.",
      "invalid_state",
      "season_not_active",
    );
  }
}

async function liveGameIdsForProfile(
  tx: DrizzleTransaction,
  profileId: string,
): Promise<string[]> {
  const rows = await tx.select({ gameId: schema.games.id })
    .from(schema.gamePlayers)
    .innerJoin(schema.games, eq(schema.gamePlayers.gameId, schema.games.id))
    .where(and(
      eq(schema.gamePlayers.agentProfileId, profileId),
      inArray(schema.games.status, ["waiting", "in_progress", "suspended"]),
    ))
    .orderBy(asc(schema.games.id));
  return [...new Set(rows.map((row) => row.gameId))];
}

function assertOneOwnedSeatPerUser(
  players: Array<PlayerRow & { userId: string }>,
): void {
  const owners = new Set<string>();
  for (const player of players) {
    if (owners.has(player.userId)) {
      throw projectionError(
        "Rated games allow only one owned agent per player account.",
        "rated_roster_invalid",
        "duplicate_owner",
      );
    }
    owners.add(player.userId);
  }
}

function assertNameAvailable(players: PlayerRow[], name: string): void {
  const normalized = normalizeName(name);
  if (players.some((player) => normalizeName(personaName(player.persona)) === normalized)) {
    throw projectionError(
      "A player with that name already exists in this game.",
      "rated_roster_invalid",
      "name_conflict",
    );
  }
}

function personaName(persona: string): string {
  try {
    const parsed = JSON.parse(persona) as { name?: unknown };
    if (typeof parsed.name === "string" && parsed.name.trim()) return parsed.name;
  } catch {
    // Invalid persisted personas fail as a roster conflict instead of being
    // silently replaced during a live write.
  }
  throw projectionError(
    "A roster seat has an invalid persona name.",
    "rated_roster_invalid",
    "name_conflict",
  );
}

function parseGameConfig(value: string): { modelSelection?: unknown; modelTier?: string } {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      modelSelection: parsed.modelSelection,
      modelTier: typeof parsed.modelTier === "string" ? parsed.modelTier : undefined,
    };
  } catch {
    throw projectionError(
      "Game configuration is invalid.",
      "rated_roster_invalid",
      "invalid_game_config",
    );
  }
}

function parseSeatOverrides(value: string): OwnedSeatOverrides {
  try {
    const parsed = JSON.parse(value) as { temperature?: unknown };
    if (parsed.temperature !== undefined
      && (typeof parsed.temperature !== "number" || !Number.isFinite(parsed.temperature))) {
      throw new Error("invalid temperature");
    }
    return {
      ...(typeof parsed.temperature === "number"
        ? { temperature: parsed.temperature }
        : {}),
    };
  } catch {
    throw projectionError(
      "Owned seat configuration is invalid.",
      "rated_roster_invalid",
      "invalid_seat_config",
    );
  }
}

function normalizeTemperature(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0.9;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function projectionError(
  message: string,
  code: OwnedSeatProjectionErrorCode,
  reason: OwnedSeatProjectionErrorReason,
): OwnedSeatProjectionError {
  return new OwnedSeatProjectionError(message, code, reason);
}
