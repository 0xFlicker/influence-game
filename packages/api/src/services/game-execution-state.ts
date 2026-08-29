import {
  assertGameExecutionStateV1,
  type GameExecutionStateV1,
} from "@influence/engine";
import { schema } from "../db/index.js";

export function gameExecutionStateFromRow(
  row: typeof schema.gameExecutionStates.$inferSelect,
): GameExecutionStateV1 {
  const state: GameExecutionStateV1 = {
    version: 1,
    gameId: row.gameId,
    ownerEpoch: row.ownerEpoch,
    status: row.status,
    heads: {
      version: 1,
      turnSequence: row.committedTurnSequence,
      eventSequence: row.eventHeadSequence,
      eventHash: row.eventHeadHash,
      dialogueSequence: row.dialogueHeadSequence,
      publicationSequence: row.publicationHeadSequence,
    },
    lastPresentationPhase: row.lastPresentationPhase ?? null,
    nextPublicationAvailableAt: row.nextPublicationAvailableAt ?? null,
    xstateSnapshot: row.xstateSnapshot,
    cursor: row.executionCursor,
    playerContinuityCapsules: row.playerContinuityCapsules,
    houseNarrativeContinuity: row.houseNarrativeContinuity ?? null,
    retry: row.retryState ?? null,
  };
  assertGameExecutionStateV1(state);
  return state;
}
