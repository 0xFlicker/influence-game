import type { UUID } from "../types";
import type { FormatEliminationResolution, VoteBombBallot } from "./types";

export interface VoteBombTallies {
  totals: Record<UUID, number>;
  /** Players with at least one vote. */
  positiveIds: UUID[];
  /** Players with zero votes (safe). */
  zeroSafeIds: UUID[];
}

export function computeVoteBombTallies(
  aliveIds: readonly UUID[],
  ballots: readonly VoteBombBallot[],
): VoteBombTallies {
  const totals: Record<UUID, number> = {};
  for (const id of aliveIds) {
    totals[id] = 0;
  }
  for (const ballot of ballots) {
    if (!aliveIds.includes(ballot.targetId)) continue;
    totals[ballot.targetId] = (totals[ballot.targetId] ?? 0) + 1;
  }
  const positiveIds = aliveIds.filter((id) => (totals[id] ?? 0) > 0);
  const zeroSafeIds = aliveIds.filter((id) => (totals[id] ?? 0) === 0);
  return { totals, positiveIds, zeroSafeIds };
}

/**
 * Among players with at least one vote, fewest votes is eliminated.
 * Zero-vote players are safe.
 * With strict non-self ballots, positive set is non-empty when |alive| >= 2 and every ballot is legal.
 */
export function resolveVoteBomb(
  aliveIds: readonly UUID[],
  ballots: readonly VoteBombBallot[],
): FormatEliminationResolution {
  const { totals, positiveIds } = computeVoteBombTallies(aliveIds, ballots);
  if (positiveIds.length === 0) {
    // Should not occur under strict repair; surface as full-cast tie for empowered emergency.
    return { kind: "tie", eliminatedId: null, tiedSet: [...aliveIds] };
  }
  let fewest = Infinity;
  for (const id of positiveIds) {
    const n = totals[id] ?? 0;
    if (n < fewest) fewest = n;
  }
  const tiedSet = positiveIds.filter((id) => (totals[id] ?? 0) === fewest);
  if (tiedSet.length === 1) {
    return {
      kind: "auto",
      eliminatedId: tiedSet[0]!,
      tiedSet,
      reason: "sole_fewest_positive",
    };
  }
  return { kind: "tie", eliminatedId: null, tiedSet: [...tiedSet] };
}

export function isLegalVoteBombBallot(
  voterId: UUID,
  targetId: UUID,
  aliveIds: readonly UUID[],
): boolean {
  if (!aliveIds.includes(voterId) || !aliveIds.includes(targetId)) return false;
  if (voterId === targetId) return false;
  return true;
}
