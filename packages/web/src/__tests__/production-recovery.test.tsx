import { InfluenceAuthContext, type InfluenceAuthState } from "../hooks/use-auth";
import { adminTestWrapper } from "./admin-test-wrapper";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render as baseRender, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import {GameProductionRecovery,ReconcileAttempt,useMissingProductionScene,type ProductionRecovery} from "../app/admin/production-recovery-tools";
import {useState} from "react";
import { setApiBase } from "../lib/api";
import { VisualOperations } from "../app/admin/games/[id]/visual/visual-operations";
import {fileURLToPath} from "node:url";


const originalFetch = globalThis.fetch;
const globals = ["window", "document", "navigator", "localStorage", "HTMLElement", "Node", "Event"] as const;
const saved = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: HappyDOMWindow;
beforeEach(() => {
  dom = new HappyDOMWindow({ url: "http://localhost" });
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: dom[key] });
  setApiBase("");
});
afterEach(async () => {
  await act(async () => cleanup()); dom.close(); globalThis.fetch = originalFetch;
  for (const key of globals) { const descriptor = saved.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});

const recovery = ():ProductionRecovery=>({gameId:"game",status:"suspended",recovery:{pauseId:"pause",kind:"form",playerName:"Arden",reason:"Form failed",policy:"require_visuals"},formJob:null,unresolvedForm:false,nextOffset:null,attempts:[]});
function respond(handler:(url:string,init?:RequestInit)=>Promise<Response>) {globalThis.fetch=Object.assign(handler,{preconnect:originalFetch.preconnect}) as typeof fetch;}
function render(ui:React.ReactNode) {return baseRender(ui,{wrapper:adminTestWrapper()});}
function MissingRequest() {
  const {operation,render}=useMissingProductionScene("game",async()=>{}),[error,setError]=useState("");
  return <><button onClick={()=>void render({key:"scene",previewHash:"hash"}).catch(cause=>setError(cause.message))}>Request</button><p>{operation?.phase}</p><p>{error}</p></>;
}

test("missing-scene exact request survives leaving its inspector and does not change identity after response loss",async()=>{
  const bodies:string[]=[];
  respond(async(_url,init)=>{bodies.push(String(init?.body));if(bodies.length===1)throw Error("Receipt lost");return Response.json({accepted:true});});
  const view=render(<MissingRequest/>);fireEvent.click(view.getByText("Request"));
  await waitFor(()=>expect(view.getByText("unknown")).not.toBeNull());
  view.rerender(<p>Another game</p>);view.rerender(<MissingRequest/>);
  expect(view.getByText("unknown")).not.toBeNull();fireEvent.click(view.getByText("Request"));
  await waitFor(()=>expect(view.getByText("accepted")).not.toBeNull());expect(bodies).toHaveLength(2);expect(bodies[1]).toBe(bodies[0]);
});

test("form recovery checks the exact saved job and permits an explicit retry only after reconciliation",async()=>{
  const data=recovery();data.unresolvedForm=true;data.formJob={id:"old-job",status:"needs_reconciliation",step:"verify",failure:null};
  let posts=0;
  respond(async(_url,init)=>{if(init?.method==="POST"){posts++;return Response.json({accepted:true});}return Response.json(data);});
  const auth={ready:true,authenticated:false,account:null,hydrationError:false} as InfluenceAuthState;
  const view=render(<InfluenceAuthContext.Provider value={auth}><GameProductionRecovery gameId="game"/></InfluenceAuthContext.Provider>);
  await waitFor(()=>expect((view.getByText("Repair wolf form") as HTMLButtonElement).disabled).toBe(true));expect(posts).toBe(0);
  data.unresolvedForm=false;fireEvent.click(view.getByText("Refresh recovery"));
  await waitFor(()=>expect((view.getByText("Repair wolf form") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(view.getByText("Repair wolf form"));await waitFor(()=>expect(posts).toBe(1));
});

test("an older form job cannot falsely confirm a lost new repair request",async()=>{
  const data=recovery();data.formJob={id:"older-job",status:"failed",step:"failed",failure:"Fixture"};const sent:string[]=[];
  respond(async(_url,init)=>{if(init?.method==="POST"){sent.push(String(init.body));throw Error("Receipt lost");}return Response.json(data);});
  const auth={ready:true,authenticated:false,account:null,hydrationError:false} as InfluenceAuthState;
  const view=render(<InfluenceAuthContext.Provider value={auth}><GameProductionRecovery gameId="game"/></InfluenceAuthContext.Provider>);
  await waitFor(()=>expect(view.getByText("Repair wolf form")).not.toBeNull());fireEvent.click(view.getByText("Repair wolf form"));
  await waitFor(()=>expect(view.getByText("Check saved request")).not.toBeNull());fireEvent.click(view.getByText("Check saved request"));
  await waitFor(()=>expect(sent).toHaveLength(2));expect(sent[1]).toBe(sent[0]);expect((view.getByText("Repair wolf form") as HTMLButtonElement).disabled).toBe(true);
});

test("unknown reconciliation retains its draft across navigation and reads the receipt before a new POST",async()=>{
  let status:"needs_reconciliation"|"reconciled"="needs_reconciliation",posts=0;
  respond(async(_url,init)=>{if(init?.method==="POST"){posts++;throw Error("Receipt lost");}return Response.json({...recovery(),attempts:[{id:"attempt",operationKey:"wolf-form:fixture",status,provider:"fixture",model:"fixture",costMicrousd:null}]});});
  const ui=<ReconcileAttempt gameId="game" attemptId="attempt" refresh={async()=>{}}/>;
  const view=render(ui);fireEvent.input(view.getByLabelText("Reconciliation evidence"),{target:{value:"Provider confirmed no charge"}});fireEvent.input(view.getByLabelText("Confirmed cost in dollars"),{target:{value:"0"}});fireEvent.submit(view.getByText("Record reconciliation").closest("form")!);
  await waitFor(()=>expect(view.getByText("Check reconciliation receipt")).not.toBeNull());view.rerender(<p>Another page</p>);view.rerender(ui);
  expect((view.getByLabelText("Reconciliation evidence") as HTMLInputElement).value).toBe("Provider confirmed no charge");expect((view.getByText("Record reconciliation") as HTMLButtonElement).disabled).toBe(true);
  status="reconciled";fireEvent.click(view.getByText("Check reconciliation receipt"));await waitFor(()=>expect(view.queryByText("Check reconciliation receipt")).toBeNull());expect(posts).toBe(1);
});

test("a lost Influence resume response is confirmed when the worker already completed the game",async()=>{
  // Other admin suites mock permissions globally; this assertion needs the actual auth context.
  if(process.env.HOUSE_INFLUENCE_RESUME_TEST!=="1") {
    const child=Bun.spawn([process.execPath,"test",fileURLToPath(import.meta.url),"--test-name-pattern","a lost Influence resume response"],{
      env:{...process.env,HOUSE_INFLUENCE_RESUME_TEST:"1"},stdout:"pipe",stderr:"pipe",
    });
    const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    expect({code,errors:code ? stdout+stderr : ""}).toEqual({code:0,errors:""});return;
  }
  const data={gameId:"game",gameStatus:"suspended",policy:"best_effort",pause:{reason:"Scene failed",boundarySequence:12} as {reason:string;boundarySequence:number}|null,
    media:{versions:[],jobs:[],publications:[],requests:[]},assets:{status:"ready",failure:null},rebuildPreview:null,rebuildError:null,contextFailures:[],scenes:[],metrics:[],events:[],
    accounting:{knownCostMicrousd:0,unpricedAttempts:0,uncertainAttempts:0,attempts:[]}};
  let posts=0;
  respond(async(_url,init)=>{if(init?.method==="POST"){posts++;expect(JSON.parse(String(init.body))).toEqual({action:"resume"});data.gameStatus="completed";data.pause=null;throw Error("Resume response lost");}return Response.json(data);});
  const auth:InfluenceAuthState={ready:true,authenticated:true,account:{id:"operator",publicId:"public-operator",handle:"operator",displayName:"Operator",walletAddress:null,email:null,isAdmin:false,
    roles:[],permissions:["view_admin","start_game"],publicIdentityOnboarding:{state:"complete",diagnosticCode:null},loginMethods:{privy:false,emailPassword:false},
    legal:{termsVersion:"fixture",privacyVersion:"fixture",accepted:true,acceptedAt:null}},hydrationError:false,
    openSignIn(){},openCreateAccount(){},openPrivySignIn(){},resetPrivyIdentity:async()=>{},requestPrivyProof:async()=>null,
    beginAuthenticationAttempt(){throw Error("Authentication is outside this recovery fixture");},isAuthenticationAttemptCurrent:()=>false,cancelAuthenticationAttempt(){},
    completeAuthenticationAttempt:async()=>false,runFarcasterMiniAppLogin:async()=>"failed",logout:async()=>{},needsInvite:false,dismissInvite(){},
    submitInvite:async()=>{},inviteError:null,submittingInvite:false};
  const view=render(<InfluenceAuthContext.Provider value={auth}><VisualOperations gameId="game"/></InfluenceAuthContext.Provider>);
  await waitFor(()=>expect(view.getByText("Resume game")).toBeTruthy());fireEvent.click(view.getByText("Resume game"));
  await waitFor(()=>expect(view.getByText("Check saved recovery request")).toBeTruthy());
  fireEvent.click(view.getByText("Check saved recovery request"));
  await waitFor(()=>expect(view.queryByText("Check saved recovery request")).toBeNull());
  expect(view.queryByText("No saved change is recorded. Review the current recovery state before trying again.")).toBeNull();
  expect(view.getByText("Game: completed · Assets: ready")).toBeTruthy();expect(posts).toBe(1);
},15_000);
