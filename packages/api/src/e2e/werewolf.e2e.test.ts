import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { runWerewolf, type WerewolfAgent } from "@influence/engine/werewolf";
import sharp from "sharp";
import type { StoredVisualShot } from "@influence/engine/visual-mode";
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
import { checkAdminContinuity } from "./admin-continuity-browser.js";

process.env.JWT_SECRET = "e2e-test-jwt-secret";
const originalMock = process.env.INFLUENCE_API_TEST_MOCK_RUNNER;
const originalRole = process.env.INFLUENCE_API_ROLE;
let database: TestDB;
let servers: TestServerHandles;
let browser: Browser;
let admin: Awaited<ReturnType<typeof createAdminUser>>;
let profileId: string;
beforeAll(async () => {
  process.env.INFLUENCE_API_TEST_MOCK_RUNNER = "true";
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
    await page.goto(`${servers.webUrl}/werewolf/${game.slug}`, { waitUntil: "domcontentloaded" });
    await text(page, "Meet the village");
    await click(page, "Latest");
    await text(page, "Game complete");
    await page.evaluate("Array.from(document.querySelectorAll('details')).forEach(d => { d.open = true; })");
    await text(page, "No majority. Discussion continues.");
    await text(page, "Abstain (hear more)");
    await text(page, "Majority required: 5 of 8 living players.");
    await text(page, "Vote after thread 8");
    await text(page, "Final ballot: unique most votes wins; ties spare everyone.");
    await text(page, "is eliminated.");
    expect(await page.evaluate('document.body.innerText.includes("Pack ballot")')).toBe(false);
    await click(page, "Omniscient");
    await text(page, "Meet the village");
    await click(page, "Latest");
    await text(page, "Game complete");
    await page.evaluate("Array.from(document.querySelectorAll('details')).forEach(d => { d.open = true; })");
    await text(page, "Pack ballot 3 of 3");
    await text(page, "No agreement. No attack tonight.");
    await text(page, "Doctor protected");
    await text(page, "investigated");
    expect(await page.evaluate('document.body.innerText.includes("Private fixture")')).toBe(false);
    await page.setViewport({ width: 390, height: 844 });
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
    await page.evaluate("Array.from(document.querySelectorAll('ol > li')).find(entry => entry.textContent.includes('Pack ballot 3 of 3'))?.scrollIntoView({ block: 'start' })");
    await page.screenshot({ path: "/tmp/werewolf-pack-ballots-mobile.png" });
    await page.evaluate("Array.from(document.querySelectorAll('ol > li')).find(entry => entry.textContent.includes('After thread 1:'))?.scrollIntoView({ block: 'start' })");
    await page.screenshot({ path: "/tmp/werewolf-day-checkpoint-mobile.png" });
    await click(page, "Mystery");
    await text(page, "Meet the village");
    await click(page, "Latest");
    await text(page, "Game complete");
    await page.evaluate("Array.from(document.querySelectorAll('details')).forEach(d => { d.open = true; })");
    expect(await page.evaluate('document.body.innerText.includes("Pack ballot") || document.body.innerText.includes("failed to agree")')).toBe(false);
  } finally { await page.close(); }
}
afterAll(async () => {
  await cleanupE2eResources([
    ["browser", async () => { if (browser) await closeBrowser(browser); }],
    ["servers", async () => { if (servers) await stopTestServers(servers); }],
    ["database", async () => { if (database) await destroyIsolatedTestDb(database.databaseUrl); }],
  ]);
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
    expect(stdout).toContain(`${servers.webUrl}/werewolf/`);
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
      } else if (request.url().includes("/api/provider-models")) void respond({ status: "complete", models: [{ catalogId: "openai:gpt-6-luna", displayName: "Scripted test model", configured: true, available: true }] });
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
    await page.waitForSelector('a[href="/werewolf#start"]');
    await page.screenshot({ path: "/tmp/werewolf-create-game-choice.png", fullPage: false });
    await page.click('a[href="/werewolf#start"]');
    await page.waitForFunction("location.pathname === '/werewolf'");
    await text(page, "Arden Vale");
    await page.click('input[type="checkbox"]');
    await page.screenshot({ path: "/tmp/werewolf-lobby-desktop.png", fullPage: true });
    await click(page, "Start Werewolf");
    await page.waitForFunction("location.pathname.startsWith('/werewolf/') && location.pathname.split('/')[2]");
    await text(page, "Meet the village");
    expect(await page.evaluate(`document.querySelectorAll('button[aria-pressed="true"]')[0]?.textContent`)).toBe("Mystery");
    expect(await page.evaluate('document.body.innerText.includes("Role unknown")')).toBe(true);
    const gameUrl = page.url();
    await click(page, "Omniscient");
    await page.waitForFunction('document.body.innerText.includes("seer · Alive")');
    await page.screenshot({ path: "/tmp/werewolf-omniscient-desktop.png", fullPage: true });
    await click(page, "Mystery");
    await page.waitForFunction('document.body.innerText.includes("Role unknown")');
    expect(await page.evaluate('document.body.innerText.includes("seer · Alive")')).toBe(false);
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: "/tmp/werewolf-mystery-mobile.png", fullPage: true });
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
    await click(page, "Latest");
    await text(page, "Game complete");
    await page.evaluate("Array.from(document.querySelectorAll('details')).forEach(d => { d.open = true; })");
    await text(page, "Thread 1");


    await text(page, "Pass");
    await text(page, "I will compare the claims with today's vote.");
    expect(await page.evaluate('document.body.innerText.includes("Discussion beat")')).toBe(false);
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
    await page.evaluate("Array.from(document.querySelectorAll('ol > li')).find(entry => entry.textContent.includes('Thread 1'))?.scrollIntoView({ block: 'start' })");
    await page.screenshot({ path: "/tmp/werewolf-threads-mobile.png", fullPage: false });
    await page.setViewport({ width: 1440, height: 1000 });
    await page.evaluate("Array.from(document.querySelectorAll('ol > li')).find(entry => entry.textContent.includes('Thread 1'))?.scrollIntoView({ block: 'start' })");
    await page.screenshot({ path: "/tmp/werewolf-threads-desktop.png", fullPage: false });
    expect(await page.evaluate('document.body.innerText.includes("Role unknown")')).toBe(false);
    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await text(page, "Meet the village");
    expect(await page.evaluate('document.body.innerText.includes("Role unknown")')).toBe(true);
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
  await runWerewolf(createWerewolfStore(database.db, game.id, claim.claim.ownerEpoch), { async decide({ request }) {
    if (request.action === "open_thread") return { kind: "opening", text: null, cue: "Waits", recipientIds: [] };
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
  const groups: StoredVisualShot[] = [], groupImageUrls: string[] = [];
  for (let i = 0; i < 3; i++) {
    const members = job.plan.cast.slice(i * 2, i * 2 + 2);
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
    await text(page, "Village lobby"); await text(page, "Private pack room"); await page.waitForSelector('[aria-label="Character coverage"]');
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
    await page.waitForFunction("document.getAnimations().every(animation => animation.playState !== 'running')");
    await page.click("[data-workspace-section] button[aria-expanded]");
    await page.waitForSelector('[aria-label="Character framing preview"] img');
    await page.select('select[aria-label="Frame character"]', job.plan.cast[4]!.id);
    await page.waitForFunction(`Array.from(document.querySelectorAll('[aria-label="Character framing preview"] img')).some(image => image.complete && image.src === ${JSON.stringify(groupImageUrls[2])})`);
    await page.select('select[aria-label="Frame character"]', job.plan.cast[7]!.id);
    await page.waitForSelector('img[alt$="portrait fallback"]');
    await page.screenshot({ path: "/tmp/werewolf-admin-production-mobile.png", fullPage: true });
    await click(page, "Versions and review");
    await text(page, "3 group shots");
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
      await viewer.goto(`${servers.webUrl}/werewolf/${game.slug}`, { waitUntil: "domcontentloaded" });
      await text(viewer, "Meet the village"); await click(viewer, "Next");
      await viewer.waitForSelector('[aria-label="Current room"] [data-speech-bubble]', { visible: true });
      expect(await viewer.evaluate(`Array.from(document.querySelectorAll('[aria-label="Current room"] img')).some(image => image.complete && image.src.includes("/media/"))`)).toBe(true);
      await viewer.screenshot({ path: "/tmp/werewolf-replay-published-panel.png" });
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

test("visual replay freezes its clock, seeks without spoilers, handles failed portraits and keyboard focus", async () => {
  const [game] = await database.db.select().from(schema.games).where(eq(schema.games.gameKind, "werewolf"));
  if (!game) throw new Error("Missing completed replay fixture");
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.setRequestInterception(true);
    page.on("request", request => { if (request.url().includes("/characters/")) void request.respond({ status: 404, body: "Missing frozen reference" }); else void request.continue(); });
    await page.goto(`${servers.webUrl}/werewolf/${game.slug}`, { waitUntil: "domcontentloaded" });
    await text(page, "Meet the village"); await click(page, "Next");
    await page.waitForSelector('[data-werewolf-stage][data-cursor="2"][data-ready="true"] [data-speech-bubble]');
    const clock = () => page.$eval('[data-werewolf-stage]', node => Number(node.getAttribute('data-elapsed')));
    const before = await clock();
    await click(page, "Play");
    await page.waitForFunction(`Number(document.querySelector('[data-werewolf-stage]').dataset.elapsed) > ${before + 200}`);
    await click(page, "Pause"); const paused = await clock();
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(await clock()).toBe(paused);
    await page.select('select[aria-label="Playback speed"]', "2");
    await page.focus('select[aria-label="Playback speed"]'); await page.keyboard.press('Space');
    expect(await clock()).toBe(paused);
    await page.keyboard.press('Escape');
    await page.evaluate('document.activeElement.blur()'); await page.keyboard.press('ArrowRight');
    await page.waitForSelector('[data-werewolf-stage][data-cursor="3"]');
    await click(page, "Omniscient"); await text(page, "werewolf · Alive");
    expect(await page.$('[aria-label="Player thinking"]')).toBeNull();
    await page.click('input[type="checkbox"]');
    await text(page, "No thinking was captured");
    await click(page, "Latest");
    await page.waitForFunction(`document.querySelector('[aria-label="Player thinking"] ol li') !== null`);
    await click(page, "Beginning"); await text(page, "No thinking was captured");
    await click(page, "Mystery"); await text(page, "Role unknown");
    expect(await page.$('[aria-label="Player thinking"]')).toBeNull();
    expect(await page.evaluate('document.body.innerText.includes("Show thinking")')).toBe(false);
    expect(await page.evaluate('document.body.innerText.includes("werewolf · Alive")')).toBe(false);
    await click(page, "Next"); await page.waitForSelector('[data-speech-bubble]');
    await page.screenshot({ path: "/tmp/werewolf-replay-desktop.png" });
    await page.setViewport({ width: 390, height: 844 });
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
    await page.screenshot({ path: "/tmp/werewolf-replay-mobile.png" });
    await click(page, "Latest"); await text(page, "Game complete");
    await click(page, "Beginning"); await text(page, "Role unknown");
    expect(await page.evaluate('document.body.innerText.includes("Game complete")')).toBe(false);
  } finally { await page.close(); }
}, 60_000);
