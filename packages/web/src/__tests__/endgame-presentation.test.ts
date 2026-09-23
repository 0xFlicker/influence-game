import { expect, test } from "bun:test";
import { Phase } from "@influence/engine";
import type { GameWatchReplayFrame, ViewerDecisionEvent, TranscriptEntry } from "../lib/api";
import { buildEndgamePresentationCues, revealedWinnerCue } from "../app/games/[slug]/components/endgame-presentation";
import { visualWatchPresentation } from "../app/games/[slug]/components/visual-watch-model";
import { findPresentationCueIndexForSequence } from "../app/games/[slug]/components/presentation-sequence";
import { buildStoryScenes, isStoryDialogue, withHouseBridges } from "../app/games/[slug]/components/house-story";
import { createPresentationDirector } from "../app/games/[slug]/components/format-presentation-director";
import { buildClassicPresentationCues, comparePresentationCues } from "../app/games/[slug]/components/dramatic-replay-viewer";

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
  expect(visualWatchPresentation({ enabled: true, status: null, portraits: {}, scenes: [] }, cues[2]!, null, players).beat).toMatchObject({ kind: "winner", winner: { id: "Ione" } });
});

test("winner standings use canonical exits and remain hidden until the result cue", () => {
  const jury = frame({ ...base, phase: Phase.JURY_VOTE, sequence: 30, type: "jury.winner_determined", payload: { votes: { Arden: "Ione", Marnie: "Kaiya" }, winnerId: "Ione" } });
  const cues = buildEndgamePresentationCues([finalFour, ardenOut, finalThree, marnieOut, jury]);
  const result = cues.at(-1)!;
  expect(result.standings).toEqual([
    { playerId: "Ione", placement: 1 }, { playerId: "Kaiya", placement: 2 },
    { playerId: "Marnie", placement: 3 }, { playerId: "Arden", placement: 4 },
  ]);
  expect(revealedWinnerCue(cues, cues.length - 2)).toBeNull();
  expect(revealedWinnerCue(cues, cues.length - 1)).toBe(result);
  const closing = { source: "house" as const, kind: "house_bridge" as const, key: "closing", followingCueKey: "end", canonicalSequence: 31, round: 5, phase: "JURY_VOTE" as const, title: "Game over", baseDurationMs: 2000 };
  expect(revealedWinnerCue([...cues, closing], cues.length)).toBe(result);
  expect(revealedWinnerCue(cues, 0)).toBeNull();
  const beat = visualWatchPresentation({ enabled: true, status: null, portraits: { Kaiya: "/kaiya-head.png" }, fullBodies: { Ione: "/ione-body.png" }, scenes: [] }, result, null, players).beat;
  expect(beat).toMatchObject({ kind: "winner", winner: { id: "Ione", fullBodyReferenceUrl: "/ione-body.png" }, standings: [
    { id: "Kaiya", placement: 2, avatarUrl: "/kaiya-head.png", juryMember: false }, { id: "Marnie", placement: 3, juryMember: true }, { id: "Arden", placement: 4, juryMember: true },
  ] });
  // Missing exit history never borrows future/live statuses or invents placements.
  expect(buildEndgamePresentationCues([jury]).at(-1)!.standings?.filter(entry => entry.placement === null)).toHaveLength(3);
  expect(buildEndgamePresentationCues([marnieOut, jury]).at(-1)!.standings?.find(entry => entry.playerId === "Marnie")?.placement).toBeNull();
});

test("jury transcript receipts never duplicate canonical ballots, including live append and reconnect", () => {
  const votes = { Arden: "Ione", Marnie: "Kaiya" };
  const jury = frame({ ...base, phase: Phase.JURY_VOTE, sequence: 30, type: "jury.winner_determined", payload: { votes, winnerId: "Ione" } });
  const receipts: TranscriptEntry[] = Object.entries(votes).map(([voterId, targetId], index) => ({
    id: index + 1, entrySequence: index + 1, firstDurableEventSequence: 28 + index,
    gameId: "endgame", round: 3, phase: "JURY_VOTE", scope: "system", dialogueKind: "system_announcement", fromPlayerId: null, fromPlayerName: "The House", toPlayerIds: null,
    text: "Receipt wording is not authority", timestamp: index, acceptedBallot: { purpose: "winner", voterId, targetId },
  }));
  const summary: TranscriptEntry = { ...receipts[0]!, id: 3, entrySequence: 3, firstDurableEventSequence: 30, acceptedBallot: undefined, dialogueKind: "house_summary", text: "The jury has decided." };
  const scenes = buildStoryScenes([...receipts, summary]);
  const compile = (frames: GameWatchReplayFrame[]) => withHouseBridges([
    ...buildClassicPresentationCues(scenes, frames, players), ...buildEndgamePresentationCues(frames),
  ].sort(comparePresentationCues), scenes);
  expect(buildStoryScenes(receipts)).toEqual([]);
  const cues = compile([jury]);
  expect(cues.map(c => c.kind)).toEqual(["endgame_ballot", "endgame_ballot", "endgame_winner", "classic_transcript"]);
  expect(cues.filter(c => c.source === "endgame").map(c => c.ballot?.voterId)).toEqual(["Arden", "Marnie", undefined]);
  const director = createPresentationDirector();
  director.load(buildEndgamePresentationCues([]));
  director.append(cues);
  expect(findPresentationCueIndexForSequence(cues, 28)).toBe(0);
  director.seek(1);
  director.append(compile([jury]));
  expect(director.getSnapshot().activeKey).toBe(cues[1]!.key);
  expect(director.getSnapshot().cueKeys).toEqual(cues.map(c => c.key));
  director.dispose();
  expect(isStoryDialogue({ ...receipts[0]!, acceptedBallot: { voterId: "Arden", targetId: "Ione", purpose: "eliminate" } })).toBe(true);
  expect(isStoryDialogue({ ...receipts[0]!, acceptedBallot: undefined, scope: "public", fromPlayerId: "Arden", text: "I vote for Ione." })).toBe(true);
});
