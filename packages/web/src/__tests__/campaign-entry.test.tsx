import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { Window } from "happy-dom";
import { CampaignIdeaHandoff } from "../components/campaigns/campaign-idea-handoff";
import {
  campaignIdeaKey,
  SEASON_ONE_SLUG,
  seasonOneCreationHref,
} from "../components/campaigns/season-one-entry";
import type { SeasonIdentity } from "../lib/api";

const season: SeasonIdentity = {
  id: "s1",
  slug: SEASON_ONE_SLUG,
  name: "Season 1",
  status: "active",
  ratedPool: "free",
  admissionStartsAt: null,
  admissionClosesAt: null,
  finalizedAt: null,
};
test("campaign entry pins Season 1 even when another active season comes first", () => {
  const url = new URL(
    seasonOneCreationHref([{ ...season, id: "s2", slug: "season-2" }, season]),
    "https://thehouse.game",
  );
  expect(url.pathname).toBe("/agents/create");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    flow: "daily_free",
    seasonId: "s1",
    season: SEASON_ONE_SLUG,
  });
});
test("missing, closed, and future Season 1 never substitute another season", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  for (const unavailable of [
    [],
    [{ ...season, slug: "season-2" }],
    [{ ...season, status: "closing" as const }],
    [{ ...season, admissionStartsAt: "2026-11-09T00:00:00Z" }],
    [{ ...season, admissionClosesAt: "2026-11-08T12:00:00Z" }],
  ]) {
    expect(() => seasonOneCreationHref(unavailable, now)).toThrow(
      "not accepting",
    );
  }
});
const keys = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "sessionStorage",
] as const;
const saved = new Map(
  keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
let dom: Window;
beforeEach(() => {
  dom = new Window({ url: "http://localhost" });
  for (const key of keys)
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "window" ? dom : dom[key],
    });
});
afterEach(async () => {
  await act(async () => {
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  dom.close();
  for (const key of keys) {
    const descriptor = saved.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
test("idea waits for draft recovery, transfers only text, and consumes its temporary copy", async () => {
  sessionStorage.setItem(campaignIdeaKey("new"), "A magician with a secret");
  const applied: string[] = [];
  const apply = (text: string) => applied.push(text);
  const view = render(
    <CampaignIdeaHandoff
      requestId="new"
      ready={false}
      hasConversation={false}
      onApply={apply}
    />,
  );
  expect(applied).toEqual([]);
  view.rerender(
    <CampaignIdeaHandoff
      requestId="new"
      ready
      hasConversation={false}
      onApply={apply}
    />,
  );
  await waitFor(() => expect(applied).toEqual(["A magician with a secret"]));
  expect(sessionStorage.getItem(campaignIdeaKey("new"))).toBeNull();
  view.rerender(
    <CampaignIdeaHandoff
      requestId="new"
      ready
      hasConversation
      onApply={apply}
    />,
  );
  expect(applied).toHaveLength(1);
});
test("an existing conversation is not replaced without choosing the new idea", async () => {
  sessionStorage.setItem(campaignIdeaKey("new"), "A loyal underdog");
  const applied: string[] = [];
  const view = render(
    <CampaignIdeaHandoff
      requestId="new"
      ready
      hasConversation
      onApply={(text) => applied.push(text)}
    />,
  );
  expect(applied).toEqual([]);
  fireEvent.click(
    await view.findByRole("button", { name: "Use this idea in the composer" }),
  );
  expect(applied).toEqual(["A loyal underdog"]);
});
test("blocked session storage reports an actionable failure", async () => {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get() {
      throw new Error("Denied");
    },
  });
  const view = render(
    <CampaignIdeaHandoff
      requestId="new"
      ready
      hasConversation={false}
      onApply={() => {
        throw new Error("Must not apply");
      }}
    />,
  );
  expect((await view.findByRole("alert")).textContent).toContain(
    "could not be read",
  );
});

test("AI selector shows inline client setup and starter prompts remain copyable without clipboard access", async () => {
  const { AiCampaignTools } =
    await import("../components/campaigns/ai-campaign-tools");
  const view = render(<AiCampaignTools />);
  fireEvent.change(view.getByLabelText("Your AI client"), {
    target: { value: "codex" },
  });
  expect(view.queryByRole("link", { name: /Open .* setup/ })).toBeNull();
  expect(
    view.getByText(
      "codex mcp add the-house-influence --url http://localhost:3000/mcp",
    ),
  ).toBeTruthy();
  expect(view.getByText("Set up Codex")).toBeTruthy();
  fireEvent.click(view.getAllByRole("button", { name: "Use this prompt" })[2]!);
  const prompt = view.getByRole("textbox", {
    name: "Prepare for Season 1",
  }) as HTMLTextAreaElement;
  expect(prompt.value).toContain("do not substitute a different season");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  fireEvent.click(view.getByRole("button", { name: "Copy prompt" }));
  await waitFor(() =>
    expect(view.getByRole("status").textContent).toContain("manual copying"),
  );
  expect(prompt.selectionEnd - prompt.selectionStart).toBe(prompt.value.length);
});

test("a later campaign idea can be offered when the creator route is reused", async () => {
  sessionStorage.setItem(campaignIdeaKey("first"), "First idea");
  sessionStorage.setItem(campaignIdeaKey("second"), "Second idea");
  const applied: string[] = [];
  const onApply = (text: string) => applied.push(text);
  const view = render(
    <CampaignIdeaHandoff
      requestId="first"
      ready
      hasConversation={false}
      onApply={onApply}
    />,
  );
  expect(applied).toEqual(["First idea"]);
  view.rerender(
    <CampaignIdeaHandoff
      requestId="second"
      ready
      hasConversation
      onApply={onApply}
    />,
  );
  expect(await view.findByText("Second idea")).toBeTruthy();
  expect(applied).toHaveLength(1);
  fireEvent.click(
    view.getByRole("button", { name: "Use this idea in the composer" }),
  );
  expect(applied).toEqual(["First idea", "Second idea"]);
});
