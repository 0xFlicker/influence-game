import type { UUID } from "../types";
import { computeMajorityEliminationTallies, resolveMajorityElimination } from "./majority-elimination";
import type { SealedElimBallot } from "./types";

export interface HistoricalFormatBallot {
  round: number;
  voterId: UUID;
  targetId: UUID;
  polarity: "save" | "eliminate" | null;
}

/** SAVE ballots are support, so only elimination-direction ballots consume history. */
export function isEliminationDirectionBallot(
  ballot: Pick<HistoricalFormatBallot, "polarity">,
): boolean {
  return ballot.polarity !== "save";
}

export function restrictedHistoryPriorTargetIds(
  voterId: UUID,
  currentRound: number,
  history: readonly HistoricalFormatBallot[],
): UUID[] {
  return [...new Set(
    history
      .filter((ballot) =>
        ballot.round < currentRound
        && ballot.voterId === voterId
        && isEliminationDirectionBallot(ballot)
      )
      .map((ballot) => ballot.targetId),
  )];
}

export function restrictedHistoryLegalTargets(
  voterId: UUID,
  aliveIds: readonly UUID[],
  currentRound: number,
  history: readonly HistoricalFormatBallot[],
): UUID[] {
  const priorTargets = new Set(restrictedHistoryPriorTargetIds(voterId, currentRound, history));
  return aliveIds.filter((targetId) => targetId !== voterId && !priorTargets.has(targetId));
}

export const computeRestrictedHistoryTallies = computeMajorityEliminationTallies;
export const resolveRestrictedHistory = resolveMajorityElimination;

export function isLegalRestrictedHistoryBallot(
  voterId: UUID,
  targetId: UUID,
  aliveIds: readonly UUID[],
): boolean {
  return voterId !== targetId
    && aliveIds.includes(voterId)
    && aliveIds.includes(targetId);
}

export type RestrictedHistoryBallot = SealedElimBallot;
