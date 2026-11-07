import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor, within, type RenderResult } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { PLAYER_VOICES } from "@influence/engine/voice-catalog";
import { AgentVoicePicker } from "../app/dashboard/agents/voice-audition-picker";
import { AgentForm, mergeAgentDraft, type EditorSnapshot } from "../app/dashboard/agents/agent-form";
import { InfluenceAuthContext, type InfluenceAuthState } from "../hooks/use-auth";
import { ApiError, type SavedAgent, type AgentProfileWriteParams } from "../lib/api";

const originalLocalStorage = globalThis.localStorage;
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalNavigator = globalThis.navigator;
const originalElement = globalThis.Element;
const originalHTMLElement = globalThis.HTMLElement;
const originalNode = globalThis.Node;
const originalEvent = globalThis.Event;
const originalInputEvent = globalThis.InputEvent;
const floatingGlobals = ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver"] as const;
const floatingDescriptors = new Map(floatingGlobals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const auth = { account: { id: "user-1" } } as InfluenceAuthState;
const draftScope = "review:agent-1:review-1";
const draftKey = `influence:agent-editor:4:user-1:${draftScope}`;
const proposal = "Coordinate one primary vote and one fallback.";
const draftStrategy = "Delay commitment and preserve three incompatible options.";

let domWindow: HappyDOMWindow;

beforeEach(() => {
  domWindow = new HappyDOMWindow({
    url: "http://localhost/dashboard/agents/agent-1/edit?sourceReviewId=review-1",
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: domWindow });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: domWindow.localStorage });
  Object.defineProperty(globalThis, "document", { configurable: true, value: domWindow.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: domWindow.navigator });
  Object.defineProperty(globalThis, "Element", { configurable: true, value: domWindow.Element });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: domWindow.HTMLElement });
  Object.defineProperty(globalThis, "Node", { configurable: true, value: domWindow.Node });
  Object.defineProperty(globalThis, "Event", { configurable: true, value: domWindow.Event });
  Object.defineProperty(globalThis, "InputEvent", { configurable: true, value: domWindow.InputEvent });
  for (const key of floatingGlobals) Object.defineProperty(globalThis, key, {
    configurable: true, value: key === "ResizeObserver" ? domWindow[key] : domWindow[key].bind(domWindow),
  });
  domWindow.sessionStorage.setItem(draftKey, JSON.stringify({
    version: 4,
    savedAt: "2026-08-28T20:00:00.000Z",
    creationRequestId: "11111111-1111-4111-8111-111111111111",
    base: snapshot(proposal),
    current: snapshot(draftStrategy),
  }));
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalLocalStorage });
  await act(async()=>{cleanup();await new Promise(resolve=>setTimeout(resolve,0));});
  domWindow.close();
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  Object.defineProperty(globalThis, "Element", { configurable: true, value: originalElement });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: originalHTMLElement });
  Object.defineProperty(globalThis, "Node", { configurable: true, value: originalNode });
  Object.defineProperty(globalThis, "Event", { configurable: true, value: originalEvent });
  Object.defineProperty(globalThis, "InputEvent", { configurable: true, value: originalInputEvent });
  for (const key of floatingGlobals) {
    const descriptor = floatingDescriptors.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

async function renderForm(requireChange: boolean, onSubmit: (params: AgentProfileWriteParams) => Promise<void> = async () => {}, emptyText = false, initialOverrides: Partial<SavedAgent> = {}, scope = draftScope, signedIn = false, imageRequest?: string): Promise<RenderResult> {
  const fetcher=globalThis.fetch;
  globalThis.fetch=Object.assign(async (input:RequestInfo|URL,init?:RequestInit) => String(input).endsWith("/voice")
    ? Response.json({assignment:{voiceId:"ara"},voices:[{id:"ara",name:"Ara",gender:"female"}]}) : fetcher(input,init),{preconnect:originalFetch.preconnect}) as typeof fetch;
  let mounted!: RenderResult;
  await act(async () => {
    mounted = render(
      <InfluenceAuthContext.Provider value={signedIn?{...auth,authenticated:true,ready:true}:auth}>
        <AgentForm
          initial={{ ...(emptyText ? { ...agent(), name: "", backstory: "", personality: "", strategyStyle: "" } : agent()), ...initialOverrides }}
          profileRequest={scope === "edit:agent-1"}
          strategyComparison={{
            baseline: "Stay flexible until the ballot.",
            initialWorking: emptyText ? "" : proposal,
            baselineLabel: "Review baseline",
            requireChange,
          }}
          draftScope={scope}
          imageRequest={imageRequest}
          onSubmit={onSubmit}
          onCancel={() => undefined}
          submitLabel="Save strategy update"
        />
      </InfluenceAuthContext.Provider>,
    );
    await Promise.resolve();
  });
  return mounted;
}

function snapshot(strategyStyle: string): EditorSnapshot {
  return {
    name: "Arden",
    backstory: "A careful negotiator.",
    personality: "Calm and precise.",
    strategyStyle,
    werewolfStrategyStyle: "",
    personaKey: "diplomat",
    gender: "non-binary",
    explicitAvatarUrl: "/avatars/arden.png",
    performanceInstructions: "",
    fullBodyReferenceUrl: null,
  };
}

function agent(): SavedAgent {
  return {
    id: "agent-1",
    name: "Arden",
    backstory: "A careful negotiator.",
    personality: "Calm and precise.",
    strategyStyle: "Stay flexible until the ballot.",
    personaKey: "diplomat",
    gender: "non-binary",
    avatarUrl: "/avatars/arden.png",
    gamesPlayed: 2,
    gamesWon: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
}


describe("agent workspace drafts",()=>{
 async function ready(onSubmit?: (params:AgentProfileWriteParams)=>Promise<void>,overrides:Partial<SavedAgent>={}){domWindow.sessionStorage.removeItem(draftKey);return renderForm(false,onSubmit,false,overrides);}
 async function save(view:RenderResult){fireEvent.click(view.getByRole("button",{name:"Review"}));await waitFor(()=>expect(view.getByRole("dialog",{name:"Review changes"})).toBeTruthy());fireEvent.click(within(view.getByRole("dialog",{name:"Review changes"})).getByRole("button",{name:"Save"}));}
 test("model selection stays in the draft and survives a failed submission with the same identity",async()=>{
  const submissions:AgentProfileWriteParams[]=[];
  const view=await ready(async params=>{submissions.push(params);if(submissions.length===1)throw new Error("Save failed");});
  const picker=view.getByRole("combobox",{name:"Preferred model"});fireEvent.focus(picker);fireEvent.input(picker,{target:{value:"DeepSeek"}});
  fireEvent.click(await view.findByRole("option",{name:/DeepSeek Flash/}));expect(submissions).toHaveLength(0);
  await save(view);await waitFor(()=>expect(view.getAllByText("Couldn’t save agent.").length).toBeGreaterThan(0));
  expect(submissions[0]?.modelPreference).toEqual({catalogId:"katana:deepseek-v4-flash"});
  fireEvent.click(within(view.getByRole("dialog",{name:"Review changes"})).getByRole("button",{name:"Save"}));await waitFor(()=>expect(submissions).toHaveLength(2));
  expect(submissions[1]?.submissionId).toBe(submissions[0]?.submissionId);
 });
 test("Guided and Advanced share fields and retain the selected image for text edits",async()=>{
  const view=await ready();{const input=view.getByLabelText("Personality");input.focus();fireEvent.input(input,{target:{value:"A careful skeptic."}});fireEvent.keyUp(input,{key:"."});}
  fireEvent.click(view.getByRole("button",{name:"Guided"}));fireEvent.click(view.getByRole("button",{name:"Advanced"}));
  expect((view.getByLabelText("Personality") as HTMLTextAreaElement).value).toBe("A careful skeptic.");
  expect(view.queryByText("Generating image")).toBeNull();expect(view.container.querySelector('img[src="/avatars/arden.png"]')).toBeTruthy();
 });
 test("review contains the real old and new text and can undo a field",async()=>{
  const view=await ready();{const input=view.getByLabelText("Personality");input.focus();fireEvent.input(input,{target:{value:"Decisive."}});fireEvent.keyUp(input,{key:"."});}fireEvent.click(view.getByRole("button",{name:"Review"}));
  const review=view.getByRole("dialog",{name:"Review changes"});expect(review.textContent).toContain("Calm and precise.");expect(review.textContent).toContain("Decisive.");
  fireEvent.click(within(review).getAllByRole("button",{name:"Undo"})[0]!);expect((view.container.querySelector("#agent-personality") as HTMLTextAreaElement).value).toBe("Calm and precise.");
 });
 test("a duplicate name returns to its field instead of suggesting stale-agent recovery",async()=>{
  const view=await ready(async()=>{throw new ApiError(409,"Taken","agent_name_taken");});
  const input=view.getByLabelText("Agent name");input.focus();fireEvent.input(input,{target:{value:"Existing agent"}});fireEvent.keyUp(input,{key:"t"});
  await save(view);
  await waitFor(()=>expect(view.getByText("This name is already in use.")).toBeTruthy());
  expect(view.queryByRole("dialog",{name:"Review changes"})).toBeNull();
  expect(view.queryByText("Agent changed. Reopen to compare.")).toBeNull();
  expect(view.getByLabelText("Agent name").getAttribute("aria-invalid")).toBe("true");
  input.focus();fireEvent.input(input,{target:{value:"A fresh name"}});fireEvent.keyUp(input,{key:"e"});
  expect(view.queryByText("This name is already in use.")).toBeNull();
 });
 test("a Guided gender edit updates related wording and missing notes while preserving identity and artwork",async()=>{
  const paths:string[]=[];
  globalThis.fetch=Object.assign(async(input:RequestInfo|URL)=>{
    const path=String(input);paths.push(path);
    if(path.includes("/generations")) return Response.json([]);
    if(path.endsWith("/creation-assistant")) return Response.json({command:"revise_character",reply:""});
    if(path.endsWith("/edit-assistant")) return Response.json({tool:"update_character",fields:["gender","backstory","visualDesign"],generateImages:false});
    if(path.endsWith("/generate")) return Response.json({name:"Unrequested rename",gender:"male",personaKey:"strategic",personality:"Unrequested personality",backstory:"He was a chef.",strategyStyle:"Unrequested Influence notes",werewolfStrategyStyle:"Compare claims before voting.",visualDesign:"He wears a bronze coat.",performanceInstructions:"Unrequested performance"});
    throw Error(`Unexpected request ${path}`);
  },{preconnect:originalFetch.preconnect}) as typeof fetch;
  const view=await ready(undefined,{backstory:"She was a chef.",visualDesign:"She wears a bronze coat.",performanceInstructions:"Original performance"});
  fireEvent.click(view.getByRole("button",{name:"Guided"}));
  fireEvent.input(view.getByLabelText("Message the character assistant"),{target:{value:"Make him male and keep the text consistent."}});
  fireEvent.click(view.getByRole("button",{name:"Send"}));
  await waitFor(()=>expect((view.getByRole("button",{name:"Send"}) as HTMLButtonElement).disabled).toBe(true));
  await waitFor(()=>expect((view.getByRole("radio",{name:"Male"}) as HTMLInputElement).checked).toBe(true));
  await waitFor(()=>expect(view.queryByRole("button",{name:"Assistant working"})).toBeNull());
  fireEvent.click(view.getByRole("button",{name:"Review"}));
  const review=view.getByRole("dialog",{name:"Review changes"});
  expect(Array.from(review.querySelectorAll("strong"),element=>element.textContent)).toEqual(["Gender","Backstory","Werewolf strategy","Appearance"]);
  expect(review.textContent).toContain("She was a chef.");
  expect(review.textContent).toContain("He was a chef.");
  expect(review.textContent).not.toContain("Unrequested");
  expect(view.container.querySelector('img[src="/avatars/arden.png"]')).toBeTruthy();
  expect(paths.some(path=>path.endsWith("/visual-reference"))).toBe(false);
 });
 test("restores a draft and offers both strategies without mixing their content",async()=>{
  const view=await renderForm(true);fireEvent.click(view.getByRole("button",{name:"Resume"}));fireEvent.click(view.getByRole("tab",{name:"Strategy"}));
  expect((view.getByLabelText("Influence strategy") as HTMLTextAreaElement).value).toBe(draftStrategy);
  expect((view.getByLabelText("Werewolf strategy") as HTMLTextAreaElement).value).toBe("");
  expect(view.queryByLabelText("Saved local draft")).toBeNull();
 });
 test("discard removes local recovery while a failed save preserves it",async()=>{
  const view=await ready(async()=>{throw new Error("Unavailable");});{const input=view.getByLabelText("Agent name");input.focus();fireEvent.input(input,{target:{value:"New Arden"}});fireEvent.keyUp(input,{key:"n"});}await save(view);
  await waitFor(()=>expect(view.getAllByText("Couldn’t save agent.").length).toBeGreaterThan(0));expect(domWindow.sessionStorage.getItem(draftKey)).not.toBeNull();
  fireEvent.click(view.getByRole("button",{name:"Cancel"}));fireEvent.click(view.getByRole("button",{name:"Discard"}));await waitFor(()=>expect(domWindow.sessionStorage.getItem(draftKey)).toBeNull());
 });
 test("voice auditions and selection are separate and do not submit the profile",async()=>{
  const submissions:AgentProfileWriteParams[]=[];const view=await ready(async params=>{submissions.push(params);});fireEvent.click(view.getByRole("button",{name:"Voice"}));
  expect(view.getAllByRole("button",{name:/Play /}).length).toBeGreaterThan(0);expect(view.getByRole("button",{name:"Altair Male"})).toBeTruthy();const option=view.getByRole("button",{name:"Ara Female"});fireEvent.click(option);expect(submissions).toHaveLength(0);expect(view.getByRole("button",{name:"Voice"}).textContent).toContain("Ara · Female");
  await save(view);await waitFor(()=>expect(submissions).toHaveLength(1));expect(submissions[0]?.voiceId).toBe("ara");
 });
 test("missing gender is validated before committing a submission",async()=>{
  const submissions:AgentProfileWriteParams[]=[];const view=await ready(async params=>{submissions.push(params);},{gender:null});
  expect((view.getByRole("button",{name:"Review"}) as HTMLButtonElement).disabled).toBe(true);
  expect(view.queryByRole("dialog",{name:"Review changes"})).toBeNull();expect(submissions).toHaveLength(0);
 });
 test("a new selected body requires exact head confirmation before review",async()=>{
  domWindow.sessionStorage.setItem(draftKey,JSON.stringify({version:4,savedAt:new Date().toISOString(),creationRequestId:"11111111-1111-4111-8111-111111111111",base:snapshot(proposal),current:{...snapshot(proposal),fullBodyReferenceUrl:"/new-body.webp",headSuggestion:{sourceUrl:"/new-body.webp",sourceHash:"a".repeat(64),sourceWidth:1024,sourceHeight:1536,rect:{x:.3,y:.05,width:.3,height:.2}}}}));
  const view=await renderForm(false);fireEvent.click(view.getByRole("button",{name:"Resume"}));expect((view.getByRole("button",{name:"Review"}) as HTMLButtonElement).disabled).toBe(true);
 });
});

test("draft rebase preserves independent remote edits and treats artwork as one decision", () => {
  const base = { ...snapshot("Base strategy"), fullBodyReferenceUrl: "/old.webp", explicitAvatarUrl: "/old-head.webp" };
  const local = { ...base, name: "Local name", fullBodyReferenceUrl: "/local.webp", explicitAvatarUrl: "/local-head.webp" };
  const remote = { ...base, strategyStyle: "Accepted remote strategy", fullBodyReferenceUrl: "/remote.webp", explicitAvatarUrl: "/remote-head.webp" };
  const result = mergeAgentDraft(base, local, remote);
  expect(result.merged.name).toBe("Local name");
  expect(result.merged.strategyStyle).toBe("Accepted remote strategy");
  expect(result.merged.fullBodyReferenceUrl).toBe("/local.webp");
  expect(result.merged.explicitAvatarUrl).toBe("/local-head.webp");
  expect(result.conflicts).toEqual(["images"]);
});

test("Revise sends an appearance edit and completes missing Werewolf notes", async () => {
  domWindow.sessionStorage.removeItem(draftKey);
  const generated = { ...agent(), gender:"non-binary", performanceInstructions:"Measured gestures.", visualDesign:"A green coat.", werewolfStrategyStyle:"Compare claims before voting.", introQuips:["One", "Two", "Three"] };
  const requests:Record<string,unknown>[]=[];
  globalThis.fetch=Object.assign(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const path=String(input);
    if(path.endsWith("/generations")) return Response.json([]);
    if(path.endsWith("/creation-assistant")) return Response.json({command:"revise_appearance",reply:""});
    if(path.endsWith("/generate")){requests.push(JSON.parse(String(init?.body)));return Response.json(generated);}
    if(path.includes("/visual-references/")) return Response.json({status:"ready",stage:"review",error:null,result:{requestId:path.split("/").at(-1),operation:"edit",fullBodyReferenceUrl:"/candidate.webp",width:1024,height:1536,avatarUrl:null,portraitCrop:null,cropWarning:null}});
    if(path.endsWith("/visual-reference"))return Response.json({id:"22222222-2222-4222-8222-222222222222",status:"queued",stage:"waiting",error:null,result:null});
    return Response.json({status:"queued",stage:"waiting",error:null,result:null});
  },{preconnect:originalFetch.preconnect}) as typeof fetch;
  const view=await renderForm(false,async()=>{},false,{fullBodyReferenceUrl:"/body.webp",performanceInstructions:"",visualDesign:"A bronze coat.",werewolfStrategyStyle:null});
  fireEvent.click(view.getByRole("button",{name:"Revise"}));
  fireEvent.input(await view.findByRole("textbox",{name:"Message the character assistant"}),{target:{value:"Make their coat green."}});
  fireEvent.click(view.getByRole("button",{name:"Send"}));
  await waitFor(()=>expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({selectedFields:["visualDesign"],existingProfile:{werewolfStrategyStyle:"",performanceInstructions:""}});
  await waitFor(()=>expect((view.container.querySelector("#agent-visual-design") as HTMLTextAreaElement)?.value).toBe("A green coat."));
  expect((view.container.querySelector("#agent-werewolfStrategyStyle") as HTMLTextAreaElement)?.value).toBe("Compare claims before voting.");
  expect((view.container.querySelector("#agent-performance") as HTMLTextAreaElement)?.value).toBe("Measured gestures.");
  await view.findByRole("button",{name:"Send"});
  expect((view.getByRole("textbox",{name:"Message the character assistant"}) as HTMLTextAreaElement).value).toBe("");
});

test("a local draft cannot be silently replaced by a differing account draft",async()=>{
 const accountDraft={version:4,savedAt:"2026-08-28T21:00:00.000Z",creationRequestId:"11111111-1111-4111-8111-111111111111",base:snapshot(proposal),current:snapshot("Account coalition plan")};
 let writes=0;domWindow.localStorage.setItem("influence_session","test-token");
 globalThis.fetch=Object.assign(async (_input:RequestInfo|URL,init?:RequestInit)=>{
    if (String(_input).includes("/agent-profiles/generations")) return Response.json([]);if(init?.method==="PUT"){writes++;return Response.json({version:"11111111-1111-4111-8111-111111111111:2"});}return Response.json({version:"11111111-1111-4111-8111-111111111111:1",document:accountDraft});},{preconnect:originalFetch.preconnect}) as typeof fetch;
 const view=await renderForm(false,async()=>{},false,{},draftScope,true);
 fireEvent.click(await view.findByRole("button",{name:"Choose draft"}));
 const choices=await view.findByRole("region",{name:"Choose draft"});
 expect(choices.textContent).toContain("Account coalition plan");expect(choices.textContent).toContain(draftStrategy);expect(writes).toBe(0);
 fireEvent.click(within(choices).getByRole("button",{name:"Tab"}));fireEvent.click(view.getByRole("button",{name:"Resume"}));fireEvent.click(view.getByRole("tab",{name:"Strategy"}));
 expect((view.getByLabelText("Influence strategy") as HTMLTextAreaElement).value).toBe(draftStrategy);
});

test("a late audio completion cannot stop the next audition",async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,"Audio");
 class Sample { onended:(()=>void)|null=null; pauses=0; constructor(public src:string){samples.push(this);} async play(){} pause(){this.pauses++;} }
 const samples:Sample[]=[];Object.defineProperty(globalThis,"Audio",{configurable:true,value:Sample});
 globalThis.fetch=Object.assign(async()=>new Response(new Uint8Array([1,2,3]),{headers:{"Content-Type":"audio/mpeg"}}),{preconnect:originalFetch.preconnect}) as typeof fetch;
 try{
  const selected:string[]=[];const view=render(<AgentVoicePicker value={null} onChange={value=>{if(value)selected.push(value);}}/>);
  fireEvent.click(view.getByRole("button",{name:"Voice"}));const first=PLAYER_VOICES[0]!,second=PLAYER_VOICES[1]!;
  fireEvent.click(view.getByRole("button",{name:"Play "+first.name}));await waitFor(()=>expect(samples).toHaveLength(1));
  fireEvent.click(view.getByRole("button",{name:"Play "+second.name}));await waitFor(()=>expect(samples).toHaveLength(2));
  await act(async()=>{samples[0]!.onended?.();});
  expect(samples[1]!.pauses).toBe(0);expect(view.getByRole("button",{name:"Stop "+second.name})).toBeTruthy();
  fireEvent.click(view.getByRole("button",{name:new RegExp(`^${second.name} (Male|Female)$`)}));expect(samples[1]!.pauses).toBe(1);expect(selected).toEqual([second.id]);
 }finally{await act(async()=>cleanup());if(descriptor)Object.defineProperty(globalThis,"Audio",descriptor);else Reflect.deleteProperty(globalThis,"Audio");}
});

test("Resume waits for account recovery and does not reopen the recovered draft",async()=>{
  domWindow.localStorage.setItem("influence_session","test-token");
  const stored=JSON.parse(domWindow.sessionStorage.getItem(draftKey)!);
  let resolveRead!:(response:Response)=>void;
  const accountRead=new Promise<Response>(resolve=>{resolveRead=resolve;});
  let writes=0;
  globalThis.fetch=Object.assign(async (_input:RequestInfo|URL,init?:RequestInit)=>{
    if (String(_input).includes("/agent-profiles/generations")) return Response.json([]);
    if(init?.method==="PUT"){writes++;return Response.json({version:"11111111-1111-4111-8111-111111111111:2"});}
    return accountRead;
  },{preconnect:originalFetch.preconnect}) as typeof fetch;
  const view=await renderForm(false,async()=>{},false,{},draftScope,true);
  expect((view.getByRole("button",{name:"Resume"}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(view.getByRole("button",{name:"Close"}));
  expect(writes).toBe(0);
  await act(async()=>{resolveRead(Response.json({version:"11111111-1111-4111-8111-111111111111:1",document:stored}));});
  await waitFor(()=>expect((view.getByRole("button",{name:"Resume"}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(view.getByRole("button",{name:"Resume"}));
  await waitFor(()=>expect(view.queryByLabelText("Saved local draft")).toBeNull());
  fireEvent.click(view.getByRole("button",{name:"Guided"}));
  fireEvent.click(view.getByRole("button",{name:"Advanced"}));
  expect(view.queryByLabelText("Saved local draft")).toBeNull();
});

test.each([false, true])("artwork handoff waits for recovery and only auto-resumes an unchanged baseline (conflict=%s)",async conflict=>{
  domWindow.localStorage.setItem("influence_session","test-token");
  const stored=JSON.parse(domWindow.sessionStorage.getItem(draftKey)!);
  stored.current.personality="A recovered character, not an empty brief.";
  if(conflict) stored.base.name="An earlier name";
  domWindow.sessionStorage.removeItem(draftKey);
  const read=Promise.withResolvers<Response>();
  let artworkReads=0;
  globalThis.fetch=Object.assign(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const path=String(input);
    if(path.includes("/agent-profiles/generations")) return Response.json([]);
    if(path.includes("/visual-references/")) {artworkReads++;return Response.json({status:"ready",result:{requestId:"image-1",fullBodyReferenceUrl:"/candidate.webp",width:1024,height:1536,avatarUrl:null,portraitCrop:null,cropWarning:null,basedOn:{name:"Arden",personaKey:"diplomat",visualDesign:"",performanceInstructions:""}}});}
    if(init?.method==="PUT")return Response.json({version:"saved:2"});
    return read.promise;
  },{preconnect:originalFetch.preconnect}) as typeof fetch;
  const view=await renderForm(false,async()=>{},false,{},draftScope,true,"image-1");
  expect(artworkReads).toBe(0);
  expect(view.queryByRole("button",{name:"Select"})).toBeNull();
  await act(async()=>read.resolve(Response.json({version:"saved:1",document:stored})));
  if(conflict){
    await waitFor(()=>expect((view.getByRole("button",{name:"Resume"}) as HTMLButtonElement).disabled).toBe(false));
    expect(artworkReads).toBe(0);
    fireEvent.click(view.getByRole("button",{name:"Resume"}));
  }
  await waitFor(()=>expect((view.getByLabelText("Personality") as HTMLTextAreaElement).value).toBe(stored.current.personality));
  await waitFor(()=>expect(view.getByRole("button",{name:"Select"})).toBeTruthy());
  expect(artworkReads).toBe(1);
  expect(view.queryByText(/The character brief changed during preparation/)).toBeNull();
  expect(view.queryByRole("button",{name:"Resume"})).toBeNull();
});

test("a failed artwork selection never offers image generation as its retry",async()=>{
  const requestId="22222222-2222-4222-8222-222222222222";
  domWindow.sessionStorage.setItem(draftKey,JSON.stringify({version:4,savedAt:new Date().toISOString(),creationRequestId:"11111111-1111-4111-8111-111111111111",base:snapshot(proposal),current:snapshot(proposal),candidateImage:{requestId,fullBodyReferenceUrl:"/candidate.webp",width:1024,height:1536,avatarUrl:null,portraitCrop:null,cropWarning:null}}));
  const requests:string[]=[];
  globalThis.fetch=Object.assign(async(input:RequestInfo|URL)=>{
    if (String(input).includes("/agent-profiles/generations")) return Response.json([]);requests.push(String(input));return Response.json({error:"Synthetic decision failure"},{status:503});},{preconnect:originalFetch.preconnect}) as typeof fetch;
  const view=await renderForm(false);
  fireEvent.click(view.getByRole("button",{name:"Resume"}));
  fireEvent.click(view.getByRole("button",{name:"Select"}));
  const alert=await view.findByRole("alert");
  expect(alert.textContent).toContain("Couldn’t select artwork.");
  expect(within(alert).queryByRole("button",{name:"Retry"})).toBeNull();
  expect(requests.filter(path=>path.endsWith("/visual-reference"))).toHaveLength(0);
  expect(view.getByRole("button",{name:"Select"})).toBeTruthy();
});


test("generation and review wait for account draft recovery without showing an error", async () => {
  domWindow.sessionStorage.removeItem(draftKey);
  domWindow.localStorage.setItem("influence_session", "test-token");
  const read = Promise.withResolvers<Response>();
  let posts = 0;
  globalThis.fetch = Object.assign(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (String(_input).includes("/agent-profiles/generations")) return Response.json([]);
    if (init?.method === "POST") posts++;
    return read.promise;
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  const view = await renderForm(false, async () => {}, false, {}, draftScope, true);
  expect(view.getByText("Loading draft…")).toBeTruthy();
  expect((view.getByRole("button", { name: "Generate" }) as HTMLButtonElement).disabled).toBe(true);
  expect((view.getByRole("button", { name: "Review" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(view.getByRole("button", { name: "Generate" }));
  fireEvent.click(view.getByRole("button", { name: "Guided" }));
  expect((view.getByLabelText("Message the character assistant") as HTMLTextAreaElement).disabled).toBe(true);
  expect(view.queryByRole("alert")).toBeNull();
  expect(posts).toBe(0);
  await act(async () => read.resolve(Response.json(null)));
  await waitFor(() => expect((view.getByLabelText("Message the character assistant") as HTMLTextAreaElement).disabled).toBe(false));
  expect(view.queryByText("Loading draft…")).toBeNull();
  expect(view.queryByRole("alert")).toBeNull();
});


test.each(["reviewing","held"] as const)("footer uses the canonical %s state instead of the internal held flag",async reviewState=>{
 domWindow.sessionStorage.removeItem(draftKey);
 const original=agent();
 const view=await renderForm(false,async()=>{},false,{contentRevisionId:"accepted",ownerContent:{published:original,submitted:{revisionId:"pending",content:original,disposition:null,held:true,status:"pending"},reviewState,availability:"available",moderationVersion:0}});
 expect(view.container.querySelector('[aria-label="Editor actions"]')!.textContent).toContain(reviewState === "reviewing" ? "Reviewing" : "Held for moderation");
 if(reviewState === "reviewing") expect(view.container.querySelector('[aria-label="Editor actions"]')!.textContent).not.toContain("Held for moderation");
});
