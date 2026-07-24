import type { UUID } from "../types";
import type { FormatEliminationResolution, SaveOrEliminateBallot } from "./types";

export interface SaveOrEliminateNets {
  nets: Record<UUID, number>;
  savesReceived: Record<UUID, number>;
  eliminateReceived: Record<UUID, number>;
}

/**
 * Net score = saves received − eliminate votes received.
 * Missing alive players start at 0.
 */
export function computeSaveOrEliminateNets(
  aliveIds: readonly UUID[],
  ballots: readonly SaveOrEliminateBallot[],
): SaveOrEliminateNets {
  const nets: Record<UUID, number> = {};
  const savesReceived: Record<UUID, number> = {};
  const eliminateReceived: Record<UUID, number> = {};
  for (const id of aliveIds) {
    nets[id] = 0;
    savesReceived[id] = 0;
    eliminateReceived[id] = 0;
  }
  for (const ballot of ballots) {
    if (!aliveIds.includes(ballot.targetId)) continue;
    if (ballot.polarity === "save") {
      savesReceived[ballot.targetId] = (savesReceived[ballot.targetId] ?? 0) + 1;
      nets[ballot.targetId] = (nets[ballot.targetId] ?? 0) + 1;
    } else {
      eliminateReceived[ballot.targetId] = (eliminateReceived[ballot.targetId] ?? 0) + 1;
      nets[ballot.targetId] = (nets[ballot.targetId] ?? 0) - 1;
    }
  }
  return { nets, savesReceived, eliminateReceived };
}

/** Lowest (most negative) net is eliminated; ties return kind "tie". */
export function resolveSaveOrEliminate(
  aliveIds: readonly UUID[],
  ballots: readonly SaveOrEliminateBallot[],
): FormatEliminationResolution {
  const { nets } = computeSaveOrEliminateNets(aliveIds, ballots);
  let lowest = Infinity;
  for (const id of aliveIds) {
    const net = nets[id] ?? 0;
    if (net < lowest) lowest = net;
  }
  const tiedSet = aliveIds.filter((id) => (nets[id] ?? 0) === lowest);
  if (tiedSet.length === 1) {
    return {
      kind: "auto",
      eliminatedId: tiedSet[0]!,
      tiedSet,
      reason: "sole_lowest_net",
    };
  }
  return { kind: "tie", eliminatedId: null, tiedSet: [...tiedSet] };
}

export function applyFormatTiebreak(
  tiedSet: readonly UUID[],
  choiceId: UUID,
): FormatEliminationResolution | null {
  if (!tiedSet.includes(choiceId)) return null;
  return { kind: "clear", eliminatedId: choiceId, tiedSet: [...tiedSet] };
}

export function isLegalSaveOrEliminateBallot(
  voterId: UUID,
  targetId: UUID,
  polarity: "save" | "eliminate",
  aliveIds: readonly UUID[],
): boolean {
  if (!aliveIds.includes(voterId) || !aliveIds.includes(targetId)) return false;
  if (voterId === targetId) return false;
  if (polarity !== "save" && polarity !== "eliminate") return false;
  return true;
}
