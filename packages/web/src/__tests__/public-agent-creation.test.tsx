import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Window } from "happy-dom";
import { AgentForm } from "../app/dashboard/agents/agent-form";
import { InfluenceAuthContext, type InfluenceAuthState } from "../hooks/use-auth";

const originalFetch = globalThis.fetch;
const globalKeys = ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "InputEvent", "localStorage"] as const;
const saved = new Map(globalKeys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: Window;
let signupCalls: number;
let paths: string[];
let signIn: () => void;
const draftKey = "influence:agent-editor:3:anonymous:create:manage:none";
const character = { name: "Mira Vale", personaKey: "diplomat", gender: "female", personality: "A warm diplomat who keeps receipts.",
  backstory: "An exiled ambassador.", strategyStyle: "Build trust.", performanceInstructions: "Quiet gestures.", visualDesign: "Blue coat.", introQuips: ["One", "Two", "Three"] };

beforeEach(() => {
  dom = new Window({ url: "http://localhost/agents/create" });
  for (const key of globalKeys) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] });
  signupCalls = 0; paths = [];
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input); paths.push(`${init?.method ?? "GET"} ${path}`);
    if (path.endsWith("/anonymous")) return Response.json(init?.method === "POST" ? { reply: "Mira builds trust at the risk of waiting too long. Does she feel right?", profile: character } : { used: false });
    if (path.endsWith("/creation-assistant")) return Response.json({ command: "clarify", reply: "Your character is ready for another choice." });
    throw new Error(`Unexpected request ${path}`);
  }, { preconnect: originalFetch.preconnect });
});
afterEach(() => {
  cleanup(); dom.close(); globalThis.fetch = originalFetch;
  for (const key of globalKeys) { const descriptor = saved.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});
function mount() {
  function Harness() {
    const [authenticated, setAuthenticated] = useState(false);
    signIn = () => { dom.localStorage.setItem("influence_session", "test-session"); setAuthenticated(true); };
    const auth = { ready: true, authenticated, account: authenticated ? { id: "new-account" } : null,
      openCreateAccount: () => { signupCalls++; } } as InfluenceAuthState;
    return <InfluenceAuthContext.Provider value={auth}><AgentForm publicPreview guided draftScope="create:manage:none" onCancel={() => {}} onSubmit={async () => {}} /></InfluenceAuthContext.Provider>;
  }
  return render(<Harness />);
}

test("arrival stays public; one preview builds cards, image request gates, and signup preserves the draft and composer", async () => {
  const view = mount();
  await waitFor(() => expect(view.getByLabelText("Message the character assistant").hasAttribute("disabled")).toBe(false));
  expect(signupCalls).toBe(0); expect(view.getByText("Your character starts here.")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Advanced create" })).toBeNull();
  fireEvent.input(view.getByLabelText("Message the character assistant"), { target: { value: "An exiled diplomat who keeps receipts" } });
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })));
  await waitFor(() => expect(view.getByRole("button", { name: "Read Name" }).textContent).toContain("Mira Vale"));
  expect(paths.filter(path => path.startsWith("POST"))).toEqual(["POST /api/agent-profiles/anonymous"]);
  expect(signupCalls).toBe(0);
  fireEvent.click(view.getByRole("button", { name: "Yes, that feels right" }));
  fireEvent.input(view.getByLabelText("Message the character assistant"), { target: { value: "A blue coat and gold rings" } });
  fireEvent.click(view.getByRole("button", { name: "Send" }));
  expect(signupCalls).toBe(1);
  expect(JSON.parse(dom.sessionStorage.getItem(draftKey)!).current.name).toBe("Mira Vale");
  expect((view.getByLabelText("Message the character assistant") as HTMLTextAreaElement).value).toBe("A blue coat and gold rings");
  await act(async () => signIn());
  expect(view.getByRole("button", { name: "Read Name" }).textContent).toContain("Mira Vale");
  expect(view.queryByText("A local draft is available.")).toBeNull();
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })));
  await waitFor(() => expect(paths).toContain("POST /api/agent-profiles/creation-assistant"));
  expect(view.getByText("Your character is ready for another choice.")).toBeTruthy();
});

test("a busy pool offers signup or later and retains the message and ingredients", async () => {
  globalThis.fetch = Object.assign(async (_input: string | URL | Request, init?: RequestInit) => Response.json(init?.method === "POST"
    ? { error: "The free House preview is busy. Create an account or try again later.", code: "anonymous_pool_busy", retryAfterSeconds: 30 } : { used: false }, { status: init?.method === "POST" ? 429 : 200 }), { preconnect: originalFetch.preconnect });
  const view = mount();
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Add Gamer ingredient" })));
  fireEvent.input(view.getByLabelText("Message the character assistant"), { target: { value: "A quiet schemer" } });
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })));
  await waitFor(() => expect(view.getByRole("button", { name: "Try again later" })).toBeTruthy());
  expect((view.getByLabelText("Message the character assistant") as HTMLTextAreaElement).value).toBe("A quiet schemer");
  expect(view.getByRole("button", { name: "Remove Gamer ingredient" })).toBeTruthy();
  expect(signupCalls).toBe(0);
  fireEvent.click(view.getByRole("button", { name: "Create a free account" }));
  expect(signupCalls).toBe(1);
});

test("a used message opens signup and restores the question without a character mutation", async () => {
  globalThis.fetch = Object.assign(async (_input: string | URL | Request, init?: RequestInit) => Response.json(init?.method === "POST"
    ? { error: "Create a free account to continue.", code: "anonymous_signup_required" } : { used: true }, { status: init?.method === "POST" ? 403 : 200 }), { preconnect: originalFetch.preconnect });
  const view = mount();
  fireEvent.input(view.getByLabelText("Message the character assistant"), { target: { value: "What is a sealed ballot?" } });
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })));
  await waitFor(() => expect(signupCalls).toBe(1));
  expect(view.getByText("Your character starts here.")).toBeTruthy();
  expect((view.getByLabelText("Message the character assistant") as HTMLTextAreaElement).value).toBe("What is a sealed ballot?");
});
