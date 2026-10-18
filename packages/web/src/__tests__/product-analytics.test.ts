import { expect, test } from "bun:test";
import { analyticsOperation, measureProductRequest } from "../lib/product-analytics";
import { sanitizeAnalyticsProperties } from "../lib/analytics-privacy";

test("URL scrubbing removes credentials from direct and persisted acquisition properties", () => {
  const properties = {
    $current_url: "https://thehouse.game/agents/create?code=secret#token",
    $referrer: "https://example.com/private?secret=value",
    $set_once: { $initial_current_url: "https://thehouse.game/?access_token=secret" },
  };
  sanitizeAnalyticsProperties(properties);
  expect(properties).toEqual({ $current_url: "https://thehouse.game/agents/create", $referrer: "https://example.com", $set_once: { $initial_current_url: "https://thehouse.game/" } });
});

test("only known product operations are instrumented", () => {
  expect(analyticsOperation("/api/games/id/join", "POST")).toBe("influence_join");
  expect(analyticsOperation("/api/werewolf/id/join", "POST")).toBe("werewolf_join");
  expect(analyticsOperation("/api/free-queue/join", "POST")).toBe("daily_entry");
  expect(analyticsOperation("/api/agent-profiles", "GET")).toBeNull();
  expect(analyticsOperation("/api/admin/anything", "POST")).toBeNull();
});

test("SDK acquisition defaults cannot bypass the campaign allowlist", () => {
  const properties: Record<string, unknown> = { utm_source: "discord", utm_content: "private", gclid: "tracking-id",
    $set_once: { $initial_utm_term: "private", $initial_utm_source: "private@example.com", $initial_current_url: "data:text/plain,private" } };
  sanitizeAnalyticsProperties(properties);
  expect(properties).toEqual({ utm_source: "discord", $set_once: {} });
});

test("measurement preserves API values and errors without retrying mutations", async () => {
  const result = { saved: true };
  expect(await measureProductRequest("agent_save", async () => result)).toBe(result);
  const failure = new Error("private detail");
  let calls = 0;
  await expect(measureProductRequest("agent_save", async () => { calls++; throw failure; })).rejects.toBe(failure);
  expect(calls).toBe(1);
});
