import { afterEach, expect, test } from "bun:test";
import { HouseGameRoute } from "../app/games/[slug]/house-route";
import { anonymousApiFetch } from "../lib/api";
import { serverApiFetch } from "../lib/server-api";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function serveIdentity(status = 200) {
  const reads: string[] = [];
  globalThis.fetch = (async input => {
    reads.push(String(input));
    return Response.json(status === 200
      ? { id: "wolf-id", slug: "wolf-game", gameKind: "werewolf", visibility: "public", title: "Card title" }
      : { error: "Game not found" }, { status });
  }) as typeof fetch;
  return reads;
}

test("Werewolf dispatch only reads safe identity and preserves replay intent", async () => {
  const reads = serveIdentity();
  const page = await HouseGameRoute({ slug: "wolf-game", mode: "replay", audience: "mystery", cursor: "65" });
  expect(reads).toHaveLength(1);
  expect(reads[0]).toEndWith("/api/game-entries/wolf-game/card?view=metadata");
  expect(page.props.identity).toEqual({ id: "wolf-id", slug: "wolf-game", gameKind: "werewolf", visibility: "public" });
  expect(page.props.cursor).toBe("65");
  expect(page.props.initialGame).toBeUndefined();
});

test("Werewolf entry seeds the public lobby before the browser loads the entry code", async () => {
  const reads: string[] = [];
  const identity = { id: "wolf-id", slug: "wolf-game", gameKind: "werewolf", visibility: "public" };
  const lobby = { id: "wolf-id", slug: "wolf-game", status: "waiting", players: [] };
  globalThis.fetch = (async input => {
    const path = new URL(String(input)).pathname;
    reads.push(path);
    if (path === "/api/game-entries/wolf-id/card") return Response.json(identity);
    if (path === "/api/werewolf/wolf-game/lobby") return Response.json(lobby);
    return Response.json({ error: "Unexpected read" }, { status: 404 });
  }) as typeof fetch;

  const page = await HouseGameRoute({ slug: "wolf-id", mode: "entry" });
  expect(reads).toEqual(["/api/game-entries/wolf-id/card", "/api/werewolf/wolf-game/lobby"]);
  expect(page.props.initialWerewolfLobby).toEqual(lobby);
});

test("anonymous 404 defers to authenticated client retry; transport failures retain their status", async () => {
  for (const status of [404, 503]) {
    const reads = serveIdentity(status);
    const page = await HouseGameRoute({ slug: "private-game", mode: "entry" });
    expect(page.props.initialStatus).toBe(status);
    expect(page.props.identity).toBeUndefined();
    expect(reads).toHaveLength(1);
  }
});

test("Werewolf results and Cuts dispatch; Influence sequences stop before loaders", async () => {
  const reads = serveIdentity();
  const results = await HouseGameRoute({slug:"wolf-game", mode:"results"});
  expect(results.props.mode).toBe("results");
  expect(results.props.initialGame).toBeUndefined();
  const cuts = await HouseGameRoute({slug:"wolf-game",mode:"highlights",audience:"omniscient"});
  expect(cuts.props.mode).toBe("highlights");
  expect(cuts.props.audience).toBe("omniscient");
  await expect(HouseGameRoute({ slug: "wolf-game", mode: "replay", startSequence: 4 })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  expect(reads).toHaveLength(3);
  expect(reads.every(url => url.endsWith("/api/game-entries/wolf-game/card?view=metadata"))).toBe(true);
});

test("an unresponsive game lookup releases the route to the client entry", async () => {
  globalThis.fetch = ((_input, options) => new Promise((_, reject) => {
    options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
  })) as typeof fetch;
  const page = await HouseGameRoute({ slug: "slow-game", mode: "entry" });
  expect(page.props.initialStatus).toBe(503);
  expect(page.props.identity).toBeUndefined();
}, 3000);

test("API reads expose a safe message for an upstream HTML 503", async () => {
  globalThis.fetch = (async () => new Response("<html><body>Upstream details</body></html>", {
    status: 503,
    headers: { "content-type": "text/html" },
  })) as typeof fetch;
  for (const request of [anonymousApiFetch, serverApiFetch]) {
    await expect(request("/api/games/game")).rejects.toMatchObject({
      status: 503,
      message: "The service is temporarily unavailable.",
    });
  }
});
