import { expect, test } from "bun:test";
import { createFormatKernelViewerScenario, FORMAT_KERNEL_VIEWER_SCENARIO_IDS } from "@influence/engine/fixtures/format-kernel-viewer";
import { assembleProductionCatalog, productionMomentKey } from "@influence/engine/production-moments";
import { buildInfluenceProductionSources } from "@influence/engine/production-moments/influence-source";
import { compileFormatPresentationPrefix } from "../../app/games/[slug]/components/format-presentation-model";
import {composeInfluencePresentation, influenceCastArt} from "../../app/games/[slug]/components/influence-presentation";
import {influenceMusic, influenceOpeningAudio, INFLUENCE_MUSIC} from "../../app/games/[slug]/components/influence-music";
import {buildExportCues} from "./cues";
import {bindInfluenceProductionPresentation} from "./production-presentation";
import {compilePresentation} from "./presentation";
import {parseTimingProfile, sampleTiming} from "./timing";
import {audioGain} from "./audio";
import type {ReplaySource} from "./source";
import { buildStoryScenes } from "../../app/games/[slug]/components/house-story";
import { buildClassicPresentationCues, comparePresentationCues } from "../../app/games/[slug]/components/influence-replay-cues";
import { buildEndgamePresentationCues, compileRevealedWinnerCues } from "../../app/games/[slug]/components/endgame-presentation";
import type { PresentationCue, ReplayScene } from "../../app/games/[slug]/components/types";
import type { GameWatchReplayFrame, TranscriptEntry, ViewerDecisionEvent } from "../api";
import { Phase } from "@influence/engine";
import { influenceProductionReference } from "./influence-production-reference";

function referenceKeys(cues: readonly PresentationCue[], scenes: readonly ReplayScene[] = []): string[] {
  const byKey = new Map(cues.map(cue => [cue.key, cue]));
  return [...new Set(cues.map(cue => {
    const ref = influenceProductionReference(cue, key => byKey.get(key), current => current.source === "classic"
      ? scenes[current.sceneIndex]?.messages[current.messageIndex] : undefined);
    return productionMomentKey("g", ref.source, ref.part);
  }))];
}

test("production inventory preserves classic history, endgame ballots and both jury tally groups", async () => {
  const players = ["a", "b", "c"].map(id => ({ id, name: id.toUpperCase(), persona: "", status: "alive" as const, shielded: false, currentAgent: null }));
  const events: ViewerDecisionEvent[] = [
    { sequence: 1, timestamp: "2026-10-09T00:00:01Z", round: 1, phase: Phase.VOTE, type: "endgame.elimination_resolved", payload: { stage: "reckoning", votes: { a: "c", b: "c" }, juryTiebreakerVotes: { c: "b" }, eliminatedId: "b" } },
    { sequence: 2, timestamp: "2026-10-09T00:00:02Z", round: 1, phase: Phase.VOTE, type: "player.eliminated", payload: { playerId: "b", playerName: "B" } },
    { sequence: 3, timestamp: "2026-10-09T00:00:03Z", round: 2, phase: Phase.JURY_VOTE, type: "jury.winner_determined", payload: { votes: { b: "a" }, winnerId: "a" } },
  ];
  const frames: GameWatchReplayFrame[] = events.map(event => ({ schemaVersion: 3, gameId: "g", slug: "g", sequence: event.sequence, eventType: event.type, timestamp: Date.parse(event.timestamp), round: event.round, phase: event.phase ?? "INIT", players,
    counts: { totalPlayers: 3, alivePlayers: 3, eliminatedPlayers: 0, unknownPlayers: 0 }, viewerDecisionEvent: event }));
  const messages: TranscriptEntry[] = [
    { id: 10, gameId: "g", round: 1, phase: "INTRODUCTION", scope: "public", fromPlayerId: "a", fromPlayerName: "A", toPlayerIds: null, text: "Legacy narration contains words about a vote, with no canonical ballot provenance.", timestamp: Date.parse("2026-10-09T00:00:00Z") },
    { id: 11, gameId: "g", round: 2, phase: "JURY_VOTE", scope: "system", fromPlayerId: null, fromPlayerName: null, toPlayerIds: null, dialogueKind: "house_summary", firstDurableEventSequence: 3, text: "The game has ended.", timestamp: Date.parse("2026-10-09T00:00:04Z") },
  ];
  const scenes = buildStoryScenes(messages);
  const cues = composeInfluencePresentation("g", [...buildClassicPresentationCues(scenes, frames, players), ...buildEndgamePresentationCues(frames)].sort(comparePresentationCues), players, scenes);
  const sources = buildInfluenceProductionSources({ gameId: "g", gameKernel: "classic", transcripts: messages, frames });
  const catalog = assembleProductionCatalog({ gameId: "g", gameKind: "influence", audience: "public", sources });
  expect(catalog.moments.map(m => m.id)).toEqual(referenceKeys(cues, scenes));
  expect(catalog.moments.filter(m => m.kind === "tally")).toHaveLength(3);
  expect(catalog.moments[0]!.part.kind).toBe("opening");
  expect(catalog.moments[1]!.part.kind).toBe("speech");
  const source: Extract<ReplaySource,{kind:"influence"}> = {kind:"influence",game:{id:"g",slug:"g",status:"completed",gameKernel:"classic",players},
    messages,frames,thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[]}};
  const exported = buildExportCues(source);
  expect(exported.map(c=>"cue" in c.picture ? c.picture.cue : null)).toEqual(cues);
  const winners = compileRevealedWinnerCues(cues);
  expect(exported.map(c=>c.music)).toEqual(cues.map((cue,index)=>influenceMusic("g",winners[index]??cue,
    cue.source === "classic" ? scenes[cue.sceneIndex]?.messages[cue.messageIndex] : null)));
  expect(new Set(exported.flatMap(c=>c.music ? [c.music.title] : []))).toEqual(new Set(["Good Company","Names on the Table","The Empty Chair","The Last Word"]));
  expect(exported.at(-1)!.timing.kind).toBe("result");
  const bound = await bindInfluenceProductionPresentation({source,catalog,thoughts:[]});
  expect(bound.flatMap(m=>m.segments).map(c=>({picture:c.picture,music:c.music}))).toEqual(exported.map(c=>({picture:c.picture,music:c.music})));
});

for (const scenarioId of FORMAT_KERNEL_VIEWER_SCENARIO_IDS.filter(id => !id.startsWith("malformed_"))) {
  test(`player, Studio and export share opening, cast, timings and music: ${scenarioId}`, async () => {
    const scenario = createFormatKernelViewerScenario(scenarioId);
    const players = scenario.roster.map(player => ({ ...player, persona: "", status: "alive" as const, shielded: false }));
    const compilation = compileFormatPresentationPrefix({ gameId: "g", gameKernel: "format", roster: players, decisions: scenario.decisions });
    expect(compilation.diagnostic).toBeNull();
    const cues = composeInfluencePresentation("g", compilation.cues, players, []);
    const frames = scenario.decisions.map(event => ({ sequence: event.sequence, timestamp: Date.parse(event.timestamp), round: event.round, phase: event.phase ?? "INIT" as const, players, viewerDecisionEvent: event }));
    const sources = buildInfluenceProductionSources({ gameId: "g", gameKernel: "format", transcripts: [], frames });
    const catalog = assembleProductionCatalog({ gameId: "g", gameKind: "influence", audience: "public", sources });
    const expected = referenceKeys(cues);
    expect(catalog.moments.map(m => m.id)).toEqual(expected);
    const source: Extract<ReplaySource,{kind:"influence"}> = {
      kind:"influence", game:{id:"g",slug:"g",status:"completed",gameKernel:"format",players}, messages:[], thoughts:{},
      frames:frames.map(frame => ({...frame,schemaVersion:3,gameId:"g",slug:"g",eventType:frame.viewerDecisionEvent.type,
        counts:{totalPlayers:players.length,alivePlayers:players.length,eliminatedPlayers:0,unknownPlayers:0}})),
      visual:{enabled:false,status:null,portraits:{},fullBodies:{[players[0]!.id]:"/full-body.png"},scenes:[]},
    };
    const exported = buildExportCues(source);
    expect(exported.map(c => "cue" in c.picture ? c.picture.cue : null)).toEqual(cues);
    expect(exported.map(c => c.music)).toEqual(cues.map(c => influenceMusic("g",c)));
    const bound = await bindInfluenceProductionPresentation({source,catalog,thoughts:[]});
    const assets = Object.fromEntries(Object.values(INFLUENCE_MUSIC).map(track => [track.src,{path:track.src,sha256:"fixture",mediaType:"audio" as const,durationMs:240_000}]));
    const settings = {source:bound,profile:parseTimingProfile({motionScale:.5}),fps:30,assets,music:true,volume:.4};
    const studio = compilePresentation({...settings,selectedIds:catalog.moments.map(m=>m.id)});
    expect(bound.flatMap(m=>m.segments).map(({momentId,...cue})=>{void momentId; return cue;})).toEqual(exported);
    expect(studio.cues.map(c=>({picture:c.picture,music:c.music,duration:c.timing.baseDurationMs}))).toEqual(exported.map(c=>({picture:c.picture,music:c.music,duration:c.timing.baseDurationMs})));
    const opening = studio.cues.filter(c=>c.picture.kind === "influence-opening");
    expect(opening).toHaveLength(players.length+3);
    expect(opening[2]!.picture).toMatchObject({kind:"influence-opening",...influenceCastArt(players[0],source.visual)});
    expect(studio.timeline[2]!.startMs).toBe(20_000);
    const score = studio.audio.clips.find(c=>c.asset===INFLUENCE_MUSIC.opening.src)!;
    expect(score).toBeDefined();
    for (const [index,cue] of opening.entries()) {
      if (cue.picture.kind !== "influence-opening") throw new Error("Opening expected");
      const time = studio.timeline[index]!;
      for (const local of [0,Math.min(500,cue.timing.baseDurationMs),cue.timing.baseDurationMs-1]) {
        expect(sampleTiming(time,time.startMs+local).elapsedMs).toBeCloseTo(local);
        expect(audioGain(score,time.startMs+local,studio.audio.clips)).toBeCloseTo(influenceOpeningAudio(cue.picture.cue,local)[0]!.gain*.4);
      }
    }
    const openingId = catalog.moments[0]!.id;
    const introOnly = compilePresentation({...settings,selectedIds:[openingId]});
    expect(introOnly.cues).toHaveLength(players.length+3);
    expect(introOnly.audio.clips).toHaveLength(1);
    const noIntro = compilePresentation({...settings,selectedIds:catalog.moments.slice(1).map(m=>m.id)});
    expect(noIntro.cues.some(c=>c.source.kind==="opening")).toBe(false);
    expect(noIntro.audio.clips.some(c=>c.asset===INFLUENCE_MUSIC.opening.src)).toBe(false);
    expect(compilePresentation({...settings,selectedIds:[openingId],music:false}).audio.clips).toEqual([]);
  });
}

test.each([3, 4] as const)("Safety Bounce production snapshot v%s retains its own speech identities", async projectionVersion => {
  const fixture = createFormatKernelViewerScenario("safety_bounce_tie");
  const players = fixture.roster.map(player => ({...player, persona:"",status:"alive" as const,shielded:false}));
  const frames: GameWatchReplayFrame[] = fixture.decisions.map(event => ({schemaVersion:3,gameId:"g",slug:"g",sequence:event.sequence,eventType:event.type,timestamp:Date.parse(event.timestamp),round:event.round,phase:event.phase ?? "INIT",players,viewerDecisionEvent:event,counts:{totalPlayers:4,alivePlayers:4,eliminatedPlayers:0,unknownPlayers:0}}));
  const messages: TranscriptEntry[] = fixture.decisions.flatMap((event,index) => {
    const actorId = event.type === "format.safety_bounce_pointer" ? event.payload.actorId : event.type === "format.resolved" ? event.payload.tiebreakerId : null;
    if (!actorId) return [];
    return [{id:index+1,entrySequence:index+1,firstDurableEventSequence:event.sequence,gameId:"g",round:event.round,phase:event.phase ?? "INIT",scope:"public",fromPlayerId:actorId,fromPlayerName:actorId,toPlayerIds:null,text:`Accepted public reason ${index}.`,thinking:`Accepted private thinking ${index}.`,timestamp:Date.parse(event.timestamp),decisionSpeech:{actorId,action:event.type === "format.safety_bounce_pointer" ? "bounce-pointer" : "format-tiebreak"}}];
  });
  const source: Extract<ReplaySource,{kind:"influence"}> = {kind:"influence",projectionVersion,game:{id:"g",slug:"g",status:"completed",gameKernel:"format",players},messages,frames,thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[]}};
  const sources = buildInfluenceProductionSources({gameId:"g",gameKernel:"format",transcripts:messages,frames,attachDecisionSpeech:projectionVersion !== 3});
  const catalog = assembleProductionCatalog({gameId:"g",gameKind:"influence",audience:"public",sources});
  const bound = await bindInfluenceProductionPresentation({source,catalog,thoughts:[]});
  expect(bound.length).toBeGreaterThan(0);
  const cues = buildExportCues(source);
  for (const message of messages) expect(cues.filter(cue => cue.speech?.text === message.text)).toHaveLength(1);
  expect(catalog.moments.filter(moment => moment.source.kind === "influence-transcript" && moment.kind !== "thinking")).toHaveLength(projectionVersion === 3 ? messages.length : 0);
});


for (const overrideHolderId of ["atlas", "rex"]) for (const projectionVersion of [3,4,5] as const) test(`Two Names snapshot v${projectionVersion} preserves speech ownership with override holder ${overrideHolderId}`, async () => {
  const {twoNamesDecisionSpeechAction} = await import("@influence/engine/influence-decision-speech");
  const fixture = createFormatKernelViewerScenario("two_names_used_tie");
  for (const event of fixture.decisions) {
    if ("overrideHolderId" in event.payload) event.payload.overrideHolderId = overrideHolderId;
    if (event.type === "format.resolved" && event.payload.aggregate?.capability === "two_names") event.payload.aggregate.overrideHolderId = overrideHolderId;
  }
  const players = fixture.roster.map(player => ({...player,persona:"",status:"alive" as const,shielded:false}));
  const frames: GameWatchReplayFrame[] = fixture.decisions.map(event => ({schemaVersion:3,gameId:"g",slug:"g",sequence:event.sequence,eventType:event.type,timestamp:Date.parse(event.timestamp),round:event.round,phase:event.phase ?? "INIT",players,viewerDecisionEvent:event,counts:{totalPlayers:5,alivePlayers:5,eliminatedPlayers:0,unknownPlayers:0}}));
  const messages: TranscriptEntry[] = fixture.decisions.flatMap((event,index) => {
    const action = twoNamesDecisionSpeechAction(event.type);
    const actorId = "empoweredId" in event.payload ? event.payload.empoweredId : "overrideHolderId" in event.payload ? event.payload.overrideHolderId : null;
    return action && actorId ? [{id:index+1,entrySequence:100+index,firstDurableEventSequence:event.sequence,gameId:"g",round:event.round,phase:event.phase ?? "INIT",scope:"public",fromPlayerId:actorId,fromPlayerName:actorId,toPlayerIds:null,text:`Public decision ${index}.`,thinking:`Private thought ${index}.`,timestamp:Date.parse(event.timestamp),decisionSpeech:{actorId,action}}] : [];
  });
  const source: Extract<ReplaySource,{kind:"influence"}> = {kind:"influence",projectionVersion,game:{id:"g",slug:"g",status:"completed",gameKernel:"format",players},messages,frames,thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[]}};
  const sources = buildInfluenceProductionSources({gameId:"g",gameKernel:"format",transcripts:messages,frames,attachDecisionSpeech:projectionVersion !== 3,attachTwoNamesSpeech:projectionVersion >= 5});
  const catalog = assembleProductionCatalog({gameId:"g",gameKind:"influence",audience:"public",sources});
  const bound = await bindInfluenceProductionPresentation({source,catalog,thoughts:[]});
  expect(bound.length).toBeGreaterThan(0);
  const cues = buildExportCues(source);
  for (const message of messages) expect(cues.filter(cue => cue.speech?.text === message.text)).toHaveLength(1);
  expect(catalog.moments.filter(moment => moment.kind === "thinking")).toHaveLength(messages.length);
  expect(catalog.moments.filter(moment => moment.source.kind === "influence-transcript" && moment.kind !== "thinking")).toHaveLength(projectionVersion < 5 ? messages.length : 0);
});
