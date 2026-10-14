import { expect, test } from "bun:test";
import { retrospectiveProgress } from "../retrospective-progress";
import type { RetrospectiveStateV1 } from "../retrospective";

test("public progress distinguishes outcome availability from epilogue completion", () => {
  const outcome = { gameId: "game", gameKind: "influence" as const, eventSequence: 40, eventHash: `sha256:${"a".repeat(64)}` };
  expect(retrospectiveProgress(null, null, 3)).toMatchObject({ status: "unavailable", outcome: null });
  expect(retrospectiveProgress(outcome, null, 3)).toMatchObject({ status: "pending", statementCount: 0, requiredStatements: 3 });
  expect(retrospectiveProgress(outcome, null, 3, true)).toEqual({ outcome, status: "unavailable", statementCount: 0, requiredStatements: 0, nextActorId: null });
  const state: RetrospectiveStateV1 = {
    definition: { version: 1, promptVersion: "retrospective.v1", outcome, inputHash: outcome.eventHash,
      definitionHash: outcome.eventHash, speakerIds: ["exit", "finalist", "winner"] },
    startedAtEventSequence: 41, statements: [], completedAtEventSequence: null,
  };
  expect(retrospectiveProgress(outcome, state, 3)).toMatchObject({ status: "in_progress", nextActorId: "exit" });
  expect(retrospectiveProgress(outcome, state, 3, true)).toMatchObject({ status: "in_progress", nextActorId: "exit" });
  state.statements = state.definition.speakerIds.map((actorId, ordinal) => ({ version: 1, definitionHash: outcome.eventHash,
    actorId, ordinal, priorStatementsHash: outcome.eventHash, requestHash: outcome.eventHash,
    providerLogicalCallId: `call-${ordinal}`, speech: "Accepted speech", eventSequence: 42 + ordinal }));
  // A full speech prefix still waits for the canonical completion proof.
  expect(retrospectiveProgress(outcome, state, 3)).toMatchObject({ status: "in_progress", statementCount: 3, nextActorId: null });
  state.completedAtEventSequence = 45;
  expect(retrospectiveProgress(outcome, state, 3)).toMatchObject({ status: "completed", nextActorId: null });
});
