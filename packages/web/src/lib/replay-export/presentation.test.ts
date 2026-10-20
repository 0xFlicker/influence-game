import {expect,test} from "bun:test";
import {werewolfResultsFixture} from "@influence/engine/fixtures/werewolf-results";
import {projectWerewolfWatch} from "@influence/engine/werewolf/watch";
import {buildExportCues,type ExportCue} from "./cues";
import {compilePresentation,thinkingSegment,thinkingPicture,retainPresentationAnchor} from "./presentation";
import {compileTiming,parseTimingProfile,sampleTiming} from "./timing";
import {votePresentationTiming} from "../../app/games/[slug]/components/vote-presentation-timing";
import type {TranscriptEntry} from "../api";

async function fixture() {
  const events = await werewolfResultsFixture("village","moment-pictures");
  const window = {...projectWerewolfWatch(events,"omniscient",1,64),slug:"moment-pictures",status:"completed" as const,
    audience:"omniscient" as const,publicationCutoff:"2026-10-09T00:00:00.000Z",media:{}};
  const cues = buildExportCues({kind:"werewolf",windows:[window],thoughts:[]});
  const speech = cues.find(cue => cue.speech)!;
  const thought = thinkingSegment(speech,"thought","Only this selected thought.");
  return {speech,thought,cues};
}
const settings = {profile:parseTimingProfile({ending:{holdMs:0}}),fps:30,assets:{},music:false};
test("historical lobby export respects exits and preserves its room label in standalone thinking", () => {
  const players = ["Ada", "Bea"].map((name,index) => ({id:name,name,persona:"",status:index ? "eliminated" as const : "alive" as const,shielded:false}));
  const opening: TranscriptEntry = {id:1,gameId:"g",round:1,phase:"LOBBY",scope:"public",fromPlayerId:"Ada",fromPlayerName:"Ada",
    toPlayerIds:null,text:"First lobby",timestamp:1};
  const exit: TranscriptEntry = {...opening,id:2,scope:"system",phase:"REVEAL",fromPlayerId:null,text:"ELIMINATED: Bea",timestamp:2};
  const later: TranscriptEntry = {...opening,id:3,round:2,text:"Later lobby",timestamp:3};
  const cues = buildExportCues({kind:"influence",game:{id:"g",slug:"g",status:"completed",gameKernel:"classic",players},
    messages:[opening,exit,later],frames:[],visual:{enabled:false,status:null,portraits:{},scenes:[]},thoughts:{}});
  const speeches = cues.filter(cue => cue.speech);
  const before = speeches[0]!, after = speeches[1]!;
  expect(before.picture).toMatchObject({kind:"influence",beat:{kind:"portrait-room",participants:[{id:"Ada"},{id:"Bea"}]}});
  expect(after.picture).toMatchObject({kind:"influence",beat:{kind:"portrait-room",participants:[{id:"Ada"}]}});
  expect(thinkingSegment(after,"thought","We are fewer now.","Ada").picture).toMatchObject({
    kind:"thinking",room:{number:null,label:"Lobby",players:[{id:"Ada"}]},
  });
});
test("thinking framing follows the accepted Influence actor rather than a neighboring portrait",async () => {
  const {speech} = await fixture();
  const players = ["p1","p2"].map(id => ({id,name:id,persona:"",status:"active" as const,shielded:false}));
  const cue:ExportCue = {...speech,picture:{kind:"influence",cue:{key:"fixture",source:"classic",kind:"classic_transcript",canonicalSequence:null,round:1,phase:"INTRODUCTION",stage:"done",sceneIndex:0,messageIndex:0,baseDurationMs:1000},
    beat:{kind:"portrait",purpose:"Conversation",player:players[0]!,speech:{playerId:"p1",speaker:"p1",text:"Neighbor speech",id:"1"}},
    rooms:[],roster:players,ledger:null}};
  expect(thinkingPicture(cue,"p2").actor.id).toBe("p2");
  expect(() => thinkingPicture(cue,"absent")).toThrow("absent from source roster");
});
test("thought-only cut contains no sibling speech, recording or duration",async () => {
  const {speech,thought} = await fixture();
  speech.timing.recording = {assetId:"omitted-voice",durationMs:3000};
  const source = [{id:"thought",segments:[thought]},{id:"speech",segments:[speech]}];
  const cut = compilePresentation({...settings,source,selectedIds:["thought"]});
  expect(cut.cues).toHaveLength(1);
  expect(cut.cues[0]!.speech).toBeNull();
  expect(cut.cues[0]!.picture.kind).toBe("thinking");
  expect(JSON.stringify(cut)).not.toContain(speech.speech!.text);
  expect(JSON.stringify(cut)).not.toContain("omitted-voice");
  expect(cut.audio.clips).toEqual([]);
  const time = cut.timeline[0]!;
  expect(time.endMs).toBe(time.thought!.duration);
  for (const ms of [0,time.endMs-1,time.endMs/2,1]) expect(sampleTiming(time,ms).elapsedMs).toBe(thought.timing.sourceElapsedMs!);
});
test("separating thoughts preserves full duration and speech-off coverage",async () => {
  const {speech,thought} = await fixture();
  const combined = compileTiming([{...speech.timing,thinking:thought.timing.thinking}],settings.profile,30);
  const cut = compilePresentation({...settings,source:[{id:"thought",segments:[thought]},{id:"speech",segments:[speech]}],selectedIds:["thought","speech"]});
  expect(cut.timeline.at(-1)!.endMs).toBe(combined.at(-1)!.endMs);
  const speechOnly = compilePresentation({...settings,source:[{id:"thought",segments:[thought]},{id:"speech",segments:[speech]}],selectedIds:["speech"]});
  expect(speechOnly.timeline[0]!.endMs).toBe(speech.timing.baseDurationMs);
});
test("content anchors sample readable thinking and speech after edited entrances",async () => {
  const {speech,thought} = await fixture();
  const source = [{id:"thought",segments:[thought]},{id:"speech",segments:[speech]}];
  for (const fps of [24,30,60]) for (const motionScale of [.1,1,2]) {
    const compiled = compilePresentation({...settings,source,selectedIds:["thought","speech"],fps,
      profile:parseTimingProfile({motionScale,readingRate:3,thinkingRate:2,establishingHoldMs:173,conversationGapMs:111})});
    for (const [index,moment] of compiled.moments.entries()) {
      const frame = retainPresentationAnchor(source,compiled,{momentId:moment.id,at:"content"})!;
      expect(frame).toBeGreaterThan(moment.startFrame);
      expect(frame).toBeLessThan(moment.endFrame);
      const time = compiled.timeline[index]!, ms = frame * 1000 / fps;
      const sample = sampleTiming(time,ms);
      if (moment.id === "thought") {
        expect(sample.thought?.opacity).toBe(1);
        expect(sample.thought?.focus).toBe(1);
        expect(sample.thought!.elapsedMs).toBeLessThan(1000 / fps + .001);
      } else {
        expect(sample.thought).toBeNull();
        expect(sample.elapsedMs).toBeGreaterThanOrEqual(speech.timing.speech!.readAtMs);
        expect(sample.elapsedMs).toBeLessThan(speech.timing.speech!.hideAtMs);
      }
      expect(retainPresentationAnchor(source,compiled,{momentId:moment.id,offsetFrames:0})).toBe(moment.startFrame);
    }
  }
  const cut = compilePresentation({...settings,source,selectedIds:["thought"]});
  expect(sampleTiming(cut.timeline[0]!,cut.moments[0]!.contentFrame * 1000 / settings.fps).thought?.opacity).toBe(1);
  expect(cut.cues[0]!.speech).toBeNull();
});
test("silent content anchors stay in their first authored shot and within one-frame cues",async () => {
  const {speech} = await fixture();
  const silent = (kind:"opening"|"ballot"|"tally"|"scene"|"result", duration=2200):ExportCue => ({...speech,speech:null,
    timing:{key:kind,kind,baseDurationMs:duration,speech:null,thinking:null}});
  const kinds = ["opening","ballot","tally","scene","result"] as const;
  const source = kinds.map(kind => ({id:kind,segments:[silent(kind)]}));
  source[0]!.segments.push(silent("opening",4000));
  const compiled = compilePresentation({...settings,source,selectedIds:source.map(moment=>moment.id)});
  const opening = compiled.moments[0]!;
  expect(opening.contentFrame).toBeGreaterThan(opening.startFrame);
  expect(opening.contentFrame).toBeLessThan(compiled.timeline[0]!.endFrame);
  const ballot = compiled.moments[1]!, ballotTime = compiled.timeline[2]!;
  expect(votePresentationTiming(sampleTiming(ballotTime,ballot.contentFrame * 1000 / settings.fps).elapsedMs,2200).revealed).toBe(true);
  for (const moment of compiled.moments) {
    expect(moment.contentFrame).toBeGreaterThanOrEqual(moment.startFrame);
    expect(moment.contentFrame).toBeLessThan(moment.endFrame);
  }
  const single = compilePresentation({...settings,source:[{id:"tiny",segments:[silent("scene",1)]}],selectedIds:["tiny"]});
  expect(single.moments[0]!.contentFrame).toBe(0);
});
test("selection keeps already reduced state when earlier movie content is omitted",async () => {
  const {cues} = await fixture();
  const result = cues.findLast(cue => cue.timing.kind === "result")!;
  const selected = compilePresentation({...settings,source:cues.map((cue,index) => ({id:`fixture-${index}`,segments:[cue]})),selectedIds:[`fixture-${cues.indexOf(result)}`]});
  expect(selected.cues[0]!.picture).toEqual(result.picture);
  if (selected.cues[0]!.picture.kind !== "werewolf") throw new Error("Fixture result expected");
  expect(selected.cues[0]!.picture.cue.moment.snapshot.outcome).not.toBeNull();
  expect(selected.cues[0]!.picture.cue.moment.snapshot.players.some(player => !player.alive)).toBe(true);
});
test("atomic opening groups segments and selection/order/anchor failures are explicit",async () => {
  const {cues,speech} = await fixture();
  const opening = cues.filter(cue => cue.picture.kind === "werewolf-opening");
  const source = [{id:"opening",segments:opening},{id:"speech",segments:[speech]}];
  const compiled = compilePresentation({...settings,source,selectedIds:["opening","speech"]});
  expect(compiled.momentIds).toEqual(["opening","speech"]);
  expect(compiled.moments[0]!.endFrame).toBe(compiled.moments[1]!.startFrame);
  const cut = compilePresentation({...settings,source,selectedIds:["speech"]});
  expect(retainPresentationAnchor(source,cut,{momentId:"opening",offsetFrames:50})).toBe(0);
  expect(retainPresentationAnchor(source,cut,{momentId:"speech",offsetFrames:999999})).toBe(cut.moments[0]!.endFrame-1);
  expect(retainPresentationAnchor(source,compilePresentation({...settings,source,selectedIds:[]}),null)).toBeNull();
  expect(() => compilePresentation({...settings,source,selectedIds:["speech","opening"]})).toThrow("source order");
  expect(() => compilePresentation({...settings,source,selectedIds:["unknown"]})).toThrow("Unknown");
  expect(() => compilePresentation({...settings,source,selectedIds:["speech"],profile:parseTimingProfile({overrides:{unknown:{readingRate:2}}})})).toThrow("Unresolved");
});
