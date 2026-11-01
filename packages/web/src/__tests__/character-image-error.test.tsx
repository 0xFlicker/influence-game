import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { SyntheticEvent } from "react";
import { characterImageError } from "../components/character/image-error";

let dom: Window;
const originalFetch = globalThis.fetch;
beforeEach(() => { dom = new Window({ url: "http://localhost" }); });
afterEach(() => { globalThis.fetch = originalFetch; dom.close(); });
function image() {
  const element = dom.document.createElement("img");
  element.src = "/characters/transparent.png";
  dom.document.body.append(element);
  return element as unknown as HTMLImageElement;
}
const event = (element: HTMLImageElement) => ({ currentTarget: element }) as SyntheticEvent<HTMLImageElement>;

test.each([200, 401, 429, 500, 503, 0])("image failure with status %s retains transparent art and never selects fallback", async status => {
  globalThis.fetch = (async () => { if (!status) throw new TypeError("offline"); return new Response(null, { status }); }) as unknown as typeof fetch;
  const element = image(); let fallback = false;
  await characterImageError(event(element), () => { fallback = true; });
  expect(fallback).toBe(false);
  expect(element.src).toBe("http://localhost/characters/transparent.png");
  // A repeated decode failure cannot permanently blacklist this URL.
  await characterImageError(event(element), () => { fallback = true; });
  expect(fallback).toBe(false);
  element.remove();
});
test("only a confirmed 404 permits fallback; remount retries the original transparent URL", async () => {
  let count = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => { expect(options?.method).toBe("HEAD"); count++; return new Response(null, { status: 404 }); }) as unknown as typeof fetch;
  const first = image(); let fallback = false;
  await characterImageError(event(first), () => { fallback = true; });
  expect(fallback).toBe(true); first.remove();
  const reloaded = image();
  expect(reloaded.src).toBe("http://localhost/characters/transparent.png");
  await characterImageError(event(reloaded), () => {});
  expect(count).toBe(2); reloaded.remove();
});
test("a late missing-image probe cannot replace a newer image", async () => {
  let finish!: (response: Response) => void;
  globalThis.fetch = (() => new Promise<Response>(resolve => { finish = resolve; })) as unknown as typeof fetch;
  const element = image(); let fallback = false;
  const pending = characterImageError(event(element), () => { fallback = true; });
  element.src = "/characters/new.png"; finish(new Response(null, { status: 404 }));
  await pending; expect(fallback).toBe(false); element.remove();
});
