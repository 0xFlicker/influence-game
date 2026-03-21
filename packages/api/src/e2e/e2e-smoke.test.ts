/**
 * E2E Infrastructure Smoke Test
 *
 * Validates that all e2e test helpers work together:
 * - Create a test DB with migrations and RBAC seeding
 * - Create admin and player users with JWTs
 * - Start API server against the test DB
 * - Make authenticated API requests
 * - Launch Puppeteer browser
 * - Tear everything down cleanly
 */

import { describe, test, expect, afterAll } from "bun:test";
import { createTestDb, destroyTestDb, type TestDB } from "./test-db.js";
import {
  createAdminUser,
  createPlayerUser,
  generateTestWallet,
  createTestUser,
  assignRole,
  mintTestJwt,
} from "./test-auth.js";
import {
  startTestServers,
  stopTestServers,
  type TestServerHandles,
} from "./test-server.js";
import { launchBrowser, closeBrowser } from "./test-browser.js";
import type { Browser } from "puppeteer";

// Set JWT_SECRET for token minting (must match what test-server uses)
process.env.JWT_SECRET = "e2e-test-jwt-secret";

// Track resources for cleanup
let testDb: TestDB | null = null;
let serverHandles: TestServerHandles | null = null;
let browser: Browser | null = null;

afterAll(async () => {
  if (browser) await closeBrowser(browser);
  if (serverHandles) await stopTestServers(serverHandles);
  if (testDb) destroyTestDb(testDb.dbPath);
});

describe("e2e infrastructure smoke test", () => {
  test("createTestDb creates a DB with migrations and RBAC", () => {
    testDb = createTestDb();
    expect(testDb.db).toBeTruthy();
    expect(testDb.dbPath).toContain("/tmp/influence-e2e-");
  });

  test("generateTestWallet produces valid Ethereum wallet", () => {
    const wallet = generateTestWallet();
    expect(wallet.privateKey).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test("createAdminUser creates user with sysop role and JWT", async () => {
    const admin = await createAdminUser(testDb!.db);
    expect(admin.userId).toBeTruthy();
    expect(admin.wallet.address).toMatch(/^0x/);
    expect(admin.jwt).toBeTruthy();
    expect(admin.jwt.split(".")).toHaveLength(3);
  });

  test("createPlayerUser creates user with player role and JWT", async () => {
    const player = await createPlayerUser(testDb!.db, 0);
    expect(player.userId).toBeTruthy();
    expect(player.wallet.address).toMatch(/^0x/);
    expect(player.jwt).toBeTruthy();
    expect(player.jwt.split(".")).toHaveLength(3);
  });

  test("createTestUser and assignRole work independently", () => {
    const wallet = generateTestWallet();
    const userId = createTestUser(testDb!.db, {
      walletAddress: wallet.address,
      displayName: "Independent Test User",
    });
    expect(userId).toBeTruthy();

    // Should not throw
    assignRole(testDb!.db, {
      walletAddress: wallet.address,
      roleName: "player",
    });
  });

  test("mintTestJwt creates a valid JWT", async () => {
    const jwt = await mintTestJwt("test-user-123", {
      roles: ["admin"],
      permissions: ["create_game"],
    });
    expect(jwt).toBeTruthy();
    expect(jwt.split(".")).toHaveLength(3);
  });

  test("startTestServers starts API and responds to health check", async () => {
    const admin = await createAdminUser(testDb!.db);

    serverHandles = await startTestServers({
      dbPath: testDb!.dbPath,
      adminAddress: admin.wallet.address,
      jwtSecret: "e2e-test-jwt-secret",
      skipWeb: true, // Skip web server for smoke test speed
    });

    expect(serverHandles.apiUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(serverHandles.apiProcess.pid).toBeTruthy();

    // Verify the API actually responds
    const healthRes = await fetch(`${serverHandles.apiUrl}/health`);
    expect(healthRes.ok).toBe(true);

    const health = (await healthRes.json()) as { status: string; service: string };
    expect(health.status).toBe("ok");
    expect(health.service).toBe("influence-api");
  }, 30000);

  test("authenticated API request works with minted JWT", async () => {
    const admin = await createAdminUser(testDb!.db);

    const res = await fetch(`${serverHandles!.apiUrl}/api/games`, {
      headers: { Authorization: `Bearer ${admin.jwt}` },
    });
    expect(res.ok).toBe(true);

    const games = (await res.json()) as unknown[];
    expect(Array.isArray(games)).toBe(true);
  });

  test("launchBrowser starts headless Puppeteer", async () => {
    browser = await launchBrowser();
    expect(browser).toBeTruthy();
    expect(browser.connected).toBe(true);

    // Verify we can create a page
    const page = await browser.newPage();
    expect(page).toBeTruthy();
    await page.close();
  }, 15000);

  test("destroyTestDb cleans up DB files", () => {
    // Create a separate throwaway DB just for this test
    const throwaway = createTestDb();
    expect(throwaway.dbPath).toContain("/tmp/influence-e2e-");

    const { existsSync } = require("fs");
    expect(existsSync(throwaway.dbPath)).toBe(true);

    destroyTestDb(throwaway.dbPath);
    expect(existsSync(throwaway.dbPath)).toBe(false);
  });
});
