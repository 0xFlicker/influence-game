import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import type { WerewolfDecisionEntry } from "@influence/engine/werewolf/decisions";
import { WerewolfDecisions } from "../components/games/werewolf/werewolf-decisions";
import { setApiBase } from "../lib/api";

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
  await act(async () => cleanup());
  dom.close(); globalThis.fetch = originalFetch;
  for (const key of globals) {
    const descriptor = saved.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});
function respond(handler: (url: string) => Promise<Response>) {
  globalThis.fetch = Object.assign(handler, { preconnect: originalFetch.preconnect }) as typeof fetch;
}
const props = { gameId: "game", slug: "episode", audience: "omniscient" as const, cursor: 20,
  actorId: "doctor", players: [{ id: "doctor", name: "Doctor" }, { id: "target", name: "Marnie" }], onSeek: () => {} };
const vote: WerewolfDecisionEntry = { cursor: 5, day: 1, actorId: "doctor", action: "vote", targetId: null,
  unavailable: false, context: "Day 1 · Vote after thread 1", result: "No majority. Discussion continues.", thinking: "PRIVATE vote thought" };
const protection: WerewolfDecisionEntry = { cursor: 10, day: 1, actorId: "doctor", action: "protect", targetId: "target",
  unavailable: false, context: "Night 1 · Doctor", result: "Protection saved Marnie from the pack.", thinking: "PRIVATE protection thought" };

test("Mystery renders public votes but never thinking or night choices, even if passed extra fields", async () => {
  respond(async () => Response.json({ cursor: 20, entries: [vote, protection] }));
  const view = render(<WerewolfDecisions {...props} audience="mystery" />);
  await waitFor(() => expect(view.getByText("Hear more")).not.toBeNull());
  expect(view.container.textContent).not.toMatch(/PRIVATE|Thinking|Night|Protected|saved Marnie/);
  expect(view.getByRole("link").getAttribute("href")).toContain("audience=mystery");
});

test("Omniscient expands recorded thinking and seeks to its resolved decision", async () => {
  respond(async () => Response.json({ cursor: 20, entries: [vote, protection] }));
  const seeks: number[] = [];
  const view = render(<WerewolfDecisions {...props} onSeek={cursor => seeks.push(cursor)} />);
  await waitFor(() => expect(view.getByText("Protected Marnie")).not.toBeNull());
  const details = view.getByText("PRIVATE protection thought").closest("details")!;
  expect(details.open).toBe(false);
  fireEvent.click(details.querySelector("summary")!);
  expect(details.open).toBe(true);
  fireEvent.click(view.getByText("Night 1 · Doctor"));
  expect(seeks).toEqual([10]);
  expect(view.getAllByRole("listitem")[0]!.textContent).toContain("Protected Marnie");
});

test("rewinding and changing players clear stale entries immediately and ignore a late response", async () => {
  let finish: ((response: Response) => void) | undefined;
  respond(async () => new Promise(resolve => { finish = resolve; }));
  const view = render(<WerewolfDecisions {...props} />);
  const oldFinish = finish!;
  view.rerender(<WerewolfDecisions {...props} cursor={1} actorId="target" />);
  expect(view.getByRole("status").textContent).toBe("Loading decisions…");
  await act(async () => oldFinish(Response.json({ cursor: 20, entries: [protection] })));
  expect(view.container.textContent).not.toContain("Protected Marnie");
  await act(async () => finish!(Response.json({ cursor: 1, entries: [] })));
  expect(view.getByText("No decisions yet.")).not.toBeNull();
});

test("errors provide an explicit retry; a new response removes the failure", async () => {
  let calls = 0;
  respond(async () => { if (++calls === 1) throw new Error("Connection lost"); return Response.json({ cursor: 20, entries: [vote] }); });
  const view = render(<WerewolfDecisions {...props} />);
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Connection lost"));
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(view.getByText("Hear more")).not.toBeNull());
  expect(view.queryByRole("alert")).toBeNull();
  expect(calls).toBe(2);
});
