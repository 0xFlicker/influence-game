import {expect, test} from "bun:test";
import {portraitRoomDurationMs, portraitRoomPage, portraitRoomPageCount, portraitRoomNameProgress, PORTRAIT_ROOM_PAGE_HOLD_MS,roomSpeechDurationMs} from "../app/games/[slug]/components/portrait-room-pagination";
import {buildClassicPresentationCues} from "../app/games/[slug]/components/influence-replay-cues";
import {buildStoryScenes} from "../app/games/[slug]/components/house-story";
import {compileTiming, parseTimingProfile, sampleTiming} from "../lib/replay-export/timing";
import {buildExportCues} from "../lib/replay-export/cues";
import type {TranscriptEntry} from "../lib/api";

test("guest names finish inside their own cast page while the speaker keeps the shared clock",()=>{
  expect(portraitRoomNameProgress(.375,0,2,false)).toBe(.75);
  expect(portraitRoomNameProgress(.875,1,2,false)).toBe(.75);
  expect(portraitRoomNameProgress(.875,1,2,true)).toBe(.875);
  expect(portraitRoomNameProgress(.5,0,2,false)).toBe(1);
  expect(portraitRoomNameProgress(.5,1,2,false)).toBe(0);
});

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

test("short large Lobby contributions reserve complete cast pages through viewer and export timing",()=>{
  const players=Array.from({length:12},(_,index)=>({id:`p${index}`,name:`Player ${index}`,persona:"",status:"alive" as const,shielded:false}));
  const message:TranscriptEntry={id:1,entrySequence:1,gameId:"g",round:1,phase:"LOBBY",scope:"public",speakerPlayerId:"p0",fromPlayerId:"p0",fromPlayerName:"Player 0",toPlayerIds:[],text:"Yes.",thinking:"Listen.",timestamp:1};
  const cue=buildClassicPresentationCues(buildStoryScenes([message]),[],players)[0]!;
  expect(cue.baseDurationMs).toBe(8050);
  expect(cue.minimumDurationMs).toBe(8050);
  expect(cue.minimumThinkingMs).toBe(7000);
  expect(cue.readingHold).toBe(true);
  expect(roomSpeechDurationMs(message.text,12,false)).toBe(cue.baseDurationMs);
  const exported=buildExportCues({kind:"influence",game:{id:"g",slug:"g",status:"completed",gameKernel:"classic",players},messages:[message],frames:[],thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[],fullBodies:Object.fromEntries(players.map(player=>[player.id,"/body.png"]))}}).find(row=>row.speech?.text===message.text)!;
  expect(exported.timing.baseDurationMs).toBe(cue.baseDurationMs);
  expect(exported.timing.minimumDurationMs).toBe(cue.minimumDurationMs);
  expect(exported.timing.minimumThinkingMs).toBe(cue.minimumThinkingMs);
  const [timeline]=compileTiming([{...exported.timing,recording:{assetId:"voice",durationMs:500}}],parseTimingProfile({motionScale:.1}),30);
  expect(timeline!.endMs-timeline!.startMs).toBeGreaterThanOrEqual(8050);
});
