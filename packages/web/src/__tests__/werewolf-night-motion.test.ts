import {expect, test} from "bun:test";
import {wolfTransformationFrame, nightClawFrame, WOLF_TRANSFORM_MS, WOLF_STAGGER_MS, NIGHT_CLAW_MS} from "../components/games/werewolf/werewolf-night-motion";
import {adjacentWerewolfPosition, werewolfMomentCues, werewolfWatchPolicy} from "../components/games/werewolf/werewolf-watch-model";
import {PresentationDirector, type PresentationClock} from "../components/watch/watch-director";
import {projectWerewolfWatch} from "../../../engine/src/werewolf/watch";
import {werewolfResultsFixture} from "../../../engine/src/fixtures/werewolf-results";

class Clock implements PresentationClock {
  time=0; id=0; timers=new Map<number,{at:number;fn:()=>void}>();now(){return this.time;}
  setTimeout(fn:()=>void,ms:number){const id=++this.id;this.timers.set(id,{at:this.time+ms,fn});return id;}
  clearTimeout(id:number){this.timers.delete(id);}
  tick(ms:number){this.time+=ms;for(const [id,timer] of this.timers)if(timer.at<=this.time){this.timers.delete(id);timer.fn();}}
}
test("wolf switches increase duty cycle, bounce deterministically, stagger, and settle",()=>{
  const counts=[0,800,1600,2400].map(start=>Array.from({length:80},(_,i)=>wolfTransformationFrame(start+i*10,0,false)).filter(f=>f.wolf).length);
  expect(counts).toEqual([16,32,56,64]);
  const frame=wolfTransformationFrame(700,0,false);
  expect(frame.scale).toBeGreaterThan(1);
  expect(wolfTransformationFrame(700+WOLF_STAGGER_MS,1,false).wolf).toBe(frame.wolf);
  expect(wolfTransformationFrame(700,1,false).wolf).toBe(false);
  expect(wolfTransformationFrame(700,0,false)).toEqual(frame);
  expect(wolfTransformationFrame(WOLF_TRANSFORM_MS,0,false)).toEqual({wolf:true,wolfOpacity:1,scale:1,y:0,rotate:0});
  expect(wolfTransformationFrame(300,0,true)).toEqual({wolf:false,wolfOpacity:.5,scale:1,y:0,rotate:0});
});
test("night slash draws once, settles on direct seek and is static in reduced motion",()=>{
  expect(nightClawFrame(0,false).strokes).toEqual([0,0,0]);
  expect(nightClawFrame(300,false).strokes[0]).toBe(1);
  expect(nightClawFrame(NIGHT_CLAW_MS,false)).toMatchObject({settled:true,opacity:0,strokes:[1,1,1]});
  expect(nightClawFrame(0,true)).toEqual(nightClawFrame(800,true));
});
test("first pack entrance shares the pause/speed/thinking clock and step navigation and seeking include it",async()=>{
  const events=await werewolfResultsFixture("saved","motion");
  const moment=projectWerewolfWatch(events,"omniscient",1,64).moments.find(m=>m.transformWolfIds)!;
  const enriched={...moment,wolfForms:Object.fromEntries(moment.transformWolfIds!.map(id=>[id,`/form/${id}`]))};
  const [cue]=werewolfMomentCues(enriched);
  const plain=werewolfMomentCues(moment)[0]!;
  expect(plain.transformation).toBeUndefined();
  const partial=werewolfMomentCues({...moment,wolfForms:{[moment.transformWolfIds![0]!]:"/one-form"}})[0]!;
  expect(partial.transformation?.wolfIds).toEqual(moment.transformWolfIds);
  expect(cue!.baseDurationMs-plain.baseDurationMs).toBe(WOLF_TRANSFORM_MS+WOLF_STAGGER_MS);
  const clock=new Clock(), director=new PresentationDirector({clock,policy:werewolfWatchPolicy});
  director.load([cue!]);director.play();clock.tick(700);
  const frame=wolfTransformationFrame(director.getElapsedBaseMs(),0,false);
  director.pause();clock.tick(9000);expect(wolfTransformationFrame(director.getElapsedBaseMs(),0,false)).toEqual(frame);
  director.setSpeed(2);director.play();clock.tick(200);expect(director.getElapsedBaseMs()).toBe(1100);
  director.setThinking(cue!.key,"A private thought.");
  expect(director.getThinkingFrame()).toBeNull();
  director.pause();director.seek(0);
  expect(director.getElapsedBaseMs()).toBe(0);
  expect(director.getSnapshot().isPlaying).toBe(false);
  director.setThinking(cue!.key,null);director.seek(0);
  expect(director.getElapsedBaseMs()).toBe(werewolfWatchPolicy.scrubAtMs!(cue!));
  director.load([{...plain,key:"before"},cue!,{...plain,key:"after"}]);
  director.seek(0);director.seek(1);
  expect(director.getActiveCue()?.key).toBe(cue!.key);
  expect(director.getElapsedBaseMs()).toBe(0);
  expect(director.getSnapshot().isPlaying).toBe(false);
  director.seek(2);director.seek(1);
  expect(director.getElapsedBaseMs()).toBe(0);
  director.play();clock.tick(300);
  expect(director.getElapsedBaseMs()).toBe(600);
  director.resetRound([cue!]);expect(director.getElapsedBaseMs()).toBe(0);
  director.dispose();
});

test("a surviving lone wolf transforms next night and scene navigation visits each night action",async()=>{
  const events=await werewolfResultsFixture("wolves","solo-night");
  const first=projectWerewolfWatch(events,"omniscient");
  const moments=Array.from({length:first.latestCursor},(_,i)=>projectWerewolfWatch(events,"omniscient",i+1,1).moments[0]!);
  const solo=moments.find(moment=>moment.night?.actions.some(action=>action.kind === "hunt" && action.wolfIds.length === 1))!;
  const hunt=solo.night!.actions.find(action=>action.kind === "hunt")!;
  expect(solo.entry.day).toBeGreaterThan(1);
  expect(solo.transformWolfIds).toEqual(hunt.wolfIds);
  const cues=werewolfMomentCues({...solo,wolfForms:{[hunt.wolfIds[0]!]:"/published-solo-form"}});
  expect(cues.find(cue=>cue.nightAction?.kind === "hunt")!.transformation?.wolfIds).toEqual(hunt.wolfIds);
  expect(cues.filter(cue=>cue.transformation)).toHaveLength(1);
  const stops=first.navigation.filter(stop=>stop.cursor===solo.cursor);
  expect(stops.map(stop=>stop.step)).toEqual(cues.map((_,i)=>i));
  let position={cursor:solo.cursor-1,step:0};
  for(const stop of stops){position=adjacentWerewolfPosition(first.navigation,position.cursor,1,"scene",position.step);expect(position).toEqual({cursor:stop.cursor,step:stop.step});}
  for(const stop of stops.slice(0,-1).reverse()){position=adjacentWerewolfPosition(first.navigation,position.cursor,-1,"scene",position.step);expect(position).toEqual({cursor:stop.cursor,step:stop.step});}
  const mystery=projectWerewolfWatch(events,"mystery");
  expect(mystery.navigation.every(stop=>stop.step===0)).toBe(true);
  expect(JSON.stringify(mystery.navigation)).not.toContain("Hunt");
});
