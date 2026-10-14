import {expect,test} from "bun:test";
import {computeVoteBombTallies,resolveVoteBomb,computeMajorityEliminationTallies,resolveMajorityElimination} from "@influence/engine/format-rules";
import {createFormatEvents} from "../e2e/format-aware-game-viewer-fixture.js";

test("viewer fixture sealed aggregates and outcomes match canonical rules, excluding zero-vote Vote Bomb targets", () => {
  const players = Array.from({length:8},(_,index) => ({id:`p${index}`,name:`Player ${index}`}));
  const events = createFormatEvents("fixture-parity",players,["save_or_eliminate","vote_bomb","majority_elimination","safety_bounce"]);
  let checked = 0;
  for (const event of events) {
    if (event.type !== "format.resolved") continue;
    const aggregate = event.payload.aggregate;
    if (aggregate?.capability !== "sealed_elim") continue;
    const {formatId} = event.payload;
    if (formatId !== "vote_bomb" && formatId !== "majority_elimination") throw new Error("Unexpected sealed fixture format");
    const alive = Object.keys(aggregate.totals);
    const ballots = events.flatMap(entry => entry.type === "format.ballot_cast" && entry.round === event.round
      ? [{voterId:entry.payload.voterId,targetId:entry.payload.targetId}] : []);
    const resolution = formatId === "vote_bomb" ? resolveVoteBomb(alive,ballots) : resolveMajorityElimination(alive,ballots);
    expect(event.payload).toMatchObject({resolutionKind:resolution.kind,eliminatedId:resolution.eliminatedId,tiedPlayerIds:resolution.tiedSet});
    if (formatId === "vote_bomb") {
      const expected = computeVoteBombTallies(alive,ballots);
      expect(aggregate).toEqual({capability:"sealed_elim",totals:expected.totals,eligiblePlayerIds:expected.positiveIds});
      expect(expected.zeroSafeIds.length).toBeGreaterThan(0);
      expect(expected.zeroSafeIds.some(id => aggregate.eligiblePlayerIds.includes(id))).toBe(false);
    } else {
      const expected = computeMajorityEliminationTallies(alive,ballots);
      expect(aggregate).toEqual({capability:"sealed_elim",totals:expected.totals,eligiblePlayerIds:expected.eligibleIds});
    }
    checked++;
  }
  expect(checked).toBe(2);
});
