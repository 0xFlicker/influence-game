import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { runWerewolf, type WerewolfAgent } from "@influence/engine/werewolf";
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
}, 120_000);

async function checkFailedPackNegotiations() {
  const game = await createWerewolfGame(database.db, admin.userId, { preset: "two_wolves", agentProfileIds: [], maxDays: 1 });
  const claim = await claimWerewolfGame(database.db, game.id);
  if (!claim.ok) throw new Error(claim.error);
  const agent: WerewolfAgent = { async decide({ request, observation }) {
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
    expect(await page.evaluate('document.body.innerText.includes("Pack ballot")')).toBe(false);
    await click(page, "Omniscient");
    await text(page, "Meet the village");
    await click(page, "Latest");
    await text(page, "Pack ballot 3/3");
    await text(page, "Three ballots without agreement. No pack attack tonight.");
    await text(page, "Doctor protected");
    await text(page, "checked");
    expect(await page.evaluate('document.body.innerText.includes("Private fixture")')).toBe(false);
    await page.setViewport({ width: 390, height: 844 });
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
    await page.evaluate("Array.from(document.querySelectorAll('ol > li')).find(entry => entry.textContent.includes('Pack ballot 3/3'))?.scrollIntoView({ block: 'start' })");
    await page.screenshot({ path: "/tmp/werewolf-pack-ballots-mobile.png" });
    await click(page, "Mystery");
    await text(page, "Meet the village");
    await click(page, "Latest");
    await text(page, "Game complete");
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
    expect(report).toContain("[answer 1");
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
    await page.waitForFunction('document.body.innerText.includes("Seer · Alive")');
    await page.screenshot({ path: "/tmp/werewolf-omniscient-desktop.png", fullPage: true });
    await click(page, "Mystery");
    await page.waitForFunction('document.body.innerText.includes("Role unknown")');
    expect(await page.evaluate('document.body.innerText.includes("Seer · Alive")')).toBe(false);
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: "/tmp/werewolf-mystery-mobile.png", fullPage: true });
    expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
    await click(page, "Latest");
    await text(page, "Game complete");
    await text(page, "Thread 1");
    await text(page, "Answer to the group");
    await text(page, "Passed.");
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
