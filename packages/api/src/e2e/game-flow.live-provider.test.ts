import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Browser, Page } from "puppeteer";
import { createLlmClientFromEnv } from "@influence/engine";
import { createAdminUser, createPlayerUser, type AdminUserResult } from "./test-auth.js";
import { closeBrowser, createAnonymousPage, launchBrowser } from "./test-browser.js";
import { createIsolatedTestDb, destroyIsolatedTestDb, type TestDB } from "./test-db.js";
import { startTestServers, stopTestServers, type TestServerHandles } from "./test-server.js";
import { cleanupE2eResources } from "./cleanup.js";

process.env.JWT_SECRET = "live-provider-e2e-test-secret";

let testDb: TestDB;
let servers: TestServerHandles;
let browser: Browser;
let admin: AdminUserResult;
let gameId: string;
let gameSlug: string;

beforeAll(async () => {
  if (!createLlmClientFromEnv(process.env, { providerProfileId: "openai" })) {
    throw new Error(
      "Live-provider game-flow test requires OPENAI_API_KEY for openai:gpt-5.6-luna.",
    );
  }
  testDb = await createIsolatedTestDb();
  admin = await createAdminUser(testDb.db);
  servers = await startTestServers({
    databaseUrl: testDb.databaseUrl,
    adminAddress: admin.wallet.address,
    jwtSecret: "live-provider-e2e-test-secret",
  });
  browser = await launchBrowser();

  const created = await fetch(`${servers.apiUrl}/api/games`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${admin.jwt}`,
    },
    body: JSON.stringify({
      playerCount: 6,
      modelSelection: {
        catalogId: "openai:gpt-5.6-luna",
        reasoningPolicy: "action-policy",
      },
      timingPreset: "fast",
      viewerMode: "live",
      visibility: "public",
    }),
  });
  expect(created.status).toBe(201);
  ({ id: gameId, slug: gameSlug } = await created.json() as {
    id: string;
    slug: string;
  });

  const personaKeys = [
    "strategic",
    "honest",
    "deceptive",
    "paranoid",
    "social",
    "aggressive",
  ];
  const personaNames = ["Atlas", "Finn", "Vera", "Lyra", "Mira", "Rex"];
  for (let index = 0; index < personaKeys.length; index += 1) {
    const player = await createPlayerUser(testDb.db, index);
    const joined = await fetch(`${servers.apiUrl}/api/games/${gameId}/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${player.jwt}`,
      },
      body: JSON.stringify({
        agentName: personaNames[index],
        personality: personaKeys[index],
        personaKey: personaKeys[index],
      }),
    });
    expect(joined.status).toBe(201);
  }
}, 180_000);

afterAll(async () => {
  await cleanupE2eResources([
    ["browser", async () => { if (browser) await closeBrowser(browser); }],
    ["servers", async () => { if (servers) await stopTestServers(servers); }],
    ["database", async () => { if (testDb) await destroyIsolatedTestDb(testDb.databaseUrl); }],
  ]);
});

describe("E2E: Full Game Flow (live provider)", () => {
  test("anonymous viewer watches game play to completion", async () => {
    const started = await fetch(`${servers.apiUrl}/api/games/${gameId}/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${admin.jwt}`,
      },
    });
    expect(started.ok).toBe(true);

    const page = await createAnonymousPage(browser, servers.webUrl!);
    try {
      await page.goto(`${servers.webUrl}/games/${gameSlug}`, {
        waitUntil: "networkidle2",
        timeout: 30_000,
      });
      await page.waitForSelector(
        '[data-testid="match-watch-shell"][data-watch-mode="live"]',
        { timeout: 15_000 },
      );
      const initialText = await pageText(page);
      expect(initialText).not.toContain("Access denied");
      expect(initialText).not.toContain("Connect wallet");
      expect(initialText).toContain("Watch Room");

      const startedAt = Date.now();
      let finalGame: { status: string; currentRound: number } | null = null;
      while (Date.now() - startedAt < 600_000) {
        const response = await fetch(`${servers.apiUrl}/api/games/${gameId}`);
        if (response.ok) {
          finalGame = await response.json() as { status: string; currentRound: number };
          if (finalGame?.status === "completed") break;
          if (finalGame?.status === "cancelled") break;
        }
        await Bun.sleep(5_000);
      }

      expect(finalGame?.status).toBe("completed");
      expect(finalGame?.currentRound).toBeGreaterThan(0);
      await page.goto(`${servers.webUrl}/games/${gameSlug}`, {
        waitUntil: "networkidle2",
        timeout: 30_000,
      });
      await page.waitForSelector(
        '[data-testid="match-watch-shell"][data-watch-mode="replay"]',
        { timeout: 15_000 },
      );
      expect(await pageText(page)).toContain("Replay");
    } finally {
      await page.browserContext().close();
    }
  }, 660_000);
});

async function pageText(page: Page): Promise<string> {
  return page.evaluate("document.body.innerText") as Promise<string>;
}
