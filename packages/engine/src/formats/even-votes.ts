import type { UUID } from "../types";
import type {
  FormatEliminationResolution,
  SealedElimBallot,
  SealedElimScore,
} from "./types";
import { isLegalSealedElimBallot } from "./sealed-elim-resolve";

/**
 * Even totals qualify, including zero. If every living player has an odd
 * total, the full living field becomes the empowered tiebreak pool so the
 * single-elimination round cannot stall.
 */
export function computeEvenVotesTallies(
  aliveIds: readonly UUID[],
  ballots: readonly SealedElimBallot[],
): SealedElimScore {
  const totals: Record<UUID, number> = {};
  const alive = new Set(aliveIds);

  for (const id of aliveIds) {
    totals[id] = 0;
  }
  for (const ballot of ballots) {
    if (!alive.has(ballot.targetId)) continue;
    totals[ballot.targetId] = (totals[ballot.targetId] ?? 0) + 1;
  }

  const evenIds = aliveIds.filter((id) => (totals[id] ?? 0) % 2 === 0);
  return {
    totals,
    eligibleIds: evenIds.length > 0 ? evenIds : [...aliveIds],
  };
}

/** Highest qualifying even total is lethal; ties go to the empowered player. */
export function resolveEvenVotes(
  aliveIds: readonly UUID[],
  ballots: readonly SealedElimBallot[],
): FormatEliminationResolution {
  const { totals, eligibleIds } = computeEvenVotesTallies(aliveIds, ballots);
  if (eligibleIds.length === 0) {
    return { kind: "tie", eliminatedId: null, tiedSet: [] };
  }

  const allOdd = eligibleIds.length === aliveIds.length
    && aliveIds.every((id) => (totals[id] ?? 0) % 2 !== 0);
  if (allOdd) {
    return { kind: "tie", eliminatedId: null, tiedSet: [...eligibleIds] };
  }

  let highestEven = -Infinity;
  for (const id of eligibleIds) {
    highestEven = Math.max(highestEven, totals[id] ?? 0);
  }
  const tiedSet = eligibleIds.filter(
    (id) => (totals[id] ?? 0) === highestEven,
  );

  if (tiedSet.length === 1) {
    return {
      kind: "auto",
      eliminatedId: tiedSet[0]!,
      tiedSet,
      reason: "sole_highest_even",
    };
  }
  return { kind: "tie", eliminatedId: null, tiedSet };
}

export const isLegalEvenVotesBallot = isLegalSealedElimBallot;
