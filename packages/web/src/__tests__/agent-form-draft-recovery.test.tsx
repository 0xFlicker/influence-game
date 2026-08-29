import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor, type RenderResult } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { AgentForm } from "../app/dashboard/agents/agent-form";
import { InfluenceAuthContext, type InfluenceAuthState } from "../hooks/use-auth";
import type { SavedAgent } from "../lib/api";

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
const draftKey = `influence:agent-editor:1:user-1:${draftScope}`;
const proposal = "Coordinate one primary vote and one fallback.";
const draftStrategy = "Delay commitment and preserve three incompatible options.";

let domWindow: HappyDOMWindow;

beforeEach(() => {
  domWindow = new HappyDOMWindow({
    url: "http://localhost/dashboard/agents/agent-1/edit?sourceReviewId=review-1",
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: domWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: domWindow.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: domWindow.navigator });
  Object.defineProperty(globalThis, "Element", { configurable: true, value: domWindow.Element });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: domWindow.HTMLElement });
  Object.defineProperty(globalThis, "Node", { configurable: true, value: domWindow.Node });
  Object.defineProperty(globalThis, "Event", { configurable: true, value: domWindow.Event });
  Object.defineProperty(globalThis, "InputEvent", { configurable: true, value: domWindow.InputEvent });
  domWindow.sessionStorage.setItem(draftKey, JSON.stringify({
    version: 1,
    savedAt: "2026-08-28T20:00:00.000Z",
    creationRequestId: "11111111-1111-4111-8111-111111111111",
    base: snapshot(proposal),
    current: snapshot(draftStrategy),
  }));
});

afterEach(() => {
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

async function renderForm(requireChange: boolean): Promise<RenderResult> {
  let mounted!: RenderResult;
  await act(async () => {
    mounted = render(
      <InfluenceAuthContext.Provider value={auth}>
        <AgentForm
          initial={agent()}
          strategyComparison={{
            baseline: "Stay flexible until the ballot.",
            initialWorking: proposal,
            baselineLabel: "Review baseline",
            requireChange,
          }}
          draftScope={draftScope}
          onSubmit={async () => undefined}
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
