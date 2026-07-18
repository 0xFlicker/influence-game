import { afterEach, describe, expect, it } from "bun:test";
import { apiFetch } from "../lib/api";
import {
  getServerGame,
  getServerGameReplayWatchFrames,
  getServerGameTranscript,
  getServerPostgameHighlights,
  getServerPostgameMedia,
  resolveServerApiUrl,
  serverApiFetch,
} from "../lib/server-api";

const originalApiBackendUrl = process.env.API_BACKEND_URL;
const originalApiUrl = process.env.API_URL;
const originalNextPublicApiUrl = process.env.NEXT_PUBLIC_API_URL;
const originalNextRuntime = process.env.NEXT_RUNTIME;
const originalFetch = globalThis.fetch;

afterEach(() => {
  restoreEnv("API_BACKEND_URL", originalApiBackendUrl);
  restoreEnv("API_URL", originalApiUrl);
  restoreEnv("NEXT_PUBLIC_API_URL", originalNextPublicApiUrl);
  restoreEnv("NEXT_RUNTIME", originalNextRuntime);
  globalThis.fetch = originalFetch;
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

describe("server-api", () => {
  it("resolves public API URLs from the server backend env", () => {
    process.env.API_BACKEND_URL = "http://127.0.0.1:3333/";

    expect(resolveServerApiUrl("/api/games/example/postgame/highlights"))
      .toBe("http://127.0.0.1:3333/api/games/example/postgame/highlights");
  });

  it("fetches public highlights without browser auth headers", async () => {
    process.env.API_BACKEND_URL = "http://127.0.0.1:3333";
    let requestedUrl = "";
    let requestedHeaders: HeadersInit | undefined;
    let requestedSignal: AbortSignal | null | undefined;
    globalThis.fetch = (async (
      url: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      requestedUrl = String(url);
      requestedHeaders = init?.headers;
      requestedSignal = init?.signal;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await getServerPostgameHighlights("edge smoke/dusk");

    expect(requestedUrl).toBe("http://127.0.0.1:3333/api/games/edge%20smoke%2Fdusk/postgame/highlights");
    expect(requestedHeaders).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    expect(JSON.stringify(requestedHeaders)).not.toContain("Authorization");
    expect(requestedSignal).toBeInstanceOf(AbortSignal);
  });

  it("fetches public postgame media without browser auth headers", async () => {
    process.env.API_BACKEND_URL = "http://127.0.0.1:3333";
    let requestedUrl = "";
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0]) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({
        schemaVersion: 1,
        mediaType: "house_highlights_trailer",
        status: "not_requested",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await getServerPostgameMedia("edge smoke/dusk");

    expect(requestedUrl).toBe("http://127.0.0.1:3333/api/games/edge%20smoke%2Fdusk/postgame/media");
  });

  it("loads game SSR data through the server backend without caching", async () => {
    process.env.API_BACKEND_URL = "http://api:3001";
    const requests: Array<{ url: string; cache?: RequestCache }> = [];
    globalThis.fetch = (async (
      url: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      requests.push({ url: String(url), cache: init?.cache });
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await getServerGame("edge smoke/dusk");
    await getServerGameTranscript("edge smoke/dusk");
    await getServerGameReplayWatchFrames("edge smoke/dusk");

    expect(requests).toEqual([
      {
        url: "http://api:3001/api/games/edge%20smoke%2Fdusk",
        cache: "no-store",
      },
      {
        url: "http://api:3001/api/games/edge%20smoke%2Fdusk/transcript",
        cache: "no-store",
      },
      {
        url: "http://api:3001/api/games/edge%20smoke%2Fdusk/replay-watch-frames",
        cache: "no-store",
      },
    ]);
  });

  it("fails fast when the browser API client is called by Next.js SSR", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await expect(apiFetch("/api/games/demo")).rejects.toThrow(
      "apiFetch is browser-only in Next.js; use serverApiFetch for server-side requests",
    );
    expect(fetchCalled).toBe(false);
  });

  it("throws a server API error for non-ok responses", async () => {
    process.env.API_BACKEND_URL = "http://127.0.0.1:3333";
    globalThis.fetch = (async () =>
      new Response("Highlights unavailable", { status: 503 })) as unknown as typeof fetch;

    await expect(serverApiFetch("/api/games/demo/postgame/highlights"))
      .rejects.toMatchObject({
        status: 503,
        message: "Highlights unavailable",
      });
  });
});
