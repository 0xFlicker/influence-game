import { afterEach, expect, test } from "bun:test";
import { setupTestDB } from "./test-utils.js";
import { assertGameLaunchConfigured, launchExactGame } from "../services/game-launch.js";
const originalFetch = globalThis.fetch;
const keys = ["NODE_ENV", "INFLUENCE_GAME_LAUNCH_URL", "INFLUENCE_GAME_LAUNCH_TOKEN"] as const;
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
afterEach(() => { globalThis.fetch = originalFetch; for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; } });
test("production requires an explicit launcher and incomplete configuration is rejected", () => {
  process.env.NODE_ENV = "production"; delete process.env.INFLUENCE_GAME_LAUNCH_URL; delete process.env.INFLUENCE_GAME_LAUNCH_TOKEN;
  expect(assertGameLaunchConfigured).toThrow("explicit game launcher");
  process.env.INFLUENCE_GAME_LAUNCH_URL = "https://launcher.example.test/game";
  expect(assertGameLaunchConfigured).toThrow("both");
  process.env.INFLUENCE_GAME_LAUNCH_TOKEN = "fixture-only";
  expect(assertGameLaunchConfigured).not.toThrow();
});
test("external launch requires acknowledgement of the exact game and reuses delivery identity", async () => {
  const db = await setupTestDB();
  process.env.INFLUENCE_GAME_LAUNCH_URL = "https://launcher.example.test/game";
  process.env.INFLUENCE_GAME_LAUNCH_TOKEN = "fixture-only";
  const calls: RequestInit[] = [];
  globalThis.fetch = (async (_url, init) => { calls.push(init!); return Response.json({ accepted: true, gameId: calls.length === 1 ? "wrong-game" : "game-1" }); }) as typeof fetch;
  await expect(launchExactGame(db, "game-1")).rejects.toThrow("exact game");
  await launchExactGame(db, "game-1");
  expect(calls.map(call => call.body)).toEqual(['{"gameId":"game-1"}', '{"gameId":"game-1"}']);
  expect(calls.map(call => new Headers(call.headers).get("Idempotency-Key"))).toEqual(["game:game-1", "game:game-1"]);
  expect(calls.every(call => call.redirect === "error")).toBe(true);
});
