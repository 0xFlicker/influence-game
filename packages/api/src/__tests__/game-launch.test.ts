import { afterEach, expect, test } from "bun:test";
import { setupTestDB } from "./test-utils.js";
import { assertGameLaunchConfigured, launchExactGame } from "../services/game-launch.js";
const originalFetch = globalThis.fetch;
const keys = ["NODE_ENV", "INFLUENCE_GAME_LAUNCH_URL", "INFLUENCE_GAME_LAUNCH_TOKEN", "DATABASE_URL", "CHAMPIONSHIP_GAME_LAUNCH_URL", "CHAMPIONSHIP_GAME_LAUNCH_TOKEN"] as const;
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

test("staging and unknown deployed environments cannot fall back to local launch", () => {
  delete process.env.INFLUENCE_GAME_LAUNCH_URL; delete process.env.INFLUENCE_GAME_LAUNCH_TOKEN;
  for (const environment of ["staging", "preview", "production"]) {
    process.env.NODE_ENV = environment;
    process.env.DATABASE_URL = "postgres://localhost/example";
    expect(assertGameLaunchConfigured).toThrow("explicit game launcher");
  }
  delete process.env.NODE_ENV;
  process.env.DATABASE_URL = "postgres://remote.example.test/example";
  expect(assertGameLaunchConfigured).toThrow("explicit game launcher");
  process.env.DATABASE_URL = "postgres://127.0.0.1:54320/example";
  expect(assertGameLaunchConfigured).not.toThrow();
});

test("championship launch uses its separate credential and exact acknowledgement", async () => {
  const { assertChampionshipLaunchConfigured, launchChampionshipGame } = await import("../services/championship-launch.js");
  const db = await setupTestDB();
  process.env.NODE_ENV = "staging";
  process.env.INFLUENCE_GAME_LAUNCH_URL = "https://generic.example.test/launch";
  process.env.INFLUENCE_GAME_LAUNCH_TOKEN = "generic-fixture";
  delete process.env.CHAMPIONSHIP_GAME_LAUNCH_URL; delete process.env.CHAMPIONSHIP_GAME_LAUNCH_TOKEN;
  expect(assertChampionshipLaunchConfigured).toThrow("championship launcher");
  process.env.CHAMPIONSHIP_GAME_LAUNCH_URL = "https://influence-staging.tail8a79ed.ts.net/api/internal/championships/games/launch";
  process.env.CHAMPIONSHIP_GAME_LAUNCH_TOKEN = "event-launch-fixture";
  const calls: Array<{ url: string; auth: string | null }> = [];
  globalThis.fetch = (async (url, init) => { calls.push({ url: String(url), auth: new Headers(init?.headers).get("Authorization") }); return Response.json({ accepted: true, gameId: calls.length === 1 ? "wrong" : "exact" }); }) as typeof fetch;
  await expect(launchChampionshipGame(db, "exact")).rejects.toThrow("exact game");
  await launchChampionshipGame(db, "exact");
  expect(calls.every(call => call.url === process.env.CHAMPIONSHIP_GAME_LAUNCH_URL && call.auth === "Bearer event-launch-fixture")).toBe(true);
});
