import {expect,test} from "bun:test";
import {alliancePresentationFixture} from "../../scripts/alliance-presentation-fixture";
import {compilePresentation} from "./presentation";
import {parseTimingProfile} from "./timing";
import {INFLUENCE_MUSIC} from "../../app/games/[slug]/components/influence-music";
import {exportRoomContext,exportPreviousSpeaker} from "./room-continuity";
import {allianceMemberPage,allianceIntroductionDurationMs} from "@influence/engine/alliance-introductions";
import {buildInfluenceProductionSources} from "@influence/engine/production-moments/influence-source";

test("Source and isolated Selected cuts preserve alliance identity, pinned art, thoughts, recording and music",async()=>{
  const fixture=await alliancePresentationFixture(7);
  const assets=Object.fromEntries(Object.values(INFLUENCE_MUSIC).map(track=>[track.src,{path:track.src,sha256:"fixture",mediaType:"audio" as const,durationMs:300000}]));
  const compile=(selectedIds:string[],music=false)=>compilePresentation({source:fixture.bound,selectedIds,profile:parseTimingProfile({ending:{holdMs:0}}),fps:30,assets,music});
  const all=compile(fixture.catalog.moments.map(moment=>moment.id),true);
  expect(all.momentIds).toEqual(fixture.catalog.moments.map(moment=>moment.id));
  const intro=compile([fixture.introId!]);
  expect(intro.cues).toHaveLength(1);
  expect(intro.cues[0]!.source).toMatchObject({transcriptId:12,transcriptSequence:12,eventSequence:20});
  expect(intro.cues[0]!.picture).toMatchObject({beat:{kind:"alliance-introduction",participants:fixture.cast.map(player=>({id:player.id,avatarUrl:"/avatars/personas/strategic.png"}))}});
  expect(intro.cues[0]!.speech).toMatchObject({speakerId:null,text:fixture.intro.text});
  expect(intro.audio.clips).toEqual([]);
  expect(compile([fixture.introId!],true).audio.clips.some(clip=>clip.purpose === "music")).toBeTrue();
  for(const ids of [[fixture.speechId],[fixture.thoughtId],[fixture.thoughtId,fixture.speechId]]) {
    const cut=compile(ids);
    expect(cut.cues.every(cue=>cue.picture.kind !== "influence" || cue.picture.beat?.kind !== "alliance-introduction")).toBeTrue();
    expect(cut.cues[0]!.label).toBe("Round 1 · The Night Shift");
    expect(JSON.stringify(exportRoomContext(cut.cues[0]))).toContain("The Night Shift");
    expect(JSON.stringify(cut.cues[0]!.picture)).not.toContain(fixture.intro.text);
  }
  const speech=compile([fixture.speechId]).cues[0]!;
  expect(exportPreviousSpeaker(speech,intro.cues[0])).toBeNull();
  const recorded=structuredClone(fixture.bound);
  recorded.find(moment=>moment.id===fixture.introId)!.segments[0]!.timing.recording={assetId:"fixture-voice",durationMs:15000};
  const withVoice=compilePresentation({source:recorded,selectedIds:[fixture.introId!],profile:parseTimingProfile(),fps:30,assets,music:false});
  expect(withVoice.audio.clips).toHaveLength(1);
  expect(withVoice.audio.clips[0]).toMatchObject({asset:"fixture-voice",purpose:"speech",endMs:15000});
});

test("historical, missing and pass-only conversations never invent an introduction",async()=>{
  const fixture=await alliancePresentationFixture(3,true);
  expect(fixture.introId).toBeUndefined();
  const compiled=compilePresentation({source:fixture.bound,selectedIds:[fixture.speechId],profile:parseTimingProfile(),fps:30,assets:{},music:false});
  expect(compiled.cues[0]!.picture).toMatchObject({beat:{kind:"portrait-room",roomLabel:"The Night Shift"}});
  const missing=buildInfluenceProductionSources({gameId:fixture.source.game.id,gameKernel:"classic",frames:[],transcripts:[fixture.intro]});
  expect(missing.filter(source=>source.kind === "influence-transcript")).toEqual([]);
  const passes=buildInfluenceProductionSources({gameId:fixture.source.game.id,gameKernel:"classic",frames:[],transcripts:[{...fixture.speech,scope:"thinking"}]});
  expect(passes.filter(source=>source.kind === "influence-transcript")).toEqual([]);
});

test("cast pages follow the shared clock, with adequate reading time and stable direct/reverse seeks",()=>{
  const duration=allianceIntroductionDurationMs("A choice awaits.",15);
  expect(duration).toBeGreaterThanOrEqual(14600);
  const seeks=[0,1,2,3].map(page=>300+(duration-600)*(page+.5)/4);
  expect(seeks.map(elapsed=>allianceMemberPage(elapsed,duration,15))).toEqual([0,1,2,3]);
  expect(seeks.toReversed().map(elapsed=>allianceMemberPage(elapsed,duration,15))).toEqual([3,2,1,0]);
  expect(allianceMemberPage(-100,duration,15)).toBe(0);
  expect(allianceMemberPage(duration+100,duration,15)).toBe(3);
});
