import { expect, test } from "bun:test";
import { selectActiveJury, type JuryMember } from "../types";
import { Phase } from "../types";
import { GameState } from "../game-state";
import { ContextBuilder } from "../context-builder";
import { TranscriptLogger } from "../transcript-logger";

test.each([[5, 3], [6, 3], [7, 5], [8, 5], [9, 5], [10, 7], [11, 7], [12, 7]])(
  "selects the eligible jury for %i players (%i jurors)", (total, expectedCount) => {
    const jury: JuryMember[] = Array.from({ length: total - 2 }, (_, index) => ({
      playerId: `p${index}`, playerName: `Player ${index}`, eliminatedRound: index + 1,
    }));
    const original = structuredClone(jury);
    expect(selectActiveJury(jury, total)).toEqual(jury.slice(-expectedCount));
    expect(jury).toEqual(original);
  },
);

test("retains all available jurors before the jury is full", () => {
  const jury = [{ playerId: "p1", playerName: "Arden", eliminatedRound: 1 }];
  expect(selectActiveJury(jury, 12)).toEqual(jury);
  expect(selectActiveJury([], 6)).toEqual([]);
});

test("both finalists receive only the three eligible jurors in a six-player game", () => {
  const players = Array.from({ length: 6 }, (_, index) => ({ id: `p${index + 1}`, name: `Player ${index + 1}` }));
  const state = new GameState(players);
  for (const player of players.slice(2)) state.eliminatePlayer(player.id);
  const builder = new ContextBuilder(state, new TranscriptLogger(state), new Map(), players.length);
  for (const finalist of players.slice(0, 2)) {
    const context = builder.buildPhaseContext(finalist.id, Phase.OPENING_STATEMENTS);
    expect(context.jury?.map((member) => member.playerId)).toEqual(["p4", "p5", "p6"]);
  }
});
