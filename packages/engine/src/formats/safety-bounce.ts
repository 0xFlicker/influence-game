import type { UUID } from "../types";
import type {
  BounceBoard,
  BounceClassification,
  BouncePointer,
  FormatEliminationResolution,
} from "./types";

/**
 * Create initial bounce board: starter is safe; everyone else unclassified.
 * Next actor is the starter.
 */
export function createBounceBoard(aliveIds: readonly UUID[], starterId: UUID): BounceBoard {
  if (!aliveIds.includes(starterId)) {
    throw new Error(`Bounce starter ${starterId} is not alive`);
  }
  return {
    starterId,
    safe: [starterId],
    vulnerable: [],
    unclassified: aliveIds.filter((id) => id !== starterId),
    nextActorId: starterId,
    lastTargetId: null,
  };
}

export function isLegalBouncePointer(board: BounceBoard, pointer: BouncePointer): boolean {
  if (board.nextActorId === null) return false;
  if (pointer.actorId !== board.nextActorId) return false;
  if (!board.unclassified.includes(pointer.targetId)) return false;
  if (pointer.actorId === pointer.targetId) return false;
  return true;
}

export function actorClassification(board: BounceBoard, actorId: UUID): BounceClassification | null {
  if (board.safe.includes(actorId)) return "safe";
  if (board.vulnerable.includes(actorId)) return "vulnerable";
  return null;
}

/**
 * Apply one public bounce pointer.
 * Safe actor → target becomes vulnerable.
 * Vulnerable actor → target becomes safe.
 */
export function applyBouncePointer(board: BounceBoard, pointer: BouncePointer): BounceBoard {
  if (!isLegalBouncePointer(board, pointer)) {
    throw new Error(
      `Illegal bounce pointer actor=${pointer.actorId} target=${pointer.targetId} next=${board.nextActorId}`,
    );
  }
  const classification = actorClassification(board, pointer.actorId);
  if (classification === null) {
    throw new Error(`Bounce actor ${pointer.actorId} is not classified`);
  }

  const unclassified = board.unclassified.filter((id) => id !== pointer.targetId);
  const safe = [...board.safe];
  const vulnerable = [...board.vulnerable];
  if (classification === "safe") {
    vulnerable.push(pointer.targetId);
  } else {
    safe.push(pointer.targetId);
  }

  const complete = unclassified.length === 0;
  return {
    starterId: board.starterId,
    safe,
    vulnerable,
    unclassified,
    nextActorId: complete ? null : pointer.targetId,
    lastTargetId: pointer.targetId,
  };
}

export function bouncePoolSizes(board: BounceBoard): { safe: number; vulnerable: number } {
  return { safe: board.safe.length, vulnerable: board.vulnerable.length };
}

/**
 * Expected classification counts under strict alternation starting with one safe starter.
 * N alive → ceil(N/2) safe, floor(N/2) vulnerable when fully classified.
 */
export function expectedBouncePoolSizes(aliveCount: number): { safe: number; vulnerable: number } {
  return {
    safe: Math.ceil(aliveCount / 2),
    vulnerable: Math.floor(aliveCount / 2),
  };
}

export function resolveSafetyBounceVote(
  vulnerableIds: readonly UUID[],
  voteTotals: Record<UUID, number>,
): FormatEliminationResolution {
  if (vulnerableIds.length === 0) {
    throw new Error("Safety Bounce vote requires a non-empty vulnerable pool");
  }
  if (vulnerableIds.length === 1) {
    return {
      kind: "auto",
      eliminatedId: vulnerableIds[0]!,
      tiedSet: [vulnerableIds[0]!],
      reason: "sole_vulnerable",
    };
  }
  let highest = -Infinity;
  for (const id of vulnerableIds) {
    const n = voteTotals[id] ?? 0;
    if (n > highest) highest = n;
  }
  const tiedSet = vulnerableIds.filter((id) => (voteTotals[id] ?? 0) === highest);
  if (tiedSet.length === 1) {
    return { kind: "clear", eliminatedId: tiedSet[0]!, tiedSet };
  }
  return { kind: "tie", eliminatedId: null, tiedSet: [...tiedSet] };
}

export function isLegalSafetyBounceVote(
  targetId: UUID,
  vulnerableIds: readonly UUID[],
): boolean {
  return vulnerableIds.includes(targetId);
}
