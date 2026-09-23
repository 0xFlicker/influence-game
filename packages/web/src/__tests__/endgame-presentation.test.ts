import { expect, test } from "bun:test";
import { Phase } from "@influence/engine";
import type { GameWatchReplayFrame, ViewerDecisionEvent } from "../lib/api";
import { buildEndgamePresentationCues } from "../app/games/[slug]/components/endgame-presentation";
import { visualWatchPresentation } from "../app/games/[slug]/components/visual-watch-model";
import { comparePresentationCues } from "../app/games/[slug]/components/dramatic-replay-viewer";

const players = ["Arden", "Kaiya", "Marnie", "Ione"].map((name) => ({ id: name, name, persona: "strategic", status: "alive" as const, shielded: false }));
function frame(event: ViewerDecisionEvent): GameWatchReplayFrame {
  return { schemaVersion: 3, gameId: "endgame", slug: "endgame", sequence: event.sequence, timestamp: event.sequence, eventType: event.type, round: event.round, phase: event.phase ?? Phase.INIT, players,
    counts: { totalPlayers: 4, alivePlayers: 4, eliminatedPlayers: 0, unknownPlayers: 0 }, viewerDecisionEvent: event };
}
const base = { timestamp: "2026-09-22T00:00:00Z", round: 3, phase: Phase.VOTE };
const finalFour = frame({ ...base, sequence: 10, type: "endgame.elimination_resolved", payload: { stage: "reckoning", votes: { Arden: "Kaiya", Kaiya: "Arden", Marnie: "Arden", Ione: "Arden" }, juryTiebreakerVotes: {}, eliminatedId: "Arden" } });
const ardenOut = frame({ ...base, sequence: 11, type: "player.eliminated", payload: { playerId: "Arden", playerName: "Arden" } });
const finalThree = frame({ ...base, round: 4, sequence: 20, type: "endgame.elimination_resolved", payload: { stage: "tribunal", votes: { Kaiya: "Marnie", Marnie: "Ione", Ione: "Marnie" }, juryTiebreakerVotes: { Arden: "Marnie" }, eliminatedId: "Marnie" } });
const marnieOut = frame({ ...base, round: 4, sequence: 21, type: "player.eliminated", payload: { playerId: "Marnie", playerName: "Marnie" } });

test("Final 4 and Final 3 reveal accepted ballots in roster order before canonical exits", () => {
  const cues = buildEndgamePresentationCues([finalFour, ardenOut, finalThree, marnieOut]);
  expect(cues.map(c => c.kind)).toEqual([...Array(4).fill("endgame_ballot"), "endgame_elimination", ...Array(4).fill("endgame_ballot"), "endgame_elimination"]);
  expect(cues.slice(0, 4).map(c => c.ballot?.voterId)).toEqual(players.map(p => p.id));
  expect(cues[8]?.ballot).toMatchObject({ voterId: "Arden", targetId: "Marnie", juryTiebreaker: true });
  expect(cues[4]?.canonicalSequence).toBe(11);
  expect([...cues].sort(comparePresentationCues)).toEqual(cues);
  expect(buildEndgamePresentationCues([finalFour])).toEqual(cues.slice(0, 4));
  expect(buildEndgamePresentationCues([ardenOut])).toEqual([]);
  const visual = visualWatchPresentation({ enabled: true, status: null, portraits: {}, scenes: [] }, cues[0]!, null, players);
  expect(visual.beat).toMatchObject({ kind: "portrait", purpose: "Ballot", caption: "Vote to eliminate", speech: { text: "Kaiya" } });
});

test("jury ballots precede the winner and cannot be confused with elimination votes", () => {
  const jury = frame({ ...base, phase: Phase.JURY_VOTE, sequence: 30, type: "jury.winner_determined", payload: { votes: { Arden: "Ione", Marnie: "Kaiya" }, winnerId: "Ione" } });
  const cues = buildEndgamePresentationCues([jury]);
  expect(cues.map(c => c.kind)).toEqual(["endgame_ballot", "endgame_ballot", "endgame_winner"]);
  expect(cues[0]?.ballot?.purpose).toBe("winner");
  expect(visualWatchPresentation({ enabled: true, status: null, portraits: {}, scenes: [] }, cues[2]!, null, players).beat).toEqual({ kind: "house", text: "Ione wins The House." });
});
