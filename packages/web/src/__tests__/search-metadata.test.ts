import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { generateMetadata as rulesMetadata } from "../app/(site)/rules/page";
import { generateMetadata as resultsMetadata } from "../app/(site)/games/[slug]/results/page";
import { generateMetadata as gameLayoutMetadata } from "../app/(site)/games/[slug]/layout";
import { getHighlightsShareMetadata } from "../lib/server-share-metadata";

const originalFetch = globalThis.fetch;
const originalWebBase = process.env.WEB_BASE_URL;
afterEach(() => { globalThis.fetch = originalFetch; if(originalWebBase === undefined) delete process.env.WEB_BASE_URL; else process.env.WEB_BASE_URL=originalWebBase; });

function respond(value: unknown, status = 200) {
  globalThis.fetch = Object.assign(async () => Response.json(value, { status }), { preconnect: originalFetch.preconnect }) as typeof fetch;
}

const params = Promise.resolve({ slug: "game-id" });

describe("search metadata", () => {
  test("gives each game's rules its own canonical URL", async () => {
    expect((await rulesMetadata({ searchParams: Promise.resolve({}) })).alternates?.canonical).toBe("/rules");
    expect((await rulesMetadata({ searchParams: Promise.resolve({ game: "influence" }) })).alternates?.canonical).toBe("/rules");
    expect((await rulesMetadata({ searchParams: Promise.resolve({ game: "werewolf" }) })).alternates?.canonical).toBe("/rules?game=werewolf");
  });

  test("uses the authoritative slug for results and preserves unlisted exclusion", async () => {
    process.env.WEB_BASE_URL = "https://thehouse.game";
    respond({ id: "game-id", slug: "actual-slug", visibility: "public", gameKind: "influence" });
    expect((await resultsMetadata({ params })).alternates?.canonical).toBe("/games/actual-slug/results");
    respond({ id: "game-id", slug: "actual-slug", visibility: "unlisted", gameKind: "influence" });
    expect((await gameLayoutMetadata({ params })).robots).toEqual({ index: false, follow: true });
    respond({ error: "unavailable" }, 503);
    expect((await resultsMetadata({ params })).alternates).toBeUndefined();
    expect((await gameLayoutMetadata({ params })).robots).toEqual({ index: false, follow: false });
  });

  test("normalizes default highlights audiences while retaining selected cuts and spoiler modes", async () => {
    const cut = { id: "cut:1", title: "A moment", context: "A conversation" };
    respond({ game: { kind: "influence", slug: "a-game" }, audience: "public", publication: { cuts: [cut] } });
    const gallery = await getHighlightsShareMetadata("game-id", undefined, "public");
    expect(gallery.alternates?.canonical).toBe("/games/a-game/highlights");
    const scene = await getHighlightsShareMetadata("a-game", "cut:1", "public");
    expect(scene.alternates?.canonical).toBe("/games/a-game/highlights?scene=cut%3A1");
    expect(scene.openGraph?.url).toBe("/games/a-game/highlights?scene=cut%3A1&audience=public");
    respond({ game: { kind: "werewolf", slug: "village" }, audience: "mystery", publication: { cuts: [cut] } });
    expect((await getHighlightsShareMetadata("village", undefined, "mystery")).alternates?.canonical).toBe("/games/village/highlights");
    respond({ game: { kind: "werewolf", slug: "village" }, audience: "omniscient", publication: { cuts: [cut] } });
    expect((await getHighlightsShareMetadata("village", "cut:1", "omniscient")).alternates?.canonical).toBe("/games/village/highlights?scene=cut%3A1&audience=omniscient");
  });

  test("the published Werewolf guide points to its existing public source", () => {
    const markdown = readFileSync("docs/werewolf-rules-page-content.md", "utf8");
    expect(markdown).toContain("https://github.com/0xFlicker/influence-game/blob/main/docs/werewolf.md");
    expect(markdown).not.toContain("](werewolf.md)");
  });
});
