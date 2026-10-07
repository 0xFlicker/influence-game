import { InfluenceAuthContext, type InfluenceAuthState } from "../hooks/use-auth";
import { adminTestWrapper } from "./admin-test-wrapper";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render as baseRender, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { ReplayVisualProductionPanel } from "../app/admin/replay-visual-production-panel";
import { setApiBase } from "../lib/api";
import type { MediaRecords, MediaAttempt } from "../app/admin/games/[id]/visual/scene-repair-panel";

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
const media = (): MediaRecords => ({ jobs: [], versions: [], requests: [], publications: [] });
const scene = (key: string) => ({ key, previewHash: `preview-${key}`, sceneId: null as string | null, roomName: "Lobby", round: 1, boundarySequence: 1,
  participants: [{ id: "p1", name: "Arden" }], available: false, originalFailed: false });
const inventory = () => ({ gameId: "game", slug: "game", scenes: [scene("first"), scene("second")], media: media(), warnings: [], attempts: [] as Array<MediaAttempt & { provider: string; model: string }> });
const job = (status: string): MediaRecords["jobs"][number] => ({ id: "job", sceneId: "saved", version: 1, status, step: "render section", failure: null,
  candidateArtifactId: null, sourceImageId: null, createdAt: new Date().toISOString(), startedAt: null, finishedAt: null });
function respond(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = Object.assign(handler, { preconnect: originalFetch.preconnect }) as typeof fetch;
}
async function loaded(view: ReturnType<typeof render>) {
  await waitFor(() => expect(view.getAllByText("Render missing image")).toHaveLength(2));
}

test("opening game controls only reads scenes; explicit scene selection queues one request and disables other renders", async () => {
  let data = inventory(), finish: ((response: Response) => void) | undefined;
  const writes: Record<string, unknown>[] = [];
  const locks: boolean[] = [], paths: string[] = [];
  respond(async (url, init) => {
    paths.push(url);
    if (init?.method === "POST") { writes.push(JSON.parse(String(init.body))); return new Promise(resolve => { finish = resolve; }); }
    return Response.json(data);
  });
  const view = render(<ReplayVisualProductionPanel gameId="game" onLocked={value => locks.push(value)} />);
  await loaded(view);
  expect(writes).toHaveLength(0); expect(paths).toEqual(["/api/admin/production/games/game/visual"]);
  expect(view.queryByRole("combobox")).toBeNull();
  fireEvent.click(view.getAllByText("Render missing image")[0]!); fireEvent.click(view.getAllByText("Render missing image")[0]!);
  expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ key: "first", previewHash: "preview-first", requestId: expect.any(String) });
  expect(locks.at(-1)).toBe(true);
  data = { ...data, scenes: [{ ...data.scenes[0]!, sceneId: "saved" }, data.scenes[1]!], media: { ...media(), jobs: [job("queued")] } };
  await act(async () => finish!(Response.json({ accepted: true, message: "Image queued" })));
  await waitFor(() => expect(view.getByText(/One image is queued/)).not.toBeNull());
  expect(locks.slice(-2)).toEqual([true, false]);
  expect(view.getAllByText("Render missing image").every(button => (button as HTMLButtonElement).disabled)).toBe(true);
});

test("lost responses lock selection and retry the same request without hiding a confirmed rejection", async () => {
  const ids: string[] = [];
  const locks: boolean[] = [];
  respond(async (url, init) => {
    if (init?.method === "POST") {
      ids.push(JSON.parse(String(init.body)).requestId);
      if (ids.length === 1) throw new Error("Connection dropped");
      return Response.json({ error: "Scene evidence changed", code: "stale_preview" }, { status: 409 });
    }
    return Response.json(inventory());
  });
  const view = render(<ReplayVisualProductionPanel gameId="game" onLocked={value => locks.push(value)} />); await loaded(view);
  fireEvent.click(view.getAllByText("Render missing image")[0]!);
  await waitFor(() => expect(view.getByText("Check render request")).not.toBeNull());
  expect(locks.at(-1)).toBe(true);
  expect(view.getAllByText("Render missing image").every(button => (button as HTMLButtonElement).disabled)).toBe(true);
  fireEvent.click(view.getByText("Check render request"));
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Scene evidence changed"));
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  expect(locks.at(-1)).toBe(false);
});

test("saved candidates use Production evidence and publish only by explicit review", async () => {
  const data = inventory(), paths: string[] = [], writes: Record<string, unknown>[] = [];
  data.scenes[0]!.sceneId = "saved";
  data.media = { ...media(), jobs: [job("ready")], versions: [{ id: "job", sceneId: "saved", version: 1, imageArtifactId: "image", annotatedArtifactId: "annotations",
    verificationVersion: "verified", localization: { count: 1, verifiedParticipantIds: ["p1"], anchors: [] } }] };
  respond(async (url, init) => {
    paths.push(url);
    if (url.includes("evidence/artifact")) return Response.json({ imageUrl: "data:image/png;base64,AAAA" });
    if (init?.method === "POST") { writes.push(JSON.parse(String(init.body))); return Response.json({ accepted: true, message: "Published for viewers" }); }
    return Response.json(data);
  });
  const view = render(<ReplayVisualProductionPanel gameId="game" onLocked={() => {}} />);
  await waitFor(() => expect(view.getByText("Regenerate scene")).not.toBeNull());
  expect(view.getAllByText("Render missing image")).toHaveLength(1);
  fireEvent.click(view.getByText("Versions and review"));
  await waitFor(() => expect(view.getByAltText("Candidate v1")).not.toBeNull());
  expect(paths).toContain("/api/admin/production/games/game/visual/evidence/artifact/image");
  expect(writes).toHaveLength(0);
  fireEvent.click(view.getByText("Publish for viewers"));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(paths).toContain("/api/admin/production/games/game/visual/media");
  expect(writes[0]).toMatchObject({ action: "publish", sceneId: "saved", versionId: "job", expectedVersion: 1, expectedPublication: 0 });
});

test("receipt review distinguishes active requests, HTTP failures, and interrupted dispatches", async () => {
  const data = inventory(); data.scenes[0]!.sceneId = "saved";
  data.media.jobs = [job("rendering")];
  data.attempts = [{ id: "attempt", operationKey: "media:job:section:0", provider: "openai", model: "gpt-image-2", status: "pending", costMicrousd: null, receipt: null, reconciliation: null }];
  respond(async () => Response.json(data));
  const view = render(<ReplayVisualProductionPanel gameId="game" onLocked={() => {}} />); await loaded(view);
  expect(view.queryByText(/Needs reconciliation:/)).toBeNull();
  expect(view.queryByText("Record reconciliation")).toBeNull();
  expect(view.getByText(/Request in progress; waiting/)).not.toBeNull();
  data.attempts[0] = { ...data.attempts[0]!, status: "finished", receipt: { status: 429, chargeUncertain: false, failure: { kind: "http", message: "Rate limit" } } };
  fireEvent.click(view.getByText("Refresh scenes"));
  await waitFor(() => expect(view.getByText("http: Rate limit")).not.toBeNull());
  expect(view.getByText("HTTP 429 · finished")).not.toBeNull();
  expect(view.queryByText("Record reconciliation")).toBeNull();
  data.media.jobs = [job("needs_reconciliation")];
  data.attempts[0] = { ...data.attempts[0]!, status: "needs_reconciliation", receipt: null };
  fireEvent.click(view.getByText("Refresh scenes"));
  await waitFor(() => expect(view.getByText("Record reconciliation")).not.toBeNull());
  expect(view.getByText(/Needs reconciliation: 1/)).not.toBeNull();
});

function render(ui: React.ReactNode) { return baseRender(ui, { wrapper: adminTestWrapper() }); }

test("unknown render identity survives leaving the game and an accepted write survives a failed refresh", async () => {
  const writes: string[] = []; let failRead = false;
  respond(async (_url, init) => {
    if (init?.method === "POST") {
      writes.push(String(init.body));
      if (writes.length === 1) throw new Error("Receipt lost");
      failRead = true; return Response.json({accepted:true, message:"Accepted original request"});
    }
    if (failRead) return new Response("Inventory offline", {status:503});
    return Response.json(inventory());
  });
  const view = render(<ReplayVisualProductionPanel gameId="game" onLocked={() => {}}/>);
  await loaded(view); fireEvent.click(view.getAllByText("Render missing image")[0]!);
  await waitFor(() => expect(view.getByText("Check render request")).not.toBeNull());
  view.rerender(<p>Another game</p>);
  view.rerender(<ReplayVisualProductionPanel gameId="game" onLocked={() => {}}/>);
  await waitFor(() => expect(view.getByText("Check render request")).not.toBeNull());
  fireEvent.click(view.getByText("Check render request"));
  await waitFor(() => expect(view.getByText("Accepted original request")).not.toBeNull());
  await waitFor(() => expect(view.getByText(/Inventory offline/)).not.toBeNull());
  expect(writes).toHaveLength(2); expect(writes[1]).toBe(writes[0]);
  expect(view.queryByText("Check render request")).toBeNull();
});

test("unknown reconciliation retains its draft across navigation and reads a receipt instead of reposting", async () => {
  const data = inventory(); let posts = 0;
  data.attempts = [{id:"attempt",operationKey:"media:job:section:0",provider:"fixture",model:"fixture",status:"needs_reconciliation",costMicrousd:null}];
  respond(async (_url, init) => {
    if(init?.method === "POST") { posts++; throw new Error("Receipt lost"); }
    return Response.json(data);
  });
  const view = render(<ReplayVisualProductionPanel gameId="game" onLocked={() => {}}/>);
  await waitFor(() => expect(view.getByLabelText("Reconciliation evidence")).not.toBeNull());
  fireEvent.input(view.getByLabelText("Reconciliation evidence"),{target:{value:"Provider confirmed no charge"}});
  fireEvent.input(view.getByLabelText("Confirmed cost in dollars"),{target:{value:"0"}});
  fireEvent.submit(view.getByText("Record reconciliation").closest("form")!);
  await waitFor(() => expect(view.getByText("Check reconciliation receipt")).not.toBeNull());
  view.rerender(<p>Another game</p>); view.rerender(<ReplayVisualProductionPanel gameId="game" onLocked={() => {}}/>);
  await waitFor(() => expect((view.getByLabelText("Reconciliation evidence") as HTMLInputElement).value).toBe("Provider confirmed no charge"));
  expect((view.getByText("Record reconciliation") as HTMLButtonElement).disabled).toBe(true);
  data.attempts[0] = {...data.attempts[0]!,status:"reconciled",costMicrousd:0,reconciliation:{note:"Provider confirmed no charge"}};
  fireEvent.click(view.getByText("Check reconciliation receipt"));
  await waitFor(() => expect(view.queryByText("Record reconciliation") === null).toBe(true));
  expect(posts).toBe(1);
});


test("a reconciled wolf-form charge permits an explicit new repair", async () => {
  const data = {...inventory(), scenes:[], recovery:{pauseId:"pause",kind:"form",playerName:"Arden",reason:"Wolf form failed",policy:"require_visuals"}};
  data.media.jobs = [{...job("needs_reconciliation"),sceneId:null,reusePrefix:"pause"}];
  data.attempts = [{id:"attempt",operationKey:"wolf-form:fixture",status:"needs_reconciliation",costMicrousd:null,provider:"openai",model:"fixture"}];
  respond(async () => Response.json(data));
  const auth = {ready:true,authenticated:false,account:null,hydrationError:false} as InfluenceAuthState;
  const view = render(<InfluenceAuthContext.Provider value={auth}><ReplayVisualProductionPanel gameId="game" onLocked={()=>{}} werewolf /></InfluenceAuthContext.Provider>);
  await waitFor(()=>expect((view.getByText("Repair wolf form") as HTMLButtonElement).disabled).toBe(true));
  data.attempts[0] = {...data.attempts[0]!,status:"reconciled",costMicrousd:0};
  fireEvent.click(view.getByText("Refresh scenes"));
  await waitFor(()=>expect((view.getByText("Repair wolf form") as HTMLButtonElement).disabled).toBe(false));
  expect(view.queryByText("Resume game")).toBeNull();
});

test("receipt checks are single-flight and cannot unlock a pending replacement POST", async () => {
  const data = inventory();
  data.attempts = [{id:"attempt",operationKey:"media:job:section:0",provider:"fixture",model:"fixture",status:"needs_reconciliation",costMicrousd:null}];
  let posts = 0, reads = 0, finishRead!: (response: Response) => void, finishPost!: (response: Response) => void;
  respond(async (_url, init) => {
    if (init?.method === "POST") { posts++; if (posts === 1) throw Error("Receipt lost"); return new Promise(resolve => {finishPost = resolve;}); }
    reads++; if (reads === 2) return new Promise(resolve => {finishRead = resolve;});
    return Response.json(data);
  });
  const view = render(<ReplayVisualProductionPanel gameId="game" onLocked={()=>{}}/>);
  await waitFor(()=>expect(view.getByLabelText("Reconciliation evidence")).not.toBeNull());
  fireEvent.input(view.getByLabelText("Reconciliation evidence"),{target:{value:"Confirmed no charge"}});
  fireEvent.input(view.getByLabelText("Confirmed cost in dollars"),{target:{value:"0"}});
  fireEvent.submit(view.getByText("Record reconciliation").closest("form")!);
  await waitFor(()=>expect(view.getByText("Check reconciliation receipt")).not.toBeNull());
  fireEvent.click(view.getByText("Check reconciliation receipt"));
  fireEvent.click(view.getByText("Check reconciliation receipt"));
  expect(reads).toBe(2);
  expect((view.getByText("Record reconciliation") as HTMLButtonElement).disabled).toBe(true);
  await act(async()=>finishRead(Response.json(data)));
  await waitFor(()=>expect((view.getByText("Record reconciliation") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.submit(view.getByText("Record reconciliation").closest("form")!);
  expect(posts).toBe(2);
  expect((view.getByText("Record reconciliation") as HTMLButtonElement).disabled).toBe(true);
  await act(async()=>finishPost(Response.json({accepted:true})));
  expect(view.queryByText("No reconciliation is recorded. Review the evidence before submitting again.")).toBeNull();
});

test("a receipt read from an old mount cannot replace a newer reconciliation operation", async () => {
  const data = inventory();
  data.attempts = [{id:"attempt",operationKey:"media:job:section:0",provider:"fixture",model:"fixture",status:"needs_reconciliation",costMicrousd:null}];
  let posts=0, reads=0, oldRead!: (response:Response)=>void, newRead!: (response:Response)=>void, post!: (response:Response)=>void;
  respond(async (_url,init)=>{
    if(init?.method === "POST") {if(++posts===1)throw Error("Receipt lost");return new Promise(resolve=>{post=resolve;});}
    if(++reads===2)return new Promise(resolve=>{oldRead=resolve;});
    if(reads===3)return new Promise(resolve=>{newRead=resolve;});
    return Response.json(data);
  });
  const panel=<ReplayVisualProductionPanel gameId="game" onLocked={()=>{}}/>;
  const view=render(panel);
  await waitFor(()=>expect(view.getByLabelText("Reconciliation evidence")).not.toBeNull());
  fireEvent.input(view.getByLabelText("Reconciliation evidence"),{target:{value:"Confirmed no charge"}});
  fireEvent.input(view.getByLabelText("Confirmed cost in dollars"),{target:{value:"0"}});
  fireEvent.submit(view.getByText("Record reconciliation").closest("form")!);
  await waitFor(()=>expect(view.getByText("Check reconciliation receipt")).not.toBeNull());
  fireEvent.click(view.getByText("Check reconciliation receipt"));
  view.rerender(<p>Another panel</p>);view.rerender(panel);
  await waitFor(()=>expect(view.getByText("Check reconciliation receipt")).not.toBeNull());
  fireEvent.click(view.getByText("Check reconciliation receipt"));
  await act(async()=>newRead(Response.json(data)));
  fireEvent.submit(view.getByText("Record reconciliation").closest("form")!);
  expect(posts).toBe(2);
  await act(async()=>oldRead(Response.json(data)));
  expect((view.getByText("Record reconciliation") as HTMLButtonElement).disabled).toBe(true);
  await act(async()=>post(Response.json({accepted:true})));
  expect(view.queryByText("No reconciliation is recorded. Review the evidence before submitting again.")).toBeNull();
});
