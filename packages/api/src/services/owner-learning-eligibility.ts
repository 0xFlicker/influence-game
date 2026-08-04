import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { GameStatus } from "../db/schema.js";
import {
  OWNER_LEARNING_ELIGIBILITY_POLICY_VERSION,
  parseOwnerLearningGameIds,
  type OwnerLearningAnalysisStatus,
  type OwnerLearningAnalysisTrack,
  type OwnerLearningStage,
} from "./owner-learning-contracts.js";

const OWNER_LEARNING_ROLLING_START_MS = 24 * 60 * 60 * 1_000;
type OwnerLearningEligibilityDB = Pick<DrizzleDB, "select">;

export interface OwnerLearningGameEligibilityCandidate {
  gameId: string;
  status: GameStatus | string;
  trackType: string;
  completionAt: string | null;
  agentProfileId: string | null;
  analyticalRevisionId: string | null;
}

export const ownerLearningGameEligibilityPolicy = Object.freeze({
  version: OWNER_LEARNING_ELIGIBILITY_POLICY_VERSION,
  admits(candidate: OwnerLearningGameEligibilityCandidate): boolean {
    return candidate.status === "completed"
      && candidate.trackType === "free"
      && candidate.completionAt != null
      && candidate.agentProfileId != null
      && candidate.analyticalRevisionId != null;
  },
});

export interface OwnerLearningCompletionCoordinate {
  gameId: string;
  completionAt: string;
}

export interface OwnerLearningCredit {
  balance: 0 | 1;
  latestEligibleCompletion: OwnerLearningCompletionCoordinate | null;
  refillCompletion: OwnerLearningCompletionCoordinate | null;
  qualifyingCompletionCount: number;
}

export function compareOwnerLearningCompletion(
  left: OwnerLearningCompletionCoordinate,
  right: OwnerLearningCompletionCoordinate,
): number {
  const timeComparison = left.completionAt.localeCompare(right.completionAt);
  return timeComparison !== 0 ? timeComparison : left.gameId.localeCompare(right.gameId);
}

export function deriveOwnerLearningCredit(
  completions: readonly OwnerLearningCompletionCoordinate[],
  consumedWatermark: OwnerLearningCompletionCoordinate | null,
): OwnerLearningCredit {
  const ordered = dedupeCompletionCoordinates(completions)
    .sort(compareOwnerLearningCompletion);
  const latestEligibleCompletion = ordered.at(-1) ?? null;
  const refillCompletion = ordered.find((completion) =>
    consumedWatermark == null || compareOwnerLearningCompletion(completion, consumedWatermark) > 0
  ) ?? null;
  return {
    balance: refillCompletion == null ? 0 : 1,
    latestEligibleCompletion,
    refillCompletion,
    qualifyingCompletionCount: ordered.length,
  };
}

export type OwnerLearningNarrativeCoverage = "rich" | "thin";

export interface OwnerLearningEvidenceClassificationInput {
  eliminatedRound: number | null;
  narrativeCoverage: OwnerLearningNarrativeCoverage;
}

export function classifyOwnerLearningEvidence(
  games: readonly OwnerLearningEvidenceClassificationInput[],
): OwnerLearningAnalysisTrack {
  if (games.length < 1 || games.length > 3) {
    throw new Error("Owner learning evidence classification requires one to three games");
  }
  const allEarlyExits = games.every((game) =>
    game.eliminatedRound === 1 || game.eliminatedRound === 2
  );
  if (games.length === 3 && allEarlyExits) return "strategy_health_check";
  if (games.length <= 2 && allEarlyExits && games.every((game) => game.narrativeCoverage === "thin")) {
    return "awaiting_evidence";
  }
  return "evidence_rich";
}

export interface OwnerLearningEligibleGame {
  gameId: string;
  slug: string;
  playerId: string;
  completionAt: string;
  analyticalRevisionId: string;
  transcriptCaptureVersion: number;
  cognitiveArtifactCaptureVersion: number;
  previouslyAnalyzed: boolean;
}

export interface OwnerLearningEligibleProfile {
  agentProfileId: string;
  name: string;
  currentRevisionId: string;
  strategyStyle: string | null;
  qualifyingGameCount: number;
  games: OwnerLearningEligibleGame[];
  recommendedGameIds: string[];
}

export interface OwnerLearningOpenReviewSummary {
  id: string;
  agentProfileId: string;
  analysisStatus: OwnerLearningAnalysisStatus;
  stage: OwnerLearningStage;
  analysisTrack: Exclude<OwnerLearningAnalysisTrack, "awaiting_evidence">;
}

export interface OwnerLearningEligibleInputs {
  eligibilityPolicyVersion: typeof OWNER_LEARNING_ELIGIBILITY_POLICY_VERSION;
  credit: OwnerLearningCredit;
  rollingAllowance: {
    available: boolean;
    nextEligibleAt: string | null;
  };
  profiles: OwnerLearningEligibleProfile[];
  recommendedAgentProfileId: string | null;
  prompt: {
    threshold: 1 | 3 | null;
    prominent: boolean;
    suppressedByDismissal: boolean;
  };
  openReview: OwnerLearningOpenReviewSummary | null;
}

export interface OwnerLearningValidatedSelection {
  ownerUserId: string;
  agentProfileId: string;
  agentProfileName: string;
  currentRevisionId: string;
  strategyStyle: string | null;
  games: OwnerLearningEligibleGame[];
}

export class OwnerLearningEligibilityError extends Error {
  constructor(
    readonly code: "profile_unavailable" | "selection_unavailable",
    message = "Owner learning input is unavailable",
  ) {
    super(message);
    this.name = "OwnerLearningEligibilityError";
  }
}

export async function getOwnerLearningEligibleInputs(
  db: OwnerLearningEligibilityDB,
  input: { ownerUserId: string; now?: Date },
): Promise<OwnerLearningEligibleInputs> {
  const now = input.now ?? new Date();
  const [profileRows, seatRows, entitlementRows, openReviewRows, successfulReviewGameRows] = await Promise.all([
    db.select({
      agentProfileId: schema.agentProfiles.id,
      name: schema.agentProfiles.name,
      currentRevisionId: schema.agentProfiles.currentRevisionId,
      strategyStyle: schema.agentProfiles.strategyStyle,
    }).from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.userId, input.ownerUserId)),
    loadOwnedEligibleSeatRows(db, input.ownerUserId),
    db.select().from(schema.agentLearningReviewEntitlements)
      .where(eq(schema.agentLearningReviewEntitlements.ownerUserId, input.ownerUserId))
      .limit(1),
    db.select({
      id: schema.agentLearningReviews.id,
      agentProfileId: schema.agentLearningReviews.agentProfileId,
      analysisStatus: schema.agentLearningReviews.analysisStatus,
      stage: schema.agentLearningReviews.stage,
      analysisTrack: schema.agentLearningReviews.analysisTrack,
    }).from(schema.agentLearningReviews)
      .where(and(
        eq(schema.agentLearningReviews.ownerUserId, input.ownerUserId),
        sql`${schema.agentLearningReviews.resolvedAt} IS NULL`,
      ))
      .limit(1),
    db.select({ gameId: schema.agentLearningReviewGames.gameId })
      .from(schema.agentLearningReviewGames)
      .innerJoin(
        schema.agentLearningReviews,
        eq(schema.agentLearningReviewGames.reviewId, schema.agentLearningReviews.id),
      )
      .where(and(
        eq(schema.agentLearningReviews.ownerUserId, input.ownerUserId),
        inArray(schema.agentLearningReviews.analysisStatus, ["ready", "no_change"]),
      )),
  ]);

  const admittedRows = seatRows.filter(ownerLearningGameEligibilityPolicy.admits);
  const uniqueCompletions = dedupeCompletionCoordinates(admittedRows.map((row) => ({
    gameId: row.gameId,
    completionAt: row.completionAt!,
  })));
  const entitlement = entitlementRows[0] ?? null;
  const consumedWatermark = entitlement?.consumedCompletionAt && entitlement.consumedGameId
    ? { completionAt: entitlement.consumedCompletionAt, gameId: entitlement.consumedGameId }
    : null;
  const credit = deriveOwnerLearningCredit(uniqueCompletions, consumedWatermark);
  const analyzedGameIds = new Set(successfulReviewGameRows.map((row) => row.gameId));
  const currentProfileRows = new Map(profileRows.flatMap((profile) =>
    profile.currentRevisionId == null ? [] : [[profile.agentProfileId, profile] as const]
  ));
  const gamesByProfile = new Map<string, OwnerLearningEligibleGame[]>();

  for (const row of admittedRows) {
    const profile = currentProfileRows.get(row.agentProfileId!);
    if (!profile || row.analyticalRevisionId !== profile.currentRevisionId) continue;
    const games = gamesByProfile.get(row.agentProfileId!) ?? [];
    if (games.some((game) => game.gameId === row.gameId)) continue;
    games.push({
      gameId: row.gameId,
      slug: row.slug,
      playerId: row.playerId,
      completionAt: row.completionAt!,
      analyticalRevisionId: row.analyticalRevisionId!,
      transcriptCaptureVersion: row.transcriptCaptureVersion,
      cognitiveArtifactCaptureVersion: row.cognitiveArtifactCaptureVersion,
      previouslyAnalyzed: analyzedGameIds.has(row.gameId),
    });
    gamesByProfile.set(row.agentProfileId!, games);
  }

  const profiles = profileRows.flatMap((profile): OwnerLearningEligibleProfile[] => {
    if (profile.currentRevisionId == null) return [];
    const games = (gamesByProfile.get(profile.agentProfileId) ?? [])
      .sort((left, right) => -compareOwnerLearningCompletion(left, right));
    if (games.length === 0) return [];
    return [{
      agentProfileId: profile.agentProfileId,
      name: profile.name,
      currentRevisionId: profile.currentRevisionId,
      strategyStyle: profile.strategyStyle,
      qualifyingGameCount: games.length,
      games,
      recommendedGameIds: [...games]
        .sort((left, right) => Number(left.previouslyAnalyzed) - Number(right.previouslyAnalyzed)
          || -compareOwnerLearningCompletion(left, right))
        .slice(0, 3)
        .map((game) => game.gameId),
    }];
  }).sort((left, right) =>
    -compareOwnerLearningCompletion(left.games[0]!, right.games[0]!)
  );

  const latestProfileCompletionCount = profiles[0]?.qualifyingGameCount ?? 0;
  const threshold = latestProfileCompletionCount >= 3 ? 3 : latestProfileCompletionCount >= 1 ? 1 : null;
  const dismissalWatermark = entitlement?.dismissedCompletionAt && entitlement.dismissedGameId
    ? { completionAt: entitlement.dismissedCompletionAt, gameId: entitlement.dismissedGameId }
    : null;
  const suppressedByDismissal = credit.latestEligibleCompletion != null
    && dismissalWatermark != null
    && compareOwnerLearningCompletion(credit.latestEligibleCompletion, dismissalWatermark) <= 0;
  const lastStartMs = entitlement?.lastPaidReviewStartedAt
    ? Date.parse(entitlement.lastPaidReviewStartedAt)
    : Number.NaN;
  const nextEligibleMs = Number.isFinite(lastStartMs)
    ? lastStartMs + OWNER_LEARNING_ROLLING_START_MS
    : null;
  const rollingAvailable = nextEligibleMs == null || now.getTime() >= nextEligibleMs;

  return {
    eligibilityPolicyVersion: OWNER_LEARNING_ELIGIBILITY_POLICY_VERSION,
    credit,
    rollingAllowance: {
      available: rollingAvailable,
      nextEligibleAt: rollingAvailable || nextEligibleMs == null
        ? null
        : new Date(nextEligibleMs).toISOString(),
    },
    profiles,
    recommendedAgentProfileId: profiles[0]?.agentProfileId ?? null,
    prompt: {
      threshold,
      prominent: threshold === 3 && credit.balance === 1 && !suppressedByDismissal,
      suppressedByDismissal,
    },
    openReview: openReviewRows[0] ?? null,
  };
}

export async function validateOwnerLearningSelection(
  db: OwnerLearningEligibilityDB,
  input: { ownerUserId: string; agentProfileId: string; gameIds: unknown },
): Promise<OwnerLearningValidatedSelection> {
  const gameIds = parseOwnerLearningGameIds(input.gameIds);
  const profile = (await db.select({
    agentProfileId: schema.agentProfiles.id,
    name: schema.agentProfiles.name,
    currentRevisionId: schema.agentProfiles.currentRevisionId,
    strategyStyle: schema.agentProfiles.strategyStyle,
  }).from(schema.agentProfiles).where(and(
    eq(schema.agentProfiles.id, input.agentProfileId),
    eq(schema.agentProfiles.userId, input.ownerUserId),
  )).limit(1))[0];
  if (!profile?.currentRevisionId) throw new OwnerLearningEligibilityError("profile_unavailable");

  const rows = (await loadOwnedEligibleSeatRows(db, input.ownerUserId, gameIds))
    .filter(ownerLearningGameEligibilityPolicy.admits)
    .filter((row) =>
      row.agentProfileId === profile.agentProfileId
      && row.analyticalRevisionId === profile.currentRevisionId
    );
  const rowByGameId = new Map(rows.map((row) => [row.gameId, row]));
  if (rowByGameId.size !== gameIds.length) {
    throw new OwnerLearningEligibilityError("selection_unavailable");
  }

  return {
    ownerUserId: input.ownerUserId,
    agentProfileId: profile.agentProfileId,
    agentProfileName: profile.name,
    currentRevisionId: profile.currentRevisionId,
    strategyStyle: profile.strategyStyle,
    games: gameIds.map((gameId) => {
      const row = rowByGameId.get(gameId);
      if (!row) throw new OwnerLearningEligibilityError("selection_unavailable");
      return {
        gameId: row.gameId,
        slug: row.slug,
        playerId: row.playerId,
        completionAt: row.completionAt!,
        analyticalRevisionId: row.analyticalRevisionId!,
        transcriptCaptureVersion: row.transcriptCaptureVersion,
        cognitiveArtifactCaptureVersion: row.cognitiveArtifactCaptureVersion,
        previouslyAnalyzed: false,
      };
    }),
  };
}

async function loadOwnedEligibleSeatRows(
  db: OwnerLearningEligibilityDB,
  ownerUserId: string,
  gameIds?: readonly string[],
) {
  return db.select({
    gameId: schema.games.id,
    slug: schema.games.slug,
    status: schema.games.status,
    trackType: schema.games.trackType,
    completionAt: sql<string | null>`coalesce(${schema.games.endedAt}, ${schema.gameResults.finishedAt})`,
    transcriptCaptureVersion: schema.games.transcriptCaptureVersion,
    cognitiveArtifactCaptureVersion: schema.games.cognitiveArtifactCaptureVersion,
    playerId: schema.gamePlayers.id,
    agentProfileId: schema.gamePlayers.agentProfileId,
    analyticalRevisionId: schema.gamePlayers.agentRevisionId,
  }).from(schema.gamePlayers)
    .innerJoin(schema.games, eq(schema.gamePlayers.gameId, schema.games.id))
    .innerJoin(schema.agentProfiles, eq(schema.gamePlayers.agentProfileId, schema.agentProfiles.id))
    .leftJoin(schema.gameResults, eq(schema.gameResults.gameId, schema.games.id))
    .where(and(
      eq(schema.agentProfiles.userId, ownerUserId),
      ...(gameIds ? [inArray(schema.games.id, [...gameIds])] : []),
    ))
    .orderBy(desc(schema.games.endedAt), desc(schema.gameResults.finishedAt), desc(schema.games.id));
}

function dedupeCompletionCoordinates(
  completions: readonly OwnerLearningCompletionCoordinate[],
): OwnerLearningCompletionCoordinate[] {
  const byGameId = new Map<string, OwnerLearningCompletionCoordinate>();
  for (const completion of completions) byGameId.set(completion.gameId, completion);
  return [...byGameId.values()];
}
