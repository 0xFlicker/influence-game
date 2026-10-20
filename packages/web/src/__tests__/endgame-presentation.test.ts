import { expect, test } from "bun:test";
import { Phase } from "@influence/engine";
import type { GameWatchReplayFrame, ViewerDecisionEvent, TranscriptEntry } from "../lib/api";
import { buildEndgamePresentationCues, revealedWinnerCue, compileRevealedWinnerCues } from "../app/games/[slug]/components/endgame-presentation";
import { visualWatchPresentation } from "../app/games/[slug]/components/visual-watch-model";
import { findPresentationCueIndexForSequence } from "../app/games/[slug]/components/presentation-sequence";
import { buildStoryScenes, isStoryDialogue, withHouseBridges } from "../app/games/[slug]/components/house-story";
import { createPresentationDirector } from "../app/games/[slug]/components/influence-presentation-director";
import { buildClassicPresentationCues, comparePresentationCues } from "../app/games/[slug]/components/dramatic-replay-viewer";
import { buildExportCues } from "../lib/replay-export/cues";

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

test("winner holds end at the retrospective boundary and canonical parts survive backward seeks", () => {
  const jury = frame({ ...base, phase: Phase.JURY_VOTE, sequence: 30, type: "jury.winner_determined", payload: {votes: {}, winnerId: "Ione"} });
  const retrospective: TranscriptEntry = {id: 40, gameId: "endgame", round: 4, phase: Phase.RETROSPECTIVE, firstDurableEventSequence: 40,
    fromPlayerId: "Arden", fromPlayerName: "Arden", scope: "public", toPlayerIds: null, text: "I now understand why I left.", timestamp: 40};
  const scene = {id: "retrospective", round: 4, phase: Phase.RETROSPECTIVE, roomType: "endgame" as const, messages: [retrospective]};
  const tail = buildClassicPresentationCues([scene], [ardenOut, jury], players);
  const winner = buildEndgamePresentationCues([jury]).at(-1)!;
  expect(compileRevealedWinnerCues([winner, ...tail])).toEqual([winner, null]);
  const data = {enabled: false, status: null, portraits: {}, scenes: []};
  expect(visualWatchPresentation(data, tail[0]!, retrospective, players, [], [ardenOut, jury]).beat).toMatchObject({purpose: "Retrospective", caption: "Retrospective · Eliminated · Round 3"});
  expect(visualWatchPresentation(data, tail[0]!, {...retrospective, fromPlayerId: "Ione"}, players, [], [ardenOut, jury]).beat).toMatchObject({caption: "Retrospective · Winner"});
  expect(visualWatchPresentation(data, winner, null, players).beat?.kind).toBe("winner");
});

test("completed retrospectives return to canonical results in playback and exports", () => {
  const jury = frame({ ...base, round: 4, phase: Phase.JURY_VOTE, sequence: 30, type: "jury.winner_determined", payload: { votes: { Arden: "Ione", Marnie: "Kaiya" }, winnerId: "Ione" } });
  const speech: TranscriptEntry = {id: 40, entrySequence: 40, gameId: "endgame", round: 4, phase: Phase.RETROSPECTIVE, firstDurableEventSequence: 40,
    fromPlayerId: "Arden", fromPlayerName: "Arden", scope: "public", toPlayerIds: null, text: "I learned from the jury.", timestamp: 40};
  const completion: GameWatchReplayFrame = {...jury, sequence: 41, timestamp: 41, phase: Phase.RETROSPECTIVE, eventType: "retrospective.completed", viewerDecisionEvent: undefined};
  const prefix = [finalFour, ardenOut, finalThree, marnieOut, jury];
  const scenes = buildStoryScenes([speech]);
  const compile = (frames: GameWatchReplayFrame[]) => withHouseBridges([
    ...buildClassicPresentationCues(scenes, frames, players), ...buildEndgamePresentationCues(frames),
  ].sort(comparePresentationCues), scenes);
  const pending = compile(prefix);
  const completed = compile([...prefix, completion]);
  expect(pending.at(-1)?.kind).toBe("classic_transcript");
  expect(completed.slice(0, -1)).toEqual(pending);
  const closing = completed.at(-1)!;
  if (closing.source !== "endgame") throw new Error("Expected closing result");
  expect(closing).toMatchObject({kind: "endgame_winner", playerId: "Ione", canonicalSequence: 41});
  expect(compileRevealedWinnerCues(completed).slice(-2)).toEqual([null, closing]);
  expect(new Set(completed.map(cue => cue.key)).size).toBe(completed.length);
  const speechSeek = findPresentationCueIndexForSequence(completed, 40);
  expect(completed[speechSeek]?.phase).toBe("RETROSPECTIVE");
  expect(speechSeek).toBeLessThan(completed.length - 1);
  expect(findPresentationCueIndexForSequence(completed, 41)).toBe(completed.length - 1);
  expect(buildEndgamePresentationCues([completion])).toEqual([]);

  const director = createPresentationDirector();
  director.load(pending);
  director.seek(pending.length - 1);
  director.append(completed);
  expect(director.getActiveCue()?.key).toBe(pending.at(-1)!.key);
  director.seek(completed.length - 1);
  expect(director.getActiveCue()).toEqual(closing);
  director.dispose();

  const exported = buildExportCues({kind: "influence", game: {id: "endgame", slug: "endgame", status: "completed", gameKernel: "classic", players},
    frames: [...prefix, completion], messages: [speech], visual: {enabled: false, status: null, portraits: {}, scenes: []}, thoughts: {}});
  const last = exported.at(-1)!;
  expect(last.timing.kind).toBe("result");
  expect(last.speech).toBeNull();
  expect(last.picture.kind === "influence" && last.picture.beat).toMatchObject({kind: "winner", winner: {id: "Ione"},
    standings: [{id: "Kaiya", placement: 2}, {id: "Marnie", placement: 3}, {id: "Arden", placement: 4}]});
});

test("single-survivor retrospectives close on results without inventing a jury or missing placements", () => {
  const kaiyaOut = frame({...base, round: 5, sequence: 30, type: "player.eliminated", payload: {playerId: "Kaiya", playerName: "Kaiya"}});
  const completion: GameWatchReplayFrame = {...kaiyaOut, sequence: 41, phase: Phase.RETROSPECTIVE, eventType: "retrospective.completed", viewerDecisionEvent: undefined,
    players: players.map(player => ({...player, status: player.id === "Ione" ? "alive" : "eliminated"}))};
  const closing = buildEndgamePresentationCues([ardenOut, marnieOut, kaiyaOut, completion]).at(-1)!;
  expect(closing).toMatchObject({kind: "endgame_winner", playerId: "Ione", juryVoterIds: []});
  expect(closing.standings).toEqual([
    {playerId: "Arden", placement: 4}, {playerId: "Kaiya", placement: 2},
    {playerId: "Marnie", placement: 3}, {playerId: "Ione", placement: 1},
  ]);
  expect(buildEndgamePresentationCues([completion]).at(-1)?.standings?.filter(player => player.placement === null)).toHaveLength(3);
  expect(buildEndgamePresentationCues([{...completion, players}])).toEqual([]);
  expect(buildEndgamePresentationCues([ardenOut, marnieOut, kaiyaOut]).some(cue => cue.kind === "endgame_winner")).toBe(false);
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
  const indexed = compileRevealedWinnerCues([...cues, closing]);
  for (const cursor of [cues.length, 0, cues.length - 2, cues.length - 1, 1, cues.length]) {
    const latest = [...cues, closing].slice(0,cursor+1).findLast(cue => cue.source === "endgame" && cue.kind === "endgame_winner");
    const expected = latest?.source === "endgame" ? latest : null;
    expect(indexed[cursor]).toBe(expected);
    expect(compileRevealedWinnerCues([...cues, closing])[cursor]).toBe(expected);
  }
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
