import { afterEach, expect, test } from "bun:test";
import { GET } from "../app/games/[slug]/highlights/card-image/[sceneId]/route";
import { createCardImageRenderQueue, CardImageRenderOverloadedError } from "../app/games/[slug]/highlights/card-image/card-image-render-queue";
import { houseCutsFixture } from "./house-cuts-fixture";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const request = (id = "v1-1", audience = "omniscient") => GET(new Request(`http://example.test/card.png?audience=${audience}`), { params: Promise.resolve({ slug: "edge-smoke-dusk", sceneId: id }) });
test("renders a PNG from the published audience without auth or public caching", async () => {
  let requested = "", headers: HeadersInit | undefined;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    requested = String(input); headers = init?.headers; return Response.json(houseCutsFixture("omniscient"));
  }) as unknown as typeof fetch;
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("image/png");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(requested).toContain("/cuts?audience=omniscient");
  expect(JSON.stringify(headers)).not.toContain("Authorization");
  expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000);
});
test("unknown or hidden cards return 404 and upstream failures remain retryable", async () => {
  globalThis.fetch = (async () => Response.json(houseCutsFixture())) as unknown as typeof fetch;
  expect((await request("missing")).status).toBe(404);
  for (const status of [404, 503]) {
    globalThis.fetch = (async () => new Response(null, { status })) as unknown as typeof fetch;
    const response = await request();
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toContain("no-store");
  }
});
test("coalesces same renders, bounds queued work, and recovers after failure", async () => {
  const queue = createCardImageRenderQueue<string>({ maxQueued: 1 });
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const first = queue.run("a", async () => { await gate; return "a"; });
  const same = queue.run("a", async () => "wrong");
  const second = queue.run("b", async () => "b");
  await expect(queue.run("c", async () => "c")).rejects.toBeInstanceOf(CardImageRenderOverloadedError);
  release();
  expect(await Promise.all([first, same, second])).toEqual(["a", "a", "b"]);
  await expect(queue.run("failure", async () => { throw Error("failed"); })).rejects.toThrow();
  expect(await queue.run("failure", async () => "recovered")).toBe("recovered");
});
