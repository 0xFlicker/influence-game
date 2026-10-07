import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { Browser, Page } from "puppeteer";
import { schema } from "../db/index.js";
import { playedWerewolfReview } from "../__tests__/owner-learning-werewolf-test-utils.js";
import { startOwnerLearningReview } from "../services/owner-learning-review.js";
import { fingerprintOwnerLearningValue } from "../services/owner-learning-contracts.js";
import { recordCurrentLegalAcceptance } from "../services/legal-acceptance.js";
import { createAdminUser } from "./test-auth.js";
import { launchBrowser, closeBrowser, createAuthenticatedPage } from "./test-browser.js";
import { createIsolatedTestDb, destroyIsolatedTestDb, type TestDB } from "./test-db.js";
import { startTestServers, stopTestServers, type TestServerHandles } from "./test-server.js";
import { cleanupE2eResources } from "./cleanup.js";

const savedKey = process.env.OPENAI_API_KEY;
const savedSecret = process.env.JWT_SECRET;
let database: TestDB;
let servers: TestServerHandles;
let browser: Browser;
let admin: Awaited<ReturnType<typeof createAdminUser>>;
let fixture: Awaited<ReturnType<typeof playedWerewolfReview>>;
const strategy = "Ask what changed a public read before committing a daytime vote. Preserve private role information when disclosure would harm your faction.";
beforeAll(async () => {
  delete process.env.OPENAI_API_KEY; // No worker can dispatch to a provider in this browser test.
  process.env.JWT_SECRET = "e2e-test-jwt-secret";
  database = await createIsolatedTestDb();
  admin = await createAdminUser(database.db);
  await recordCurrentLegalAcceptance(database.db, admin.userId, "existing_account", "0123456789abcdef0123456789abcdef01234567");
  fixture = await playedWerewolfReview(database.db, admin.userId);
  servers = await startTestServers({ databaseUrl: database.databaseUrl, adminAddress: admin.wallet.address, jwtSecret: process.env.JWT_SECRET, logDirectory: "/tmp/w3-browser-logs" });
  browser = await launchBrowser();
}, 240_000);
afterAll(async () => {
  await cleanupE2eResources([
    ["browser", async () => { if (browser) await closeBrowser(browser); }],
    ["servers", async () => { if (servers) await stopTestServers(servers); }],
    ["database", async () => { if (database) await destroyIsolatedTestDb(database.databaseUrl); }],
  ]);
  if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey;
  if (savedSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = savedSecret;
}, 60_000);
async function hasText(page: Page, value: string) {
  await page.waitForFunction(`document.body.innerText.includes(${JSON.stringify(value)})`, { timeout: 40_000 });
}

test("owner inspects Werewolf facts and deliberately applies only Werewolf strategy on desktop and mobile", async () => {
  const id = fixture.villager.agentProfileId!;
  const page = await createAuthenticatedPage(browser, admin.jwt, servers.webUrl!, { privateKey: admin.wallet.privateKey });
  try {
    await page.goto(`${servers.webUrl}/games/${fixture.game.slug}/results`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="owner-learning-activation"] a[href*="game=werewolf"]');
    await page.goto(`${servers.webUrl}/dashboard/agents/${id}/review?game=werewolf`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[aria-label="Werewolf game evidence"]');
    expect(await database.db.select().from(schema.agentLearningReviews)).toHaveLength(0);
    expect(await page.evaluate("document.body.innerText")).not.toContain("PRIVATE_PACK");
    await page.click('[aria-label="Werewolf game evidence"] details summary');
    await page.click('[aria-label="Werewolf game evidence"] details details summary');
    await hasText(page, "What they knew");
    const replay = await page.$eval('[aria-label="Werewolf game evidence"] a', el => el.getAttribute("href"));
    expect(replay).toContain(`/games/${fixture.game.slug}/replay?audience=omniscient`);
    await page.setViewport({ width: 390, height: 844 });
    expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
    await page.screenshot({ path: "/tmp/w3-preview-mobile.png", fullPage: true });
    const started = await startOwnerLearningReview(database.db, { ownerUserId: admin.userId, agentProfileId: id, gameIds: [fixture.game.id], idempotencyKey: "browser-w3" });
    const reviewId = started.reviewId!;
    const proposal = { field: "werewolfStrategyStyle" as const, before: "", after: strategy };
    const proposalFingerprint = fingerprintOwnerLearningValue({ reviewId, proposal });
    await database.db.update(schema.agentLearningReviews).set({ analysisStatus: "ready", stage: "complete", proposalFingerprint, result: { diagnosis: "Synthetic browser review", analysisTrack: "evidence_rich", recommendations: [{ id: "rec-browser", title: "Test the evidence", disposition: "change", confidence: "medium", rationale: "Synthetic workflow proof, not calibrated coaching.", evidenceRefs: [] }], proposal } }).where(eq(schema.agentLearningReviews.id, reviewId));
    await page.goto(`${servers.webUrl}/dashboard/agents/${id}/review/${reviewId}`, { waitUntil: "domcontentloaded" });
    await hasText(page, "Werewolf strategy · Before");
    await hasText(page, "No override saved; using the archetype default.");
    expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
    await page.waitForFunction('getComputedStyle(document.querySelector(".olm-enter")).opacity === "1"');
    await page.screenshot({ path: "/tmp/w3-review-mobile.png", fullPage: true });
    await page.setViewport({ width: 1440, height: 1000 });
    await page.waitForFunction('[...document.querySelectorAll("button")].some(button => button.textContent === "Apply strategy update" && !button.disabled)');
    await page.evaluate('[...document.querySelectorAll("button")].find(button => button.textContent === "Apply strategy update").click()');
    await hasText(page, "Strategy update applied");
    const profile = (await database.db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, id)))[0]!;
    expect(profile.werewolfStrategyStyle).toBe(strategy);
    expect(profile.strategyStyle).toBe("INFLUENCE_ONLY");
    await page.screenshot({ path: "/tmp/w3-applied-desktop.png", fullPage: true });
  } finally { await page.close(); }
}, 180_000);
