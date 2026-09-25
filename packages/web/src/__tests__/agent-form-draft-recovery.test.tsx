import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor, within, type RenderResult } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { AgentForm } from "../app/dashboard/agents/agent-form";
import { InfluenceAuthContext, type InfluenceAuthState } from "../hooks/use-auth";
import type { SavedAgent, AgentProfileWriteParams } from "../lib/api";

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
const auth = { account: { id: "user-1" } } as InfluenceAuthState;
const draftScope = "review:agent-1:review-1";
const draftKey = `influence:agent-editor:3:user-1:${draftScope}`;
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
  domWindow.sessionStorage.setItem(draftKey, JSON.stringify({
    version: 3,
    savedAt: "2026-08-28T20:00:00.000Z",
    creationRequestId: "11111111-1111-4111-8111-111111111111",
    base: snapshot(proposal),
    current: snapshot(draftStrategy),
  }));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalLocalStorage });
  cleanup();
  domWindow.close();
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  Object.defineProperty(globalThis, "Element", { configurable: true, value: originalElement });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: originalHTMLElement });
  Object.defineProperty(globalThis, "Node", { configurable: true, value: originalNode });
  Object.defineProperty(globalThis, "Event", { configurable: true, value: originalEvent });
  Object.defineProperty(globalThis, "InputEvent", { configurable: true, value: originalInputEvent });
});

describe("AgentForm draft recovery", () => {
  test("applies a review draft without destabilizing Strategy status", async () => {
    const mounted = await renderForm(true);
    expect(mounted.getByLabelText("Saved local draft")).not.toBeNull();
    expect(mounted.getByRole("button", { name: "Apply draft" })).not.toBeNull();
    expect(mounted.getByRole("button", { name: "Clear draft" })).not.toBeNull();

    const strategy = mounted.getByRole("textbox", { name: "Strategy" }) as HTMLTextAreaElement;
    fireEvent.click(mounted.getByRole("button", { name: "Apply draft" }));
    await waitFor(() => expect(strategy.value).toBe(draftStrategy));

    expect(mounted.queryByLabelText("Saved local draft")).toBeNull();
    expect((mounted.getByRole("button", { name: "Save strategy update" }) as HTMLButtonElement).disabled).toBe(false);
    expect(mounted.getByText("Custom Strategy change ready to save.").className).toContain("min-h-5");
  });

  test("keeps a valid form savable while offering a draft and clears it explicitly", async () => {
    const mounted = await renderForm(false);

    expect(mounted.getByLabelText("Saved local draft")).not.toBeNull();
    expect((mounted.getByRole("button", { name: "Save strategy update" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(mounted.getByRole("button", { name: "Clear draft" }));
    await waitFor(() => expect(mounted.queryByLabelText("Saved local draft")).toBeNull());

    expect(domWindow.sessionStorage.getItem(draftKey)).toBeNull();
    expect((mounted.getByRole("textbox", { name: "Strategy" }) as HTMLTextAreaElement).value).toBe(proposal);
  });
});

async function renderForm(requireChange: boolean, onSubmit: (params: AgentProfileWriteParams) => Promise<void> = async () => {}, emptyText = false): Promise<RenderResult> {
  let mounted!: RenderResult;
  await act(async () => {
    mounted = render(
      <InfluenceAuthContext.Provider value={auth}>
        <AgentForm
          initial={emptyText ? { ...agent(), name: "", backstory: "", personality: "", strategyStyle: "" } : agent()}
          strategyComparison={{
            baseline: "Stay flexible until the ballot.",
            initialWorking: emptyText ? "" : proposal,
            baselineLabel: "Review baseline",
            requireChange,
          }}
          draftScope={draftScope}
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

function snapshot(strategyStyle: string) {
  return {
    name: "Arden",
    backstory: "A careful negotiator.",
    personality: "Calm and precise.",
    strategyStyle,
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


describe("atomic character draft generation", () => {
  async function ready(onSubmit?: (params: AgentProfileWriteParams) => Promise<void>) {
    domWindow.sessionStorage.removeItem(draftKey);
    return renderForm(false, onSubmit);
  }
  async function sendChangeRequest(view: RenderResult, prompt = "Make Arden more decisive in Mingle.") {
    const input = view.getByRole("textbox", { name: "What would you like to change about this Agent?" });
    expect((input as HTMLTextAreaElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.click(input);
      fireEvent.focus(input);
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByRole("button", { name: "Send Agent request" })).toBeTruthy());
    await act(async () => {
      fireEvent.input(input, { target: { value: prompt } });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect((view.getByRole("textbox", { name: "What would you like to change about this Agent?" }) as HTMLTextAreaElement).value).toBe(prompt);
      expect((view.getByRole("button", { name: "Send Agent request" }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(view.getByRole("button", { name: "Send Agent request" }));
  }
  test("in-flight generation permits draft saving but blocks profile submission; cancellation is confirmed and late results are fenced", async () => {
    let resolve!: (response: Response) => void;
    globalThis.fetch = (() => new Promise<Response>((done) => { resolve = done; })) as unknown as typeof fetch;
    const submissions: AgentProfileWriteParams[] = [];
    const view = await ready(async (params) => { submissions.push(params); });
    fireEvent.click(view.getByRole("button", { name: "Generate full-body reference" }));
    await waitFor(() => expect(view.getByRole("button", { name: "Save strategy update" }).hasAttribute("disabled")).toBe(true));
    fireEvent.click(view.getByRole("button", { name: "Save draft" }));
    expect(JSON.parse(domWindow.sessionStorage.getItem(draftKey)!).generationDeadline).toBeGreaterThan(Date.now());
    expect(submissions).toHaveLength(0);
    fireEvent.click(view.getByRole("button", { name: "Cancel generation" }));
    expect(view.getByRole("dialog").textContent).toContain("may still consume your allowance");
    fireEvent.click(view.getByRole("button", { name: "Keep editing" }));
    expect(view.getByRole("button", { name: "Save strategy update" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Cancel generation" }));
    fireEvent.click(view.getAllByRole("button", { name: "Cancel generation" }).at(-1)!);
    await act(async () => { resolve(Response.json({ fullBodyReferenceUrl: "/late.png" })); });
    fireEvent.click(view.getByRole("button", { name: "Save draft" }));
    const stored = JSON.parse(domWindow.sessionStorage.getItem(draftKey)!);
    expect(stored.current.fullBodyReferenceUrl).toBeNull();
    expect(stored.unfinishedReplacement).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Save strategy update" }));
    expect(view.getByRole("dialog").textContent).toContain("Save without");
    fireEvent.click(view.getByRole("button", { name: "Keep editing" }));
    expect(submissions).toHaveLength(0);
    fireEvent.click(view.getByRole("button", { name: "Save strategy update" }));
    fireEvent.click(view.getByRole("button", { name: "Save selected assets" }));
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0]!.fullBodyReferenceUrl).toBeNull();
    expect(submissions[0]!.avatarGenerationRequestId).toBeUndefined();
    await waitFor(() => expect(domWindow.sessionStorage.getItem(`${draftKey}:visual-reference`)).toBeNull());
    expect(domWindow.sessionStorage.getItem(`${draftKey}:interrupted`)).toBeNull();
    expect(domWindow.sessionStorage.getItem(draftKey)).toBeNull();
    view.unmount();
    const reopened = await renderForm(false);
    let refinements = 0;
    globalThis.fetch = (async () => { refinements++; return Response.json({ error: "Test stops before image generation" }, { status: 503 }); }) as unknown as typeof fetch;
    await sendChangeRequest(reopened);
    await waitFor(() => expect(refinements).toBe(1));
  });
  test.each(["clear", "discard"])("%s retires an abandoned reference and permits AI refinement", async (action) => {
    domWindow.sessionStorage.setItem(`${draftKey}:visual-reference`, JSON.stringify({ requestId: "abandoned-request" }));
    domWindow.sessionStorage.setItem(`${draftKey}:interrupted`, String(Date.now()));
    const view = await renderForm(false);
    if (action === "clear") {
      fireEvent.click(view.getByRole("button", { name: "Clear draft" }));
    } else {
      fireEvent.click(view.getByRole("button", { name: "Apply draft" }));
      fireEvent.click(view.getByRole("button", { name: "Cancel" }));
      fireEvent.click(view.getByRole("button", { name: "Keep editing" }));
      expect(domWindow.sessionStorage.getItem(`${draftKey}:visual-reference`)).not.toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Cancel" }));
      fireEvent.click(view.getByRole("button", { name: "Discard" }));
    }
    expect(domWindow.sessionStorage.getItem(`${draftKey}:visual-reference`)).toBeNull();
    expect(domWindow.sessionStorage.getItem(`${draftKey}:interrupted`)).toBeNull();
    let refinements = 0;
    globalThis.fetch = (async () => { refinements++; return Response.json({ error: "Test stops before image generation" }, { status: 503 }); }) as unknown as typeof fetch;
    if (action === "discard") {
      view.unmount();
      const reopened = await renderForm(false);
      await sendChangeRequest(reopened);
    } else {
      await sendChangeRequest(view);
    }
    await waitFor(() => expect(refinements).toBe(1));
  });
  test.each([false, true])("AI completes every field and both images while preserving the selected reference (text initially empty: %s)", async (emptyText) => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const profile = { name: "Arden Vale", backstory: "New history", personality: "Calm", strategyStyle: "Alliance first", personaKey: "diplomat", gender: "non-binary", performanceInstructions: "Measured delivery", visualDesign: "A green coat", introQuips: ["I have a plan.", "Let's make this interesting.", "I keep my promises and my options open."] };
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/portrait-crop")) {
        const { headRectangle, ...portraitCrop } = JSON.parse(String(init?.body));
        return Response.json({ avatarUrl: "/face.png", portraitCrop, headPosition: { sourceUrl: portraitCrop.sourceUrl, sourceHash: "a".repeat(64), sourceWidth: 1000, sourceHeight: 1500, rect: headRectangle } });
      }
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json(String(url).endsWith("/generate") ? profile : { fullBodyReferenceUrl: "/body.png", avatarUrl: "/face.png", portraitCrop: { sourceUrl: "/body.png", x: 0.3, y: 0.05, width: 0.4, height: 0.3 }, cropWarning: null });
    }) as unknown as typeof fetch;
    const submissions: AgentProfileWriteParams[] = [];
    domWindow.sessionStorage.removeItem(draftKey);
    const view = await renderForm(false, async (params) => { submissions.push(params); }, emptyText);
    expect((view.getByLabelText("Also generate a full-body reference") as HTMLInputElement).checked).toBe(true);
    await sendChangeRequest(view, emptyText ? "Create a charming negotiator." : "Make Arden more decisive in Mingle.");
    await waitFor(() => expect(calls).toHaveLength(2));
    await confirmHeadInEditor(view);
    await waitFor(() => expect(view.getByRole("button", { name: "Save strategy update" }).hasAttribute("disabled")).toBe(false));
    expect((view.getByLabelText("Character performance") as HTMLTextAreaElement).value).toBe(profile.performanceInstructions);
    expect((view.getByLabelText("Visual design") as HTMLTextAreaElement).value).toBe(profile.visualDesign);
    expect(calls[0]!.body.existingProfile).toMatchObject({ avatarUrl: "/avatars/arden.png" });
    expect(calls[1]!.body).toMatchObject({ visualDesign: profile.visualDesign, performanceInstructions: profile.performanceInstructions, avatarUrl: "/avatars/arden.png" });
    expect(submissions).toHaveLength(0);
    fireEvent.click(view.getByRole("button", { name: "Save strategy update" }));
    await waitFor(() => expect(submissions).toHaveLength(1));
    const savedProfile = { name: profile.name, backstory: profile.backstory, personality: profile.personality, strategyStyle: profile.strategyStyle, personaKey: profile.personaKey, gender: profile.gender, performanceInstructions: profile.performanceInstructions, visualDesign: profile.visualDesign };
    expect(submissions[0]).toMatchObject({ ...savedProfile, avatarUrl: "/face.png", fullBodyReferenceUrl: "/body.png", portraitCrop: { sourceUrl: "/body.png" } });
  });
  test("the larger portrait editor exports the selected source crop into the draft only", async () => {
    const submissions: AgentProfileWriteParams[] = [];
    let cropBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, options) => {
      cropBody = JSON.parse(String(options?.body));
      return Response.json({ avatarUrl: "/manual-face.png", portraitCrop: cropBody });
    }) as typeof fetch;
    const view = await ready(async (params) => { submissions.push(params); });
    fireEvent.click(view.getByRole("button", { name: "Edit Arden portrait" }));
    const source = view.getByAltText("Arden full image");
    Object.defineProperty(source, "naturalWidth", { value: 1000 });
    Object.defineProperty(source, "naturalHeight", { value: 1500 });
    fireEvent.load(source);
    fireEvent.input(view.getByRole("slider", { name: "Vertical position" }), { target: { value: "100" } });
    fireEvent.click(view.getByRole("button", { name: "Use portrait in draft" }));
    await waitFor(() => expect(view.container.querySelector("dialog") === null).toBe(true));
    expect(cropBody).toMatchObject({ sourceUrl: "/avatars/arden.png", y: 100 / 1500 });
    expect(Number(cropBody?.width) * 1000).toBeCloseTo(Number(cropBody?.height) * 1500);
    expect(submissions).toHaveLength(0);
    fireEvent.click(view.getByRole("button", { name: "Save strategy update" }));
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0]).toMatchObject({ avatarUrl: "/manual-face.png", portraitCrop: cropBody });
  });
  test.each([false, true])("restoring a new full-body draft preserves head proposal and confirmation: %s", async confirmed => {
    const head = { sourceUrl: "/draft-body.png", sourceHash: "a".repeat(64), sourceWidth: 1000, sourceHeight: 1500, rect: { x: .35, y: .04, width: .3, height: .16 } };
    const stored = JSON.parse(domWindow.sessionStorage.getItem(draftKey)!);
    stored.current = { ...stored.current, fullBodyReferenceUrl: head.sourceUrl, headPosition: confirmed ? head : null, headSuggestion: confirmed ? null : head };
    domWindow.sessionStorage.setItem(draftKey, JSON.stringify(stored));
    const view = await renderForm(false);
    fireEvent.click(view.getByRole("button", { name: "Apply draft" }));
    await waitFor(() => expect(view.getByRole("button", { name: "Save strategy update" }).hasAttribute("disabled")).toBe(!confirmed));
    fireEvent.click(view.getByRole("button", { name: "Save draft" }));
    const recovered = JSON.parse(domWindow.sessionStorage.getItem(draftKey)!).current;
    expect(recovered.headPosition).toEqual(confirmed ? head : null);
    expect(recovered.headSuggestion).toEqual(confirmed ? null : head);
  });
  test("successful generation stays in the draft until final submission", async () => {
    globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
      if (String(url).endsWith("/portrait-crop")) {
        const { headRectangle, ...portraitCrop } = JSON.parse(String(options?.body));
        return Response.json({ avatarUrl: "/portrait.png", portraitCrop, headPosition: { sourceUrl: portraitCrop.sourceUrl, sourceHash: "a".repeat(64), sourceWidth: 1000, sourceHeight: 1500, rect: headRectangle } });
      }
      return Response.json({ fullBodyReferenceUrl: "/completed.png", avatarUrl: "/portrait.png", portraitCrop: { sourceUrl: "/completed.png", x: 0.3, y: 0.1, width: 0.4, height: 0.3 }, cropWarning: null }); }) as unknown as typeof fetch;
    const submissions: AgentProfileWriteParams[] = [];
    const view = await ready(async (params) => { submissions.push(params); });
    fireEvent.click(view.getByRole("button", { name: "Generate full-body reference" }));
    await confirmHeadInEditor(view);
    await waitFor(() => expect(view.getByRole("button", { name: "Save strategy update" }).hasAttribute("disabled")).toBe(false));
    expect(submissions).toHaveLength(0);
    fireEvent.click(view.getByRole("button", { name: "Save strategy update" }));
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0]!.fullBodyReferenceUrl).toBe("/completed.png");
    expect(submissions[0]!.submissionId).toBeTruthy();
  });
  test("a generation failure requires confirmation and a failed save retains the same submission ID", async () => {
    globalThis.fetch = (async () => Response.json({ error: "Provider unavailable" }, { status: 503 })) as unknown as typeof fetch;
    const submissions: AgentProfileWriteParams[] = [];
    const view = await ready(async (params) => { submissions.push(params); throw new Error("Save unavailable"); });
    fireEvent.click(view.getByRole("button", { name: "Generate full-body reference" }));
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Provider unavailable"));
    for (let i = 0; i < 2; i++) {
      fireEvent.click(view.getByRole("button", { name: "Save strategy update" }));
      fireEvent.click(view.getByRole("button", { name: "Save selected assets" }));
      await waitFor(() => expect(submissions).toHaveLength(i + 1));
      await waitFor(() => expect(view.getByRole("button", { name: "Save strategy update" }).hasAttribute("disabled")).toBe(false));
    }
    expect(submissions[0]!.submissionId).toBe(submissions[1]!.submissionId);
    expect(domWindow.sessionStorage.getItem(draftKey)).not.toBeNull();
    expect(domWindow.sessionStorage.getItem(`${draftKey}:visual-reference`)).not.toBeNull();
  });
  test("restoring an interrupted upload preserves the old assets and requires confirmation", async () => {
    const stored = JSON.parse(domWindow.sessionStorage.getItem(draftKey)!);
    stored.uploadPending = true;
    domWindow.sessionStorage.setItem(draftKey, JSON.stringify(stored));
    const submissions: AgentProfileWriteParams[] = [];
    const view = await renderForm(false, async (params) => { submissions.push(params); });
    fireEvent.click(view.getByRole("button", { name: "Apply draft" }));
    expect(view.getByText(/previous preparation was interrupted/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Save strategy update" }));
    expect(submissions).toHaveLength(0);
    fireEvent.click(view.getByRole("button", { name: "Save selected assets" }));
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0]!.avatarUrl).toBe("/avatars/arden.png");
    expect(submissions[0]!.fullBodyReferenceUrl).toBeNull();
  });
  test("the cancellation marker fences a pending portrait when reopening a draft", async () => {
    const stored = JSON.parse(domWindow.sessionStorage.getItem(draftKey)!);
    stored.generationDeadline = Date.now() + 60_000;
    stored.draftAvatarCompletion = { status: "accepted", generationRequestId: "pending-id" };
    domWindow.sessionStorage.setItem(draftKey, JSON.stringify(stored));
    domWindow.sessionStorage.setItem(`${draftKey}:interrupted`, String(Date.now()));
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return Response.json({}); }) as unknown as typeof fetch;
    const view = await renderForm(false);
    fireEvent.click(view.getByRole("button", { name: "Apply draft" }));
    fireEvent.click(view.getByRole("button", { name: "Save draft" }));
    const restored = JSON.parse(domWindow.sessionStorage.getItem(draftKey)!);
    expect(restored.draftAvatarCompletion).toBeNull();
    expect(restored.current.explicitAvatarUrl).toBe("/avatars/arden.png");
    expect(calls).toBe(0);
  });
  test("a pending portrait times out and cannot apply a late poll response", async () => {
    const stored = JSON.parse(domWindow.sessionStorage.getItem(draftKey)!);
    stored.generationDeadline = Date.now() + 3_000;
    stored.draftAvatarCompletion = { status: "accepted", generationRequestId: "pending-id" };
    domWindow.sessionStorage.setItem(draftKey, JSON.stringify(stored));
    let resolve!: (response: Response) => void;
    globalThis.fetch = (() => new Promise<Response>((done) => { resolve = done; })) as unknown as typeof fetch;
    const view = await renderForm(false);
    fireEvent.click(view.getByRole("button", { name: "Apply draft" }));
    await waitFor(() => expect(view.getByRole("button", { name: "Save strategy update" }).hasAttribute("disabled")).toBe(true));
    await waitFor(() => expect(view.getByText(/Generation timed out/)).toBeTruthy(), { timeout: 4_000 });
    await act(async () => { resolve(Response.json({ avatarCompletion: { status: "completed", avatarUrl: "/too-late.png" } })); });
    fireEvent.click(view.getByRole("button", { name: "Save draft" }));
    const result = JSON.parse(domWindow.sessionStorage.getItem(draftKey)!);
    expect(result.current.explicitAvatarUrl).toBe("/avatars/arden.png");
    expect(result.draftAvatarUrl).toBeUndefined();
    expect(result.unfinishedReplacement).toBe(true);
  });
  test("a pending upload blocks submission and its failed result preserves the selected portrait", async () => {
    let resolve!: (response: Response) => void;
    globalThis.fetch = (() => new Promise<Response>((done) => { resolve = done; })) as unknown as typeof fetch;
    const view = await ready();
    const input = view.container.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["png"], "portrait.png", { type: "image/png" })] } });
    await waitFor(() => expect(view.getByRole("button", { name: "Save strategy update" }).hasAttribute("disabled")).toBe(true));
    fireEvent.click(view.getByRole("button", { name: "Save draft" }));
    expect(JSON.parse(domWindow.sessionStorage.getItem(draftKey)!).uploadPending).toBe(true);
    await act(async () => { resolve(Response.json({ error: "Upload unavailable" }, { status: 503 })); });
    await waitFor(() => expect(view.getByRole("button", { name: "Save strategy update" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(view.getByRole("button", { name: "Save draft" }));
    expect(JSON.parse(domWindow.sessionStorage.getItem(draftKey)!).current.explicitAvatarUrl).toBe("/avatars/arden.png");
    fireEvent.click(view.getByRole("button", { name: "Save strategy update" }));
    expect(view.getByRole("dialog").textContent).toContain("Save without");
  });
  test("expired restored generations cannot poll or apply late assets", async () => {
    const stored = JSON.parse(domWindow.sessionStorage.getItem(draftKey)!);
    stored.generationDeadline = Date.now() - 1;
    stored.draftAvatarCompletion = { status: "accepted", generationRequestId: "pending-id" };
    domWindow.sessionStorage.setItem(draftKey, JSON.stringify(stored));
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return Response.json({}); }) as unknown as typeof fetch;
    const view = await renderForm(false);
    fireEvent.click(view.getByRole("button", { name: "Apply draft" }));
    expect(view.getByText(/previous preparation was interrupted/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Save strategy update" }));
    expect(view.getByRole("dialog").textContent).toContain("Save without");
    expect(calls).toBe(0);
  });
});

async function confirmHeadInEditor(view: RenderResult) {
  await waitFor(() => expect(view.getByRole("dialog")).toBeTruthy());
  const editor = within(view.getByRole("dialog"));
  expect(view.getByRole("button", { name: "Save strategy update" }).hasAttribute("disabled")).toBe(true);
  const source = view.getByAltText(/full image$/);
  Object.defineProperty(source, "naturalWidth", { value: 1000 });
  Object.defineProperty(source, "naturalHeight", { value: 1500 });
  fireEvent.load(source);
  expect(editor.getByRole("heading", { name: "Adjust character images" })).toBeTruthy();
  expect(editor.queryByRole("button", { name: "Adjust framing" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Head position" }));
  fireEvent.click(view.getByText("Precise adjustments"));
  fireEvent.input(view.getByRole("slider", { name: "Head vertical position" }), { target: { value: "0.12" } });
  fireEvent.click(editor.getByRole("button", { name: "Confirm this headshot" }));
  await waitFor(() => expect(view.container.querySelector("dialog") === null).toBe(true));
}
