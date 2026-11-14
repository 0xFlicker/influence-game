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
  const cue=buildClassicPresentationCues(buildStoryScenes([message]),[],players,{composeRooms:true,gameKernel:"classic",messages:[message]})[0]!;
  expect(cue.baseDurationMs).toBe(15050);
  expect(cue.minimumDurationMs).toBe(15050);
  expect(cue.minimumThinkingMs).toBe(14000);
  expect(cue.readingHold).toBe(true);
  expect(roomSpeechDurationMs(message.text,12,false)).toBe(cue.baseDurationMs);
  const exported=buildExportCues({kind:"influence",game:{id:"g",slug:"g",status:"completed",gameKernel:"classic",players},messages:[message],frames:[],thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[],fullBodies:Object.fromEntries(players.map(player=>[player.id,"/body.png"]))}}).find(row=>row.speech?.text===message.text)!;
  expect(exported.timing.baseDurationMs).toBe(cue.baseDurationMs);
  expect(exported.timing.minimumDurationMs).toBe(cue.minimumDurationMs);
  expect(exported.timing.minimumThinkingMs).toBe(cue.minimumThinkingMs);
  const [timeline]=compileTiming([{...exported.timing,recording:{assetId:"voice",durationMs:500}}],parseTimingProfile({motionScale:.1}),30);
  expect(timeline!.endMs-timeline!.startMs).toBeGreaterThanOrEqual(15050);
});

test("portrait-only and mixed-art games keep original Lobby timing in viewer and exports",()=>{
 const players=Array.from({length:12},(_,index)=>({id:`p${index}`,name:`P${index}`,persona:"",status:"alive" as const,shielded:false}));
 const message:TranscriptEntry={id:1,entrySequence:1,gameId:"g",round:1,phase:"LOBBY",scope:"public",speakerPlayerId:"p0",fromPlayerId:"p0",fromPlayerName:"P0",toPlayerIds:[],text:"Yes.",thinking:"Listen.",timestamp:1};
 const viewer=buildClassicPresentationCues(buildStoryScenes([message]),[],players)[0]!;
 expect(viewer.baseDurationMs).toBeLessThan(5000);
 expect(viewer.minimumDurationMs).toBeUndefined();expect(viewer.minimumThinkingMs).toBeUndefined();expect(viewer.readingHold).toBeUndefined();
 for(const fullBodies of [{},Object.fromEntries(players.slice(0,-1).map(player=>[player.id,"/body.png"]))]){
  const cue=buildExportCues({kind:"influence",game:{id:"g",slug:"g",status:"completed",gameKernel:"classic",players},messages:[message],frames:[],thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[],fullBodies}}).find(row=>row.speech?.text===message.text)!;
  expect(cue.previousRoomSpeakerId).toBeUndefined();
  expect(cue.timing.baseDurationMs).toBe(viewer.baseDurationMs);expect(cue.timing.minimumDurationMs).toBeUndefined();expect(cue.timing.minimumThinkingMs).toBeUndefined();
  if(cue.picture.kind!=="influence" || cue.picture.beat?.kind!=="portrait-room")throw new Error("Expected the original portrait room");
  expect(cue.picture.beat.participants.every(player=>!player.fullBodyReferenceUrl)).toBe(true);
 }
});

test("a huddle with complete room artwork still keeps portraits when another frozen contestant lacks a body",()=>{
 const players=Array.from({length:12},(_,index)=>({id:`p${index}`,name:`P${index}`,persona:"",status:"alive" as const,shielded:false}));
 const message:TranscriptEntry={id:1,entrySequence:1,gameId:"g",round:1,phase:"MINGLE",scope:"huddle",speakerPlayerId:"p0",fromPlayerId:"p0",fromPlayerName:"P0",toPlayerIds:["p1","p2","p3"],text:"Let us talk.",timestamp:1};
 const cue=buildExportCues({kind:"influence",game:{id:"g",slug:"g",status:"completed",gameKernel:"classic",players},messages:[message],frames:[],thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[],fullBodies:Object.fromEntries(players.slice(0,-1).map(player=>[player.id,"/body.png"]))}}).find(row=>row.speech?.text===message.text)!;
 if(cue.picture.kind!=="influence" || cue.picture.beat?.kind!=="portrait-room")throw new Error("Expected the original portrait room");
 expect(cue.picture.beat.participants).toHaveLength(4);
 expect(cue.picture.beat.participants.every(player=>!player.fullBodyReferenceUrl)).toBe(true);
});

test("historical full-body Lobby holds use the prefix cast rather than final standings",()=>{
 const players=Array.from({length:12},(_,index)=>({id:`p${index}`,name:`Contestant ${index+100}`,persona:"",status:index<2 ? "alive" as const : "eliminated" as const,shielded:false}));
 const opening:TranscriptEntry={id:1,entrySequence:1,gameId:"g",round:1,phase:"LOBBY",scope:"public",speakerPlayerId:"p0",fromPlayerId:"p0",fromPlayerName:"P0",toPlayerIds:[],text:"Yes.",thinking:"Listen.",timestamp:1};
 const exit:TranscriptEntry={...opening,id:2,entrySequence:2,phase:"REVEAL",scope:"system",speakerPlayerId:null,fromPlayerId:null,text:"ELIMINATED: Contestant 111",timestamp:2};
 const later:TranscriptEntry={...opening,id:3,entrySequence:3,round:2,timestamp:3};
 const messages=[opening,exit,later],fullBodies=Object.fromEntries(players.map(player=>[player.id,"/body.png"]));
 const viewer=buildClassicPresentationCues(buildStoryScenes(messages),[],players,{composeRooms:true,gameKernel:"classic",messages});
 const exported=buildExportCues({kind:"influence",game:{id:"g",slug:"g",status:"completed",gameKernel:"classic",players},messages,frames:[],thoughts:{},visual:{enabled:false,status:null,portraits:{},scenes:[],fullBodies}}).filter(row=>row.speech?.text==="Yes.");
 for(const [index,count]of [12,11].entries()) {
  const cue=viewer.find(cue=>cue.round===index+1 && cue.phase==="LOBBY")!;
  expect(cue.baseDurationMs).toBe(portraitRoomDurationMs("Yes.",count));expect(cue.minimumThinkingMs).toBe(portraitRoomPageCount(count)*3500);
  expect(exported[index]!.timing.baseDurationMs).toBe(cue.baseDurationMs);
  const picture=exported[index]!.picture;if(picture.kind!=="influence" || picture.beat?.kind!=="portrait-room")throw new Error("Expected historical Lobby");
  expect(picture.beat.participants).toHaveLength(count);
  if(index===1){expect(picture.beat.participants.map(player=>player.id)).not.toContain("p11");expect(picture.beat.participants.map(player=>player.id)).toContain("p1");}
 }
 const format=buildClassicPresentationCues(buildStoryScenes(messages),[],players,{composeRooms:true,gameKernel:"format",messages});
 expect(format.find(cue=>cue.phase==="LOBBY")!.minimumThinkingMs).toBeUndefined();
});
