import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { GameModelSelection } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  COMPETITION_RATING_POLICY_VERSION,
  calculateArchitectScore,
  compareAgentStandings,
  compareArchitectStandings,
  earliestFinalTotalReachedAt,
  initialCompetitionRating,
} from "./season-policy.js";
import {
  resolveGameEffectiveAgentRevisionInTransaction,
  resolveFreeTrackEffectiveRuntimeSnapshot,
} from "./agent-revisions.js";

type DrizzleTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
type DatabaseExecutor = DrizzleDB | DrizzleTransaction;

export class SeasonStateError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "season_not_found"
      | "invalid_state"
      | "season_not_ready"
      | "rated_roster_invalid",
  ) {
    super(message);
    this.name = "SeasonStateError";
  }
}

export interface CreateSeasonInput {
  slug: string;
  name: string;
  createdById?: string | null;
  admissionStartsAt?: string | null;
  admissionClosesAt?: string | null;
}

export interface RatedRosterValidation {
  rated: boolean;
  error?: string;
}

export async function createSeason(
  db: DrizzleDB,
  input: CreateSeasonInput,
): Promise<typeof schema.seasons.$inferSelect> {
  const now = new Date().toISOString();
  const admissionStartsAt = normalizeOptionalTimestamp(input.admissionStartsAt, "Admission start");
  const admissionClosesAt = normalizeOptionalTimestamp(input.admissionClosesAt, "Admission close");
  if (admissionStartsAt && admissionClosesAt
    && Date.parse(admissionStartsAt) >= Date.parse(admissionClosesAt)) {
    throw new SeasonStateError("Admission start must be before admission close.", "invalid_state");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('influence-season-free'))`);
    const otherActive = (await tx.select({ id: schema.seasons.id }).from(schema.seasons)
      .where(and(
        eq(schema.seasons.ratedPool, "free"),
        eq(schema.seasons.status, "active"),
      )).limit(1))[0];
    if (otherActive) {
      throw new SeasonStateError(
        "Another season is already active for the free rated pool. Close it before creating a new season.",
        "invalid_state",
      );
    }
    const inserted = (await tx.insert(schema.seasons).values({
      id: randomUUID(),
      slug: requireText(input.slug, "Season slug"),
      name: requireText(input.name, "Season name"),
      status: "active",
      ratedPool: "free",
      admissionStartsAt,
      admissionClosesAt,
      createdById: input.createdById ?? null,
      createdAt: now,
      updatedAt: now,
    }).returning())[0];
    if (!inserted) throw new Error("Season insert returned no row");
    return inserted;
  });
}

export async function closeSeason(
  db: DrizzleDB,
  seasonId: string,
  now = new Date().toISOString(),
): Promise<typeof schema.seasons.$inferSelect> {
  const closedAt = normalizeTimestamp(now, "Season close time");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('influence-season-free'))`);
    const season = await requireSeasonForUpdate(tx, seasonId);
    if (season.status === "closing" || season.status === "final") return season;
    await tx.delete(schema.freeQueuePromptSuppressions)
      .where(eq(schema.freeQueuePromptSuppressions.seasonId, seasonId));
    await tx.delete(schema.freeGameQueue);
    const updated = (await tx.update(schema.seasons).set({
      status: "closing",
      admissionClosesAt: closedAt,
      updatedAt: closedAt,
    }).where(eq(schema.seasons.id, seasonId)).returning())[0];
    if (!updated) throw new Error("Season close returned no row");
    return updated;
  });
}

export async function getActiveSeason(
  db: DatabaseExecutor,
  now = new Date().toISOString(),
): Promise<typeof schema.seasons.$inferSelect | null> {
  const checkedAt = normalizeTimestamp(now, "Admission check time");
  const season = (await db.select().from(schema.seasons).where(and(
    eq(schema.seasons.ratedPool, "free"),
    eq(schema.seasons.status, "active"),
  )).limit(1))[0] ?? null;
  if (!season) return null;
  if (season.admissionStartsAt && Date.parse(checkedAt) < Date.parse(season.admissionStartsAt)) return null;
  if (season.admissionClosesAt && Date.parse(checkedAt) >= Date.parse(season.admissionClosesAt)) return null;
  return season;
}

/**
 * Assigns the active free season and exact effective revision to an already
 * materialized free-game roster. No active season is a valid, explicit
 * unrated outcome.
 */
export async function bindFreeGameToActiveSeason(
  tx: DrizzleTransaction,
  gameId: string,
  now = new Date().toISOString(),
): Promise<{ rated: boolean; seasonId: string | null }> {
  const admittedAt = normalizeTimestamp(now, "Roster admission time");
  const game = (await tx.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1))[0];
  if (!game) throw new SeasonStateError("Game not found.", "rated_roster_invalid");
  if (game.trackType !== "free") {
    throw new SeasonStateError("Only free-track games can enter a season.", "rated_roster_invalid");
  }
  if (game.status !== "waiting" || game.startedAt) {
    throw new SeasonStateError("A season can only be assigned before game start.", "invalid_state");
  }
  if (game.seasonId) {
    return { rated: true, seasonId: game.seasonId };
  }

  await tx.execute(sql`
    SELECT id FROM seasons
    WHERE rated_pool = 'free' AND status = 'active'
    FOR UPDATE
  `);
  const season = await getActiveSeason(tx, admittedAt);
  if (!season) return { rated: false, seasonId: null };

  const gameConfig = parseGameConfig(game.config);
  const players = await tx.select().from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.gameId, gameId))
    .orderBy(asc(schema.gamePlayers.id));
  assertOneOwnedSeatPerUser(players);

  for (const player of players) {
    if (!player.agentProfileId) continue;
    if (!player.userId) {
      throw new SeasonStateError(
        `Owned agent seat ${player.id} is missing its owner.`,
        "rated_roster_invalid",
      );
    }
    const profile = (await tx.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, player.agentProfileId)).limit(1))[0];
    if (!profile || profile.userId !== player.userId) {
      throw new SeasonStateError(
        `Seat ${player.id} does not reference an agent owned by its user.`,
        "rated_roster_invalid",
      );
    }
    const agentConfig = parseAgentConfig(player.agentConfig);
    const revision = await resolveGameEffectiveAgentRevisionInTransaction(tx, {
      profile,
      effectiveRuntimeSnapshot: resolveFreeTrackEffectiveRuntimeSnapshot(profile, {
        modelSelection: gameConfig.modelSelection,
        modelTier: gameConfig.modelTier,
        temperature: agentConfig.temperature,
      }),
    });
    await tx.update(schema.gamePlayers).set({ agentRevisionId: revision.revision.id })
      .where(eq(schema.gamePlayers.id, player.id));
    await captureCompetitionRatingSnapshot(tx, {
      gameId,
      agentProfileId: profile.id,
      agentRevisionId: revision.revision.id,
      capturedAt: admittedAt,
    });
  }

  await tx.update(schema.games).set({ seasonId: season.id })
    .where(and(eq(schema.games.id, gameId), sql`${schema.games.seasonId} IS NULL`));
  return { rated: true, seasonId: season.id };
}

export async function validateRatedGameRoster(
  db: DatabaseExecutor,
  gameId: string,
): Promise<RatedRosterValidation> {
  const game = (await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1))[0];
  if (!game) return { rated: false, error: "Game not found" };
  if (!game.seasonId) return { rated: false };

  const season = (await db.select().from(schema.seasons)
    .where(eq(schema.seasons.id, game.seasonId)).limit(1))[0];
  if (!season) return { rated: true, error: "Rated game season not found" };
  if (season.status !== "active" && season.status !== "closing") {
    return { rated: true, error: `Rated game season is ${season.status}` };
  }

  const players = await db.select().from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.gameId, gameId));
  try {
    assertOneOwnedSeatPerUser(players);
  } catch (error) {
    return { rated: true, error: error instanceof Error ? error.message : String(error) };
  }

  const revisionIds = players.flatMap((player) => player.agentRevisionId ? [player.agentRevisionId] : []);
  const revisions = revisionIds.length === 0
    ? []
    : await db.select({
      id: schema.agentRevisions.id,
      agentProfileId: schema.agentRevisions.agentProfileId,
    }).from(schema.agentRevisions).where(inArray(schema.agentRevisions.id, revisionIds));
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision.agentProfileId]));
  const snapshots = await db.select({
    agentProfileId: schema.competitionRatingSnapshots.agentProfileId,
    agentRevisionId: schema.competitionRatingSnapshots.agentRevisionId,
    ratingPolicyVersion: schema.competitionRatingSnapshots.ratingPolicyVersion,
  }).from(schema.competitionRatingSnapshots)
    .where(eq(schema.competitionRatingSnapshots.gameId, gameId));
  const snapshotByProfile = new Map(snapshots.map((snapshot) => [snapshot.agentProfileId, snapshot]));
  for (const player of players) {
    if (!player.agentProfileId) continue;
    if (!player.userId) return { rated: true, error: `Owned seat ${player.id} is missing its owner` };
    if (!player.agentRevisionId) {
      return { rated: true, error: `Owned seat ${player.id} is missing its analytical revision` };
    }
    if (revisionById.get(player.agentRevisionId) !== player.agentProfileId) {
      return { rated: true, error: `Owned seat ${player.id} has a mismatched analytical revision` };
    }
    const snapshot = snapshotByProfile.get(player.agentProfileId);
    if (!snapshot || snapshot.agentRevisionId !== player.agentRevisionId
      || snapshot.ratingPolicyVersion !== COMPETITION_RATING_POLICY_VERSION) {
      return { rated: true, error: `Owned seat ${player.id} has no matching pregame rating snapshot` };
    }
  }
  return { rated: true };
}

/**
 * Serializes joins against the game row and returns the revision that must be
 * stored on an owned seat. Unrated games deliberately return null.
 */
export async function prepareOwnedSeatAdmission(
  tx: DrizzleTransaction,
  input: {
    gameId: string;
    userId: string;
    profile: typeof schema.agentProfiles.$inferSelect;
    temperature?: number;
  },
): Promise<{
  revisionId: string;
  profile: typeof schema.agentProfiles.$inferSelect;
} | null> {
  await tx.execute(sql`SELECT id FROM games WHERE id = ${input.gameId} FOR UPDATE`);
  const game = (await tx.select().from(schema.games)
    .where(eq(schema.games.id, input.gameId)).limit(1))[0];
  if (!game) throw new SeasonStateError("Game not found.", "rated_roster_invalid");
  if (!game.seasonId) return null;
  if (game.status !== "waiting" || game.startedAt) {
    throw new SeasonStateError("This game is no longer accepting players.", "rated_roster_invalid");
  }
  const currentPlayers = await tx.select({
    persona: schema.gamePlayers.persona,
  }).from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, input.gameId));
  if (currentPlayers.length >= game.maxPlayers) {
    throw new SeasonStateError("This game is full.", "rated_roster_invalid");
  }

  const season = await requireSeasonForUpdate(tx, game.seasonId);
  if (season.status !== "active") {
    throw new SeasonStateError(
      "This season is no longer accepting roster changes.",
      "invalid_state",
    );
  }
  const existingOwnerSeat = (await tx.select({ id: schema.gamePlayers.id })
    .from(schema.gamePlayers).where(and(
      eq(schema.gamePlayers.gameId, input.gameId),
      eq(schema.gamePlayers.userId, input.userId),
    )).limit(1))[0];
  if (existingOwnerSeat) {
    throw new SeasonStateError(
      "Rated games allow only one owned agent per player account.",
      "rated_roster_invalid",
    );
  }
  await tx.execute(sql`
    SELECT id
    FROM agent_profiles
    WHERE id = ${input.profile.id}
    FOR UPDATE
  `);
  const profile = (await tx.select().from(schema.agentProfiles)
    .where(eq(schema.agentProfiles.id, input.profile.id)).limit(1))[0];
  if (!profile || profile.userId !== input.userId) {
    throw new SeasonStateError(
      "The rated seat agent is not owned by this player account.",
      "rated_roster_invalid",
    );
  }
  const normalizedName = profile.name.trim().toLowerCase();
  const nameCollision = currentPlayers.some((player) => {
    const persona = JSON.parse(player.persona) as { name?: unknown };
    return typeof persona.name === "string"
      && persona.name.trim().toLowerCase() === normalizedName;
  });
  if (nameCollision) {
    throw new SeasonStateError(
      "A player with that name already exists in this game.",
      "rated_roster_invalid",
    );
  }
  const gameConfig = parseGameConfig(game.config);
  const revision = await resolveGameEffectiveAgentRevisionInTransaction(tx, {
    profile,
    effectiveRuntimeSnapshot: resolveFreeTrackEffectiveRuntimeSnapshot(profile, {
      modelSelection: gameConfig.modelSelection,
      modelTier: gameConfig.modelTier,
      temperature: input.temperature,
    }),
  });
  await captureCompetitionRatingSnapshot(tx, {
    gameId: input.gameId,
    agentProfileId: input.profile.id,
    agentRevisionId: revision.revision.id,
    capturedAt: new Date().toISOString(),
  });
  return { revisionId: revision.revision.id, profile };
}

async function captureCompetitionRatingSnapshot(
  tx: DrizzleTransaction,
  input: {
    gameId: string;
    agentProfileId: string;
    agentRevisionId: string;
    capturedAt: string;
  },
): Promise<void> {
  const current = (await tx.select({
    mu: schema.agentCompetitionRatings.mu,
    sigma: schema.agentCompetitionRatings.sigma,
  }).from(schema.agentCompetitionRatings)
    .where(eq(schema.agentCompetitionRatings.agentProfileId, input.agentProfileId))
    .limit(1))[0];
  const rating = current ?? initialCompetitionRating();
  await tx.insert(schema.competitionRatingSnapshots).values({
    id: randomUUID(),
    gameId: input.gameId,
    agentProfileId: input.agentProfileId,
    agentRevisionId: input.agentRevisionId,
    mu: rating.mu,
    sigma: rating.sigma,
    ratingPolicyVersion: COMPETITION_RATING_POLICY_VERSION,
    capturedAt: input.capturedAt,
  }).onConflictDoNothing();
  const snapshot = (await tx.select().from(schema.competitionRatingSnapshots).where(and(
    eq(schema.competitionRatingSnapshots.gameId, input.gameId),
    eq(schema.competitionRatingSnapshots.agentProfileId, input.agentProfileId),
  )).limit(1))[0];
  if (!snapshot || snapshot.agentRevisionId !== input.agentRevisionId) {
    throw new SeasonStateError(
      `Rated game ${input.gameId} has a conflicting pregame rating snapshot for ${input.agentProfileId}.`,
      "rated_roster_invalid",
    );
  }
}

export async function finalizeSeason(
  db: DrizzleDB,
  seasonId: string,
  now = new Date().toISOString(),
): Promise<typeof schema.seasonHonors.$inferSelect> {
  const finalizedAt = normalizeTimestamp(now, "Season finalization time");
  return db.transaction(async (tx) => {
    const season = await requireSeasonForUpdate(tx, seasonId);
    const existing = (await tx.select().from(schema.seasonHonors)
      .where(eq(schema.seasonHonors.seasonId, seasonId)).limit(1))[0];
    if (existing && season.status === "final") return existing;
    if (season.status !== "closing") {
      throw new SeasonStateError("Only a closing season can be finalized.", "invalid_state");
    }
    if (existing) return existing;

    const nonterminal = (await tx.select({ count: sql<number>`count(*)::int` })
      .from(schema.games).where(and(
        eq(schema.games.seasonId, seasonId),
        sql`${schema.games.status} NOT IN ('completed', 'cancelled')`,
      )))[0]?.count ?? 0;
    if (nonterminal > 0) {
      throw new SeasonStateError("Assigned games are still running or waiting.", "season_not_ready");
    }

    const unsettled = await tx.execute(sql`
      SELECT gp.id
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE g.season_id = ${seasonId}
        AND g.status = 'completed'
        AND gp.agent_profile_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM competition_receipts cr
          WHERE cr.season_id = ${seasonId}
            AND cr.game_id = gp.game_id
            AND cr.agent_profile_id = gp.agent_profile_id
        )
      LIMIT 1
    `);
    if (unsettled.length > 0) {
      throw new SeasonStateError("Completed games still need competition settlement.", "season_not_ready");
    }

    const receipts = await tx.select().from(schema.competitionReceipts).where(and(
      eq(schema.competitionReceipts.seasonId, seasonId),
      eq(schema.competitionReceipts.eligibilityStatus, "eligible"),
    )).orderBy(asc(schema.competitionReceipts.earnedAt), asc(schema.competitionReceipts.id));
    if (receipts.length === 0) {
      throw new SeasonStateError("A season without eligible receipts cannot crown champions.", "season_not_ready");
    }

    const agentGroups = new Map<string, typeof receipts>();
    for (const receipt of receipts) {
      const group = agentGroups.get(receipt.agentProfileId) ?? [];
      group.push(receipt);
      agentGroups.set(receipt.agentProfileId, group);
    }
    const agents = [...agentGroups.entries()].map(([agentId, rows]) => {
      const totalPoints = rows.reduce((sum, row) => sum + row.totalPoints, 0);
      return {
        agentId,
        ownerId: rows[0]!.ownerId,
        agentName: rows.at(-1)!.agentNameSnapshot,
        ownerName: rows.at(-1)!.ownerDisplayNameSnapshot,
        totalPoints,
        wins: rows.filter((row) => row.placement === 1).length,
        runnerUpFinishes: rows.filter((row) => row.placement === 2).length,
        averageNormalizedPlacement: rows.reduce((sum, row) =>
          sum + ((row.lobbySize - (row.placement ?? row.lobbySize)) / (row.lobbySize - 1)), 0) / rows.length,
        tiedTotalReachedAt: earliestFinalTotalReachedAt(rows),
      };
    }).sort(compareAgentStandings);
    const agentChampion = agents[0]!;

    const ownerGroups = new Map<string, typeof agents>();
    for (const agent of agents) {
      const group = ownerGroups.get(agent.ownerId) ?? [];
      group.push(agent);
      ownerGroups.set(agent.ownerId, group);
    }
    const architects = [...ownerGroups.entries()].map(([ownerId, ownerAgents]) => {
      const score = calculateArchitectScore(ownerAgents.map((agent) => ({
        agentId: agent.agentId,
        totalPoints: agent.totalPoints,
      })));
      const contributingIds = new Set(score.contributions.map((item) => item.agentId));
      const contributing = ownerAgents.filter((agent) => contributingIds.has(agent.agentId));
      return {
        ownerId,
        ownerName: ownerAgents[0]!.ownerName,
        totalPointsHundredths: score.totalPointsHundredths,
        contributions: score.contributions,
        contributingWins: contributing.reduce((sum, agent) => sum + agent.wins, 0),
        firstAgentPoints: score.contributions[0]?.sourcePoints ?? 0,
        tiedTotalReachedAt: contributing.map((agent) => agent.tiedTotalReachedAt).sort().at(-1) ?? finalizedAt,
      };
    }).sort(compareArchitectStandings);
    const architectChampion = architects[0]!;

    const honor = (await tx.insert(schema.seasonHonors).values({
      id: randomUUID(),
      seasonId,
      agentChampionAgentProfileId: agentChampion.agentId,
      agentChampionOwnerId: agentChampion.ownerId,
      agentChampionNameSnapshot: agentChampion.agentName,
      agentChampionOwnerNameSnapshot: agentChampion.ownerName,
      agentChampionPoints: agentChampion.totalPoints,
      architectChampionOwnerId: architectChampion.ownerId,
      architectChampionOwnerNameSnapshot: architectChampion.ownerName,
      architectChampionPointsHundredths: architectChampion.totalPointsHundredths,
      architectContributions: architectChampion.contributions.map((contribution) => ({
        ...contribution,
        agentName: agents.find((agent) => agent.agentId === contribution.agentId)?.agentName
          ?? contribution.agentId,
      })),
      createdAt: finalizedAt,
    }).returning())[0];
    if (!honor) throw new Error("Season honor insert returned no row");
    await tx.update(schema.seasons).set({ status: "final", finalizedAt, updatedAt: finalizedAt })
      .where(eq(schema.seasons.id, seasonId));
    return honor;
  });
}

function assertOneOwnedSeatPerUser(
  players: ReadonlyArray<Pick<typeof schema.gamePlayers.$inferSelect, "id" | "userId" | "agentProfileId">>,
): void {
  const owners = new Set<string>();
  for (const player of players) {
    if (Boolean(player.userId) !== Boolean(player.agentProfileId)) {
      throw new SeasonStateError(
        `Rated seat ${player.id} must pair an owner with a saved agent profile.`,
        "rated_roster_invalid",
      );
    }
    if (!player.userId || !player.agentProfileId) continue;
    if (owners.has(player.userId)) {
      throw new SeasonStateError(
        `Rated games allow only one owned agent per player account (${player.userId}).`,
        "rated_roster_invalid",
      );
    }
    owners.add(player.userId);
  }
}

async function requireSeason(
  db: DatabaseExecutor,
  seasonId: string,
): Promise<typeof schema.seasons.$inferSelect> {
  const season = (await db.select().from(schema.seasons)
    .where(eq(schema.seasons.id, seasonId)).limit(1))[0];
  if (!season) throw new SeasonStateError("Season not found.", "season_not_found");
  return season;
}

async function requireSeasonForUpdate(
  tx: DrizzleTransaction,
  seasonId: string,
): Promise<typeof schema.seasons.$inferSelect> {
  await tx.execute(sql`SELECT id FROM seasons WHERE id = ${seasonId} FOR UPDATE`);
  return requireSeason(tx, seasonId);
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new SeasonStateError(`${label} is required.`, "invalid_state");
  return trimmed;
}

function normalizeOptionalTimestamp(value: string | null | undefined, label: string): string | null {
  return value == null ? null : normalizeTimestamp(value, label);
}

function normalizeTimestamp(value: string, label: string): string {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) {
    throw new SeasonStateError(`${label} must be a valid timestamp.`, "invalid_state");
  }
  return new Date(epoch).toISOString();
}

function parseGameConfig(value: string): {
  modelSelection?: GameModelSelection | null;
  modelTier?: string;
} {
  try {
    return JSON.parse(value) as {
      modelSelection?: GameModelSelection | null;
      modelTier?: string;
    };
  } catch {
    throw new SeasonStateError("Rated game has invalid configuration.", "rated_roster_invalid");
  }
}

function parseAgentConfig(value: string): { temperature?: number } {
  try {
    const parsed = JSON.parse(value) as { temperature?: unknown };
    if (parsed.temperature !== undefined && typeof parsed.temperature !== "number") {
      throw new Error("invalid temperature");
    }
    return { temperature: parsed.temperature as number | undefined };
  } catch {
    throw new SeasonStateError("Rated seat has invalid agent configuration.", "rated_roster_invalid");
  }
}
