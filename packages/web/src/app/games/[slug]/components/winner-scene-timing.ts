/** Leave a readable hold for each pair of non-winning cast members. */
export const WINNER_PAGE_MS = 5_000;
export const WINNER_PAGE_SIZE = 2;

export function winnerSceneDurationMs(standings: readonly { playerId: string; placement: number | null }[], winnerId: string): number {
  const remaining = standings.filter(player => player.playerId !== winnerId).length;
  return remaining === 0 ? 4_000 : Math.max(4_000, Math.ceil(remaining / WINNER_PAGE_SIZE) * WINNER_PAGE_MS);
}

export function winnerScenePage(elapsedMs: number, count: number): number {
  return Math.min(Math.max(0, Math.floor(elapsedMs / WINNER_PAGE_MS)), Math.max(0, Math.ceil(count / WINNER_PAGE_SIZE) - 1));
}
