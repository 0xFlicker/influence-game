import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Browser, Page } from "puppeteer";
import sharp from "sharp";
import { schema } from "../db/index.js";
import { createSessionToken } from "../middleware/auth.js";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "../services/legal-acceptance.js";
import { launchBrowser } from "./test-browser.js";
import { createIsolatedTestDb, destroyIsolatedTestDb, type TestDB } from "./test-db.js";
import { startTestServers, stopTestServers, type TestServerHandles } from "./test-server.js";
import { cleanupE2eResources } from "./cleanup.js";

/** Real API/web/browser, per-process DB, and an in-process S3 fixture; no cloud credentials. */
test("banner stays on results, discovers late images, and is visible logged out and signed in, including after sign-out and same-game navigation", async () => {
  let testDb: TestDB | undefined, servers: TestServerHandles | undefined, browser: Browser | undefined;
  const envKeys = ["JWT_SECRET", "LINODE_PRIVATE_CONTENT_ENDPOINT", "LINODE_PRIVATE_CONTENT_BUCKET", "LINODE_PRIVATE_CONTENT_ACCESS_KEY", "LINODE_PRIVATE_CONTENT_SECRET_KEY", "NEXT_PUBLIC_E2E_LAYERED_AUTH"] as const;
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const pixels = new Uint8Array(await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } }).png().toBuffer());
  const s3 = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(pixels, { headers: { "Content-Type": "image/png", "Content-Length": String(pixels.length) } }) });
  try {
    process.env.JWT_SECRET = "e2e-test-jwt-secret"; process.env.NEXT_PUBLIC_E2E_LAYERED_AUTH = "true";
    process.env.LINODE_PRIVATE_CONTENT_ENDPOINT = s3.url.origin; process.env.LINODE_PRIVATE_CONTENT_BUCKET = "game-assets-browser-fixture";
    process.env.LINODE_PRIVATE_CONTENT_ACCESS_KEY = "fixture"; process.env.LINODE_PRIVATE_CONTENT_SECRET_KEY = "fixture";
    testDb = await createIsolatedTestDb(); const db = testDb.db;
    const userId = randomUUID(), gameId = randomUUID(), slug = `banner-browser-${gameId}`;
    await db.insert(schema.users).values({ id: userId, walletAddress: `0x${userId.replaceAll("-", "")}`, displayName: "Banner viewer", handle: `banner-${userId.slice(0, 8)}` });
    await db.insert(schema.legalAcceptances).values({ userId, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION, deploymentSha: "0123456789abcdef0123456789abcdef01234567", source: "existing_account" });
    const config = { visibility: "public", variant: "classic", modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" } };
    await db.insert(schema.games).values({ id: gameId, slug, status: "completed", minPlayers: 4, maxPlayers: 4, config: JSON.stringify(config) });
    await db.insert(schema.gameResults).values({ id: randomUUID(), gameId, winnerId: null, roundsPlayed: 1, finishedAt: new Date().toISOString(), tokenUsage: JSON.stringify({ promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 }) });
    const jwt = await createSessionToken(userId);
    servers = await startTestServers({ databaseUrl: testDb.databaseUrl, logDirectory: "/private/tmp/game-assets-browser-logs" });
    browser = await launchBrowser();
    const page = await browser.newPage();
    const bannerRequests: string[] = [];
    page.on("request", (request) => { if (/\/assets(?:\?|\/|$)/.test(request.url())) bannerRequests.push(request.url()); });
    const url = servers.webUrl!;
    async function visit(path: string) { await page.goto(url + path, { waitUntil: "networkidle2", timeout: 60_000 }); }
    await visit(`/games/${slug}/results`); expect(await page.$('[data-testid="game-results-banner"] img')).toBeNull();
    const assetId = randomUUID(), now = new Date().toISOString();
    await db.insert(schema.gameAssets).values({ id: assetId, gameId, label: "banner", visibility: "spoiler", altText: "Late spoiler banner", objectKey: `game-assets/${gameId}/fixture.png`, sha256: "0".repeat(64), width: 20, height: 10, byteLength: pixels.length, createdById: userId, updatedById: userId, createdAt: now, updatedAt: now });
    await page.evaluate("window.dispatchEvent(new Event('focus'))");
    await page.waitForSelector('img[alt="Late spoiler banner"]', { timeout: 30_000 });
    expect(await page.$eval('img[alt="Late spoiler banner"]', (image) => (image as unknown as { naturalWidth: number }).naturalWidth)).toBe(20);
    await page.waitForFunction("document.body.textContent.includes('Results') && !document.body.textContent.includes('Internal Server Error')");
    expect(await page.evaluate("document.body.textContent.includes('Internal Server Error')")).toBe(false);
    await page.screenshot({ path: "/private/tmp/game-assets-results-banner.png", fullPage: true });
    for (const suffix of ["", "/replay", "/highlights"]) {
      const before = bannerRequests.length; await visit(`/games/${slug}${suffix}`);
      expect(await page.$('[data-testid="game-results-banner"]')).toBeNull(); expect(bannerRequests.length).toBe(before);
    }
    let before = bannerRequests.length; await visit("/games"); expect(bannerRequests.length).toBe(before);
    await visit(`/games/${slug}/results`); await page.waitForSelector('img[alt="Late spoiler banner"]');
    await page.evaluate((token) => localStorage.setItem("influence_session", token), jwt);
    await visit(`/games/${slug}/results`); await page.waitForSelector('img[alt="Late spoiler banner"]');
    const anonymousReload = page.waitForRequest(request => request.url().includes("/assets?") && !request.headers().authorization, { timeout: 30_000 });
    await signOut(page);
    await anonymousReload;
    await page.waitForSelector('img[alt="Late spoiler banner"]');
    expect(await page.$('img[alt="Late spoiler banner"]')).not.toBeNull();
    await db.update(schema.games).set({ config: JSON.stringify({ ...config, visibility: "private" }) }).where(eq(schema.games.id, gameId));
    before = bannerRequests.length; await visit(`/games/${slug}/results`); expect(await page.$('[data-testid="game-results-banner"] img')).toBeNull(); expect(bannerRequests.length).toBeGreaterThanOrEqual(before);
  } finally {
    await cleanupE2eResources([
      ["browser", () => browser?.close()],
      ["API and web", () => servers ? stopTestServers(servers) : undefined],
      ["isolated database", () => testDb ? destroyIsolatedTestDb(testDb.databaseUrl) : undefined],
      ["S3 fixture", () => { s3.stop(true); }],
      ["environment", () => { for (const key of envKeys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }],
    ]);
  }
}, 240_000);
async function signOut(page: Page) {
  await page.evaluate(`(() => {
    const message = JSON.stringify({ generation: crypto.randomUUID(), sourceId: "browser-test-other-tab", transition: "logout" });
    window.dispatchEvent(new StorageEvent("storage", { key: "influence_auth_broadcast", newValue: message, storageArea: localStorage }));
  })()`);
}
