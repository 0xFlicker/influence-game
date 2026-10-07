import {expect,test} from "bun:test";
import {PresentationDirector,type PresentationClock,type WatchPolicy} from "../components/watch/watch-director";
interface Cue {key:string;baseDurationMs:number;cursor:number}
const policy:WatchPolicy<Cue>={position:cue=>cue.cursor,speech:()=>null,isCatchUp:()=>false,acceptAtWatermark:()=>false,reconcile:cues=>cues};
class Clock implements PresentationClock {
 time=0; id=0; timers=new Map<number,{at:number;callback:()=>void}>(); now(){return this.time;}
 setTimeout(callback:()=>void,delay:number){const id=++this.id;this.timers.set(id,{at:this.time+delay,callback});return id;}
 clearTimeout(id:number){this.timers.delete(id);}
 tick(ms:number){this.time+=ms;for(const [id,timer] of this.timers){if(timer.at<=this.time){this.timers.delete(id);timer.callback();}}}
}
test("media readiness pauses the existing clock and ignores callbacks from a disposed cue",()=>{
 const clock=new Clock(),director=new PresentationDirector({clock,policy,followTail:true});
 director.load([{key:"one",cursor:2,baseDurationMs:1000},{key:"two",cursor:5,baseDurationMs:1000}]);director.setReady("one",false);director.play();clock.tick(5000);expect(director.getSnapshot().activeKey).toBe("one");
 director.setReady("one",true);clock.tick(1000);expect(director.getSnapshot().activeKey).toBe("two");director.setReady("two",false);director.setReady("one",true);clock.tick(5000);expect(director.getSnapshot().waitingAtTail).toBe(false);
 director.setReady("two",true);clock.tick(1000);expect(director.getSnapshot().waitingAtTail).toBe(true);
});
test("append while paused at a tail cannot move the active source position",()=>{
 const clock=new Clock(),director=new PresentationDirector({clock,policy,followTail:true});const first={key:"one",cursor:4,baseDurationMs:1000};
 director.load([first]);director.play();clock.tick(1000);director.pause();director.append([first,{key:"two",cursor:9,baseDurationMs:1000}]);
 expect(director.getSnapshot().position).toBe(4);expect(director.getSnapshot().isPlaying).toBe(false);director.play();expect(director.getSnapshot().position).toBe(9);
});
const speechPolicy: WatchPolicy<Cue> = {...policy, speech: () => ({showAtMs: 500, readAtMs: 800, hideAtMs: 3500, hiddenAtMs: 3800})};
test("thinking first and speech first share the clock, preserve content time and ignore stale actors", () => {
 for (const order of ["thinking-first", "speech-first"] as const) {
  const clock = new Clock(), director = new PresentationDirector({clock, policy:speechPolicy, followTail:true});
  director.load([{key:"one",cursor:1,baseDurationMs:4000},{key:"two",cursor:2,baseDurationMs:4000}]);
  director.setThinking("one", "A captured thought.", order);director.play();
  if(order === "speech-first") {clock.tick(3800);expect(director.getElapsedBaseMs()).toBe(3800);}
  else {expect(director.getThinkingFrame()).toBeNull();clock.tick(500);expect(director.getElapsedBaseMs()).toBe(500);}
  expect(director.getThinkingFrame()?.text).toBe("A captured thought.");
  const content = director.getElapsedBaseMs();clock.tick(1400);expect(director.getElapsedBaseMs()).toBe(content);
  director.pause();clock.tick(5000);expect(director.getElapsedBaseMs()).toBe(content);
  director.play();clock.tick(1400);clock.tick(4000);
  expect(director.getSnapshot().activeKey).toBe("two");expect(director.getThinkingFrame()).toBeNull();
  director.setThinking("one","Stale thought",order);expect(director.getThinkingFrame()).toBeNull();
 }
});
test("speech fade and reading clocks separate during a paused manual dismissal", () => {
 const clock=new Clock(),director=new PresentationDirector({clock,policy:speechPolicy,followTail:true});
 director.load([{key:"one",cursor:1,baseDurationMs:4000},{key:"two",cursor:2,baseDurationMs:4000}]);
 director.manualAdvance();clock.tick(300);director.manualAdvance();clock.tick(300);
 expect(director.getElapsedBaseMs()).toBe(3800);expect(director.getSpeechElapsedBaseMs()).toBe(800);
 director.manualAdvance();clock.tick(200);clock.tick(800);expect(director.getSnapshot().activeKey).toBe("two");
 expect(director.getElapsedBaseMs()).toBe(800);
 director.manualAdvance();clock.tick(300);director.manualAdvance();clock.tick(200);
 expect(director.getSnapshot().activeKey).toBe("two");
});

test("missing thinking releases the clock and wakes paused render samplers", () => {
 const clock = new Clock(), director = new PresentationDirector({clock, policy:speechPolicy});
 director.load([{key:"one",cursor:1,baseDurationMs:4000}]);director.play();
 let notifications = 0;director.subscribe(() => notifications++);
 director.setThinkingPending("one",true);clock.tick(2000);expect(director.getElapsedBaseMs()).toBe(0);
 const pendingNotifications = notifications;
 director.setThinking("one",null,"thinking-first");expect(notifications).toBeGreaterThan(pendingNotifications);
 clock.tick(1000);expect(director.getElapsedBaseMs()).toBe(1000);
});

test("manual speech-first advance shows thinking before dismissing speech", () => {
 const clock=new Clock(),director=new PresentationDirector({clock,policy:speechPolicy});
 director.load([{key:"one",cursor:1,baseDurationMs:4000}]);director.setThinking("one","A captured thought.","speech-first");
 director.manualAdvance();clock.tick(300);expect(director.getThinkingFrame()).toBeNull();
 director.manualAdvance();expect(director.getThinkingFrame()?.text).toBe("A captured thought.");
 expect(director.getElapsedBaseMs()).toBe(3800);
 director.manualAdvance();expect(director.getThinkingFrame()).toBeNull();
 director.seek(0);expect(director.getElapsedBaseMs()).toBe(0);
});

test("thinking-first stays through speech, freezes on pause, then shares its exit", () => {
 const clock=new Clock(),director=new PresentationDirector({clock,policy:speechPolicy});
 director.load([{key:"one",cursor:1,baseDurationMs:4000}]);director.setThinking("one","A captured thought.","thinking-first");director.play();
 clock.tick(500);expect(director.getThinkingFrame()?.opacity).toBe(1);
 clock.tick(2800);expect(director.getThinkingFrame()?.opacity).toBe(1);
 clock.tick(2300);expect(director.getThinkingFrame()?.text).toBe("A captured thought.");
 director.pause();clock.tick(10000);expect(director.getThinkingFrame()?.opacity).toBe(1);director.play();
 clock.tick(850);expect(director.getThinkingFrame()?.opacity).toBeCloseTo(.5);
 clock.tick(150);expect(director.getThinkingFrame()).toBeNull();
});

test("manual speech dismissal also fades and removes thinking", () => {
 const clock=new Clock(),director=new PresentationDirector({clock,policy:speechPolicy});
 director.load([{key:"one",cursor:1,baseDurationMs:4000}]);director.setThinking("one","A captured thought.","thinking-first");
 director.manualAdvance();director.manualAdvance();director.manualAdvance();clock.tick(300);
 expect(director.getThinkingFrame()?.opacity).toBe(1);
 director.manualAdvance();clock.tick(150);expect(director.getThinkingFrame()?.opacity).toBeCloseTo(.5);
 clock.tick(150);expect(director.getThinkingFrame()).toBeNull();
});


test("arrow steps and direct seeks land on the same readable ballot state, including the final tally", () => {
 const clock = new Clock();
 const director = new PresentationDirector({clock, policy: {...policy, scrubAtMs: cue => cue.key === "tally" ? 0 : 1250}});
 director.load([{key:"vote1",cursor:8,baseDurationMs:3200},{key:"vote2",cursor:8,baseDurationMs:3200},{key:"tally",cursor:8,baseDurationMs:3200}]);
 director.seek(0);expect(director.getElapsedBaseMs()).toBe(1250);
 director.manualAdvance();expect(director.getSnapshot().activeKey).toBe("vote2");expect(director.getElapsedBaseMs()).toBe(1250);
 director.seek(1);expect(director.getElapsedBaseMs()).toBe(1250);
 director.manualAdvance();expect(director.getSnapshot().activeKey).toBe("tally");expect(director.getElapsedBaseMs()).toBe(0);
 director.seek(2);expect(director.getElapsedBaseMs()).toBe(0);expect(director.getSnapshot().isPlaying).toBe(false);
 director.dispose();
});
