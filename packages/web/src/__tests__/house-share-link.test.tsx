import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { createHouseShareLink } from "../lib/house-share-link";
import { shareHouseLink } from "../lib/share-link";
import { HouseShareButton } from "../components/house-share-button";

test("short-link creation sends only the validated destination and never publishes long or external URLs", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => { calls.push(String(init?.body)); return Response.json({code: "7mK9pR2xQa"}); }) as unknown as typeof fetch;
  try {
    expect(await createHouseShareLink("/games/g/replay?t=1.25&cue=id%3A35", "https://thehouse.game")).toBe("https://thehouse.game/s/7mK9pR2xQa");
    expect(JSON.parse(calls[0])).toEqual({path: "/games/g/replay?cue=id%3A35&t=1.25"});
    await expect(createHouseShareLink("https://evil.test/r", "https://thehouse.game")).rejects.toThrow();
    expect(calls).toHaveLength(1);
    globalThis.fetch = (async () => new Response("unavailable", {status: 503})) as unknown as typeof fetch;
    await expect(createHouseShareLink("/rules", "https://thehouse.game")).rejects.toThrow("Couldn't create");
    globalThis.fetch = (async () => Response.json({code: "//evil.test"})) as unknown as typeof fetch;
    await expect(createHouseShareLink("/rules", "https://thehouse.game")).rejects.toThrow();
  } finally { globalThis.fetch = original; }
});

test("native share and clipboard use the short URL; cancellation never copies", async () => {
  const input = {url: "https://thehouse.game/s/7mK9pR2xQa", title: "Moment", text: "Watch", unavailableMessage: "Select the link to copy it."};
  let shared: ShareData | undefined, copied = "";
  expect((await shareHouseLink({...input, share: async data => {shared = data;}})).tone).toBe("success");
  expect(shared?.url).toBe(input.url);
  await shareHouseLink({...input, share: async () => {throw new Error("unsupported");}, copy: async url => {copied = url;}});
  expect(copied).toBe(input.url); copied = "";
  expect((await shareHouseLink({...input, share: async () => {throw new DOMException("cancelled", "AbortError");}, copy: async url => {copied = url;}})).tone).toBe("neutral");
  expect(copied).toBe("");
  expect((await shareHouseLink({...input, copy: async () => {throw new Error("denied");}})).message).toBe(input.unavailableMessage);
});

test("icon-only share controls retain accessible names and live feedback", () => {
  const html = renderToString(<HouseShareButton href="/rules" label="Share rules" />);
  expect(html).toContain('aria-label="Share rules"');
  expect(html).toContain('<svg aria-hidden="true"');
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain("min-h-11");
});
