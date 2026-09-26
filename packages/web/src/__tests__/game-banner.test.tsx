import { afterEach, beforeEach, expect, test, spyOn } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { ResultsBanner } from "../components/game-banner";
import { setApiBase } from "../lib/api";
const globals = ["window", "document", "navigator", "localStorage", "HTMLElement", "Node", "Event"] as const;
const saved = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: HappyDOMWindow;
let fetchMock: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
let createMock: ReturnType<typeof spyOn<typeof URL, "createObjectURL">>;
let revokeMock: ReturnType<typeof spyOn<typeof URL, "revokeObjectURL">>;
let count = 0;
beforeEach(() => {
  dom = new HappyDOMWindow({ url: "http://localhost" });
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: dom[key] });
  setApiBase(""); count = 0;
  fetchMock = spyOn(globalThis, "fetch"); createMock = spyOn(URL, "createObjectURL").mockImplementation(() => `blob:test-${++count}`); revokeMock = spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  cleanup(); dom.close(); fetchMock.mockRestore(); createMock.mockRestore(); revokeMock.mockRestore();
  for (const key of globals) { const value = saved.get(key); if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); }
});
const originalPreconnect = globalThis.fetch.preconnect;
function respond(handler: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>) {
  fetchMock.mockImplementation(Object.assign(handler, { preconnect: originalPreconnect }));
}
const banner = (id: string) => ({ id, altText: `Teaser ${id}`, revision: 1 });
test("late attachment appears on focus for a logged-out viewer", async () => {
  let assets: ReturnType<typeof banner>[] = [];
  const calls: string[] = [];
  respond(async (input, init) => {
    calls.push(String(input)); expect(new Headers(init?.headers).get("Authorization")).toBeNull();
    return String(input).includes("/content") ? new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } }) : Response.json({ assets });
  });
  const view = render(<ResultsBanner gameId="old-game" token={null} />);
  await waitFor(() => expect(calls.length).toBe(1)); expect(view.queryByRole("img")).toBeNull();
  assets = [banner("spoiler")]; fireEvent(window, new Event("focus"));
  await waitFor(() => expect(view.getByAltText("Teaser spoiler")).not.toBeNull()); expect(calls.at(-1)).toContain("/spoiler/content");
  view.unmount(); expect(revokeMock).toHaveBeenCalledWith("blob:test-1");
});
test("identity remount aborts stale bytes and revokes drawn URLs", async () => {
  respond(async (input) => String(input).includes("/content") ? new Response("pixels") : Response.json({ assets: [banner("signed-in")] }));
  const view = render(<ResultsBanner key="signed-in" gameId="game" token="session" />);
  await waitFor(() => expect(view.queryByRole("img")).not.toBeNull());
  respond(async () => Response.json({ assets: [] }));
  view.rerender(<ResultsBanner key="anonymous" gameId="game" token={null} />);
  expect(view.queryByRole("img")).toBeNull(); expect(revokeMock).toHaveBeenCalledWith("blob:test-1");
});
test("stale 404 after focus cannot revoke the newer image", async () => {
  let complete!: (response: Response) => void;
  let listCalls = 0;
  respond(async (input) => {
    if (String(input).includes("/content")) return new Response("pixels");
    if (++listCalls === 1) return new Promise<Response>((resolve) => { complete = resolve; });
    return Response.json({ assets: [banner("new")] });
  });
  const view = render(<ResultsBanner gameId="game" token="session" />);
  await waitFor(() => expect(listCalls).toBe(1)); fireEvent(window, new Event("focus"));
  await waitFor(() => expect(view.queryByRole("img")).not.toBeNull()); complete(new Response("", { status: 404 }));
  await Bun.sleep(20); expect(view.getByAltText("Teaser new")).not.toBeNull(); expect(revokeMock).not.toHaveBeenCalled();
});
test("a failed refresh clears old pixels and offers a recoverable retry", async () => {
  let fail = false;
  respond(async (input) => fail ? new Response("denied", { status: 403 }) : String(input).includes("/content") ? new Response("pixels") : Response.json({ assets: [banner("spoiler")] }));
  const view = render(<ResultsBanner gameId="game" token="session" />);
  await waitFor(() => expect(view.queryByRole("img")).not.toBeNull()); fail = true; fireEvent(window, new Event("focus"));
  await waitFor(() => expect(view.getByText("Retry banner")).not.toBeNull()); expect(view.queryByRole("img")).toBeNull();
  fail = false; fireEvent.click(view.getByText("Retry banner")); await waitFor(() => expect(view.queryByRole("img")).not.toBeNull());
});
