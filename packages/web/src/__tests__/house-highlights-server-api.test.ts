import { afterEach, describe, expect, it } from "bun:test";
import {
  getServerPostgameHighlights,
  resolveServerApiUrl,
  serverApiFetch,
} from "../lib/server-api";

const originalApiBackendUrl = process.env.API_BACKEND_URL;
const originalApiUrl = process.env.API_URL;
const originalNextPublicApiUrl = process.env.NEXT_PUBLIC_API_URL;
const originalFetch = globalThis.fetch;

afterEach(() => {
  restoreEnv("API_BACKEND_URL", originalApiBackendUrl);
  restoreEnv("API_URL", originalApiUrl);
  restoreEnv("NEXT_PUBLIC_API_URL", originalNextPublicApiUrl);
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
