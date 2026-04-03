/**
 * ELO Rating Calculation for Free Track Games
 *
 * Standard ELO with pairwise comparisons across all human players.
 * K-factor: 32. Placement-based actual score via linear interpolation.
 *
 * Ratings are tracked at the **account (user) level**, not per-agent.
 */

export interface PlayerResult {
  userId: string;
  placement: number; // 1 = winner, higher = worse
  totalPlayers: number;
}

export interface EloChange {
  userId: string;
  oldRating: number;
  newRating: number;
  delta: number;
}

const K_FACTOR = 32;

/**
 * Expected score of player A vs player B.
 */
function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Calculate ELO changes for a set of players after a game.
 *
 * Each player is compared pairwise against every other player.
 * The actual score is derived from relative placement.
 */
export function calculateEloChanges(
  players: PlayerResult[],
  currentRatings: Map<string, number>,
): EloChange[] {
  if (players.length < 2) return [];

  return players.map((player) => {
    const oldRating = currentRatings.get(player.userId) ?? 1200;

    // Pairwise comparison against all other players
    let totalExpected = 0;
    let totalActual = 0;

    for (const opponent of players) {
      if (opponent.userId === player.userId) continue;

      const opponentRating = currentRatings.get(opponent.userId) ?? 1200;
      totalExpected += expectedScore(oldRating, opponentRating);

      // Actual score: 1 if player placed higher, 0 if lower, 0.5 if tied
      if (player.placement < opponent.placement) {
        totalActual += 1;
      } else if (player.placement === opponent.placement) {
        totalActual += 0.5;
      }
      // else 0
    }

    const opponents = players.length - 1;
    const normalizedExpected = totalExpected / opponents;
    const normalizedActual = totalActual / opponents;

    const delta = Math.round(K_FACTOR * (normalizedActual - normalizedExpected));
    const newRating = Math.max(0, oldRating + delta);

    return {
      userId: player.userId,
      oldRating,
      newRating,
      delta,
    };
  });
}
