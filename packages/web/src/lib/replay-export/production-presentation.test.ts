import {expect,test} from "bun:test";
import {Phase} from "@influence/engine";
import type {AcceptedVisualScene} from "@influence/engine/visual-mode";
import {completedCurrentWerewolfFixture,completedWerewolfResultsFixture,werewolfResultsFixture} from "@influence/engine/fixtures/werewolf-results";
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
import {compilePresentation, thinkingPicture} from "./presentation";
import {parseTimingProfile} from "./timing";
import {werewolfBackdrop} from "../../components/games/werewolf/werewolf-room-presentation";
import {WEREWOLF_ROOMS} from "../../components/games/werewolf/werewolf-rooms";

async function fixture(audience:"mystery"|"omniscient", current = false) {
  const events = current ? await completedCurrentWerewolfFixture("production-binding") : await completedWerewolfResultsFixture("saved", "production-binding");
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
    const thinking = "thinking" in decision ? decision.thinking : current && decision.kind === "conversation" ? "I weighed whether to speak." : null;
    return thinking ? [{eventSequence:event.sequence,cursor,day,
      actorId:event.payload.actorId,action:event.payload.action,thinking}] : [];
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
test("Studio voting thoughts keep the ballot backdrop through their close-up", async () => {
  const input = await fixture("omniscient", true);
  const moments = await bindWerewolfProductionPresentation(input);
  const votingThoughts = input.thoughts.filter(thought => thought.action === "public_vote");
  const villageScene: AcceptedVisualScene = {id:"accepted-village",roomId:"lobby",version:1,imageUrl:"/accepted-village.png",annotatedImageUrl:"/accepted-village-annotated.png",participantIds:[],anchors:[]};
  expect(votingThoughts.length).toBeGreaterThan(0);
  for (const thought of votingThoughts) {
    const moment = input.catalog.moments.find(moment => moment.source.kind === "werewolf-action" && moment.source.eventSequence === thought.eventSequence);
    const closeUp = moments.find(row => row.id === moment?.id)?.segments[0];
    const ballot = input.base.find(cue => cue.source.kind === "werewolf" && cue.source.cursor === thought.cursor
      && cue.picture.kind === "werewolf" && cue.picture.cue.ballot?.current.voterId === thought.actorId);
    if (closeUp?.picture.kind !== "thinking" || ballot?.picture.kind !== "werewolf") throw new Error("Voting fixture must bind both thought and ballot shots");
    expect(closeUp.picture.backgroundUrl).toBe(WEREWOLF_ROOMS.vote);
    expect(closeUp.picture.backgroundUrl).toBe(werewolfBackdrop(ballot.picture.cue));
    const withGeneratedVillage = thinkingPicture({...ballot,picture:{...ballot.picture,scene:villageScene}}, thought.actorId);
    expect(withGeneratedVillage.scene).toBeNull();
    expect(withGeneratedVillage.backgroundUrl).toBe(WEREWOLF_ROOMS.vote);
  }
  const conversation = input.base.find(cue => cue.picture.kind === "werewolf" && cue.picture.cue.moment.entry.kind === "conversation");
  if (conversation?.picture.kind !== "werewolf") throw new Error("Fixture must retain ordinary village conversation");
  expect(werewolfBackdrop(conversation.picture.cue)).toBe(WEREWOLF_ROOMS.village);
  expect(thinkingPicture({...conversation,picture:{...conversation.picture,scene:villageScene}},conversation.speech!.speakerId!).scene).toBe(villageScene);
});
test("a frozen pre-audio cut binds its original catalog without new House speech or closing reprise", async () => {
  const input=await fixture("omniscient",true);
  const catalog={...assembleProductionCatalog({gameId:input.catalog.gameId,gameKind:"werewolf",audience:"omniscient",werewolfCatalogVersion:1,
    sources:buildWerewolfProductionSources({gameId:input.catalog.gameId,audience:"omniscient",moments:input.source.windows.flatMap(window=>window.moments),
      provenance:input.provenance,thoughts:input.thoughts,opening:true,legacyPassThoughts:true})}),werewolfCatalogVersion:1 as const,werewolfLegacyPassThoughts:true as const};
  const frozenIds=catalog.moments.filter(moment=>moment.defaultIncluded && moment.kind!=="thinking").map(moment=>moment.id);
  const historical=await bindWerewolfProductionPresentation({...input,catalog});
  const before=compilePresentation({...settings,source:historical,selectedIds:frozenIds});
  expect(before.cues.some(cue=>cue.speech?.speakerId===null)).toBe(false);
  expect(before.cues.some(cue=>cue.picture.kind==="werewolf" && cue.picture.cue.reprise)).toBe(false);
  expect(catalog.moments.some(moment=>moment.part.kind==="scene")).toBe(false);
  // Discovering/compiling the current contract cannot mutate the frozen cut.
  await bindWerewolfProductionPresentation(input);
  const after=compilePresentation({...settings,source:await bindWerewolfProductionPresentation({...input,catalog}),selectedIds:frozenIds});
  expect(after).toEqual(before);
  expect(after.momentIds).toEqual(frozenIds);
  const historicalPass=catalog.moments.find(moment=>moment.kind==="thinking" && !input.catalog.moments.some(current=>current.id===moment.id));
  expect(historicalPass).toBeDefined();
  const exactOldCut=compilePresentation({...settings,source:historical,selectedIds:[historicalPass!.id]});
  expect(exactOldCut.momentIds).toEqual([historicalPass!.id]);
  expect(exactOldCut.cues[0]!.picture.kind).toBe("thinking");
});
test("v9 Studio binds each spoken public ballot once, retaining speech and private action thoughts", async () => {
  for (const audience of ["mystery", "omniscient"] as const) {
    const input = await fixture(audience, true);
    const moments = await bindWerewolfProductionPresentation(input);
    const ballots = input.catalog.moments.filter(moment => moment.part.kind === "ballot" && moment.part.purpose === "day");
    const entries = input.source.windows.flatMap(window => window.moments).filter(moment => moment.entry.kind === "ballot");
    expect(ballots).toHaveLength(entries.length);
    const cut = compilePresentation({...settings, source:moments, selectedIds:ballots.map(moment => moment.id)});
    expect(cut.cues).toHaveLength(entries.length);
    expect(cut.cues.map(cue => cue.speech?.text ?? null)).toEqual(entries.map(moment => moment.entry.kind === "ballot" ? moment.entry.text : null));
    expect(cut.cues.every(cue => cue.picture.kind === "werewolf" && cue.picture.cue.ballot?.current.voterId === cue.speech?.speakerId)).toBe(true);
    const full = compilePresentation({...settings, source:moments, selectedIds:input.catalog.moments.filter(moment => moment.defaultIncluded && moment.kind !== "thinking").map(moment => moment.id)});
    expect(full.cues.filter(cue => cue.picture.kind === "werewolf" && cue.picture.cue.moment.entry.kind === "ballot")).toHaveLength(entries.length);
    if (audience === "omniscient") {
      expect(input.thoughts.map(thought => thought.action)).toEqual(expect.arrayContaining(["conversation", "public_vote", "pack_propose"]));
      const silentCursors = new Set(input.source.windows.flatMap(window => window.moments)
        .filter(moment => moment.entry.kind === "conversation" && !moment.entry.text)
        .map(moment => moment.cursor));
      expect(silentCursors.size).toBeGreaterThan(0);
      const editableThoughts = input.catalog.moments.filter(moment => moment.kind === "thinking");
      expect(editableThoughts.map(moment => moment.order.anchor)).toEqual(input.thoughts.filter(thought => !silentCursors.has(thought.cursor)).map(thought => thought.cursor));
      expect(editableThoughts.some(moment => silentCursors.has(moment.order.anchor))).toBe(false);
    } else expect(input.catalog.moments.some(moment => moment.kind === "thinking")).toBe(false);
  }
});
test("Werewolf default moment compilation preserves existing full movie coverage",async () => {
  for (const audience of ["mystery","omniscient"] as const) {
    const input = await fixture(audience);
    const moments = await bindWerewolfProductionPresentation(input);
    const selectedIds = input.catalog.moments.filter(moment => moment.defaultIncluded && moment.kind !== "thinking").map(moment => moment.id);
    const compiled = compilePresentation({...settings,source:moments,selectedIds});
    // The playback-only reprise closes the final retrospective without adding narration.
    const coverage = input.base;
    expect(compiled.cues.map(cue => cue.picture)).toEqual(coverage.map(cue => cue.picture));
    expect(compiled.cues.map(cue => cue.timing.baseDurationMs)).toEqual(coverage.map(cue => cue.timing.baseDurationMs));
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
    expect(cut.cues.filter(cue => cue.speech).map(cue => cue.speech?.speakerId)).toEqual(retrospective.map(moment => moment.actorId));
    expect(cut.cues.filter(cue => cue.speech).every(cue => cue.picture.kind === "werewolf" && cue.picture.cue.moment.entry.kind === "speech"
      && cue.picture.cue.moment.entry.purpose === "retrospective")).toBeTrue();
    expect(cut.cues.at(-1)?.timing.kind).toBe("result");
    expect(cut.cues.at(-1)?.speech).toBeNull();
    const full = compilePresentation({...settings,source:moments,selectedIds:input.catalog.moments
      .filter(moment => moment.defaultIncluded && moment.kind !== "thinking").map(moment => moment.id)});
    expect(full.cues.slice(-count-1).map(cue => cue.speech)).toEqual(cut.cues.map(cue => cue.speech));
    expect(full.cues.findIndex(cue => cue.timing.kind === "result")).toBeLessThan(full.cues.length-count);
    const recorded = moments.map(moment => moment.id !== ids[0] ? moment : {...moment,segments:moment.segments.map(cue => cue.speech ? ({...cue,
      timing:{...cue.timing,recording:{assetId:"accepted-voice",durationMs:20_000}}}) : cue)});
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

test("v10 role explanations have separate private Studio moments and match server timing", async () => {
  const events = await completedCurrentWerewolfFixture("v10-export", 10, {playerCount:6,wolves:1,seer:true,doctor:true});
  for (const audience of ["mystery", "omniscient"] as const) {
    const projected = projectWerewolfWatch(events,audience,1,64);
    const window = {...projected, moments: projected.moments.map(({staging: _staging, ...moment}) => {void _staging; return moment;}), slug:"v10-export", status:"completed", audience, publicationCutoff:"2026-10-24T00:00:00Z", media:{}};
    const source = {kind:"werewolf" as const, windows:[window], thoughts:[]};
    const provenance = projectWerewolfProductionProvenance(events,audience);
    const base = buildExportCues(source);
    const catalog = assembleProductionCatalog({gameId:window.gameId, gameKind:"werewolf", audience,
      sources:buildWerewolfProductionSources({gameId:window.gameId,audience,moments:window.moments,provenance,thoughts:[],opening:true})});
    const bound = await bindWerewolfProductionPresentation({source,provenance,catalog,thoughts:[]});
    const speeches = catalog.moments.filter(m => m.part.kind === "night-speech");
    expect(speeches).toHaveLength(audience === "omniscient" ? 2 : 0);
    for (const moment of window.moments) {
      const cues = base.filter(c => c.picture.kind === "werewolf" && c.picture.cue.moment.cursor === moment.cursor && !c.picture.cue.reprise);
      const row = window.playback.find(p => p.cursor === moment.cursor);
      if (row) {
        expect(cues.map(c => c.timing.key)).toEqual(row.keys);
        expect(cues.map(c => c.timing.baseDurationMs)).toEqual(row.durationsMs);
      }
    }
    const spokenSegments = speeches.map(speech => bound.find(m => m.id === speech.id)!.segments[0]!);
    expect(new Set(spokenSegments.map(segment => segment.speech?.messageId)).size).toBe(speeches.length);
    for (const speech of speeches) {
      const segment = bound.find(m => m.id === speech.id)!.segments[0]!;
      expect(segment.speech?.text).toContain("choice tonight");
      expect(segment.speech?.speakerId).toBe(speech.actorId);
    }
  }
});

test("full omniscient cuts retain accepted pack speech and room thinking without leaking into Mystery",async () => {
  const input = await fixture("omniscient",true);
  const bound = await bindWerewolfProductionPresentation(input);
  const proposals = input.source.windows.flatMap(w => w.moments).filter(m => m.entry.kind === "proposal" && !m.entry.unavailable && m.entry.text);
  expect(proposals.length).toBeGreaterThan(0);
  const cut = compilePresentation({...settings,source:bound,selectedIds:input.catalog.moments.filter(m=>m.defaultIncluded).map(m=>m.id)});
  const speech = cut.cues.filter(c=>c.picture.kind === "werewolf" && c.picture.cue.moment.entry.kind === "proposal");
  expect(speech.map(c=>c.speech?.text ?? null)).toEqual(proposals.map(m=>m.entry.kind === "proposal" ? m.entry.text : null));
  for (const cue of cut.cues) if (cue.picture.kind === "thinking" && cue.picture.room?.label?.includes("Pack")) {
    expect(cue.picture.room.backgroundUrl).toContain("pack");
    expect(cue.picture.room.players.every(p=>proposals[0]!.snapshot.players.find(x=>x.id===p.id)?.role === "werewolf")).toBeTrue();
    expect(cue.timing.thinkingEstablishMs).toBe(650);
  }
  expect(cut.cues.some(c=>c.picture.kind === "thinking" && c.picture.room?.label?.includes("Pack"))).toBeTrue();
  const mystery = await fixture("mystery",true);
  const publicCut = await bindWerewolfProductionPresentation(mystery);
  expect(publicCut.some(m=>m.segments.some(c=>c.picture.kind === "werewolf" && c.picture.cue.moment.entry.kind === "proposal"))).toBeFalse();
});

test("Influence Studio returns to the canonical winner only after retrospective completion",async () => {
  const gameId="closing-parity";
  const players=[{id:"a",name:"Ada",persona:"",status:"alive" as const,shielded:false},{id:"b",name:"Bea",persona:"",status:"alive" as const,shielded:false}];
  const event:ViewerDecisionEvent={sequence:1,type:"jury.winner_determined",round:1,phase:Phase.JURY_VOTE,timestamp:"2026-10-25T00:00:00Z",payload:{winnerId:"b",votes:{a:"b"}}};
  const frame:GameWatchReplayFrame={schemaVersion:3,gameId,slug:gameId,sequence:1,eventType:event.type,timestamp:Date.parse(event.timestamp),round:1,phase:Phase.JURY_VOTE,players,counts:{totalPlayers:2,alivePlayers:2,eliminatedPlayers:0,unknownPlayers:0},viewerDecisionEvent:event};
  for (const completed of [false,true]) {
    const frames=[frame,{...frame,sequence:2,eventType:"retrospective.statement_recorded",phase:Phase.RETROSPECTIVE,viewerDecisionEvent:undefined},
      ...(completed ? [{...frame,sequence:3,eventType:"retrospective.completed",phase:Phase.RETROSPECTIVE,viewerDecisionEvent:undefined}] : [])];
    const messages:TranscriptEntry[]=[{id:1,gameId,round:1,phase:"RETROSPECTIVE",scope:"public",fromPlayerId:"a",fromPlayerName:"Ada",toPlayerIds:null,text:"I enjoyed that game.",timestamp:frame.timestamp+2,firstDurableEventSequence:2,retrospectiveSource:{eventSequence:2,ordinal:0}}];
    const source={kind:"influence" as const,game:{id:gameId,slug:gameId,status:"completed" as const,gameKernel:"classic" as const,players},frames,messages,thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[]}};
    const catalog=assembleProductionCatalog({gameId,gameKind:"influence",audience:"public",sources:buildInfluenceProductionSources({gameId,gameKernel:"classic",frames,transcripts:messages})});
    const bound=await bindInfluenceProductionPresentation({source,catalog,thoughts:[]});
    const cut=compilePresentation({...settings,source:bound,selectedIds:catalog.moments.filter(m=>m.defaultIncluded).map(m=>m.id)});
    expect(cut.cues.at(-1)?.timing.kind).toBe(completed ? "result" : "speech");
    if(completed) expect(cut.cues.at(-1)?.picture).toMatchObject({kind:"influence",cue:{source:"endgame",playerId:"b",canonicalSequence:3}});
  }
});
