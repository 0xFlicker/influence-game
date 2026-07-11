import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  calculateArchitectScore,
  compareAgentStandings,
  compareArchitectStandings,
  earliestFinalTotalReachedAt,
} from "./season-policy.js";

const DEFAULT_EXPORT_LIMIT = 1_000;
const MAX_EXPORT_LIMIT = 5_000;

export interface PublicSeasonIdentity {
  id: string;
  slug: string;
  name: string;
  status: typeof schema.seasons.$inferSelect.status;
  ratedPool: "free";
  admissionStartsAt: string | null;
  admissionClosesAt: string | null;
  finalizedAt: string | null;
}

export interface PublicAgentStanding {
  rank: number;
  agentId: string;
  agentName: string;
  ownerId: string;
  ownerName: string | null;
  totalPoints: number;
  gamesPlayed: number;
  wins: number;
  runnerUpFinishes: number;
  averageNormalizedPlacement: number;
}

export interface PublicArchitectContribution {
  agentId: string;
  agentName: string;
  sourcePoints: number;
  weightPercent: 100 | 50 | 25;
  weightedPointsHundredths: number;
}

export interface PublicArchitectStanding {
  rank: number;
  ownerId: string;
  ownerName: string | null;
  totalPointsHundredths: number;
  wins: number;
  contributions: PublicArchitectContribution[];
}

export interface PublicCompetitionReceipt {
  gameId: string;
  gameSlug: string | null;
  agentId: string;
  agentName: string;
  ownerId: string;
  ownerName: string | null;
  lobbySize: number;
  placement: number | null;
  basePoints: number;
  fieldBonus: number;
  totalPoints: number;
  eligibilityStatus: "eligible" | "ineligible";
  eligibilityReason: string | null;
  accountRatingDelta: number | null;
  earnedAt: string;
}

export interface OwnedCompetitionReceipt extends PublicCompetitionReceipt {
  revisionId: string;
}

export interface PublicSeasonDashboard {
  schemaVersion: 1;
  season: PublicSeasonIdentity;
  agentStandings: PublicAgentStanding[];
  architectStandings: PublicArchitectStanding[];
  honors: null | {
    agentChampion: { agentId: string; agentName: string; ownerId: string; ownerName: string | null; points: number };
    architectChampion: { ownerId: string; ownerName: string | null; pointsHundredths: number; contributions: Array<Record<string, unknown>> };
  };
}

export async function listPublicSeasons(db: DrizzleDB): Promise<PublicSeasonIdentity[]> {
  const rows = await db.select({
    id: schema.seasons.id,
    slug: schema.seasons.slug,
    name: schema.seasons.name,
    status: schema.seasons.status,
    ratedPool: schema.seasons.ratedPool,
    admissionStartsAt: schema.seasons.admissionStartsAt,
    admissionClosesAt: schema.seasons.admissionClosesAt,
    finalizedAt: schema.seasons.finalizedAt,
  }).from(schema.seasons).orderBy(desc(schema.seasons.createdAt));
  return rows;
}

export async function getPublicSeasonDashboard(
  db: DrizzleDB,
  idOrSlug: string,
): Promise<PublicSeasonDashboard | null> {
  const seasonRow = await resolveSeason(db, idOrSlug);
  if (!seasonRow) return null;
  const season = publicSeasonIdentity(seasonRow);
  const receipts = await loadPublicReceiptRows(db, season.id);
  const eligible = receipts.filter((receipt) => receipt.eligibilityStatus === "eligible");
  const agentStandings = buildAgentStandings(eligible);
  const architectStandings = buildArchitectStandings(agentStandings, eligible);
  const honor = (await db.select({
    agentChampionAgentProfileId: schema.seasonHonors.agentChampionAgentProfileId,
    agentChampionOwnerId: schema.seasonHonors.agentChampionOwnerId,
    agentChampionNameSnapshot: schema.seasonHonors.agentChampionNameSnapshot,
    agentChampionOwnerNameSnapshot: schema.seasonHonors.agentChampionOwnerNameSnapshot,
    agentChampionPoints: schema.seasonHonors.agentChampionPoints,
    architectChampionOwnerId: schema.seasonHonors.architectChampionOwnerId,
    architectChampionOwnerNameSnapshot: schema.seasonHonors.architectChampionOwnerNameSnapshot,
    architectChampionPointsHundredths: schema.seasonHonors.architectChampionPointsHundredths,
    architectContributions: schema.seasonHonors.architectContributions,
  }).from(schema.seasonHonors).where(eq(schema.seasonHonors.seasonId, season.id)).limit(1))[0];
  return {
    schemaVersion: 1,
    season,
    agentStandings,
    architectStandings,
    honors: honor ? {
      agentChampion: {
        agentId: honor.agentChampionAgentProfileId,
        agentName: honor.agentChampionNameSnapshot,
        ownerId: honor.agentChampionOwnerId,
        ownerName: honor.agentChampionOwnerNameSnapshot,
        points: honor.agentChampionPoints,
      },
      architectChampion: {
        ownerId: honor.architectChampionOwnerId,
        ownerName: honor.architectChampionOwnerNameSnapshot,
        pointsHundredths: honor.architectChampionPointsHundredths,
        contributions: honor.architectContributions,
      },
    } : null,
  };
}

export async function getPublicGameCompetitionReceipts(
  db: DrizzleDB,
  seasonIdOrSlug: string,
  gameIdOrSlug: string,
): Promise<{ season: PublicSeasonIdentity; receipts: PublicCompetitionReceipt[] } | null> {
  const season = await resolveSeason(db, seasonIdOrSlug);
  if (!season) return null;
  const game = (await db.select({ id: schema.games.id, seasonId: schema.games.seasonId }).from(schema.games)
    .where(or(eq(schema.games.id, gameIdOrSlug), eq(schema.games.slug, gameIdOrSlug))).limit(1))[0];
  if (!game || game.seasonId !== season.id) return null;
  const receipts = (await loadPublicReceiptRows(db, season.id))
    .filter((receipt) => receipt.gameId === game.id)
    .map(publicReceipt);
  return { season: publicSeasonIdentity(season), receipts };
}

export async function getOwnedAgentSeasonAnalysis(
  db: DrizzleDB,
  input: { seasonIdOrSlug: string; agentId: string; ownerId: string },
): Promise<null | {
  schemaVersion: 1;
  season: PublicSeasonIdentity;
  agent: { id: string; name: string };
  summary: {
    totalPoints: number;
    gamesPlayed: number;
    wins: number;
    averagePlacement: number | null;
    placementDistribution: Record<string, number>;
  };
  revisions: Array<{
    revisionId: string;
    ordinal: number;
    gamesPlayed: number;
    wins: number;
    totalPoints: number;
    averagePlacement: number | null;
  }>;
  receipts: OwnedCompetitionReceipt[];
}> {
  const season = await resolveSeason(db, input.seasonIdOrSlug);
  if (!season) return null;
  const profile = (await db.select({ id: schema.agentProfiles.id, name: schema.agentProfiles.name })
    .from(schema.agentProfiles).where(and(
      eq(schema.agentProfiles.id, input.agentId),
      eq(schema.agentProfiles.userId, input.ownerId),
    )).limit(1))[0];
  if (!profile) return null;
  const rows = (await loadPublicReceiptRows(db, season.id))
    .filter((receipt) => receipt.agentProfileId === input.agentId);
  const revisions = await db.select({ id: schema.agentRevisions.id, ordinal: schema.agentRevisions.ordinal })
    .from(schema.agentRevisions).where(eq(schema.agentRevisions.agentProfileId, input.agentId));
  const ordinalById = new Map(revisions.map((revision) => [revision.id, revision.ordinal]));
  const eligible = rows.filter((row) => row.eligibilityStatus === "eligible");
  const revisionGroups = new Map<string, typeof eligible>();
  for (const row of eligible) {
    const group = revisionGroups.get(row.agentRevisionId) ?? [];
    group.push(row);
    revisionGroups.set(row.agentRevisionId, group);
  }
  const placementDistribution: Record<string, number> = {};
  for (const row of eligible) {
    const key = String(row.placement);
    placementDistribution[key] = (placementDistribution[key] ?? 0) + 1;
  }
  return {
    schemaVersion: 1,
    season: publicSeasonIdentity(season),
    agent: profile,
    summary: {
      totalPoints: eligible.reduce((sum, row) => sum + row.totalPoints, 0),
      gamesPlayed: eligible.length,
      wins: eligible.filter((row) => row.placement === 1).length,
      averagePlacement: average(eligible.flatMap((row) => row.placement === null ? [] : [row.placement])),
      placementDistribution,
    },
    revisions: [...revisionGroups.entries()].map(([revisionId, group]) => ({
      revisionId,
      ordinal: ordinalById.get(revisionId) ?? 0,
      gamesPlayed: group.length,
      wins: group.filter((row) => row.placement === 1).length,
      totalPoints: group.reduce((sum, row) => sum + row.totalPoints, 0),
      averagePlacement: average(group.flatMap((row) => row.placement === null ? [] : [row.placement])),
    })).sort((left, right) => left.ordinal - right.ordinal),
    receipts: rows.map(ownerReceipt),
  };
}

export async function exportOwnedSeasonReceipts(
  db: DrizzleDB,
  input: {
    seasonIdOrSlug: string;
    ownerId: string;
    agentId?: string;
    format: "json" | "csv";
    limit?: number;
  },
): Promise<null | {
  contentType: "application/json" | "text/csv";
  filename: string;
  body: string;
  rowCount: number;
  truncated: boolean;
}> {
  const season = await resolveSeason(db, input.seasonIdOrSlug);
  if (!season) return null;
  const allRows = (await loadPublicReceiptRows(db, season.id))
    .filter((receipt) => receipt.ownerId === input.ownerId)
    .filter((receipt) => !input.agentId || receipt.agentProfileId === input.agentId);
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_EXPORT_LIMIT, MAX_EXPORT_LIMIT));
  const rows = allRows.slice(0, limit).map(ownerReceipt);
  if (input.format === "json") {
    return {
      contentType: "application/json",
      filename: `${season.slug}-agent-data.json`,
      body: JSON.stringify({ schemaVersion: 1, season: publicSeasonIdentity(season), receipts: rows }, null, 2),
      rowCount: rows.length,
      truncated: allRows.length > rows.length,
    };
  }
  const headers = [
    "gameId", "gameSlug", "agentId", "agentName", "revisionId", "lobbySize", "placement",
    "basePoints", "fieldBonus", "totalPoints", "eligibilityStatus", "eligibilityReason",
    "accountRatingDelta", "earnedAt",
  ] as const;
  const body = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
  return {
    contentType: "text/csv",
    filename: `${season.slug}-agent-data.csv`,
    body,
    rowCount: rows.length,
    truncated: allRows.length > rows.length,
  };
}

export async function getProducerSeasonDiagnostics(
  db: DrizzleDB,
  seasonIdOrSlug: string,
): Promise<null | {
  schemaVersion: 1;
  seasonId: string;
  season: {
    status: SeasonRow["status"];
  };
  readiness: {
    assignedGames: number;
    nonTerminalGames: number;
    unsettledOwnedSeats: number;
    canFinalize: boolean;
  };
  ratings: Array<{
    agentProfileId: string;
    effectiveRevisionId: string;
    mu: number;
    sigma: number;
    gamesPlayed: number;
    ratingPolicyVersion: string;
  }>;
  ratingEvents: Array<typeof schema.competitionRatingEvents.$inferSelect>;
  ratingSnapshots: Array<typeof schema.competitionRatingSnapshots.$inferSelect>;
  receiptEvidence: Array<typeof schema.competitionReceiptEvidence.$inferSelect>;
  revisions: Array<typeof schema.agentRevisions.$inferSelect>;
}> {
  const season = await resolveSeason(db, seasonIdOrSlug);
  if (!season) return null;
  const receiptRows = await db.select({
    id: schema.competitionReceipts.id,
    agentProfileId: schema.competitionReceipts.agentProfileId,
  }).from(schema.competitionReceipts).where(eq(schema.competitionReceipts.seasonId, season.id));
  const receiptIds = receiptRows.map((receipt) => receipt.id);
  const agentIds = [...new Set(receiptRows.map((receipt) => receipt.agentProfileId))];
  const ratingEvents = await db.select().from(schema.competitionRatingEvents)
    .where(agentIds.length === 0
      ? eq(schema.competitionRatingEvents.seasonId, season.id)
      : or(
        eq(schema.competitionRatingEvents.seasonId, season.id),
        and(
          eq(schema.competitionRatingEvents.eventType, "revision_recalibration"),
          inArray(schema.competitionRatingEvents.agentProfileId, agentIds),
        ),
      ))
    .orderBy(asc(schema.competitionRatingEvents.createdAt));
  const ratings = agentIds.length === 0 ? [] : await db.select({
    agentProfileId: schema.agentCompetitionRatings.agentProfileId,
    effectiveRevisionId: schema.agentCompetitionRatings.effectiveRevisionId,
    mu: schema.agentCompetitionRatings.mu,
    sigma: schema.agentCompetitionRatings.sigma,
    gamesPlayed: schema.agentCompetitionRatings.gamesPlayed,
    ratingPolicyVersion: schema.agentCompetitionRatings.ratingPolicyVersion,
  }).from(schema.agentCompetitionRatings)
    .where(inArray(schema.agentCompetitionRatings.agentProfileId, agentIds));
  const receiptEvidence = receiptIds.length === 0 ? [] : await db.select()
    .from(schema.competitionReceiptEvidence)
    .where(inArray(schema.competitionReceiptEvidence.receiptId, receiptIds));
  const revisions = agentIds.length === 0 ? [] : await db.select().from(schema.agentRevisions)
    .where(inArray(schema.agentRevisions.agentProfileId, agentIds))
    .orderBy(asc(schema.agentRevisions.agentProfileId), asc(schema.agentRevisions.ordinal));
  const games = await db.select({ id: schema.games.id, status: schema.games.status })
    .from(schema.games).where(eq(schema.games.seasonId, season.id));
  const gameIds = games.map((game) => game.id);
  const ratingSnapshots = gameIds.length === 0 ? [] : await db.select()
    .from(schema.competitionRatingSnapshots)
    .where(inArray(schema.competitionRatingSnapshots.gameId, gameIds))
    .orderBy(asc(schema.competitionRatingSnapshots.capturedAt));
  const completedGameIds = games.filter((game) => game.status === "completed").map((game) => game.id);
  const ownedSeats = completedGameIds.length === 0 ? [] : (await db.select({
    gameId: schema.gamePlayers.gameId,
    agentProfileId: schema.gamePlayers.agentProfileId,
  }).from(schema.gamePlayers).where(inArray(schema.gamePlayers.gameId, completedGameIds)))
    .filter((seat) => seat.agentProfileId !== null);
  const receipts = await db.select({
    gameId: schema.competitionReceipts.gameId,
    agentProfileId: schema.competitionReceipts.agentProfileId,
    eligibilityStatus: schema.competitionReceipts.eligibilityStatus,
  }).from(schema.competitionReceipts).where(eq(schema.competitionReceipts.seasonId, season.id));
  const receiptKeys = new Set(receipts.map((receipt) => `${receipt.gameId}:${receipt.agentProfileId}`));
  const unsettledOwnedSeats = ownedSeats.filter((seat) =>
    !receiptKeys.has(`${seat.gameId}:${seat.agentProfileId}`)
  ).length;
  const nonTerminalGames = games.filter((game) => game.status !== "completed" && game.status !== "cancelled").length;
  const eligibleReceiptCount = receipts.filter((receipt) => receipt.eligibilityStatus === "eligible").length;
  return {
    schemaVersion: 1,
    seasonId: season.id,
    season: {
      status: season.status,
    },
    readiness: {
      assignedGames: games.length,
      nonTerminalGames,
      unsettledOwnedSeats,
      canFinalize: season.status === "closing" && nonTerminalGames === 0
        && unsettledOwnedSeats === 0 && eligibleReceiptCount > 0,
    },
    ratings,
    ratingEvents,
    ratingSnapshots,
    receiptEvidence,
    revisions,
  };
}

type SeasonRow = typeof schema.seasons.$inferSelect;
type ReceiptReadRow = Awaited<ReturnType<typeof loadPublicReceiptRows>>[number];

async function resolveSeason(db: DrizzleDB, idOrSlug: string): Promise<SeasonRow | null> {
  return (await db.select().from(schema.seasons)
    .where(or(eq(schema.seasons.id, idOrSlug), eq(schema.seasons.slug, idOrSlug))).limit(1))[0] ?? null;
}

function publicSeasonIdentity(row: SeasonRow): PublicSeasonIdentity {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    ratedPool: row.ratedPool,
    admissionStartsAt: row.admissionStartsAt,
    admissionClosesAt: row.admissionClosesAt,
    finalizedAt: row.finalizedAt,
  };
}

async function loadPublicReceiptRows(db: DrizzleDB, seasonId: string) {
  return db.select({
    id: schema.competitionReceipts.id,
    gameId: schema.competitionReceipts.gameId,
    gameSlug: schema.games.slug,
    ownerId: schema.competitionReceipts.ownerId,
    agentProfileId: schema.competitionReceipts.agentProfileId,
    agentRevisionId: schema.competitionReceipts.agentRevisionId,
    ownerDisplayNameSnapshot: schema.competitionReceipts.ownerDisplayNameSnapshot,
    agentNameSnapshot: schema.competitionReceipts.agentNameSnapshot,
    eligibilityStatus: schema.competitionReceipts.eligibilityStatus,
    eligibilityReason: schema.competitionReceipts.eligibilityReason,
    lobbySize: schema.competitionReceipts.lobbySize,
    placement: schema.competitionReceipts.placement,
    basePoints: schema.competitionReceipts.basePoints,
    fieldBonus: schema.competitionReceipts.fieldBonus,
    totalPoints: schema.competitionReceipts.totalPoints,
    accountRatingDelta: schema.competitionReceipts.accountRatingDelta,
    earnedAt: schema.competitionReceipts.earnedAt,
  }).from(schema.competitionReceipts)
    .innerJoin(schema.games, eq(schema.competitionReceipts.gameId, schema.games.id))
    .where(eq(schema.competitionReceipts.seasonId, seasonId))
    .orderBy(asc(schema.competitionReceipts.earnedAt), asc(schema.competitionReceipts.id));
}

function buildAgentStandings(rows: ReceiptReadRow[]): PublicAgentStanding[] {
  const groups = new Map<string, ReceiptReadRow[]>();
  for (const row of rows) {
    const group = groups.get(row.agentProfileId) ?? [];
    group.push(row);
    groups.set(row.agentProfileId, group);
  }
  const standingInputs = [...groups.entries()].map(([agentId, group]) => ({
    agentId,
    agentName: group.at(-1)!.agentNameSnapshot,
    ownerId: group[0]!.ownerId,
    ownerName: group.at(-1)!.ownerDisplayNameSnapshot,
    totalPoints: group.reduce((sum, row) => sum + row.totalPoints, 0),
    gamesPlayed: group.length,
    wins: group.filter((row) => row.placement === 1).length,
    runnerUpFinishes: group.filter((row) => row.placement === 2).length,
    averageNormalizedPlacement: average(group.map((row) =>
      (row.lobbySize - (row.placement ?? row.lobbySize)) / (row.lobbySize - 1))) ?? 0,
    tiedTotalReachedAt: earliestFinalTotalReachedAt(group),
  })).sort(compareAgentStandings);
  return standingInputs.map((standing, index) => ({
    rank: index + 1,
    agentId: standing.agentId,
    agentName: standing.agentName,
    ownerId: standing.ownerId,
    ownerName: standing.ownerName,
    totalPoints: standing.totalPoints,
    gamesPlayed: standing.gamesPlayed,
    wins: standing.wins,
    runnerUpFinishes: standing.runnerUpFinishes,
    averageNormalizedPlacement: standing.averageNormalizedPlacement,
  }));
}

function buildArchitectStandings(
  agents: PublicAgentStanding[],
  receipts: ReceiptReadRow[],
): PublicArchitectStanding[] {
  const groups = new Map<string, PublicAgentStanding[]>();
  for (const agent of agents) {
    const group = groups.get(agent.ownerId) ?? [];
    group.push(agent);
    groups.set(agent.ownerId, group);
  }
  const inputs = [...groups.entries()].map(([ownerId, group]) => {
    const score = calculateArchitectScore(group.map((agent) => ({
      agentId: agent.agentId,
      totalPoints: agent.totalPoints,
    })));
    const agentById = new Map(group.map((agent) => [agent.agentId, agent]));
    const reachedAtByAgent = new Map(group.map((agent) => [
      agent.agentId,
      earliestFinalTotalReachedAt(receipts.filter((receipt) => receipt.agentProfileId === agent.agentId)),
    ]));
    return {
      ownerId,
      ownerName: group[0]!.ownerName,
      totalPointsHundredths: score.totalPointsHundredths,
      contributingWins: score.contributions.reduce(
        (sum, contribution) => sum + (agentById.get(contribution.agentId)?.wins ?? 0), 0,
      ),
      firstAgentPoints: score.contributions[0]?.sourcePoints ?? 0,
      tiedTotalReachedAt: score.contributions
        .map((contribution) => reachedAtByAgent.get(contribution.agentId) ?? "")
        .sort()
        .at(-1) ?? "",
      contributions: score.contributions.map((contribution) => ({
        agentId: contribution.agentId,
        agentName: agentById.get(contribution.agentId)?.agentName ?? contribution.agentId,
        sourcePoints: contribution.sourcePoints,
        weightPercent: contribution.weightPercent,
        weightedPointsHundredths: contribution.weightedPointsHundredths,
      })),
    };
  }).sort(compareArchitectStandings);
  return inputs.map((input, index) => ({
    rank: index + 1,
    ownerId: input.ownerId,
    ownerName: input.ownerName,
    totalPointsHundredths: input.totalPointsHundredths,
    wins: input.contributingWins,
    contributions: input.contributions,
  }));
}

function publicReceipt(row: ReceiptReadRow): PublicCompetitionReceipt {
  return {
    gameId: row.gameId,
    gameSlug: row.gameSlug,
    agentId: row.agentProfileId,
    agentName: row.agentNameSnapshot,
    ownerId: row.ownerId,
    ownerName: row.ownerDisplayNameSnapshot,
    lobbySize: row.lobbySize,
    placement: row.placement,
    basePoints: row.basePoints,
    fieldBonus: row.fieldBonus,
    totalPoints: row.totalPoints,
    eligibilityStatus: row.eligibilityStatus,
    eligibilityReason: row.eligibilityReason,
    accountRatingDelta: row.accountRatingDelta,
    earnedAt: row.earnedAt,
  };
}

function ownerReceipt(row: ReceiptReadRow): OwnedCompetitionReceipt {
  return { ...publicReceipt(row), revisionId: row.agentRevisionId };
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@]/.test(text.trimStart())) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
