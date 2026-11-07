import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Browser, Dialog, Page } from "puppeteer";
import { schema } from "../db/index.js";
import { createOwnedAgentProfile, updateOwnedAgentProfile } from "../services/agent-profile-management.js";
import { contentImageFixture, headPositionFixture } from "../__tests__/content-image-fixture.js";
import { recordCurrentLegalAcceptance } from "../services/legal-acceptance.js";
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
import {
  createIsolatedTestDb,
  destroyIsolatedTestDb,
  type TestDB,
} from "./test-db.js";
import { startTestServers, stopTestServers, type TestServerHandles } from "./test-server.js";
import { cleanupE2eResources } from "./cleanup.js";

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
  testDb = await createIsolatedTestDb();
  admin = await createAdminUser(testDb.db);
  player = await createPlayerUser(testDb.db, 0);
  agentlessPlayer = await createPlayerUser(testDb.db, 1);
  singleAgentPlayer = await createPlayerUser(testDb.db, 2);
  surfacePlayer = await createPlayerUser(testDb.db, 3);
  for (const userId of [
    admin.userId,
    player.userId,
    agentlessPlayer.userId,
    singleAgentPlayer.userId,
    surfacePlayer.userId,
  ]) {
    await recordCurrentLegalAcceptance(
      testDb.db,
      userId,
      "existing_account",
      "0123456789abcdef0123456789abcdef01234567",
    );
  }
  adminJwt = await mintTestJwt(admin.userId, {
    roles: ["sysop"],
    permissions: ["view_admin", "schedule_free_game"],
  });

  const firstBody = await contentImageFixture("pfp/standing-daily-alpha.png");
  const firstAgent = (await createOwnedAgentProfile(testDb.db, { userId: player.userId }, {
    name: "Daily Alpha",
    personality: "Patient and observant.",
    strategyStyle: "Build trust before acting.",
    fullBodyReferenceUrl: firstBody,
    headPosition: await headPositionFixture(firstBody),
  })).profile;
  const secondBody = await contentImageFixture("pfp/standing-daily-beta.png");
  const secondAgent = (await createOwnedAgentProfile(testDb.db, { userId: player.userId }, {
    name: "Daily Beta",
    personality: "Direct and adaptable.",
    strategyStyle: "Create options, then commit.",
    fullBodyReferenceUrl: secondBody,
    headPosition: await headPositionFixture(secondBody),
  })).profile;
  firstAgentId = firstAgent.id;
  secondAgentId = secondAgent.id;
  const soloBody = await contentImageFixture("pfp/standing-solo-gamma.png");
  await createOwnedAgentProfile(testDb.db, { userId: singleAgentPlayer.userId }, {
    name: "Solo Gamma",
    personality: "Quietly decisive.",
    strategyStyle: "Listen first and move once.",
    fullBodyReferenceUrl: soloBody,
    headPosition: await headPositionFixture(soloBody),
  });
  const surfaceBody = await contentImageFixture("pfp/standing-surface-delta.png");
  await createOwnedAgentProfile(testDb.db, { userId: surfacePlayer.userId }, {
    name: "Surface Delta",
    personality: "Ready to enter from any screen.",
    strategyStyle: "Observe the field before committing.",
    fullBodyReferenceUrl: surfaceBody,
    headPosition: await headPositionFixture(surfaceBody),
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
  await cleanupE2eResources([
    ["season", async () => { if (testDb && seasonId) await closeSeason(testDb.db, seasonId); }],
    ["browser", async () => { if (browser) await closeBrowser(browser); }],
    ["servers", async () => { if (servers) await stopTestServers(servers); }],
    ["database", async () => { if (testDb) await destroyIsolatedTestDb(testDb.databaseUrl); }],
  ]);
}, 60_000);

describe("E2E: Standing Daily Agent", () => {
  test("creates an artless Agent, prepares it, and enters Daily Free from the season page", async () => {
    const webUrl = servers.webUrl!;
    const page = await createAuthenticatedPage(browser, agentlessPlayer.jwt, `${webUrl}/games/free`, {
      privateKey: agentlessPlayer.wallet.privateKey,
    });

    await waitForText(page, "Standing Browser Season", 15_000);
    await page.waitForSelector('a[href*="flow=daily_free"]');
    await page.click('a[href*="flow=daily_free"]');
    await waitForText(page, "Advanced create");
    await clickButton(page, "Advanced create");
    await page.waitForSelector("#agent-name");
    await page.type("#agent-name", "Prompt Newcomer");
    await page.type("#agent-personality", "Curious, composed, and willing to make a clear decision.");
    await clickButton(page, "Male");
    await page.waitForFunction(
      "document.querySelector('#agent-gender-male')?.getAttribute('aria-checked') === 'true'",
    );
    const submitState = await page.evaluate(`(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim() === "Create & enter");
      return button ? { disabled: button.disabled, text: button.textContent?.trim() ?? "" } : null;
    })()`) as { disabled: boolean; text: string } | null;
    if (!submitState || submitState.disabled) {
      throw new Error(`Create & enter was not enabled before submit: ${JSON.stringify(submitState)}`);
    }
    const creationResponsePromise = page.waitForResponse((response) => {
      const request = response.request();
      return request.method() === "POST"
        && new URL(response.url()).pathname === "/api/agent-profiles";
    }, { timeout: 15_000 });
    await clickButton(page, "Create & enter");
    let creationResponse: Awaited<typeof creationResponsePromise>;
    try {
      creationResponse = await creationResponsePromise;
    } catch (error) {
      const formState = await page.evaluate(`(() => ({
        alerts: [...document.querySelectorAll('[role="alert"]')]
          .map((element) => element.textContent?.trim())
          .filter(Boolean),
        visibleText: document.body.innerText.slice(-1_500),
      }))()`) as { alerts: string[]; visibleText: string };
      throw new Error(`No Agent create response after submit. Form state: ${JSON.stringify(formState)}. ${String(error)}`);
    }
    if (!creationResponse.ok()) {
      throw new Error(`Agent creation returned ${creationResponse.status()}: ${await creationResponse.text()}`);
    }

    const createdAgent = await waitForOwnedAgentByName(agentlessPlayer.userId, "Prompt Newcomer");
    await page.waitForFunction("location.pathname === '/agents/prepare'", { timeout: 15_000 });
    await waitForText(page, "Prepare Prompt Newcomer");
    const newcomerBody = await contentImageFixture("pfp/standing-prompt-newcomer.png");
    await updateOwnedAgentProfile(testDb.db, { userId: agentlessPlayer.userId }, createdAgent.id, {
      fullBodyReferenceUrl: newcomerBody,
      headPosition: await headPositionFixture(newcomerBody),
    });
    await page.waitForFunction(
      `Array.from(document.querySelectorAll("button")).some(button => button.textContent?.trim() === "Enter Daily Free")`,
      { timeout: 15_000 },
    );
    await clickButton(page, "Enter Daily Free");
    await waitForQueueAgent(agentlessPlayer.userId, createdAgent.id);
    await waitForMissingText(page, "Play for Free");

    await page.goto(`${webUrl}/games/free`, { waitUntil: "domcontentloaded" });
    await waitForText(page, "Prompt Newcomer");
    await clickButton(page, "Leave queue");
    await waitForQueueAgent(agentlessPlayer.userId, null);
  }, 60_000);

  test("does not show a global queue prompt on ordinary pages", async () => {
    const page = await createAuthenticatedPage(browser, singleAgentPlayer.jwt, `${servers.webUrl!}/rules`, {
      privateKey: singleAgentPlayer.wallet.privateKey,
    });

    await waitForText(page, "How to Win");
    await new Promise((resolve) => setTimeout(resolve, 3_200));
    expect(await pageText(page)).not.toContain("Play for Free");
    await page.goto(`${servers.webUrl!}/dashboard`, { waitUntil: "domcontentloaded" });
    await waitForText(page, "Your agents");
    await new Promise((resolve) => setTimeout(resolve, 3_200));
    expect(await pageText(page)).not.toContain("Play for Free");
    expect((await testDb.db.select().from(schema.freeGameQueue)
      .where(eq(schema.freeGameQueue.userId, singleAgentPlayer.userId))).length).toBe(0);
  }, 60_000);

  test("covers season entry, standing lifecycle, game state, admin removal, and season cleanup", async () => {
    const webUrl = servers.webUrl!;
    const playerPage = await createAuthenticatedPage(browser, player.jwt, `${webUrl}/games/free`, {
      privateKey: player.wallet.privateKey,
    });

    await playerPage.waitForSelector('[aria-label="Your season agent"]', { timeout: 45_000 });
    await playerPage.select('[aria-label="Your season agent"]', firstAgentId);
    await clickButton(playerPage, "Join Standing Browser Season");
    await waitForQueueAgent(player.userId, firstAgentId);

    await playerPage.goto(`${webUrl}/games/free`, { waitUntil: "domcontentloaded" });
    await waitForText(playerPage, "Daily Alpha");
    await waitForText(playerPage, "Leave queue");

    await playerPage.select('[aria-label="Your season agent"]', secondAgentId);
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
    await waitForText(playerPage, "Join Standing Browser Season");
    expect(ownerDialogs).toEqual([]);
    expect(await pageText(playerPage)).not.toContain("next season");
    expect(await pageText(playerPage)).not.toContain("Are you sure");

    await playerPage.select('[aria-label="Your season agent"]', secondAgentId);
    await clickButton(playerPage, "Join Standing Browser Season");
    await waitForQueueAgent(player.userId, secondAgentId);
    await waitForText(playerPage, "Daily Beta");
    await waitForText(playerPage, "Leave queue");

    const gameId = randomUUID();
    const gameSlug = `standing-selected-${gameId}`;
    await testDb.db.insert(schema.games).values({
      id: gameId,
      slug: gameSlug,
      config: JSON.stringify({
        modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" },
      }),
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
    await waitForText(playerPage, "Awaiting start");
    expect(await playerPage.$eval(
      `a[href='/games/${gameSlug}']`,
      (element) => element.textContent?.trim(),
    )).toBe("View game →");

    await testDb.db.update(schema.games).set({ status: "in_progress" }).where(eq(schema.games.id, gameId));
    await playerPage.reload({ waitUntil: "domcontentloaded" });
    await waitForText(playerPage, "Watch live");
    const surfacePage = await createAuthenticatedPage(browser, surfacePlayer.jwt, `${webUrl}/games/${gameSlug}`, {
      privateKey: surfacePlayer.wallet.privateKey,
    });
    await new Promise((resolve) => setTimeout(resolve, 3_200));
    expect(await pageText(surfacePage)).not.toContain("Play for Free");
    await playerPage.goto(`${webUrl}/dashboard`, { waitUntil: "domcontentloaded" });
    await waitForText(playerPage, "Your agents", 45_000);
    expect(await pageText(playerPage)).not.toContain("Play for Free");
    await playerPage.goto(`${webUrl}/games/free`, { waitUntil: "domcontentloaded" });
    await playerPage.waitForSelector(`button[aria-label="Watch live: ${gameSlug}"]`, { timeout: 45_000 });

    const adminPage = await createAuthenticatedPage(browser, adminJwt, `${webUrl}/admin/free-queue`, {
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
    await new Promise((resolve) => setTimeout(resolve, 3_200));
    expect(await pageText(surfacePage)).not.toContain("Play for Free");
    const terminalStatus = await reloadAndReadQueueStatus(playerPage, player.jwt);
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
    await playerPage.waitForSelector('[aria-label="Your season agent"]', { timeout: 45_000 });
    await playerPage.select('[aria-label="Your season agent"]', firstAgentId);
    await clickButton(playerPage, "Join Standing Browser Season");
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
    const closedStatus = await reloadAndReadQueueStatus(playerPage, player.jwt);
    expect(closedStatus.promptEligible).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 3_200));
    expect(await pageText(playerPage)).not.toContain("Play for Free");
  }, 120_000);
});

async function waitForText(page: Page, text: string, timeout = 30_000): Promise<void> {
  try {
    await page.waitForFunction(
      `document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`,
      { polling: "mutation", timeout },
    );
  } catch {
    throw new Error(`Page did not render ${JSON.stringify(text)}. Visible text:\n${await pageText(page)}`);
  }
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

async function reloadAndReadQueueStatus(page: Page, jwt: string): Promise<QueueStatusResponse> {
  await page.reload({ waitUntil: "domcontentloaded" });
  const response = await fetch(`${servers.apiUrl}/api/free-queue`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!response.ok) {
    throw new Error(`Queue status returned ${response.status}.`);
  }
  return await response.json() as QueueStatusResponse;
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

async function pageText(page: Page): Promise<string> {
  return page.evaluate("document.body.innerText") as Promise<string>;
}
