/**
 * E2E: Full Game Flow
 *
 * Two provider-free browser scenarios validating the core setup journey:
 *   1. Admin creates a 6-player budget live game (via API, verified in browser)
 *   2. 6 players join the game (via API, verified in browser)
 *
 * The live-model completion story is classified separately in
 * game-flow.live-provider.test.ts.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  createIsolatedTestDb,
  destroyIsolatedTestDb,
  type TestDB,
} from "./test-db.js";
import {
  createAdminUser,
  createPlayerUser,
  type AdminUserResult,
} from "./test-auth.js";
import {
  startTestServers,
  stopTestServers,
  type TestServerHandles,
} from "./test-server.js";
import { launchBrowser, closeBrowser } from "./test-browser.js";
import { cleanupE2eResources } from "./cleanup.js";
import type { Browser, Page } from "puppeteer";
import { mkdirSync } from "fs";
import path from "path";

// Match JWT_SECRET to what test-server uses
process.env.JWT_SECRET = "e2e-test-jwt-secret";

const SCREENSHOT_DIR = path.resolve(
  process.env.INFLUENCE_E2E_RESULTS_DIR
    ?? path.join(import.meta.dir, "../../../..", "test-results"),
  "screenshots",
);

async function screenshotOnFailure(page: Page, name: string): Promise<void> {
  try {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `${name}.png`),
      fullPage: true,
    });
  } catch {
    // Non-fatal — screenshot is for debugging only
  }
}

/** Get visible text from the page body (runs in browser context via string). */
async function getPageText(page: Page): Promise<string> {
  return page.evaluate("document.body.innerText") as Promise<string>;
}

// ---------------------------------------------------------------------------
// Shared state across sequential scenarios
// ---------------------------------------------------------------------------

let testDb: TestDB;
let servers: TestServerHandles;
let browser: Browser;
let admin: AdminUserResult;
let gameId: string;
let gameSlug: string;

// ---------------------------------------------------------------------------
// Setup & teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  testDb = await createIsolatedTestDb();

  admin = await createAdminUser(testDb.db);

  servers = await startTestServers({
    databaseUrl: testDb.databaseUrl,
    adminAddress: admin.wallet.address,
    jwtSecret: "e2e-test-jwt-secret",
  });

  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  await cleanupE2eResources([
    ["browser", async () => { if (browser) await closeBrowser(browser); }],
    ["servers", async () => { if (servers) await stopTestServers(servers); }],
    ["database", async () => { if (testDb) await destroyIsolatedTestDb(testDb.databaseUrl); }],
  ]);
});

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

describe("E2E: Full Game Flow", () => {
  // -------------------------------------------------------------------------
  // Scenario 1 — Admin creates 6-player budget live game
  // -------------------------------------------------------------------------

  test("admin creates 6-player budget game", async () => {
    // Create game via authenticated API call
    const createRes = await fetch(`${servers.apiUrl}/api/games`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${admin.jwt}`,
      },
      body: JSON.stringify({
        playerCount: 6,
        modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" },
        timingPreset: "fast",
        viewerMode: "live",
        visibility: "public",
      }),
    });

    expect(createRes.status).toBe(201);

    const created = (await createRes.json()) as {
      id: string;
      slug: string;
    };
    gameId = created.id;
    gameSlug = created.slug;

    expect(gameId).toBeTruthy();
    expect(gameSlug).toBeTruthy();

    // Verify game details via API
    const detailRes = await fetch(`${servers.apiUrl}/api/games/${gameId}`, {
      headers: { Authorization: `Bearer ${admin.jwt}` },
    });
    expect(detailRes.ok).toBe(true);

    const detail = (await detailRes.json()) as {
      status: string;
      modelLabel: string;
      visibility: string;
      viewerMode: string;
      players: unknown[];
    };
    expect(detail.status).toBe("waiting");
    expect(detail.modelLabel).toBe("OpenAI gpt-5.6-luna · Adaptive");
    expect(detail.viewerMode).toBe("live");
    expect(detail.visibility).toBe("public");

    // Verify game appears in game list
    const listRes = await fetch(`${servers.apiUrl}/api/games`);
    expect(listRes.ok).toBe(true);
    const games = (await listRes.json()) as Array<{
      id: string;
      status: string;
      playerCount: number;
    }>;
    const ourGame = games.find((g) => g.id === gameId);
    expect(ourGame).toBeDefined();
    expect(ourGame!.status).toBe("waiting");

    // Browser verification: game appears in game list page
    if (servers.webUrl) {
      const page = await browser.newPage();
      try {
        await page.goto(`${servers.webUrl}/games`, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });

        // Wait for game list to render (GamesBrowser fetches from API)
        await page.waitForFunction(
          `document.body.innerText.includes(${JSON.stringify(gameSlug)})`,
          { timeout: 20000 },
        );

        const pageText = await getPageText(page);
        expect(pageText).toContain(gameSlug);

        // Navigate to game detail page by slug
        await page.goto(`${servers.webUrl}/games/${gameSlug}`, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });

        await page.waitForFunction(
          `document.body.innerText.includes(${JSON.stringify(gameSlug)})`,
          { timeout: 15000 },
        );

        const detailText = await getPageText(page);
        expect(detailText).toContain(gameSlug);
      } catch (err) {
        await screenshotOnFailure(page, "scenario1-failure");
        throw err;
      } finally {
        await page.close();
      }
    }
  }, 90_000);

  // -------------------------------------------------------------------------
  // Scenario 2 — 6 players join the game
  // -------------------------------------------------------------------------

  test("6 players join the game", async () => {
    const PERSONA_KEYS = [
      "strategic",
      "honest",
      "deceptive",
      "paranoid",
      "social",
      "aggressive",
    ];
    const PERSONA_NAMES = ["Atlas", "Finn", "Vera", "Lyra", "Mira", "Rex"];

    // Each player joins via API
    for (let i = 0; i < 6; i++) {
      const player = await createPlayerUser(testDb.db, i);

      const joinRes = await fetch(
        `${servers.apiUrl}/api/games/${gameId}/join`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${player.jwt}`,
          },
          body: JSON.stringify({
            agentName: PERSONA_NAMES[i],
            personality: PERSONA_KEYS[i],
            personaKey: PERSONA_KEYS[i],
          }),
        },
      );

      expect(joinRes.status).toBe(201);
      const { playerId } = (await joinRes.json()) as { playerId: string };
      expect(playerId).toBeTruthy();
    }

    // Verify all 6 players via API
    const gameRes = await fetch(`${servers.apiUrl}/api/games/${gameId}`);
    expect(gameRes.ok).toBe(true);
    const game = (await gameRes.json()) as {
      players: Array<{ name: string }>;
    };
    expect(game.players).toHaveLength(6);

    const playerNames = game.players.map((p) => p.name);
    for (const name of PERSONA_NAMES) {
      expect(playerNames).toContain(name);
    }

    // Browser verification: all 6 players visible on game page
    if (servers.webUrl) {
      const page = await browser.newPage();
      try {
        await page.goto(`${servers.webUrl}/games/${gameSlug}`, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });

        // Wait for players to render in the PlayerRoster
        await page.waitForFunction(
          "document.body.innerText.toLowerCase().includes('players') && document.body.innerText.toLowerCase().includes('6 alive')",
          { timeout: 20000 },
        );

        const pageText = await getPageText(page);

        // All 6 player names should be visible
        for (const name of PERSONA_NAMES) {
          expect(pageText).toContain(name);
        }

        // Player count should show 6 alive
        expect(pageText.toLowerCase()).toContain("6 alive");
      } catch (err) {
        await screenshotOnFailure(page, "scenario2-failure");
        throw err;
      } finally {
        await page.close();
      }
    }
  }, 60_000);

});
