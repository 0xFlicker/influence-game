import {expect, test} from "bun:test";
import {sampleWatch} from "../components/watch/watch-sampling";

test("sampling sleeps when paused, coalesces mutations and wakes after buffering", () => {
 const originalRAF = globalThis.requestAnimationFrame, originalCancel = globalThis.cancelAnimationFrame;
 const frames = new Map<number, FrameRequestCallback>(), listeners = new Set<() => void>();
 let id = 0, animating = false, samples = 0;
 globalThis.requestAnimationFrame = callback => {frames.set(++id,callback);return id;};
 globalThis.cancelAnimationFrame = frame => {frames.delete(frame);};
 const tick = (now:number) => {const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback(now));};
 const notify = () => listeners.forEach(listener => listener());
 try {
   const stop = sampleWatch({isAnimating:()=>animating,subscribe:listener=>{listeners.add(listener);return ()=>{listeners.delete(listener);};}},()=>{samples++;});
   tick(0); expect(samples).toBe(1); expect(frames.size).toBe(0);
   notify(); notify(); animating=true; notify();
   expect(frames.size).toBe(1);
   tick(16); tick(32); expect(samples).toBe(2);
   tick(50); expect(samples).toBe(3);
   animating=false;notify();tick(60);expect(frames.size).toBe(0);
   animating=true;notify();tick(70);expect(frames.size).toBe(1);
   stop();expect(frames.size).toBe(0);expect(listeners.size).toBe(0);
 } finally {globalThis.requestAnimationFrame=originalRAF;globalThis.cancelAnimationFrame=originalCancel;}
});
