import {readHouseGame} from "../services/house-game-inspection.js";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { runWerewolf, type WerewolfAgent } from "@influence/engine/werewolf";
import sharp from "sharp";
import type { StoredVisualShot } from "@influence/engine/visual-mode";
import { readWerewolfPresentation } from "../services/werewolf-presentation.js";
import { readReplayVisualProduction, renderMissingReplayScene } from "../services/visual-replay-production.js";
import { claimVisualMediaJob, executeVisualMediaJob } from "../services/visual-media-worker.js";
import { storeVisualArtifact } from "../services/visual-scene-store.js";
import { resolve } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Browser, Page } from "puppeteer";
import { schema } from "../db/index.js";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";
import { recordCurrentLegalAcceptance } from "../services/legal-acceptance.js";
import { claimWerewolfGame, createWerewolfGame, createWerewolfStore } from "../services/werewolf-games.js";
import { createAdminUser } from "./test-auth.js";
import { closeBrowser, createAuthenticatedPage, launchBrowser } from "./test-browser.js";
import { createIsolatedTestDb, destroyIsolatedTestDb, type TestDB } from "./test-db.js";
import { startTestServers, stopTestServers, type TestServerHandles } from "./test-server.js";
import { cleanupE2eResources } from "./cleanup.js";
import {checkSharedWerewolfWatch, checkConsecutiveReplies, checkInSceneThinking, checkBallotCollection, seekWatch, watchText, pauseWerewolf} from "./shared-watch-browser.js";
import type {WerewolfPresentation} from "@influence/engine/werewolf/presentation";
import { checkAdminContinuity } from "./admin-continuity-browser.js";

process.env.JWT_SECRET = "e2e-test-jwt-secret";
const originalMock = process.env.INFLUENCE_API_TEST_MOCK_RUNNER;
const originalRole = process.env.INFLUENCE_API_ROLE;
const originalOpenAiKey = process.env.OPENAI_API_KEY;
let database: TestDB;
let servers: TestServerHandles;
let browser: Browser;
let admin: Awaited<ReturnType<typeof createAdminUser>>;
let profileId: string;
beforeAll(async () => {
  process.env.INFLUENCE_API_TEST_MOCK_RUNNER = "true";
  process.env.OPENAI_API_KEY = "e2e-dummy-key-no-provider-calls";
  process.env.INFLUENCE_API_ROLE = "game-worker";
  database = await createIsolatedTestDb();
  admin = await createAdminUser(database.db);
  await recordCurrentLegalAcceptance(database.db, admin.userId, "existing_account", "0123456789abcdef0123456789abcdef01234567");
  const profile = await createOwnedAgentProfile(database.db, { userId: admin.userId }, { name: "Arden Vale", personality: "Calm and observant", gender: "non-binary", personaKey: "observer", strategyStyle: "Preserve my Influence strategy." });
  profileId = profile.profile.id;
  servers = await startTestServers({ databaseUrl: database.databaseUrl, adminAddress: admin.wallet.address, jwtSecret: process.env.JWT_SECRET, logDirectory: "/tmp/werewolf-browser-logs" });
  console.log(`WEREWOLF_BROWSER_URL=${servers.webUrl}`);
  browser = await launchBrowser();
}, 240_000);

async function checkFailedPackNegotiations() {
  const game = await createWerewolfGame(database.db, admin.userId, { preset: "two_wolves", agentProfileIds: [], maxDays: 1 });
  const claim = await claimWerewolfGame(database.db, game.id);
  if (!claim.ok) throw new Error(claim.error);
  const agent: WerewolfAgent = { async decide({ request, observation }) {
    if (request.action === "vote") {
      if (request.voteMode === "majority") return { kind: "target", targetId: null, thinking: "Hear more" };
      const ids = observation.board.players.filter(player => player.alive).map(player => player.id);
      const choices = [ids[1]!, ids[0]!, ids[0]!, ids[0]!, ids[2]!, ids[1]!, ids[3]!, ids[4]!];
      return { kind: "target", targetId: choices[ids.indexOf(request.actorId)]!, thinking: "Private final fixture" };
    }
    if (request.action === "open_thread") return { kind: "opening", text: null, cue: null, recipientIds: [] };
    if (request.action === "attack") {
      const wolves = observation.packIds.toSorted();
      return { kind: "target", targetId: request.legalTargetIds[wolves.indexOf(request.actorId)]!, thinking: "Private fixture" };
    }
    return request.legalTargetIds.length ? { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "Private fixture" }
      : { kind: "speech", cue: null, text: request.action === "pack_talk" ? "My pack proposal." : null };
  } };
  await runWerewolf(createWerewolfStore(database.db, game.id, claim.claim.ownerEpoch), agent);
  const page = await browser.newPage();
  try {
    const mystery = await (await fetch(`${servers.apiUrl}/api/werewolf/${game.slug}/presentation?audience=mystery`)).json() as WerewolfPresentation;
    expect(mystery.view.entries.some(entry=>entry.kind==="pack_vote")).toBe(false);
    expect(mystery.view.entries.filter(entry=>entry.kind==="vote").some(entry=>!entry.result.dayEnded)).toBe(true);
    await page.goto(`${servers.webUrl}/games/${game.slug}/replay?audience=mystery`,{waitUntil:"domcontentloaded"});
    await page.waitForSelector('[data-werewolf-stage][data-cursor]');
    await pauseWerewolf(page);
    await page.goto(`${servers.webUrl}/games/${game.slug}/replay?audience=omniscient`,{waitUntil:'domcontentloaded'});
    await pauseWerewolf(page);
    const omni = await (await fetch(`${servers.apiUrl}/api/werewolf/${game.slug}/presentation?audience=omniscient`)).json() as WerewolfPresentation;
    const finalPack = omni.view.entries.findIndex(entry=>entry.kind==="pack_vote" && entry.result.attempt===3);
    expect(finalPack).toBeGreaterThan(0);
    const watchIndex = await (await fetch(`${servers.apiUrl}/api/werewolf/${game.slug}/watch?audience=omniscient`)).json() as {playback:Array<{steps:number}>};
    await page.waitForFunction(`Number(document.querySelector('input[aria-label="Replay position"]').max) === ${watchIndex.playback.reduce((sum,entry)=>sum+entry.steps,0)}`);
    await seekWatch(page,finalPack+1);await watchText(page,"No agreement. No attack tonight.");
    await page.setViewport({width:390,height:844});await page.screenshot({path:"/tmp/werewolf-pack-ballots-mobile.png"});
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
    await page.goto(`${servers.webUrl}/games/${game.slug}/replay?audience=mystery`,{waitUntil:'domcontentloaded'});
    await pauseWerewolf(page);
    await page.waitForFunction('!document.body.innerText.includes("Pack ballot")');
  } finally { await page.close(); }
}
afterAll(async () => {
  await cleanupE2eResources([
    ["browser", async () => { if (browser) await closeBrowser(browser); }],
    ["servers", async () => { if (servers) await stopTestServers(servers); }],
    ["database", async () => { if (database) await destroyIsolatedTestDb(database.databaseUrl); }],
  ]);
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
  if (originalMock === undefined) delete process.env.INFLUENCE_API_TEST_MOCK_RUNNER;
  else process.env.INFLUENCE_API_TEST_MOCK_RUNNER = originalMock;
  if (originalRole === undefined) delete process.env.INFLUENCE_API_ROLE;
  else process.env.INFLUENCE_API_ROLE = originalRole;
}, 60_000);
async function text(page: Page, value: string) {
  await page.waitForFunction(`document.body.innerText.includes(${JSON.stringify(value)})`, { timeout: 25_000 });
}
async function click(page: Page, label: string) {
  await page.waitForFunction(`Array.from(document.querySelectorAll("button")).some(b => b.textContent?.trim() === ${JSON.stringify(label)} && !b.disabled)`);
  await page.evaluate(`Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === ${JSON.stringify(label)})?.click()`);
}

test("CLI creates an API Werewolf game and prints original sequential contributions", async () => {
  const directory = await mkdtemp(`${tmpdir()}/werewolf-cli-`);
  const output = resolve(directory, "summary.txt");
  const cli = Bun.spawn(["bun", "run", "simulate:werewolf:api", "--api-url", servers.apiUrl, "--web-url", servers.webUrl!, "--max-days", "1", "--timeout-seconds", "45", "--transcript", "--out", output], {
    cwd: resolve(import.meta.dir, "../../../.."),
    env: { ...process.env, INFLUENCE_API_SESSION_TOKEN: admin.jwt }, stdout: "pipe", stderr: "pipe",
  });
  try {
    const [exitCode, stdout, stderr] = await Promise.all([cli.exited, new Response(cli.stdout).text(), new Response(cli.stderr).text()]);
    expect({ exitCode, stderr }).toMatchObject({ exitCode: 0 });
    expect(stdout).toContain(`${servers.webUrl}/games/`);
    expect(stdout).toContain("Night 1:");
    expect(stdout).toContain("Votes:");
    expect(stdout).toContain("Result:");
    const report = await readFile(output, "utf8");
    expect(report).toBe(stdout);
    expect(report).toContain("I will compare the claims with today's vote.");
    expect(report).toContain("[pass]");
    expect(report).toContain("thread 1");
    expect(report).not.toContain("HOUSE ·");
    expect(report).toContain("[answer · turn");
    expect(report).toContain("Ballots:");
    expect(report).toContain("Alive (5)");
    expect(report.indexOf("Roles revealed:")).toBeGreaterThan(report.indexOf("Result:"));
    expect(report).not.toContain("Fixture speech");
    const games = await database.db.select().from(schema.games).where(eq(schema.games.gameKind, "werewolf"));
    expect(games).toHaveLength(1);
    expect(games[0]!.status).toBe("completed");
    expect(games[0]!.maxPlayers).toBe(6);
  } finally {
    cli.kill();
    await cli.exited;
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

test("owner edits a game-specific strategy, creates Werewolf, and watches both views on desktop and mobile", async () => {
  const page = await createAuthenticatedPage(browser, admin.jwt, `${servers.webUrl}/dashboard/agents/${profileId}/edit`, { privateKey: admin.wallet.privateKey });
  const mediaWrites: Array<{action:string;requestId:string;expectedVersion:number}> = [];
  page.on("request", request => { if(request.method() === "POST" && request.url().endsWith("/media")) { const body = JSON.parse(request.postData() ?? "{}"); mediaWrites.push(body); } });
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.waitForSelector("#agent-werewolfStrategyStyle");
    await page.setRequestInterception(true);
    const editorRequests: Record<string, unknown>[] = [];
    // Editor model responses and inventory are fixtures. Save, game creation,
    // worker execution, canonical history, and spectator reads use the real API.
    page.on("request", (request) => {
      const headers = { "access-control-allow-origin": new URL(servers.webUrl!).origin, "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };
      const respond = (body: unknown) => request.respond({ status: 200, contentType: "application/json", headers, body: JSON.stringify(body) });
      if (request.method() === "POST" && request.url().endsWith("/api/agent-profiles/edit-assistant")) {
        editorRequests.push(JSON.parse(request.postData()!));
        void respond({ tool: "update_character", fields: ["werewolfStrategyStyle"] });
      } else if (request.method() === "POST" && request.url().endsWith("/api/agent-profiles/generate")) {
        editorRequests.push(JSON.parse(request.postData()!));
        void respond({ name: "Unwanted rename", personality: "Unwanted rewrite", backstory: "Unwanted story", strategyStyle: "Unwanted Influence rewrite", werewolfStrategyStyle: "Track who changes their story.", personaKey: "aggressive", gender: "female", performanceInstructions: "Unwanted performance", visualDesign: "Unwanted visuals", introQuips: ["One", "Two", "Three"] });
      } else if (request.url().includes("/api/provider-models")) void respond({ status: "complete", models: [{ catalogId: "openai:gpt-6-luna", displayName: "Scripted test model", configured: true, available: true, capabilities: { supportsImageInput: true }, allowedReasoningPolicies: ["none", "low", "medium", "high"], defaultReasoningPolicy: "medium" }] });
      else void request.continue();
    });
    await page.evaluate("document.querySelector('#agent-werewolfStrategyStyle').nextElementSibling.open = true");
    await text(page, "Keep a careful record of claims and votes");
    await page.setViewport({ width: 390, height: 844 });
    await page.$eval("#agent-werewolfStrategyStyle", field => field.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: "/tmp/werewolf-strategy-default-mobile.png", fullPage: false });
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
    await page.setViewport({ width: 1440, height: 1000 });
    await page.click('#agent-ai-change-request');
    await page.evaluate(`(() => {
      const field = document.querySelector('#agent-ai-change-request');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, "Make their Werewolf strategy focus on contradictions.");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await page.click('button[aria-label="Send Agent request"]');
    await page.waitForFunction('document.querySelector("#agent-werewolfStrategyStyle").value === "Track who changes their story."');
    expect(editorRequests).toHaveLength(2);
    expect(editorRequests[1]).toMatchObject({ selectedFields: ["werewolfStrategyStyle"], existingProfile: { werewolfStrategyStyle: "", strategyStyle: "Preserve my Influence strategy." } });
    const saved = page.waitForResponse((response) => response.url().includes(`/api/agent-profiles/${profileId}`) && response.request().method() === "PATCH");
    await click(page, "Save changes");
    expect((await saved).status()).toBe(200);
    await page.waitForFunction("location.pathname === '/dashboard/agents'");
    const [profile] = await database.db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, profileId));
    expect(profile!.werewolfStrategyStyle).toBe("Track who changes their story.");
    expect(profile!.strategyStyle).toBe("Preserve my Influence strategy.");
    expect(profile!.name).toBe("Arden Vale");
    expect(profile!.personaKey).toBe("observer");
    await page.goto(`${servers.webUrl}/games/new`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('button[aria-pressed="false"]');
    await page.evaluate(`Array.from(document.querySelectorAll('button[aria-pressed]')).find(b => b.textContent.includes('Werewolf')).click()`);
    await text(page, "VILLAGE ROLES");
    await page.screenshot({ path: "/tmp/werewolf-create-game-choice.png", fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: "/tmp/werewolf-create-game-mobile.png", fullPage: true });
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
    await page.setViewport({ width: 1440, height: 1000 });
    await click(page, "Create Werewolf Game");
    await page.waitForFunction("location.pathname.startsWith('/games/') && location.pathname.split('/')[2] !== 'new'");
    const lobbyUrl = page.url();
    const slug = new URL(lobbyUrl).pathname.split('/')[2]!;
    await page.waitForSelector('.pre-show-hero-actions button');
    await page.click('.pre-show-hero-actions button');
    await page.waitForSelector('dialog.agent-selector input[aria-label="Arden Vale"]');
    await page.type('dialog input[type="search"]', 'Arden');
    await page.click('dialog input[aria-label="Arden Vale"]');
    await page.screenshot({ path: "/tmp/werewolf-casting-picker-desktop.png", fullPage: true });
    await page.click('dialog button[type="submit"]');
    await page.waitForSelector('button[aria-label="Remove Arden Vale from cast"]');
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('button[aria-label="Remove Arden Vale from cast"]');
    const [waiting] = await database.db.select().from(schema.games).where(eq(schema.games.slug, slug));
    expect(waiting!.status).toBe("waiting");
    expect(await database.db.select().from(schema.werewolfEvents).where(eq(schema.werewolfEvents.gameId, waiting!.id))).toHaveLength(0);
    await page.goto(`${servers.webUrl}/games`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('select[aria-label="Game type"]');
    await page.select('select[aria-label="Game type"]', 'werewolf');
    await page.select('select[aria-label="Game status"]', 'waiting');
    await page.type('input[aria-label="Search games"]', slug);
    await page.waitForSelector(`a[href="/games/${slug}"]`);
    await page.screenshot({ path: "/tmp/werewolf-games-library-desktop.png", fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: "/tmp/werewolf-games-library-mobile.png", fullPage: true });
    expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
    await page.click(`a[href="/games/${slug}"]`);
    await page.waitForSelector('button[aria-label="Remove Arden Vale from cast"]');
    await page.click('.pre-show-hero-actions button');
    await page.waitForSelector('dialog input[aria-label="Arden Vale"]:disabled');
    await page.screenshot({ path: "/tmp/werewolf-casting-picker-mobile.png", fullPage: true });
    expect(await page.evaluate("document.querySelector('dialog').scrollWidth <= document.querySelector('dialog').clientWidth")).toBe(true);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: "/tmp/werewolf-casting-mobile.png", fullPage: true });
    await page.click('button[aria-label="Remove Arden Vale from cast"]');
    await page.waitForFunction(`!document.querySelector('button[aria-label="Remove Arden Vale from cast"]')`);
    await page.click('.pre-show-hero-actions button');
    await page.waitForSelector('dialog input[aria-label="Arden Vale"]:not(:disabled)');
    await page.click('dialog input[aria-label="Arden Vale"]');
    await page.click('dialog button[type="submit"]');
    await page.waitForSelector('button[aria-label="Remove Arden Vale from cast"]');
    await page.setViewport({ width: 1440, height: 1000 });
    await page.screenshot({ path: "/tmp/werewolf-lobby-desktop.png", fullPage: true });
    const spectatorContext = await browser.createBrowserContext();
    const spectator = await spectatorContext.newPage();
    try {
      await spectator.goto(lobbyUrl, { waitUntil: "domcontentloaded" });
      await text(spectator, "Arden Vale");
      expect(await spectator.evaluate('Array.from(document.querySelectorAll("button")).some(button => button.textContent === "Start Werewolf")')).toBe(false);
      await click(page, "Start Werewolf");
      await spectator.waitForSelector('a[href$="/replay?audience=mystery"]');
    } finally { await spectatorContext.close(); }
    await page.waitForSelector('a[href$="/replay?audience=mystery"]');
    await checkSharedWerewolfWatch(page,page.url(),servers.apiUrl);
  } catch (error) {
    await page.screenshot({ path: "/tmp/werewolf-browser-failure.png", fullPage: true });
    console.error("Browser failure", page.url(), await page.evaluate("document.body.innerText"));
    throw error;
  } finally { await page.close(); }
}, 120_000);

test("failed pack negotiations stay hidden in Mystery and remain understandable in Omniscient", checkFailedPackNegotiations, 60_000);

test("Werewolf admin workspace supports desktop and mobile cost, activity, production and visibility journeys", async () => {
  const game = await createWerewolfGame(database.db, admin.userId, { preset: "two_wolves", agentProfileIds: [], maxDays: 1 });
  const claim = await claimWerewolfGame(database.db, game.id); if (!claim.ok) throw new Error(claim.error);
  let ballotRequests = 0;
  await runWerewolf(createWerewolfStore(database.db, game.id, claim.claim.ownerEpoch), { async decide({ request }) {
    if (request.action === "vote" && request.voteMode === "majority" && ballotRequests++ < 2) return {kind:"target", targetId:null, thinking:"I need more evidence"};
    if (request.action === "open_thread") return { kind: "opening", text: "Who can explain their suspicion?", cue: null, recipientIds: request.legalTargetIds.slice(0, 2) };
    return request.legalTargetIds.length ? { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "Private decision" } : { kind: "speech", text: "A short contribution", cue: null };
  } });
  const [producer] = await database.db.select().from(schema.roles).where(eq(schema.roles.name, "producer"));
  if (!producer) throw new Error("Producer role missing");
  await database.db.insert(schema.userRoles).values({ userId: admin.userId, roleId: producer.id }).onConflictDoNothing();
  const inventory = await readReplayVisualProduction(database.db, game.id);
  const lobby = inventory.scenes.find(scene => scene.roomId === "lobby")!;
  await renderMissingReplayScene(database.db, game.id, admin.userId, { key: lobby.key, previewHash: lobby.previewHash, requestId: "browser-lobby" });
  const job = await claimVisualMediaJob(database.db, "browser-fixture");
  if (!job) throw new Error("Fixture render job missing");
  // Initiative is seeded randomly per game. Keep the opening/reply actors in
  // verified panels while reserving an unrelated character for fallback checks.
  const replay = (await readWerewolfPresentation(database.db, game.id, "mystery")).presentation;
  const featured = [...new Set(replay.view.entries.filter(entry => entry.kind === "discussion").slice(0, 5).map(entry => entry.contribution.actorId))];
  const visualCast = [...featured.map(id => job.plan.cast.find(p => p.id === id)!), ...job.plan.cast.filter(p => !featured.includes(p.id))];
  const groups: StoredVisualShot[] = [], groupImageUrls: string[] = [];
  for (let i = 0; i < 3; i++) {
    const members = visualCast.slice(i * 2, i * 2 + 2);
    const bytes = await sharp(Buffer.from(`<svg width="640" height="360"><rect width="640" height="360" fill="${["#28382b", "#394059", "#593939"][i]}"/><text x="30" y="170" fill="white" font-size="25">Fixture panel ${i + 1}</text></svg>`)).png().toBuffer();
    groupImageUrls.push(`data:image/png;base64,${bytes.toString("base64")}`);
    const artifactId = await storeVisualArtifact(database.db, game.id, bytes);
    groups.push({ imageArtifactId: artifactId, annotatedArtifactId: artifactId, participantIds: members.map(p => p.id), visibleParticipantIds: members.map(p => p.id), pointers: [], anchors: members.map((p, index) => ({ playerId: p.id, label: index + 1, confidence: "clear", head: { x: .2 + .4 * index, y: .2, width: .12, height: .18 } })) });
  }
  await executeVisualMediaJob(database.db, job, new AbortController().signal, async () => ({ imageArtifactId: groups[0]!.imageArtifactId, localization: { count: 6, verifiedParticipantIds: groups.flatMap(g => g.visibleParticipantIds), anchors: [] }, shots: { mode: "groups", overview: null, groups } }));
  const page = await createAuthenticatedPage(browser, admin.jwt, `${servers.webUrl}/admin/werewolf?q=${game.slug}&status=completed`, { privateKey: admin.wallet.privateKey });
  const mediaWrites: Array<{action:string;requestId:string;expectedVersion:number}> = [];
  page.on("request", request => { if(request.method() === "POST" && request.url().endsWith("/media")) { const body = JSON.parse(request.postData() ?? "{}"); mediaWrites.push(body); } });
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await text(page, game.slug);
    await page.click(`a[href^="/admin/werewolf/${game.id}?"]`);
    await text(page, "Game overview"); await text(page, "RULES V7");
    expect(new URL(page.url()).searchParams.get("q")).toBe(game.slug);
    await checkAdminContinuity(page, game.id);
    await page.screenshot({ path: "/tmp/werewolf-admin-desktop.png", fullPage: true });
    await page.click(`nav[aria-label="Game workspace"] a[href*="/costs"]`);
    await text(page, "Gameplay spending"); await text(page, "Production spending");
    await page.setViewport({ width: 390, height: 844 });
    await page.waitForSelector('label select', { visible: true });
    await page.select('select', 'activity');
    await text(page, "Game activity"); await text(page, "A short contribution");
    await page.select('select', 'production');
    await text(page, "Village round table"); await text(page, "Private pack cellar");
    if (inventory.scenes.some(scene => scene.roomId === "mingle-2")) await text(page, "Moonlit hunt");
    else expect(await page.evaluate("document.body.innerText.includes('Moonlit hunt')")).toBe(false);
    await page.waitForSelector('[aria-label="Character coverage"]');
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
    await page.waitForFunction("document.getAnimations().every(animation => animation.playState !== 'running')");
    await page.click("[data-workspace-section] button[aria-expanded]");
    await page.waitForSelector('[aria-label="Character framing preview"] img');
    await page.select('select[aria-label="Frame character"]', visualCast[4]!.id);
    await page.waitForFunction(`Array.from(document.querySelectorAll('[aria-label="Character framing preview"] img')).some(image => image.complete && image.src === ${JSON.stringify(groupImageUrls[2])})`);
    await page.select('select[aria-label="Frame character"]', visualCast.at(-1)!.id);
    await page.waitForSelector('img[alt$="portrait fallback"]');
    await page.screenshot({ path: "/tmp/werewolf-admin-production-mobile.png", fullPage: true });
    await click(page, "Versions and review");
    await text(page, "3 group shots");
    for (let panel = 1; panel <= 3; panel++) await page.waitForSelector(`img[alt="Candidate v1 · Panel ${panel}"]`);
    await click(page, "Correct images");
    await text(page, "Save reviewed version");
    for (const group of groups) {
      await page.select('select[aria-label="Saved picture"]', `artifact:${group.imageArtifactId}`);
      await click(page, "Use as group shot");
    }
    await click(page, "Save reviewed version");
    await text(page, "Review saved. Publish this version when ready.");
    await click(page, "Publish for viewers");
    await text(page, "Published for new viewer sessions");
    expect(mediaWrites.map(write => [write.action,write.expectedVersion])).toEqual([["review",1],["publish",2]]);
    const viewer = await browser.newPage();
    try {
      await viewer.goto(`${servers.webUrl}/games/${game.slug}/replay?audience=mystery`, { waitUntil: "domcontentloaded" });
      await viewer.waitForSelector('[data-werewolf-stage][data-cursor]');
      await pauseWerewolf(viewer);
      await viewer.waitForSelector('[data-solo-image]');
      expect(await viewer.$('[aria-label="Current room"]')).toBeNull();
      const presentation = await (await fetch(`${servers.apiUrl}/api/werewolf/${game.slug}/presentation?audience=mystery`)).json() as WerewolfPresentation;
      const opening = presentation.view.entries.findIndex(entry => entry.kind === "discussion" && entry.contribution.text === "Who can explain their suspicion?");
      expect(opening).toBeGreaterThan(0);
      await seekWatch(viewer, opening + 1);
      await viewer.waitForFunction(`Number(document.querySelector('[data-werewolf-stage]')?.getAttribute('data-cursor')) === ${opening + 1}`);
      await viewer.waitForSelector('[aria-label="Current room"]');
      const persistentRoom = await viewer.$('[aria-label="Current room"]');
      await viewer.emulateMediaFeatures([{name: "prefers-reduced-motion", value: "no-preference"}]);
      await viewer.click('button[aria-label="Play replay"]');
      await viewer.waitForSelector('[data-panel-transition="true"]', {timeout: 25000});
      expect(await persistentRoom!.evaluate(element => element.isConnected)).toBe(true);
      await viewer.click('button[aria-label="Pause replay"]');
      await seekWatch(viewer, opening + 1);
      await viewer.waitForFunction(`Number(document.querySelector('[data-werewolf-stage]')?.getAttribute('data-cursor')) === ${opening + 1}`);
      await checkConsecutiveReplies(viewer);
      expect(await persistentRoom!.evaluate(element => element.isConnected)).toBe(true);
      await persistentRoom!.dispose();
      await viewer.waitForSelector('[aria-label="Current room"] [data-speech-bubble]', { visible: true });
      expect(await viewer.$eval('[aria-label="Current room"]', element => element.getBoundingClientRect().height)).toBeGreaterThan(100);
      expect(await viewer.$eval('[aria-label="Current room"]', element => element.getBoundingClientRect().width)).toBeGreaterThan(100);
      expect(await viewer.$eval('[aria-label="Current room"] [data-speech-bubble]', element => element.textContent)).toContain("A short contribution");
      expect(await viewer.evaluate(`Array.from(document.querySelectorAll('[aria-label="Current room"] img')).some(image => image.complete && image.src.includes("/media/"))`)).toBe(true);
      await viewer.screenshot({ path: "/tmp/werewolf-replay-published-panel.png" });
      await seekWatch(viewer, opening + 1);
      await viewer.waitForFunction(`Number(document.querySelector('[data-werewolf-stage]')?.getAttribute('data-cursor')) === ${opening + 1}`);
      await checkConsecutiveReplies(viewer);
      await checkBallotCollection(viewer, presentation);
      await checkInSceneThinking(viewer, `${servers.webUrl}/games/${game.slug}/replay`, servers.apiUrl);

    } catch(error) {
      console.error("Viewer failure", await viewer.evaluate("({text:document.body.innerText,cursor:document.querySelector('[data-werewolf-stage]')?.getAttribute('data-cursor'),elapsed:document.querySelector('[data-werewolf-stage]')?.getAttribute('data-elapsed')})"));
      await viewer.screenshot({path:"/tmp/werewolf-intros-viewer-failure.png"});
      throw error;
    } finally { await viewer.close(); }

    await page.select('select', 'overview'); await text(page, "Game overview");
    await click(page, "Hide game"); await text(page, "Restore listing");
    expect((await database.db.select().from(schema.games).where(eq(schema.games.id, game.id)))[0]!.hiddenAt).not.toBeNull();
    await click(page, "Restore listing"); await text(page, "Hide game");
    await page.select('select', 'costs'); await text(page, "Gameplay spending");
    await page.waitForFunction("document.getAnimations().every(animation => animation.playState !== 'running')");
    await page.screenshot({ path: "/tmp/werewolf-admin-costs-mobile.png", fullPage: true });
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
    // Server grants, rather than the JWT's original sysop claim, own these reads.
    const [adminRole] = await database.db.select().from(schema.roles).where(eq(schema.roles.name,"admin"));
    const [sysopRole] = await database.db.select().from(schema.roles).where(eq(schema.roles.name,"sysop"));
    if (!adminRole || !sysopRole) throw new Error("Missing seeded roles");
    await database.db.delete(schema.userRoles).where(eq(schema.userRoles.userId,admin.userId));
    await database.db.insert(schema.userRoles).values({userId:admin.userId,roleId:adminRole.id});
    await click(page,"Refresh");
    await page.select('label select','production');
    await text(page,"Producer or Sysop access is required");
    expect(await page.evaluate("document.querySelector('[aria-label=\"Character coverage\"]') === null")).toBe(true);
    await page.select('label select','overview'); await text(page,"Game overview");
    await database.db.delete(schema.userRoles).where(eq(schema.userRoles.userId,admin.userId));
    await click(page,"Refresh");
    await page.waitForFunction("!document.querySelector('[data-game-header]')");
    expect(await page.evaluate("document.body.innerText.includes('Game overview')")).toBe(false);
    await database.db.insert(schema.userRoles).values({userId:admin.userId,roleId:sysopRole.id});
    await click(page,"Retry"); await text(page,"Game overview");
    await page.click('a[href^="/admin/werewolf?"]');
    await text(page, game.slug);
    expect(new URL(page.url()).searchParams.get("q")).toBe(game.slug);
    await page.goto(`${servers.webUrl}/admin/werewolf/${game.slug}/costs`,{waitUntil:"domcontentloaded"});
    await text(page,"Gameplay spending");
    expect(await page.evaluate("document.querySelectorAll('main').length")).toBe(1);
    await page.goto(`${servers.webUrl}/admin/werewolf/${game.id}/invalid`,{waitUntil:"domcontentloaded"}); await text(page,"404");
    await page.goto(`${servers.webUrl}/admin/games/new`,{waitUntil:"domcontentloaded"}); await text(page,"Create Influence Game");
    expect(await page.evaluate("document.querySelectorAll('main').length")).toBe(1);
  } catch (error) {
    await page.screenshot({ path: "/tmp/werewolf-admin-failure.png", fullPage: true });
    console.error("Admin browser failure", page.url(), await page.evaluate("document.body.innerText"));
    throw error;
  } finally { await page.close(); }
}, 90_000);

test("shared House replay handles failed portraits and reduced motion", async () => {
  const [game] = await database.db.select().from(schema.games).where(eq(schema.games.gameKind,"werewolf"));
  if (!game) throw new Error("Missing completed replay fixture");
  const page=await browser.newPage();
  try {
    await page.emulateMediaFeatures([{name:"prefers-reduced-motion",value:"reduce"}]);
    await page.setRequestInterception(true);
    page.on("request",request=>{if(request.url().includes("/characters/")) void request.respond({status:404,body:"Missing frozen reference"});else void request.continue();});
    await checkSharedWerewolfWatch(page,`${servers.webUrl}/games/${game.slug}/replay`,servers.apiUrl);
  } finally {await page.close();}
},90_000);

test("shared replay fences delayed seeks and crosses silent live windows without moving a paused viewer", async () => {
  const [game] = await database.db.select().from(schema.games).where(eq(schema.games.gameKind, "werewolf"));
  if (!game) throw new Error("Missing replay fixture");
  const base = await (await fetch(`${servers.apiUrl}/api/werewolf/${game.slug}/watch?audience=mystery`)).json() as import("@influence/engine/werewolf/watch-contract").WerewolfWatchWindow;
  const source = base.moments.find(moment => moment.entry.kind === "speech" && moment.entry.text);
  if (!source || source.entry.kind !== "speech") throw new Error("Missing introduction speech");
  const speech = source.entry;
  const page = await browser.newPage();
  await page.setViewport({width:1440,height:1000});
  let head = 96, delayMiddle = true, reads = 0;
  const startedAt = performance.now();
  const pending = new Set<ReturnType<typeof setTimeout>>();
  const failures: string[] = [];
  page.on("pageerror", error => failures.push(String(error)));
  await page.setRequestInterception(true);
  page.on("request", request => {
    const url = new URL(request.url());
    if (request.method() !== "GET" || !url.pathname.endsWith("/watch")) { void request.continue(); return; }
    reads++;
    const from = Number(url.searchParams.get("fromCursor") ?? 1);
    const moments = Array.from({length: Math.max(0, Math.min(32, head - from + 1))}, (_, index) => {
      const cursor = from + index;
      return {...source, cursor, mediaKey: null, snapshot: {...source.snapshot, cursor}, entry: {...speech, text: cursor === 1 ? "Opening contribution." : cursor === 33 ? "Middle contribution." : cursor === 96 ? "Latest contribution." : cursor === 97 ? "Frontier contribution." : null}};
    });
    const reply = () => request.respond({status: 200, contentType: "application/json", headers: {"Access-Control-Allow-Origin": "*"}, body: JSON.stringify({...base, status: "in_progress", latestCursor: head, fromCursor: from, throughCursor: moments.at(-1)?.cursor ?? head, moments, playback: [1,33,96,97].filter(cursor=>cursor<=head).map(cursor=>({cursor,steps:1})), media: {}})});
    if (from === 33 && delayMiddle) {
      const timer = setTimeout(() => { pending.delete(timer); void reply(); }, 600);
      pending.add(timer);
    } else void reply();
  });
  try {
    await page.goto(`${servers.webUrl}/games/${game.slug}/replay?audience=mystery`, {waitUntil: "domcontentloaded"});
    await page.waitForSelector('[data-werewolf-stage][data-cursor="1"]');
    await pauseWerewolf(page);
    const stage = await page.$('[data-werewolf-stage]');
    // Rapid B then C: B is delayed. The old picture stays during preparation.
    await page.evaluate(`(() => { const input=document.querySelector('input[aria-label="Replay position"]'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; for(const value of ['2','3']) {set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));} })()`);
    await page.waitForFunction("document.querySelector('input[aria-label=\"Replay position\"]').getAttribute('value') === '3'");
    expect(await stage!.evaluate(node => node.isConnected)).toBe(true);
    expect(await page.$$('[data-watch-context]')).toHaveLength(1);
    await page.waitForSelector('[data-werewolf-stage][data-cursor="96"]');
    delayMiddle = false;
    head = 97;
    // Let an actual poll arrive. The new head can update the scrub range but not the paused position.
    await page.waitForFunction("document.querySelector('input[aria-label=\"Replay position\"]').max === '4'", {timeout: 10_000});
    expect(await page.$eval('input[aria-label="Replay position"]', input => input.getAttribute('value'))).toBe("3");
    await page.evaluate("document.activeElement?.blur()");
    await page.keyboard.press("Space");
    await page.waitForSelector('[data-werewolf-stage][data-cursor="97"]');
    await watchText(page, "Frontier contribution.");
    // A playing seek across silent history still exposes Pause while fetching the next line.
    delayMiddle = true;
    await page.evaluate(`(() => {const input=document.querySelector('input[aria-label="Replay position"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await page.waitForFunction("Array.from(document.querySelectorAll('button')).some(e=>e.getAttribute('aria-label')==='Pause replay')");
    await page.evaluate("document.activeElement?.blur()");
    await page.keyboard.press("Space");
    await page.waitForFunction("!Array.from(document.querySelectorAll('[role=status]')).some(e=>e.textContent==='Preparing…')");
    await page.waitForSelector('[data-werewolf-stage][data-cursor="33"]');
    await page.waitForFunction("Array.from(document.querySelectorAll('button')).some(e=>e.getAttribute('aria-label')==='Play replay')");
    await page.keyboard.press("Space");
    await page.evaluate(`(() => {const input=document.querySelector('input[aria-label="Replay position"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'1');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await page.waitForSelector('[data-werewolf-stage][data-cursor="1"]');
    // Seeking retains play intent through three windows of passes. They never produce a Pass card.
    await page.evaluate("document.activeElement?.blur()");
    await page.keyboard.press("4");
    await page.waitForSelector('[data-werewolf-stage][data-cursor="97"]', {timeout: 25_000});
    expect(await page.$$('[data-watch-context]')).toHaveLength(1);
    expect(failures).toEqual([]);
    // Bound navigation/prefetch work separately from the three-second live polls.
    expect(reads).toBeLessThan(24 + Math.ceil((performance.now() - startedAt) / 3000));
  } catch(error) {
    console.error("Watch race failure", reads, failures, await page.evaluate("document.body.innerText"));
    throw error;
  } finally {
    for (const timer of pending) clearTimeout(timer);
    await page.close();
  }
}, 60_000);

test("Werewolf autoplays with device preferences and Mystery preserves the saved choice", async () => {
  const game = await createWerewolfGame(database.db, admin.userId, {preset:"one_wolf",agentProfileIds:[],maxDays:1});
  const claim = await claimWerewolfGame(database.db,game.id);if(!claim.ok)throw new Error(claim.error);
  await runWerewolf(createWerewolfStore(database.db,game.id,claim.claim.ownerEpoch),{async decide({request}){
    if(request.action==="open_thread")return {kind:"opening",text:null,cue:null,recipientIds:[]};
    return request.legalTargetIds.length ? {kind:"target",targetId:request.legalTargetIds[0]!,thinking:"Private decision"} : {kind:"speech",text:"I want to hear what everyone has to say before I make up my mind.",cue:null};
  }});
  const page=await browser.newPage();
  try {
    if (!servers.webUrl) throw new Error("Web server missing");
    await page.goto(servers.webUrl,{waitUntil:"domcontentloaded"});
    await page.evaluate("localStorage.setItem('house:watch:viewer:v1',JSON.stringify({thinking:true,thinkingOrder:'speech-first'}))");
    await page.goto(`${servers.webUrl}/games/${game.slug}/replay?audience=omniscient`,{waitUntil:"domcontentloaded"});
    await page.waitForSelector('button[aria-label="Pause replay"]');
    await page.waitForFunction("Number(document.querySelector('[data-werewolf-stage]')?.getAttribute('data-elapsed')) > 900");
    await pauseWerewolf(page);
    await page.click('button[aria-label="Player settings"]');
    expect(await page.evaluate("document.querySelector('[role=\"dialog\"] input[type=\"checkbox\"]').checked")).toBe(true);
    expect(await page.evaluate("document.querySelector('[role=\"dialog\"] select').value")).toBe("speech-first");
    await page.select('[role="dialog"] select','thinking-first');
    await page.click('[role="dialog"] input[type="checkbox"]');
    let saved=await page.evaluate("localStorage.getItem('house:watch:viewer:v1')");
    expect(JSON.parse(saved as string)).toMatchObject({thinking:false,thinkingOrder:"thinking-first"});
    await page.reload({waitUntil:"domcontentloaded"});
    await pauseWerewolf(page);
    await page.click('button[aria-label="Player settings"]');
    expect(await page.evaluate("document.querySelector('[role=\"dialog\"] input[type=\"checkbox\"]').checked")).toBe(false);
    expect(await page.evaluate("document.querySelector('[role=\"dialog\"] select').value")).toBe("thinking-first");
    await page.click('[role="dialog"] input[type="checkbox"]');
    saved=await page.evaluate("localStorage.getItem('house:watch:viewer:v1')");
    expect(JSON.parse(saved as string).thinking).toBe(true);
    await page.goto(`${servers.webUrl}/games/${game.slug}/replay?audience=mystery`,{waitUntil:"domcontentloaded"});
    await page.waitForSelector('button[aria-label="Pause replay"]');
    expect(await page.$('[data-in-scene-thinking]')).toBeNull();
    expect(await page.evaluate("localStorage.getItem('house:watch:viewer:v1')")).toBe(saved);
  } finally {await page.close();}
},90_000);


test("House entry is anonymous, rejects invalid audiences and shares a later source moment without restarting", async () => {
  const game = await createWerewolfGame(database.db, admin.userId, {preset:"one_wolf",agentProfileIds:[],maxDays:1,visibility:"unlisted"});
  const claim = await claimWerewolfGame(database.db,game.id); if(!claim.ok) throw new Error(claim.error);
  await runWerewolf(createWerewolfStore(database.db,game.id,claim.claim.ownerEpoch),{async decide({request}) {
    if(request.action === "open_thread") return {kind:"opening",text:"What have you learned?",recipientIds:request.legalRecipientIds.slice(0,3),cue:null};
    if(request.action === "vote" && request.voteMode === "majority") return {kind:"target",targetId:null,thinking:"Hear more"};
    return request.legalTargetIds.length ? {kind:"target",targetId:request.legalTargetIds[0]!,thinking:"Fixture decision"} : {kind:"speech",text:"I want to compare the evidence.",cue:null};
  }});
  const page=await browser.newPage();
  const reads:string[]=[];page.on("request",request=>{if(request.url().includes("/api/"))reads.push(request.url());});
  try {
    await page.goto(`${servers.webUrl}/games/${game.slug}`,{waitUntil:"domcontentloaded"});
    await page.waitForSelector('a[href$="/replay?audience=mystery"]');
    expect(reads.some(url=>new URL(url).pathname === `/api/games/${game.slug}`)).toBe(false);
    await page.waitForSelector('meta[name="robots"][content*="noindex"]');
    const listed = await (await fetch(`${servers.apiUrl}/api/werewolf`)).json() as Array<{id:string}>;
    expect(listed.some(row=>row.id===game.id)).toBe(false);
    expect(reads.some(url=>url.includes("/watch?"))).toBe(false);
    await page.screenshot({path:"/tmp/house-werewolf-entry-desktop.png"});
    await page.setViewport({width:390,height:844});await page.screenshot({path:"/tmp/house-werewolf-entry-mobile.png",fullPage:true});
    expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
    await page.goto(`${servers.webUrl}/games/${game.slug}/replay?audience=mystery&audience=omniscient`,{waitUntil:"domcontentloaded"});
    await text(page,"Invalid replay link");expect(reads.some(url=>url.includes("/watch?"))).toBe(false);
    const window=await (await fetch(`${servers.apiUrl}/api/werewolf/${game.slug}/watch?audience=mystery&fromCursor=33`)).json() as import("@influence/engine/werewolf/watch-contract").WerewolfWatchWindow;
    const moment=window.moments.find(value=>value.entry.kind === "discussion" && value.entry.contribution.text !== null);if(!moment)throw new Error("Expected later speech fixture");
    let inspected=await readHouseGame(database.db,{gameIdOrSlug:game.slug,audience:"mystery",view:"replay",limit:Math.min(moment.cursor,20)});
    while(inspected.gameKind === "werewolf" && inspected.position.cursor < moment.cursor) inspected=await readHouseGame(database.db,{gameIdOrSlug:game.slug,audience:"mystery",cursor:inspected.nextCursor!,limit:Math.min(20,moment.cursor-inspected.position.cursor)});
    const link=`${servers.webUrl}${inspected.links.replay}`;
    expect(link).toBe(`${servers.webUrl}/games/${game.slug}/replay?audience=mystery&cursor=${moment.cursor}`);
    await page.goto(link,{waitUntil:"domcontentloaded"});
    await page.waitForSelector('[data-werewolf-stage][data-cursor]');
    expect(await page.$eval('[data-werewolf-stage]',e=>Number(e.getAttribute('data-cursor')))).toBe(moment.cursor);
    expect(reads.filter(url=>url.includes('/watch?')).every(url=>!url.includes("fromCursor=1&"))).toBe(true);
    await pauseWerewolf(page);
    await page.evaluate("Object.defineProperty(navigator,'share',{configurable:true,value:undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async url=>{document.documentElement.dataset.copiedMoment=url;}}})");
    await page.click('button[aria-label="Player settings"]');await click(page,"Share this moment");await text(page,"Share link copied.");
    expect(await page.evaluate("document.documentElement.dataset.copiedMoment")).toBe(link);
    expect(await page.$('button[aria-label="Play replay"]')).not.toBeNull();
    await page.click('button[aria-label="Close settings"]');await page.click('button[aria-label="Play replay"]');
    await page.click('button[aria-label="Player settings"]');await click(page,"Share this moment");
    expect(await page.$('button[aria-label="Pause replay"]')).not.toBeNull();
    expect(reads.some(url=>url.includes("/thinking"))).toBe(false);
    await page.goto(`${servers.webUrl}/werewolf/${game.slug}`,{waitUntil:"domcontentloaded"});await text(page,"404");
  } finally {await page.close();}
},90_000);


test("House visibility creation works for both games on desktop and mobile", async () => {
  const page = await createAuthenticatedPage(browser, admin.jwt, `${servers.webUrl}/games/new`, {privateKey:admin.wallet.privateKey});
  try {
    for (const kind of ["Influence", "Werewolf"]) {
      await page.goto(`${servers.webUrl}/games/new`,{waitUntil:"domcontentloaded"});
      await page.waitForSelector('button[aria-pressed]');
      if (kind === "Werewolf") await page.evaluate(`Array.from(document.querySelectorAll('button[aria-pressed]')).find(b=>b.textContent.trim().startsWith('Werewolf')).click()`);
      await text(page,"Who can see this game");
      expect(await page.evaluate(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Private')`)).toBe(false);
      await page.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().startsWith('Unlisted')).click()`);
      await text(page,"Creates an unlisted casting lobby");
      await page.setViewport({width:1440,height:1000});
      await page.screenshot({path:`/tmp/visibility-${kind.toLowerCase()}-desktop.png`,fullPage:true});
      await page.setViewport({width:390,height:844});
      await page.screenshot({path:`/tmp/visibility-${kind.toLowerCase()}-mobile.png`,fullPage:true});
      expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
      await click(page,`Create ${kind} Game`);
      await page.waitForFunction("location.pathname.startsWith('/games/') && location.pathname !== '/games/new'");
      const slug = new URL(page.url()).pathname.split('/')[2]!;
      const [game] = await database.db.select().from(schema.games).where(eq(schema.games.slug,slug));
      expect(JSON.parse(game!.config).visibility).toBe("unlisted");
      const context=await browser.createBrowserContext();
      try {
        const anonymous=await context.newPage();
        await anonymous.goto(page.url(),{waitUntil:"domcontentloaded"});
        await text(anonymous,"Unlisted game");
        await anonymous.waitForSelector('meta[name="robots"][content*="noindex"]');
      } finally {await context.close();}
    }
  } finally {await page.close();}
},180_000);

test("House Werewolf results: anonymous endings, exact evidence, Mystery isolation and mobile", async () => {
  const {werewolfResultsFixture} = await import("@influence/engine/fixtures/werewolf-results");
  const {buildWerewolfResults} = await import("@influence/engine/werewolf/results");
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(90_000);
  await page.setRequestInterception(true);
  page.on("request", request => {
    if(request.url().includes("/characters/") && request.url().includes("-p0?")) void request.respond({status:404,body:"Missing fixture portrait"});
    else void request.continue();
  });
  try {
    for (const scenario of ["village","wolves","disagreement"] as const) {
      const id = `browser-results-${scenario}`, slug = `browser-ending-${scenario}`;
      const events = await werewolfResultsFixture(scenario,id);
      const results = buildWerewolfResults(events);
      await database.db.insert(schema.games).values({id,slug,gameKind:"werewolf",status:"completed",maxPlayers:results.players.length,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),config:JSON.stringify({visibility:"unlisted",preset:scenario === "village" ? "one_wolf" : "two_wolves",providerManifest:[{catalogId:"openai:gpt-6-luna"}]})});
      await database.db.insert(schema.werewolfEvents).values(events.map(event=>({gameId:id,sequence:event.sequence,event})));
      await page.setViewport({width:1440,height:1000});
      await page.goto(`${servers.webUrl}/games/${slug}/results`,{waitUntil:"networkidle0"});
      await page.waitForSelector('[data-testid="werewolf-results"]');
      const banner = await fetch(`${servers.apiUrl}/api/games/${id}/assets?label=banner&limit=100`);
      expect(banner.status).toBe(200);
      expect(await page.evaluate('document.body.innerText')).not.toContain("Retry banner");
      await text(page, scenario === "village" ? "The village wins" : scenario === "wolves" ? "The wolves win" : "The game ends in a draw");
      expect(await page.$$('[data-testid="werewolf-results"] li')).toHaveLength(results.players.length);
      expect(await page.$$('[data-winner]')).toHaveLength(results.outcome.winnerIds.length);
      expect(await page.$eval('meta[name="robots"]',node=>node.getAttribute('content'))).toContain('noindex');
      // One missing portrait falls back; other frozen/bundled image responses decode normally.
      await page.waitForFunction(`document.querySelector('[aria-label$="portrait unavailable"]') && Array.from(document.querySelectorAll('[data-testid="werewolf-results"] img')).every(image => image.complete && image.naturalWidth > 0)`);
      await page.focus('details details summary'); await page.keyboard.press('Enter');
      await page.waitForSelector('details[open]');
      const lastVote = results.recap.findLast(item => item.kind === "vote")!;
      await page.$eval(`#${lastVote.id}`, node => node.setAttribute('open',''));
      expect(await page.$$(`#${lastVote.id} tbody tr`)).toHaveLength(lastVote.result.ballots.length);
      await page.screenshot({path:`/tmp/w1-results-${scenario}-desktop.png`,fullPage:true});
      await page.setViewport({width:390,height:844});
      expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
      await page.screenshot({path:`/tmp/w1-results-${scenario}-mobile.png`,fullPage:true});
      if(scenario !== "village") continue;
      const vote = results.recap.find(item=>item.kind === "vote")!;
      await page.$eval(`#${vote.id}`,node=>node.setAttribute('open',''));
      const link = `#${vote.id} a`;
      expect(await page.$eval(link,node=>node.getAttribute('href'))).toBe(`/games/${slug}/replay?audience=omniscient&cursor=${vote.source.cursor}`);
      await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click(link)]);
      await page.waitForFunction(`Number(document.querySelector('[data-werewolf-stage]')?.getAttribute('data-cursor')) === ${vote.source.cursor}`);
      await pauseWerewolf(page);
      await page.goto(`${servers.webUrl}/games/${slug}/replay?audience=omniscient&cursor=${results.source.cursor}`,{waitUntil:'domcontentloaded'});
      await text(page,"View final results");
      await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}), page.click(`a[href="/games/${slug}/results"]`)]);
      await page.waitForSelector('[data-testid="werewolf-results"]');
      const mystery = await (await fetch(`${servers.apiUrl}/api/werewolf/${slug}/watch?audience=mystery&fromCursor=1&limit=1`)).json();
      expect(mystery).toMatchObject({audience:"mystery",fromCursor:1});
      expect(JSON.stringify(mystery)).not.toContain('SECRET_THINKING');
      await page.goto(`${servers.webUrl}/games/${slug}/replay?audience=mystery&cursor=1`,{waitUntil:'domcontentloaded'});
      await page.waitForSelector('[data-werewolf-stage][data-cursor]'); await pauseWerewolf(page);
      expect(await page.evaluate('document.body.innerText')).not.toContain('The village wins');
      await page.goto(`${servers.webUrl}/games/${slug}`,{waitUntil:'networkidle0'});
      await text(page,"View results · Spoilers");
      expect(await page.evaluate('document.body.innerText')).not.toContain('The village wins');
      await page.goto(`${servers.webUrl}/games/${slug}/results`,{waitUntil:'networkidle0'});
      await page.waitForSelector('[data-testid="werewolf-results"]');
      // Deny a refetch in place; previously loaded final facts must disappear.
      await database.db.update(schema.games).set({hiddenAt:new Date().toISOString()}).where(eq(schema.games.id,id));
      await page.evaluate('window.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus"));');
      await page.waitForSelector('[role="alert"]');
      expect(await page.$('[data-testid="werewolf-results"]')).toBeNull();
      await page.reload({waitUntil:'networkidle0'});
      expect(await page.$('[data-testid="werewolf-results"]')).toBeNull();
      await text(page,"Game not found");
    }
  } finally { await page.close(); }
},240_000);


test("House MCP Influence link opens the inspected canonical moment", async () => {
  const {seedFormatAwareGameViewerFixtures}=await import("./format-aware-game-viewer-fixture.js");
  await seedFormatAwareGameViewerFixtures(database.db);
  const inspected=await readHouseGame(database.db,{gameIdOrSlug:"dark-coral-horn",view:"replay",limit:20});
  if(inspected.gameKind!=="influence")throw Error("Expected Influence");
  expect(inspected.position.eventSequence).toBeGreaterThan(1);
  expect(inspected.links.replay).toBe(`/games/dark-coral-horn/replay/${inspected.position.eventSequence}`);
  const page=await browser.newPage();
  try {
    await page.goto(`${servers.webUrl}${inspected.links.replay}`,{waitUntil:"domcontentloaded"});
    await page.waitForSelector('input[aria-label="Replay position"]:not([disabled])');
    await page.waitForFunction(`Number(document.querySelector('input[aria-label="Replay position"]').value)>1`);
    expect(page.url()).toBe(`${servers.webUrl}${inspected.links.replay}`);
    expect(await page.$('[data-werewolf-stage]')).toBeNull();
    await page.screenshot({path:"/tmp/house-mcp-influence-moment.png"});
  } finally {await page.close();}
},90_000);


test("House replay music follows transport, remembers volume and stays visible on mobile", async () => {
  const game = await createWerewolfGame(database.db, admin.userId, {preset:"one_wolf",agentProfileIds:[],maxDays:1});
  const claim=await claimWerewolfGame(database.db,game.id);if(!claim.ok)throw new Error(claim.error);
  await runWerewolf(createWerewolfStore(database.db,game.id,claim.claim.ownerEpoch),{async decide({request}){
    if(request.action==="open_thread")return {kind:"opening",text:"Let us compare the accounts carefully before we decide who should leave the village today.",cue:null,recipientIds:[]};
    return request.legalTargetIds.length ? {kind:"target",targetId:request.legalTargetIds[0]!,thinking:"Private decision"} : {kind:"speech",text:"I want to hear what everyone has to say before I make up my mind about anyone in this village.",cue:null};
  }});
  const page=await browser.newPage();const errors:string[]=[];
  page.on("pageerror",error=>errors.push(String(error)));
  try {
    await page.evaluateOnNewDocument(`(() => {
      window.__musicAudio=[]; window.__musicContexts=[];
      const OriginalAudio=window.Audio, OriginalContext=window.AudioContext;
      window.Audio=class extends OriginalAudio {constructor(...args){super(...args);window.__musicAudio.push(this);}};
      window.AudioContext=class extends OriginalContext {constructor(...args){super(...args);window.__musicContexts.push(this);}};
    })()`);
    await page.setViewport({width:1440,height:1000});
    await page.goto(servers.webUrl!,{waitUntil:"domcontentloaded"});
    await page.evaluate("localStorage.removeItem('house:watch:viewer:v1')");
    const url=`${servers.webUrl}/games/${game.slug}/replay?audience=mystery`;
    await page.goto(url,{waitUntil:"domcontentloaded"});
    await page.waitForSelector('[data-werewolf-stage][data-cursor]');
    expect(await page.evaluate("window.__musicAudio.length")).toBe(0);
    await page.click('button[aria-label="Turn music on"]');
    await page.waitForFunction("window.__musicAudio.some(a=>!a.paused && a.currentTime>0.1)");
    expect(await page.evaluate("window.__musicContexts.filter(c=>c.state!=='closed').length")).toBe(1);
    expect(await page.evaluate("window.__musicAudio.length")).toBe(2);
    await pauseWerewolf(page);
    await page.waitForFunction("window.__musicAudio.every(a=>a.paused)");
    const before=await page.evaluate("Math.max(...window.__musicAudio.map(a=>a.currentTime))") as number;
    await seekWatch(page,3);
    expect(await page.evaluate("window.__musicAudio.every(a=>a.paused)")).toBe(true);
    expect(await page.evaluate("Math.max(...window.__musicAudio.map(a=>a.currentTime))")).toBeCloseTo(before,1);
    await page.click('button[aria-label="Play replay"]');
    await page.waitForFunction(`window.__musicAudio.some(a=>!a.paused && a.currentTime>${before + 0.1})`);
    await page.evaluate("document.activeElement?.blur()");await page.keyboard.press('4');
    expect(await page.evaluate("window.__musicAudio.every(a=>a.playbackRate===1)")).toBe(true);
    await page.keyboard.press('2');
    // Exercise a real decoded full-source loop without waiting three minutes.
    await page.evaluate("window.__musicAudio.find(a=>!a.paused).currentTime=window.__musicAudio.find(a=>!a.paused).duration-0.5");
    await page.waitForFunction("window.__musicAudio.some(a=>!a.paused && a.currentTime>0.1 && a.currentTime<3)");
    await page.click('button[aria-label="Mute music"]');
    expect(await page.evaluate("window.__musicAudio.some(a=>!a.paused)")).toBe(true);
    await page.click('button[aria-label="Turn music on"]');
    await page.evaluate(`(() => {const input=document.querySelector('input[aria-label="Music volume"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"42");input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));})()`);
    await page.waitForFunction("JSON.parse(localStorage.getItem('house:watch:viewer:v1')).musicVolume===0.42");
    await pauseWerewolf(page);
    const presentation=await(await fetch(`${servers.apiUrl}/api/werewolf/${game.slug}/presentation?audience=mystery`)).json() as WerewolfPresentation;
    const daytime=presentation.view.entries.findIndex(entry=>entry.kind==="discussion");
    expect(daytime).toBeGreaterThan(0);
    await seekWatch(page,daytime+1);
    await page.waitForFunction("window.__musicAudio.some(a=>a.src.includes('the-circle-closes') && a.currentTime===0)");
    expect(await page.evaluate("window.__musicAudio.every(a=>a.paused)")).toBe(true);
    await page.click('button[aria-label="Play replay"]');
    await page.waitForFunction("window.__musicAudio.some(a=>a.src.includes('the-circle-closes') && !a.paused && a.currentTime>0.1)");
    await page.click('button[aria-label="Enter fullscreen"]');
    await page.waitForSelector('[data-player-fullscreen]');
    expect(await page.evaluate("window.__musicAudio.length")).toBe(2);
    await page.click('button[aria-label="Exit fullscreen"]');
    await page.waitForSelector('button[aria-label="Enter fullscreen"]');
    await page.setViewport({width:320,height:800});
    await page.screenshot({path:"/tmp/werewolf-music-320.png"});
    expect(await page.$eval('input[aria-label="Music volume"]',node=>{const box=node.getBoundingClientRect();return box.width>=50 && box.left>=0 && box.right<=node.ownerDocument.defaultView!.innerWidth && !node.closest('[role="dialog"]');})).toBe(true);
    expect(await page.evaluate("document.documentElement.scrollWidth<=innerWidth")).toBe(true);
    expect(await page.evaluate(`(() => {const node=document.querySelector('[data-watch-transport]'), right=node.getBoundingClientRect().right;return Array.from(node.querySelectorAll('button,input')).every(control=>control.getBoundingClientRect().right<=right+1);})()`)).toBe(true);
    await page.screenshot({path:"/tmp/werewolf-music-mobile.png"});
    const slider=await page.$('input[aria-label="Replay position"]'), box=await slider!.boundingBox();
    await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);await page.mouse.down();
    await page.waitForFunction("window.__musicAudio.every(a=>a.paused)");
    await page.mouse.move(box!.x+box!.width/3,box!.y+box!.height/2);await page.mouse.up();
    await page.waitForSelector('button[aria-label="Pause replay"]');
    await page.click('button[aria-label="Player settings"]');
    await page.evaluate("Array.from(document.querySelectorAll('[role=dialog] button')).find(b=>b.textContent==='Restart replay').click()");
    await page.waitForFunction("window.__musicAudio.some(a=>!a.paused && a.currentTime<3)");
    await page.reload({waitUntil:"domcontentloaded"});
    await page.waitForSelector('input[aria-label="Music volume"]');
    expect(await page.evaluate(`document.querySelector('input[aria-label="Music volume"]').value`)).toBe("42");
    // Real default autoplay policy may allow or block: either must keep the replay usable.
    await page.waitForFunction(`window.__musicAudio.some(a=>!a.paused && a.currentTime>0.1) || document.querySelector('button[aria-label="Enable music"]')`);
    if(await page.$('button[aria-label="Enable music"]')) await page.click('button[aria-label="Enable music"]');
    await page.waitForFunction("window.__musicAudio.some(a=>!a.paused && a.currentTime>0.1)");
    // A real HTTP failure leaves visual playback running and can be explicitly retried.
    let failMusic=true;
    await page.setCacheEnabled(false);await page.setRequestInterception(true);
    page.on("request",request=>{if(failMusic && new URL(request.url()).pathname.endsWith(".mp3"))void request.respond({status:404,body:"Missing music fixture"});else void request.continue();});
    await page.click('button[aria-label="Player settings"]');
    await page.evaluate("Array.from(document.querySelectorAll('[role=dialog] button')).find(b=>b.textContent==='Restart replay').click()");
    await page.waitForSelector('button[aria-label="Music unavailable. Retry"]');
    expect(await page.$('button[aria-label="Pause replay"]')).not.toBeNull();
    failMusic=false;await page.click('button[aria-label="Music unavailable. Retry"]');
    await page.waitForFunction("window.__musicAudio.some(a=>!a.paused && a.currentTime>0.1)");
    await page.evaluate("window.__oldMusic=window.__musicAudio;Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));");
    await page.waitForFunction("window.__musicAudio.every(a=>a.paused)");
    await page.waitForSelector('button[aria-label="Play replay"]');
    await page.evaluate("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));");
    expect(await page.evaluate("window.__musicAudio.every(a=>a.paused)")).toBe(true);
    expect(errors).toEqual([]);
  } finally {await page.close();}
},120_000);


test("victory music continues beyond the final frame, pauses, and ends without looping", async () => {
  const {werewolfResultsFixture} = await import("@influence/engine/fixtures/werewolf-results");
  const {buildWerewolfResults} = await import("@influence/engine/werewolf/results");
  const page = await browser.newPage();
  try {
    await page.evaluateOnNewDocument(`(() => {
      window.__musicAudio=[];
      const OriginalAudio=window.Audio;
      window.Audio=class extends OriginalAudio {constructor(...args){super(...args);window.__musicAudio.push(this);}};
    })()`);
    for (const scenario of ["village", "wolves", "disagreement"] as const) {
      const id = `browser-music-ending-${scenario}`;
      const events = await werewolfResultsFixture(scenario,id);
      const results = buildWerewolfResults(events);
      await database.db.insert(schema.games).values({id,slug:id,gameKind:"werewolf",status:"completed",maxPlayers:results.players.length,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),config:JSON.stringify({visibility:"unlisted",preset:scenario === "village" ? "one_wolf" : "two_wolves",providerManifest:[{catalogId:"openai:gpt-6-luna"}]})});
      await database.db.insert(schema.werewolfEvents).values(events.map(event=>({gameId:id,sequence:event.sequence,event})));
      await page.goto(`${servers.webUrl}/games/${id}/replay?audience=mystery`,{waitUntil:"domcontentloaded"});
      await page.waitForSelector('[data-werewolf-stage][data-cursor]');
      await pauseWerewolf(page);
      const presentation = await(await fetch(`${servers.apiUrl}/api/werewolf/${id}/presentation?audience=mystery`)).json() as WerewolfPresentation;
      const resultCursor = presentation.view.entries.findIndex(entry=>entry.kind==="result") + 1;
      expect(resultCursor).toBeGreaterThan(0);
      await seekWatch(page,resultCursor);
      if (await page.$('button[aria-label="Turn music on"]')) await page.click('button[aria-label="Turn music on"]');
      if (await page.$('button[aria-label="Enable music"]')) await page.click('button[aria-label="Enable music"]');
      expect(await page.evaluate("window.__musicAudio.every(a=>a.paused)")).toBe(true);
      await page.click('button[aria-label="Play replay"]');
      if (scenario === "disagreement") {
        await page.waitForSelector('button[aria-label="Play replay"]');
        expect(await page.evaluate("window.__musicAudio.every(a=>a.paused)")).toBe(true);
        continue;
      }
      const track = scenario === "village" ? "lanterns-still-burning" : "wolves-at-the-festival";
      // Cross the actual 4.2s visual ending: music must still advance, not merely retain a src.
      await page.waitForFunction(`window.__musicAudio.some(a=>a.src.includes('${track}') && !a.paused && a.currentTime>6)`);
      expect(await page.$('button[aria-label="Pause replay"]')).not.toBeNull();
      await pauseWerewolf(page);
      await page.waitForFunction("window.__musicAudio.every(a=>a.paused)");
      const time = await page.evaluate(`window.__musicAudio.find(a=>a.src.includes('${track}')).currentTime`) as number;
      await page.click('button[aria-label="Play replay"]');
      await page.waitForFunction(`window.__musicAudio.some(a=>a.src.includes('${track}') && !a.paused && a.currentTime>${time+0.2})`);
      // Skip to the genuine decoded media EOF; one-shot victories must never restart.
      await page.evaluate(`(() => {const a=window.__musicAudio.find(a=>a.src.includes('${track}'));a.currentTime=a.duration-0.2;})()`);
      await page.waitForFunction(`window.__musicAudio.some(a=>a.src.includes('${track}') && a.ended)`);
      expect(await page.evaluate("window.__musicAudio.every(a=>a.paused)")).toBe(true);
      await seekWatch(page,1);
      await page.waitForFunction("window.__musicAudio.some(a=>a.src.includes('lantern-to-fang') && !a.paused && a.currentTime>0.1)");
    }
  } finally {await page.close();}
},120_000);

test("Werewolf arrows and scrubber visit every ballot and the completed tally", async () => {
  const {werewolfResultsFixture} = await import("@influence/engine/fixtures/werewolf-results");
  const {buildWerewolfResults} = await import("@influence/engine/werewolf/results");
  const id="browser-ballot-stops";
  const events=await werewolfResultsFixture("village",id), results=buildWerewolfResults(events);
  await database.db.insert(schema.games).values({id,slug:id,gameKind:"werewolf",status:"completed",maxPlayers:results.players.length,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),config:JSON.stringify({visibility:"unlisted",preset:"one_wolf",providerManifest:[{catalogId:"openai:gpt-6-luna"}]})});
  await database.db.insert(schema.werewolfEvents).values(events.map(event=>({gameId:id,sequence:event.sequence,event})));
  const presentation=await(await fetch(`${servers.apiUrl}/api/werewolf/${id}/presentation?audience=mystery`)).json() as WerewolfPresentation;
  const index=presentation.view.entries.findIndex(entry=>entry.kind==="vote"), entry=presentation.view.entries[index];
  if(entry?.kind!=="vote")throw new Error("Missing fixture vote");
  const page=await browser.newPage();
  try {
    await page.setViewport({width:1440,height:1000});
    await page.goto(`${servers.webUrl}/games/${id}/replay?audience=mystery`,{waitUntil:"domcontentloaded"});
    await pauseWerewolf(page);
    for(let step=0;step<entry.result.ballots.length;step++) {
      await seekWatch(page,index+1,step);
      await page.waitForFunction(`document.querySelectorAll('[data-ledger-voter]').length===${step+1}`);
      expect(await page.$('[data-vote-complete]')).toBeNull();
      const scrubbed=await page.$$eval('[data-ledger-voter]',nodes=>nodes.map(node=>node.getAttribute('data-ledger-voter')));
      if(step>0) {
        await seekWatch(page,index+1,step-1);
        await page.evaluate("document.activeElement?.blur()");await page.keyboard.press('ArrowRight');
        await page.waitForFunction(`document.querySelectorAll('[data-ledger-voter]').length===${step+1}`);
        expect(await page.$$eval('[data-ledger-voter]',nodes=>nodes.map(node=>node.getAttribute('data-ledger-voter')))).toEqual(scrubbed);
      }
    }
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('[data-vote-complete]');
    expect(await page.$$('[data-ledger-voter]')).toHaveLength(entry.result.ballots.length);
    const total=await page.$eval('[data-votes-revealed]',node=>node.textContent);
    await seekWatch(page,index+1,entry.result.ballots.length);
    expect(await page.$eval('[data-votes-revealed]',node=>node.textContent)).toBe(total);
    await page.screenshot({path:"/tmp/werewolf-vote-complete.png"});
    await page.setViewport({width:390,height:844});
    await page.screenshot({path:"/tmp/werewolf-vote-complete-mobile.png"});
    await page.evaluate("document.activeElement?.blur()");await page.keyboard.press('ArrowLeft');
    await page.waitForFunction("!document.querySelector('[data-vote-complete]')");
    expect(await page.$$('[data-ledger-voter]')).toHaveLength(entry.result.ballots.length);
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(`document.querySelectorAll('[data-ledger-voter]').length===${entry.result.ballots.length-1}`);
    expect(await page.$('button[aria-label="Play replay"]')).not.toBeNull();
  } finally {await page.close();}
},120_000);

test("doctor, seer, hunt and outcome are separate scrub stops only for Omniscient", async () => {
  const {werewolfResultsFixture} = await import("@influence/engine/fixtures/werewolf-results");
  const id = "browser-night-staging", events = await werewolfResultsFixture("saved", id);
  await database.db.insert(schema.games).values({id,slug:id,gameKind:"werewolf",status:"completed",maxPlayers:8,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),config:JSON.stringify({visibility:"unlisted",preset:"two_wolves",providerManifest:[{catalogId:"openai:gpt-6-luna"}]})});
  await database.db.insert(schema.werewolfEvents).values(events.map(event => ({gameId:id,sequence:event.sequence,event})));
  const omni = (await readWerewolfPresentation(database.db,id,"omniscient")).presentation;
  const cursor = omni.view.entries.findIndex(entry => entry.kind === "night") + 1;
  expect(cursor).toBeGreaterThan(0);
  const page = await browser.newPage();
  try {
    await page.goto(`${servers.webUrl}/games/${id}/replay?audience=omniscient`,{waitUntil:"domcontentloaded"});
    await pauseWerewolf(page);
    await seekWatch(page,cursor,0);
    await page.waitForSelector('[data-night-role="protect"]');
    await watchText(page,"protects themself");
    await page.setViewport({width:390,height:844});
    expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
    await page.screenshot({path:"/tmp/werewolf-doctor-mobile.png"});
    await page.evaluate("document.activeElement?.blur()"); await page.keyboard.press("ArrowRight");
    await page.waitForSelector('[data-night-role="investigate"]');
    const seer = await page.$eval('[data-night-role]',element=>element.textContent);
    const nightEntry = omni.view.entries[cursor-1]!;
    if(nightEntry.kind !== "night" || !nightEntry.investigation) throw new Error("Fixture needs an investigation");
    expect(await page.$eval('[data-investigation-result]',element=>element.textContent)).toContain(nightEntry.investigation.isWolf ? "Werewolf" : "Not a werewolf");
    await page.waitForFunction("Array.from(document.querySelectorAll('[data-night-role] img')).every(image => image.complete)");
    const stageFits = await page.$eval('[data-night-role]',element => element.scrollHeight <= element.clientHeight + 1);
    expect(stageFits).toBe(true);
    await page.screenshot({path:"/tmp/werewolf-seer-mobile.png"});
    await seekWatch(page,cursor,0); await seekWatch(page,cursor,1);
    expect(await page.$eval('[data-night-role]',element=>element.textContent)).toBe(seer);
    await page.setViewport({width:1440,height:1000});
    await page.screenshot({path:"/tmp/werewolf-seer-wide.png"});
    await page.evaluate("document.activeElement?.blur()"); await page.keyboard.press("ArrowRight");
    await page.waitForSelector('[data-night-hunt]');
    await watchText(page,"was saved by the Doctor.");
    expect(await page.$eval('[data-doctor-save]',element=>element.textContent)).toContain("Doctor");
    expect(await page.$eval("[data-watch-context]",element=>element.textContent)).toContain("The hunt");
    await page.setViewport({width:390,height:844});
    expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
    const saveFits = await page.$eval('[data-doctor-save]',element => { const card=element.getBoundingClientRect(), stage=element.closest('[data-night-hunt]')!.getBoundingClientRect(); return card.bottom <= stage.bottom && card.left >= stage.left && card.right <= stage.right; });
    expect(saveFits).toBe(true);
    await page.screenshot({path:"/tmp/werewolf-hunt-mobile.png"});
    await page.evaluate("document.activeElement?.blur()"); await page.keyboard.press("ArrowRight");
    await page.waitForFunction("!document.querySelector('[data-night-hunt]')");
    const outcome = await page.$eval('[data-werewolf-stage]',element=>element.textContent);
    await seekWatch(page,cursor,2); await page.waitForSelector('[data-night-hunt]');
    await seekWatch(page,cursor,3);
    expect(await page.$eval('[data-werewolf-stage]',element=>element.textContent)).toBe(outcome);
    expect(await page.$('button[aria-label="Play replay"]')).not.toBeNull();
    const mystery = (await readWerewolfPresentation(database.db,id,"mystery")).presentation;
    const dawn = mystery.view.entries.findIndex(entry=>entry.kind==="night")+1;
    const mysteryWindow = await (await fetch(`${servers.apiUrl}/api/werewolf/${id}/watch?audience=mystery&fromCursor=${dawn}&limit=1`)).json() as import("@influence/engine/werewolf/watch-contract").WerewolfWatchWindow;
    expect(mysteryWindow.moments[0]!.night).toBeUndefined();
    expect(mysteryWindow.moments[0]!.entry).not.toHaveProperty("protectedId");
    expect(mysteryWindow.moments[0]!.entry).not.toHaveProperty("investigation");
    await page.goto(`${servers.webUrl}/games/${id}/replay?audience=mystery`,{waitUntil:"domcontentloaded"});
    await pauseWerewolf(page); await seekWatch(page,dawn);
    expect(await page.$('[data-night-hunt]')).toBeNull();
    expect(await page.$('[data-night-role]')).toBeNull();
    expect(await page.$('[data-doctor-save]')).toBeNull();
    expect(await page.$eval('[data-werewolf-stage]',element=>element.textContent)).not.toContain("Tonight’s target");
  } finally { await page.close(); }
}, 60_000);

test("published wolf forms transform each night including a lone survivor and night deaths have a seek-safe claw outcome", async () => {
  const {werewolfResultsFixture} = await import("@influence/engine/fixtures/werewolf-results");
  const {werewolfSceneInventory} = await import("@influence/engine/werewolf/visual-scenes");
  const {projectWerewolfWatch} = await import("@influence/engine/werewolf/watch");
  const {isWerewolfPlayable} = await import("@influence/engine/werewolf/watch-contract");
  const {planWerewolfProduction} = await import("../services/werewolf-production-plan.js");
  const {prepareVisualScene} = await import("../services/visual-scene-store.js");
  const id="browser-night-motion",events=await werewolfResultsFixture("wolves",id);
  await database.db.insert(schema.games).values({id,slug:id,gameKind:"werewolf",status:"completed",maxPlayers:8,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),config:JSON.stringify({visibility:"unlisted",preset:"two_wolves",providerManifest:[{catalogId:"openai:gpt-6-luna"}]})});
  await database.db.insert(schema.werewolfEvents).values(events.map(event=>({gameId:id,sequence:event.sequence,event})));
  const descriptor=werewolfSceneInventory(events).find(scene=>scene.purpose === "pack")!;
  const plan=await planWerewolfProduction(database.db,id,descriptor.roomId,descriptor.boundarySequence);
  const formIds:string[]=[];
  for (const [index,member] of plan.cast.entries()) {
    const bytes=await sharp(Buffer.from(`<svg width="400" height="600"><rect width="400" height="600" fill="${index ? '#334859' : '#57434c'}"/><text x="20" y="300" fill="white" font-size="40">Wolf ${index+1}</text></svg>`)).png().toBuffer();
    const artifact=await storeVisualArtifact(database.db,id,bytes);formIds.push(artifact);
    member.referenceArtifactId=artifact;member.variant={...member.variant!,resolved:true};
  }
  const scene=await prepareVisualScene(database.db,{gameId:id,boundarySequence:descriptor.boundarySequence,plan});
  await database.db.insert(schema.visualMediaVersions).values({id,gameId:id,sceneId:scene.id,version:1,plan,imageArtifactId:formIds[0]!,annotatedArtifactId:formIds[0]!,localization:{count:2,verifiedParticipantIds:plan.cast.map(member=>member.id),anchors:[]},verificationVersion:"fixture",createdAt:"2026-01-01T00:00:00.000Z"});
  await database.db.insert(schema.visualMediaPublications).values({id,gameId:id,sceneId:scene.id,versionId:id,revision:1,operatorId:admin.userId,createdAt:"2026-01-01T00:00:00.000Z"});
  const soloDescriptor=werewolfSceneInventory(events).find(scene=>scene.purpose === "hunt" && scene.wolfIds.length === 1)!;
  const soloPlan=await planWerewolfProduction(database.db,id,soloDescriptor.roomId,soloDescriptor.boundarySequence);
  for(const member of soloPlan.cast) if(member.variant?.kind === "werewolf") {
    member.referenceArtifactId=plan.cast.find(wolf=>wolf.id===member.id)!.referenceArtifactId;
    member.variant={...member.variant,resolved:true};
  }
  const soloImage=await storeVisualArtifact(database.db,id,await sharp(Buffer.from('<svg width="800" height="450"><rect width="800" height="450" fill="#18322a"/><text x="60" y="220" fill="white" font-size="40">Published lone-wolf hunt</text></svg>')).png().toBuffer());
  const soloScene=await prepareVisualScene(database.db,{gameId:id,boundarySequence:soloDescriptor.boundarySequence,plan:soloPlan});
  await database.db.insert(schema.visualMediaVersions).values({id:`${id}-solo`,gameId:id,sceneId:soloScene.id,version:1,plan:soloPlan,imageArtifactId:soloImage,annotatedArtifactId:soloImage,localization:{count:2,verifiedParticipantIds:soloPlan.cast.map(member=>member.id),anchors:[]},verificationVersion:"fixture",createdAt:"2026-01-01T00:00:00.000Z"});
  await database.db.insert(schema.visualMediaPublications).values({id:`${id}-solo`,gameId:id,sceneId:soloScene.id,versionId:`${id}-solo`,revision:1,operatorId:admin.userId,createdAt:"2026-01-01T00:00:00.000Z"});
  const projection=projectWerewolfWatch(events,"omniscient",1,64);
  const soloNight=Array.from({length:projection.latestCursor},(_,i)=>projectWerewolfWatch(events,"omniscient",i+1,1).moments[0]!).find(moment=>moment.night?.actions.some(action=>action.kind === "hunt" && action.wolfIds.length === 1))!;
  const entrance=projection.moments.find(moment=>moment.transformWolfIds)!;
  const previous=projection.moments.findLast(moment=>moment.cursor<entrance.cursor&&isWerewolfPlayable(moment.entry))!;
  const death=projection.moments.find(moment=>moment.entry.kind === "night" && moment.entry.killedId)!;
  const page=await browser.newPage();
  const errors:string[]=[];page.on("pageerror",error=>errors.push(String(error)));
  try {
    await page.setViewport({width:1440,height:1000});
    await page.goto(`${servers.webUrl}/games/${id}/replay?audience=omniscient&cursor=${previous.cursor}`,{waitUntil:"domcontentloaded"});
    await page.waitForSelector('[data-wolf-transformation]');
    await page.waitForFunction("Number(document.querySelector('[data-werewolf-stage]').dataset.elapsed)>850");
    await pauseWerewolf(page);
    const pose=await page.$$eval('[data-wolf-id]',nodes=>nodes.map(node=>({form:node.getAttribute('data-wolf-form'),style:node.querySelector('[style]')?.getAttribute('style')})));
    await page.screenshot({path:"/tmp/werewolf-transform-wide.png"});
    await page.setViewport({width:390,height:844});
    expect(await page.evaluate("document.documentElement.scrollWidth<=innerWidth")).toBe(true);
    await page.screenshot({path:"/tmp/werewolf-transform-mobile.png"});
    expect(await page.$$eval('[data-wolf-id]',nodes=>nodes.map(node=>({form:node.getAttribute('data-wolf-form'),style:node.querySelector('[style]')?.getAttribute('style')})))).toEqual(pose);
    await page.click('button[aria-label="Play replay"]');
    await page.waitForFunction("!document.querySelector('[data-wolf-transformation]')");
    await pauseWerewolf(page);
    await seekWatch(page,previous.cursor);
    await seekWatch(page,entrance.cursor);
    expect(await page.$('[data-wolf-transformation]')).not.toBeNull();
    expect(await page.$eval('[data-werewolf-stage]',node=>Number(node.getAttribute('data-elapsed')))).toBe(0);
    // Next and Previous land on the same entrance as the timeline while preserving pause.
    await page.click('button[aria-label="Next scene"]');
    await page.waitForFunction("!document.querySelector('[data-wolf-transformation]')");
    await page.click('button[aria-label="Previous room or scene"]');
    await page.waitForSelector('[data-wolf-transformation]');
    expect(await page.$('button[aria-label="Play replay"]')).not.toBeNull();
    await page.click('button[aria-label="Previous room or scene"]');
    await page.waitForFunction("!document.querySelector('[data-wolf-transformation]')");
    await page.click('button[aria-label="Next scene"]');
    await page.waitForSelector('[data-wolf-transformation]');
    expect(await page.$eval('[data-werewolf-stage]',node=>Number(node.getAttribute('data-elapsed')))).toBe(0);
    await page.screenshot({path:"/tmp/werewolf-after-transform-seek.png"});
    await page.click('button[aria-label="Play replay"]');
    await watchText(page,"SECRET_PACK");
    await pauseWerewolf(page);
    await seekWatch(page,death.cursor,death.night!.actions.length-1);
    await page.click('button[aria-label="Play replay"]');
    await page.waitForSelector('[data-night-elimination]');
    await pauseWerewolf(page);
    expect(await page.$('[data-doctor-save]')).toBeNull();
    await seekWatch(page,death.cursor,death.night!.actions.length-1);
    await seekWatch(page,death.cursor,death.night!.actions.length);
    await page.waitForFunction("Number(document.querySelector('[data-night-claw]').style.opacity)===0");
    await page.screenshot({path:"/tmp/werewolf-night-outcome-mobile.png"});
    await seekWatch(page,soloNight.cursor,0);
    for(let step=0;step<soloNight.night!.actions.length-1;step++) {
      await page.waitForSelector('[data-night-role]');
      await page.click('button[aria-label="Next scene"]');
    }
    await page.waitForSelector('[data-wolf-transformation]');
    expect(await page.$$('[data-wolf-id]')).toHaveLength(1);
    expect(await page.$('button[aria-label="Play replay"]')).not.toBeNull();
    await page.click('button[aria-label="Play replay"]');
    await page.waitForSelector('[data-night-hunt]');
    await pauseWerewolf(page);
    expect(await page.$eval('[data-night-hunt] img',image=>image.getAttribute('src'))).toContain(encodeURIComponent(soloImage));
    await page.waitForFunction("document.querySelector('[data-night-hunt] img')?.naturalWidth>0");
    await page.screenshot({path:"/tmp/werewolf-lone-hunt.png"});
    await page.click('button[aria-label="Next scene"]');
    await page.waitForSelector('[data-night-elimination]');
    await page.click('button[aria-label="Previous room or scene"]');
    await page.waitForSelector('[data-wolf-transformation]');
    expect(await page.$$('[data-wolf-id]')).toHaveLength(1);
    await page.emulateMediaFeatures([{name:"prefers-reduced-motion",value:"reduce"}]);
    await page.goto(`${servers.webUrl}/games/${id}/replay?audience=omniscient&cursor=${previous.cursor}`,{waitUntil:"domcontentloaded"});
    await page.waitForSelector('[data-wolf-transformation]');await pauseWerewolf(page);
    expect(await page.evaluate("Array.from(document.querySelectorAll('[data-wolf-id] [style]')).filter(node=>node.style.transform).every(node=>node.style.transform === 'translateY(0px) rotate(0deg) scale(1)')")).toBe(true);
    await page.goto(`${servers.webUrl}/games/${id}/replay?audience=mystery`,{waitUntil:"domcontentloaded"});await pauseWerewolf(page);
    expect(await page.$('[data-wolf-transformation]')).toBeNull();
    expect(errors).toEqual([]);
  } finally {await page.close();}
},90_000);

test("Decisions inspector keeps Mystery public and Omniscient thinking independent of stage preferences", async () => {
  const { replayWerewolf } = await import("@influence/engine/werewolf");
  const game = await createWerewolfGame(database.db, admin.userId, { preset: "two_wolves", agentProfileIds: [], maxDays: 1 });
  const claim = await claimWerewolfGame(database.db, game.id);
  if (!claim.ok) throw new Error(claim.error);
  const store = createWerewolfStore(database.db, game.id, claim.claim.ownerEpoch);
  const agent: WerewolfAgent = { async decide({ request }) {
    if (request.action === "open_thread") return { kind: "opening", text: null, cue: null, recipientIds: [] };
    return request.legalTargetIds.length ? { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "PRIVATE_DECISION_THOUGHT" }
      : { kind: "speech", text: "Hello village.", cue: null };
  } };
  await runWerewolf(store, agent);
  const state = replayWerewolf(await store.read());
  const doctor = state.players.find(player => state.roles[player.id] === "doctor")!;
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1600, height: 1000 });
    for (const audience of ["mystery", "omniscient"] as const) {
      await page.goto(`${servers.webUrl}/games/${game.slug}/replay?audience=${audience}`, { waitUntil: "domcontentloaded" });
      await pauseWerewolf(page);
      await page.evaluate(`(() => {
        const button = [...document.querySelectorAll("button")].find(button => button.textContent?.includes(${JSON.stringify(doctor.name)}) && button.getBoundingClientRect().width > 0);
        if (!button) throw new Error("Missing cast player");
        button.click();
      })()`);
      await page.evaluate("[...document.querySelectorAll('[role=\"tab\"]')].find(tab => tab.textContent === 'Decisions').click()");
      await page.waitForSelector('[aria-label="Player decisions"]');
      await watchText(page, "No decisions yet.");
      const view = await (await fetch(`${servers.apiUrl}/api/werewolf/${game.slug}/presentation?audience=${audience}`)).json() as WerewolfPresentation;
      await seekWatch(page, view.latestCursor);
      await page.waitForSelector('[aria-label="Player decisions"] li');
      const panel = await page.$eval('[aria-label="Player decisions"]', element => element.textContent!);
      if (audience === "mystery") {
        expect(panel).not.toMatch(/PRIVATE|Thinking|Night|Protected|Investigated|Targeted/);
      } else {
        expect(panel).toContain("Protected");
        expect(panel).toContain("PRIVATE_DECISION_THOUGHT");
        expect(await page.$('[data-thinking-bubble]')).toBeNull();
        const link = await page.$('[aria-label="Player decisions"] a');
        const href = await link!.evaluate(element => element.getAttribute("href")!);
        const cursor = Number(new URL(href!, servers.webUrl!).searchParams.get("cursor"));
        await link!.click();
        await page.waitForFunction(`Number(document.querySelector('[data-werewolf-stage]')?.getAttribute('data-cursor')) === ${cursor}`);
        await page.setViewport({ width: 390, height: 844 });
        await page.evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'Player info').click()");
        await page.waitForSelector('[role="dialog"][aria-label="Player information"]');
        expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
        await page.screenshot({ path: "/tmp/werewolf-decisions-mobile.png" });
        await page.setViewport({ width: 1600, height: 1000 });
      }
      await seekWatch(page, 1);
      await watchText(page, "No decisions yet.");
      expect(await page.$eval('[aria-label="Player decisions"]', element => element.textContent)).not.toContain("PRIVATE_DECISION_THOUGHT");
    }
  } finally { await page.close(); }
}, 120_000);
