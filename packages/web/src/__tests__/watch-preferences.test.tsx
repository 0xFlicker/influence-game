import {afterEach,beforeEach,expect,test,spyOn} from "bun:test";
import {act,cleanup,renderHook} from "@testing-library/react";
import {Window} from "happy-dom";
import {useWatchPreferences,watchPreferenceKey} from "../components/watch/use-watch-preferences";
import {musicVolumeFromSlider, musicVolumeToSlider} from "../components/watch/music-volume";
const keys=["window","document","navigator","HTMLElement","Element","Node","Event"] as const;
const original=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
let dom:Window;
beforeEach(()=>{dom=new Window({url:"http://localhost"});for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,value:key==="window"?dom:dom[key]});});
afterEach(()=>{cleanup();dom.close();for(const key of keys){const descriptor=original.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});
test("game viewers share the saved thinking choice across mounts while production is separate",()=>{
 const first=renderHook(()=>useWatchPreferences());
 const second=renderHook(()=>useWatchPreferences());
 const production=renderHook(()=>useWatchPreferences("production"));
 expect(first.result.current.ready).toBe(true);
 act(()=>{first.result.current.setThinking(true);});
 expect(second.result.current).toMatchObject({thinking:true});
 expect(production.result.current).toMatchObject({thinking:false});
 act(()=>production.result.current.setThinking(true));
 first.unmount();second.unmount();production.unmount();
 expect(renderHook(()=>useWatchPreferences()).result.current).toMatchObject({ready:true,thinking:true});
 expect(renderHook(()=>useWatchPreferences("production")).result.current).toMatchObject({ready:true,thinking:true});
});
for(const value of ["broken",'{}'])test(`invalid preference safely resets: ${value}`,()=>{
 dom.localStorage.setItem(watchPreferenceKey("viewer"),value);
 expect(renderHook(()=>useWatchPreferences()).result.current).toMatchObject({ready:true,thinking:false});
});
test("unavailable controls do not reset preferences, and other-tab updates are reflected",()=>{
 const saved=JSON.stringify({thinking:true});dom.localStorage.setItem(watchPreferenceKey("viewer"),saved);
 const view=renderHook(()=>useWatchPreferences());
 expect(dom.localStorage.getItem(watchPreferenceKey("viewer"))).toBe(saved);
 act(()=>{dom.localStorage.setItem(watchPreferenceKey("viewer"),JSON.stringify({thinking:false}));dom.dispatchEvent(new dom.StorageEvent("storage",{key:watchPreferenceKey("viewer")}));});
 expect(view.result.current).toMatchObject({thinking:false});
});
test("blocked storage keeps thinking usable for the session",()=>{
 Object.defineProperty(dom,"localStorage",{configurable:true,get(){throw new Error("blocked");}});
 const warn=spyOn(console,"warn").mockImplementation(()=>{});
 try {
  const view=renderHook(()=>useWatchPreferences());
  act(()=>{view.result.current.setThinking(true);});
  expect(view.result.current).toMatchObject({ready:true,thinking:true});
  expect(warn).toHaveBeenCalled();
 } finally {warn.mockRestore();}
});

test("music preferences preserve independent valid fields and synchronize scopes",()=>{
 dom.localStorage.setItem(watchPreferenceKey("viewer"),JSON.stringify({thinking:true,musicMuted:"false",musicVolume:12}));
 const first=renderHook(()=>useWatchPreferences()), second=renderHook(()=>useWatchPreferences()), production=renderHook(()=>useWatchPreferences("production"));
 expect(first.result.current).toMatchObject({thinking:true,musicMuted:false,musicVolume:1});
 act(()=>{first.result.current.setMusicMuted(false);first.result.current.setMusicVolume(0.42);});
 expect(second.result.current).toMatchObject({musicMuted:false,musicVolume:0.42});
 expect(production.result.current).toMatchObject({musicMuted:false,musicVolume:musicVolumeFromSlider(50)});
 first.unmount();
 expect(renderHook(()=>useWatchPreferences()).result.current).toMatchObject({thinking:true,musicMuted:false,musicVolume:0.42});
});
test("thinking-only saved preferences keep their choices and default to enabled low-level music",()=>{
 dom.localStorage.setItem(watchPreferenceKey("viewer"),JSON.stringify({thinking:true}));
 expect(renderHook(()=>useWatchPreferences()).result.current).toMatchObject({thinking:true,musicMuted:false,musicVolume:musicVolumeFromSlider(50)});
});

test("new browsers enable music at the midpoint of the audio taper",()=>{
 const view=renderHook(()=>useWatchPreferences());
 expect(view.result.current.musicMuted).toBe(false);
 expect(musicVolumeToSlider(view.result.current.musicVolume)).toBeCloseTo(50);
 expect(view.result.current.musicVolume).toBeLessThan(.04);
});
test("the music taper spreads low gains across the slider and preserves saved levels",()=>{
 expect(musicVolumeFromSlider(0)).toBe(0);
 expect(musicVolumeFromSlider(100)).toBeCloseTo(1);
 expect(musicVolumeFromSlider(90)).toBeLessThan(.51);
 expect(musicVolumeToSlider(.03)).toBeGreaterThan(49);
 dom.localStorage.setItem(watchPreferenceKey("viewer"),JSON.stringify({musicMuted:true,musicVolume:.03}));
 const view=renderHook(()=>useWatchPreferences());
 expect(view.result.current).toMatchObject({musicMuted:true,musicVolume:.03});
 expect(musicVolumeFromSlider(musicVolumeToSlider(.03))).toBeCloseTo(.03,8);
});
