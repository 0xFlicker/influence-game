import {expect,test} from "bun:test";
import {Phase} from "@influence/engine";
import {completedWerewolfResultsFixture,werewolfResultsFixture} from "@influence/engine/fixtures/werewolf-results";
import {projectWerewolfWatch,projectWerewolfProductionProvenance} from "@influence/engine/werewolf/watch";
import {werewolfThinkingActions} from "@influence/engine/werewolf/thinking";
import type {WerewolfEvent} from "@influence/engine/werewolf/types";
import {assembleProductionCatalog} from "@influence/engine/production-moments";
import {buildWerewolfProductionSources} from "@influence/engine/production-moments/werewolf-source";
import {bindInfluenceProductionPresentation,bindWerewolfProductionPresentation} from "./production-presentation";
import {buildInfluenceProductionSources} from "@influence/engine/production-moments/influence-source";
import {createFormatKernelViewerScenario,FORMAT_KERNEL_VIEWER_SCENARIO_IDS} from "@influence/engine/fixtures/format-kernel-viewer";
import type {GameWatchReplayFrame,TranscriptEntry,ViewerDecisionEvent} from "../api";
import {buildExportCues} from "./cues";
import {compilePresentation} from "./presentation";
import {parseTimingProfile} from "./timing";

async function fixture(audience:"mystery"|"omniscient") {
  const events = await completedWerewolfResultsFixture("saved", "production-binding");
  const windows = [];
  let next = 1;
  do {
    const projected = projectWerewolfWatch(events,audience,next,64);
    const window = {...projected,slug:"production-binding",status:"completed" as const,audience,
      publicationCutoff:"2026-10-09T00:00:00.000Z",media:{},
      moments:projected.moments.map(({staging:_staging,...moment}) => {void _staging;return moment;})};
    windows.push(window); next = window.throughCursor+1;
  } while(next <= windows[0]!.latestCursor);
  const thoughts = audience === "mystery" ? [] : werewolfThinkingActions(events,windows[0]!.latestCursor).flatMap(({event,cursor,day}) => {
    const decision = event.payload.decision;
    return decision.kind === "target" && decision.thinking ? [{eventSequence:event.sequence,cursor,day,
      actorId:event.payload.actorId,action:event.payload.action,thinking:decision.thinking}] : [];
  });
  const source = {kind:"werewolf" as const,windows,thoughts:[]};
  const provenance = projectWerewolfProductionProvenance(events,audience);
  const base = buildExportCues(source);
  const catalog = assembleProductionCatalog({gameId:windows[0]!.gameId,gameKind:"werewolf",audience,
    sources:buildWerewolfProductionSources({gameId:windows[0]!.gameId,audience,
      moments:windows.flatMap(window => window.moments),provenance,thoughts,
      opening:base.some(cue => cue.picture.kind === "werewolf-opening")})});
  return {source,provenance,thoughts,catalog,base};
}
const settings = {profile:parseTimingProfile({ending:{holdMs:0}}),fps:30,assets:{},music:false};
test("Werewolf default moment compilation preserves existing full movie coverage",async () => {
  for (const audience of ["mystery","omniscient"] as const) {
    const input = await fixture(audience);
    const moments = await bindWerewolfProductionPresentation(input);
    const selectedIds = input.catalog.moments.filter(moment => moment.defaultIncluded && moment.kind !== "thinking").map(moment => moment.id);
    const compiled = compilePresentation({...settings,source:moments,selectedIds});
    expect(compiled.cues.map(cue => cue.picture)).toEqual(input.base.map(cue => cue.picture));
    expect(compiled.cues.map(cue => cue.timing.baseDurationMs)).toEqual(input.base.map(cue => cue.timing.baseDurationMs));
  }
});
test("Werewolf full and retrospective-only cuts retain exact speeches, source order and recording timing",async () => {
  for (const audience of ["mystery","omniscient"] as const) {
    const input = await fixture(audience), moments = await bindWerewolfProductionPresentation(input);
    const retrospective = input.catalog.moments.filter(moment => moment.purpose === "retrospective");
    const count = input.source.windows[0]!.moments.at(-1)!.snapshot.players.length;
    expect(retrospective).toHaveLength(count);
    const ids = retrospective.map(moment => moment.id);
    const cut = compilePresentation({...settings,source:moments,selectedIds:ids});
    expect(cut.momentIds).toEqual(ids);
    expect(cut.cues.map(cue => cue.speech?.speakerId)).toEqual(retrospective.map(moment => moment.actorId));
    expect(cut.cues.every(cue => cue.picture.kind === "werewolf" && cue.picture.cue.moment.entry.kind === "speech"
      && cue.picture.cue.moment.entry.purpose === "retrospective")).toBeTrue();
    expect(cut.cues.some(cue => cue.timing.kind === "result")).toBeFalse();
    const full = compilePresentation({...settings,source:moments,selectedIds:input.catalog.moments
      .filter(moment => moment.defaultIncluded && moment.kind !== "thinking").map(moment => moment.id)});
    expect(full.cues.slice(-count).map(cue => cue.speech)).toEqual(cut.cues.map(cue => cue.speech));
    expect(full.cues.findIndex(cue => cue.timing.kind === "result")).toBeLessThan(full.cues.length-count);
    const recorded = moments.map(moment => moment.id !== ids[0] ? moment : {...moment,segments:moment.segments.map(cue => ({...cue,
      timing:{...cue.timing,recording:{assetId:"accepted-voice",durationMs:20_000}}}))});
    const withVoice = compilePresentation({...settings,source:recorded,selectedIds:ids});
    expect(withVoice.timeline[0]!.endMs).toBeGreaterThanOrEqual(20_000);
    expect(withVoice.cues[0]!.speech).toEqual(cut.cues[0]!.speech);
    // Later source discovery cannot expand the explicit reviewed IDs.
    const later = compilePresentation({...settings,source:[...moments,{id:"later",segments:[cut.cues[0]!]}],selectedIds:ids});
    expect(later).toEqual(cut);
  }
});
for (const kernel of ["classic","format"] as const) {
  test(`${kernel} Influence exports the same exact epilogue in full and speech-only cuts`,async () => {
    const gameId = `retro-export-${kernel}`;
    const players = ["a","b"].map(id => ({id,name:id.toUpperCase(),persona:"",status:"alive" as const,shielded:false}));
    const winner:ViewerDecisionEvent = {sequence:1,timestamp:"2026-10-10T00:00:00Z",round:1,phase:Phase.JURY_VOTE,type:"jury.winner_determined",payload:{winnerId:"b",votes:{a:"b"}}};
    const frames:GameWatchReplayFrame[] = [winner,...players.map((_,index) => ({...winner,sequence:index+2,phase:Phase.RETROSPECTIVE,type:"retrospective.statement_recorded" as const}))]
      .map(event => ({schemaVersion:3,gameId,slug:gameId,sequence:event.sequence,eventType:event.type,timestamp:Date.parse(event.timestamp)+event.sequence,
        round:1,phase:event.phase!,players,counts:{totalPlayers:2,alivePlayers:2,eliminatedPlayers:0,unknownPlayers:0},
        ...(event.sequence === 1 && {viewerDecisionEvent:winner})}));
    const messages:TranscriptEntry[] = players.map((player,ordinal) => ({id:ordinal+1,gameId,round:1,phase:"RETROSPECTIVE",scope:"public",
      fromPlayerId:player.id,fromPlayerName:player.name,toPlayerIds:null,text:`${player.name}'s exact final statement.`,timestamp:Date.parse(winner.timestamp)+ordinal+2,
      entrySequence:ordinal+1,firstDurableEventSequence:ordinal+2,dialogueKind:"public_speech",retrospectiveSource:{eventSequence:ordinal+2,ordinal}}));
    const source = {kind:"influence" as const,game:{id:gameId,slug:gameId,status:"completed" as const,players,gameKernel:kernel},messages,frames,thoughts:{},
      visual:{enabled:false,status:null,portraits:{},scenes:[],publicationSnapshot:{}}};
    const catalog = assembleProductionCatalog({gameId,gameKind:"influence",audience:"public",sources:buildInfluenceProductionSources({gameId,gameKernel:kernel,transcripts:messages,frames})});
    const bound = await bindInfluenceProductionPresentation({source,catalog,thoughts:[]});
    const ids = catalog.moments.filter(moment => moment.purpose === "retrospective").map(moment => moment.id);
    const cut = compilePresentation({...settings,source:bound,selectedIds:ids});
    expect(cut.cues.map(cue => cue.speech?.text)).toEqual(messages.map(message => message.text));
    expect(cut.cues.every(cue => cue.picture.kind === "influence" && cue.picture.beat?.kind === "portrait" && cue.picture.beat.purpose === "Retrospective")).toBeTrue();
    const full = compilePresentation({...settings,source:bound,selectedIds:catalog.moments.filter(moment => moment.defaultIncluded).map(moment => moment.id)});
    expect(full.cues.slice(-2).map(cue => cue.speech)).toEqual(cut.cues.map(cue => cue.speech));
    expect(full.cues.findIndex(cue => cue.timing.kind === "result")).toBeLessThan(full.cues.length-2);
  });
}
test("individual accepted thoughts sharing a reveal stay independent and contain no speech",async () => {
  const input = await fixture("omniscient");
  const moments = await bindWerewolfProductionPresentation(input);
  const thoughts = input.catalog.moments.filter(moment => moment.kind === "thinking");
  expect(thoughts.length).toBeGreaterThan(1);
  const anchors = thoughts.map(moment => moment.order.anchor);
  expect(new Set(anchors).size).toBeLessThan(anchors.length);
  const cut = compilePresentation({...settings,source:moments,selectedIds:[thoughts[0]!.id]});
  expect(cut.cues).toHaveLength(1);
  expect(cut.cues[0]!.speech).toBeNull();
  expect(cut.cues[0]!.picture.kind).toBe("thinking");
  expect(JSON.stringify(cut)).not.toContain("Hello, village.");
  expect(cut.audio.clips).toEqual([]);
});
test("a silent accepted thought released at a phase boundary remains independently playable",async () => {
  const gameId = "production-silent-thought";
  const original = await werewolfResultsFixture("saved",gameId,1);
  const accepted = original.findLast((event):event is Extract<WerewolfEvent,{type:"werewolf.action_accepted"}> =>
    event.type === "werewolf.action_accepted" && event.payload.action === "introduce")!;
  const events = original.map((event):WerewolfEvent => event === accepted ? {...accepted,
    payload:{...accepted.payload,decision:{kind:"speech",text:null,cue:null}}} : event);
  const projected = projectWerewolfWatch(events,"omniscient",1,64);
  expect(projected.throughCursor).toBe(projected.latestCursor);
  const window = {...projected,slug:gameId,status:"completed" as const,audience:"omniscient" as const,
    publicationCutoff:"2026-10-09T00:00:00.000Z",media:{},
    moments:projected.moments.map(({staging:_staging,...moment}) => {void _staging;return moment;})};
  const released = werewolfThinkingActions(events,projected.latestCursor).find(action => action.event.sequence === accepted.sequence)!;
  expect(window.moments.find(moment => moment.cursor === released.cursor)?.entry.kind).toBe("phase");
  const thoughts = [{eventSequence:accepted.sequence,cursor:released.cursor,day:released.day,
    actorId:accepted.payload.actorId,action:accepted.payload.action,thinking:"I decided to pass."}];
  const source = {kind:"werewolf" as const,windows:[window],thoughts:[]};
  const provenance = projectWerewolfProductionProvenance(events,"omniscient");
  const catalog = assembleProductionCatalog({gameId,gameKind:"werewolf",audience:"omniscient",
    sources:buildWerewolfProductionSources({gameId,audience:"omniscient",moments:window.moments,provenance,thoughts,opening:true})});
  const moments = await bindWerewolfProductionPresentation({source,catalog,provenance,thoughts});
  const thought = catalog.moments.find(moment => moment.kind === "thinking")!;
  expect(thought.source).toEqual({kind:"werewolf-action",eventSequence:accepted.sequence});
  expect(thought.defaultIncluded).toBe(false);
  const cut = compilePresentation({...settings,source:moments,selectedIds:[thought.id]});
  const picture = cut.cues[0]!.picture;
  if (picture.kind !== "thinking") throw new Error("Independent thinking picture expected");
  expect(picture.actor.id).toBe(accepted.payload.actorId);
  expect(cut.cues[0]!.speech).toBeNull();
  expect(JSON.stringify(cut)).not.toContain("Hello, village.");
  expect(cut.audio.clips).toEqual([]);
  const full = compilePresentation({...settings,source:moments,selectedIds:catalog.moments
    .filter(moment => moment.defaultIncluded && moment.kind !== "thinking").map(moment => moment.id)});
  expect(JSON.stringify(full)).not.toContain("I decided to pass.");
});
test("new pack ballot moments are selectable without expanding default exports",async () => {
  const input = await fixture("omniscient");
  const moments = await bindWerewolfProductionPresentation(input);
  const ballot = input.catalog.moments.find(moment => moment.part.kind === "ballot" && moment.part.purpose === "pack")!;
  expect(ballot.defaultIncluded).toBe(false);
  const cut = compilePresentation({...settings,source:moments,selectedIds:[ballot.id]});
  const picture = cut.cues[0]!.picture;
  if (picture.kind !== "werewolf") throw new Error("Pack ballot picture expected");
  expect(picture.cue.ballot?.current.voterId).toBe(ballot.actorId!);
  expect(picture.cue.ballot?.complete).not.toBe(true);
});
test("Mystery refuses handcrafted private catalog references and contaminated source rows",async () => {
  const input = await fixture("mystery");
  const privateCatalog = (await fixture("omniscient")).catalog;
  const privateMoment = privateCatalog.moments.find(moment => moment.kind === "thinking")!;
  await expect(bindWerewolfProductionPresentation({...input,catalog:{...input.catalog,moments:[privateMoment]}})).rejects.toThrow("Unavailable production moment");
  const first = input.source.windows[0]!;
  const contaminated = {...input.source,windows:[{...first,moments:first.moments.map((moment,index) => index ? moment : {...moment,staging:{}})}]};
  await expect(bindWerewolfProductionPresentation({...input,source:contaminated})).rejects.toThrow("private internal");
});
test.each(["majority_elimination_tie", "even_votes_tie", "safety_bounce_tie", "two_names_used_tie"] as const)("%s compiles tie-break thinking immediately before the deciding scene", async id => {
  const scenario = createFormatKernelViewerScenario(id);
  const players = scenario.roster.map(player => ({...player,persona:"",status:"alive" as const,shielded:false}));
  const frames: GameWatchReplayFrame[] = scenario.decisions.map(event => ({schemaVersion:3,gameId:"g",slug:"g",sequence:event.sequence,eventType:event.type,timestamp:Date.parse(event.timestamp),round:event.round,phase:event.phase ?? "INIT",players,
    counts:{totalPlayers:players.length,alivePlayers:players.length,eliminatedPlayers:0,unknownPlayers:0},viewerDecisionEvent:event}));
  const resolution = scenario.decisions.find(event => event.type === "format.resolved")!;
  if (resolution.type !== "format.resolved" || !resolution.payload.tiebreakerId) throw new Error("Tie fixture required");
  const thoughts = [{eventSequence:resolution.sequence,actorId:resolution.payload.tiebreakerId,thinking:"My deciding choice",defaultThinking:true}];
  const source = {kind:"influence" as const,game:{id:"g",slug:"g",status:"completed" as const,players,gameKernel:"format" as const},messages:[],frames,thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[],publicationSnapshot:{}}};
  const catalog = assembleProductionCatalog({gameId:"g",gameKind:"influence",audience:"public",sources:buildInfluenceProductionSources({gameId:"g",gameKernel:"format",transcripts:[],frames,thoughts})});
  const bound = await bindInfluenceProductionPresentation({source,catalog,thoughts});
  const compiled = compilePresentation({...settings,source:bound,selectedIds:catalog.moments.map(moment => moment.id)});
  const position = compiled.cues.findIndex(cue => cue.picture.kind === "thinking");
  expect(position).toBeGreaterThan(0);
  expect(compiled.cues[position]!.picture).toMatchObject({kind:"thinking",actor:{id:resolution.payload.tiebreakerId}});
  expect(compiled.cues[position]!.timing.thinking).toBe(thoughts[0]!.thinking);
  expect(compiled.cues[position - 1]!.picture).toMatchObject({kind:"influence",cue:{kind:"format_aggregate"}});
  expect(compiled.cues[position + 1]!.picture).toMatchObject({kind:"influence",cue:{kind:"format_tiebreak"},beat:{kind:"nominee-selection",selectedId:null}});
  expect(compiled.cues[position + 2]!.picture).toMatchObject({kind:"influence",cue:{kind:"format_deciding_vote"},beat:{selectedId:resolution.payload.eliminatedId}});
  expect(compiled.timeline[position]!.endMs).toBe(compiled.timeline[position + 1]!.startMs);
});

for (const id of FORMAT_KERNEL_VIEWER_SCENARIO_IDS.filter(id => !id.startsWith("malformed_"))) {
  test(`Influence semantic binding preserves default pictures: ${id}`,async () => {
    const scenario = createFormatKernelViewerScenario(id);
    const players = scenario.roster.map(player => ({...player,persona:"",status:"alive" as const,shielded:false}));
    const frames:GameWatchReplayFrame[] = scenario.decisions.map(event => ({schemaVersion:3,gameId:"g",slug:"g",sequence:event.sequence,eventType:event.type,timestamp:Date.parse(event.timestamp),round:event.round,phase:event.phase ?? "INIT",players,
      counts:{totalPlayers:players.length,alivePlayers:players.length,eliminatedPlayers:0,unknownPlayers:0},viewerDecisionEvent:event}));
    const source = {kind:"influence" as const,game:{id:"g",slug:"g",status:"completed" as const,players,gameKernel:"format" as const},messages:[],frames,thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[],publicationSnapshot:{}}};
    const catalog = assembleProductionCatalog({gameId:"g",gameKind:"influence",audience:"public",sources:buildInfluenceProductionSources({gameId:"g",gameKernel:"format",transcripts:[],frames})});
    const canonical = buildExportCues(source);
    for (const roster of [players,[...players].reverse(),[...players.slice(1),players[0]!]]) {
      const reordered = {...source,game:{...source.game,players:roster}};
      const moments = await bindInfluenceProductionPresentation({source:reordered,catalog,thoughts:[]});
      const base = buildExportCues(reordered);
      const compiled = compilePresentation({...settings,source:moments,selectedIds:catalog.moments.map(moment => moment.id)});
      expect(moments.map(moment=>moment.id)).toEqual(catalog.moments.map(moment=>moment.id));
      expect(compiled.cues.map(cue => cue.picture)).toEqual(base.map(cue => cue.picture));
      expect(compiled.cues.map(cue => cue.timing.baseDurationMs)).toEqual(base.map(cue => cue.timing.baseDurationMs));
      expect(base.map(cue=>cue.picture.kind==="influence" ? cue.picture.cue : null)).toEqual(canonical.map(cue=>cue.picture.kind==="influence" ? cue.picture.cue : null));
    }
  });
}
