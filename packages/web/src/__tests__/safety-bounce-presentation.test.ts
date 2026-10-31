import {expect, test} from "bun:test";
import {createFormatKernelViewerScenario, FORMAT_KERNEL_VIEWER_SCENARIO_IDS} from "@influence/engine/fixtures/format-kernel-viewer";
import {FORMAT_PRESENTATION_METADATA} from "@influence/engine/format-presentation-metadata";
import {compileFormatPresentationPrefix} from "../app/games/[slug]/components/format-presentation-model";
import {composeInfluencePresentation} from "../app/games/[slug]/components/influence-presentation";
import {buildStoryScenes} from "../app/games/[slug]/components/house-story";
import {buildClassicPresentationCues, mergeFormatAndSocialCues} from "../app/games/[slug]/components/influence-replay-cues";
import {visualWatchPresentation} from "../app/games/[slug]/components/visual-watch-model";
import {influenceThinkingActor} from "../app/games/[slug]/components/influence-thinking";
import {safetyChainPosition} from "../app/games/[slug]/components/safety-chain";
import {FormatPresentation} from "../app/games/[slug]/components/format-presentation";
import {renderToStaticMarkup} from "react-dom/server";
import {createElement} from "react";
import {assertReplayFrameOwnership, assertViewerEventOwnership} from "../app/games/[slug]/components/presentation-ownership";
import type {GameWatchReplayFrame, GamePlayer, TranscriptEntry, ViewerDecisionEvent} from "../lib/api";
const scenario = createFormatKernelViewerScenario("safety_bounce_tie");
const players: GamePlayer[] = scenario.roster.map(p => ({...p, persona: "", status: "alive", shielded: false}));
const compile = () => compileFormatPresentationPrefix({gameId: "g", gameKernel: "format", gameSchemaVersion: 2, roster: players, decisions: scenario.decisions});
const data = {enabled: false, status: null, portraits: {}, scenes: [], fullBodies: {atlas: "/atlas.png"}};
const deliveries: TranscriptEntry[] = compile().cues.flatMap((cue, index) => cue.kind === "safety_bounce_pointer" || cue.kind === "format_tiebreak" ? [{
  id: index, gameId: "g", round: cue.round, phase: cue.phase, scope: "public", fromPlayerId: cue.kind === "safety_bounce_pointer" ? cue.actorId : cue.tiebreakerId, fromPlayerName: null,
  toPlayerIds: null, text: `My reason for decision ${index}.`, timestamp: index, entrySequence: index + 1,
  thinking: `Private thought ${index}`, decisionSpeech: {action: cue.kind === "safety_bounce_pointer" ? "bounce-pointer" : "format-tiebreak", actorId: cue.kind === "safety_bounce_pointer" ? cue.actorId : cue.tiebreakerId},
}] : []);

test("historically late public speeches are consumed once at each pick and tie, before the reveal", () => {
  const scenes = buildStoryScenes(deliveries);
  const cues = composeInfluencePresentation("g", [...compile().cues, ...buildClassicPresentationCues(scenes, [], players)], players, scenes, 2);
  expect(cues.filter(cue => cue.source === "classic")).toHaveLength(0);
  expect(cues.filter(cue => cue.decisionSpeechEntry)).toHaveLength(deliveries.length);
  for (const cue of cues.filter(cue => cue.decisionSpeechEntry)) {
    const beat = visualWatchPresentation(data, cue, null, players).beat!;
    expect(beat && "speech" in beat && beat.speech?.text).toBe(cue.decisionSpeechEntry!.text);
    expect(influenceThinkingActor(cue, beat)).toBe(cue.decisionSpeechEntry!.decisionSpeech!.actorId);
    if (cue.kind === "format_tiebreak") {
      expect(beat).toMatchObject({kind: "nominee-selection", selectedId: null});
      expect(cues.findIndex(row => row.kind === "format_deciding_vote")).toBeGreaterThan(cues.indexOf(cue));
    }
  }
});

test("unknown events, ambiguous and orphan speeches fail only under the new root contract", () => {
  const unknown = {...scenario.decisions[0]!, type: "future.event"} as unknown as ViewerDecisionEvent;
  expect(() => assertViewerEventOwnership([unknown], 2)).toThrow("unknown-event");
  expect(() => assertViewerEventOwnership([unknown], undefined)).not.toThrow();
  expect(() => assertViewerEventOwnership([], 3)).toThrow("Unsupported Influence game schema");
  const scenes = buildStoryScenes([...deliveries, {...deliveries[0]!, id: 999}]);
  expect(() => composeInfluencePresentation("g", compile().cues, players, scenes, 2)).toThrow("ambiguous-speech");
  expect(() => composeInfluencePresentation("g", compile().cues, players, scenes)).not.toThrow();
  const orphan = buildStoryScenes([{...deliveries[0]!, decisionSpeech: {action: "bounce-pointer", actorId: "unknown"}}]);
  expect(() => composeInfluencePresentation("g", compile().cues, players, orphan, 2)).toThrow("unconsumed-speech");
  const required = compile().cues.map(cue => cue.kind === "safety_bounce_pointer" ? {...cue, requiredDecisionSpeech: {actorId: cue.actorId, action: "bounce-pointer"}} : cue);
  expect(() => composeInfluencePresentation("g", required, players, [], 2)).toThrow("missing-speech");
  // A live chain can arrive before its accompanying transcript publication.
  expect(() => composeInfluencePresentation("g", required.filter(cue => cue.kind !== "format_elimination"), players, [], 2)).not.toThrow();
});

test("old chains without speech or lobby images use the new scene and give the terminal target no turn", () => {
  for (const cue of compile().cues) {
    if (cue.kind !== "safety_bounce_started" && cue.kind !== "safety_bounce_pointer") continue;
    const beat = visualWatchPresentation(data, cue, null, players).beat;
    expect(beat).toMatchObject({kind: "safety-chain", cue, speech: undefined});
    const board = cue.after.safetyBounce!;
    const ids = [...board.safePlayerIds, ...board.vulnerablePlayerIds, ...board.benchPlayerIds];
    expect(new Set(ids).size).toBe(players.length);
    if (!board.benchPlayerIds.length) expect(ids.every(id => safetyChainPosition(board, id).pool)).toBe(true);
  }
});

test("every catalog format has a real fixture and every fixture prefix compiles to renderable cues", () => {
  const covered = new Set<string>();
  for (const id of FORMAT_KERNEL_VIEWER_SCENARIO_IDS) {
    const fixture = createFormatKernelViewerScenario(id);
    if (fixture.expected.selectedFormatId) covered.add(fixture.expected.selectedFormatId);
    for (let length = 1; length <= fixture.decisions.length; length++) {
      const result = compileFormatPresentationPrefix({gameId: "g", gameKernel: "format", gameSchemaVersion: 2, roster: fixture.roster, formatManifest: Object.keys(FORMAT_PRESENTATION_METADATA) as Array<keyof typeof FORMAT_PRESENTATION_METADATA>, decisions: fixture.decisions.slice(0, length)});
      // Deliberately malformed fixture branches retain their diagnostic proof.
      if (fixture.expected.status === "malformed") continue;
      expect(result.diagnostic).toBeNull();
      for (const cue of result.cues) expect(renderToStaticMarkup(createElement(FormatPresentation, {cue, roster: fixture.roster, currentStateEntry: false})).length).toBeGreaterThan(0);
    }
  }
  expect([...covered].sort()).toEqual(Object.keys(FORMAT_PRESENTATION_METADATA).sort());
});


test("new roots reject unsupported or missing canonical frame projections while old frames remain readable", () => {
  const frame = {schemaVersion: 3, sequence: 7, eventType: "format.selected"} as GameWatchReplayFrame;
  expect(() => assertReplayFrameOwnership([frame], 2)).toThrow("missing-event-projector");
  expect(() => assertReplayFrameOwnership([frame], undefined)).not.toThrow();
  expect(() => assertReplayFrameOwnership([{...frame, eventType: "future.event"}], 2)).toThrow("unknown-canonical-event");
  expect(() => assertReplayFrameOwnership([{...frame, schemaVersion: 2}], 2)).toThrow("unsupported-frame-version");
  expect(() => assertReplayFrameOwnership([{...frame, viewerDecisionEvent: {...scenario.decisions[0]!, sequence: 8}}], 2)).toThrow("event-frame-mismatch");
});

test("an incomplete live speech delivery buffers the dependent chain even after resolution arrives", () => {
  const required = compile().cues.map(cue => cue.kind === "safety_bounce_pointer" ? {...cue, requiredDecisionSpeech: {actorId: cue.actorId, action: "bounce-pointer"}} : cue);
  const buffered = composeInfluencePresentation("g", required, players, [], 2, {speechPrefixComplete: false});
  expect(buffered.some(cue => cue.kind === "safety_bounce_pointer")).toBe(false);
  expect(buffered.some(cue => cue.kind === "format_elimination")).toBe(false);
});


test("sealed ballot explanations attach to the vote reveal and never become tail dialogue", () => {
  const ballots: TranscriptEntry[] = scenario.decisions.flatMap(event => event.type === "format.ballot_cast" ? [{...deliveries[0]!, id:event.sequence, round:event.round, phase:event.phase!, scope:"system", fromPlayerId:event.payload.voterId, text:`House explanation ${event.sequence}`, decisionSpeech:{action:"format-ballot", actorId:event.payload.voterId}}] : []);
  const scenes = buildStoryScenes(ballots);
  const cues = composeInfluencePresentation("g", [...compile().cues, ...buildClassicPresentationCues(scenes, [], players)], players, scenes, 2);
  for (const ballot of ballots) expect(cues.find(cue => cue.source === "format" && cue.kind === "format_roll_call" && cue.ballot.voterId === ballot.fromPlayerId)?.spokenMessage).toBe(ballot.text);
  expect(cues.some(cue => cue.source === "classic")).toBe(false);
});


test("post-chain Mingle stays between the final handoff and the sealed vote in playback", () => {
  const mingle: TranscriptEntry = {...deliveries[0]!, id:1000, entrySequence:1000, firstDurableEventSequence:36, phase:"FORMAT_MINGLE", text:"I need your vote now that the pools are set.", decisionSpeech:undefined};
  const scenes = buildStoryScenes([mingle]);
  const merged = mergeFormatAndSocialCues(compile().cues, buildClassicPresentationCues(scenes, [], players), scenes);
  const cues = composeInfluencePresentation("g", merged, players, scenes, 2);
  const social = cues.findIndex(cue => cue.source === "classic");
  expect(social).toBeGreaterThan(cues.findLastIndex(cue => cue.kind === "safety_bounce_pointer"));
  expect(social).toBeLessThan(cues.findIndex(cue => cue.kind === "format_roll_call"));
});
