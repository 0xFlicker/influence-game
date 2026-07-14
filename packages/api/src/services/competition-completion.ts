import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { buildCompletedGameResults } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import {
  COMPETITION_RATING_POLICY_VERSION,
  SEASON_SCORING_POLICY_VERSION,
  calculateChampionshipPointAward,
  initialCompetitionRating,
  rateCompetitionField,
} from "./season-policy.js";
import { REVISION_POLICY_VERSION } from "./revision-policy.js";

type DrizzleTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

export interface CompetitionCompletionInput {
  gameId: string;
  winnerId: string | null;
  roundsPlayed: number;
  earnedAt: string;
}

export interface CompetitionCompletionResult {
  processed: boolean;
  rated: boolean;
  eligible: boolean | null;
  eligibilityReason: string | null;
  receiptCount: number;
}

export class CompetitionSettlementRepairRequiredError extends Error {
  public readonly code = "competition_settlement_repair_required" as const;

  constructor(
    message: string,
    public readonly reason:
      | "owned_revision_missing"
      | "owned_revision_mismatch"
      | "pregame_snapshot_missing"
      | "pregame_snapshot_mismatch",
  ) {
    super(message);
    this.name = "CompetitionSettlementRepairRequiredError";
  }
}

export async function completeCompetitionGame(
  db: DrizzleDB,
  input: CompetitionCompletionInput,
): Promise<CompetitionCompletionResult> {
  return db.transaction((tx) => completeCompetitionGameInTransaction(tx, input));
}

export async function completeCompetitionGameInTransaction(
  tx: DrizzleTransaction,
  input: CompetitionCompletionInput,
): Promise<CompetitionCompletionResult> {
  const earnedAt = normalizeTimestamp(input.earnedAt);
  await tx.execute(sql`SELECT id FROM games WHERE id = ${input.gameId} FOR UPDATE`);
  const game = (await tx.select().from(schema.games)
    .where(eq(schema.games.id, input.gameId)).limit(1))[0];
  if (!game) throw new Error(`Competition game ${input.gameId} not found`);
  if (!game.seasonId) {
    return {
      processed: false,
      rated: false,
      eligible: null,
      eligibilityReason: null,
      receiptCount: 0,
    };
  }

  const season = (await tx.select().from(schema.seasons)
    .where(eq(schema.seasons.id, game.seasonId)).limit(1))[0];
  if (!season) throw new Error(`Competition season ${game.seasonId} not found`);
  const players = await tx.select().from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.gameId, input.gameId))
    .orderBy(asc(schema.gamePlayers.id));
  const malformedOwnedSeat = players.find((player) =>
    Boolean(player.userId) !== Boolean(player.agentProfileId)
  );
  if (malformedOwnedSeat) {
    throw new Error(
      `Competition seat ${malformedOwnedSeat.id} must pair an owner with a saved agent profile`,
    );
  }
  const ownedSeats = players.filter((player) => player.agentProfileId && player.userId);
  const uniqueOwnedSeats = [...new Map(
    ownedSeats.map((seat) => [seat.agentProfileId!, seat]),
  ).values()];

  const existingReceipts = await tx.select().from(schema.competitionReceipts)
    .where(eq(schema.competitionReceipts.gameId, input.gameId));
  if (existingReceipts.length > 0) {
    if (existingReceipts.length !== uniqueOwnedSeats.length
      || existingReceipts.some((receipt) => receipt.seasonId !== game.seasonId)) {
      throw new Error(`Competition game ${input.gameId} has partial or mismatched settlement`);
    }
    const eligible = existingReceipts.every((receipt) => receipt.eligibilityStatus === "eligible");
    return {
      processed: false,
      rated: true,
      eligible,
      eligibilityReason: eligible ? null : existingReceipts[0]?.eligibilityReason ?? "ineligible",
      receiptCount: existingReceipts.length,
    };
  }
  if (uniqueOwnedSeats.length === 0) {
    return {
      processed: false,
      rated: true,
      eligible: true,
      eligibilityReason: null,
      receiptCount: 0,
    };
  }

  const persistedEvents = await getPersistedGameEvents(tx, input.gameId);
  const completed = buildCompletedGameResults({
    events: persistedEvents.events.map((event) => event.envelope),
    eventLogStatus: persistedEvents.status,
    projectionStatus: persistedEvents.status === "complete" ? "complete" : "failed",
    terminalResult: {
      winnerId: input.winnerId,
      roundsPlayed: input.roundsPlayed,
    },
  });
  const placementByPlayerId = new Map(
    completed.players.flatMap((player) => player.placement === null
      ? []
      : [[player.id, player.placement] as const]),
  );
  const canonicalEligibilityReason = competitionIneligibilityReason({
    completed,
    players,
    ownedSeats,
    placementByPlayerId,
    declaredWinnerId: input.winnerId,
  });
  const canonicalWinnerId = completed.summary.winner?.id ?? null;

  const profileIds = uniqueOwnedSeats.map((seat) => seat.agentProfileId!).sort();
  await tx.execute(sql`
    SELECT id FROM agent_profiles
    WHERE id IN (${sql.join(profileIds.map((id) => sql`${id}`), sql`, `)})
    ORDER BY id
    FOR UPDATE
  `);
  const profiles = await tx.select().from(schema.agentProfiles)
    .where(inArray(schema.agentProfiles.id, profileIds));
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const seatRevisionIds = uniqueOwnedSeats.flatMap((seat) => (
    seat.agentRevisionId ? [seat.agentRevisionId] : []
  ));
  const revisions = seatRevisionIds.length === 0
    ? []
    : await tx.select().from(schema.agentRevisions)
      .where(inArray(schema.agentRevisions.id, seatRevisionIds));
  const revisionById = new Map<string, typeof schema.agentRevisions.$inferSelect>();
  for (const revision of revisions) {
    revisionById.set(revision.id, revision);
  }
  const ratings = await tx.select().from(schema.agentCompetitionRatings)
    .where(inArray(schema.agentCompetitionRatings.agentProfileId, profileIds));
  const ratingByProfile = new Map(ratings.map((rating) => [rating.agentProfileId, rating]));
  const snapshots = await tx.select().from(schema.competitionRatingSnapshots).where(and(
    eq(schema.competitionRatingSnapshots.gameId, input.gameId),
    inArray(schema.competitionRatingSnapshots.agentProfileId, profileIds),
  ));
  const snapshotByProfile = new Map(snapshots.map((snapshot) => [snapshot.agentProfileId, snapshot]));
  for (const seat of uniqueOwnedSeats) {
    if (!seat.agentRevisionId) {
      throw repairRequired(
        `Competition seat ${seat.id} is missing its pinned analytical revision.`,
        "owned_revision_missing",
      );
    }
    const revision = revisionById.get(seat.agentRevisionId);
    if (!revision || revision.agentProfileId !== seat.agentProfileId) {
      throw repairRequired(
        `Competition seat ${seat.id} has a mismatched pinned analytical revision.`,
        "owned_revision_mismatch",
      );
    }
    const snapshot = snapshotByProfile.get(seat.agentProfileId!);
    if (!snapshot) {
      throw repairRequired(
        `Competition seat ${seat.id} is missing its pregame rating snapshot.`,
        "pregame_snapshot_missing",
      );
    }
    if (snapshot.agentRevisionId !== seat.agentRevisionId
      || snapshot.ratingPolicyVersion !== COMPETITION_RATING_POLICY_VERSION) {
      throw repairRequired(
        `Competition seat ${seat.id} has mismatched pregame rating evidence.`,
        "pregame_snapshot_mismatch",
      );
    }
  }
  const eligibilityReason = canonicalEligibilityReason;
  const eligible = eligibilityReason === null;

  const ownerIds = [...new Set(uniqueOwnedSeats.map((seat) => seat.userId!))];
  const owners = await tx.select({ id: schema.users.id, displayName: schema.users.displayName })
    .from(schema.users).where(inArray(schema.users.id, ownerIds));
  const ownerNameById = new Map(owners.map((owner) => [owner.id, owner.displayName]));

  for (const seat of uniqueOwnedSeats) {
    const profileId = seat.agentProfileId!;
    if (!profilesById.has(profileId)) throw new Error(`Competition profile ${profileId} not found`);
    const seatRevision = revisionById.get(seat.agentRevisionId!)!;
    if (!ratingByProfile.has(profileId)) {
      const initial = initialCompetitionRating();
      const inserted = (await tx.insert(schema.agentCompetitionRatings).values({
        agentProfileId: profileId,
        effectiveRevisionId: seatRevision.id,
        mu: initial.mu,
        sigma: initial.sigma,
        gamesPlayed: 0,
        ratingPolicyVersion: COMPETITION_RATING_POLICY_VERSION,
        updatedAt: earnedAt,
      }).returning())[0];
      if (!inserted) throw new Error(`Competition rating initialization failed for ${profileId}`);
      ratingByProfile.set(profileId, inserted);
      await tx.insert(schema.competitionRatingEvents).values({
        id: randomUUID(),
        idempotencyKey: `initial:${profileId}`,
        agentProfileId: profileId,
        agentRevisionId: seatRevision.id,
        seasonId: game.seasonId,
        gameId: input.gameId,
        eventType: "initialization",
        beforeMu: null,
        beforeSigma: null,
        afterMu: initial.mu,
        afterSigma: initial.sigma,
        ratingPolicyVersion: COMPETITION_RATING_POLICY_VERSION,
        revisionPolicyVersion: REVISION_POLICY_VERSION,
        evidence: { source: "first_rated_game" },
        createdAt: earnedAt,
      });
    }
  }

  const ratingSeats = players.map((player) => {
    const placement = placementByPlayerId.get(player.id);
    if (placement === undefined) return null;
    const ownedRating = player.agentProfileId ? ratingByProfile.get(player.agentProfileId) : null;
    return {
      id: player.id,
      placement,
      rating: ownedRating
        ? { mu: ownedRating.mu, sigma: ownedRating.sigma }
        : initialCompetitionRating(),
    };
  }).filter((seat): seat is NonNullable<typeof seat> => seat !== null);
  const scoringSeats = players.map((player) => {
    const placement = placementByPlayerId.get(player.id);
    if (placement === undefined) return null;
    const snapshot = player.agentProfileId ? snapshotByProfile.get(player.agentProfileId) : null;
    return {
      id: player.id,
      placement,
      rating: snapshot
        ? { mu: snapshot.mu, sigma: snapshot.sigma }
        : initialCompetitionRating(),
    };
  }).filter((seat): seat is NonNullable<typeof seat> => seat !== null);
  const changes = eligible ? rateCompetitionField(ratingSeats) : [];
  const changeByPlayerId = new Map(changes.map((change) => [change.id, change]));

  for (const seat of uniqueOwnedSeats) {
    const profileId = seat.agentProfileId!;
    const ownerId = seat.userId!;
    const profile = profilesById.get(profileId)!;
    const revision = revisionById.get(seat.agentRevisionId!)!;
    const rating = ratingByProfile.get(profileId)!;
    const placement = placementByPlayerId.get(seat.id) ?? null;
    const change = changeByPlayerId.get(seat.id);
    const pregame = snapshotByProfile.get(profileId);
    const opponents = scoringSeats.filter((candidate) => candidate.id !== seat.id);
    const award = eligible && placement !== null
      ? calculateChampionshipPointAward({
        placement,
        totalPlayers: players.length,
        opponentRatings: opponents.map((opponent) => opponent.rating),
      })
      : null;
    const receiptId = randomUUID();
    await tx.insert(schema.competitionReceipts).values({
      id: receiptId,
      seasonId: game.seasonId,
      gameId: input.gameId,
      ownerId,
      agentProfileId: profileId,
      agentRevisionId: revision.id,
      ownerDisplayNameSnapshot: ownerNameById.get(ownerId) ?? null,
      agentNameSnapshot: profile.name,
      eligibilityStatus: eligible ? "eligible" : "ineligible",
      eligibilityReason,
      lobbySize: players.length,
      placement: eligible ? placement : null,
      basePoints: award?.basePoints ?? 0,
      fieldBonus: award?.fieldBonus ?? 0,
      totalPoints: award?.totalPoints ?? 0,
      scoringPolicyVersion: SEASON_SCORING_POLICY_VERSION,
      earnedAt,
      createdAt: earnedAt,
    });
    await tx.insert(schema.competitionReceiptEvidence).values({
      receiptId,
      ratingPolicyVersion: COMPETITION_RATING_POLICY_VERSION,
      pregameRating: { mu: pregame!.mu, sigma: pregame!.sigma },
      postgameRating: change ? { mu: change.after.mu, sigma: change.after.sigma } : null,
      opponentRatings: opponents.map((opponent) => ({
        playerId: opponent.id,
        mu: opponent.rating.mu,
        sigma: opponent.rating.sigma,
      })),
      fieldStrengthEvidence: award
        ? { ...award.fieldEvidence }
        : { reason: eligibilityReason, scoringSkipped: true },
      createdAt: earnedAt,
    });
    if (eligible && change) {
      await tx.insert(schema.competitionRatingEvents).values({
        id: randomUUID(),
        idempotencyKey: `game:${input.gameId}:agent:${profileId}`,
        agentProfileId: profileId,
        agentRevisionId: revision.id,
        seasonId: game.seasonId,
        gameId: input.gameId,
        eventType: "game_result",
        beforeMu: change.before.mu,
        beforeSigma: change.before.sigma,
        afterMu: change.after.mu,
        afterSigma: change.after.sigma,
        ratingPolicyVersion: COMPETITION_RATING_POLICY_VERSION,
        revisionPolicyVersion: REVISION_POLICY_VERSION,
        evidence: {
          placement,
          lobbySize: players.length,
          rankedPlayerIds: completed.summary.rankedPlayerIds,
        },
        createdAt: earnedAt,
      });
      await tx.update(schema.agentCompetitionRatings).set({
        mu: change.after.mu,
        sigma: change.after.sigma,
        gamesPlayed: rating.gamesPlayed + 1,
        ratingPolicyVersion: COMPETITION_RATING_POLICY_VERSION,
        updatedAt: earnedAt,
      }).where(eq(schema.agentCompetitionRatings.agentProfileId, profileId));
    }
    await tx.execute(sql`
      UPDATE agent_profiles
      SET games_played = games_played + 1,
          games_won = games_won + ${seat.id === canonicalWinnerId ? 1 : 0},
          updated_at = ${earnedAt}
      WHERE id = ${profileId}
    `);
  }

  return {
    processed: true,
    rated: true,
    eligible,
    eligibilityReason,
    receiptCount: uniqueOwnedSeats.length,
  };
}

function normalizeTimestamp(value: string): string {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new Error("Competition completion requires a valid earnedAt timestamp");
  return new Date(epoch).toISOString();
}

function competitionIneligibilityReason(input: {
  completed: ReturnType<typeof buildCompletedGameResults>;
  players: ReadonlyArray<typeof schema.gamePlayers.$inferSelect>;
  ownedSeats: ReadonlyArray<typeof schema.gamePlayers.$inferSelect>;
  placementByPlayerId: ReadonlyMap<string, number>;
  declaredWinnerId: string | null;
}): string | null {
  const ownerIds = input.ownedSeats.map((seat) => seat.userId!);
  if (new Set(ownerIds).size !== ownerIds.length) return "duplicate_owner_seats";
  if (input.completed.source !== "durable_canonical_events"
    || input.completed.availability.status !== "available"
    || !input.completed.summary.winner) {
    return "canonical_results_unavailable";
  }
  if (input.completed.summary.winner.id !== input.declaredWinnerId) {
    return "canonical_terminal_mismatch";
  }
  const rosterIds = new Set(input.players.map((player) => player.id));
  const resultIds = new Set(input.completed.players.map((player) => player.id));
  if (rosterIds.size !== resultIds.size || [...rosterIds].some((id) => !resultIds.has(id))) {
    return "canonical_roster_mismatch";
  }
  if (input.players.some((player) => !input.placementByPlayerId.has(player.id))) {
    return "canonical_ranking_incomplete";
  }
  return null;
}

function repairRequired(
  message: string,
  reason: ConstructorParameters<typeof CompetitionSettlementRepairRequiredError>[1],
): CompetitionSettlementRepairRequiredError {
  return new CompetitionSettlementRepairRequiredError(message, reason);
}
