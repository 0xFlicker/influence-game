import {test,expect} from 'bun:test';
import {completedCurrentWerewolfFixture} from '@influence/engine/fixtures/werewolf-results';
import {projectWerewolfProductionWatch,projectWerewolfProductionProvenance} from '@influence/engine/werewolf/watch';
import {buildWerewolfProductionSources} from '@influence/engine/production-moments/werewolf-source';
import {assembleProductionCatalog,productionMomentKey} from '@influence/engine/production-moments';
import {werewolfMomentCues,werewolfCues} from '../components/games/werewolf/werewolf-watch-model';
import {werewolfFollowPosition} from '../components/games/werewolf/werewolf-follow-position';

test('every current Werewolf playback cue maps to its canonical audience action',async()=>{
 const id='current-follow-contract',events=await completedCurrentWerewolfFixture(id,11);
 for(const audience of ['mystery','omniscient'] as const){
  const projection=projectWerewolfProductionWatch(events,audience),provenance=projectWerewolfProductionProvenance(events,audience);
  const catalog=assembleProductionCatalog({gameId:id,gameKind:'werewolf',audience,sources:buildWerewolfProductionSources({gameId:id,audience,moments:projection.moments,provenance,thoughts:[],opening:true})});
  for(const moment of projection.moments)for(const cue of werewolfMomentCues(moment)){
   const p=werewolfFollowPosition(cue,audience);if(p?.kind!=='werewolf')throw new Error('Missing Werewolf position');
   const sequence=provenance.find(row=>row.cursor===p.cursor)!.eventSequence;
   expect(catalog.moments.some(m=>m.id===productionMomentKey(id,{kind:'werewolf-event',eventSequence:sequence},p.part))).toBe(true);
  }
 }
});

import {PresentationDirector,type PresentationClock} from '../components/watch/watch-director';
import {werewolfPlaybackPolicy,type WerewolfPlaybackCue} from '../components/games/werewolf/werewolf-opening';
import {werewolfCommentaryReady,werewolfPlaybackConcluded} from '../components/games/werewolf/werewolf-follow-position';
class FollowClock implements PresentationClock {
 time=0;id=0;timers=new Map<number,{at:number;callback:()=>void}>();now(){return this.time;}
 setTimeout(callback:()=>void,delay:number){const id=++this.id;this.timers.set(id,{at:this.time+delay,callback});return id;}
 clearTimeout(id:number){this.timers.delete(id);}
 tick(ms:number){this.time+=ms;for(const [id,timer]of this.timers)if(timer.at<=this.time){this.timers.delete(id);timer.callback();}}
}
test('canonical night and announcement cues reserve the floor through the full recorded narration',async()=>{
 const events=await completedCurrentWerewolfFixture('transition-floor',11);
 const moments=projectWerewolfProductionWatch(events,'mystery').moments;
 const night=moments.find(m=>m.entry.kind==='night')!;
 const day=moments.find(m=>m.cursor>night.cursor&&m.entry.kind==='phase'&&m.entry.phase==='day')!;
 const result=moments.find(m=>m.entry.kind==='result')!;
 expect(night).toBeDefined();expect(day).toBeDefined();expect(result).toBeDefined();
 for(const moment of [night,day,result]){
  const cue=werewolfMomentCues(moment).at(-1)!;
  const clock=new FollowClock(),director=new PresentationDirector<WerewolfPlaybackCue>({clock,policy:werewolfPlaybackPolicy,followTail:true});
  director.load([cue]);director.setRecordings(cue.key,{speechMs:20000});director.play();
  expect(werewolfCommentaryReady(director)).toBe(false); // includes the pre-audio entrance
  clock.tick(19900);expect(werewolfCommentaryReady(director)).toBe(false);
  clock.tick(1000);
  expect(werewolfCommentaryReady(director)).toBe(moment!==night); // dawn must continue to the daytime announcement
  director.dispose();
 }
});

test('closing discussion is triggered by the canonical post-retrospective reprise, not winner reveal',async()=>{
 const events=await completedCurrentWerewolfFixture('closing-follow',11);
 const projection=projectWerewolfProductionWatch(events,'mystery');
 const last=projection.moments.at(-1)!;
 const cues=werewolfCues([{...projection,gameId:'closing-follow',audience:'mystery',status:'completed',fromCursor:1,throughCursor:last.cursor,latestCursor:last.cursor,slug:'closing-follow',rulesVersion:last.snapshot.rulesVersion,publicationCutoff:'2026-10-30T00:00:00Z',players:[],navigation:[],playback:[],media:{}}]);
 const result=cues.find(c=>c.moment.entry.kind==='result'&&!c.reprise)!;
 expect(werewolfPlaybackConcluded(result,'completed')).toBe(false);
 const ending=cues.at(-1)!;
 expect(ending.reprise).toBe(true);
 expect(werewolfPlaybackConcluded(ending,'in_progress')).toBe(false);
 expect(werewolfPlaybackConcluded(ending,'completed')).toBe(true);
});
