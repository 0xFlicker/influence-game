import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window } from "happy-dom";
import { DeleteAccountSection } from "../app/dashboard/profile/delete-account-section";
import { InfluenceAuthContext, type InfluenceAuthState } from "../hooks/use-auth";
import { setApiBase } from "../lib/api";

const originalFetch = globalThis.fetch;
const names = ["window", "document", "navigator", "localStorage", "HTMLElement", "Element", "Node", "Event", "InputEvent", "CustomEvent"] as const;
const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
let dom: Window;
let logouts: number;
beforeEach(() => {
  dom = new Window({ url: "http://localhost/profile" });
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: dom[name] });
  setApiBase("");
  logouts = 0;
});
afterEach(async () => {
  await act(async () => cleanup());
  dom.close();
  globalThis.fetch = originalFetch;
  for (const name of names) { const value = saved.get(name); if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name); }
});

function mount() {
  const auth: InfluenceAuthState = {
    ready: true, authenticated: true, account: null, hydrationError: false,
    openSignIn() {}, openCreateAccount() {}, openPrivySignIn() {},
    resetPrivyIdentity: async () => {}, requestPrivyProof: async () => null,
    beginAuthenticationAttempt: () => ({ generation: "test" }),
    isAuthenticationAttemptCurrent: () => true, cancelAuthenticationAttempt() {},
    completeAuthenticationAttempt: async () => true, runFarcasterMiniAppLogin: async () => "failed",
    logout: async () => { logouts++; }, needsInvite: false, dismissInvite() {},
    submitInvite: async () => {}, inviteError: null, submittingInvite: false,
  };
  const view = render(<InfluenceAuthContext.Provider value={auth}><DeleteAccountSection /></InfluenceAuthContext.Provider>);
  fireEvent.click(view.getByRole("button", { name: "Delete my account" }));
  return view;
}

test("explains preserved games, requires exact confirmation, and submits deletion once", async () => {
  const requests: RequestInit[] = [];
  globalThis.fetch = Object.assign(async (_input: string | URL | Request, init?: RequestInit) => {
    requests.push(init!);
    return Response.json({ status: "deleted", deletedAt: "2026-11-12T12:00:00Z", providerCleanup: "pending" }, { status: 202 });
  }, { preconnect: originalFetch.preconnect });
  const view = mount();
  expect(view.getByText(/Games and competitions you have already entered may still start and finish/)).toBeTruthy();
  const button = view.getByRole("button", { name: "Permanently delete account" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.input(view.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
  await act(async () => { fireEvent.click(button); fireEvent.click(button); });
  await waitFor(() => expect(logouts).toBe(1));
  expect(requests).toHaveLength(1);
  expect(requests[0]?.method).toBe("DELETE");
  expect(JSON.parse(String(requests[0]?.body))).toEqual({ confirmation: "DELETE" });
  expect(dom.location.pathname).toBe("/account-deleted");
});

test("a stale session offers sign-out without pretending deletion succeeded", async () => {
  globalThis.fetch = Object.assign(async () => Response.json({ error: "Sign in again", code: "REAUTH_REQUIRED" }, { status: 403 }), { preconnect: originalFetch.preconnect });
  const view = mount();
  fireEvent.input(view.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
  fireEvent.click(view.getByRole("button", { name: "Permanently delete account" }));
  await waitFor(() => expect(view.getByRole("alert").textContent).toBe("Sign in again"));
  expect(logouts).toBe(0);
  expect(dom.location.pathname).toBe("/profile");
  fireEvent.click(view.getByRole("button", { name: "Sign out to sign in again" }));
  await waitFor(() => expect(logouts).toBe(1));
});
