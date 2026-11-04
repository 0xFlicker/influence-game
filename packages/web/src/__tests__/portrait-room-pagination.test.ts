import {expect, test} from "bun:test";
import {portraitRoomDurationMs, portraitRoomPage, portraitRoomPageCount, PORTRAIT_ROOM_PAGE_HOLD_MS} from "../app/games/[slug]/components/portrait-room-pagination";
import {buildClassicPresentationCues} from "../app/games/[slug]/components/influence-replay-cues";
import {buildStoryScenes} from "../app/games/[slug]/components/house-story";
import {compileTiming, parseTimingProfile, sampleTiming} from "../lib/replay-export/timing";
import type {TranscriptEntry} from "../lib/api";

test("large social rooms hold each cast page and sample identically on reverse seek", () => {
  const members = Array.from({length:11},(_,index)=>`p${index}`);
  const message:TranscriptEntry = {id:1,entrySequence:1,firstDurableEventSequence:5,gameId:"g",round:1,phase:"FORMAT_MINGLE",scope:"huddle",
    fromPlayerId:"p0",speakerPlayerId:"p0",fromPlayerName:"P0",toPlayerIds:members.slice(1),text:"A short promise.",timestamp:1,
    allianceSession:{sessionId:"s",allianceId:"a",memberIds:members}};
  const cue = buildClassicPresentationCues(buildStoryScenes([message]),[])[0]!;
  const pages = portraitRoomPageCount(members.length);
  expect(pages).toBe(4);
  expect(portraitRoomPageCount(5)).toBe(2);
  expect(portraitRoomPageCount(4)).toBe(1);
  expect(cue.baseDurationMs).toBe(portraitRoomDurationMs(message.text,members.length));
  expect(cue.minimumThinkingMs).toBe(pages * PORTRAIT_ROOM_PAGE_HOLD_MS);
  expect(cue.readingHold).toBe(true);
  const times = Array.from({length:pages},(_,index)=>650+(cue.baseDurationMs-1050)*(index+.5)/pages);
  expect(times.map(time=>portraitRoomPage(time,cue.baseDurationMs,members.length))).toEqual([0,1,2,3]);
  expect(times.toReversed().map(time=>portraitRoomPage(time,cue.baseDurationMs,members.length))).toEqual([3,2,1,0]);
});

test("recorded speech and thinking leave enough clock time for large cast pages", () => {
  const [speech,thought] = compileTiming([
    {key:"speech",kind:"speech",baseDurationMs:15050,minimumDurationMs:15050,readingHold:true,speech:{showAtMs:650,readAtMs:850,hideAtMs:14450,hiddenAtMs:14650},thinking:null,recording:{assetId:"voice",durationMs:2000}},
    {key:"thought",kind:"thinking",baseDurationMs:1,speech:null,thinking:"A short thought.",minimumThinkingMs:14000,recording:{assetId:"thought-voice",durationMs:2000}},
  ],parseTimingProfile({motionScale:.1}),30);
  expect(speech!.recording?.durationMs).toBe(2000);
  expect(speech!.endMs - speech!.startMs).toBeGreaterThanOrEqual(15050);
  expect(sampleTiming(speech!, speech!.startMs + 7500).elapsedMs).toBeGreaterThan(1000);
  expect(thought!.thought!.hideAtMs - thought!.thought!.readAtMs).toBeGreaterThanOrEqual(14000);
  expect(thought!.recording?.durationMs).toBe(2000);
});
