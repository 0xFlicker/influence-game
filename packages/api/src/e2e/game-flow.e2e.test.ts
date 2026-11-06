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
import type { Browser, HTTPRequest, Page } from "puppeteer";
import { mkdirSync } from "fs";
import path from "path";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";

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
      players: unknown[];
    };
    expect(detail.status).toBe("waiting");
    expect(detail.modelLabel).toBe("OpenAI gpt-5.6-luna · Adaptive");
    expect(detail).not.toHaveProperty("viewerMode");
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
      const initialHtml = await fetch(`${servers.webUrl}/games`, { headers: { Accept: "text/html" } });
      const html = await initialHtml.text();
      expect(initialHtml.ok).toBe(true);
      expect(initialHtml.headers.get("cache-control")).toContain("no-store");
      expect(html).toContain("Open");
      expect(html).toContain(gameSlug);
      const hide = await fetch(`${servers.apiUrl}/api/games/${gameId}/hide`, { method: "PATCH", headers: { Authorization: `Bearer ${admin.jwt}` } });
      expect(hide.ok).toBe(true);
      try {
        const freshHtml = await fetch(`${servers.webUrl}/games`, { headers: { Accept: "text/html" } });
        expect(freshHtml.ok).toBe(true);
        expect(freshHtml.headers.get("cache-control")).toContain("no-store");
        expect(await freshHtml.text()).not.toContain(gameSlug);
      } finally {
        const unhide = await fetch(`${servers.apiUrl}/api/games/${gameId}/unhide`, { method: "PATCH", headers: { Authorization: `Bearer ${admin.jwt}` } });
        expect(unhide.ok).toBe(true);
      }
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

        // Refresh clears a now-hidden card and a later failure must not bring it back.
        const hidden = await fetch(`${servers.apiUrl}/api/games/${gameId}/hide`, { method: "PATCH", headers: { Authorization: `Bearer ${admin.jwt}` } });
        expect(hidden.ok).toBe(true);
        const failGames = (request: HTTPRequest) => {
          if (request.method() === "GET" && new URL(request.url()).pathname === "/api/public-games/page") {
            void request.respond({ status: 503, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "Fixture unavailable" }) });
          } else void request.continue();
        };
        try {
          const openRefresh = page.waitForResponse(response => {
            const url = new URL(response.url());
            return url.pathname === "/api/public-games/page" && url.searchParams.get("status") === "waiting";
          }, { timeout: 25000 });
          await page.evaluate("[...document.querySelectorAll('button')].find(item => item.textContent?.includes('Refresh games'))?.click()");
          expect((await openRefresh).ok()).toBe(true);
          await page.waitForFunction(`!document.body.innerText.includes(${JSON.stringify(gameSlug)})`, { timeout: 25000 });
          await page.setRequestInterception(true);
          page.on("request", failGames);
          await page.evaluate("[...document.querySelectorAll('button')].find(item => item.textContent?.includes('Refresh games'))?.click()");
          await page.waitForFunction("document.body.innerText.includes('Try again')", { timeout: 25000 });
          expect(await getPageText(page)).not.toContain(gameSlug);
        } finally {
          page.off("request", failGames);
          await page.setRequestInterception(false);
          const unhide = await fetch(`${servers.apiUrl}/api/games/${gameId}/unhide`, { method: "PATCH", headers: { Authorization: `Bearer ${admin.jwt}` } });
          expect(unhide.ok).toBe(true);
        }

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

  test("game library cancels a hanging sibling before polling or retrying", async () => {
    const page = await browser.newPage();
    try {
      await page.evaluateOnNewDocument(() => {
        const state: { gameCalls: number; aborted: number; seasonCalls: number; enabled: boolean; release?: () => void } = { gameCalls: 0, aborted: 0, seasonCalls: 0, enabled: false };
        const browserWindow = globalThis as unknown as { __libraryCancellation?: typeof state; fetch: typeof fetch; location: { origin: string } };
        browserWindow.__libraryCancellation = state;
        const originalFetch = browserWindow.fetch.bind(browserWindow);
        browserWindow.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, browserWindow.location.origin);
          if (state.enabled && url.pathname === "/api/games") {
            state.gameCalls++;
            if (state.gameCalls > 1) return Promise.resolve(Response.json([]));
            return new Promise<Response>((_resolve, reject) => {
              if (!init?.signal) throw new Error("Expected an abort signal");
              init.signal.addEventListener("abort", () => { state.aborted++; state.release = () => reject(new DOMException("Aborted", "AbortError")); }, { once: true });
            });
          }
          if (state.enabled && state.gameCalls > 0 && url.pathname === "/api/seasons") {
            state.seasonCalls++;
            return Promise.resolve(state.seasonCalls === 1 ? Response.json({ error: "Season service unavailable" }, { status: 503 }) : Response.json({ schemaVersion: 1, seasons: [] }));
          }
          if (state.enabled && url.pathname === "/api/werewolf-search") return Promise.resolve(Response.json([]));
          return originalFetch(input, init);
        }) as typeof fetch;
      });
      await page.goto(`${servers.webUrl}/games`, { waitUntil: "networkidle2", timeout: 30000 });
      await page.waitForSelector('[aria-label="Search games"]', { timeout: 15000 });
      // Enter and settle search first: React development mode may mount effects
      // twice. Arm the failure on the next regular poll, not during that setup.
      await page.type('[aria-label="Search games"]', "fixture");
      await page.waitForFunction("document.body.innerText.includes('No games match the current filters.') || document.body.innerText.includes('No games yet.')", { timeout: 30000 });
      await page.evaluate(() => { const state = (globalThis as { __libraryCancellation?: { enabled: boolean } }).__libraryCancellation; if (state) state.enabled = true; });
      await page.waitForFunction(() => (globalThis as { __libraryCancellation?: { aborted: number } }).__libraryCancellation?.aborted === 1, { timeout: 20000 });
      // The 10-second poll must not start another request while the aborted
      // sibling is still settling, even though its partner already failed.
      await new Promise(resolve => setTimeout(resolve, 11_000));
      expect(await page.evaluate(() => (globalThis as { __libraryCancellation?: { gameCalls: number } }).__libraryCancellation?.gameCalls)).toBe(1);
      await page.evaluate(() => (globalThis as { __libraryCancellation?: { release?: () => void } }).__libraryCancellation?.release?.());
      await page.waitForFunction("document.body.innerText.includes('Try again')", { timeout: 15000 });
      await page.evaluate("[...document.querySelectorAll('button')].find(item => item.textContent?.includes('Try again'))?.click()");
      await page.waitForFunction(() => (globalThis as { __libraryCancellation?: { gameCalls: number } }).__libraryCancellation?.gameCalls === 2, { timeout: 15000 });
      await page.waitForFunction("!document.body.innerText.includes('Try again')", { timeout: 15000 });
    } finally { await page.close(); }
  }, 120_000);

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
    const PERSONA_NAMES = [
      "Avery North",
      "Finley West",
      "Verity Lane",
      "Lyle Mercer",
      "Mina Cross",
      "Reese Calder",
    ];

    // Each player joins via API
    for (let i = 0; i < 6; i++) {
      const player = await createPlayerUser(testDb.db, i);
      const createdAgent = await createOwnedAgentProfile(testDb.db, { userId: player.userId }, {
        name: PERSONA_NAMES[i]!,
        personality: PERSONA_KEYS[i]!,
        strategyStyle: `${PERSONA_NAMES[i]} deterministic strategy`,
        personaKey: PERSONA_KEYS[i]!,
      });

      const joinRes = await fetch(
        `${servers.apiUrl}/api/games/${gameId}/join`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${player.jwt}`,
          },
          body: JSON.stringify({
            agentProfileId: createdAgent.profile.id,
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

        // Waiting games show the joined cast in the pre-show.
        await page.waitForFunction(
          "document.querySelector('[aria-label=\"Game pre-show\"]')?.innerText.includes('Cast complete') && document.querySelectorAll('.pre-show-cast-card').length === 6",
          { timeout: 20000 },
        );

        const pageText = await getPageText(page);

        // All 6 player names should be visible
        for (const name of PERSONA_NAMES) {
          expect(pageText).toContain(name);
        }

        expect(pageText).toContain("of 6 agents in the cast");
        expect(pageText).toContain("Cast complete");
      } catch (err) {
        await screenshotOnFailure(page, "scenario2-failure");
        throw err;
      } finally {
        await page.close();
      }
    }
  }, 60_000);

});
