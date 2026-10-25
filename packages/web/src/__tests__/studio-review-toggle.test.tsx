import {expect, mock, test} from "bun:test";
import {cleanup, fireEvent, render, waitFor} from "@testing-library/react";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {Window} from "happy-dom";
import {fileURLToPath} from "node:url";
import {productionReviewPath, type ProductionReview} from "@influence/engine/production-moments/review";

test("Source thinking preserves an MCP review's cut, workspace and source request", async () => {
  // Isolate Next/auth mocks from the rest of the provider-free suite.
  if (process.env.HOUSE_STUDIO_REVIEW_TEST !== "1") {
    const child = Bun.spawn([process.execPath,"test",fileURLToPath(import.meta.url)], {
      env:{...process.env,HOUSE_STUDIO_REVIEW_TEST:"1"},stdout:"pipe",stderr:"pipe",
    });
    const [stdout,stderr,code] = await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    expect({code,errors:code ? stdout+stderr:""}).toEqual({code:0,errors:""}); return;
  }
  const dom = new Window({url:"http://localhost"});
  const keys = ["window","document","navigator","localStorage","Element","HTMLElement","Node","Event"] as const;
  const saved = new Map(keys.map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for (const key of keys) Object.defineProperty(globalThis,key,{configurable:true,value:key === "window" ? dom:dom[key]});
  const review: ProductionReview = {version:1,audience:"omniscient",thinking:true,
    recipe:{mode:"recipe",thinking:true,base:"empty",policies:{speech:{mode:"none"},thinking:{mode:"all"}}},
    music:false,volume:0,fingerprint:`sha256:${"a".repeat(64)}`};
  let params = new URL(productionReviewPath("wolf",review),"http://localhost").searchParams;
  mock.module("next/navigation",() => ({useSearchParams:() => params,usePathname:() => "/admin/production/games/wolf",
    useRouter:() => ({replace(url:string) {params = new URL(url,"http://localhost").searchParams;}})}));
  mock.module("@/components/nav",() => ({Nav:() => null}));
  const roles = ["producer"], permissions = ["view_admin"];
  mock.module("@/hooks/use-auth",() => ({AUTH_GENERATION_KEY:"influence_auth_generation",useAuth:() => ({ready:true,authenticated:true,account:{id:"operator",roles,permissions}})}));
  mock.module("@/hooks/use-permissions",() => ({usePermissions:() => ({loading:false,roles,permissions,hasPermission:(permission:string) => permissions.includes(permission)})}));
  const {setApiBase} = await import("../lib/api"); setApiBase("");
  const originalFetch = globalThis.fetch;
  let sourceReads = 0;
  globalThis.fetch = Object.assign(async (input:string|URL|Request) => {
    if (String(input).includes("/source?")) {sourceReads++;return new Promise<Response>(() => {});}
    return Response.json({id:"wolf",slug:"wolf",gameKind:"werewolf",status:"completed",title:null,hidden:false,playerCount:6,needsAttention:false,capabilities:{editorial:true}});
  },{preconnect:originalFetch.preconnect}) as typeof fetch;
  const {AdminShell} = await import("../app/admin/admin-shell");
  const {ProductionWorkspace} = await import("../app/admin/production/production-workspace");
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
  try {
    const ui = () => <QueryClientProvider client={client}><AdminShell><ProductionWorkspace gameId="wolf" /></AdminShell></QueryClientProvider>;
    const view = render(ui());
    await waitFor(() => expect(view.getByRole("button",{name:"Cut rules"})).toBeTruthy());
    const title = view.getByRole("button",{name:"Cut rules"}).getAttribute("title");
    expect(title).toContain("No speech"); expect(title).toContain("No default gameplay");
    fireEvent.click(view.getByRole("button",{name:"Tools"}));
    const dialog = view.getByRole("dialog",{name:"Source settings"});
    for (const enabled of [false,true]) {
      fireEvent.click(view.getByRole("checkbox",{name:"Play thinking in Source"}));
      expect(JSON.parse(params.get("review")!)).toEqual(review);
      view.rerender(ui());
      expect((view.getByRole("checkbox",{name:"Play thinking in Source"}) as HTMLInputElement).checked).toBe(enabled);
      expect(view.getByRole("dialog",{name:"Source settings"})).toBe(dialog);
      expect(view.getByRole("button",{name:"Cut rules"}).getAttribute("title")).toBe(title);
      expect(sourceReads).toBe(1);
    }
    const withoutThinking: ProductionReview = {...review,thinking:false,recipe:{...review.recipe,thinking:false}};
    params = new URL(productionReviewPath("wolf",withoutThinking),"http://localhost").searchParams;
    // A contradictory navigation preference cannot imply unavailable source content.
    params.set("thinking","on");
    view.rerender(ui());
    fireEvent.click(view.getByRole("button",{name:"Tools"}));
    expect(view.queryByRole("checkbox",{name:"Play thinking in Source"})).toBeNull();
    expect(view.getByText("This review’s pinned source does not include thinking.")).toBeTruthy();
    expect(view.getByRole("button",{name:"Cut rules"}).getAttribute("title")).toContain("No speech");
  } finally {
    cleanup();client.clear();dom.close();globalThis.fetch = originalFetch;
    for (const key of keys) {const descriptor = saved.get(key);if (descriptor) Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  }
});
