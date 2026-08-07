import type { UUID } from "../types";
import type {
  FormatEliminationResolution,
  SealedElimBallot,
  SealedElimScore,
} from "./types";
import { isLegalSealedElimBallot } from "./sealed-elim-resolve";

/**
 * Every alive player is eligible; the highest vote total is the danger set.
 * Non-alive targets are ignored defensively after ballot admission.
 */
export function computeMajorityEliminationTallies(
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

  return { totals, eligibleIds: [...aliveIds] };
}

/**
 * A sole highest total auto-eliminates. A top tie returns only that top set for
 * the empowered tiebreak.
 */
export function resolveMajorityElimination(
  aliveIds: readonly UUID[],
  ballots: readonly SealedElimBallot[],
): FormatEliminationResolution {
  const { totals, eligibleIds } = computeMajorityEliminationTallies(
    aliveIds,
    ballots,
  );
  if (eligibleIds.length === 0) {
    return { kind: "tie", eliminatedId: null, tiedSet: [] };
  }

  let highest = -Infinity;
  for (const id of eligibleIds) {
    highest = Math.max(highest, totals[id] ?? 0);
  }
  const tiedSet = eligibleIds.filter((id) => (totals[id] ?? 0) === highest);

  if (tiedSet.length === 1) {
    return {
      kind: "auto",
      eliminatedId: tiedSet[0]!,
      tiedSet,
      reason: "sole_highest",
    };
  }
  return { kind: "tie", eliminatedId: null, tiedSet };
}

export const isLegalMajorityEliminationBallot = isLegalSealedElimBallot;
