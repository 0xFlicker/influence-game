import type { UUID } from "../types";
import type {
  FormatEliminationResolution,
  TwoNamesBallot,
  TwoNamesPair,
  TwoNamesScore,
} from "./types";

export interface TwoNamesReplacementInput {
  livingIds: readonly UUID[];
  empoweredId: UUID;
  overrideHolderId: UUID;
  removedNomineeId: UUID;
  retainedNomineeId: UUID;
}

function isDistinctPair(pair: readonly UUID[]): pair is TwoNamesPair {
  return pair.length === 2 && pair[0] !== pair[1];
}

export function isLegalTwoNamesInitialPair(
  pair: readonly UUID[],
  empoweredId: UUID,
  livingIds: readonly UUID[],
): pair is TwoNamesPair {
  if (!isDistinctPair(pair)) return false;
  const living = new Set(livingIds);
  return pair.every((playerId) => playerId !== empoweredId && living.has(playerId));
}

export function twoNamesOverrideCandidates(
  livingIds: readonly UUID[],
): UUID[] {
  return [...livingIds];
}

export function twoNamesRemovalChoices(
  initialNomineeIds: TwoNamesPair,
): TwoNamesPair {
  return [...initialNomineeIds];
}

export function twoNamesReplacementCandidates({
  livingIds,
  empoweredId,
  overrideHolderId,
  removedNomineeId,
  retainedNomineeId,
}: TwoNamesReplacementInput): UUID[] {
  const excluded = new Set([
    empoweredId,
    overrideHolderId,
    removedNomineeId,
    retainedNomineeId,
  ]);
  return livingIds.filter((playerId) => !excluded.has(playerId));
}

export function twoNamesOrdinaryVoterIds(
  livingIds: readonly UUID[],
  empoweredId: UUID,
  finalistIds: TwoNamesPair,
): UUID[] {
  const excluded = new Set<UUID>([empoweredId, ...finalistIds]);
  return livingIds.filter((playerId) => !excluded.has(playerId));
}

export function isLegalTwoNamesBallot(
  voterId: UUID,
  targetId: UUID,
  eligibleVoterIds: readonly UUID[],
  finalistIds: TwoNamesPair,
): boolean {
  return eligibleVoterIds.includes(voterId) && finalistIds.includes(targetId);
}

export function computeTwoNamesTallies(
  finalistIds: TwoNamesPair,
  eligibleVoterIds: readonly UUID[],
  ballots: readonly TwoNamesBallot[],
): TwoNamesScore {
  if (!isDistinctPair(finalistIds)) {
    throw new Error("Two Names requires two distinct finalists");
  }

  const seenVoters = new Set<UUID>();
  const totals: Record<UUID, number> = {
    [finalistIds[0]]: 0,
    [finalistIds[1]]: 0,
  };

  for (const ballot of ballots) {
    if (!isLegalTwoNamesBallot(
      ballot.voterId,
      ballot.targetId,
      eligibleVoterIds,
      finalistIds,
    )) {
      throw new Error(`Illegal Two Names ballot from ${ballot.voterId} to ${ballot.targetId}`);
    }
    if (seenVoters.has(ballot.voterId)) {
      throw new Error(`Duplicate Two Names ballot from ${ballot.voterId}`);
    }
    seenVoters.add(ballot.voterId);
    totals[ballot.targetId] = (totals[ballot.targetId] ?? 0) + 1;
  }

  if (seenVoters.size !== eligibleVoterIds.length) {
    throw new Error(
      `Two Names requires one ballot per eligible voter: ${seenVoters.size}/${eligibleVoterIds.length}`,
    );
  }

  return {
    totals,
    finalistIds: [...finalistIds],
    eligibleVoterIds: [...eligibleVoterIds],
  };
}

export function resolveTwoNames(
  finalistIds: TwoNamesPair,
  eligibleVoterIds: readonly UUID[],
  ballots: readonly TwoNamesBallot[],
): FormatEliminationResolution {
  const { totals } = computeTwoNamesTallies(
    finalistIds,
    eligibleVoterIds,
    ballots,
  );
  const [first, second] = finalistIds;
  const firstTotal = totals[first] ?? 0;
  const secondTotal = totals[second] ?? 0;

  if (firstTotal === secondTotal) {
    return {
      kind: "tie",
      eliminatedId: null,
      tiedSet: [...finalistIds],
    };
  }

  const eliminatedId = firstTotal > secondTotal ? first : second;
  return {
    kind: "clear",
    eliminatedId,
    tiedSet: [eliminatedId],
  };
}
