import { afterEach, describe, expect, test } from "bun:test";
import sitemap from "./sitemap";
import { getAllPosts } from "../lib/updates";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("sitemap", () => {
  test("lists public entry points, published updates and current seasons without duplicates", async () => {
    globalThis.fetch = Object.assign(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.credentials).toBe("omit");
      return Response.json({ seasons: [{ slug: "season-0" }, { slug: "a season" }] });
    }, { preconnect: originalFetch.preconnect }) as typeof fetch;
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toContain("https://thehouse.game");
    expect(urls).toContain("https://thehouse.game/games");
    expect(urls).toContain("https://thehouse.game/rules?game=werewolf");
    expect(urls).toContain("https://thehouse.game/seasons?season=season-0");
    expect(urls).toContain("https://thehouse.game/games/season/season-0");
    expect(urls).toContain("https://thehouse.game/seasons?season=a%20season");
    expect(urls).toContain("https://thehouse.game/games/season/a%20season");
    for (const post of getAllPosts()) {
      expect(urls).toContain(`https://thehouse.game/updates/${encodeURIComponent(post.slug)}`);
    }
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.every((url) => url.startsWith("https://thehouse.game"))).toBe(true);
    expect(urls.some((url) => /\/(admin|dashboard|auth)(\/|$)/.test(url))).toBe(false);
  });

  test("fails clearly when public seasons cannot be read", async () => {
    globalThis.fetch = Object.assign(async () => new Response("Unavailable", { status: 503 }), { preconnect: originalFetch.preconnect }) as typeof fetch;
    await expect(sitemap()).rejects.toThrow();
    globalThis.fetch = Object.assign(async () => Response.json({ seasons: [{ slug: "" }] }), { preconnect: originalFetch.preconnect }) as typeof fetch;
    await expect(sitemap()).rejects.toThrow("Invalid public season slug");
  });
});
