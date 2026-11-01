import { expect, test } from "bun:test";
import { GameState } from "../game-state";
import { Phase } from "../types";
import { closedViewerPhases } from "../viewer-phase-prefix";

test("only a canonical boundary closes a phase, including repeated phase names", () => {
  const state = new GameState([{id:"a",name:"A"},{id:"b",name:"B"}]);
  state.startRound();
  state.recordPhaseEntered(Phase.FORMAT_MINGLE);
  const start = state.getCanonicalEvents().at(-1)!.sequence;
  expect(closedViewerPhases(state.getCanonicalEvents(),false).at(-1)?.throughSequence).toBe(start-1);
  state.recordPhaseEntered(Phase.FORMAT_MINGLE);
  const next = state.getCanonicalEvents().at(-1)!.sequence;
  expect(closedViewerPhases(state.getCanonicalEvents(),false).at(-1)).toEqual({startSequence:start,throughSequence:next-1,nextPhaseSequence:next});
  expect(closedViewerPhases(state.getCanonicalEvents(),true).at(-1)).toEqual({startSequence:next,throughSequence:next,nextPhaseSequence:null});
});


test("a terminal database status does not seal an unfinished retrospective", () => {
  const state = new GameState([{id:"a",name:"A"},{id:"b",name:"B"}]);
  state.startRound();
  state.recordPhaseEntered(Phase.RETROSPECTIVE);
  const start = state.getCanonicalEvents().at(-1)!.sequence;
  expect(closedViewerPhases(state.getCanonicalEvents(),true).at(-1)?.throughSequence).toBe(start-1);
});
