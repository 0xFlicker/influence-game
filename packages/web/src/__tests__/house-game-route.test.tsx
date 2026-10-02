import { afterEach, expect, test } from "bun:test";
import { HouseGameRoute } from "../app/games/[slug]/house-route";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function serveIdentity(status = 200) {
  const reads: string[] = [];
  globalThis.fetch = (async input => {
    reads.push(String(input));
    return Response.json(status === 200
      ? { id: "wolf-id", slug: "wolf-game", gameKind: "werewolf" }
      : { error: "Game not found" }, { status });
  }) as typeof fetch;
  return reads;
}

test("Werewolf dispatch only reads safe identity and preserves replay intent", async () => {
  const reads = serveIdentity();
  const page = await HouseGameRoute({ slug: "wolf-game", mode: "replay", audience: "mystery", cursor: "65" });
  expect(reads).toHaveLength(1);
  expect(reads[0]).toEndWith("/api/game-entries/wolf-game");
  expect(page.props.identity).toEqual({ id: "wolf-id", slug: "wolf-game", gameKind: "werewolf" });
  expect(page.props.cursor).toBe("65");
  expect(page.props.initialGame).toBeUndefined();
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

test("unsupported Werewolf result, highlight and Influence sequence routes stop before game loaders", async () => {
  const reads = serveIdentity();
  for (const mode of ["results", "highlights"] as const) {
    await expect(HouseGameRoute({ slug: "wolf-game", mode })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  }
  await expect(HouseGameRoute({ slug: "wolf-game", mode: "replay", startSequence: 4 })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  expect(reads).toHaveLength(3);
  expect(reads.every(url => url.endsWith("/api/game-entries/wolf-game"))).toBe(true);
});
