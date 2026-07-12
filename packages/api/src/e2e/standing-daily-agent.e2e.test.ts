import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Browser, Dialog, Page } from "puppeteer";
import { schema } from "../db/index.js";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";
import { closeSeason, createSeason } from "../services/seasons.js";
import {
  createAdminUser,
  createPlayerUser,
  mintTestJwt,
  type AdminUserResult,
  type PlayerUserResult,
} from "./test-auth.js";
import {
  closeBrowser,
  createAuthenticatedPage,
  launchBrowser,
} from "./test-browser.js";
import { createTestDb, destroyTestDb, type TestDB } from "./test-db.js";
import { startTestServers, stopTestServers, type TestServerHandles } from "./test-server.js";

process.env.JWT_SECRET = "e2e-test-jwt-secret";

let testDb: TestDB;
let servers: TestServerHandles;
let browser: Browser;
let admin: AdminUserResult;
let player: PlayerUserResult;
let agentlessPlayer: PlayerUserResult;
let singleAgentPlayer: PlayerUserResult;
let surfacePlayer: PlayerUserResult;
let adminJwt: string;
let seasonId: string;
let firstAgentId: string;
let secondAgentId: string;

interface QueueStatusResponse {
  promptEligible: boolean;
  eligibility: string | null;
  relevantGame: unknown | null;
}

beforeAll(async () => {
  testDb = await createTestDb();
  admin = await createAdminUser(testDb.db);
  player = await createPlayerUser(testDb.db, 0);
  agentlessPlayer = await createPlayerUser(testDb.db, 1);
  singleAgentPlayer = await createPlayerUser(testDb.db, 2);
  surfacePlayer = await createPlayerUser(testDb.db, 3);
  adminJwt = await mintTestJwt(admin.userId, {
    roles: ["sysop"],
    permissions: ["view_admin", "schedule_free_game"],
  });

  const firstAgent = (await createOwnedAgentProfile(testDb.db, { userId: player.userId }, {
    name: "Daily Alpha",
    personality: "Patient and observant.",
    strategyStyle: "Build trust before acting.",
  })).profile;
  const secondAgent = (await createOwnedAgentProfile(testDb.db, { userId: player.userId }, {
    name: "Daily Beta",
    personality: "Direct and adaptable.",
    strategyStyle: "Create options, then commit.",
  })).profile;
  firstAgentId = firstAgent.id;
  secondAgentId = secondAgent.id;
  await createOwnedAgentProfile(testDb.db, { userId: singleAgentPlayer.userId }, {
    name: "Solo Gamma",
    personality: "Quietly decisive.",
    strategyStyle: "Listen first and move once.",
  });
  await createOwnedAgentProfile(testDb.db, { userId: surfacePlayer.userId }, {
    name: "Surface Delta",
    personality: "Ready to enter from any screen.",
    strategyStyle: "Observe the field before committing.",
  });

  const season = await createSeason(testDb.db, {
    slug: `standing-browser-${randomUUID()}`,
    name: "Standing Browser Season",
    createdById: admin.userId,
  });
  seasonId = season.id;

  servers = await startTestServers({
    databaseUrl: testDb.databaseUrl,
    adminAddress: admin.wallet.address,
    jwtSecret: "e2e-test-jwt-secret",
  });
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  let seasonCleanupError: unknown;
  try {
    if (testDb && seasonId) await closeSeason(testDb.db, seasonId);
  } catch (error) {
    seasonCleanupError = error;
  }
  try {
    if (browser) await closeBrowser(browser);
  } finally {
    if (servers) await stopTestServers(servers);
    if (testDb) destroyTestDb(testDb.databaseUrl);
  }
  if (seasonCleanupError) throw seasonCleanupError;
});

describe("E2E: Standing Daily Agent", () => {
  test("creates and automatically enters an agent from the global zero-agent prompt", async () => {
    const webUrl = servers.webUrl!;
    const page = await createAuthenticatedPage(browser, agentlessPlayer.jwt, `${webUrl}/about`, {
      privateKey: agentlessPlayer.wallet.privateKey,
    });

    await waitForText(page, "Play Daily Free", 15_000);
    await waitForText(page, "Create an agent");
    await clickButton(page, "Create an agent");
    await page.type('input[placeholder="e.g. ShadowPlay-7"]', "Prompt Newcomer");
    await page.type(
      'textarea[placeholder^="How does your agent behave"]',
      "Curious, composed, and willing to make a clear decision.",
    );
    await clickButton(page, "Create and enter");

    const createdAgent = await waitForOwnedAgentByName(agentlessPlayer.userId, "Prompt Newcomer");
    await waitForQueueAgent(agentlessPlayer.userId, createdAgent.id);
    await waitForMissingText(page, "Play Daily Free");

    await page.goto(`${webUrl}/games/free`, { waitUntil: "domcontentloaded" });
    await waitForText(page, "Prompt Newcomer");
    await clickButton(page, "Leave queue");
    await waitForQueueAgent(agentlessPlayer.userId, null);
  }, 60_000);

  test("shows the single-agent CTA and honors Maybe Later for three days", async () => {
    const page = await createAuthenticatedPage(browser, singleAgentPlayer.jwt, `${servers.webUrl!}/rules`, {
      privateKey: singleAgentPlayer.wallet.privateKey,
    });

    await waitForText(page, "Play Daily Free", 15_000);
    await waitForText(page, "Enter Solo Gamma");
    expect(await pageText(page)).not.toContain("Select an agent");
    await clickButton(page, "Maybe later");
    await waitForMissingText(page, "Play Daily Free");

    const suppression = await waitForSuppression(singleAgentPlayer.userId);
    expect(suppression.reason).toBe("maybe_later");
    const suppressionMs = Date.parse(suppression.suppressedUntil!);
    expect(suppressionMs).toBeGreaterThan(Date.now() + (71 * 60 * 60 * 1000));
    expect(suppressionMs).toBeLessThan(Date.now() + (73 * 60 * 60 * 1000));

    const status = await reloadAndReadQueueStatus(page);
    expect(status.promptEligible).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 3_200));
    expect(await pageText(page)).not.toContain("Play Daily Free");
    expect((await testDb.db.select().from(schema.freeGameQueue)
      .where(eq(schema.freeGameQueue.userId, singleAgentPlayer.userId))).length).toBe(0);
  }, 60_000);

  test("covers the global prompt, standing lifecycle, game state, admin removal, and season cleanup", async () => {
    const webUrl = servers.webUrl!;
    const playerPage = await createAuthenticatedPage(browser, player.jwt, `${webUrl}/about`, {
      privateKey: player.wallet.privateKey,
    });

    await waitForText(playerPage, "Play Daily Free", 15_000);
    await waitForText(playerPage, "Choose an agent");
    expect(await pageText(playerPage)).toContain("Maybe later");
    await playerPage.waitForFunction(`document.activeElement?.id === 'daily-agent-choice'`);
    await playerPage.keyboard.down("Shift");
    await playerPage.keyboard.press("Tab");
    await playerPage.keyboard.up("Shift");
    await playerPage.waitForFunction(`document.activeElement?.textContent?.trim() === 'Maybe later'`);
    await playerPage.keyboard.press("Tab");
    await playerPage.waitForFunction(`document.activeElement?.id === 'daily-agent-choice'`);

    await playerPage.keyboard.press("Escape");
    await waitForMissingText(playerPage, "Play Daily Free");
    await playerPage.evaluate(`document.querySelector('a[href="/rules"]')?.click()`);
    await playerPage.waitForFunction('window.location.pathname === "/rules"');
    await new Promise((resolve) => setTimeout(resolve, 3_200));
    expect(await pageText(playerPage)).not.toContain("Play Daily Free");

    const observedPromptDelay = await reloadAndMeasurePrompt(playerPage);
    expect(observedPromptDelay).toBeGreaterThanOrEqual(2_800);
    const clickedOutside = await playerPage.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const overlay = dialog?.parentElement;
      if (!overlay) return false;
      overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      return true;
    })()`) as boolean;
    expect(clickedOutside).toBe(true);
    await waitForMissingText(playerPage, "Play Daily Free");
    await playerPage.waitForFunction(`document.activeElement?.id === 'focus-restoration-sentinel'`);

    await playerPage.reload({ waitUntil: "domcontentloaded" });
    await waitForText(playerPage, "Play Daily Free", 15_000);

    await playerPage.select("#daily-agent-choice", firstAgentId);
    await clickButton(playerPage, "Enter agent");
    await waitForMissingText(playerPage, "Play Daily Free");
    await waitForQueueAgent(player.userId, firstAgentId);

    await playerPage.goto(`${webUrl}/games/free`, { waitUntil: "domcontentloaded" });
    await waitForText(playerPage, "Daily Alpha");
    await waitForText(playerPage, "Leave queue");

    await playerPage.select('[aria-label="Switch Daily Free agent"]', secondAgentId);
    await clickButton(playerPage, "Switch agent");
    await waitForQueueAgent(player.userId, secondAgentId);
    await playerPage.reload({ waitUntil: "domcontentloaded" });
    await waitForText(playerPage, "Daily Beta");
    await waitForText(playerPage, "Leave queue");

    const ownerDialogs: string[] = [];
    playerPage.on("dialog", async (dialog: Dialog) => {
      ownerDialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await clickButton(playerPage, "Leave queue");
    await waitForQueueAgent(player.userId, null);
    await waitForText(playerPage, "Select an agent for the Influence Queue");
    expect(ownerDialogs).toEqual([]);
    expect(await pageText(playerPage)).not.toContain("next season");
    expect(await pageText(playerPage)).not.toContain("Are you sure");

    await clickAgentCard(playerPage, "Daily Beta");
    await clickButton(playerPage, "Join Influence Queue");
    await waitForQueueAgent(player.userId, secondAgentId);
    await waitForText(playerPage, "Daily Beta");
    await waitForText(playerPage, "Leave queue");

    const gameId = randomUUID();
    const gameSlug = `standing-selected-${gameId}`;
    await testDb.db.insert(schema.games).values({
      id: gameId,
      slug: gameSlug,
      config: JSON.stringify({ modelTier: "budget" }),
      status: "waiting",
      trackType: "free",
      seasonId,
      minPlayers: 4,
      maxPlayers: 12,
    });
    await testDb.db.insert(schema.gamePlayers).values({
      id: randomUUID(),
      gameId,
      userId: player.userId,
      agentProfileId: secondAgentId,
      persona: JSON.stringify({ name: "Daily Beta", personality: "Direct and adaptable." }),
      agentConfig: JSON.stringify({ model: "e2e" }),
    });

    await playerPage.reload({ waitUntil: "domcontentloaded" });
    await waitForText(playerPage, "View current game");
    expect(await playerPage.$eval(
      `a[href='/games/${gameSlug}']`,
      (element) => element.textContent?.trim(),
    )).toBe("View current game");

    await testDb.db.update(schema.games).set({ status: "in_progress" }).where(eq(schema.games.id, gameId));
    await playerPage.reload({ waitUntil: "domcontentloaded" });
    await waitForText(playerPage, "View current game");
    const surfacePage = await createAuthenticatedPage(browser, surfacePlayer.jwt, `${webUrl}/games/${gameSlug}`, {
      privateKey: surfacePlayer.wallet.privateKey,
    });
    await waitForPrompt(surfacePage);
    await waitForText(surfacePage, "Enter Surface Delta");
    await surfacePage.keyboard.press("Escape");
    await waitForMissingText(surfacePage, "Play Daily Free");
    await playerPage.goto(`${webUrl}/dashboard`, { waitUntil: "domcontentloaded" });
    await playerPage.waitForSelector(`a[href='/games/${gameSlug}']`, { timeout: 45_000 });
    expect(await pageText(playerPage)).toContain("Daily Beta is in the current Daily Free game.");
    expect(await playerPage.$eval(
      `a[href='/games/${gameSlug}']`,
      (element) => element.getAttribute("href"),
    )).toBe(`/games/${gameSlug}`);
    await playerPage.goto(`${webUrl}/games/free`, { waitUntil: "domcontentloaded" });
    await playerPage.waitForSelector(`a[href='/games/${gameSlug}']`, { timeout: 45_000 });

    const adminPage = await createAuthenticatedPage(browser, adminJwt, `${webUrl}/admin?tab=free-queue`, {
      privateKey: admin.wallet.privateKey,
    });
    await waitForText(adminPage, "Daily Free queue");
    await waitForText(adminPage, "Daily Beta");
    await waitForText(adminPage, "In game");

    await testDb.db.update(schema.games).set({
      status: "completed",
      endedAt: new Date().toISOString(),
    }).where(eq(schema.games.id, gameId));
    await surfacePage.goto(`${webUrl}/games/${gameSlug}/replay`, { waitUntil: "domcontentloaded" });
    await waitForPrompt(surfacePage);
    await waitForText(surfacePage, "Enter Surface Delta");
    const terminalStatus = await reloadAndReadQueueStatus(playerPage);
    expect(terminalStatus.eligibility).toBe("eligible");
    expect(terminalStatus.relevantGame).toBeNull();
    await waitForText(playerPage, "Leave queue");
    expect((await testDb.db.select().from(schema.freeGameQueue)
      .where(eq(schema.freeGameQueue.userId, player.userId))).length).toBe(1);
    await adminPage.reload({ waitUntil: "domcontentloaded" });
    await waitForText(adminPage, "Daily Beta");
    await waitForText(adminPage, "Eligible");
    expect(await pageText(adminPage)).not.toContain("In game");

    const adminDialogs: string[] = [];
    adminPage.on("dialog", async (dialog: Dialog) => {
      adminDialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await clickButton(adminPage, "Remove");
    await waitForQueueAgent(player.userId, null);
    await waitForText(adminPage, "No standing entries.");
    expect(adminDialogs).toEqual([]);
    expect(await pageText(adminPage)).not.toContain("next season");
    expect(await pageText(adminPage)).not.toContain("Are you sure");

    await playerPage.reload({ waitUntil: "domcontentloaded" });
    await playerPage.waitForSelector("button.influence-selection-card", { timeout: 45_000 });
    await clickAgentCard(playerPage, "Daily Alpha");
    await clickButton(playerPage, "Join Influence Queue");
    await waitForQueueAgent(player.userId, firstAgentId);
    await waitForText(playerPage, "Daily Alpha");

    await testDb.db.insert(schema.freeQueuePromptSuppressions).values({
      id: randomUUID(),
      userId: player.userId,
      seasonId,
      reason: "maybe_later",
      suppressedUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    const playerSuppressionsBeforeClose = await testDb.db.select().from(schema.freeQueuePromptSuppressions)
      .where(eq(schema.freeQueuePromptSuppressions.userId, player.userId));
    expect(playerSuppressionsBeforeClose).toHaveLength(1);
    await closeSeason(testDb.db, seasonId);
    expect(await testDb.db.select().from(schema.freeGameQueue)).toEqual([]);
    expect(await testDb.db.select().from(schema.freeQueuePromptSuppressions)).toEqual([]);
    const closedStatus = await reloadAndReadQueueStatus(playerPage);
    expect(closedStatus.promptEligible).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 3_200));
    expect(await pageText(playerPage)).not.toContain("Play Daily Free");
  }, 120_000);
});

async function waitForText(page: Page, text: string, timeout = 30_000): Promise<void> {
  try {
    await page.waitForFunction(
      `document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`,
      { timeout },
    );
  } catch {
    throw new Error(`Page did not render ${JSON.stringify(text)}. Visible text:\n${await pageText(page)}`);
  }
}

async function waitForPrompt(page: Page): Promise<void> {
  await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 15_000 });
  expect(await pageText(page)).toContain("Play Daily Free");
}

async function waitForMissingText(page: Page, text: string, timeout = 10_000): Promise<void> {
  await page.waitForFunction(
    `!document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`,
    { timeout },
  );
}

async function waitForQueueAgent(
  userId: string,
  agentProfileId: string | null,
  timeout = 10_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const entry = (await testDb.db.select().from(schema.freeGameQueue)
      .where(eq(schema.freeGameQueue.userId, userId)).limit(1))[0];
    if ((entry?.agentProfileId ?? null) === agentProfileId) return;
    await Bun.sleep(100);
  }
  throw new Error(`Queue did not settle on ${agentProfileId ?? "no agent"}.`);
}

async function waitForOwnedAgentByName(userId: string, name: string, timeout = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const profiles = await testDb.db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.userId, userId));
    const profile = profiles.find((candidate) => candidate.name === name);
    if (profile) return profile;
    await Bun.sleep(100);
  }
  throw new Error(`Owned agent ${name} was not created.`);
}

async function waitForSuppression(userId: string, timeout = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const suppression = (await testDb.db.select().from(schema.freeQueuePromptSuppressions)
      .where(eq(schema.freeQueuePromptSuppressions.userId, userId)).limit(1))[0];
    if (suppression) return suppression;
    await Bun.sleep(100);
  }
  throw new Error(`Prompt suppression for ${userId} was not created.`);
}

async function reloadAndReadQueueStatus(page: Page): Promise<QueueStatusResponse> {
  const statusResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/free-queue" && response.request().method() === "GET";
  }, { timeout: 30_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  return (await (await statusResponse).json()) as QueueStatusResponse;
}

async function reloadAndMeasurePrompt(page: Page): Promise<number> {
  const queueResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/free-queue" && response.request().method() === "GET";
  }, { timeout: 30_000 });
  const agentsResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/agent-profiles" && response.request().method() === "GET";
  }, { timeout: 30_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await Promise.all([queueResponse, agentsResponse]);
  const readyAt = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 200));
  await page.waitForFunction(`(() => {
    const target = document.createElement('button');
    target.id = 'focus-restoration-sentinel';
    target.textContent = 'Focus restoration sentinel';
    document.body.prepend(target);
    target.focus();
    return document.activeElement === target;
  })()`);
  expect(await pageText(page)).not.toContain("Play Daily Free");
  await waitForText(page, "Play Daily Free", 15_000);
  return Date.now() - readyAt;
}

async function clickButton(page: Page, label: string): Promise<void> {
  const clicked = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`) as boolean;
  if (!clicked) throw new Error(`Button ${JSON.stringify(label)} was not available.`);
}

async function clickAgentCard(page: Page, agentName: string): Promise<void> {
  const clicked = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.querySelector("p")?.textContent?.trim() === ${JSON.stringify(agentName)});
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`) as boolean;
  if (!clicked) throw new Error(`Agent card ${agentName} was not available.`);
}

async function pageText(page: Page): Promise<string> {
  return page.evaluate("document.body.innerText") as Promise<string>;
}
