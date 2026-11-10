import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { agentEditorDraftKey, discardAgentDraft, findAgentDrafts } from "../app/dashboard/agents/agent-editor-storage";

const oldWindow = globalThis.window;
let tab: Window;
const draft = (revision: string) => JSON.stringify({ version: 4, savedAt: "2026-11-06", creationRequestId: "11111111-1111-4111-8111-111111111111", base: {}, current: {}, baseContentRevisionId: revision });
beforeEach(() => { tab = new Window({ url: "http://localhost" }); Object.defineProperty(globalThis, "window", { configurable: true, value: tab }); });
afterEach(() => { tab.close(); Object.defineProperty(globalThis, "window", { configurable: true, value: oldWindow }); });

test("current drafts and pending image requests block a new edit in this tab", () => {
  const key = agentEditorDraftKey("owner", "edit:agent");
  const review = agentEditorDraftKey("owner", "review:agent:review-1");
  tab.sessionStorage.setItem(key, draft("current"));
  tab.sessionStorage.setItem(`${review}:visual-reference`, "pending");
  tab.sessionStorage.setItem(agentEditorDraftKey("other", "edit:agent"), "other owner");
  expect(findAgentDrafts("owner", "agent")).toEqual({ ok: true, scopes: ["edit:agent", "review:agent:review-1"] });
  expect(tab.sessionStorage.getItem(key)).not.toBeNull();
  expect(discardAgentDraft("owner", "review:agent:review-1")).toBe(true);
  expect(findAgentDrafts("owner", "agent")).toEqual({ ok: true, scopes: ["edit:agent"] });
});

test("stale drafts, image pointers and unknown documents remain recoverable", () => {
  const key = agentEditorDraftKey("owner", "edit:agent");
  const unknown = agentEditorDraftKey("owner", "review:agent:review-1");
  tab.sessionStorage.setItem(key, draft("old"));
  tab.sessionStorage.setItem(`${key}:visual-reference`, "pending");
  tab.sessionStorage.setItem(unknown, "not valid JSON");
  expect(findAgentDrafts("owner", "agent")).toEqual({ ok: true, scopes: ["edit:agent", "review:agent:review-1"] });
  expect(tab.sessionStorage.getItem(key)).not.toBeNull();
  expect(tab.sessionStorage.getItem(`${key}:visual-reference`)).not.toBeNull();
  expect(tab.sessionStorage.getItem(unknown)).not.toBeNull();
});

test("a draft without a known current revision remains recoverable", () => {
  const key = agentEditorDraftKey("owner", "edit:agent");
  tab.sessionStorage.setItem(key, draft("old"));
  expect(findAgentDrafts("owner", "agent")).toEqual({ ok: true, scopes: ["edit:agent"] });
});

test("an incomplete draft record is never discarded based on its revision alone", () => {
  const key = agentEditorDraftKey("owner", "edit:agent");
  tab.sessionStorage.setItem(key, JSON.stringify({ baseContentRevisionId: "old" }));
  expect(findAgentDrafts("owner", "agent")).toEqual({ ok: true, scopes: ["edit:agent"] });
  expect(tab.sessionStorage.getItem(key)).not.toBeNull();
});

test("unavailable tab storage fails closed instead of treating the agent as draft-free", () => {
  Object.defineProperty(tab, "sessionStorage", { configurable: true, get: () => { throw new Error("storage unavailable"); } });
  expect(findAgentDrafts("owner", "agent")).toEqual({ ok: false });
});
