import { describe, expect, it } from "bun:test";
import { DISCORD_ATTEMPT_KEY, DISCORD_CALLBACK_KEY, newDiscordBrowserNonce, readDiscordCallback } from "../lib/discord-verification";
import { GET } from "../app/discord/callback/route";

describe("Discord browser binding", () => {
  const attempt = { accountId: "house-a", state: "s".repeat(43), nonce: "n".repeat(43) };
  function storage(accountId = attempt.accountId, state = attempt.state) {
    return { getItem: (key: string) => key === DISCORD_ATTEMPT_KEY ? JSON.stringify({ ...attempt, accountId })
      : key === DISCORD_CALLBACK_KEY ? JSON.stringify({ code: "code", state, issuer: "https://discord.com" }) : null };
  }
  it("accepts only the initiating account and state", () => {
    expect(readDiscordCallback(storage(), "house-a")?.attempt).toEqual(attempt);
    expect(() => readDiscordCallback(storage(), "house-b")).toThrow("another sign-in");
    expect(() => readDiscordCallback(storage("house-a", "wrong"), "house-a")).toThrow("another sign-in");
    expect(readDiscordCallback({ getItem: () => null }, "house-a")).toBeNull();
  });
  it("creates unpredictable URL-safe browser proofs", () => {
    const first = newDiscordBrowserNonce(), second = newDiscordBrowserNonce();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(first).not.toBe(second);
  });
  it("does not forward callback bookkeeping into the strict exchange request", () => {
    const saved = storage();
    const result = readDiscordCallback({ getItem: key => key === DISCORD_CALLBACK_KEY
      ? JSON.stringify({ code: "code", state: attempt.state, issuer: "https://discord.com", error: null }) : saved.getItem(key) }, "house-a");
    expect(Object.keys(result!.callback).sort()).toEqual(["code", "issuer", "state"]);
  });
  it("isolates the callback with no provider or analytics resources", async () => {
    const response = GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const html = await response.text();
    expect(html).toContain("location.replace('/discord/verify')");
    expect(html).not.toContain("src=");
  });
});
