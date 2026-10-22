import {expect,test} from "bun:test";
import {PresentationDirector,type PresentationClock,type WatchPolicy} from "../components/watch/watch-director";
interface Cue {key:string;baseDurationMs:number;cursor:number;thinkingOnly?:true}
const policy:WatchPolicy<Cue>={position:cue=>cue.cursor,speech:()=>null,isCatchUp:()=>false,acceptAtWatermark:()=>false,reconcile:cues=>cues};
test("thought-only passes wait for saved text and advance immediately after camera return", () => {
 const clock = new Clock(), director = new PresentationDirector({clock, policy, followTail:true});
 director.load([{key:"pass",cursor:1,baseDurationMs:0,thinkingOnly:true},{key:"next",cursor:2,baseDurationMs:0,thinkingOnly:true}]);
 director.play(); clock.tick(5000); expect(director.getSnapshot().activeKey).toBe("pass");
 director.setThinking("pass","No new point.");
 clock.tick(1300); expect(director.getThinkingFrame()?.focus).toBe(1);
 clock.tick(2800); expect(director.getSnapshot().activeKey).toBe("pass");
 clock.tick(250); expect(director.getThinkingFrame()?.opacity).toBe(0);
 clock.tick(450); expect(director.getThinkingFrame()?.focus).toBeCloseTo(.5);
 clock.tick(450); expect(director.getSnapshot().activeKey).toBe("next");
 clock.tick(5000); expect(director.getSnapshot().waitingAtTail).toBe(false);
 director.setThinking("next",null); clock.tick(0); expect(director.getSnapshot().waitingAtTail).toBe(true);
});
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
test("thinking owns the clock, freezes on pause, and finishes before speech", () => {
 const clock = new Clock(), director = new PresentationDirector({clock, policy:speechPolicy, followTail:true});
 director.load([{key:"one",cursor:1,baseDurationMs:4000},{key:"two",cursor:2,baseDurationMs:4000}]);
 director.setThinking("one", "A captured thought.");director.play();
 expect(director.getThinkingFrame()).toBeNull();clock.tick(950);
 expect(director.getElapsedBaseMs()).toBe(500);
 const entering=director.getThinkingFrame()!;expect(entering.focus).toBeCloseTo(.5);expect(entering.opacity).toBe(0);
 director.pause();clock.tick(5000);expect(director.getThinkingFrame()).toEqual(entering);
 director.play();director.setSpeed(2);clock.tick(500);
 expect(director.getThinkingFrame()?.opacity).toBe(1);
 clock.tick(1900);expect(director.getThinkingFrame()).toBeNull();expect(director.getElapsedBaseMs()).toBe(500);
 clock.tick(1750);expect(director.getSnapshot().activeKey).toBe("two");
 director.setThinking("one","Stale thought");expect(director.getThinkingFrame()).toBeNull();
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
 director.setThinking("one",null);expect(notifications).toBeGreaterThan(pendingNotifications);
 clock.tick(1000);expect(director.getElapsedBaseMs()).toBe(1000);
});

test("manual thinking skips reading but preserves entrance and camera return", () => {
 const clock=new Clock(),director=new PresentationDirector({clock,policy:speechPolicy});
 director.load([{key:"one",cursor:1,baseDurationMs:4000}]);director.setThinking("one","A captured thought.");
 director.manualAdvance();clock.tick(1300);
 expect(director.getThinkingFrame()?.opacity).toBe(1);expect(director.getThinkingFrame()?.focus).toBe(1);
 director.manualAdvance();clock.tick(125);expect(director.getThinkingFrame()?.opacity).toBeCloseTo(.5);
 clock.tick(575);expect(director.getThinkingFrame()?.opacity).toBe(0);expect(director.getThinkingFrame()?.focus).toBeCloseTo(.5);
 clock.tick(450);expect(director.getThinkingFrame()).toBeNull();expect(director.getElapsedBaseMs()).toBe(500);
 director.manualAdvance();clock.tick(300);expect(director.getElapsedBaseMs()).toBe(800);
 director.seek(0,950);expect(director.getThinkingFrame()?.focus).toBeCloseTo(.5);
 director.seek(0,2000);director.seek(0,950);expect(director.getThinkingFrame()?.focus).toBeCloseTo(.5);
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

test("exact seeks preserve offsets, pause, speed, and cached thinking across cue changes", () => {
 const clock = new Clock(), director = new PresentationDirector({clock, policy:speechPolicy, followTail:true});
 const cues = [{key:"one",cursor:1,baseDurationMs:4000},{key:"two",cursor:2,baseDurationMs:4000}];
 director.load(cues); director.setThinking("one", "A thought.");
 director.seekTimeline(0, 2500);
 expect(director.getTimelineElapsedBaseMs()).toBe(2500);
 expect(director.getThinkingFrame()).not.toBeNull();
 director.seekTimeline(1, 1200); director.seekTimeline(0, 2500);
 expect(director.getThinkingFrame()).not.toBeNull();
 clock.tick(1000); expect(director.getTimelineElapsedBaseMs()).toBe(2500);
 director.play(); director.setSpeed(2); clock.tick(100);
 expect(director.getTimelineElapsedBaseMs()).toBe(2700);
 director.pause(); director.append([...cues,{key:"three",cursor:3,baseDurationMs:4000}]);
 expect(director.getTimelineElapsedBaseMs()).toBe(2700);
 expect(director.getSnapshot().isPlaying).toBe(false);
});

test("late thinking retains the source offset selected before its duration was known", () => {
 const director = new PresentationDirector({clock:new Clock(), policy:speechPolicy});
 director.load([{key:"one",cursor:1,baseDurationMs:4000}]);
 director.seekTimeline(0, 2000); director.setThinkingPending("one",true);
 director.setThinking("one", "A late thought.");
 expect(director.getElapsedBaseMs()).toBe(2000);
 expect(director.getTimelineElapsedBaseMs()).toBeGreaterThan(2000);
});

test("thinking preference changes retain the current speech position", () => {
 const director = new PresentationDirector({clock:new Clock(),policy:speechPolicy});
 director.setThinkingEnabled(false);
 director.load([{key:"one",cursor:1,baseDurationMs:4000}]);
 director.seekTimeline(0, 2000);
 director.setThinkingEnabled(true);
 director.setThinking("one", "A newly loaded thought.");
 expect(director.getElapsedBaseMs()).toBe(2000);
 director.setThinkingEnabled(false);
 expect(director.getTimelineElapsedBaseMs()).toBe(2000);
 director.setThinkingEnabled(true);
 expect(director.getElapsedBaseMs()).toBe(2000);
});

test("duration refreshes preserve local frame and pause instead of changing source position", () => {
 const director = new PresentationDirector({clock:new Clock(),policy});
 director.load([{key:"one",cursor:1,baseDurationMs:4000}]);
 director.seekTimeline(0, 1233.333333);
 director.load([{key:"one",cursor:1,baseDurationMs:6000}]);
 expect(director.getTimelineElapsedBaseMs()).toBeCloseTo(1233.333333);
 director.append([{key:"one",cursor:1,baseDurationMs:7000},{key:"two",cursor:2,baseDurationMs:4000}]);
 expect(director.getTimelineElapsedBaseMs()).toBeCloseTo(1233.333333);
 expect(director.getSnapshot().isPlaying).toBe(false);
});

test("shared offsets inside an unloaded thought wait and restore the exact thought time", () => {
 const clock = new Clock(), director = new PresentationDirector({clock,policy:speechPolicy});
 director.load([{key:"one",cursor:1,baseDurationMs:4000},{key:"two",cursor:2,baseDurationMs:4000}]);
 director.setSpeed(2);director.seekTimeline(0,5000,true);director.play();clock.tick(3000);
 expect(director.getSnapshot().activeKey).toBe("one");
 director.setThinking("one","A sufficiently long saved thought that takes more than five seconds to read carefully.");
 expect(director.getTimelineElapsedBaseMs()).toBe(5000);
 expect(director.getSnapshot().speed).toBe(2);
 director.seekTimeline(0,0);expect(director.getTimelineElapsedBaseMs()).toBe(0);
});
