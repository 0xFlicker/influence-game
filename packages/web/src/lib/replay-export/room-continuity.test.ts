import {expect,test} from "bun:test";
import {exportPreviousSpeaker} from "./room-continuity";
import type {ExportCue} from "./cues";
import {compileTiming,parseTimingProfile,sampleTiming} from "./timing";
import {portraitRoomTransitionSeats} from "../../app/games/[slug]/components/portrait-room";
const thought=(actorId:string,label="Day 1"):ExportCue=>({label,source:{kind:"opening"},speech:null,music:null,
  picture:{kind:"thinking",gameKind:"influence",actor:{id:actorId,name:actorId,persona:""},scene:null,sourceElapsedMs:650,
    room:{number:null,label,players:["a","b","c","d","e","f"].map(id=>({id,name:id,persona:""}))}},
  timing:{key:actorId,kind:"thinking",baseDurationMs:1,speech:null,thinking:"A considered decision.",sourceElapsedMs:650,thinkingEstablishMs:650}});
test("sampled room turns survive independently selected thought shots and reset at new rooms",()=>{
  const before=thought("a"),current=thought("d");
  expect(exportPreviousSpeaker(current,before)).toBe("a");
  expect(exportPreviousSpeaker(current)).toBeNull();
  expect(exportPreviousSpeaker(thought("d","Night 1"),before)).toBeNull();
  const [timing]=compileTiming([current.timing],parseTimingProfile({}),30);
  expect(sampleTiming(timing!,timing!.startMs).thought).toBeNull();
  const middle=sampleTiming(timing!,325),settled=sampleTiming(timing!,650);
  expect(middle.elapsedMs).toBe(325);
  expect(settled.elapsedMs).toBe(650);
  const start=portraitRoomTransitionSeats(1920,6,0,3,0),mid=portraitRoomTransitionSeats(1920,6,0,3,.5),end=portraitRoomTransitionSeats(1920,6,0,3,1);
  expect(mid).not.toEqual(start);expect(mid).not.toEqual(end);
  expect(sampleTiming(timing!,325)).toEqual(middle);
});
