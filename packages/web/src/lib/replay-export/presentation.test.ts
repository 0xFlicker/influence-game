import {expect,test} from "bun:test";
import {werewolfResultsFixture} from "@influence/engine/fixtures/werewolf-results";
import {projectWerewolfWatch} from "@influence/engine/werewolf/watch";
import {buildExportCues,type ExportCue} from "./cues";
import {compilePresentation,thinkingSegment,thinkingPicture,retainPresentationAnchor} from "./presentation";
import {compileTiming,parseTimingProfile,sampleTiming} from "./timing";

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
