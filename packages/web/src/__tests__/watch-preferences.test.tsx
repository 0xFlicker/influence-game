import {afterEach,beforeEach,expect,test,spyOn} from "bun:test";
import {act,cleanup,renderHook} from "@testing-library/react";
import {Window} from "happy-dom";
import {useWatchPreferences,watchPreferenceKey} from "../components/watch/use-watch-preferences";
const keys=["window","document","navigator","HTMLElement","Element","Node","Event"] as const;
const original=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
let dom:Window;
beforeEach(()=>{dom=new Window({url:"http://localhost"});for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,value:key==="window"?dom:dom[key]});});
afterEach(()=>{cleanup();dom.close();for(const key of keys){const descriptor=original.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});
test("game viewers share both saved choices across mounts while production is separate",()=>{
 const first=renderHook(()=>useWatchPreferences());
 const second=renderHook(()=>useWatchPreferences());
 const production=renderHook(()=>useWatchPreferences("production"));
 expect(first.result.current.ready).toBe(true);
 act(()=>{first.result.current.setThinking(true);first.result.current.setThinkingOrder("speech-first");});
 expect(second.result.current).toMatchObject({thinking:true,thinkingOrder:"speech-first"});
 expect(production.result.current).toMatchObject({thinking:false,thinkingOrder:"thinking-first"});
 act(()=>production.result.current.setThinking(true));
 first.unmount();second.unmount();production.unmount();
 expect(renderHook(()=>useWatchPreferences()).result.current).toMatchObject({ready:true,thinking:true,thinkingOrder:"speech-first"});
 expect(renderHook(()=>useWatchPreferences("production")).result.current).toMatchObject({ready:true,thinking:true,thinkingOrder:"thinking-first"});
});
for(const value of ["broken",'{}'])test(`invalid preference safely resets: ${value}`,()=>{
 dom.localStorage.setItem(watchPreferenceKey("viewer"),value);
 expect(renderHook(()=>useWatchPreferences()).result.current).toMatchObject({ready:true,thinking:false,thinkingOrder:"thinking-first"});
});
test("unavailable controls do not reset preferences, and other-tab updates are reflected",()=>{
 const saved=JSON.stringify({thinking:true,thinkingOrder:"speech-first"});dom.localStorage.setItem(watchPreferenceKey("viewer"),saved);
 const view=renderHook(()=>useWatchPreferences());
 expect(dom.localStorage.getItem(watchPreferenceKey("viewer"))).toBe(saved);
 act(()=>{dom.localStorage.setItem(watchPreferenceKey("viewer"),JSON.stringify({thinking:false,thinkingOrder:"thinking-first"}));dom.dispatchEvent(new dom.StorageEvent("storage",{key:watchPreferenceKey("viewer")}));});
 expect(view.result.current).toMatchObject({thinking:false,thinkingOrder:"thinking-first"});
});
test("blocked storage keeps both controls usable for the session",()=>{
 Object.defineProperty(dom,"localStorage",{configurable:true,get(){throw new Error("blocked");}});
 const warn=spyOn(console,"warn").mockImplementation(()=>{});
 try {
  const view=renderHook(()=>useWatchPreferences());
  act(()=>{view.result.current.setThinking(true);view.result.current.setThinkingOrder("speech-first");});
  expect(view.result.current).toMatchObject({ready:true,thinking:true,thinkingOrder:"speech-first"});
  expect(warn).toHaveBeenCalled();
 } finally {warn.mockRestore();}
});

test("music preferences preserve independent valid fields and synchronize scopes",()=>{
 dom.localStorage.setItem(watchPreferenceKey("viewer"),JSON.stringify({thinking:true,thinkingOrder:"unknown",musicMuted:"false",musicVolume:12}));
 const first=renderHook(()=>useWatchPreferences()), second=renderHook(()=>useWatchPreferences()), production=renderHook(()=>useWatchPreferences("production"));
 expect(first.result.current).toMatchObject({thinking:true,thinkingOrder:"thinking-first",musicMuted:true,musicVolume:1});
 act(()=>{first.result.current.setMusicMuted(false);first.result.current.setMusicVolume(0.42);});
 expect(second.result.current).toMatchObject({musicMuted:false,musicVolume:0.42});
 expect(production.result.current).toMatchObject({musicMuted:true,musicVolume:0.3});
 first.unmount();
 expect(renderHook(()=>useWatchPreferences()).result.current).toMatchObject({thinking:true,musicMuted:false,musicVolume:0.42});
});
test("thinking-only saved preferences keep their choices and default to silent music",()=>{
 dom.localStorage.setItem(watchPreferenceKey("viewer"),JSON.stringify({thinking:true,thinkingOrder:"speech-first"}));
 expect(renderHook(()=>useWatchPreferences()).result.current).toMatchObject({thinking:true,thinkingOrder:"speech-first",musicMuted:true,musicVolume:0.3});
});
