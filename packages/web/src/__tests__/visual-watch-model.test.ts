import { createFormatKernelViewerScenario } from "@influence/engine/fixtures/format-kernel-viewer";
import { sceneSpeechDurationMs } from "../app/games/[slug]/components/scene-speech-timing";
import { compileFormatPresentationPrefix } from "../app/games/[slug]/components/format-presentation-model";
import { expect, test } from "bun:test";
import { createPresentationDirector } from "../app/games/[slug]/components/influence-presentation-director";
import { visualWatchPresentation, paceVisualBallots, transcriptPresentationDurationMs, type VisualWatchData } from "../app/games/[slug]/components/visual-watch-model";
import { soloPresentationDurationMs } from "../app/games/[slug]/components/solo-presentation-timing";
import { visualSpeechDurationMs } from "@influence/engine/visual-speech";
import type { GamePlayer, TranscriptEntry } from "../lib/api";
const player: GamePlayer = { id: "a", name: "Ada", persona: "social", status: "alive", shielded: false };
const message: TranscriptEntry = { id: 10, gameId: "g", round: 1, phase: "LOBBY", fromPlayerId: "a", fromPlayerName: "Ada", scope: "public", toPlayerIds: null, text: "Let us talk.", timestamp: 1, entrySequence: 5, visualScene: { id: "old", roomId: "lobby" } };
const data: VisualWatchData = { enabled: true, status: null, portraits: { a: "/frozen.png" }, scenes: [
  { id: "old", roomId: "lobby", version: 1, afterDialogueSequence: 2, imageUrl: "/old.png", participantIds: ["a"], anchors: [] },
  { id: "new", roomId: "lobby", version: 2, afterDialogueSequence: 5, imageUrl: "/new.png", participantIds: ["a"], anchors: [] },
] };
test("selects saved scene versions by dialogue sequence, including backward seeking", () => {
  expect(visualWatchPresentation(data, null, message, [player]).beat).toMatchObject({ kind: "scene", sceneId: "old" });
  expect(visualWatchPresentation(data, null, { ...message, entrySequence: 6, visualScene: { id: "new", roomId: "lobby" } }, [player]).beat).toMatchObject({ kind: "scene", sceneId: "new" });
  expect(visualWatchPresentation(data, null, message, [player]).beat).toMatchObject({ sceneId: "old" });
  expect(visualWatchPresentation(data, null, { ...message, entrySequence: undefined }, [player]).rooms).toEqual([]);
});
test("farewells use accepted metadata and the frozen portrait, never words or current player status", () => {
  expect(visualWatchPresentation(data, null, { ...message, presentationPurpose: "farewell" }, [player]).beat).toMatchObject({ kind: "portrait", purpose: "Farewell", player: { avatarUrl: "/frozen.png" } });
  expect(visualWatchPresentation(data, null, { ...message, text: "Goodbye everyone" }, [{ ...player, status: "eliminated" }]).beat?.kind).toBe("scene");
});
test("anonymous speech cannot identify its author", () => {
  expect(visualWatchPresentation(data, null, { ...message, anonymous: true }, [player]).beat).toMatchObject({ speech: { playerId: null, speaker: "Anonymous" } });
});
test("ballot phases do not fall back to room imagery or invented ballot text", () => {
  expect(visualWatchPresentation(data, null, { ...message, phase: "VOTE", visualScene: undefined }, [player]).beat).toMatchObject({ kind: "portrait", speech: { text: message.text } });
});

test("games without generated media still present portraits and House text", () => {
  const plain: VisualWatchData = { enabled: false, status: null, portraits: {}, scenes: [] };
  expect(visualWatchPresentation(plain, null, { ...message, visualScene: undefined }, [player]).beat).toMatchObject({ kind: "portrait", speech: { text: message.text } });
  expect(visualWatchPresentation(plain, null, { ...message, visualScene: undefined, fromPlayerId: null, scope: "system", phase: "REVEAL" }, [player]).beat).toEqual({ kind: "house", text: message.text });
});

test("saved names resolve only to a unique frozen seat and unresolved attribution stays readable", () => {
  const plain = { ...data, scenes: [] };
  expect(visualWatchPresentation(plain, null, { ...message, fromPlayerId: "Ada", visualScene: undefined }, [player]).beat).toMatchObject({ kind: "portrait", player: { id: "a" }, speech: { playerId: "a" } });
  expect(visualWatchPresentation(plain, null, { ...message, fromPlayerId: "Ada", visualScene: undefined }, [player, { ...player, id: "other" }]).beat).toMatchObject({ speech: { playerId: null, text: message.text } });
});

test("Mingle replaces only the room with a semicircle when any audience member lacks body art", () => {
  const other = { ...player, id: "b", name: "Bea" };
  const bystander = { ...player, id: "c", name: "Cy" };
  const mingle = { ...message, phase: "FORMAT_MINGLE" as const, scope: "mingle" as const, roomId: 2, toPlayerIds: ["Bea"] };
  const missing = visualWatchPresentation({ ...data, fullBodies: { a: "/body-a.png" } }, null, mingle, [player, other, bystander]).beat;
  expect(missing).toMatchObject({ kind: "portrait-room", roomNumber: 2, participants: [{ id: "a" }, { id: "b" }], speech: { playerId: "a" } });
  expect(visualWatchPresentation({ ...data, fullBodies: { a: "/body-a.png", b: "/body-b.png" } }, null, mingle, [player, other]).beat?.kind).toBe("scene");
  expect(visualWatchPresentation({ ...data, scenes: [] }, null, { ...mingle, toPlayerIds: null }, [player, other]).beat).toMatchObject({ kind: "portrait-room", participants: [{ id: "a" }] });
  expect(visualWatchPresentation({ ...data, scenes: [] }, null, { ...mingle, roomId: undefined, toPlayerIds: null }, [player, other]).beat).toMatchObject({ roomNumber: null, participants: [{ id: "a" }] });
  expect(transcriptPresentationDurationMs({ ...mingle, visualScene: undefined }, [player, other])).toBe(sceneSpeechDurationMs(mingle.text));
});

test("published canonical binding displays formerly portrait-only speech without changing individual beats", () => {
  const published = { ...data, bindings: { 5: "old" }, scenes: data.scenes.map(s => ({ ...s, imageUrl: "/published.png", publicationRevision: 2 })) };
  const fallback = { ...message, visualScene: undefined };
  expect(visualWatchPresentation(published, null, fallback, [player]).beat).toMatchObject({ kind: "scene", sceneId: "old" });
  expect(visualWatchPresentation(published, null, { ...fallback, presentationPurpose: "farewell" }, [player]).beat).toMatchObject({ purpose: "Farewell" });
  expect(visualWatchPresentation(published, null, { ...fallback, scope: "diary" }, [player]).beat).toMatchObject({ purpose: "Diary" });
  expect(visualWatchPresentation(published, null, { ...fallback, phase: "INTRODUCTION" }, [player]).beat).toMatchObject({ purpose: "Introduction" });
  expect(visualWatchPresentation({ ...data, bindings: {} }, null, fallback, [player]).beat?.kind).toBe("portrait");
});


test("all accepted ballot purposes say only the target name using the frozen body", () => {
  const frozen = { ...data, fullBodies: { a: "/saved-body.png" } };
  for (const purpose of ["empower", "eliminate", "winner"] as const) {
    expect(visualWatchPresentation(frozen, null, { ...message, text: "Private reasoning must not be spoken", acceptedBallot: { voterId: "a", targetId: "a", purpose } }, [player]).beat).toMatchObject({ kind: "portrait", purpose: "Ballot", speech: { text: "Ada" }, player: { fullBodyReferenceUrl: "/saved-body.png" } });
  }
});

test("solo and room cues budget their staging while House speech keeps its timing", () => {
  expect(transcriptPresentationDurationMs(message, [player])).toBe(sceneSpeechDurationMs(message.text));
  expect(transcriptPresentationDurationMs({ ...message, visualScene: undefined }, [player])).toBe(soloPresentationDurationMs(message.text));
  expect(transcriptPresentationDurationMs({ ...message, phase: "INTRODUCTION" }, [player])).toBe(soloPresentationDurationMs(message.text));
  expect(transcriptPresentationDurationMs({ ...message, visualScene: undefined, fromPlayerId: null, scope: "system", dialogueKind: "house_summary" }, [player])).toBe(visualSpeechDurationMs(message.text));
  expect(transcriptPresentationDurationMs({ ...message, text: "Hidden reasoning. ".repeat(60), acceptedBallot: { voterId: "a", targetId: "a", purpose: "winner" } }, [player])).toBe(soloPresentationDurationMs("Ada"));
});


test.each(["two_names_declined", "save_or_eliminate_clear", "vote_bomb_clear", "majority_elimination_clear", "safety_bounce_tie"] as const)("%s sealed roll calls retain canonical voters and targets in solo presentation", (scenarioId) => {
  const scenario = createFormatKernelViewerScenario(scenarioId);
  const players: GamePlayer[] = scenario.roster.map(p => ({ ...p, persona: "diplomat", status: "alive", shielded: false }));
  const compiled = compileFormatPresentationPrefix({ gameId: "g", gameKernel: "format", roster: scenario.roster, decisions: scenario.decisions, formatManifest: ["two_names", "vote_bomb", "save_or_eliminate", "majority_elimination", "safety_bounce"] });
  expect(compiled.diagnostic).toBeNull();
  const paced = paceVisualBallots(compiled.cues, players);
  const ballots = paced.filter(c => c.source === "format" && c.kind === "format_roll_call" && !c.voteSummary);
  expect(ballots.length).toBeGreaterThan(0);
  for (const cue of ballots) {
    if (cue.source !== "format" || cue.kind !== "format_roll_call") throw new Error("Expected ballot");
    const beat = visualWatchPresentation(data, cue, null, players).beat;
    expect(beat).toMatchObject({ kind: "portrait", purpose: "Ballot", player: { id: cue.ballot.voterId }, speech: { text: players.find(p => p.id === cue.ballot.targetId)!.name } });
    expect(cue.speechPresentation).toBe("solo");
    expect(cue.baseDurationMs).toBe(soloPresentationDurationMs(players.find(p => p.id === cue.ballot.targetId)!.name));
  }
  expect(paced.filter(c => c.source === "format" && !c.visualBallot && !c.voteSummary).map(c => c.key)).toEqual(compiled.cues.map(c => c.key));
});


test("Empowered revotes follow the tie beat without repeating original votes, and accepted pleas use solo speech", () => {
  const scenario = createFormatKernelViewerScenario("two_names_declined");
  const players: GamePlayer[] = scenario.roster.map(p => ({ ...p, persona: "diplomat", status: "alive", shielded: false }));
  const compiled = compileFormatPresentationPrefix({ gameId: "g", gameKernel: "format", roster: scenario.roster, decisions: scenario.decisions, formatManifest: ["two_names", "vote_bomb"] });
  const receipts = players.map((p, i) => ({ voterId: p.id, targetId: players[0]!.id, revoteTargetId: i === 0 ? players[1]!.id : null }));
  const tally = { ...compiled.cues[0]!, kind: "empowered_tally" as const, counts: { [players[0]!.id]: players.length }, empoweredId: players[0]!.id, receipts };
  const tie = { ...tally, key: "tie", kind: "empowered_tie" as const, tiedPlayerIds: players.slice(0, 2).map(p => p.id) };
  const paced = paceVisualBallots([tie, { ...tally, resolutionMethod: "revote" }], players);
  expect(paced[receipts.length + 1]?.key).toBe("tie");
  expect(paced.at(-1)?.key).toBe(tally.key);
  const pending = paceVisualBallots([tie], players);
  expect(paced.slice(0, pending.length)).toEqual(pending);
  expect(new Set(paced.map(c => c.key)).size).toBe(paced.length);
  const director = createPresentationDirector();
  director.load(pending);
  director.seek(pending.length - 1);
  const before = director.getSnapshot();
  director.append(paced);
  director.append(paced);
  expect(director.getSnapshot().activeKey).toBe(before.activeKey);
  expect(director.getSnapshot().isPlaying).toBe(false);
  director.manualAdvance();
  expect(director.getActiveCue()).toMatchObject({ visualBallot: { revote: true, targetId: players[1]!.id }, speechPresentation: "solo" });
  expect(director.getElapsedBaseMs()).toBeGreaterThan(0);
  director.dispose();
  const ballots = paced.flatMap(c => c.source === "format" && c.visualBallot && !c.voteSummary ? [c.visualBallot] : []);
  expect(ballots.map(b => b.targetId)).toEqual([...receipts.map(r => r.targetId), players[1]!.id]);
  expect(ballots.at(-1)?.revote).toBe(true);
  for (const cue of compiled.cues.filter(c => c.kind === "two_names_plea" && c.status === "accepted")) {
    if (cue.kind !== "two_names_plea") throw new Error("Missing plea");
    expect(visualWatchPresentation(data, cue, null, players).beat).toMatchObject({ kind: "portrait", purpose: "Plea", speech: { text: cue.text }, player: { id: cue.speakerId } });
  }
});

test("an exact cast binding beats a newer room image with other participants", () => {
  const bound = visualWatchPresentation({ ...data, bindings: { 6: "old" }, scenes: data.scenes.map(scene => scene.id === "new" ? { ...scene, participantIds: ["a", "eliminated-player"] } : scene) }, null, { ...message, entrySequence: 6, visualScene: undefined, phase: "PLEA" }, [player]);
  expect(bound.beat).toMatchObject({ kind: "scene", sceneId: "old" });
  expect(bound.rooms.find(room => room.roomId === "lobby")?.participantIds).toEqual(["a"]);
});

test.each(["two_names_used_tie", "majority_elimination_tie", "even_votes_tie", "safety_bounce_tie"] as const)("%s shows the deciding player with the full nominee pool before elimination", scenarioId => {
  const scenario = createFormatKernelViewerScenario(scenarioId);
  const players: GamePlayer[] = scenario.roster.map(p => ({ ...p, persona: "diplomat", status: "alive", shielded: false }));
  const compiled = compileFormatPresentationPrefix({ gameId: "g", gameKernel: "format", roster: scenario.roster, decisions: scenario.decisions });
  expect(compiled.diagnostic).toBeNull();
  const cues = paceVisualBallots(compiled.cues, players);
  const index = cues.findIndex(c => c.kind === "format_deciding_vote");
  const cue = cues[index]!;
  if (cue.source !== "format" || cue.kind !== "format_deciding_vote") throw new Error("Missing deciding vote");
  expect(cues[index - 1]?.kind).toBe("format_tiebreak");
  expect(cues[index + 1]?.kind).toBe("format_elimination");
  expect(cue.baseDurationMs).toBe(4400);
  for (const fullBodies of [{}, { [cue.tiebreakerId]: "/body.png" }]) {
    expect(visualWatchPresentation({ ...data, fullBodies }, cue, null, players).beat).toMatchObject({
      kind: "nominee-selection", chooser: { id: cue.tiebreakerId, fullBodyReferenceUrl: fullBodies[cue.tiebreakerId] }, selectedId: cue.targetId,
    });
  }
});


test.each(["majority_elimination_tie", "even_votes_tie", "vote_bomb_clear", "save_or_eliminate_clear", "safety_bounce_tie", "two_names_used_tie"] as const)("%s highlights only the canonical eligible pool after every vote, then stages the deciding choice", async scenarioId => {
 const {voteLedgerForCue} = await import("../app/games/[slug]/components/vote-ledger-model");
 const scenario = createFormatKernelViewerScenario(scenarioId);
 const players: GamePlayer[] = scenario.roster.map(p => ({...p,persona:"diplomat",status:"alive",shielded:false}));
 const compiled = compileFormatPresentationPrefix({gameId:"g",gameKernel:"format",roster:scenario.roster,decisions:scenario.decisions,formatManifest:["two_names","vote_bomb","save_or_eliminate","majority_elimination","safety_bounce","even_votes"]});
 expect(compiled.diagnostic).toBeNull();
 const paced = paceVisualBallots(compiled.cues,players);
 const tally = paced.findIndex(cue=>cue.source==="format" && cue.kind==="format_roll_call" && cue.voteSummary);
 expect(tally).toBeGreaterThan(0);
 const ledger=voteLedgerForCue(paced,tally)!;
 const resolution=compiled.cues.find(cue=>cue.kind==="format_aggregate")!;
 if(resolution.kind!=="format_aggregate")throw new Error("Missing resolution");
 expect(ledger.votes).toHaveLength(ledger.total);
 expect(ledger.eligibility?.ids).toEqual(resolution.resolution.tiedPlayerIds.length ? resolution.resolution.tiedPlayerIds : [resolution.resolution.eliminatedId]);
 expect(voteLedgerForCue(paced,tally-1)?.eligibility).toBeUndefined();
 for(const cue of paced.filter(cue=>cue.kind==="format_tiebreak" || cue.kind==="format_deciding_vote")) {
   const beat=visualWatchPresentation({enabled:false,status:null,portraits:{},scenes:[]},cue,null,players).beat;
   expect(beat?.kind).toBe("nominee-selection");
   if(beat?.kind!=="nominee-selection")throw new Error("Missing nominee scene");
   expect(beat.nominees.map(p=>p.id)).toEqual(resolution.resolution.tiedPlayerIds);
   expect(beat.selectedId).toBe(cue.kind==="format_deciding_vote" ? resolution.resolution.eliminatedId : null);
   expect(beat.chooser.id).toBe(resolution.resolution.tiebreakerId!);
 }
});


test("Even Votes all-odd fallback displays the full canonical pool", async () => {
  const {voteLedgerForCue} = await import("../app/games/[slug]/components/vote-ledger-model");
  const scenario = createFormatKernelViewerScenario("even_votes_tie");
  const ids = scenario.roster.map(player => player.id);
  const decisions = scenario.decisions.map(event => {
    if (event.type === "format.ballot_cast") {
      const targetId = ids[(ids.indexOf(event.payload.voterId) + 1) % ids.length]!;
      return {...event, payload: {...event.payload, targetId}};
    }
    if (event.type === "format.resolved") return {...event, payload: {...event.payload,
      tiedPlayerIds: ids, aggregate: {capability:"sealed_elim" as const, totals:Object.fromEntries(ids.map(id=>[id,1])), eligiblePlayerIds:ids},
    }};
    return event;
  });
  const players: GamePlayer[] = scenario.roster.map(p=>({...p,persona:"diplomat",status:"alive",shielded:false}));
  const compiled = compileFormatPresentationPrefix({gameId:"g",gameKernel:"format",roster:scenario.roster,decisions});
  expect(compiled.diagnostic).toBeNull();
  const cues = paceVisualBallots(compiled.cues,players);
  const tally = cues.findIndex(cue=>cue.kind==="format_roll_call" && cue.voteSummary);
  expect(voteLedgerForCue(cues,tally)?.eligibility).toEqual({ids,label:"All totals are odd · empowered choice"});
});
