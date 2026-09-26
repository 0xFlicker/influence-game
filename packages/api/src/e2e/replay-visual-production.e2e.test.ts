import { afterAll, beforeAll, expect, test } from "bun:test";
import { Hono } from "hono";
import sharp from "sharp";
import type { Browser } from "puppeteer";
import { GameState, Phase, type GameTurnIntentV1 } from "@influence/engine";
import { schema } from "../db/index.js";
import { createAuthRoutes } from "../routes/auth.js";
import { createAdminRoutes } from "../routes/admin.js";
import { createVisualRoutes } from "../routes/visual.js";
import { createVisualReplayProductionRoutes } from "../routes/visual-replay-production.js";
import { createSessionToken, type AuthEnv } from "../middleware/auth.js";
import { recordCurrentLegalAcceptance } from "../services/legal-acceptance.js";
import { createInitialGameExecutionStateV1 } from "../services/game-turn-commit.js";
import { claimVisualMediaJob, executeVisualMediaJob } from "../services/visual-media-worker.js";
import { storeVisualArtifact } from "../services/visual-scene-store.js";
import { insertOwner, insertCanonicalEventRows } from "../__tests__/durable-run-test-utils.js";
import { createIsolatedTestDb, destroyIsolatedTestDb, type TestDB } from "./test-db.js";
import { launchBrowser, closeBrowser, createAuthenticatedPage } from "./test-browser.js";
import { assignRole, createAdminUser, createTestUser } from "./test-auth.js";
import { cleanupE2eResources } from "./cleanup.js";

let database: TestDB, browser: Browser, api: ReturnType<typeof Bun.serve>, web: Bun.Subprocess;
let webUrl: string, token: string, sysopToken: string;
const gameId = "replay-browser-game";
const originalSecret = process.env.JWT_SECRET;
beforeAll(async () => {
  process.env.JWT_SECRET = "replay-production-browser-secret";
  database = await createIsolatedTestDb();
  const userId = await createTestUser(database.db, { walletAddress: "0xreplayproducer", displayName: "Producer QA", handle: "producer-qa", createdAt: "2026-06-01T00:00:00Z" });
  await assignRole(database.db, { walletAddress: "0xreplayproducer", roleName: "producer" });
  await recordCurrentLegalAcceptance(database.db, userId, "existing_account", "0123456789abcdef0123456789abcdef01234567");
  token = await createSessionToken(userId, { roles: ["producer"], permissions: [] });
  const sysop = await createAdminUser(database.db);
  await recordCurrentLegalAcceptance(database.db, sysop.userId, "existing_account", "0123456789abcdef0123456789abcdef01234567");
  sysopToken = sysop.jwt;
  const config = JSON.stringify({ visualMode: false, modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" } });
  await database.db.insert(schema.games).values({ id: gameId, slug: "replay-without-visuals", status: "completed", maxPlayers: 2, config });
  await database.db.insert(schema.games).values([
    { id: "replay-other", slug: "another-completed-game", status: "completed", config },
    { id: "replay-waiting", slug: "waiting-game", status: "waiting", config },
  ]);
  const players = [{ id: "arden", name: "Arden" }, { id: "mira", name: "Mira" }];
  await database.db.insert(schema.gamePlayers).values(players.map(player => ({ id: player.id, gameId, persona: JSON.stringify({ name: player.name, personaKey: "honest" }), agentConfig: "{}" })));
  const state = new GameState(players, { gameId }); state.startRound();
  const ownerEpoch = await insertOwner(database.db, gameId);
  await insertCanonicalEventRows(database.db, gameId, ownerEpoch, state.getCanonicalEvents());
  const execution = createInitialGameExecutionStateV1({ gameId, ownerEpoch, xstateSnapshot: { value: "lobby" }, cursor: { version: 1, kind: "phase_enter", actor: "lobby" } });
  for (const [i, phase] of [Phase.LOBBY, Phase.FORMAT_MINGLE].entries()) {
    const turnId = `browser-turn-${i}`, turnSequence = i + 1, hash = `sha256:${"a".repeat(64)}`, date = new Date().toISOString();
    const intent: GameTurnIntentV1 = { version: 1, gameId, turnId, turnSequence, seed: "browser", baseHeads: execution.heads,
      branch: { version: 1, kind: "engine", action: "round_start" }, actorIds: [], targetIds: [], handles: [], participantIds: [], providerSubcalls: [] };
    await database.db.insert(schema.gameTurns).values({ id: turnId, gameId, turnSequence, plannedOwnerEpoch: ownerEpoch, committedOwnerEpoch: ownerEpoch,
      baseEventSequence: state.getCanonicalEvents().length, baseDialogueSequence: i, basePublicationSequence: 0, intent, intentHash: hash, effectHash: hash, status: "committed", committedAt: date,
      commitResult: { version: 1, gameId, turnId, turnSequence, intentHash: hash, effectHash: hash, committedAt: date, state: execution, canonicalEvents: [], dialogueSequences: [], publications: [], alreadyCommitted: false } });
    await database.db.insert(schema.transcripts).values({ gameId, gameTurnId: turnId, gameTurnTranscriptOrdinal: 1, entrySequence: i + 1,
      round: 1, phase, scope: "public", speakerPlayerId: "arden", audiencePlayerIds: phase === Phase.LOBBY ? [] : ["mira"], safeContext: { version: 1, ...(phase === Phase.FORMAT_MINGLE && { roomId: 1 }) }, text: "Let's keep our promises.", timestamp: 1 });
  }
  const app = new Hono<AuthEnv>();
  app.route("/", createAuthRoutes(database.db, { managedAuthMode: "full", compatibilityBridgeEnabled: false }));
  app.route("/", createVisualReplayProductionRoutes(database.db)); app.route("/", createVisualRoutes(database.db));
  app.route("/", createAdminRoutes(database.db));
  // No game or media worker is started; the test completes one job with deterministic pixels below.
  api = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  const webPort = 20000 + Math.floor(Math.random() * 30000); webUrl = `http://localhost:${webPort}`;
  web = Bun.spawn([process.execPath, "run", "dev", "--hostname", "127.0.0.1"], {
    cwd: `${import.meta.dir}/../../../web`,
    env: { ...process.env, NODE_ENV: "development", PORT: String(webPort), API_URL: "", NEXT_PUBLIC_API_URL: "", API_BACKEND_URL: `http://127.0.0.1:${api.port}`,
      NEXT_PUBLIC_E2E_AUTH: "true", NEXT_PUBLIC_E2E_LAYERED_AUTH: "true", MANAGED_AUTH_MODE: "full",
      PRIVY_APP_ID: "e2e-test-privy-app-id-001", NEXT_PUBLIC_PRIVY_APP_ID: "e2e-test-privy-app-id-001",
      CLERK_PUBLISHABLE_KEY: "pk_test_layered_auth_e2e", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_layered_auth_e2e" },
    stdout: Bun.file("/private/tmp/replay-production-browser-web.log"), stderr: Bun.file("/private/tmp/replay-production-browser-web-errors.log"),
  });
  const deadline = Date.now() + 60_000;
  while (true) {
    try { if ((await fetch(`${webUrl}/admin/production`, { signal: AbortSignal.timeout(1000) })).ok) break; }
    catch { /* Poll child startup until the bounded deadline. */ }
    if (Date.now() >= deadline) throw new Error("Production web server did not start; see /private/tmp/replay-production-browser-web-errors.log");
    await Bun.sleep(250);
  }
  browser = await launchBrowser();
}, 120_000);
afterAll(async () => {
  try { await cleanupE2eResources([
    ["browser", async () => { if (browser) await closeBrowser(browser); }],
    ["web", async () => { if (web) { web.kill(); await web.exited; } }],
    ["api", async () => { if (api) api.stop(true); }],
    ["database", async () => { if (database) await destroyIsolatedTestDb(database.databaseUrl); }],
  ]); } finally { if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret; }
}, 60_000);

test("Sysop opens replay controls inside the existing game rows without generating images", async () => {
  const page = await createAuthenticatedPage(browser, sysopToken, `${webUrl}/admin/production`);
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    const toggle = `[aria-label="Production for replay-without-visuals"] button[aria-controls]`;
    const other = `[aria-label="Production for another-completed-game"] button[aria-controls]`;
    await page.waitForSelector(toggle);
    expect(await page.$('select[aria-label="Game for replay images"]')).toBeNull();
    expect(await page.$('[aria-label="Replay image production"]')).toBeNull();
    expect(await page.$('[aria-label="Production for waiting-game"] button[aria-controls]')).toBeNull();
    await page.click(toggle);
    await page.waitForFunction("Array.from(document.querySelectorAll('button')).filter(b => b.textContent === 'Render missing image').length === 2");
    expect(await page.$('#replay-images-replay-browser-game [aria-label="Replay image production"]')).not.toBeNull();
    await page.screenshot({ path: "/private/tmp/replay-production-sysop-rows.png", fullPage: true });
    await page.click(other);
    await page.waitForFunction("document.body.innerText.includes('No room scenes can be reconstructed')");
    expect(await page.$('#replay-images-replay-browser-game')).toBeNull();
    expect(await page.$('#replay-images-replay-other [aria-label="Replay image production"]')).not.toBeNull();
    expect(await database.db.select().from(schema.visualScenes)).toHaveLength(0);
    expect(await database.db.select().from(schema.visualRepairJobs)).toHaveLength(0);
  } finally { await page.close(); }
}, 60_000);

test("Producer uses the same rows, preserves lost-request controls, reviews and explicitly publishes a nonvisual replay", async () => {
  const page = await createAuthenticatedPage(browser, token, `${webUrl}/admin/production`);
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    const toggle = `[aria-label="Production for replay-without-visuals"] button[aria-controls]`;
    await page.waitForSelector(toggle);
    expect(await page.$('select[aria-label="Game for replay images"]')).toBeNull();
    expect(await page.$('[aria-label="Production for waiting-game"]')).toBeNull();
    expect(await page.$$eval('[aria-label="Admin sections"] a', links => links.map(link => link.textContent))).toEqual(["Production"]);
    expect(await database.db.select().from(schema.visualScenes)).toHaveLength(0);
    await page.click(toggle);
    await page.waitForFunction("Array.from(document.querySelectorAll('button')).filter(b => b.textContent === 'Render missing image').length === 2");
    await page.screenshot({ path: "/private/tmp/replay-production-desktop.png" });
    // Lose one response before admission; the same request must remain recoverable in its row.
    let dropped = false;
    await page.setRequestInterception(true);
    page.on("request", request => {
      if (!dropped && request.method() === "POST" && request.url().endsWith("/visual/missing")) { dropped = true; void request.abort("failed"); }
      else void request.continue();
    });
    await page.evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Render missing image')?.click()");
    await page.waitForFunction("document.body.innerText.includes('Check render request')");
    expect(await page.$eval(toggle, button => (button as unknown as { disabled: boolean }).disabled)).toBe(true);
    expect(await page.$eval('[aria-label="Production for another-completed-game"] button[aria-controls]', button => (button as unknown as { disabled: boolean }).disabled)).toBe(true);
    expect(await page.$eval('#admin-game-search', input => input.matches(":disabled"))).toBe(true);
    expect(await database.db.select().from(schema.visualRepairJobs)).toHaveLength(0);
    await page.evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Check render request')?.click()");
    await page.waitForFunction("document.body.innerText.includes('One image is queued')");
    expect(await database.db.select().from(schema.visualRepairJobs)).toHaveLength(1);
    expect(await page.$$eval('article button', buttons => buttons.filter(b => b.textContent === "Render missing image").every(b => (b as unknown as { disabled: boolean }).disabled))).toBe(true);
    const job = (await claimVisualMediaJob(database.db, "browser-test"))!;
    const imageArtifactId = await storeVisualArtifact(database.db, gameId, await sharp({ create: { width: 640, height: 360, channels: 3, background: "#352448" } }).png().toBuffer());
    await executeVisualMediaJob(database.db, job, new AbortController().signal, async () => ({ imageArtifactId,
      localization: { count: 2, verifiedParticipantIds: ["arden", "mira"], anchors: [] } }));
    await page.waitForFunction("document.body.innerText.includes('Ready for review')");
    expect(await database.db.select().from(schema.visualMediaPublications)).toHaveLength(0);
    await page.evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Versions and review')?.click()");
    await page.waitForSelector('img[alt="Candidate v1"]');
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: "/private/tmp/replay-production-mobile-review.png", fullPage: true });
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
    await page.evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Publish for viewers')?.click()");
    await page.waitForFunction("document.body.innerText.includes('Published for new viewer sessions')");
    expect(await database.db.select().from(schema.visualMediaPublications)).toHaveLength(1);
    const viewer = await (await api.fetch(new Request(`http://127.0.0.1:${api.port}/api/games/${gameId}/visual`))).json() as { enabled: boolean; scenes: unknown[] };
    expect(viewer.enabled).toBe(true); expect(viewer.scenes).toHaveLength(1);
    await page.goto(`${webUrl}/admin/users`, { waitUntil: "networkidle0" });
    await page.waitForFunction("document.body.innerText.includes('Access denied.')");
  } catch (error) {
    await page.screenshot({ path: "/private/tmp/replay-production-browser-failure.png", fullPage: true });
    console.error("[Production browser]", await page.evaluate("document.body.innerText")); throw error;
  } finally { await page.close(); }
}, 120_000);
