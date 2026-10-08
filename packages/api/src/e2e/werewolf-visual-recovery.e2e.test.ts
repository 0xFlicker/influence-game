import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { Browser, Page } from "puppeteer";
import sharp from "sharp";
import { advanceWerewolf, replayWerewolf, nextWerewolfStep, type WerewolfAgent } from "@influence/engine/werewolf";
import { schema } from "../db/index.js";
import { reserveVisualRender, visualImageJournal } from "../services/visual-render-journal.js";
import { claimWerewolfGame, createWerewolfStore } from "../services/werewolf-games.js";
import { createWerewolfVisualPreparation } from "../services/werewolf-visual-runtime.js";
import { claimVisualMediaJob, executeVisualMediaJob } from "../services/visual-media-worker.js";
import { storeVisualArtifact } from "../services/visual-scene-store.js";
import { readVisualMedia } from "../services/visual-media-repair.js";
import { recordCurrentLegalAcceptance } from "../services/legal-acceptance.js";
import { createIsolatedTestDb, destroyIsolatedTestDb, type TestDB } from "./test-db.js";
import { startTestServers, stopTestServers, type TestServerHandles } from "./test-server.js";
import { createAdminUser } from "./test-auth.js";
import { launchBrowser, createAuthenticatedPage, closeBrowser } from "./test-browser.js";
import { cleanupE2eResources } from "./cleanup.js";
let database: TestDB, servers: TestServerHandles, browser: Browser, admin: Awaited<ReturnType<typeof createAdminUser>>;
const saved = { role: process.env.INFLUENCE_API_ROLE, key: process.env.OPENAI_API_KEY, secret: process.env.JWT_SECRET };
beforeAll(async () => {
  process.env.INFLUENCE_API_ROLE = "gateway";
  process.env.OPENAI_API_KEY = "dummy-no-provider-calls";
  process.env.JWT_SECRET = "w7-browser-secret";
  database = await createIsolatedTestDb();
  admin = await createAdminUser(database.db);
  await recordCurrentLegalAcceptance(database.db, admin.userId, "existing_account", "0123456789abcdef0123456789abcdef01234567");
  servers = await startTestServers({ databaseUrl: database.databaseUrl, adminAddress: admin.wallet.address, jwtSecret: process.env.JWT_SECRET, logDirectory: "/tmp/w7-browser" });
  browser = await launchBrowser();
}, 240000);
afterAll(async () => {
  try {
    await cleanupE2eResources([["browser", async () => { if (browser)
          await closeBrowser(browser); }], ["servers", async () => { if (servers)
          await stopTestServers(servers); }], ["database", async () => { if (database)
          await destroyIsolatedTestDb(database.databaseUrl); }]]);
  }
  finally {
    for (const [name, value] of [["INFLUENCE_API_ROLE", saved.role], ["OPENAI_API_KEY", saved.key], ["JWT_SECRET", saved.secret]]) {
      if (value === undefined)
        delete process.env[name!];
      else
        process.env[name!] = value;
    }
  }
}, 60000);
async function text(page: Page, value: string) {
  await page.waitForFunction(`document.body.innerText.includes(${JSON.stringify(value)})`, { timeout: 30000, polling: 100 });
}
async function click(page: Page, label: string) {
  const button = `Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === ${JSON.stringify(label)} && !b.disabled)`;
  await page.waitForFunction(button, { polling: 100 });
  await page.evaluate(`${button}.click()`);
}
const agent: WerewolfAgent = { async decide({ request }) {
    if (request.action === "open_thread")
      return { kind: "opening", text: "Let's discuss the night.", cue: null, recipientIds: [] };
    return request.legalTargetIds.length ? { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "Fixture" } : { kind: "speech", text: "Hello village", cue: null };
  } };
test("W7A create, visible pause, discover, repair, publish and explicitly resume", async () => {
  const page = await createAuthenticatedPage(browser, admin.jwt, `${servers.webUrl}/games/new`, { privateKey: admin.wallet.privateKey });
  try {
    await page.waitForSelector('button[aria-pressed]');
    await page.evaluate(`Array.from(document.querySelectorAll('button[aria-pressed]')).find(b=>b.textContent?.trim().startsWith('Werewolf'))?.click()`);
    await text(page, "Visual Mode");
    await page.evaluate(`Array.from(document.querySelectorAll('label')).find(label=>label.textContent?.includes('Visual Mode'))?.querySelector('input')?.click()`);
    await text(page, "Require visuals");
    await page.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim().startsWith('Require visuals'))?.click()`);
    await click(page, "Create Werewolf Game");
    await page.waitForFunction(`location.pathname.startsWith('/games/') && location.pathname !== '/games/new'`);
    const slug = new URL(page.url()).pathname.split('/')[2]!;
    const db = database.db, [game] = await db.select().from(schema.games).where(eq(schema.games.slug, slug));
    expect(JSON.parse(game!.config).visualFailurePolicy).toBe("require_visuals");
    await click(page, "Start Werewolf");
    await text(page, "Fill the village and start?");
    await click(page, "Cancel");
    expect((await db.select().from(schema.games).where(eq(schema.games.id, game!.id)))[0]?.status).toBe("waiting");
    await click(page, "Start Werewolf");
    await page.waitForSelector('dialog[open]');
    const started = page.waitForResponse(response => response.url().endsWith(`/api/werewolf/${game!.id}/start`) && response.request().method() === "POST");
    await page.evaluate("document.querySelector('dialog[open] button:last-child').click()");
    expect((await started).status()).toBe(200);
    const claim = await claimWerewolfGame(db, game!.id);
    if (!claim.ok)
      throw Error(claim.error);
    const store = createWerewolfStore(db, game!.id, claim.claim.ownerEpoch);
    let state = replayWerewolf(await store.read()), step = nextWerewolfStep(state);
    for (let n = 0; n < 150 && !(step.kind === 'action' && step.request.action === 'open_thread'); n++) {
      await advanceWerewolf(store, agent);
      state = replayWerewolf(await store.read());
      step = nextWerewolfStep(state);
    }
    if (step.kind !== 'action' || step.request.action !== 'open_thread')
      throw Error('Missing day');
    const pending = step.request;
    const prepare = createWerewolfVisualPreparation(db, game!.id, claim.claim.ownerEpoch, new AbortController().signal, async () => null);
    await expect(prepare(state, pending)).rejects.toThrow();
    const accepted = await store.read();
    const viewer = await browser.newPage();
    try {
      await viewer.goto(`${servers.webUrl}/games/${slug}/replay?audience=mystery`, { waitUntil: 'domcontentloaded' });
      await text(viewer, "Paused for visual repair");
      await page.bringToFront();
      console.info("W7A: inspect Production");
      await page.goto(`${servers.webUrl}/admin/production`, { waitUntil: 'domcontentloaded' });
      await text(page, "Episode & video production");
      await page.waitForSelector(`a[href="/admin/werewolf/${game!.id}/production"]`);
      await page.click(`a[href="/admin/werewolf/${game!.id}/production"]`);
      await text(page, "Paused for visuals");
      console.info("W7A: repair boundary");
      await page.setViewport({ width: 390, height: 844 });
      // Resizing triggers responsive layout; measure after it has settled.
      await page.waitForFunction("document.documentElement.scrollWidth <= innerWidth");
      await click(page, "Resume game");
      await text(page, "Review and publish the required scene");
      await click(page, "Render missing image");
      await text(page, "queued for rendering");
      const interrupted = await claimVisualMediaJob(db, 'browser-interrupted-renderer');
      if (!interrupted) throw Error('Missing first job');
      const operation = await reserveVisualRender(db, game!.id, `media:${interrupted.id}:composition`, { prompt: "Interrupted fixture", width: 640, height: 360, references: [] }, interrupted.sceneId ?? undefined, interrupted.id);
      await visualImageJournal(db, operation).begin({ provider: "openai", model: "gpt-image-2", requestHash: "fixture-no-provider" });
      await db.update(schema.visualRepairJobs).set({status: "needs_reconciliation", leaseUntil: null, finishedAt: new Date().toISOString()}).where(eq(schema.visualRepairJobs.id, interrupted.id));
      await click(page, "Refresh scenes");
      await text(page, "Needs reconciliation:");
      await click(page, "Correct images");
      await text(page, "Reject and regenerate");
      await click(page, "Reject and regenerate");
      await text(page, "may already have been charged");
      await page.evaluate("Array.from(document.querySelectorAll('dialog[open]')).at(-1).querySelector('button:last-child').click()");
      await text(page, "Version 2 queued for rendering");
      expect((await readVisualMedia(db, game!.id)).publications).toHaveLength(0);
      const job = await claimVisualMediaJob(db, 'browser-fake-renderer');
      if (!job)
        throw Error('Missing repair job');
      const image = await storeVisualArtifact(db, game!.id, await sharp({ create: { width: 640, height: 360, channels: 3, background: '#39453b' } }).png().toBuffer());
      await executeVisualMediaJob(db, job, new AbortController().signal, async () => ({ imageArtifactId: image, localization: { count: job.plan.cast.length, verifiedParticipantIds: job.plan.cast.map(m => m.id), anchors: [] } }));
      await click(page, "Refresh scenes");
      await text(page, "ready for review");
      await click(page, "Versions and review");
      await click(page, "Publish for viewers");
      await text(page, "Published for new viewer sessions");
      expect((await claimWerewolfGame(db, game!.id)).ok).toBe(false);
      await page.screenshot({ path: '/tmp/w7-recovery-mobile.png', fullPage: true });
      console.info("W7A: resume published repair");
      await click(page, "Resume game");
      await page.waitForFunction(`!document.body.innerText.includes('Paused for visuals')`);
      expect(await store.read()).toEqual(accepted);
      expect((await readVisualMedia(db, game!.id)).publications).toHaveLength(1);
      const resumed = await claimWerewolfGame(db, game!.id);
      if (!resumed.ok)
        throw Error(resumed.error);
      await createWerewolfVisualPreparation(db, game!.id, resumed.claim.ownerEpoch, new AbortController().signal, async () => { throw Error('Should not render again'); })(state, pending);
      await advanceWerewolf(createWerewolfStore(db, game!.id, resumed.claim.ownerEpoch), agent);
      await viewer.bringToFront();
      await viewer.waitForFunction(`!document.body.innerText.includes('Paused for visual repair')`, { timeout: 15000 });
    }
    finally {
      await viewer.close();
    }
  }
  catch (error) {
    await page.screenshot({ path: '/tmp/w7-browser-failure.png', fullPage: true });
    console.error(await page.evaluate(`document.body.innerText`));
    throw error;
  }
  finally {
    await page.close();
  }
}, 180000);
