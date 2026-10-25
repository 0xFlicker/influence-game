import {createMcpRoutes} from "../routes/mcp.js";
import {createAudioRoutes} from "../routes/audio.js";
import {MCP_OAUTH_CLIENT_ID,MCP_OAUTH_AUDIENCE,MCP_OAUTH_PURPOSE,hashOpaqueSecret} from "../services/mcp-oauth.js";
import {getMcpOAuthResourceUri} from "../services/mcp-oauth.js";
import {previewAudioTrack,queueAudioBackfill,runAudioTrack} from "../services/audio-tracks.js";
import { loadPayloads, storeFields } from "../services/payload-storage.js";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { Hono } from "hono";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import puppeteer, { type Browser, type Page, type HTTPRequest, type HTTPResponse } from "puppeteer";
import type { ProductionCatalog } from "@influence/engine/production-moments";
import type { ProductionExportDescriptor } from "@influence/engine/production-moments/export";
import { resolveCliApiSession } from "@influence/engine/cli-api-session";
import { GameState, Phase, type GameTurnIntentV1 } from "@influence/engine";
import { completedWerewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { schema } from "../db/index.js";
import { createAuthRoutes } from "../routes/auth.js";
import { createAdminRoutes } from "../routes/admin.js";
import { createEpisodeRoutes } from "../routes/episodes.js";
import { createVisualRoutes } from "../routes/visual.js";
import { createVisualReplayProductionRoutes } from "../routes/visual-replay-production.js";
import { createProductionStudioRoutes } from "../routes/production-studio.js";
import { seedProductionStudioFixture } from "../__tests__/production-studio-fixtures.js";
import { createSessionToken, type AuthEnv } from "../middleware/auth.js";
import { recordCurrentLegalAcceptance } from "../services/legal-acceptance.js";
import type { WerewolfProductionSnapshot } from "../services/werewolf-production-source.js";
import { createInitialGameExecutionStateV1 } from "../services/game-turn-commit.js";
import { claimVisualMediaJob, executeVisualMediaJob } from "../services/visual-media-worker.js";
import { storeVisualArtifact } from "../services/visual-scene-store.js";
import { insertOwner, insertCanonicalEventRows } from "../__tests__/durable-run-test-utils.js";
import { createIsolatedTestDb, destroyIsolatedTestDb, type TestDB } from "./test-db.js";
import { launchBrowser, closeBrowser, createAuthenticatedPage } from "./test-browser.js";
import { assignRole, createAdminUser, createTestUser } from "./test-auth.js";
import { cleanupE2eResources } from "./cleanup.js";
import { verifyStudioEncodedParity } from "./studio-export-parity.js";
import { proveStudioInterface, clickStudioButton, openStudioDialog, closeStudioDialog, openStudioSelect, chooseStudioOption, configureStudioCut, addStudioTag, markStudioLabel, setStudioInput } from "./studio-interface-review.js";

let database: TestDB, browser: Browser, api: ReturnType<typeof Bun.serve>, web: Bun.Subprocess;
let webUrl: string, token: string, sysopToken: string;
let studioFixture: Awaited<ReturnType<typeof seedProductionStudioFixture>>;
const gameId = "replay-browser-game";
const originalSecret = process.env.JWT_SECRET;
const temporaryPath = (name: string) => join(tmpdir(), name);
const operatorReview = process.env.STUDIO_OPERATOR_REVIEW === "1";
const interfaceProof = operatorReview || process.env.STUDIO_INTERFACE_PROOF === "1";
const longSourceProof = process.env.STUDIO_LONG_SOURCE_PROOF === "1";
let finishReview: (() => void) | undefined;
beforeAll(async () => {
  process.env.JWT_SECRET = "replay-production-browser-secret";
  database = await createIsolatedTestDb();
  console.info(`STUDIO_PROOF_DATABASE ${new URL(database.databaseUrl).pathname.slice(1)}`);
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
    await database.db.insert(schema.gameTurns).values(await storeFields({ id: turnId, gameId, turnSequence, plannedOwnerEpoch: ownerEpoch, committedOwnerEpoch: ownerEpoch,
      baseEventSequence: state.getCanonicalEvents().length, baseDialogueSequence: i, basePublicationSequence: 0, intent, intentHash: hash, effectHash: hash, status: "committed", committedAt: date,
      commitResult: { version: 1, gameId, turnId, turnSequence, intentHash: hash, effectHash: hash, committedAt: date, state: execution, canonicalEvents: [], dialogueSequences: [], publications: [], alreadyCommitted: false } }, {"intent":"json-gzip","commitResult":"json-gzip"}));
    await database.db.insert(schema.transcripts).values({ gameId, gameTurnId: turnId, gameTurnTranscriptOrdinal: 1, entrySequence: i + 1,
      round: 1, phase, scope: "public", speakerPlayerId: "arden", audiencePlayerIds: phase === Phase.LOBBY ? [] : ["mira"], safeContext: { version: 1, ...(phase === Phase.FORMAT_MINGLE && { roomId: 1 }) }, text: "Let's keep our promises.", timestamp: 1 });
  }
  studioFixture = await seedProductionStudioFixture(database.db);
  if (longSourceProof) {
    const saved = await database.db.select().from(schema.transcripts).where(eq(schema.transcripts.gameId, studioFixture.influence.id));
    const accepted = saved.find(row => row.text.startsWith("I will listen closely"))!;
    // Independent saved response IDs, all at the fixture's existing permitted
    // captured presentation boundary. These responses add no game decisions.
    await database.db.insert(schema.transcripts).values(Array.from({length: 192}, (_, index) => ({...accepted, id: undefined,
      entrySequence: index + 3, thinking: null,
      text: `Synthetic saved response ${index + 1}. I am comparing promises while this local fixture measures seeking across a longer accepted presentation history.`})));
  }
  await recordCurrentLegalAcceptance(database.db, studioFixture.producer.userId, "existing_account", "0123456789abcdef0123456789abcdef01234567");
  const app = new Hono<AuthEnv>();
  if (operatorReview) {
    // Local acceptance uses the real read/editor routes. No provider-affecting
    // requests can cross the retained harness boundary, including accidental clicks.
    app.post("/__studio-review/finish", c => {finishReview?.(); return c.json({closed: true});});
    app.use("*", async (c, next) => {
      if (!["GET", "HEAD"].includes(c.req.method) && !/^\/api\/admin\/production\/games\/[^/]+\/(?:moments\/[^/]+\/annotation|selection|validate)$/.test(c.req.path))
        return c.json({error: "This local operator review allows tags and selected exports. Repair, publication and resume are verified by the isolated browser tests; production writes are disabled here."}, 400);
      await next();
    });
  }
  app.route("/", createAuthRoutes(database.db, { managedAuthMode: "full", compatibilityBridgeEnabled: false }));
  app.route("/", createVisualReplayProductionRoutes(database.db)); app.route("/", createVisualRoutes(database.db));
  app.route("/", createAdminRoutes(database.db));
  app.route("/", createEpisodeRoutes(database.db));
  app.route("/", createProductionStudioRoutes(database.db));
  app.route("/",createAudioRoutes(database.db));
  app.route("/",createMcpRoutes(database.db,{auditLogger:()=>undefined,ownerLearningConnectionRecorder:async()=>undefined}));
  // No game or media worker is started; the test completes one job with deterministic pixels below.
  api = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  const webPort = 20000 + Math.floor(Math.random() * 30000); webUrl = `http://localhost:${webPort}`;
  const node = Bun.which("node");
  if (!node) throw new Error("Node.js is required to start the replay production browser test server");
  web = Bun.spawn([node, "./node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1"], {
    cwd: `${import.meta.dir}/../../../web`,
    env: { ...process.env, NODE_ENV: "development", PORT: String(webPort), API_URL: "", NEXT_PUBLIC_API_URL: "", API_BACKEND_URL: `http://127.0.0.1:${api.port}`,
      NEXT_PUBLIC_E2E_AUTH: "true", NEXT_PUBLIC_E2E_LAYERED_AUTH: "true", MANAGED_AUTH_MODE: "full",
      PRIVY_APP_ID: "e2e-test-privy-app-id-001", NEXT_PUBLIC_PRIVY_APP_ID: "e2e-test-privy-app-id-001",
      CLERK_PUBLISHABLE_KEY: "pk_test_layered_auth_e2e", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_layered_auth_e2e" },
    stdout: Bun.file(temporaryPath("replay-production-browser-web.log")), stderr: Bun.file(temporaryPath("replay-production-browser-web-errors.log")),
  });
  const deadline = Date.now() + 60_000;
  while (true) {
    try { if ((await fetch(`${webUrl}/admin/production`, { signal: AbortSignal.timeout(1000) })).ok) break; }
    catch { /* Poll child startup until the bounded deadline. */ }
    if (Date.now() >= deadline) throw new Error(`Production web server did not start; see ${temporaryPath("replay-production-browser-web-errors.log")}`);
    await Bun.sleep(250);
  }
  // Automated pointer, layout and fullscreen proof has one headless owner.
  // Retained review opens fresh native windows after that proof completes.
  browser = await launchBrowser();
}, 120_000);
afterAll(async () => {
  try { await cleanupE2eResources([
    ["browser", async () => { if (browser) await closeBrowser(browser); }],
    // Close audio range requests before waiting for Next's graceful shutdown.
    ["api", async () => { if (api) api.stop(true); }],
    ["web", async () => { if (web) { web.kill(); await web.exited; } }],
    ["operator generated route paths", async () => {
      if (!operatorReview && !interfaceProof) return;
      if (web && web.exitCode === null) throw new Error("Stop the review's Next child before restoring generated route paths");
      // Restore only Next's generated additions, preserving any other edits
      // made while the retained operator session was open.
      const envPath = join(import.meta.dir, "../../../web/next-env.d.ts");
      const env = await Bun.file(envPath).text();
      const restoredEnv = env.replace('import "./.next/e2e/dev/types/routes.d.ts";', 'import "./.next/dev/types/routes.d.ts";');
      if (restoredEnv !== env) await Bun.write(envPath, restoredEnv);
      const configPath = join(import.meta.dir, "../../../web/tsconfig.json");
      const config = await Bun.file(configPath).text();
      const restoredConfig = config.replace(/,\n\s*"\.next\/e2e\/types\/\*\*\/\*\.ts",\n\s*"\.next\/e2e\/dev\/types\/\*\*\/\*\.ts"/, "");
      if (restoredConfig !== config) await Bun.write(configPath, restoredConfig);
    }],
    ["database", async () => { if (database) await destroyIsolatedTestDb(database.databaseUrl); }],
  ]); if(database) console.info(`STUDIO_PROOF_DATABASE_DROPPED ${new URL(database.databaseUrl).pathname.slice(1)}`);
  } finally { if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret; }
}, 60_000);

async function clickButton(page: Page, label: string, scope = "") {
  await clickStudioButton(page, label, scope);
}
async function captureStudioFrame(page: Page, frame: number): Promise<Uint8Array> {
  await page.bringToFront();
  await page.evaluate(`(() => {const input = document.querySelector('[aria-label="Seek frame"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(frame))}); input.dispatchEvent(new Event('input', {bubbles:true}));})()`);
  await page.waitForFunction(`Number(document.querySelector('[data-preview-frame]')?.getAttribute('data-preview-frame')) === ${frame} && Number(document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame')) === ${frame}`);
  await page.evaluate("(async () => {await document.fonts.ready; await Promise.all(Array.from(document.querySelectorAll('[data-preview-frame] img')).map(image => image.decode()));})()");
  // Player renders frame metadata before its initial measured layout becomes
  // visible. Sampling that invisible mount captures black at the right number.
  await page.waitForFunction(`(() => {
    const canvas = document.querySelector('[data-composition-frame]');
    if (!canvas || Number(canvas.getAttribute('data-composition-frame')) !== ${frame}) return false;
    const bounds = canvas.getBoundingClientRect(); if (!bounds.width || !bounds.height) return false;
    for (let element = canvas; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    }
    return true;
  })()`);
  // A committed frame can still be measuring its portrait, font and bubble
  // layout after a Player remount. Require a settled layout before comparing
  // pixels; keep the exact hash assertion across independent seeks below.
  await page.evaluate(`(async () => {
    let previous = '', stable = 0;
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const canvas = document.querySelector('[data-composition-frame]');
      if (!canvas || Number(canvas.getAttribute('data-composition-frame')) !== ${frame}) {stable = 0; continue;}
      const ready = document.fonts.status === 'loaded' && Array.from(canvas.querySelectorAll('img')).every(image => image.complete && image.naturalWidth > 0);
      const geometry = [canvas, ...canvas.querySelectorAll('*')].map(element => {
        const box = element.getBoundingClientRect(), style = getComputedStyle(element);
        return [box.x, box.y, box.width, box.height, style.opacity, style.transform];
      });
      const signature = canvas.innerHTML + JSON.stringify(geometry);
      stable = ready && signature === previous ? stable + 1 : 0;
      previous = signature;
      if (stable >= 3) return;
    }
    throw new Error('Studio frame layout did not settle');
  })()`);
  const png = await (await page.$("[data-composition-frame]"))!.screenshot();
  await Bun.write(temporaryPath(`production-studio-frame-${frame}-${Date.now()}.png`), png);
  return png;
}
async function sampleStudioFrame(page: Page, frame: number): Promise<string> {return createHash("sha256").update(await captureStudioFrame(page, frame)).digest("hex");}

async function keyboardFrame(page: Page, expected: number) {
  try {await page.waitForFunction(`Number(document.querySelector('[data-preview-frame]')?.getAttribute('data-preview-frame'))===${expected} && Number(document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame'))===${expected}`);}
  catch (error) {console.error('STUDIO_KEYBOARD_FRAME',expected,await page.evaluate("({requested:document.querySelector('[data-preview-frame]')?.getAttribute('data-preview-frame'),committed:document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame'),focus:document.activeElement?.outerHTML.slice(0,160),inScope:Boolean(document.activeElement?.closest('[data-studio-shortcuts]')),dialog:document.querySelector('dialog[open]')?.getAttribute('aria-label')})")); throw error;}
}
async function currentKeyboardFrame(page: Page) {
  return page.$eval('[data-composition-frame]',node=>Number(node.getAttribute('data-composition-frame')));
}
const keyboardMonitor = '[aria-label="Preview keyboard controls"]';
async function keyboardFailure(page:Page, phase:string) {
  console.error('STUDIO_KEYBOARD_FAILURE',phase,await page.evaluate("({focus:document.activeElement?.outerHTML.slice(0,180),frame:document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame'),moment:document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment'),transport:document.querySelector('[aria-label=\"Playback controls\"]')?.textContent,metadataOpen:document.querySelector('[aria-label=\"Moment properties\"] details')?.open,layers:Array.from(document.querySelectorAll('dialog[open],[role=listbox],[role=menu]')).map(node=>({role:node.getAttribute('role'),label:node.getAttribute('aria-label'),visible:node.getClientRects().length})),properties:document.querySelector('[aria-label=\"Moment properties\"]')?.innerText.slice(0,200)})"));
}

test("Studio tools keeps one dialog, section navigation and drafts on desktop and narrow screens", async () => {
  for (const fixture of [studioFixture.influence,studioFixture.werewolf]) {
    const page = await createAuthenticatedPage(browser,studioFixture.producer.token,`${webUrl}/admin/production/games/${fixture.id}`);
    let writes=0;
    page.on('request',request=>{if (['POST','PATCH','DELETE'].includes(request.method()) && new URL(request.url()).pathname.startsWith('/api/admin/')) writes++;});
    try {
      await page.setViewport({width:1440,height:920}); await page.waitForSelector('[data-composition-frame]'); await captureStudioFrame(page,100);
      await clickStudioButton(page,'Tools'); await page.waitForSelector('dialog[open] nav[aria-label="Studio tools"]');
      const dialog = (await page.$('dialog[open]'))!;
      const sections = ['Recordings','Source settings','Keyboard hints','Scene versions…','Episode presentation','Trailer & poster','Game production and recovery','Workspace','Presentation'];
      for (const section of sections) {
        await clickStudioButton(page,section,'nav[aria-label="Studio tools"]');
        expect(await page.evaluate(node=>node===node.ownerDocument.querySelector('dialog[open]'),dialog)).toBe(true);
        expect(await page.$$eval('dialog[open]',nodes=>nodes.length)).toBe(1);
        expect(await page.$$eval('dialog[open] [aria-label="Close panel"]',nodes=>nodes.length)).toBe(1);
        expect(await page.$$eval('dialog[open] button',nodes=>nodes.some(node=>node.textContent?.trim()==='Done'))).toBe(false);
        expect(await page.$eval('nav[aria-label="Studio tools"] [aria-current="page"]',node=>node.textContent)).toBe(section);
      }
      await keyboardFrame(page,100);
      await clickStudioButton(page,'Episode presentation','nav[aria-label="Studio tools"]');
      const title = '[aria-label="Edit episode presentation"] label input:not([type="checkbox"])';
      await page.waitForSelector(title); const initialTitle = await page.$eval(title,node=>(node as {value:string}).value);
      await page.type(title,' operator draft');
      await clickStudioButton(page,'Recordings','nav[aria-label="Studio tools"]');
      await clickStudioButton(page,'Episode presentation','nav[aria-label="Studio tools"]');
      expect(await page.$eval(title,node=>(node as {value:string}).value)).toBe(`${initialTitle} operator draft`);
      await closeStudioDialog(page); expect(await page.evaluate("document.activeElement?.textContent==='Tools'")).toBe(true);
      await clickStudioButton(page,'Tools'); await clickStudioButton(page,'Episode presentation','nav[aria-label="Studio tools"]');
      expect(await page.$eval(title,node=>(node as {value:string}).value)).toBe(`${initialTitle} operator draft`);

      for (const viewport of [{width:390,height:700},{width:320,height:360}]) {
        await page.setViewport(viewport);
        for (const section of sections) {
          await clickStudioButton(page,section,'nav[aria-label="Studio tools"]');
          expect(await page.$eval('dialog[open]',node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
          expect(await page.$eval('dialog[open]',node=>node.getBoundingClientRect().bottom)).toBeLessThanOrEqual(viewport.height);
        }
      }
      await page.setViewport({width:1440,height:920}); await page.screenshot({path:temporaryPath(`production-studio-tools-${fixture===studioFixture.influence ? 'influence' : 'werewolf'}-desktop.png`)});
      await page.setViewport({width:390,height:700}); await page.screenshot({path:temporaryPath(`production-studio-tools-${fixture===studioFixture.influence ? 'influence' : 'werewolf'}-narrow.png`)});
      await openStudioSelect(page,'Aspect ratio'); await page.keyboard.press('Escape'); expect(await page.$('dialog[open]')).not.toBeNull();
      await page.keyboard.press('Escape'); await page.waitForFunction("!document.querySelector('dialog[open]')"); await keyboardFrame(page,100);
      expect(writes).toBe(0);
      expect(await page.$$eval('[aria-label="Playback controls"] button',nodes=>nodes.some(node=>node.textContent==='Play'))).toBe(true);
      await dialog.dispose();
    } finally {await page.close();}
  }
  const restricted = await createAuthenticatedPage(browser,token,`${webUrl}/admin/production/games/${gameId}`);
  try {
    await restricted.waitForSelector('[data-composition-frame]'); await clickStudioButton(restricted,'Tools');
    expect(await restricted.$$eval('nav[aria-label="Studio tools"] button',nodes=>nodes.some(node=>['Episode presentation','Trailer & poster'].includes(node.textContent!)))).toBe(false);
    expect(await restricted.$('nav[aria-label="Studio tools"] button[aria-current="page"]')).not.toBeNull();
  } finally {await restricted.close();}
},120_000);

test("Studio keyboard transport shares Player time and preserves native controls in both games", async () => {
  for (const fixture of [studioFixture.influence,studioFixture.werewolf]) {
    const page = await createAuthenticatedPage(browser,studioFixture.producer.token,`${webUrl}/admin/production/games/${fixture.id}${fixture===studioFixture.werewolf ? '?audience=omniscient' : ''}`);
    let phase='transport'; page.setDefaultTimeout(10_000);
    try {
      await page.setViewport({width:1440,height:920}); await page.waitForSelector('[data-composition-frame]');
      await captureStudioFrame(page,100); await page.focus(keyboardMonitor);
      await page.keyboard.down('ArrowRight'); await keyboardFrame(page,101);
      await page.keyboard.down('ArrowRight'); await keyboardFrame(page,102); await page.keyboard.up('ArrowRight');
      await page.keyboard.press('ArrowLeft'); await keyboardFrame(page,101);
      await page.keyboard.down('Shift'); await page.keyboard.press('ArrowRight'); await page.keyboard.up('Shift'); await keyboardFrame(page,131);
      await page.keyboard.down('Shift'); await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Shift'); await keyboardFrame(page,101);
      await page.keyboard.press('Space'); await page.waitForFunction("Array.from(document.querySelectorAll('[aria-label=\"Playback controls\"] button')).some(node=>node.textContent==='Pause')");
      await page.waitForFunction("Number(document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame'))>102");
      await page.keyboard.press('ArrowRight'); await page.waitForFunction("Array.from(document.querySelectorAll('[aria-label=\"Playback controls\"] button')).some(node=>node.textContent==='Play')");
      const paused = await currentKeyboardFrame(page); await Bun.sleep(100); expect(await currentKeyboardFrame(page)).toBe(paused);
      await page.focus('[aria-keyshortcuts="Space"]'); await page.keyboard.press('Space');
      await page.waitForFunction("Array.from(document.querySelectorAll('[aria-label=\"Playback controls\"] button')).some(node=>node.textContent==='Pause')");
      await page.keyboard.press('Space'); await page.waitForFunction("Array.from(document.querySelectorAll('[aria-label=\"Playback controls\"] button')).some(node=>node.textContent==='Play')");
      await page.focus(keyboardMonitor); await page.keyboard.press('Home'); await keyboardFrame(page,0);
      await page.keyboard.press('ArrowLeft'); await keyboardFrame(page,0);
      const final = await page.$eval('[aria-label="Timeline playhead"]',node=>Number(node.getAttribute('aria-valuemax')));
      await page.keyboard.press('End'); await keyboardFrame(page,final); await page.keyboard.press('ArrowRight'); await keyboardFrame(page,final);

      phase='moments'; const thought = await page.$eval('[data-moment-id]:has([data-kind="thinking"])',node=>node.getAttribute('data-moment-id')!);
      await page.click(`[data-moment-id="${thought}"] > button:first-child`);
      await page.waitForFunction(`document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment')===${JSON.stringify(thought)} && Number(getComputedStyle(document.querySelector('[data-in-scene-thinking]')).opacity)===1`);
      const content = await currentKeyboardFrame(page);
      const next = await page.$eval(`[data-moment-id="${thought}"]`,node=>node.nextElementSibling!.getAttribute('data-moment-id')!);
      await page.focus(keyboardMonitor); await page.keyboard.press(']');
      await page.waitForFunction(`document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment')===${JSON.stringify(next)}`);
      await page.keyboard.press('['); await page.waitForFunction(`document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment')===${JSON.stringify(thought)}`);
      expect(await currentKeyboardFrame(page)).toBeLessThan(content);

      phase='native controls'; const muteLabel = await page.$eval('[aria-keyshortcuts="m"]',node=>node.textContent);
      await page.focus(keyboardMonitor); await page.keyboard.down('m');
      await page.waitForFunction(`document.querySelector('[aria-keyshortcuts="m"]')?.textContent!==${JSON.stringify(muteLabel)}`);
      const toggledMute = await page.$eval('[aria-keyshortcuts="m"]',node=>node.textContent);
      await page.keyboard.down('m'); await page.keyboard.up('m'); expect(await page.$eval('[aria-keyshortcuts="m"]',node=>node.textContent)).toBe(toggledMute);
      const beforeControls = await currentKeyboardFrame(page);
      await page.focus('[aria-label="Playback volume"]'); await page.keyboard.press('ArrowLeft'); await keyboardFrame(page,beforeControls);
      await page.focus('[aria-label="Timeline zoom"]'); await page.keyboard.press('ArrowRight'); await keyboardFrame(page,beforeControls);
      await page.focus('[role="separator"]'); await page.keyboard.press('ArrowRight'); await keyboardFrame(page,beforeControls);
      await page.focus('[aria-label="Timeline playhead"]'); await page.keyboard.press('ArrowUp'); await keyboardFrame(page,beforeControls+1);
      await page.keyboard.press('ArrowDown'); await keyboardFrame(page,beforeControls);

      // Child timeline commands must also consult the workspace capture fence.
      phase='capture'; const divider = await page.$('[role="separator"]'), bounds = (await divider!.boundingBox())!;
      await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2); await page.mouse.down(); await page.mouse.move(bounds.x+bounds.width/2+1,bounds.y+bounds.height/2);
      await page.waitForFunction("document.querySelector('[role=separator]')?.hasPointerCapture(1)");
      await page.focus('[aria-label="Timeline playhead"]'); await page.keyboard.press('ArrowRight'); await keyboardFrame(page,beforeControls);
      await page.focus(keyboardMonitor); await page.keyboard.press('e'); expect(await page.$('dialog[open]')).toBeNull();
      await page.keyboard.press('m'); expect(await page.$eval('[aria-keyshortcuts="m"]',node=>node.textContent)).toBe(toggledMute);
      // Removing a captured owner must not strand keyboard eligibility.
      await page.setViewport({width:390,height:700}); await page.waitForFunction("!document.querySelector('[role=separator]')");
      await page.mouse.up();
      await page.focus(keyboardMonitor); await page.keyboard.press('ArrowRight'); await keyboardFrame(page,beforeControls+1);
      await page.setViewport({width:1440,height:920}); await page.waitForSelector('[role="separator"]');

      // A native disclosure owns Space; it must not start playback.
      phase='disclosure/fullscreen'; await page.focus('[aria-label="Moment properties"] summary'); await page.keyboard.press('Space');
      expect(await page.$eval('[aria-label="Moment properties"] details',node=>node.hasAttribute('open'))).toBe(true);
      expect(await page.$$eval('[aria-label="Playback controls"] button',nodes=>nodes.some(node=>node.textContent==='Play'))).toBe(true);
      await page.focus(keyboardMonitor); await page.keyboard.press('f'); await page.waitForFunction('Boolean(document.fullscreenElement)');
      await page.keyboard.press('?'); await page.waitForSelector('dialog[open][aria-label="Keyboard hints"]');
      const stopped = await currentKeyboardFrame(page); await page.keyboard.press('ArrowRight'); await keyboardFrame(page,stopped);
      await page.keyboard.press('e'); expect(await page.$('dialog[open][aria-label="Export selected cut"]')).toBeNull();
      await page.keyboard.press('Escape'); await page.waitForFunction("!document.querySelector('dialog[open]')");
      expect(await page.evaluate("document.activeElement===document.querySelector('[aria-label=\"Preview keyboard controls\"]')")).toBe(true);
      await page.keyboard.press('f'); await page.waitForFunction('!document.fullscreenElement');
    } catch (error) {await keyboardFailure(page,phase); throw error;} finally {await page.mouse.reset(); await page.close();}
  }
},90_000);

test("Studio keyboard panels, metadata saving and character preferences keep their existing owners", async () => {
  const fixture = studioFixture.influence;
  const saved = await database.db.select().from(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId,fixture.id));
  const page = await createAuthenticatedPage(browser,studioFixture.producer.token,`${webUrl}/admin/production/games/${fixture.id}`);
  const previousPreference = await page.evaluate("localStorage.getItem('house.studio.character-shortcuts.v1')") as string|null;
  let phase='metadata focus'; page.setDefaultTimeout(10_000);
  let releases: (()=>void)[] = [], saves = 0, selections = 0;
  const pendingSaves = new Set<HTTPRequest>();
  const settled = (request: HTTPRequest) => {pendingSaves.delete(request);};
  page.on('requestfinished', settled); page.on('requestfailed', settled);
  const intercept = async (request:HTTPRequest) => {
    if (request.method()==='POST' && new URL(request.url()).pathname.endsWith('/annotation')) {saves++; pendingSaves.add(request); await new Promise<void>(accept=>releases.push(accept));}
    if (request.method()==='POST' && new URL(request.url()).pathname.endsWith('/selection')) selections++;
    await request.continue();
  };
  const release = () => {for (const accept of releases) accept(); releases=[];};
  try {
    await page.setViewport({width:1440,height:920}); await page.waitForSelector('[data-composition-frame]');
    await page.setRequestInterception(true); page.on('request',intercept);
    await page.click(`[data-moment-id="${fixture.thoughtId}"] > button:first-child`);
    await page.waitForFunction(`document.querySelector('[data-selected-moment]')?.getAttribute('data-selected-moment')===${JSON.stringify(fixture.thoughtId)}`);
    await page.focus(keyboardMonitor); await page.keyboard.press('t');
    await page.waitForFunction("document.activeElement?.getAttribute('aria-label')==='Tag key 1' && document.querySelector('[aria-label=\"Moment properties\"] details')?.open");
    expect(saves).toBe(0);
    await clickButton(page,'Add tag');
    const row = await page.$$eval('[aria-label="Moment properties"] input[aria-label^="Tag key"]',nodes=>nodes.length);
    await page.focus(`input[aria-label="Tag key ${row}"]`); await page.keyboard.type('editor.keyboard');
    await page.focus(`input[aria-label="Tag value ${row}"]`); await page.keyboard.type('mftre12/?[]');
    expect(await page.$('dialog[open]')).toBeNull(); expect(saves).toBe(0);
    phase='save'; const modifier = await page.evaluate("navigator.platform.toLowerCase().includes('mac') ? 'Meta' : 'Control'") as 'Meta'|'Control';
    const saveChord = async () => {await page.keyboard.down(modifier); await page.keyboard.press('Enter'); await page.keyboard.up(modifier);};

    // The inspector owns save, but shares the pointer-capture eligibility fence.
    const bounds = (await (await page.$('[role="separator"]'))!.boundingBox())!;
    await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2); await page.mouse.down(); await page.mouse.move(bounds.x+bounds.width/2+1,bounds.y+bounds.height/2);
    await page.waitForFunction("document.querySelector('[role=separator]')?.hasPointerCapture(1)");
    await page.focus(`input[aria-label="Tag value ${row}"]`); await saveChord(); expect(saves).toBe(0);
    await page.mouse.up(); await saveChord();
    await page.waitForFunction("document.querySelector('[aria-label=\"Moment properties\"]')?.innerText.includes('Saving…')");
    await saveChord(); expect(saves).toBe(1);
    // Capture starting after a submit must not discard the accepted response.
    await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2); await page.mouse.down(); await page.mouse.move(bounds.x+bounds.width/2+1,bounds.y+bounds.height/2); release();
    await page.waitForFunction("document.querySelector('[aria-label=\"Moment properties\"]')?.innerText.includes('Saved revision 2')");
    await page.mouse.up(); expect(await page.$eval(`input[aria-label="Tag value ${row}"]`,node=>(node as {value:string}).value)).toBe('mftre12/?[]');
    await clickButton(page,'Add tag'); await saveChord(); expect(saves).toBe(1); // Empty metadata is invalid.
    const invalidRow = row+1; await page.click(`[aria-label="Remove tag ${invalidRow}"]`);
    // A real revision conflict keeps keyboard Save locked until explicit review.
    await database.db.update(schema.productionMomentAnnotations).set({revision:3}).where(eq(schema.productionMomentAnnotations.momentKey,fixture.thoughtId));
    await setStudioInput(page,`Tag value ${row}`,'Conflicting keyboard draft'); await page.focus(`input[aria-label="Tag value ${row}"]`);
    await saveChord(); await page.waitForFunction("document.querySelector('[aria-label=\"Moment properties\"]')?.innerText.includes('Saving…')"); release();
    await page.waitForFunction("document.querySelector('[aria-label=\"Moment properties\"]')?.innerText.includes('Another edit was saved')");
    await saveChord(); expect(saves).toBe(2); await clickButton(page,'Use saved labels');

    phase='narrow focus'; await page.setViewport({width:390,height:700}); await page.focus(keyboardMonitor); await page.keyboard.press('/');
    await page.waitForFunction("document.activeElement?.getAttribute('aria-label')==='Find a moment'");
    await page.keyboard.type('mftre12/?[]'); expect(await page.$('dialog[open]')).toBeNull();
    await page.focus(keyboardMonitor); await page.keyboard.press('/');
    expect(await page.$eval('[aria-label="Find a moment"]',node=>(node as {value:string}).value)).toBe('mftre12/?[]');
    await page.focus(keyboardMonitor); await page.keyboard.press('t');
    await page.waitForFunction("document.activeElement?.getAttribute('aria-label')==='Tag key 1'");
    expect(await page.$eval('[data-selected-moment]',node=>node.getAttribute('data-selected-moment'))).toBe(fixture.thoughtId);
    phase='views'; await page.focus(keyboardMonitor); await page.keyboard.press('2');
    await page.waitForFunction("new URL(location.href).searchParams.get('view')==='cut' && document.querySelector('[data-composition-frame]')");
    expect(await page.$eval('[aria-label="Find a moment"]',node=>(node as {value:string}).value)).toBe('');
    await page.focus(keyboardMonitor); await page.keyboard.press('1');
    await page.waitForFunction("new URL(location.href).searchParams.get('view')==='source' && document.querySelector('[data-composition-frame]')");
    await page.focus(keyboardMonitor); await page.keyboard.press('r');
    expect(await page.$eval('[aria-label="Moment properties"]',node=>node.textContent?.includes('Follows current moment'))).toBe(true);
    phase='panels/preference'; await page.focus(keyboardMonitor); await page.keyboard.press('e'); await page.waitForSelector('dialog[open][aria-label="Export selected cut"]');
    expect(selections).toBe(0); const panelFrame = await currentKeyboardFrame(page);
    await page.keyboard.press('Space'); await keyboardFrame(page,panelFrame);
    await page.keyboard.press('Escape'); await page.waitForFunction("!document.querySelector('dialog[open]')");
    await page.focus(keyboardMonitor); await page.keyboard.press('?'); await page.waitForSelector('dialog[open][aria-label="Keyboard hints"]');
    await page.setViewport({width:390,height:360});
    expect(await page.$eval('dialog[open]',node=>node.getBoundingClientRect().right)).toBeLessThanOrEqual(390);
    expect(await page.$eval('dialog[open]',node=>node.getBoundingClientRect().bottom)).toBeLessThanOrEqual(360);
    await (await page.$('[aria-label="Enable letter and symbol shortcuts"]'))!.click();
    await page.keyboard.press('Escape'); await page.waitForFunction("!document.querySelector('dialog[open]')");
    await page.focus(keyboardMonitor); const disabledFrame = await currentKeyboardFrame(page);
    for (const key of ['m','f','e','?','t','r','1','2','[',']','/'] as const) await page.keyboard.press(key);
    expect(await page.$('dialog[open]')).toBeNull(); expect(await currentKeyboardFrame(page)).toBe(disabledFrame);
    expect(await page.$('[aria-keyshortcuts="e"]')).toBeNull();
    await page.keyboard.press('ArrowRight'); await keyboardFrame(page,disabledFrame+1);
    await page.reload({waitUntil:'domcontentloaded'}); await page.waitForSelector('[data-composition-frame]');
    await page.click('[aria-label="Keyboard hints"]'); await page.waitForSelector('dialog[open][aria-label="Keyboard hints"]');
    expect(await page.$eval('[aria-label="Enable letter and symbol shortcuts"]',node=>(node as {checked:boolean}).checked)).toBe(false);
    await (await page.$('[aria-label="Enable letter and symbol shortcuts"]'))!.click(); await closeStudioDialog(page);
    await openStudioDialog(page,'Presentation'); await openStudioSelect(page,'Aspect ratio'); await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape'); expect(await page.$('dialog[open][aria-label="Presentation"]')).not.toBeNull();
    await page.keyboard.press('Escape'); await page.waitForFunction("!document.querySelector('dialog[open]')"); expect(selections).toBe(0);
  } catch (error) {await keyboardFailure(page,phase); throw error;} finally {
    await page.mouse.reset(); release();
    // A failed assertion may leave a released annotation request committing.
    // Settle it before restoring fixture rows, including failure cleanup.
    // Streaming soundtrack/video requests need not become idle. Only the
    // intercepted annotation writes can race restoration of these fixture rows.
    try {
      const deadline = Date.now() + 5000;
      while (pendingSaves.size) {
        if (Date.now() >= deadline) throw new Error("Annotation writes did not settle before fixture cleanup");
        await Bun.sleep(25);
      }
    } finally {
      await page.evaluate(`localStorage.${previousPreference===null ? "removeItem('house.studio.character-shortcuts.v1')" : `setItem('house.studio.character-shortcuts.v1',${JSON.stringify(previousPreference)})`}`);
      page.off('requestfinished', settled); page.off('requestfailed', settled);
      page.off('request',intercept); await page.setRequestInterception(false); await page.close();
      await database.db.delete(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId,fixture.id));
      if (saved.length) await database.db.insert(schema.productionMomentAnnotations).values(saved);
    }
  }
},90_000);

test("Studio keyboard ignores unavailable media without queuing commands and keeps Mystery private", async () => {
  const fixture = studioFixture.influence;
  const page = await createAuthenticatedPage(browser,studioFixture.producer.token,`${webUrl}/admin/production`);
  let release!:()=>void, sawMedia!:()=>void, timer:ReturnType<typeof setTimeout>|undefined;
  const gate = new Promise<void>(accept=>{release=accept;});
  const pending = new Promise<void>(accept=>{sawMedia=accept;});
  const intercept = async (request:HTTPRequest) => {
    if (new URL(request.url()).pathname.startsWith(`/api/admin/production/games/${fixture.id}/visual/artifacts/`)) {sawMedia(); await gate;}
    await request.continue();
  };
  try {
    await page.setRequestInterception(true); page.on('request',intercept);
    await page.goto(`${webUrl}/admin/production/games/${fixture.id}`,{waitUntil:'domcontentloaded'});
    await Promise.race([pending,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Keyboard media gate was not reached')),10_000);})]); clearTimeout(timer);
    await page.focus('[aria-keyshortcuts="1"]');
    for (const key of ['ArrowRight',']','m','Space'] as const) await page.keyboard.press(key);
    expect(await page.$('[data-composition-frame]')).toBeNull();
    await page.keyboard.press('?'); await page.waitForSelector('dialog[open][aria-label="Keyboard hints"]');
    await page.keyboard.press('Escape'); release(); await page.waitForSelector('[data-composition-frame]'); await keyboardFrame(page,0);
    expect(await page.$$eval('[aria-label="Playback controls"] button',nodes=>nodes.some(node=>node.textContent==='Play'))).toBe(true);
    page.off('request',intercept); await page.setRequestInterception(false);
    await page.goto(`${webUrl}/admin/production/games/${studioFixture.werewolf.id}`,{waitUntil:'domcontentloaded'}); await page.waitForSelector('[data-composition-frame]');
    await page.waitForSelector('[data-moment-id] [data-kind="thinking"]');
    await openStudioDialog(page,'Source settings');
    await openStudioSelect(page,'Production audience');
    expect(await page.$eval('[role="option"][aria-selected="true"]',node=>node.textContent?.includes('Omniscient'))).toBe(true);
    await page.keyboard.press('Escape');
    await closeStudioDialog(page);
    await page.goto(`${webUrl}/admin/production/games/${studioFixture.werewolf.id}?audience=mystery`,{waitUntil:'domcontentloaded'}); await page.waitForSelector('[data-composition-frame]');
    expect(await page.$('[data-moment-id]:has([data-kind="thinking"])')).toBeNull();
    await page.focus(keyboardMonitor); await page.keyboard.press(']');
    await page.keyboard.press('t'); await page.waitForFunction("document.activeElement?.matches('[data-add-tag],input[aria-label^=\"Tag\"]')");
    expect(await page.$('[data-in-scene-thinking]')).toBeNull();
    expect(await page.$eval('[aria-label="Moment properties"] [data-kind]',node=>node.getAttribute('data-kind'))).not.toBe('thinking');
  } finally {clearTimeout(timer); release(); page.off('request',intercept); await page.setRequestInterception(false); await page.close();}
},90_000);

/** Checks native audio driven by the shared composition schedule. */
async function proveRecordedAudioLifecycle(page:Page) {
  const element = "Array.from(document.querySelectorAll('audio')).find(audio=>audio.src.startsWith('blob:') && Math.abs(audio.duration-1)<.01)";
  const state = `${element} && (()=>{const audio=${element};return {time:audio.currentTime,paused:audio.paused,muted:audio.muted,volume:audio.volume};})()`;
  const total = await page.$eval('[aria-label="Timeline playhead"]',node=>Number(node.getAttribute("aria-valuemax"))+1);
  let first = -1;
  for(let frame=0;frame<total && first<0;frame+=5) {
    await captureStudioFrame(page,frame);
    if(await page.evaluate(`Boolean(${element})`)) first=frame;
  }
  expect(first).toBeGreaterThanOrEqual(0);
  const target = Math.min(first+6,total-1);
  await captureStudioFrame(page,target);
  await clickButton(page,"Unmute"); await clickButton(page,"Play");
  await page.waitForFunction(`${element} && !${element}.paused && ${element}.currentTime>.1`);
  await clickButton(page,"Pause");
  const pausedFrame = await page.$eval('[data-preview-frame]',node=>Number(node.getAttribute("data-preview-frame")));
  await Bun.sleep(150);
  expect(await page.$eval('[data-preview-frame]',node=>Number(node.getAttribute("data-preview-frame")))).toBe(pausedFrame);
  await captureStudioFrame(page,first);
  await page.waitForFunction(`${element} && ${element}.paused && ${element}.currentTime<.2`);
  await clickButton(page,"Mute"); await clickButton(page,"Unmute");
  const volume = async (value:number) => {
    await page.evaluate(`(()=>{const input=document.querySelector('[aria-label="Playback volume"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  };
  await volume(0); await captureStudioFrame(page,target); await clickButton(page,"Play");
  await page.waitForFunction(`${element} && !${element}.paused && ${element}.volume===0 && ${element}.currentTime>.1`);
  await clickButton(page,"Pause"); await volume(.5); await captureStudioFrame(page,target); await clickButton(page,"Play");
  await page.waitForFunction(`${element} && !${element}.paused && !${element}.muted && ${element}.volume===.5 && ${element}.currentTime>.1`);
  const sound = await page.evaluate(state);
  await clickButton(page,"Pause");
  await Bun.write(temporaryPath("production-studio-canonical-audio-proof.json"),JSON.stringify({scope:"Actual canonical Studio Player with a one-second local 880Hz test signal",firstSampledRecordingFrame:first,targetFrame:target,
    nativeAudio:sound,pauseFreezesFrame:true,reverseSeekResetsRecording:true,muteAndZeroVolumeRecover:true},null,2));
}

test.skipIf(!longSourceProof)("Synthetic saved source reports seek latency and memory across approximately thirty minutes", async () => {
  const start = performance.now();
  const page = await createAuthenticatedPage(browser, studioFixture.producer.token, `${webUrl}/admin/production/games/${studioFixture.influence.id}`);
  try {
    await page.setViewport({width:1440,height:1050}); await page.waitForSelector("[data-composition-frame]", {timeout:90_000});
    await captureStudioFrame(page,0);
    const coldNavigationToReadinessMs = performance.now()-start, before = await page.metrics();
    const frames = await page.$eval('[aria-label="Timeline playhead"]', node => Number(node.getAttribute("aria-valuemax"))+1),fps = 30;
    const measured: {frame:number;requestedMs:number;committedMs:number;readyMs:number}[] = [];
    for(const fraction of [.01,.1,.2,.4,.7,.95,.7,.4,.2,.1,.01,.93,.27,.79,.54,.11,.98,.43,.65,.03]) {
      const frame = Math.round((frames-1)*fraction);
      const sample = await page.evaluate(`(async()=>{
        const frame=${frame},host=document.querySelector('[data-preview-frame]'),stage=document.querySelector('[data-composition-frame]'),input=document.querySelector('[aria-label="Seek frame"]'),start=performance.now();
        const changed=(element,name)=>new Promise(accept=>{if(Number(element.getAttribute(name))===frame){accept(performance.now()-start);return;}const observer=new MutationObserver(()=>{if(Number(element.getAttribute(name))===frame){observer.disconnect();accept(performance.now()-start);}});observer.observe(element,{attributes:true,attributeFilter:[name]});});
        const requested=changed(host,'data-preview-frame'),committed=changed(stage,'data-composition-frame');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(frame));input.dispatchEvent(new Event('input',{bubbles:true}));
        const requestedMs=await requested,committedMs=await committed;await document.fonts.ready;await Promise.all(Array.from(stage.querySelectorAll('img')).map(image=>image.decode()));await new Promise(accept=>requestAnimationFrame(()=>requestAnimationFrame(accept)));
        return {frame,requestedMs,committedMs,readyMs:performance.now()-start};
      })()`);
      measured.push(sample as (typeof measured)[number]);
    }
    const after = await page.metrics(),momentCount = await page.$$eval('[data-moment-id]', nodes=>nodes.length);
    expect(momentCount).toBeGreaterThan(192); expect(frames/fps).toBeGreaterThan(20*60);
    const percentile = (values:number[],fraction:number) => values.toSorted((a,b)=>a-b)[Math.ceil(values.length*fraction)-1];
    const output = temporaryPath("production-studio-long-source-proof.json");
    await Bun.write(output,JSON.stringify({scope:"Synthetic saved responses in an isolated canonical fixture, not representative live production. No new game decisions or provider calls.",
      freshSavedResponseCount:192,momentCount,durationSeconds:frames/fps,fps,coldNavigationToReadinessMs,
      desiredFrameP95Ms:percentile(measured.map(sample=>sample.requestedMs),.95),committedFrameP95Ms:percentile(measured.map(sample=>sample.committedMs),.95),
      renderedReadinessP95Ms:percentile(measured.map(sample=>sample.readyMs),.95),samples:measured,
      memory:{before,after,heapGrowthBytes:after.JSHeapUsedSize === undefined || before.JSHeapUsedSize === undefined ? null : after.JSHeapUsedSize-before.JSHeapUsedSize,
        domGrowth:after.Nodes === undefined || before.Nodes === undefined ? null : after.Nodes-before.Nodes},
      limitations:["Cold metric includes initial source and media preparation; per-seek samples follow that preparation.","Heap/DOM readings are Chromium metrics after20seeks, without forced garbage collection or a production memory threshold."]},null,2));
    console.info(`STUDIO_LONG_SOURCE_PROOF ${output}`);
  } finally {await page.close();}
}, 180_000);

test("CLI browser login accepts Producer and Sysop sessions and reuses the checked cache", async () => {
  const configuredSession = process.env.INFLUENCE_API_SESSION_TOKEN;
  delete process.env.INFLUENCE_API_SESSION_TOKEN;
  try {
    for (const sessionToken of [sysopToken, studioFixture.producer.token]) {
      const cacheDirectory = await mkdtemp(join(tmpdir(), "studio-cli-session-"));
      let loginPage: Page | undefined, opened = 0;
      try {
        const input = {
          apiOrigin: `http://127.0.0.1:${api.port}`, webOrigin: webUrl,
          requiredRoles: ["producer", "sysop"], cacheDirectory,
          log: () => {},
          openBrowser: async (url: string) => {
            opened++;
            expect(new URL(url).pathname).toBe("/auth/cli");
            expect(url).not.toContain(sessionToken);
            loginPage = await createAuthenticatedPage(browser, sessionToken, url);
            await loginPage.waitForFunction("Array.from(document.querySelectorAll('button')).some(button => button.textContent?.trim() === 'Authorize local CLI' && !button.disabled)");
            await clickButton(loginPage, "Authorize local CLI");
          },
        };
        expect(await resolveCliApiSession(input)).toBe(sessionToken);
        await loginPage!.waitForFunction("document.body.innerText.toLowerCase().includes('return to your terminal')");
        expect(opened).toBe(1);
        expect(await resolveCliApiSession({...input, openBrowser: async () => {throw new Error("Valid cache must not open browser login");}})).toBe(sessionToken);
      } finally {
        await loginPage?.close();
        await rm(cacheDirectory, {recursive: true, force: true});
      }
    }
  } finally {
    if (configuredSession === undefined) delete process.env.INFLUENCE_API_SESSION_TOKEN;
    else process.env.INFLUENCE_API_SESSION_TOKEN = configuredSession;
  }
}, 90_000);

test.skipIf(!interfaceProof)("Actual Studio interface proves the editing loop on desktop and narrow screens", async () => {
  const url = `${webUrl}/admin/production/games/${studioFixture.influence.id}`;
  const savedAnnotations = await database.db.select().from(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId, studioFixture.influence.id));
  let page = await createAuthenticatedPage(browser, studioFixture.producer.token, url);
  let narrow = await createAuthenticatedPage(browser, studioFixture.producer.token, url);
  try {
    const proof = await proveStudioInterface(page, narrow, {...studioFixture.influence, werewolfUrl: `${webUrl}/admin/production/games/${studioFixture.werewolf.id}`});
    console.info(`STUDIO_INTERFACE_PROOF ${JSON.stringify(proof)}`);
    if (!operatorReview) return;
    // macOS headful fullscreen can remain pending under CDP emulation despite
    // trusted pointer delivery. Keep its manual trial distinct from the complete
    // automated proof above; operator access uses fresh, un-emulated windows.
    const reviewUrl=page.url(); await closeBrowser(browser);
    const chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    browser=await puppeteer.launch({headless:false,defaultViewport:null,...(existsSync(chrome) && {executablePath:chrome}),args:["--no-sandbox","--disable-dev-shm-usage"]});
    page=await createAuthenticatedPage(browser,studioFixture.producer.token,reviewUrl);
    await page.setViewport(null); await page.waitForSelector('[data-composition-frame]');
    const previousTargets = new Set(browser.targets());
    const rootCdp = await browser.target().createCDPSession();
    await rootCdp.send("Target.createTarget", {url, newWindow: true}); await rootCdp.detach();
    const target = await browser.waitForTarget(target => target.type() === "page" && !previousTargets.has(target));
    const nativeNarrow = await target.page();
    if (!nativeNarrow) throw new Error("Could not open the native narrow review window");
    await nativeNarrow.setViewport(null); await nativeNarrow.waitForSelector("[data-composition-frame]");
    narrow = nativeNarrow;
    const narrowCdp = await narrow.target().createCDPSession();
    const narrowWindow = await narrowCdp.send("Browser.getWindowForTarget");
    await narrowCdp.send("Browser.setWindowBounds", {windowId: narrowWindow.windowId, bounds: {width: 430, height: 980}}); await narrowCdp.detach();
    await narrow.waitForFunction("innerWidth <= 700 && innerWidth > 320");
    const cdp = await page.target().createCDPSession();
    const {windowId} = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", {windowId, bounds: {width: 1050, height: 1000}});
    await page.waitForFunction("innerWidth < 1100");
    await cdp.send("Browser.setWindowBounds", {windowId, bounds: {width: 1440, height: 1000}}); await cdp.detach();
    await page.waitForFunction("innerWidth > 1100");
    await narrow.bringToFront(); await narrow.waitForFunction("document.querySelector('[data-preview-frame]')?.getAttribute('data-preview-frame')===document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame')");
    await narrow.screenshot({path: temporaryPath("production-studio-revised-native-narrow.png")});
    await page.bringToFront(); await page.waitForFunction("document.querySelector('[data-preview-frame]')?.getAttribute('data-preview-frame')===document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame')");
    await page.screenshot({path: temporaryPath("production-studio-revised-native-desktop.png")});
    console.info(`STUDIO_OPERATOR_REVIEW_WINDOW_IDS ${JSON.stringify({desktop:windowId,narrow:narrowWindow.windowId,browserPid:browser.process()?.pid})}`);
    console.info(`STUDIO_OPERATOR_REVIEW_URL ${page.url()}\nSTUDIO_OPERATOR_REVIEW_NARROW ${narrow.url()}\nSTUDIO_OPERATOR_REVIEW_STOP http://127.0.0.1:${api.port}/__studio-review/finish\nSTUDIO_OPERATOR_REVIEW_IMAGES ${temporaryPath("production-studio-revised-native-desktop.png")} ${temporaryPath("production-studio-revised-native-narrow.png")}\nActual Studio, isolated canonical fixture. Tags and frozen downloads work. Repair/publication/resume writes are blocked in this manual review; isolated browser tests prove their actual service paths. Both native Chrome windows respond to resizing. Automated headless fullscreen/menu proof passed; native macOS fullscreen is a manual trial. Close Chrome or POST the stop URL to clean up browser/API/Next/database.`);
    await new Promise<void>(accept => {finishReview = accept; browser.once("disconnected", accept);});
  } catch (error) {
    console.error("[Studio interface]", await page.evaluate("document.body.innerText"));
    await page.screenshot({path:temporaryPath("production-studio-interface-failure.png")});
    throw error;
  } finally {
    finishReview = undefined;
    if (browser.connected) {if (!page.isClosed()) await page.close(); if (!narrow.isClosed()) await narrow.close();}
    await database.db.delete(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId, studioFixture.influence.id));
    if (savedAnnotations.length) await database.db.insert(schema.productionMomentAnnotations).values(savedAnnotations);
  }
}, 7_200_000);

// Optional encoded proof extends the required browser workflow using this same
// isolated API/database and Next child. No additional server or provider runs.
for (const proof of ["thinking", "influence-retrospective", "werewolf-retrospective"] as const) {
test.skipIf(process.env.STUDIO_ENCODED_PROOF !== "1")(`Actual Studio frozen ${proof} cut agrees with the encoded movie`, async () => {
  const kind = proof === "influence-retrospective" ? "influence" : "werewolf", audience = kind === "influence" ? "public" : "omniscient";
  const id = studioFixture[kind].id;
  const savedAnnotations = await database.db.select().from(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId,id));
  const page = await createAuthenticatedPage(browser, studioFixture.producer.token, `${webUrl}/admin/production/games/${id}?audience=${audience}`);
  let step = "source";
  try {
    await page.setViewport({width: 1800, height: 1100});
    await page.waitForSelector('[data-composition-frame]');
    let thoughtId: string | undefined, fromCursor = 1;
    do {
      const response = await fetch(`http://127.0.0.1:${api.port}/api/admin/production/games/${id}/source?audience=${audience}&thinking=on&fromCursor=${fromCursor}`, {headers:{Authorization:`Bearer ${studioFixture.producer.token}`}});
      expect(response.status).toBe(200);
      const source = await response.json() as {catalog:ProductionCatalog;nextCursor?:number|null};
      thoughtId = source.catalog.moments.find(moment => proof === "thinking" ? moment.kind === "thinking" : moment.purpose === "retrospective")?.id;
      if (thoughtId || !source.nextCursor) break;
      fromCursor = source.nextCursor;
    } while (true);
    if (!thoughtId) throw new Error(`Missing ${proof} in the complete canonical catalog`);
    await page.click(`[data-moment-id="${thoughtId}"] button[aria-label="Seek to moment"]`);
    await page.waitForFunction(`document.querySelector('[data-selected-moment]')?.getAttribute('data-selected-moment')===${JSON.stringify(thoughtId)} && document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment')===${JSON.stringify(thoughtId)}`);
    step = "thought tag";
    await markStudioLabel(page);
    await page.waitForFunction("document.body.innerText.includes('Saved revision 1')");
    step = "presentation";
    await openStudioDialog(page, "Presentation");
    for(const [label,value] of [["readingRate",4],["thinkingRate",4],["motionScale",2],["conversationGapMs",0]] as const) {
      await page.evaluate(`(()=>{const input=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    }
    await page.evaluate("Array.from(document.querySelectorAll('label')).find(label=>label.textContent?.trim()==='Music')?.querySelector('input')?.click()");
    await closeStudioDialog(page);
    step = "export settings";
    await openStudioDialog(page, "Export selected cut");
    await chooseStudioOption(page, "Output size", "640 pixels · draft"); await chooseStudioOption(page, "Frames per second", "24 fps");
    await closeStudioDialog(page);
    step = "selected view";
    await configureStudioCut(page,proof === "thinking" ? "Smart" : "None",proof === "thinking" ? "None" : "Smart");
    await clickButton(page, "Selected cut");
    await page.waitForFunction("document.querySelector('[data-preview-view]')?.getAttribute('data-preview-view') === 'cut' && document.querySelector('[data-composition-frame]')");
    // Match the encoded geometry for this comparison only. The ordinary bounded
    // monitor fit is proved separately by the actual interface check.
    await page.evaluate("(()=>{const stage=document.querySelector('[data-preview-frame]').parentElement;stage.style.flex='none';stage.style.width='642px';stage.style.height='362px';})()");
    await page.waitForFunction("(()=>{const r=document.querySelector('[data-preview-frame]').getBoundingClientRect();return r.width===640 && r.height===360;})()");
    expect(await page.$eval('[data-preview-frame]',node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}))).toEqual({width:640,height:360});
    const frozenResponse = page.waitForResponse(response=>response.url().endsWith('/selection') && response.request().method()==='POST');
    step = "freeze";
    await openStudioDialog(page, "Export selected cut");
    await clickButton(page, "Download selected export");
    const descriptor = await (await frozenResponse).json() as ProductionExportDescriptor;
    await closeStudioDialog(page);
    expect(descriptor.momentIds).toEqual([thoughtId]);
    expect(descriptor.settings.width).toBe(640); expect(descriptor.settings.fps).toBe(24); expect(descriptor.settings.music).toBe(false);
    step = "encode/parity";
    await verifyStudioEncodedParity({descriptor,token:studioFixture.producer.token,origin:`http://127.0.0.1:${api.port}`,
      output:await mkdtemp(temporaryPath("production-studio-ui-encoded-proof-")),captureFrame:frame=>captureStudioFrame(page,frame),purpose:proof === "thinking" ? "thinking" : "retrospective"});
  } catch (error) {
    console.error(`[Studio encoded: ${step}]`, await page.evaluate("document.body.innerText"));
    await page.screenshot({path:temporaryPath("production-studio-encoded-failure.png")});
    throw error;
  } finally {
    try {await page.close();}
    finally {
      await database.db.delete(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId,id));
      if (savedAnnotations.length) await database.db.insert(schema.productionMomentAnnotations).values(savedAnnotations);
    }
  }
}, 360_000);
}

test("Moment rows seek readable content while target icons seek the start in both games", async () => {
  for (const fixture of [studioFixture.influence,studioFixture.werewolf]) {
    const werewolf = fixture === studioFixture.werewolf;
    const page = await createAuthenticatedPage(browser,studioFixture.producer.token,`${webUrl}/admin/production/games/${fixture.id}${werewolf ? "?audience=omniscient" : ""}`);
    try {
      await page.setViewport({width:1440,height:920}); await page.waitForSelector('[data-composition-frame]');
      const thought = await page.$eval('[data-moment-id]:has([data-kind="thinking"])',node=>node.getAttribute('data-moment-id')!);
      const speech = await page.$eval('[data-moment-id]:has([data-kind="speech"])',node=>node.getAttribute('data-moment-id')!);
      // Media readiness can replace rows; resolve the current button for each action.
      for (const [id,content] of [[thought,'[data-in-scene-thinking]'],[speech,'[data-speech-bubble]']] as const) {
        await page.locator(`[data-moment-id="${id}"] > button:first-child`).click();
        await page.waitForFunction(`document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment')===${JSON.stringify(id)} && Number(getComputedStyle(document.querySelector('[data-preview-frame] ${content}')).opacity)===1`);
        const contentFrame = await page.$eval('[data-composition-frame]',node=>Number(node.getAttribute('data-composition-frame')));
        expect(await page.$eval('[data-selected-moment]',node=>node.getAttribute('data-selected-moment'))).toBe(id);
        if (id === thought) expect(await page.$('[data-preview-frame] [data-speech-bubble]')).toBeNull();
        await page.locator(`[data-moment-id="${id}"] [aria-label="Seek to moment"]`).click();
        await page.waitForFunction(`document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment')===${JSON.stringify(id)} && Number(document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame'))<${contentFrame}`);
        const startFrame = await page.$eval('[data-composition-frame]',node=>Number(node.getAttribute('data-composition-frame')));
        await page.locator(`[data-moment-id="${id}"] > button:first-child`).click();
        await page.waitForFunction(`Number(document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame'))===${contentFrame}`);
        expect(contentFrame).toBeGreaterThan(startFrame);
        expect(await page.$$eval('[aria-label="Playback controls"] button',nodes=>nodes.some(node=>node.textContent?.trim()==='Play'))).toBe(true);
      }
      // Source thinking playback remains an explicit preference. A blocked
      // thought selection pins Properties and pauses without revealing it.
      for (const enabled of [false,true]) {
        await openStudioDialog(page,"Source settings");
        const toggle = await page.evaluateHandle("Array.from(document.querySelectorAll('label')).find(node=>node.textContent?.trim()==='Play thinking in Source')?.querySelector('input')");
        try {await toggle.asElement()!.click();} finally {await toggle.dispose();}
        await page.waitForFunction(`new URL(location.href).searchParams.get('thinking')===${JSON.stringify(enabled ? "on" : "off")} && document.querySelector('[data-composition-frame]')`);
        await closeStudioDialog(page);
        if (!enabled) {
          await page.locator(`[data-moment-id="${speech}"] > button:first-child`).click();
          await page.waitForFunction(`document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment')===${JSON.stringify(speech)}`);
          const before = await page.$eval('[data-composition-frame]',node=>Number(node.getAttribute('data-composition-frame')));
          await clickButton(page,"Play");
          await page.waitForFunction(`Number(document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame'))>${before}`);
          await page.locator(`[data-moment-id="${thought}"] > button:first-child`).click();
          await page.waitForFunction("document.body.innerText.includes('Thinking is not playing in Source.') && Array.from(document.querySelectorAll('[aria-label=\"Playback controls\"] button')).some(node=>node.textContent?.trim()==='Play')");
          expect(await page.$eval('[data-selected-moment]',node=>node.getAttribute('data-selected-moment'))).toBe(thought);
          const stopped = await page.$eval('[data-preview-frame]',node=>Number(node.getAttribute('data-preview-frame')));
          await page.waitForFunction(`Number(document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame'))===${stopped}`);
          await new Promise(accept=>setTimeout(accept,150));
          expect(await page.$eval('[data-composition-frame]',node=>Number(node.getAttribute('data-composition-frame')))).toBe(stopped);
          expect(await page.$('[data-preview-frame] [data-in-scene-thinking]')).toBeNull();
        }
      }
      if (!werewolf) {
        // Generated-scene speech has its own entrance, not the portrait offset.
        const id = studioFixture.influence.roomSpeechId;
        await page.locator(`[data-moment-id="${id}"] > button:first-child`).click();
        await page.waitForFunction(`document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment')===${JSON.stringify(id)} && Number(getComputedStyle(document.querySelector('[data-preview-frame] [data-speech-bubble]')).opacity)===1`);
        await configureStudioCut(page,"Smart","None"); await clickButton(page,"Selected cut");
        // The source already contains this row and readable thought. Wait for
        // the routed cut view before issuing another row navigation.
        await page.waitForFunction("document.querySelector('[data-preview-view]')?.getAttribute('data-preview-view') === 'cut' && document.querySelector('[data-composition-frame]')");
        await page.waitForSelector(`[data-moment-id="${thought}"]`);
        await page.locator(`[data-moment-id="${thought}"] > button:first-child`).click();
        await page.waitForFunction("Number(getComputedStyle(document.querySelector('[data-preview-frame] [data-in-scene-thinking]')).opacity)===1");
        expect(await page.$('[data-preview-frame] [data-speech-bubble]')).toBeNull();
        await page.locator(`[data-moment-id="${thought}"] [aria-label="Seek to moment"]`).click();
        await page.waitForFunction("Number(document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame'))===0");
      }
    } finally {await page.close();}
  }
},90_000);

test("The latest row content selection survives delayed initial media preparation", async () => {
  const fixture = studioFixture.influence;
  const page = await createAuthenticatedPage(browser,studioFixture.producer.token,`${webUrl}/admin/production`);
  let release!:()=>void, sawMedia!:()=>void, deadline:ReturnType<typeof setTimeout>|undefined;
  const gate = new Promise<void>(accept=>{release=accept;});
  const pending = new Promise<void>(accept=>{sawMedia=accept;});
  const intercept = async (request:HTTPRequest) => {
    if (new URL(request.url()).pathname.startsWith(`/api/admin/production/games/${fixture.id}/visual/artifacts/`)) {sawMedia(); await gate;}
    await request.continue();
  };
  try {
    await page.setViewport({width:1440,height:920}); await page.setRequestInterception(true); page.on("request",intercept);
    await page.goto(`${webUrl}/admin/production/games/${fixture.id}`,{waitUntil:"domcontentloaded"});
    await Promise.race([pending,new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(new Error("Initial private media gate was not reached")),10_000);})]);
    clearTimeout(deadline); await page.waitForSelector(`[data-moment-id="${fixture.thoughtId}"]`);
    expect(await page.$('[data-composition-frame]')).toBeNull();
    await page.click(`[data-moment-id="${fixture.thoughtId}"] > button:first-child`);
    await page.click(`[data-moment-id="${fixture.speechId}"] > button:first-child`);
    release();
    await page.waitForFunction(`document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment')===${JSON.stringify(fixture.speechId)} && Number(getComputedStyle(document.querySelector('[data-preview-frame] [data-speech-bubble]')).opacity)===1`);
    expect(await page.$eval('[data-selected-moment]',node=>node.getAttribute('data-selected-moment'))).toBe(fixture.speechId);
  } finally {clearTimeout(deadline); release(); page.off("request",intercept); await page.setRequestInterception(false); await page.close();}
},90_000);

test("Checkbox labels save Werewolf Smart thoughts immediately and enter the same frozen cut", async () => {
  const id = studioFixture.werewolf.id;
  const saved = await database.db.select().from(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId,id));
  await database.db.delete(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId,id));
  const page = await createAuthenticatedPage(browser,studioFixture.producer.token,`${webUrl}/admin/production/games/${id}?audience=mystery`);
  try {
    await page.setViewport({width:1440,height:920}); await page.waitForSelector('[data-composition-frame]');
    expect(await page.$$('[data-moment-id] [data-kind="thinking"]')).toHaveLength(0);
    await chooseStudioOption(page,"Production audience","Omniscient");
    await page.waitForFunction("new URL(location.href).searchParams.get('audience')==='omniscient'");
    await page.waitForSelector('[data-composition-frame]'); await page.waitForSelector('[data-moment-id] [data-kind="thinking"]');
    const thoughts = await page.$$eval('[data-moment-id]:has([data-kind="thinking"])',nodes=>nodes.map(node=>node.getAttribute('data-moment-id')!));
    const speeches = await page.$$eval('[data-moment-id]:has([data-kind="speech"])',nodes=>nodes.map(node=>node.getAttribute('data-moment-id')!));
    const selected = thoughts.slice(0,3); expect(selected).toHaveLength(3); expect(thoughts.length).toBeGreaterThan(3);
    for (const momentId of selected) {
      await page.click(`[data-moment-id="${momentId}"] > button:first-child`);
      const response = page.waitForResponse(r=>r.url().endsWith(`/moments/${encodeURIComponent(momentId)}/annotation`) && r.request().method()==="POST");
      await markStudioLabel(page); expect((await response).status()).toBe(200);
      await page.waitForFunction(`document.querySelector('[data-moment-id="${momentId}"]')?.textContent?.includes('Smart')`);
    }
    // No Save-button click occurred. A new mount must find all three saved rows.
    await page.reload({waitUntil:"domcontentloaded"}); await page.waitForSelector('[data-composition-frame]');
    await openStudioDialog(page,"Selected cut rule");
    await chooseStudioOption(page,"Thinking inclusion","Matching labels");
    await page.click('[aria-label="Keep thinking marked Smart"]');
    await chooseStudioOption(page,"Speech inclusion","All"); await clickButton(page,"Watch selected cut");
    await page.waitForFunction("document.querySelector('[data-preview-view]')?.getAttribute('data-preview-view')==='cut' && !!document.querySelector('[data-composition-frame]')");
    expect(await page.$$eval('[data-moment-id]:has([data-kind="thinking"])',nodes=>nodes.map(node=>node.getAttribute('data-moment-id')))).toEqual(selected);
    expect(await page.$$eval('[data-moment-id]:has([data-kind="speech"])',nodes=>nodes.map(node=>node.getAttribute('data-moment-id')))).toEqual(speeches);
    const frozenResponse = page.waitForResponse(r=>r.url().endsWith('/selection') && r.request().method()==="POST");
    await openStudioDialog(page,"Export selected cut"); await clickButton(page,"Download selected export");
    const response = await frozenResponse; expect(response.status()).toBe(200);
    const frozen = await response.json() as ProductionExportDescriptor;
    expect(frozen.momentIds.filter(momentId=>thoughts.includes(momentId))).toEqual(selected);
    expect(frozen.annotations.filter(row=>selected.includes(row.momentId))).toEqual(selected.map(momentId=>({momentId,tags:{"label.smart":"true"},revision:1})));
    await closeStudioDialog(page);
    expect(await page.$$('[aria-label="Cut rules"]')).toHaveLength(1);
    await page.screenshot({path:temporaryPath("production-studio-smart-cut-desktop.png")});
    // The same single entry remains usable while narrow Properties hides the browser.
    for (const width of [390,320]) {
      await page.setViewport({width,height:844});
      await clickStudioButton(page,"Properties",'[aria-label="Editor panels"]');
      await page.waitForFunction("document.querySelector('[data-mobile-panel]')?.getAttribute('data-mobile-panel')==='properties'");
      expect(await page.evaluate("document.documentElement.scrollWidth<=innerWidth")).toBe(true);
      expect(await page.$$('[aria-label="Cut rules"]')).toHaveLength(1);
      await openStudioDialog(page,"Selected cut rule"); expect(await page.$('[aria-label="Keep thinking marked Smart"]:checked')).not.toBeNull();
      await closeStudioDialog(page);
    }
    await page.screenshot({path:temporaryPath("production-studio-smart-cut-narrow.png")});
    await page.setViewport({width:1440,height:920});
    await chooseStudioOption(page,"Production audience","Mystery");
    await page.waitForFunction("new URL(location.href).searchParams.get('audience')==='mystery'");
    await page.waitForSelector('[data-composition-frame]');
    expect(await page.$$('[data-moment-id] [data-kind="thinking"]')).toHaveLength(0);
    for (const momentId of selected) expect(await page.$(`[data-selected-moment="${momentId}"], [data-moment-id="${momentId}"]`)).toBeNull();
    await chooseStudioOption(page,"Production audience","Omniscient");
    await page.waitForFunction("new URL(location.href).searchParams.get('audience')==='omniscient'");
    await page.waitForFunction("document.querySelectorAll('[data-moment-id]:has([data-kind=thinking])').length===3 && !!document.querySelector('[data-composition-frame]')");
    expect(await page.$$eval('[data-moment-id]:has([data-kind="thinking"])',nodes=>nodes.map(node=>node.getAttribute('data-moment-id')))).toEqual(selected);
  } finally {
    await page.close();
    await database.db.delete(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId,id));
    if(saved.length) await database.db.insert(schema.productionMomentAnnotations).values(saved);
  }
},120_000);

test("Checkbox label saves keep metadata drafts, exact unknown retries and explicit conflicts", async () => {
  const {id,thoughtId} = studioFixture.influence;
  const saved = await database.db.select().from(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId,id));
  const page = await createAuthenticatedPage(browser,studioFixture.producer.token,`${webUrl}/admin/production/games/${id}`);
  const requests: string[] = []; let drop = true;
  const intercept = async (request: HTTPRequest) => {
    if (request.url().endsWith(`/moments/${encodeURIComponent(thoughtId)}/annotation`) && request.method()==="POST") {
      requests.push(request.postData()!);
      if(drop) {drop=false; await request.abort("failed"); return;}
    }
    await request.continue();
  };
  try {
    await page.setViewport({width:1440,height:920}); await page.waitForSelector('[data-composition-frame]');
    await page.click(`[data-moment-id="${thoughtId}"] > button:first-child`);
    await page.$eval('[aria-label="Moment properties"] details',node=>{(node as unknown as {open:boolean}).open=true;});
    await clickButton(page,"Add tag");
    await setStudioInput(page,"Tag key 3","editor.note"); await setStudioInput(page,"Tag value 3","Uncommitted note");
    await clickButton(page,"Add tag"); // Intentionally unfinished metadata must not block exact label retry.
    await clickButton(page,"Add tag");
    await setStudioInput(page,"Tag key 5","cut"); await setStudioInput(page,"Tag value 5","shorts");
    await page.setRequestInterception(true); page.on("request",intercept);
    await markStudioLabel(page,"Smart",false);
    await page.waitForFunction("document.body.innerText.includes('The save response is unavailable.')");
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0]!).tags).toEqual({cut:"youtube"});
    expect(await page.$$eval('[aria-label="Moment properties"] fieldset input',nodes=>nodes.every(node=>node.matches(':disabled')))).toBe(true);
    const retryResponse = page.waitForResponse(r=>r.url().endsWith(`/moments/${encodeURIComponent(thoughtId)}/annotation`) && r.request().method()==="POST");
    await clickButton(page,"Retry exact label request"); expect((await retryResponse).status()).toBe(200);
    await page.waitForFunction("document.body.innerText.includes('Saved revision 2')");
    expect(requests).toHaveLength(2); expect(requests[1]).toBe(requests[0]);
    expect(await page.$eval('[aria-label="Tag value 2"]',node=>(node as unknown as {value:string}).value)).toBe("Uncommitted note");
    expect(await page.$eval('[aria-label="Tag key 4"]',node=>(node as unknown as {value:string}).value)).toBe("cut");
    expect(await page.$eval('[aria-label="Tag value 4"]',node=>(node as unknown as {value:string}).value)).toBe("shorts");
    expect(await page.evaluate("document.body.innerText.includes('Unsaved draft')")).toBe(true);
    const [row] = await database.db.select().from(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.momentKey,thoughtId));
    expect(row!.tags).toEqual({cut:"youtube"});
    // A competing accepted edit is not silently overwritten by the next checkbox.
    await database.db.update(schema.productionMomentAnnotations).set({tags:{cut:"youtube","label.smart":"true"},revision:3}).where(eq(schema.productionMomentAnnotations.momentKey,thoughtId));
    const conflictResponse = page.waitForResponse(r=>r.url().endsWith(`/moments/${encodeURIComponent(thoughtId)}/annotation`) && r.request().method()==="POST");
    await markStudioLabel(page,"Smart",true); expect((await conflictResponse).status()).toBe(409);
    await page.waitForFunction("document.body.innerText.includes('Another edit was saved')");
    expect(await page.$$eval('[aria-label="Moment properties"] fieldset input',nodes=>nodes.every(node=>node.matches(':disabled')))).toBe(true);
    expect(await page.$eval('[aria-label="Tag value 2"]',node=>(node as unknown as {value:string}).value)).toBe("Uncommitted note");
    await page.click('[aria-label="Remove tag 3"]');
    await page.click('[aria-label="Remove tag 3"]');
    await clickButton(page,"Retry my draft at revision 3"); await page.waitForFunction("document.body.innerText.includes('Saved revision 4')");
    const [resolved] = await database.db.select().from(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.momentKey,thoughtId));
    expect(resolved!.tags).toEqual({cut:"youtube","label.smart":"true","editor.note":"Uncommitted note"});
  } finally {
    page.off("request",intercept); await page.setRequestInterception(false); await page.close();
    await database.db.delete(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId,id));
    if(saved.length) await database.db.insert(schema.productionMomentAnnotations).values(saved);
  }
},90_000);

test("Exact checkbox retry after an audience switch displays the accepted speech labels", async () => {
  const id = studioFixture.werewolf.id;
  const saved = await database.db.select().from(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId,id));
  await database.db.delete(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId,id));
  const page = await createAuthenticatedPage(browser,studioFixture.producer.token,`${webUrl}/admin/production/games/${id}?audience=omniscient`);
  let momentId: string, drop = true; const bodies: string[] = [];
  const intercept = async (request: HTTPRequest) => {
    if(request.url().endsWith(`/moments/${encodeURIComponent(momentId)}/annotation`) && request.method()==="POST") {
      bodies.push(request.postData()!);
      if(drop) {drop=false; await request.abort("failed"); return;}
    }
    await request.continue();
  };
  try {
    await page.setViewport({width:1440,height:920}); await page.waitForSelector('[data-composition-frame]');
    momentId = (await page.$$eval('[data-moment-id]:has([data-kind="speech"])',nodes=>nodes.map(node=>node.getAttribute('data-moment-id')!)))[0]!;
    await page.click(`[data-moment-id="${momentId}"] > button:first-child`);
    await page.setRequestInterception(true); page.on("request",intercept);
    await markStudioLabel(page); await page.waitForFunction("document.body.innerText.includes('The save response is unavailable.')");
    await chooseStudioOption(page,"Production audience","Mystery");
    await page.waitForFunction("new URL(location.href).searchParams.get('audience')==='mystery'");
    await page.waitForSelector('[data-composition-frame]'); await page.click(`[data-moment-id="${momentId}"] > button:first-child`);
    expect(await page.$$eval('[aria-label="Moment properties"] fieldset input',nodes=>nodes.map(node=>(node as unknown as {checked:boolean}).checked))).toEqual([false,false,false]);
    const retryResponse = page.waitForResponse(r=>r.url().endsWith(`/moments/${encodeURIComponent(momentId)}/annotation`) && r.request().method()==="POST");
    await clickButton(page,"Retry exact label request"); expect((await retryResponse).status()).toBe(200);
    await page.waitForFunction("document.body.innerText.includes('Saved revision 1')");
    expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
    expect(await page.$$eval('[aria-label="Moment properties"] fieldset input',nodes=>nodes.map(node=>(node as unknown as {checked:boolean}).checked))).toEqual([true,false,false]);
    expect(await page.evaluate("document.body.innerText.includes('Unsaved draft')")).toBe(false);
    expect(await page.$$('[data-moment-id] [data-kind="thinking"]')).toHaveLength(0);
  } finally {
    page.off("request",intercept); await page.setRequestInterception(false); await page.close();
    await database.db.delete(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId,id));
    if(saved.length) await database.db.insert(schema.productionMomentAnnotations).values(saved);
  }
},90_000);

test("Annotation settlement survives inspecting another moment", async () => {
  const fixture = studioFixture.influence;
  const saved = await database.db.select().from(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId, fixture.id));
  const page = await createAuthenticatedPage(browser,studioFixture.producer.token,`${webUrl}/admin/production/games/${fixture.id}`);
  let release = () => {};
  try {
    await page.setViewport({width:1440,height:920}); await page.waitForSelector('[data-composition-frame]');
    await page.click(`[data-moment-id="${fixture.thoughtId}"] > button:first-child`);
    for (const status of [200,409]) {
      let requested!: () => void;
      const gate = new Promise<void>(resolve => {release = resolve;});
      const pending = new Promise<void>(resolve => {requested = resolve;});
      const delayed = async (request: HTTPRequest) => {
        if (request.url().includes(`/moments/${encodeURIComponent(fixture.thoughtId)}/annotation`) && request.method() === "POST") {requested(); await gate;}
        await request.continue();
      };
      await page.setRequestInterception(true); page.on("request",delayed);
      try {
        const response = page.waitForResponse(r => r.url().includes(`/moments/${encodeURIComponent(fixture.thoughtId)}/annotation`) && r.request().method() === "POST");
        await markStudioLabel(page,status === 200 ? "Mistake" : "4th wall",true,false); await pending;
        await page.click(`[data-moment-id="${fixture.speechId}"] > button:first-child`);
        await page.waitForFunction(`document.querySelector('[data-selected-moment]')?.getAttribute('data-selected-moment')===${JSON.stringify(fixture.speechId)}`);
        if (status === 409) await database.db.update(schema.productionMomentAnnotations).set({tags:{"label.smart":"true"},revision:3}).where(eq(schema.productionMomentAnnotations.momentKey,fixture.thoughtId));
        release(); expect((await response).status()).toBe(status);
        await page.click(`[data-moment-id="${fixture.thoughtId}"] > button:first-child`);
        if (status === 200) {
          await page.waitForFunction("document.body.innerText.includes('Saved revision 2')");
          await configureStudioCut(page,"Mistake","None"); await clickButton(page,"Selected cut");
          await page.waitForFunction("document.querySelector('[data-preview-view]')?.getAttribute('data-preview-view')==='cut' && document.querySelectorAll('[data-moment-id]').length===1");
          expect(await page.$$('[data-moment-id]')).toHaveLength(1);
          await clickButton(page,"Source"); await page.waitForSelector(`[data-moment-id="${fixture.speechId}"]`);
          await page.click(`[data-moment-id="${fixture.thoughtId}"] > button:first-child`);
        } else {
          await page.waitForFunction("document.body.innerText.includes('Another edit was saved')");
          await page.waitForFunction("document.body.innerText.includes('Retry my draft at revision 3')");
          expect(await page.$$eval('[aria-label="Moment properties"] fieldset input',nodes=>nodes.map(node=>(node as unknown as {checked:boolean}).checked))).toEqual([true,true,true]);
          await clickButton(page,"Use saved labels");
        }
      } finally {release(); page.off("request",delayed); await page.setRequestInterception(false);}
    }
  } finally {
    release(); await page.close();
    await database.db.delete(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId,fixture.id));
    if (saved.length) await database.db.insert(schema.productionMomentAnnotations).values(saved);
  }
},90_000);

test("Actual studio samples canonical source, keeps fresh-mount drafts, freezes reviewed IDs and rejects changed cuts", async () => {
  const page = await createAuthenticatedPage(browser, studioFixture.producer.token, `${webUrl}/admin/production/games/${studioFixture.influence.id}`);
  const errors: string[] = []; page.on("pageerror", error => {errors.push(String(error));console.error("[Canonical Studio pageerror]",String(error));});
  try {
    await page.setViewport({width: 1440, height: 1050});
    await page.waitForSelector("[data-production-preview]", {timeout: 90_000});
    expect(await page.evaluate("document.body.innerText.includes('Choose how players know you')")).toBe(false);
    const thoughtId = studioFixture.influence.thoughtId;
    const inspected = `Array.from(document.querySelectorAll('[data-moment-id]')).find(row => row.getAttribute('data-moment-id') === ${JSON.stringify(thoughtId)})?.querySelector('button')`;
    await page.evaluate(`${inspected}?.click()`);
    await page.waitForFunction(`${inspected}?.getAttribute('aria-pressed') === 'true'`);
    await configureStudioCut(page,"Smart","None");
    await clickButton(page, "Selected cut");
    await page.waitForFunction(`document.querySelector('[data-preview-view]')?.getAttribute('data-preview-view') === 'cut' && document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment') === ${JSON.stringify(thoughtId)}`);
    const pixels = new Map<number, string>();
    for (const frame of [0, 15, 45]) pixels.set(frame, await sampleStudioFrame(page, frame));
    for (const frame of [45, 0, 15]) expect(await sampleStudioFrame(page, frame)).toBe(pixels.get(frame)!);
    expect(await page.$eval("[data-preview-frame]", node => node.textContent?.includes("I will listen closely"))).toBe(false);
    await page.reload({waitUntil: "domcontentloaded"}); await page.waitForSelector("[data-production-preview]");
    await configureStudioCut(page,"Smart","None");
    expect(await sampleStudioFrame(page, 45)).toBe(pixels.get(45)!);
    await captureStudioFrame(page,75);
    expect(await page.$eval('[data-composition-moment]',node=>node.getAttribute("data-composition-moment"))).toBe(thoughtId);
    // Hold the explicit published-media refresh while the operator seeks again.
    // Its later revision must retain that newer seek in the same selected moment.
    const beforeRefresh = await page.$eval('[data-preview-revision]',node=>node.getAttribute("data-preview-revision"));
    let releaseRefresh!:()=>void,sawRefresh!:()=>void;
    const refreshGate = new Promise<void>(accept=>{releaseRefresh=accept;});
    let requestTimer:ReturnType<typeof setTimeout>|undefined;
    const refreshRequested = new Promise<void>((accept,reject)=>{sawRefresh=accept;requestTimer=setTimeout(()=>reject(new Error("Explicit visual refresh did not reach the local request boundary")),5000);});
    const isRefresh = (request:HTTPRequest) => request.url().includes("/source?") && request.url().includes("refreshPublished=true");
    const delayRefresh = async (request:HTTPRequest) => {
      if(isRefresh(request)) {sawRefresh();await refreshGate;}
      await request.continue();
    };
    await page.setRequestInterception(true); page.on("request",delayRefresh);
    try {
      await openStudioDialog(page, "Scene versions & production");
      await clickButton(page,"Refresh published visuals"); await refreshRequested;
      clearTimeout(requestTimer);
      await closeStudioDialog(page);
      await captureStudioFrame(page,105); releaseRefresh();
      await page.waitForFunction(`document.querySelector('[data-preview-revision]')?.getAttribute('data-preview-revision')!==${JSON.stringify(beforeRefresh)} && document.body.innerText.includes('Published visuals refreshed at the same accepted source boundary.')`);
      await page.waitForFunction("Number(document.querySelector('[data-preview-frame]')?.getAttribute('data-preview-frame'))===105 && Number(document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame'))===105",{timeout:5000});
    } finally {clearTimeout(requestTimer);releaseRefresh();page.off("request",delayRefresh);await page.setRequestInterception(false);}
    const timeline = (await page.$('[aria-label="Timeline playhead"]'))!; await timeline.scrollIntoView();
    const bounds = (await timeline.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width * .1, bounds.y + 35); await page.mouse.down();
    const frames: number[] = [];
    const maximum = await page.$eval('[aria-label="Timeline playhead"]', node => Number(node.getAttribute("aria-valuemax")));
    for (const fraction of [.25, .5, .7]) {await page.mouse.move(bounds.x + bounds.width * fraction, bounds.y + 35); await page.waitForFunction(`Math.abs(Number(document.querySelector('[data-preview-frame]')?.getAttribute('data-preview-frame')) - ${Math.round(maximum * fraction)}) <= 1`); frames.push(await page.$eval("[data-preview-frame]", node => Number(node.getAttribute("data-preview-frame"))));}
    await page.mouse.up(); expect(frames[0]!).toBeLessThan(frames[1]!); expect(frames[1]!).toBeLessThan(frames[2]!);
    await database.db.update(schema.productionMomentAnnotations).set({tags: {cut: "festival"}, revision: 2}).where(eq(schema.productionMomentAnnotations.momentKey, thoughtId));
    await clickButton(page, "Save labels"); await page.waitForFunction("document.body.innerText.includes('Another edit was saved')");
    await page.$eval('[aria-label="Moment properties"] details',node=>{(node as unknown as {open:boolean}).open=true;});
    expect(await page.$eval('[aria-label="Tag value 1"]', node => (node as unknown as {value: string}).value)).toBe("youtube");
    await clickButton(page, "Retry my draft at revision 2"); await page.waitForFunction("document.body.innerText.includes('Saved revision 3')");
    const frozenResponse = page.waitForResponse(response => response.url().endsWith("/selection") && response.request().method() === "POST");
    await openStudioDialog(page, "Export selected cut");
    await clickButton(page, "Download selected export");
    const frozen = await (await frozenResponse).json() as ProductionExportDescriptor;
    expect(frozen.momentIds).toEqual([thoughtId]); expect(frozen.recordings).toEqual([]);
    expect(frozen.annotations).toEqual([{momentId: thoughtId, tags: {cut: "youtube", "label.smart": "true"}, revision: 3}]);
    await database.db.update(schema.productionMomentAnnotations).set({tags: {cut: "festival"}, revision: 4}).where(eq(schema.productionMomentAnnotations.momentKey, thoughtId));
    await clickButton(page, "Download selected export"); await page.waitForFunction("document.body.innerText.includes('Saved tags changed after this cut was reviewed')");
    await clickButton(page, "Refresh saved tags"); await page.waitForFunction("document.body.innerText.includes('Review refreshed cut')");
    expect(frozen.momentIds).toEqual([thoughtId]);
    await page.screenshot({path: temporaryPath("production-studio-canonical-conflict.png"), fullPage: true});
    // The supplied audio is a known local test signal, never generated speech or a provider request.
    const waveform = Buffer.alloc(44 + 8000 * 2);
    waveform.write("RIFF", 0); waveform.writeUInt32LE(waveform.length - 8, 4); waveform.write("WAVEfmt ", 8); waveform.writeUInt32LE(16, 16);
    waveform.writeUInt16LE(1, 20); waveform.writeUInt16LE(1, 22); waveform.writeUInt32LE(8000, 24); waveform.writeUInt32LE(16000, 28); waveform.writeUInt16LE(2, 32); waveform.writeUInt16LE(16, 34); waveform.write("data", 36); waveform.writeUInt32LE(16000, 40);
    for (let sample = 0; sample < 8000; sample++) waveform.writeInt16LE(Math.round(Math.sin(sample / 8000 * Math.PI * 880) * 1200), 44 + sample * 2);
    const audioName = "production-studio-local-recording.wav", audioPath = temporaryPath(audioName), manifestPath = temporaryPath("production-studio-local-speech.json");
    const transcripts = await database.db.select().from(schema.transcripts).where(eq(schema.transcripts.gameId, studioFixture.influence.id));
    const spoken = transcripts.find(row => row.text.startsWith("I will listen closely"))!;
    await Bun.write(audioPath, waveform); await Bun.write(manifestPath, JSON.stringify([{messageId: String(spoken.id), speakerId: spoken.speakerPlayerId, textHash: createHash("sha256").update(spoken.text).digest("hex"), file: audioName}]));
    await clickButton(page, "Review refreshed cut");
    await openStudioDialog(page, "Local recordings");
    await (await page.$('[aria-label="Import local recordings"]'))!.uploadFile(manifestPath, audioPath);
    await page.waitForFunction("document.body.innerText.includes('1 local recording references imported')");
    await closeStudioDialog(page);
    await clickButton(page, "Source");
    await page.waitForFunction("document.querySelector('[data-preview-view]')?.getAttribute('data-preview-view')==='source' && document.querySelector('[data-composition-frame]')");
    for (const enabled of [false,true]) {
      await openStudioDialog(page,"Source settings");
      const toggle = await page.evaluateHandle("Array.from(document.querySelectorAll('label')).find(node=>node.textContent?.trim()==='Play thinking in Source')?.querySelector('input')");
      try {await toggle.asElement()!.click();} finally {await toggle.dispose();}
      await page.waitForFunction(`new URL(location.href).searchParams.get('thinking')===${JSON.stringify(enabled ? "on" : "off")} && document.querySelector('[data-composition-frame]') && !!document.querySelector('[data-moment-id] [data-kind=thinking]')`);
      await closeStudioDialog(page);
    }
    // The native audio lifecycle below uses the import made before this scope
    // toggle, proving that presentation preferences do not discard recordings.
    await page.click(`[data-moment-id="${studioFixture.influence.speechId}"] button[aria-label="Seek to moment"]`);
    await page.waitForFunction(`document.querySelector('[data-selected-moment]')?.getAttribute('data-selected-moment')===${JSON.stringify(studioFixture.influence.speechId)} && document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment')===${JSON.stringify(studioFixture.influence.speechId)}`);
    await addStudioTag(page); await clickButton(page, "Save labels"); await page.waitForFunction("document.body.innerText.includes('Saved revision 1')");
    await configureStudioCut(page,"None","Smart");
    await clickButton(page, "Selected cut"); await page.waitForSelector("[data-production-preview]");
    await page.waitForFunction("document.querySelector('[data-preview-view]')?.getAttribute('data-preview-view')==='cut'");
    await proveRecordedAudioLifecycle(page);
    const recordingResponse = page.waitForResponse(response => response.url().endsWith("/selection") && response.request().method() === "POST");
    await openStudioDialog(page, "Export selected cut");
    await clickButton(page, "Download selected export");
    const recorded = await (await recordingResponse).json() as ProductionExportDescriptor;
    expect(recorded.momentIds).toEqual([studioFixture.influence.speechId]); expect(recorded.recordings).toHaveLength(1);
    expect(recorded.recordings[0]!.sha256).toBe(createHash("sha256").update(waveform).digest("hex")); expect(recorded.recordings[0]!.durationMs).toBeCloseTo(1000, 2);
    expect(JSON.stringify(recorded)).not.toContain("blob:"); expect(JSON.stringify(recorded)).not.toContain(audioName);
    await closeStudioDialog(page);
    await page.click('[aria-label="Back to production library"]');
    const reopen = `a[href^="/admin/production/games/${studioFixture.influence.id}?"]`;
    await page.waitForSelector(reopen); await page.click(reopen); await page.waitForSelector('[data-composition-frame]');
    await page.click(`[data-moment-id="${studioFixture.influence.speechId}"] button[aria-label="Seek to moment"]`);
    await page.waitForFunction(`document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment')===${JSON.stringify(studioFixture.influence.speechId)}`);
    await captureStudioFrame(page,300);
    expect(await page.$('[data-production-preview] [role="alert"]')).toBeNull();
    await openStudioDialog(page,"Local recordings");
    expect(await page.$$eval('dialog[open] button',nodes=>nodes.some(node=>node.textContent?.trim()==="Remove local recordings"))).toBe(false);
    await closeStudioDialog(page);
    await configureStudioCut(page,"None","Smart");
    await clickButton(page,"Selected cut");
    await page.waitForFunction("document.querySelector('[data-preview-view]')?.getAttribute('data-preview-view')==='cut' && document.querySelector('[data-composition-frame]')");
    const afterReturnResponse = page.waitForResponse(response=>response.url().endsWith('/selection') && response.request().method()==="POST");
    await openStudioDialog(page,"Export selected cut"); await clickButton(page,"Download selected export");
    const afterReturn = await (await afterReturnResponse).json() as ProductionExportDescriptor;
    expect(afterReturn.momentIds).toEqual([studioFixture.influence.speechId]); expect(afterReturn.recordings).toEqual([]);
    await page.goto(`${webUrl}/admin/production/games/${studioFixture.werewolf.id}?audience=mystery`, {waitUntil: "domcontentloaded"}); await page.waitForSelector("[data-production-preview]");
    expect(await page.$$('[data-moment-id] [data-kind="thinking"]')).toHaveLength(0);
    await chooseStudioOption(page, "Production audience", "Omniscient");
    await page.waitForSelector('[data-moment-id] [data-kind="thinking"]');
    await page.setViewport({width: 390, height: 844});
    expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
    await page.screenshot({path: temporaryPath("production-studio-canonical-narrow.png"), fullPage: true});
    expect(errors).toEqual([]);
  } catch (error) {
    await page.screenshot({path: temporaryPath("production-studio-canonical-failure.png"), fullPage: true});
    await Bun.write(temporaryPath("production-studio-canonical-failure.html"), await page.content());
    console.error("[Canonical Studio]", await page.evaluate("document.body.innerText"));
    throw error;
  } finally {await page.close();}
}, 120_000);

test("Cached selected-cut replacement reports the newly mounted Player's paused state", async () => {
  const thoughtId = studioFixture.influence.thoughtId, speechId = studioFixture.influence.speechId;
  const savedAnnotations = await database.db.select().from(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId, studioFixture.influence.id));
  const setTag = async (momentKey: string, value: string, revision: number) => {
    await database.db.insert(schema.productionMomentAnnotations).values({gameId: studioFixture.influence.id, momentKey, tags: {cut: value, [value === "youtube" ? "label.smart" : "label.mistake"]: "true"}, revision, updatedById: studioFixture.producer.userId})
      .onConflictDoUpdate({target: [schema.productionMomentAnnotations.gameId, schema.productionMomentAnnotations.momentKey], set: {tags: {cut: value, [value === "youtube" ? "label.smart" : "label.mistake"]: "true"}, revision}});
  };
  await setTag(thoughtId, "youtube", 10); await setTag(speechId, "festival", 10);
  const page = await createAuthenticatedPage(browser, studioFixture.producer.token, `${webUrl}/admin/production/games/${studioFixture.influence.id}?view=cut`);
  let releaseRefresh: (() => void) | undefined, requestTimer: ReturnType<typeof setTimeout> | undefined;
  let delayRefresh: ((request: HTTPRequest) => Promise<void>) | undefined;
  try {
    await page.setViewport({width: 1440, height: 1050});
    const waitForMoment = async (id: string) => page.waitForFunction(`document.querySelector('[data-preview-view]')?.getAttribute('data-preview-view')==='cut' && document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment')===${JSON.stringify(id)}`);
    const predicate = async (value: string, id: string) => {
      await configureStudioCut(page,value === "youtube" ? "Smart" : "Mistake", value === "youtube" ? "Smart" : "Mistake");
      await waitForMoment(id);
    };
    await page.waitForSelector("[data-composition-frame]"); await configureStudioCut(page,"Smart","Smart");
    await waitForMoment(thoughtId);
    // Warm both real selected bundles under the same accepted source/media hash.
    // A later saved-tag refresh then replaces Player without unmounting its host.
    await predicate("festival", speechId); await predicate("youtube", thoughtId);
    await captureStudioFrame(page, 45);
    await setTag(thoughtId, "festival", 11); await setTag(speechId, "youtube", 11);
    let sawRefresh!: () => void;
    const refreshGate = new Promise<void>(accept => {releaseRefresh=accept;});
    const refreshRequested = new Promise<void>((accept,reject) => {sawRefresh=accept;requestTimer=setTimeout(() => reject(new Error("Saved-tag refresh did not reach the local request boundary")), 5000);});
    delayRefresh = async request => {
      const url = new URL(request.url());
      if (url.pathname.endsWith("/source") && url.searchParams.has("snapshot") && !url.searchParams.has("refreshPublished")) {sawRefresh();await refreshGate;}
      await request.continue();
    };
    await page.setRequestInterception(true); page.on("request", delayRefresh);
    await openStudioDialog(page, "Selected cut rule");
    await clickButton(page, "Refresh saved tags"); await refreshRequested; clearTimeout(requestTimer);
    await closeStudioDialog(page);
    await clickButton(page, "Play");
    await page.waitForFunction("Number(document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame'))>45");
    if (!releaseRefresh) throw new Error("Saved-tag refresh gate was not initialized");
    releaseRefresh(); await waitForMoment(speechId);
    await page.waitForFunction("document.body.innerText.includes('Saved tags refreshed at the pinned source boundary.')");
    const committed = await page.$eval('[data-composition-frame]',node=>Number(node.getAttribute("data-composition-frame")));
    await Bun.sleep(150);
    expect(await page.$eval('[data-composition-frame]',node=>Number(node.getAttribute("data-composition-frame")))).toBe(committed);
    expect(await page.$$eval('[aria-label="Playback controls"] button',buttons=>buttons.find(button=>["Play","Pause"].includes(button.textContent?.trim() ?? ""))?.textContent?.trim())).toBe("Play");
    await clickButton(page,"Play");
    await page.waitForFunction(`Number(document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame'))>${committed}`);
    await clickButton(page,"Pause");
  } finally {
    clearTimeout(requestTimer); releaseRefresh?.();
    if(delayRefresh) {page.off("request",delayRefresh);await page.setRequestInterception(false);}
    await page.close();
    await database.db.delete(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId,studioFixture.influence.id));
    if(savedAnnotations.length) await database.db.insert(schema.productionMomentAnnotations).values(savedAnnotations);
  }
}, 120_000);

test("Studio keeps newer saved tags over a slow refresh and retries the exact uncertain export", async () => {
  const {thoughtId, speechId} = studioFixture.influence;
  const savedAnnotations = await database.db.select().from(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId, studioFixture.influence.id));
  await database.db.delete(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId, studioFixture.influence.id));
  await database.db.insert(schema.productionMomentAnnotations).values({gameId: studioFixture.influence.id, momentKey: thoughtId, tags: {cut:"youtube", "label.smart":"true"}, revision:1, updatedById:studioFixture.producer.userId});
  const page = await createAuthenticatedPage(browser, studioFixture.producer.token, `${webUrl}/admin/production/games/${studioFixture.influence.id}`);
  let releaseRefresh!: () => void, sawRefresh!: () => void;
  const refreshGate = new Promise<void>(accept => {releaseRefresh=accept;});
  const refreshRequested = new Promise<void>(accept => {sawRefresh=accept;});
  let heldRefresh = false, dropSelection = true;
  const selectionBodies: string[] = [];
  const intercept = async (request: HTTPRequest) => {
    const url = new URL(request.url());
    if (!heldRefresh && url.pathname.endsWith("/source") && url.searchParams.has("snapshot")) {
      heldRefresh=true;
      // Capture the actual API read before the subsequent annotation write,
      // then delay delivery to the browser at the local transport boundary.
      const response = await fetch(request.url(), {headers:request.headers()});
      const body = await response.text(); sawRefresh(); await refreshGate;
      await request.respond({status:response.status,contentType:"application/json",body});
    } else if (url.pathname.endsWith("/selection") && request.method()==="POST") {
      selectionBodies.push(request.postData()!);
      if (dropSelection) {dropSelection=false; await request.abort("failed");} else await request.continue();
    } else await request.continue();
  };
  try {
    await page.setViewport({width:1440,height:1050}); await page.waitForSelector('[data-composition-frame]');
    await page.click(`[data-moment-id="${speechId}"] button`);
    await page.waitForFunction(`document.querySelector('[data-selected-moment]')?.getAttribute('data-selected-moment')===${JSON.stringify(speechId)}`);
    await page.setRequestInterception(true); page.on("request",intercept);
    await openStudioDialog(page,"Selected cut rule"); await clickButton(page,"Refresh saved tags"); await refreshRequested; await closeStudioDialog(page);
    await addStudioTag(page);
    const saved = page.waitForResponse(response => response.url().includes(`/moments/${encodeURIComponent(speechId)}/annotation`) && response.request().method()==="POST");
    await clickButton(page,"Save labels"); expect((await saved).status()).toBe(200);
    await page.waitForFunction("document.body.innerText.includes('Saved revision 1')"); releaseRefresh();
    await page.waitForFunction("document.body.innerText.includes('Saved tags refreshed at the pinned source boundary.')");
    expect(await page.$$eval('[aria-label^="Tag key "]',nodes=>{
      const key=nodes.find(node=>(node as unknown as {value:string}).value==="cut");
      const value=key?.closest('div')?.querySelector('[aria-label^="Tag value "]');
      return value ? (value as unknown as {value:string}).value : undefined;
    })).toBe("youtube");
    await configureStudioCut(page,"Smart","Smart");
    await openStudioDialog(page,"Selected cut rule"); await clickButton(page,"Review refreshed cut");
    await page.waitForFunction("document.querySelector('[data-preview-view]')?.getAttribute('data-preview-view')==='cut' && document.querySelector('[data-composition-frame]')");
    expect(await page.$$eval('[data-moment-id]',nodes=>nodes.map(node=>node.getAttribute('data-moment-id')))).toEqual([thoughtId,speechId]);
    await openStudioDialog(page,"Export selected cut"); await clickButton(page,"Download selected export");
    await page.waitForFunction("Array.from(document.querySelectorAll('dialog[open] button')).some(node=>node.textContent?.trim()==='Retry exact export request' && !node.disabled)");
    expect(selectionBodies).toHaveLength(1);
    await closeStudioDialog(page); await openStudioDialog(page,"Selected cut rule");
    await closeStudioDialog(page); await configureStudioCut(page,"Mistake","Mistake");
    await page.waitForFunction("!document.querySelector('[data-moment-id]')");
    await openStudioDialog(page,"Export selected cut");
    const frozenResponse = page.waitForResponse(response=>response.url().endsWith('/selection') && response.request().method()==="POST");
    await clickButton(page,"Retry exact export request"); const response = await frozenResponse;
    expect(response.status()).toBe(200); expect(selectionBodies).toHaveLength(2); expect(selectionBodies[1]).toBe(selectionBodies[0]);
    const frozen = await response.json() as ProductionExportDescriptor;
    expect(frozen.momentIds).toEqual([thoughtId,speechId]); expect(frozen.selection).toEqual(JSON.parse(selectionBodies[0]!).selection);
  } finally {
    releaseRefresh(); page.off("request",intercept); await page.setRequestInterception(false); await page.close();
    await database.db.delete(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId,studioFixture.influence.id));
    if (savedAnnotations.length) await database.db.insert(schema.productionMomentAnnotations).values(savedAnnotations);
  }
}, 120_000);

test("Omniscient thinking visibility keeps the source pin and freezes independently saved speech while hidden", async () => {
  const id = studioFixture.werewolf.id;
  const savedAnnotations = await database.db.select().from(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId, id));
  await database.db.delete(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId, id));
  // Attach source diagnostics before entering the actual workspace, without
  // changing authentication or making an extra source read for the proof.
  const page = await createAuthenticatedPage(browser, studioFixture.producer.token, `${webUrl}/admin/production`);
  const sourceRequests: string[] = [];
  const sourceResponses: HTTPResponse[] = [];
  const isSource = (request: HTTPRequest) => request.method() === "GET" && new URL(request.url()).pathname === `/api/admin/production/games/${id}/source`;
  const observeSource = (request: HTTPRequest) => {if (isSource(request)) sourceRequests.push(request.url());};
  const observeResponse = (response: HTTPResponse) => {if (isSource(response.request())) sourceResponses.push(response);};
  page.on("request", observeSource); page.on("response",observeResponse);
  let step = "initial authorized source";
  try {
    await page.setViewport({width:1440,height:1050});
    await page.goto(`${webUrl}/admin/production/games/${id}?audience=omniscient&thinking=on`, {waitUntil:"domcontentloaded"});
    // A playable committed composition appears only after the shared loader has
    // consumed the complete prefix. Inspect its actual paged reads, not a second
    // API read or an assumption that the fixture fits in one source page.
    await page.waitForSelector('[data-composition-frame]');
    await page.waitForSelector('[data-moment-id] [data-kind="thinking"]');
    const sourcePages = await Promise.all(sourceResponses.map(async response => {
      expect(response.status()).toBe(200);
      return await response.json() as {snapshot:WerewolfProductionSnapshot; catalog:ProductionCatalog; thoughts:{thinking:string}[]; nextCursor:number|null};
    }));
    expect(sourcePages.length).toBeGreaterThan(0);
    const source = sourcePages[0]!;
    expect(source.snapshot.audience).toBe("omniscient"); expect(source.snapshot.thinking).toBe(true);
    for (const sourcePage of sourcePages) expect(sourcePage.snapshot).toEqual(source.snapshot);
    expect(sourcePages.at(-1)!.nextCursor).toBeNull();
    const moments = sourcePages.flatMap(sourcePage => sourcePage.catalog.moments);
    const thoughtId = moments.find(moment => moment.kind === "thinking")!.id;
    const speechId = moments.find(moment => moment.kind === "speech")!.id;
    const thoughtCopy = sourcePages.flatMap(sourcePage => sourcePage.thoughts.map(thought => thought.thinking)).filter(Boolean);
    expect(thoughtCopy.length).toBeGreaterThan(0);
    await page.waitForSelector(`[data-moment-id="${thoughtId}"] [data-kind="thinking"]`);
    const sourceReadCount = sourceRequests.length;
    const revision = await page.$eval('[data-preview-revision]', node => node.getAttribute("data-preview-revision"));
    const inspect = async (momentId:string) => {
      await page.click(`[data-moment-id="${momentId}"] button[aria-label="Seek to moment"]`);
      await page.waitForFunction(`document.querySelector('[data-selected-moment]')?.getAttribute('data-selected-moment')===${JSON.stringify(momentId)} && document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment')===${JSON.stringify(momentId)}`);
    };
    const toggleThinking = async (enabled:boolean) => {
      await openStudioDialog(page,"Source settings");
      const toggle = await page.evaluateHandle("Array.from(document.querySelectorAll('label')).find(node=>node.textContent?.trim()==='Play thinking in Source')?.querySelector('input')");
      try {await toggle.asElement()!.click();} finally {await toggle.dispose();}
      // Fence the intended visibility, media preparation and committed sample;
      // an outgoing Player marker alone is insufficient after a route change.
      await page.waitForFunction(`new URL(location.href).searchParams.get('thinking')===${JSON.stringify(enabled ? "on" : "off")} && !!document.querySelector('[data-moment-id] [data-kind=thinking]') && document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment')===${JSON.stringify(speechId)} && document.querySelector('[data-preview-frame]')?.getAttribute('data-preview-frame')===document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame')`);
      await closeStudioDialog(page);
      expect(sourceRequests).toHaveLength(sourceReadCount);
      expect(await page.$eval('[data-preview-revision]', node => node.getAttribute("data-preview-revision"))).toBe(revision);
      expect(await page.$('[data-production-preview] [role="alert"]')).toBeNull();
    };
    step = "independent thought tag";
    await inspect(thoughtId); await addStudioTag(page);
    const thoughtSaved = page.waitForResponse(result => result.url().endsWith(`/moments/${encodeURIComponent(thoughtId)}/annotation`) && result.request().method()==="POST");
    await clickButton(page,"Save labels"); expect((await thoughtSaved).status()).toBe(200);
    await page.waitForFunction("document.body.innerText.includes('Saved revision 1')");
    step = "thinking off/on retains the pin";
    await inspect(speechId);
    await toggleThinking(false); await toggleThinking(true); await toggleThinking(false);
    step = "save speech while thinking is hidden";
    await addStudioTag(page);
    const speechSaved = page.waitForResponse(result => result.url().endsWith(`/moments/${encodeURIComponent(speechId)}/annotation`) && result.request().method()==="POST");
    await clickButton(page,"Save labels"); const annotationResponse = await speechSaved;
    expect(annotationResponse.status()).toBe(200);
    const annotationBody = JSON.parse(annotationResponse.request().postData()!) as {thinking:boolean;snapshot:WerewolfProductionSnapshot;tags:Record<string,string>};
    expect(annotationBody.thinking).toBe(true); expect(annotationBody.snapshot).toEqual(source.snapshot);
    expect(annotationBody.tags).toEqual({cut:"youtube", "label.smart":"true"});
    await page.waitForFunction("document.body.innerText.includes('Saved revision 1')");
    step = "review exact speech-only cut";
    await configureStudioCut(page,"None","Smart");
    await clickButton(page,"Selected cut");
    await page.waitForFunction(`document.querySelector('[data-preview-view]')?.getAttribute('data-preview-view')==='cut' && document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment')===${JSON.stringify(speechId)} && document.querySelector('[data-preview-frame]')?.getAttribute('data-preview-frame')===document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame')`);
    expect(await page.$$eval('[data-moment-id]', nodes => nodes.map(node => node.getAttribute('data-moment-id')))).toEqual([speechId]);
    expect(await page.$$('[data-moment-id] [data-kind="thinking"]')).toHaveLength(0);
    const previewCopy = await page.$eval('[data-preview-frame]', node => node.textContent ?? "");
    for (const copy of thoughtCopy) expect(previewCopy).not.toContain(copy);
    step = "freeze against the unchanged authorized snapshot";
    const frozenResponse = page.waitForResponse(result => result.url().endsWith('/selection') && result.request().method()==="POST");
    await openStudioDialog(page,"Export selected cut"); await clickButton(page,"Download selected export");
    const frozenResult = await frozenResponse; expect(frozenResult.status()).toBe(200);
    const body = JSON.parse(frozenResult.request().postData()!) as {thinking:boolean;snapshot:WerewolfProductionSnapshot;selection:{thinking:boolean};expectedMomentIds:string[]};
    const frozen = await frozenResult.json() as ProductionExportDescriptor;
    expect(body.thinking).toBe(true); expect(body.snapshot).toEqual(source.snapshot);
    expect(body.selection.thinking).toBe(true); expect(body.expectedMomentIds).toEqual([speechId]);
    expect(frozen.sourceSnapshot).toEqual({...source.snapshot}); expect(frozen.sourceSnapshot.thinking).toBe(true);
    expect(frozen.selection.thinking).toBe(true); expect(frozen.momentIds).toEqual([speechId]);
    expect(frozen.annotations).toEqual([{momentId:speechId,tags:{cut:"youtube", "label.smart":"true"},revision:1}]);
    for (const copy of thoughtCopy) expect(JSON.stringify(frozen)).not.toContain(copy);
    expect(sourceRequests).toHaveLength(sourceReadCount);
  } catch (error) {
    console.error(`[Studio source pin: ${step}]`, await page.evaluate("document.body.innerText"));
    throw error;
  } finally {
    page.off("request",observeSource); page.off("response",observeResponse); await page.close();
    await database.db.delete(schema.productionMomentAnnotations).where(eq(schema.productionMomentAnnotations.gameId,id));
    if (savedAnnotations.length) await database.db.insert(schema.productionMomentAnnotations).values(savedAnnotations);
  }
}, 120_000);

test("Sysop opens game recovery from the bounded studio library without generating images", async () => {
  const page = await createAuthenticatedPage(browser, sysopToken, `${webUrl}/admin/production`);
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    const open = `a[href^="/admin/production/games/${gameId}?"]`;
    await page.waitForSelector(open);
    expect(await page.$('select[aria-label="Game for replay images"]')).toBeNull();
    expect(await page.$('[aria-label="Replay image production"]')).toBeNull();
    expect(await page.$('a[href^="/admin/production/games/replay-waiting?"]')).toBeNull();
    await page.click(open);
    await openStudioDialog(page, "Scene versions & production");
    await page.waitForSelector('[aria-label="Scene inspector"] [role="combobox"]');
    expect(await page.$('[aria-label="Replay image production"]')).toBeNull();
    await clickButton(page, "Game production and recovery");
    await page.waitForSelector('dialog[open][aria-label="Game production and recovery"]');
    expect(await page.$('[aria-label="Game production recovery"]')).not.toBeNull();
    await page.screenshot({ path: temporaryPath("replay-production-sysop-rows.png"), fullPage: true });
    await page.goto(`${webUrl}/admin/production/games/replay-other`, {waitUntil: "domcontentloaded"});
    await openStudioDialog(page, "Scene versions & production");
    await page.waitForFunction("document.body.innerText.includes('No generated scenes')");
    expect(await page.$('[aria-label="Replay image production"]')).toBeNull();
    expect((await database.db.select().from(schema.visualScenes)).filter(scene => scene.gameId === gameId)).toHaveLength(0);
    expect(await loadPayloads(database.db.select().from(schema.visualRepairJobs))).toHaveLength(0);
  } finally { await page.close(); }
}, 60_000);

test("Producer preserves exact lost-request controls, reviews and explicitly publishes from studio game tools", async () => {
  const page = await createAuthenticatedPage(browser, token, `${webUrl}/admin/production`);
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    const open = `a[href^="/admin/production/games/${gameId}?"]`;
    await page.waitForSelector(open);
    expect(await page.$('select[aria-label="Game for replay images"]')).toBeNull();
    expect(await page.$('[aria-label="Production for waiting-game"]')).toBeNull();
    expect(await page.$$eval('nav[aria-label="Administration"] a', links => links.map(link => link.textContent))).toEqual(["Games", "Production"]);
    expect(await page.$eval('nav[aria-label="Administration"] a', link => link.getAttribute("href"))).toBe("/admin/werewolf");
    expect((await database.db.select().from(schema.visualScenes)).filter(scene => scene.gameId === gameId)).toHaveLength(0);
    await page.click(open);
    // Source preparation replaces the initial properties layout. Wait for the
    // committed preview before sending a pointer click to that moving toolbar.
    await page.waitForSelector('[data-composition-frame]', {visible: true});
    await openStudioDialog(page, "Scene versions & production");
    await page.waitForSelector('[aria-label="Scene inspector"] [role="combobox"]');
    await page.waitForFunction("Array.from(document.querySelectorAll('[aria-label=\"Scene inspector\"] button')).some(b => b.textContent === 'Render missing image')");
    await page.screenshot({ path: temporaryPath("replay-production-desktop.png") });
    // Lose one response before admission; the same request must remain recoverable in its row.
    let dropped = false;
    await page.setRequestInterception(true);
    page.on("request", request => {
      if (!dropped && request.method() === "POST" && request.url().endsWith("/visual/missing")) { dropped = true; void request.abort("failed"); }
      else void request.continue();
    });
    await clickButton(page, "Render missing image", '[aria-label="Scene inspector"]');
    await clickButton(page, "Confirm render for this scene", '[aria-label="Scene inspector"]');
    await page.waitForFunction("document.body.innerText.includes('Check exact render request')");
    expect(await loadPayloads(database.db.select().from(schema.visualRepairJobs))).toHaveLength(0);
    await clickButton(page, "Check exact render request", '[aria-label="Scene inspector"]');
    await page.waitForFunction("document.body.innerText.includes('Version 1 queued for rendering')");
    expect(await loadPayloads(database.db.select().from(schema.visualRepairJobs))).toHaveLength(1);
    expect(await page.$('[aria-label="Scene repair"]')).not.toBeNull();
    const job = (await claimVisualMediaJob(database.db, "browser-test"))!;
    const imageArtifactId = await storeVisualArtifact(database.db, gameId, await sharp({ create: { width: 640, height: 360, channels: 3, background: "#352448" } }).png().toBuffer());
    await executeVisualMediaJob(database.db, job, new AbortController().signal, async () => ({ imageArtifactId,
      localization: { count: 2, verifiedParticipantIds: ["arden", "mira"], anchors: [] } }));
    await page.waitForFunction("document.body.innerText.includes('Ready for review')");
    expect(await database.db.select().from(schema.visualMediaPublications)).toHaveLength(0);
    await page.evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Versions and review')?.click()");
    await page.waitForSelector('img[alt="Candidate v1"]');
    await page.evaluate("Array.from(document.querySelectorAll('[aria-label=\"Scene inspector\"] summary')).find(node=>node.textContent==='Preview exact character framing')?.click()");
    await page.waitForSelector('[data-framing-version] img');
    const candidate = (await database.db.select().from(schema.visualMediaVersions)).find(version => version.gameId === gameId && version.version === 1)!;
    expect(await page.$eval('[data-framing-version]', node => node.getAttribute("data-framing-version"))).toBe(candidate.id);
    await page.evaluate("Promise.all(Array.from(document.querySelectorAll('[data-framing-version] img')).map(image=>image.decode()))");
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: temporaryPath("replay-production-mobile-review.png"), fullPage: true });
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
    await page.evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Correct images')?.click()");
    await page.waitForSelector('[aria-label="Correct image review"] img');
    await page.evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Use as group shot')?.click()");
    await page.select('select[aria-label="Character to mark"]', "arden");
    const surface = (await page.$('[aria-label="Place character marker on image"]'))!;
    await surface.scrollIntoView();
    const bounds = (await surface.boundingBox())!;
    await page.mouse.click(bounds.x + bounds.width * .25, bounds.y + bounds.height * .4);
    await page.waitForFunction("document.body.innerText.includes('1 marked heads in this picture.')");
    await page.screenshot({ path: temporaryPath("visual-image-correction-mobile.png"), fullPage: true });
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
    await page.evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Save reviewed version')?.click()");
    await page.waitForFunction("document.body.innerText.includes('Review saved. Publish this version when ready.')");
    expect(await database.db.select().from(schema.visualMediaPublications)).toHaveLength(0);
    const corrected = (await database.db.select().from(schema.visualMediaVersions)).find(v => v.verificationVersion === "producer-review-v1")!;
    expect(corrected.shots?.groups[0]?.visibleParticipantIds).toEqual(["arden"]);
    expect(corrected.shots?.groups[0]?.anchors[0]?.head.x).toBeCloseTo(.22, 1);
    await page.waitForFunction(`document.querySelector('[data-framing-version]')?.getAttribute('data-framing-version') === ${JSON.stringify(corrected.id)}`);
    // Saving reports its receipt before the refreshed versions finish loading.
    // A native click on the still-disabled publication button does nothing.
    await page.waitForFunction("Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Publish for viewers' && !button.disabled)");
    await page.evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Publish for viewers')?.click()");
    await page.waitForFunction("document.body.innerText.includes('Published for new viewer sessions')");
    expect(await database.db.select().from(schema.visualMediaPublications)).toHaveLength(1);
    await page.waitForFunction("document.body.innerText.includes('Viewer version: v2 · Publication 1')");
    const viewer = await (await api.fetch(new Request(`http://127.0.0.1:${api.port}/api/games/${gameId}/visual`))).json() as { enabled: boolean; scenes: unknown[] };
    expect(viewer.enabled).toBe(true); expect(viewer.scenes).toHaveLength(1);
    await page.goto(`${webUrl}/admin/users`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction("document.body.innerText.includes('You do not have access to this administration section.')");
  } catch (error) {
    await page.screenshot({ path: temporaryPath("replay-production-browser-failure.png"), fullPage: true });
    console.error("[Production browser]", await page.evaluate("document.body.innerText")); throw error;
  } finally { await page.close(); }
}, 120_000);

test("Studio opens, seeks and freezes a Werewolf thought with missing frozen art using the replay fallback", async () => {
  const id = "studio-werewolf-missing-art", events = await completedWerewolfResultsFixture("saved",id,2);
  const started = events.find(event=>event.type==="werewolf.started")!, actor = started.payload.players[0]!;
  actor.agentProfileId = "studio-missing-art-profile"; actor.contentRevisionId = null;
  await database.db.insert(schema.agentProfiles).values({id:actor.agentProfileId,userId:studioFixture.producer.userId,
    name:"Today's changed character",personality:"Changed",avatarUrl:"/api/uploads/local?key=unsubmitted-current.png"});
  await database.db.insert(schema.games).values({id,slug:id,gameKind:"werewolf",status:"completed",startedAt:"2026-09-01T00:00:00.000Z",config:"{}"});
  await database.db.insert(schema.werewolfEvents).values(events.map(event=>({gameId:id,sequence:event.sequence,event})));
  const page = await createAuthenticatedPage(browser,studioFixture.producer.token,`${webUrl}/admin/production/games/${id}`);
  const unexpected: string[] = []; page.on("request",request=>{if(request.url().includes("unsubmitted-current")) unexpected.push(request.url());});
  try {
    await page.setViewport({width:1800,height:1100}); await page.waitForSelector('[data-composition-frame]');
    expect(await page.$('[aria-label="Timeline playhead"]')).not.toBeNull();
    expect(await page.$eval('[aria-label="Timeline playhead"]',node=>Number(node.getAttribute("aria-valuemax")))).toBeGreaterThan(1);
    const sourceResponse = await fetch(`http://127.0.0.1:${api.port}/api/admin/production/games/${id}/source?audience=omniscient&thinking=on`,
      {headers:{Authorization:`Bearer ${studioFixture.producer.token}`}});
    const source = await sourceResponse.json() as {catalog:ProductionCatalog};
    const thoughtId = source.catalog.moments.find(moment=>moment.kind==="thinking" && moment.actorId===actor.id)!.id;
    await page.click(`[data-moment-id="${thoughtId}"] > button:first-child`);
    await page.waitForFunction(`document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment')===${JSON.stringify(thoughtId)}`);
    expect(await page.$$eval('[data-preview-frame] img',(images,name)=>images.filter(image=>image.getAttribute('alt')===name)
      .some(image=>image.getAttribute('src')?.startsWith('/avatars/personas/')),actor.name)).toBe(true);
    await markStudioLabel(page);
    await page.waitForFunction(`document.querySelector('[data-moment-id="${thoughtId}"]')?.textContent?.includes('Smart')`);
    await openStudioDialog(page,"Presentation");
    for (const [label,value] of [["readingRate",4],["thinkingRate",4],["motionScale",2],["conversationGapMs",0]] as const) {
      await setStudioInput(page,label,String(value));
    }
    await page.evaluate("Array.from(document.querySelectorAll('label')).find(label=>label.textContent?.trim()==='Music')?.querySelector('input')?.click()");
    await closeStudioDialog(page); await openStudioDialog(page,"Export selected cut");
    await chooseStudioOption(page,"Output size","640 pixels · draft"); await chooseStudioOption(page,"Frames per second","24 fps");
    await closeStudioDialog(page); await configureStudioCut(page,"Smart","None"); await clickStudioButton(page,"Selected cut");
    await page.waitForFunction("document.querySelector('[data-preview-view]')?.getAttribute('data-preview-view')==='cut' && !!document.querySelector('[data-composition-frame]')");
    await page.click(`[data-moment-id="${thoughtId}"] > button:first-child`);
    const frame = await page.$eval('[data-preview-frame]',node=>Number(node.getAttribute('data-preview-frame')));
    const first = await sampleStudioFrame(page,frame); await captureStudioFrame(page,0);
    expect(await sampleStudioFrame(page,frame)).toBe(first);
    await page.screenshot({path:temporaryPath("production-studio-missing-art-desktop.png")});
    await page.setViewport({width:390,height:844}); await page.waitForSelector('[data-composition-frame]');
    expect(await page.evaluate("document.documentElement.scrollWidth<=innerWidth")).toBe(true);
    await page.screenshot({path:temporaryPath("production-studio-missing-art-narrow.png")});
    await page.setViewport({width:1800,height:1100});
    const frozenResponse = page.waitForResponse(response=>response.url().endsWith('/selection') && response.request().method()==='POST');
    await openStudioDialog(page,"Export selected cut"); await clickStudioButton(page,"Download selected export");
    const response = await frozenResponse; expect(response.status()).toBe(200);
    const descriptor = await response.json() as ProductionExportDescriptor; await closeStudioDialog(page);
    expect(descriptor.momentIds).toEqual([thoughtId]); expect(unexpected).toEqual([]);
    if (process.env.STUDIO_ENCODED_PROOF === "1") {
      await page.evaluate("(()=>{const stage=document.querySelector('[data-preview-frame]').parentElement;stage.style.flex='none';stage.style.width='642px';stage.style.height='362px';})()");
      await page.waitForFunction("(()=>{const r=document.querySelector('[data-preview-frame]').getBoundingClientRect();return r.width===640 && r.height===360;})()");
      await verifyStudioEncodedParity({descriptor,token:studioFixture.producer.token,origin:`http://127.0.0.1:${api.port}`,
        output:await mkdtemp(temporaryPath("production-studio-missing-art-encoded-")),captureFrame:frame=>captureStudioFrame(page,frame)});
    }
    expect(unexpected).toEqual([]);
  } finally {await page.close();}
},360_000);

test("Studio opens, seeks and exports canonical Influence ballots with a reordered database roster", async () => {
  const id = studioFixture.influence.id, origin = `http://127.0.0.1:${api.port}`;
  const read = async () => {
    const response = await fetch(`${origin}/api/admin/production/games/${id}/source?audience=public&thinking=on`,{headers:{Authorization:`Bearer ${studioFixture.producer.token}`}});
    expect(response.status).toBe(200);
    return await response.json() as {catalog:ProductionCatalog;game:{players:{id:string}[]};frames:{players:{id:string}[]}[];nextCursor?:number|null};
  };
  const before = await read(), canonical = before.frames[0]!.players.map(player=>player.id);
  expect(before.nextCursor ?? null).toBeNull();
  const seats = await database.db.select({id:schema.gamePlayers.id,joinedAt:schema.gamePlayers.joinedAt}).from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId,id));
  let page:Page|undefined;
  try {
    for (const [index,playerId] of [...canonical].reverse().entries()) await database.db.update(schema.gamePlayers)
      .set({joinedAt:new Date(Date.UTC(2026,8,1,0,0,index)).toISOString()}).where(eq(schema.gamePlayers.id,playerId));
    const reordered = await read();
    expect(reordered.game.players.map(player=>player.id)).toEqual([...canonical].reverse());
    expect(reordered.frames[0]!.players.map(player=>player.id)).toEqual(canonical);
    expect(reordered.catalog.moments.map(moment=>moment.id)).toEqual(before.catalog.moments.map(moment=>moment.id));
    const ballot = reordered.catalog.moments.find(moment=>moment.part.kind==="influence-presentation" && moment.part.presentation.kind==="format_roll_call")!;
    expect(ballot.actorId).toBe(canonical[0]);
    page = await createAuthenticatedPage(browser,studioFixture.producer.token,`${webUrl}/admin/production/games/${id}`);
    await page.setViewport({width:1800,height:1100}); await page.waitForSelector('[data-composition-frame]');
    expect(await page.$('[role="alert"]')).toBeNull();
    await page.click(`[data-moment-id="${ballot.id}"] > button:first-child`);
    await page.waitForFunction(`document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment')===${JSON.stringify(ballot.id)}`);
    const frame = await page.$eval('[data-preview-frame]',node=>Number(node.getAttribute('data-preview-frame')));
    const pixels = await sampleStudioFrame(page,frame); await captureStudioFrame(page,0);
    expect(await sampleStudioFrame(page,frame)).toBe(pixels);
    await configureStudioCut(page,"None","None"); await openStudioDialog(page,"Selected cut rule");
    await page.click('dialog[open] details summary'); await chooseStudioOption(page,"Ballot inclusion","All"); await closeStudioDialog(page);
    await openStudioDialog(page,"Presentation");
    for (const [label,value] of [["readingRate",4],["thinkingRate",4],["motionScale",2],["conversationGapMs",0]] as const) await setStudioInput(page,label,String(value));
    await page.evaluate("(()=>{const input=Array.from(document.querySelectorAll('label')).find(label=>label.textContent?.trim()==='Music')?.querySelector('input');if(input?.checked)input.click();})()");
    await closeStudioDialog(page); await openStudioDialog(page,"Export selected cut");
    await chooseStudioOption(page,"Output size","640 pixels · draft"); await chooseStudioOption(page,"Frames per second","24 fps"); await closeStudioDialog(page);
    await clickStudioButton(page,"Selected cut");
    await page.waitForFunction("document.querySelector('[data-preview-view]')?.getAttribute('data-preview-view')==='cut' && !!document.querySelector('[data-composition-frame]')");
    await page.click(`[data-moment-id="${ballot.id}"] > button:first-child`);
    await page.waitForFunction(`document.querySelector('[data-composition-moment]')?.getAttribute('data-composition-moment')===${JSON.stringify(ballot.id)}`);
    await page.screenshot({path:temporaryPath("production-studio-ballot-order-desktop.png")});
    await page.setViewport({width:390,height:844}); expect(await page.evaluate("document.documentElement.scrollWidth<=innerWidth")).toBe(true);
    await page.screenshot({path:temporaryPath("production-studio-ballot-order-narrow.png")}); await page.setViewport({width:1800,height:1100});
    const frozenResponse = page.waitForResponse(response=>response.url().endsWith('/selection') && response.request().method()==='POST');
    await openStudioDialog(page,"Export selected cut"); await clickStudioButton(page,"Download selected export");
    const response = await frozenResponse; expect(response.status()).toBe(200);
    const descriptor = await response.json() as ProductionExportDescriptor; await closeStudioDialog(page);
    expect(descriptor.momentIds).toEqual(reordered.catalog.moments.filter(moment=>moment.kind==="ballot").map(moment=>moment.id));
    if (process.env.STUDIO_ENCODED_PROOF === "1") {
      await page.evaluate("(()=>{const stage=document.querySelector('[data-preview-frame]').parentElement;stage.style.flex='none';stage.style.width='642px';stage.style.height='362px';})()");
      await page.waitForFunction("(()=>{const r=document.querySelector('[data-preview-frame]').getBoundingClientRect();return r.width===640 && r.height===360;})()");
      const previewPage = page;
      await verifyStudioEncodedParity({descriptor,token:studioFixture.producer.token,origin,purpose:"ballot",
        output:await mkdtemp(temporaryPath("production-studio-ballot-order-encoded-")),captureFrame:frame=>captureStudioFrame(previewPage,frame)});
    }
  } finally {
    try {await page?.close();}
    finally {for (const seat of seats) await database.db.update(schema.gamePlayers).set({joinedAt:seat.joinedAt}).where(eq(schema.gamePlayers.id,seat.id));}
  }
},360_000);

test("MCP proposed cut opens exact Studio recipe, verifies voice and music, freezes, and detects tag drift",async()=>{
  const userId=studioFixture.producer.userId,raw=crypto.randomUUID();
  await database.db.update(schema.users).set({walletAddress:"0xstudio-mcp"}).where(eq(schema.users.id,userId));
  await database.db.insert(schema.mcpOauthAccessTokens).values({id:crypto.randomUUID(),tokenHash:hashOpaqueSecret(raw),userId,walletAddress:"0xstudio-mcp",clientId:MCP_OAUTH_CLIENT_ID,resourceUri:getMcpOAuthResourceUri(),scope:"producer producer:edit",audience:MCP_OAUTH_AUDIENCE,purpose:MCP_OAUTH_PURPOSE,expiresAt:"2099-01-01T00:00:00.000Z"});
  const rpc=async(name:string,args:Record<string,unknown>)=>{
    const response=await fetch(`http://127.0.0.1:${api.port}/mcp`,{method:"POST",headers:{Authorization:`Bearer ${raw}`,"Content-Type":"application/json",Accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}})});
    expect(response.status).toBe(200);const body=await response.json() as {error?:unknown;result:{structuredContent:{status:string;snapshot:unknown;moments:Array<{momentId:string;revision:number}>;audio:{missing:number;mismatched:number};reviewPath:string}}};expect(body.error).toBeUndefined();expect(body.result.structuredContent.status).toMatch(/^(ok|saved|unchanged)$/);return body.result.structuredContent;
  };
  const args={gameIdOrSlug:studioFixture.influence.id,audience:"public",thinking:true};
  const source=await rpc("read_production_moments",{...args,kind:"thinking",limit:100}),thought=source.moments.find((row:{momentId:string})=>row.momentId!==studioFixture.influence.thoughtId)!;
  await rpc("update_production_moment_tags",{...args,snapshot:source.snapshot,momentId:thought.momentId,expectedRevision:thought.revision,set:{"label.smart":"true"},remove:[]});
  const fixtureAudio=Bun.spawnSync(["ffmpeg","-v","error","-f","lavfi","-i","sine=frequency=440:duration=0.5","-f","mp3","pipe:1"]);expect(fixtureAudio.exitCode).toBe(0);
  const audioPreview=await previewAudioTrack(database.db,studioFixture.influence.id),track=await queueAudioBackfill(database.db,studioFixture.influence.id,userId,audioPreview.previewHash);
  await runAudioTrack(database.db,async()=>({bytes:fixtureAudio.stdout,durationMs:500,evidence:{fixture:true}}),undefined,track);
  const recipe={mode:"recipe",thinking:true,base:"empty",policies:{thinking:{mode:"any",labels:["smart"]},speech:{mode:"none"}}};
  const cut=await rpc("preview_production_cut",{...args,snapshot:source.snapshot,recipe,music:true,volume:.3,limit:100});expect(cut.audio.missing).toBe(0);expect(cut.audio.mismatched).toBe(0);
  const ids=cut.moments.map((row:{momentId:string})=>row.momentId);
  const page=await createAuthenticatedPage(browser,studioFixture.producer.token,`${webUrl}${cut.reviewPath}`);
  try {
    await page.setViewport({width:1800,height:1100});await page.waitForFunction("document.body.textContent.includes('Proposed cut loaded for review.')");await page.waitForSelector('[data-composition-frame]');
    expect(await page.$eval('[data-preview-view]',node=>node.getAttribute('data-preview-view'))).toBe("cut");
    expect(await page.$$eval('[data-moment-id]',nodes=>nodes.map(node=>node.getAttribute('data-moment-id')))).toEqual(ids);
    await openStudioDialog(page,"Presentation");expect(await page.evaluate("Array.from(document.querySelectorAll('label')).find(label=>label.textContent?.trim()==='Music')?.querySelector('input')?.checked")).toBe(true);await closeStudioDialog(page);
    await clickStudioButton(page,"Play");await page.waitForFunction("Number(document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame')) > 0");await clickStudioButton(page,"Pause");expect(await currentKeyboardFrame(page)).toBeGreaterThan(0);
    const responsePromise=page.waitForResponse(r=>r.url().endsWith('/selection') && r.request().method()==="POST");
    await openStudioDialog(page,"Export selected cut");await clickStudioButton(page,"Download selected export");const response=await responsePromise;expect(response.status()).toBe(200);
    const descriptor=await response.json() as ProductionExportDescriptor;expect(descriptor.momentIds).toEqual(ids);expect(descriptor.settings.music).toBe(true);expect(descriptor.recordings.length).toBe(ids.length);await closeStudioDialog(page);
    await page.screenshot({path:temporaryPath("producer-mcp-cut-review.png")});
    await page.click(`[data-moment-id="${thought.momentId}"] > button:first-child`);await markStudioLabel(page,"Smart",false);
    await page.waitForFunction(`!document.querySelector('[data-moment-id="${thought.momentId}"]')?.textContent?.includes('Smart')`);
    await page.goto(`${webUrl}${cut.reviewPath}`,{waitUntil:"domcontentloaded"});await page.waitForFunction("document.body.textContent.includes('This cut changed since it was proposed')");
    await openStudioDialog(page,"Export selected cut");expect(await page.evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.textContent?.trim()==='Download selected export')?.disabled")).toBe(true);
  }finally{await page.close();}
},180_000);
