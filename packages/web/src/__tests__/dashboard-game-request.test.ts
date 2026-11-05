import { afterEach, expect, test } from "bun:test";
import { listDashboardGames } from "../app/dashboard/dashboard-game-request";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("the dashboard fetches only open and live games unless resolving a direct join link", async () => {
  const paths: string[] = [];
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
    paths.push(String(input));
    return Response.json([]);
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  await listDashboardGames(null);
  await listDashboardGames("expired-game");
  expect(paths).toEqual(["/api/games?status=waiting,in_progress", "/api/games"]);
});
