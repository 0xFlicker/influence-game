import {expect,test} from "bun:test";
import type {AudioWatchCoordinate} from "@influence/engine/audio-watch";
import type {PublishedAudioClip} from "@influence/engine/audio-track";
import {indexAudioClips,influenceTranscriptAudioIdentity,matchesAudioWatch} from "../components/watch/audio-watch-coordinate";

test("indexed lookup preserves exact matching, aliases and clip order", () => {
 const identities: AudioWatchCoordinate[] = [
   {kind:"influence",transcriptId:"12",entrySequence:42,eventSequence:15,actorId:null,part:"speech"},
   {kind:"influence",transcriptId:"13",entrySequence:42,eventSequence:15,actorId:null,part:"speech"},
   {kind:"influence",entrySequence:42,eventSequence:15,actorId:null,part:"thinking"},
   {kind:"influence",eventSequence:15,actorId:null,part:"speech"},
   {kind:"werewolf",cursor:9,action:"protect",actorId:"doctor",part:"speech"},
   {kind:"werewolf",cursor:9,actorId:"doctor",part:"thinking"},
 ];
 const clips: PublishedAudioClip[] = identities.map((watch,index)=>({watch,momentId:String(index),speakerId:watch.actorId,textHash:"text",versionId:String(index),sha256:"hash",durationMs:1000,url:"/audio"}));
 const find = indexAudioClips(clips);
 for (const request of identities) expect(find(request)).toEqual(clips.filter(clip=>matchesAudioWatch(clip.watch,request)));
 expect(find(null)).toEqual([]);
});

test("live speech, thinking and House narration bind through durable dialogue identity",()=>{
 for(const actorId of ["player",null]) for(const part of ["speech","thinking"] as const){
  const saved:AudioWatchCoordinate={kind:"influence",transcriptId:"29562",entrySequence:42,eventSequence:15,actorId,part};
  const live:AudioWatchCoordinate={kind:"influence",...influenceTranscriptAudioIdentity({id:-137,entrySequence:42}),eventSequence:15,actorId,part:"speech"};
  expect(live).not.toHaveProperty("transcriptId");
  expect(matchesAudioWatch(saved,live)).toBe(true);
  expect(matchesAudioWatch({...saved,entrySequence:43},live)).toBe(false);
  expect(matchesAudioWatch({...saved,entrySequence:undefined},live)).toBe(false);
  expect(matchesAudioWatch({...saved,actorId:"other"},live)).toBe(false);
 }
});
test("persisted transcript IDs remain exact and event-only format clips retain their binding",()=>{
 const saved:AudioWatchCoordinate={kind:"influence",transcriptId:"12",entrySequence:42,eventSequence:15,actorId:null,part:"speech"};
 const replay:AudioWatchCoordinate={kind:"influence",...influenceTranscriptAudioIdentity({id:12,entrySequence:42}),eventSequence:15,actorId:null,part:"speech"};
 expect(matchesAudioWatch(saved,replay)).toBe(true);
 expect(matchesAudioWatch({...saved,entrySequence:undefined},replay)).toBe(true);
 expect(matchesAudioWatch({...saved,transcriptId:"13"},replay)).toBe(false);
 const event:AudioWatchCoordinate={kind:"influence",eventSequence:15,actorId:null,part:"speech"};
 expect(matchesAudioWatch(event,event)).toBe(true);
 expect(matchesAudioWatch(saved,event)).toBe(false);
 expect(matchesAudioWatch(event,replay)).toBe(false);
 expect(influenceTranscriptAudioIdentity({id:-1})).toBeNull();
});
test("Werewolf narration and private action matching remain unchanged",()=>{
 const action:AudioWatchCoordinate={kind:"werewolf",cursor:9,action:"protect",actorId:"doctor",part:"speech"};
 expect(matchesAudioWatch(action,action)).toBe(true);
 expect(matchesAudioWatch({...action,action:"investigate"},action)).toBe(false);
 expect(matchesAudioWatch({...action,cursor:10},action)).toBe(false);
 expect(matchesAudioWatch({...action,part:"thinking",action:undefined},action)).toBe(true);
});
