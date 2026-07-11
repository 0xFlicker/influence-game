import { rate, rating, type Rating } from "openskill";

export const SEASON_SCORING_POLICY_VERSION = "season-scoring-v1";
export const COMPETITION_RATING_POLICY_VERSION = "competition-rating-v1";

export const INITIAL_COMPETITION_MU = 25;
export const INITIAL_COMPETITION_SIGMA = 25 / 3;
export const MAX_STRONG_FIELD_BONUS_RATE = 0.2;

export interface CompetitionRating {
  mu: number;
  sigma: number;
}

export interface CompetitionSeat {
  id: string;
  placement: number;
  rating: CompetitionRating;
}

export interface CompetitionRatingChange {
  id: string;
  placement: number;
  before: CompetitionRating;
  after: CompetitionRating;
}

export interface StrongFieldEvidence {
  opponentCount: number;
  opponentConservativeRatings: number[];
  meanOpponentConservativeRating: number;
  bonusRate: number;
  maximumBonusRate: number;
}

export interface ChampionshipPointAward {
  placement: number;
  totalPlayers: number;
  basePoints: number;
  fieldBonus: number;
  totalPoints: number;
  scoringPolicyVersion: typeof SEASON_SCORING_POLICY_VERSION;
  fieldEvidence: StrongFieldEvidence;
}

export interface ArchitectAgentTotal {
  agentId: string;
  totalPoints: number;
}

export interface ArchitectContribution {
  agentId: string;
  rank: 1 | 2 | 3;
  sourcePoints: number;
  weightPercent: 100 | 50 | 25;
  weightedPointsHundredths: number;
}

export interface ArchitectScore {
  totalPointsHundredths: number;
  contributions: ArchitectContribution[];
}

export interface AgentStandingTieBreak {
  agentId: string;
  totalPoints: number;
  wins: number;
  runnerUpFinishes: number;
  averageNormalizedPlacement: number;
  tiedTotalReachedAt: string;
}

export interface ArchitectStandingTieBreak {
  ownerId: string;
  totalPointsHundredths: number;
  contributingWins: number;
  firstAgentPoints: number;
  tiedTotalReachedAt: string;
}

export interface PointReceiptTime {
  totalPoints: number;
  earnedAt: string;
  id?: string;
}

export function initialCompetitionRating(): CompetitionRating {
  return rating({
    mu: INITIAL_COMPETITION_MU,
    sigma: INITIAL_COMPETITION_SIGMA,
  });
}

export function conservativeCompetitionRating(value: CompetitionRating): number {
  validateRating(value);
  return value.mu - 3 * value.sigma;
}

export function calculateBasePlacementPoints(placement: number, totalPlayers: number): number {
  validatePlacement(placement, totalPlayers);
  if (placement === 1) return 100;

  const relativeFinish = (totalPlayers - placement) / (totalPlayers - 1);
  return clamp(Math.round(50 * relativeFinish ** 2), 0, 50);
}

export function calculateStrongFieldBonus(
  basePoints: number,
  opponentRatings: readonly CompetitionRating[],
): { fieldBonus: number; evidence: StrongFieldEvidence } {
  if (!Number.isInteger(basePoints) || basePoints < 0) {
    throw new Error("basePoints must be a non-negative integer");
  }

  const conservativeRatings = opponentRatings.map((opponent) =>
    conservativeCompetitionRating(opponent)
  );
  const meanConservative = conservativeRatings.length === 0
    ? 0
    : conservativeRatings.reduce((sum, value) => sum + value, 0) / conservativeRatings.length;
  const bonusRate = clamp(meanConservative / 100, 0, MAX_STRONG_FIELD_BONUS_RATE);
  const fieldBonus = basePoints === 0 ? 0 : Math.round(basePoints * bonusRate);

  return {
    fieldBonus,
    evidence: {
      opponentCount: conservativeRatings.length,
      opponentConservativeRatings: conservativeRatings,
      meanOpponentConservativeRating: meanConservative,
      bonusRate,
      maximumBonusRate: MAX_STRONG_FIELD_BONUS_RATE,
    },
  };
}

export function calculateChampionshipPointAward(input: {
  placement: number;
  totalPlayers: number;
  opponentRatings: readonly CompetitionRating[];
}): ChampionshipPointAward {
  const basePoints = calculateBasePlacementPoints(input.placement, input.totalPlayers);
  const { fieldBonus, evidence } = calculateStrongFieldBonus(basePoints, input.opponentRatings);
  return {
    placement: input.placement,
    totalPlayers: input.totalPlayers,
    basePoints,
    fieldBonus,
    totalPoints: basePoints + fieldBonus,
    scoringPolicyVersion: SEASON_SCORING_POLICY_VERSION,
    fieldEvidence: evidence,
  };
}

export function rateCompetitionField(seats: readonly CompetitionSeat[]): CompetitionRatingChange[] {
  if (seats.length < 2) {
    throw new Error("Competition rating requires at least two seats");
  }
  const ids = new Set<string>();
  for (const seat of seats) {
    if (!seat.id || ids.has(seat.id)) throw new Error("Competition seat IDs must be unique");
    ids.add(seat.id);
    if (!Number.isInteger(seat.placement) || seat.placement < 1 || seat.placement > seats.length) {
      throw new Error("Competition placement must be within the field size");
    }
    validateRating(seat.rating);
  }

  const teams = seats.map((seat) => [toOpenSkillRating(seat.rating)] as const);
  const updated = rate(teams, {
    rank: seats.map((seat) => seat.placement),
    mu: INITIAL_COMPETITION_MU,
    sigma: INITIAL_COMPETITION_SIGMA,
  });

  return seats.map((seat, index) => {
    const next = updated[index]?.[0];
    if (!next) throw new Error(`OpenSkill returned no rating for seat ${seat.id}`);
    return {
      id: seat.id,
      placement: seat.placement,
      before: { ...seat.rating },
      after: { mu: next.mu, sigma: next.sigma },
    };
  });
}

export function calculateArchitectScore(agentTotals: readonly ArchitectAgentTotal[]): ArchitectScore {
  const sorted = [...agentTotals].sort((left, right) =>
    right.totalPoints - left.totalPoints || left.agentId.localeCompare(right.agentId)
  );
  const weights = [100, 50, 25] as const;
  const contributions: ArchitectContribution[] = [];

  for (let index = 0; index < Math.min(sorted.length, weights.length); index += 1) {
    const agent = sorted[index];
    const weightPercent = weights[index];
    if (!agent || weightPercent === undefined) continue;
    if (!Number.isInteger(agent.totalPoints) || agent.totalPoints < 0) {
      throw new Error("Architect source points must be non-negative integers");
    }
    contributions.push({
      agentId: agent.agentId,
      rank: (index + 1) as 1 | 2 | 3,
      sourcePoints: agent.totalPoints,
      weightPercent,
      weightedPointsHundredths: agent.totalPoints * weightPercent,
    });
  }

  return {
    totalPointsHundredths: contributions.reduce(
      (sum, contribution) => sum + contribution.weightedPointsHundredths,
      0,
    ),
    contributions,
  };
}

export function compareAgentStandings(
  left: AgentStandingTieBreak,
  right: AgentStandingTieBreak,
): number {
  return right.totalPoints - left.totalPoints
    || right.wins - left.wins
    || right.runnerUpFinishes - left.runnerUpFinishes
    || right.averageNormalizedPlacement - left.averageNormalizedPlacement
    || left.tiedTotalReachedAt.localeCompare(right.tiedTotalReachedAt)
    || left.agentId.localeCompare(right.agentId);
}

export function compareArchitectStandings(
  left: ArchitectStandingTieBreak,
  right: ArchitectStandingTieBreak,
): number {
  return right.totalPointsHundredths - left.totalPointsHundredths
    || right.contributingWins - left.contributingWins
    || right.firstAgentPoints - left.firstAgentPoints
    || left.tiedTotalReachedAt.localeCompare(right.tiedTotalReachedAt)
    || left.ownerId.localeCompare(right.ownerId);
}

/**
 * Returns the first instant at which an agent had accumulated its final total.
 * A later zero-point receipt must not make an otherwise tied season look slower.
 */
export function earliestFinalTotalReachedAt(rows: readonly PointReceiptTime[]): string {
  if (rows.length === 0) return "";
  const ordered = [...rows].sort((left, right) =>
    Date.parse(left.earnedAt) - Date.parse(right.earnedAt)
      || (left.id ?? "").localeCompare(right.id ?? "")
  );
  const finalTotal = ordered.reduce((sum, row) => sum + row.totalPoints, 0);
  let runningTotal = 0;
  for (const row of ordered) {
    runningTotal += row.totalPoints;
    if (runningTotal === finalTotal) return row.earnedAt;
  }
  return ordered.at(-1)!.earnedAt;
}

function validatePlacement(placement: number, totalPlayers: number): void {
  if (!Number.isInteger(totalPlayers) || totalPlayers < 2) {
    throw new Error("totalPlayers must be an integer of at least two");
  }
  if (!Number.isInteger(placement) || placement < 1 || placement > totalPlayers) {
    throw new Error("placement must be an integer within the field size");
  }
}

function validateRating(value: CompetitionRating): void {
  if (!Number.isFinite(value.mu) || !Number.isFinite(value.sigma) || value.sigma <= 0) {
    throw new Error("Competition ratings require finite mu and positive sigma");
  }
}

function toOpenSkillRating(value: CompetitionRating): Rating {
  return { mu: value.mu, sigma: value.sigma };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
