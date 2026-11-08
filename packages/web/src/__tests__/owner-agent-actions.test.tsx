import { expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { fileURLToPath } from "node:url";

test("agent profile owner actions check ownership and same-tab drafts before handoff", async () => {
  if (process.env.OWNER_AGENT_ACTIONS_TEST !== "1") {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], { env: { ...process.env, OWNER_AGENT_ACTIONS_TEST: "1" }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, errors: code ? stdout + stderr : "" }).toEqual({ code: 0, errors: "" });
    return;
  }
  const { Window } = await import("happy-dom");
  const dom = new Window({ url: "http://localhost/agents/agent-1" });
  const globals = ["window", "document", "navigator", "localStorage", "HTMLElement", "Node", "Event"] as const;
  const saved = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: dom[key] });
  const navigation = await import("next/navigation");
  const routes: string[] = [];
  mock.module("next/navigation", () => ({ ...navigation, useRouter: () => ({ push: (path: string) => routes.push(path) }) }));
  const { InfluenceAuthContext } = await import("../hooks/use-auth");
  const { OwnerAgentActions } = await import("../app/agents/[id]/owner-agent-actions");
  const oldFetch = globalThis.fetch;
  const agent = { id: "agent-1", name: "Arden", latestContentRevisionId: "new" };
  const draft = (revision: string) => JSON.stringify({ version: 4, savedAt: "2026-11-06", creationRequestId: "11111111-1111-4111-8111-111111111111", base: {}, current: {}, baseContentRevisionId: revision });
  let owned: unknown[] = [];
  const cacheModes: Array<RequestCache | undefined> = [];
  globalThis.fetch = Object.assign(async (_url: string, init?: RequestInit) => { cacheModes.push(init?.cache); return Response.json(owned); }, { preconnect: oldFetch.preconnect }) as typeof fetch;
  dom.localStorage.setItem("influence_session", "test-token");
  const auth = { ready: true, authenticated: true, account: { id: "owner" } } as import("../hooks/use-auth").InfluenceAuthState;
  const show = () => render(<InfluenceAuthContext.Provider value={auth}><OwnerAgentActions agentId="agent-1" agentName="Arden" /></InfluenceAuthContext.Provider>);
  try {
    let view = show();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(view.queryByRole("textbox")).toBeNull();
    cleanup();
    owned = [agent];
    const key = "influence:agent-editor:4:owner:edit:agent-1";
    dom.sessionStorage.setItem(key, draft("new"));
    view = show();
    await waitFor(() => expect(view.getByText("Finish your draft")).toBeTruthy());
    expect(cacheModes.every(mode => mode === "no-store")).toBe(true);
    expect(view.queryByRole("textbox")).toBeNull();
    expect(view.getByRole("link", {name: "Continue"}).getAttribute("href")).toBe("/dashboard/agents/agent-1/edit");
    dom.sessionStorage.removeItem(key);
    dom.dispatchEvent(new dom.Event("pageshow"));
    await waitFor(() => expect(view.getByRole("textbox", {name:/Describe an update/})).toBeTruthy());
    expect(dom.sessionStorage.getItem(key)).toBeNull();
    const input = view.getByRole("textbox", {name: /Describe an update/});
    fireEvent.input(input, {target:{value:"Be more cautious"}});
    fireEvent.click(view.getByRole("button", {name:/Continue/}));
    expect(routes).toEqual(["/dashboard/agents/agent-1/edit?profileRequest=1"]);
    expect(dom.sessionStorage.getItem("influence:agent-edit-request:owner:agent-1")).toBe("Be more cautious");
    cleanup();
    dom.sessionStorage.setItem(key, draft("old"));
    view = show();
    await waitFor(() => expect(view.getByText("Finish your draft")).toBeTruthy());
    expect(dom.sessionStorage.getItem(key)).not.toBeNull();
    dom.sessionStorage.setItem(key, draft("new"));
    dom.dispatchEvent(new dom.Event("pageshow"));
    await waitFor(() => expect(view.getByText("Finish your draft")).toBeTruthy());
    expect(view.queryByRole("textbox")).toBeNull();
  } finally {
    await act(async () => cleanup()); globalThis.fetch = oldFetch; dom.close();
    for (const key of globals) { const descriptor = saved.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
