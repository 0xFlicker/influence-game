/**
 * E2E: Full Game Flow
 *
 * Three browser scenarios validating the core user journey:
 *   1. Admin creates a 6-player budget live game (via API, verified in browser)
 *   2. 6 players join the game (via API, verified in browser)
 *   3. Anonymous viewer watches game play to completion
 *
 * Run with: doppler run -- bun test src/e2e/game-flow.e2e.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestDb, destroyTestDb, type TestDB } from "./test-db.js";
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
import {
  launchBrowser,
  createAnonymousPage,
  closeBrowser,
} from "./test-browser.js";
import type { Browser, Page } from "puppeteer";
import { mkdirSync } from "fs";
import path from "path";

// Match JWT_SECRET to what test-server uses
process.env.JWT_SECRET = "e2e-test-jwt-secret";

// Screenshot directory for failure debugging
const SCREENSHOT_DIR = path.join(import.meta.dir, "../../..", "e2e-screenshots");

async function screenshotOnFailure(page: Page, name: string): Promise<void> {
  try {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `${name}-${Date.now()}.png`),
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
  testDb = await createTestDb();

  admin = await createAdminUser(testDb.db);

  servers = await startTestServers({
    databaseUrl: testDb.databaseUrl,
    adminAddress: admin.wallet.address,
    jwtSecret: "e2e-test-jwt-secret",
  });

  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  if (browser) await closeBrowser(browser);
  if (servers) await stopTestServers(servers);
  if (testDb) destroyTestDb(testDb.databaseUrl);
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
        modelTier: "budget",
        timingPreset: "fast",
        viewerMode: "live",
        visibility: "public",
      }),
    });

    expect(createRes.status).toBe(201);

    const created = (await createRes.json()) as {
      id: string;
      slug: string;
      gameNumber: number;
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
      modelTier: string;
      visibility: string;
      viewerMode: string;
      players: unknown[];
    };
    expect(detail.status).toBe("waiting");
    expect(detail.modelTier).toBe("budget");
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
          "document.body.innerText.includes('Game #') || document.body.innerText.includes('Open')",
          { timeout: 20000 },
        );

        const pageText = await getPageText(page);
        expect(pageText).toContain("Game #");

        // Navigate to game detail page by slug
        await page.goto(`${servers.webUrl}/games/${gameSlug}`, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });

        await page.waitForFunction(
          "document.body.innerText.includes('Game #')",
          { timeout: 15000 },
        );

        const detailText = await getPageText(page);
        expect(detailText).toContain("Game #");
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
          "document.body.innerText.includes('Players') && document.body.innerText.includes('alive')",
          { timeout: 20000 },
        );

        const pageText = await getPageText(page);

        // All 6 player names should be visible
        for (const name of PERSONA_NAMES) {
          expect(pageText).toContain(name);
        }

        // Player count should show 6 alive
        expect(pageText).toContain("6 alive");
      } catch (err) {
        await screenshotOnFailure(page, "scenario2-failure");
        throw err;
      } finally {
        await page.close();
      }
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // Scenario 3 — Anonymous viewer watches game to completion
  // -------------------------------------------------------------------------

  test(
    "anonymous viewer watches game to completion",
    async () => {
      // Start the game via admin API call
      const startRes = await fetch(
        `${servers.apiUrl}/api/games/${gameId}/start`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${admin.jwt}`,
          },
        },
      );

      expect(startRes.ok).toBe(true);
      const startData = (await startRes.json()) as {
        status: string;
        players: number;
      };
      expect(startData.status).toBe("in_progress");
      expect(startData.players).toBe(6);

      // Open anonymous (incognito) page — no auth
      const page = await createAnonymousPage(browser, servers.webUrl!);
      try {
        // Navigate to game page via slug
        await page.goto(`${servers.webUrl}/games/${gameSlug}`, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });

        // Assert: page loads without auth wall
        await page.waitForFunction(
          "document.body.innerText.length > 50",
          { timeout: 15000 },
        );

        const initialText = await getPageText(page);
        expect(initialText).not.toContain("Access denied");
        expect(initialText).not.toContain("Connect wallet");
        expect(initialText).toContain("Game #");

        // Poll game status via API until completion (timeout 10 min)
        const POLL_INTERVAL_MS = 5000;
        const MAX_WAIT_MS = 600_000;
        const startTime = Date.now();
        let completed = false;
        let finalGame: {
          status: string;
          winner?: string;
          currentRound: number;
        } | null = null;

        while (Date.now() - startTime < MAX_WAIT_MS) {
          const res = await fetch(`${servers.apiUrl}/api/games/${gameId}`);
          if (res.ok) {
            finalGame = (await res.json()) as typeof finalGame;
            if (finalGame!.status === "completed") {
              completed = true;
              break;
            }
            if (finalGame!.status === "cancelled") {
              await screenshotOnFailure(page, "scenario3-cancelled");
              break;
            }
          }
          await Bun.sleep(POLL_INTERVAL_MS);
        }

        expect(completed).toBe(true);
        expect(finalGame).not.toBeNull();
        expect(finalGame!.status).toBe("completed");
        expect(finalGame!.currentRound).toBeGreaterThan(0);

        // Reload page to see final results (completed game renders as replay)
        await page.goto(`${servers.webUrl}/games/${gameSlug}`, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });

        await page.waitForFunction(
          "document.body.innerText.includes('Game #') && document.body.innerText.length > 100",
          { timeout: 15000 },
        );

        const finalText = await getPageText(page);
        expect(finalText).toContain("Game #");

        // Game should show completed status
        expect(finalGame!.status).toBe("completed");
      } catch (err) {
        await screenshotOnFailure(page, "scenario3-failure");
        throw err;
      } finally {
        // Close the incognito context (not just the page)
        const context = page.browserContext();
        await context.close();
      }
    },
    660_000, // 11 minutes: 10 min game + 1 min buffer
  );
});
