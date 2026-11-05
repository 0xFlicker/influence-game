import { afterEach, beforeEach, expect, test } from "bun:test";
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Window } from "happy-dom";
import { SeasonAgentPreview } from "../app/seasons/season-agent-preview";
import { enrollCreatedSeasonAgent, pinSeasonCreationTarget } from "../app/dashboard/agents/season-creation-target";
import { setApiBase, type SavedAgent } from "../lib/api";

const originalFetch = globalThis.fetch;
const previous = {localStorage:globalThis.localStorage,window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator};
let dom:Window;
beforeEach(()=>{dom=new Window({url:"http://localhost:3001/seasons"});Object.defineProperty(globalThis,"window",{configurable:true,value:dom});Object.defineProperty(globalThis,"localStorage",{configurable:true,value:dom.localStorage});Object.defineProperty(globalThis,"document",{configurable:true,value:dom.document});Object.defineProperty(globalThis,"navigator",{configurable:true,value:dom.navigator});});
afterEach(()=>{globalThis.fetch=originalFetch;setApiBase("");cleanup();for(const [key,value] of Object.entries(previous))Object.defineProperty(globalThis,key,{configurable:true,value});dom.close();});
const agent:SavedAgent={id:"selected",name:"Selected Agent",personality:"Patient",backstory:null,strategyStyle:null,personaKey:"strategic",avatarUrl:"/head.webp",fullBodyReferenceUrl:"/original.webp",transparentBodyUrl:"/body.webp",gamesPlayed:0,gamesWon:0,createdAt:"2026-01-01",updatedAt:"2026-01-01"};

test("selected character uses body, then headshot, then the existing persona portrait",()=>{
 const view=render(<SeasonAgentPreview agent={agent}/>);
 expect(view.getByRole("img").getAttribute("src")).toBe("/body.webp");
 fireEvent.error(view.getByRole("img"));expect(view.getByRole("img").getAttribute("src")).toBe("/head.webp");
 fireEvent.error(view.getByRole("img"));expect(view.getByRole("img").getAttribute("src")).toBe("/avatars/personas/strategic.png");
 fireEvent.error(view.getByRole("img"));expect(view.getByRole("img").textContent).toBe("S");
 expect(view.queryByText("?")).toBeNull();
});
test("question mark belongs only to the no-agent state",()=>{
 const view=render(<SeasonAgentPreview/>);expect(view.getByRole("img").textContent).toBe("?");
 view.rerender(<SeasonAgentPreview agent={{...agent,avatarUrl:null,fullBodyReferenceUrl:null,transparentBodyUrl:null}}/>);
 expect(view.getByRole("img").getAttribute("src")).toBe("/avatars/personas/strategic.png");
});
test("selection changes immediately and failed URLs do not suppress a different character",()=>{
 const view=render(<SeasonAgentPreview agent={agent}/>);fireEvent.error(view.getByRole("img"));
 view.rerender(<SeasonAgentPreview agent={{...agent,id:"other",name:"Other Agent",transparentBodyUrl:"/other.webp"}}/>);
 expect(view.getByRole("img",{name:"Other Agent"}).getAttribute("src")).toBe("/other.webp");
});
test("season creation target survives a reload/retry and rejects a different season",()=>{
 expect(pinSeasonCreationTarget("request-1","s0")).toBe("s0");
 expect(pinSeasonCreationTarget("request-1","s0")).toBe("s0");
 expect(()=>pinSeasonCreationTarget("request-1","s1")).toThrow("different season");
 expect(pinSeasonCreationTarget("request-2","s1")).toBe("s1");
});
test("unavailable continuation storage stops before agent creation",()=>{
 Object.defineProperty(dom,"sessionStorage",{configurable:true,get(){throw new Error("blocked");}});
 expect(()=>pinSeasonCreationTarget("request","s0")).toThrow("recovery is unavailable");
});

test("saved agent entry keeps its original season through response loss and a duplicate retry", async()=>{
  setApiBase("http://localhost:3999");
  const requests: unknown[]=[];
  let attempt=0;
  globalThis.fetch=(async(_input,init)=>{
    requests.push(JSON.parse(String(init?.body)));
    if(attempt++===0)throw new TypeError("Response lost");
    return Response.json({});
  }) as typeof fetch;
  const target=pinSeasonCreationTarget("save-1","original-season");
  await expect(enrollCreatedSeasonAgent(agent,target)).rejects.toThrow("was saved, but could not join");
  await enrollCreatedSeasonAgent(agent,pinSeasonCreationTarget("save-1","original-season"));
  expect(requests).toEqual([{agentProfileId:"selected",expectedSeasonId:"original-season"},{agentProfileId:"selected",expectedSeasonId:"original-season"}]);
});
test("closed season error keeps the saved agent and never retries a different season", async()=>{
  setApiBase("http://localhost:3999");let calls=0;
  globalThis.fetch=Object.assign(async()=>{calls++;return Response.json({error:"Season is no longer accepting entries",code:"season_changed"},{status:409});},{preconnect:originalFetch.preconnect});
  await expect(enrollCreatedSeasonAgent(agent,"closed-season")).rejects.toThrow("Selected Agent was saved, but could not join the season. Season is no longer accepting entries");
  expect(calls).toBe(1);
});

test("an original body is never substituted for missing transparent art",()=>{
 const view=render(<SeasonAgentPreview agent={{...agent,transparentBodyUrl:null}}/>);
 expect(view.getByRole("img").getAttribute("src")).toBe("/head.webp");
});
