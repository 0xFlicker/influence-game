import { afterEach, beforeEach, expect, test } from "bun:test";
import React, { act } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window } from "happy-dom";
import { AgentVisualUpdateControl } from "../app/seasons/agent-visual-update";
import { setApiBase, type AgentVisualUpdate, type SavedAgent } from "../lib/api";
const originalFetch=globalThis.fetch;
const previous={localStorage:globalThis.localStorage,window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator};
let dom:Window,posts:number,reads:number,state:AgentVisualUpdate;
const agent:SavedAgent={id:"owned",name:"Fixture",personality:"Patient",backstory:null,strategyStyle:null,personaKey:"strategic",avatarUrl:null,gamesPlayed:0,gamesWon:0,createdAt:"2026",updatedAt:"2026"};
const job=(status:NonNullable<AgentVisualUpdate["job"]>["status"]):AgentVisualUpdate=>({needsUpdate:status!=="completed",job:{id:"job",status,stage:"body",updatedAt:"2026",errorCode:null,message:null}});
beforeEach(()=>{
 dom=new Window({url:"http://localhost:3001/seasons"});for(const [key,value] of Object.entries({window:dom,document:dom.document,localStorage:dom.localStorage,navigator:dom.navigator}))Object.defineProperty(globalThis,key,{configurable:true,value});
 setApiBase("http://localhost:3999");posts=0;reads=0;state={needsUpdate:true,job:null};
 globalThis.fetch=Object.assign(async(_input:unknown,init?:RequestInit)=>{if(init?.method==="POST"){posts++;state=job("processing");}else reads++;return Response.json(state);},{preconnect:originalFetch.preconnect});
});
afterEach(async()=>{await act(async()=>{cleanup();await new Promise(resolve=>setTimeout(resolve,0));});globalThis.fetch=originalFetch;setApiBase("");for(const [key,value] of Object.entries(previous))Object.defineProperty(globalThis,key,{configurable:true,value});dom.close();});
test("mount never submits; explicit Update starts one job with truthful stage",async()=>{
 const view=render(<AgentVisualUpdateControl agent={agent} onComplete={()=>{}}/>);
 await waitFor(()=>expect(view.getByRole("button",{name:"Update"}).hasAttribute("disabled")).toBe(false));expect(posts).toBe(0);
 fireEvent.click(view.getByRole("button",{name:"Update"}));
 await waitFor(()=>expect(view.getByRole("status").textContent).toContain("Creating full-body image"));expect(posts).toBe(1);expect(reads).toBeGreaterThan(0);
});
test("refresh reconnects without resubmitting and completes once",async()=>{
 state=job("processing");let completed=0;
 const view=render(<AgentVisualUpdateControl agent={agent} onComplete={()=>{completed++;}}/>);
 await waitFor(()=>expect(view.getByRole("status").textContent).toContain("Creating full-body image"));expect(posts).toBe(0);
 state=job("completed");dom.dispatchEvent(new dom.Event("online"));
 await waitFor(()=>expect(view.getByRole("link",{name:"Edit agent"})).toBeTruthy());expect(completed).toBe(1);
 dom.dispatchEvent(new dom.Event("online"));await waitFor(()=>expect(reads).toBeGreaterThan(2));expect(completed).toBe(1);expect(posts).toBe(0);
});
test("failed work requires explicit retry; held work cannot restart",async()=>{
 state=job("failed");const view=render(<AgentVisualUpdateControl agent={agent} onComplete={()=>{}}/>);
 await waitFor(()=>expect(view.getByRole("button",{name:"Retry update"})).toBeTruthy());expect(posts).toBe(0);
 fireEvent.click(view.getByRole("button",{name:"Retry update"}));await waitFor(()=>expect(posts).toBe(1));
 view.unmount();state=job("held");const held=render(<AgentVisualUpdateControl agent={agent} onComplete={()=>{}}/>);
 await waitFor(()=>expect(held.getByRole("status").textContent).toContain("awaiting review"));expect(held.queryByRole("button")).toBeNull();expect(posts).toBe(1);
});
test("start failures stay visible after status recovery",async()=>{
 globalThis.fetch=Object.assign(async(_input:unknown,init?:RequestInit)=>init?.method==="POST"?Response.json({error:"Generation unavailable"},{status:503}):Response.json(state),{preconnect:originalFetch.preconnect});
 const view=render(<AgentVisualUpdateControl agent={agent} onComplete={()=>{}}/>);
 await waitFor(()=>expect(view.getByRole("button").hasAttribute("disabled")).toBe(false));fireEvent.click(view.getByRole("button"));
 await waitFor(()=>expect(view.getByRole("alert").textContent).toBe("Generation unavailable"));
});
