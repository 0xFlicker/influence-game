import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { fileURLToPath } from "node:url";
import { setApiBase } from "../lib/api";
import type {ProductionLibraryGame} from "../lib/production-studio";
import type {AdminSession} from "../app/admin/admin-session";
import {useEffect} from "react";

const originalFetch = globalThis.fetch;
const globals = ["window", "document", "navigator", "localStorage", "Element", "HTMLElement", "Node", "Event"] as const;
const saved = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: Window;
beforeEach(() => {
  dom = new Window({ url: "http://localhost" });
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: dom[key] });
  setApiBase("");
});
afterEach(async () => {
  await act(async () => cleanup()); dom.close(); globalThis.fetch = originalFetch;
  for (const key of globals) { const descriptor = saved.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});

test("cached Producer capabilities cannot retain editorial or Werewolf recovery after role revocation", async () => {
  // Keep Next and auth mocks within this isolated process.
  if (process.env.HOUSE_STUDIO_ACCESS_TEST !== "1") {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: { ...process.env, HOUSE_STUDIO_ACCESS_TEST: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, errors: code ? stdout + stderr : "" }).toEqual({ code: 0, errors: "" }); return;
  }
  let roles = ["producer"];
  let permissions = ["view_admin", "start_game", "manage_postgame_media"];
  mock.module("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/admin/production/games/wolf", useRouter: () => ({ replace() {} }) }));
  mock.module("@/components/nav", () => ({ Nav: () => null }));
  mock.module("@/hooks/use-auth", () => ({ AUTH_GENERATION_KEY: "influence_auth_generation", useAuth: () => ({ ready: true, authenticated: true, account: { id: "operator", roles, permissions } }) }));
  mock.module("@/hooks/use-permissions", () => ({ usePermissions: () => ({ loading: false, roles, permissions, hasPermission: (permission: string) => permissions.includes(permission) }) }));
  const { AdminShell } = await import("../app/admin/admin-shell");
  const {useAdminSession} = await import("../app/admin/admin-session");
  let session!: AdminSession;
  function SessionProbe() {const current = useAdminSession(); useEffect(() => {session = current;}, [current]); return null;}
  const { ProductionWorkspace } = await import("../app/admin/production/production-workspace");
  const { ProductionSceneInspector } = await import("../app/admin/production/production-scenes");
  let metadataReads = 0;
  globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
    const url = String(input), id = url.includes("/wolf") ? "wolf" : "influence";
    if (url.includes("/source?")) return new Promise<Response>(() => {});
    if (url.includes("/recovery?")) return Response.json({ gameId: id, status: "suspended", recovery: null, formJob: null, unresolvedForm: false, attempts: [], nextOffset: null });
    if (url === "/api/admin/games/influence/visual") return Response.json({ gameId: id, gameStatus: "completed", policy: "best_effort", assets: null, pause: null,
      scenes: [], media: { versions: [], jobs: [], publications: [], requests: [] }, metrics: [], events: [], contextFailures: [],
      accounting: { knownCostMicrousd: 0, unpricedAttempts: 0, uncertainAttempts: 0, attempts: [] } });
    metadataReads++;
    return Response.json({ id, slug: id, gameKind: id === "wolf" ? "werewolf" : "influence", status: "completed", title: null,
      hidden: false, playerCount: 6, needsAttention: false, capabilities: { editorial: true, visualRead: true, episodeEdit: true, trailerRead: true, trailerRender: true, influenceRecovery: false } });
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (id: string) => <QueryClientProvider client={client}><AdminShell><SessionProbe /><ProductionWorkspace gameId={id} /></AdminShell></QueryClientProvider>;
  const view = render(ui("wolf"));
  await waitFor(() => expect(view.getByText("Loading the complete accepted source prefix and media metadata…")).toBeTruthy());
  expect(view.queryByRole("button", { name: "Game production and recovery" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Tools" }));
  fireEvent.click(view.getByRole("button", { name: "Episode tools" }));
  const episodeTools = view.getByRole("dialog", { name: "Episode tools" });
  expect(within(episodeTools).getByRole("button", { name: "Episode presentation" })).toBeTruthy();
  expect(within(episodeTools).getByRole("button", { name: "Trailer & poster" })).toBeTruthy();
  fireEvent.click(within(episodeTools).getByRole("button", { name: "Game production and recovery" }));
  expect(view.queryByRole("dialog", { name: "Episode tools" })).toBeNull();
  expect(view.getByRole("dialog", { name: "Game production and recovery" })).toBeTruthy();
  await waitFor(() => expect(view.getByRole("region", { name: "Game production recovery" })).toBeTruthy());
  const privateDraft = "draft:/api/admin/production/games/wolf:omniscient:moment:pm1:thought";
  act(() => {session.set(privateDraft,{revision:1,rows:[["label.smart","true"]]}); session.set(`${privateDraft}:conflict`,{tags:{private:"evidence"}}); session.set(`${privateDraft}:error`,"Private conflict");});
  roles = []; view.rerender(ui("wolf"));
  expect(session.get(privateDraft)).toBeUndefined(); expect(session.get(`${privateDraft}:conflict`)).toBeUndefined(); expect(session.get(`${privateDraft}:error`)).toBeUndefined();
  expect(view.queryByText("Loading the complete accepted source prefix and media metadata…")).toBeNull();
  expect(view.queryByText("Game production and recovery")).toBeNull();
  expect(view.queryByRole("button", { name: "Episode tools" })).toBeNull();
  expect(view.queryByRole("dialog", { name: "Game production and recovery" })).toBeNull();
  expect(view.queryByRole("region", { name: "Game production recovery" })).toBeNull();
  expect(view.getByRole("button", { name: "Episode presentation" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Trailer & poster" })).toBeTruthy();
  expect(metadataReads).toBe(1);
  view.rerender(ui("influence"));
  await waitFor(() => expect(view.getByRole("button", { name: "Game production and recovery" })).toBeTruthy());
  expect(view.queryByText("Loading the complete accepted source prefix and media metadata…")).toBeNull();
  expect(view.getByRole("button", { name: "Episode presentation" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Trailer & poster" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Game production and recovery" }));
  await waitFor(() => expect(within(view.getByRole("dialog", { name: "Game production and recovery" })).getByRole("heading", { name: "Visual production" })).toBeTruthy());
  const scene={key:"scene",sceneId:"scene",roomName:"Paused room",participants:[],originalFailed:true};
  globalThis.fetch=Object.assign(async(input:string|URL|Request)=>Response.json(String(input).includes("/scenes/scene?")
    ? {scene,media:{versions:[],jobs:[],publications:[],requests:[]},attempts:[{id:"attempt",operationKey:"scene:render:0",sceneId:"scene",status:"needs_reconciliation",costMicrousd:null}],uncertainAttemptIds:["attempt"],requiresReconciliation:true,pages:{nextVersionOffset:null,nextJobOffset:null,nextPublicationOffset:null,nextRequestOffset:null,nextAttemptOffset:null}}
    : {gameId:"paused",items:[scene],total:1,nextOffset:null}),{preconnect:originalFetch.preconnect}) as typeof fetch;
  const paused:ProductionLibraryGame={id:"paused",slug:"paused",gameKind:"influence",status:"suspended",createdAt:"2026-10-09T00:00:00Z",hidden:false,playerCount:6,title:null,namingStatus:null,needsAttention:true,recovery:"influence",
    capabilities:{visualRead:true,sceneRepair:true,editorial:true,policy:true,resume:true,influenceRecovery:true,formRepair:false,episodeRead:true,episodeEdit:true,trailerRead:false,trailerRender:false}};
  roles=["producer"];
  const pausedUi=()=><QueryClientProvider client={client}><AdminShell><ProductionSceneInspector game={paused} audience="public" onOpenGameTools={()=>{}}/></AdminShell></QueryClientProvider>;
  view.rerender(pausedUi());
  await waitFor(()=>expect(view.getByRole("button",{name:"Correct images"})).toBeTruthy());
  expect(view.getByRole("button",{name:"Regenerate scene"}).hasAttribute("disabled")).toBe(true);
  expect(view.getByText("More than 100 provider requests need reconciliation. Reconcile receipts before requesting another render.")).toBeTruthy();
  expect(view.getByRole("button",{name:"Record reconciliation"})).toBeTruthy();
  permissions=["view_admin","manage_postgame_media"];view.rerender(pausedUi());
  expect(view.queryByRole("button",{name:"Correct images"})).toBeNull();
  expect(view.queryByRole("button",{name:"Regenerate scene"})).toBeNull();
  expect(view.queryByRole("button",{name:"Record reconciliation"})).toBeNull();
  expect(view.getByRole("heading",{name:"Paused room"})).toBeTruthy();
  client.clear();
});
