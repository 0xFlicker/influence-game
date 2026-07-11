import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Browser, Page } from "puppeteer";
import { schema } from "../db/index.js";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";
import {
  closeSeason,
  createSeason,
  finalizeSeason,
} from "../services/seasons.js";
import {
  COMPETITION_RATING_POLICY_VERSION,
  SEASON_SCORING_POLICY_VERSION,
} from "../services/season-policy.js";
import { REVISION_POLICY_VERSION } from "../services/revision-policy.js";
import {
  createAdminUser,
  mintTestJwt,
  type AdminUserResult,
} from "./test-auth.js";
import {
  closeBrowser,
  createAnonymousPage,
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
let adminJwt: string;
let agentId: string;
let gameSlug: string;
let seasonSlug: string;

beforeAll(async () => {
  testDb = await createTestDb();
  admin = await createAdminUser(testDb.db);
  adminJwt = await mintTestJwt(admin.userId, {
    roles: ["sysop", "producer"],
    permissions: [
      "view_admin", "manage_seasons", "manage_roles", "create_game", "start_game",
      "join_game", "stop_game", "fill_game",
    ],
  });

  const profile = (await createOwnedAgentProfile(testDb.db, { userId: admin.userId }, {
    name: "QA Champion",
    personality: "Patient, observant, and strategically direct.",
    backstory: "Built for season surface verification.",
    strategyStyle: "Build trust early, then convert information into decisive votes.",
  })).profile;
  agentId = profile.id;
  const revision = (await testDb.db.select().from(schema.agentRevisions))
    .find((candidate) => candidate.agentProfileId === profile.id)!;

  const season = await createSeason(testDb.db, {
    slug: `browser-season-${randomUUID()}`,
    name: "Browser QA Championship",
    createdById: admin.userId,
  });
  seasonSlug = season.slug;
  const gameId = randomUUID();
  gameSlug = `browser-rated-${gameId}`;
  await testDb.db.insert(schema.games).values({
    id: gameId,
    slug: gameSlug,
    config: JSON.stringify({ modelTier: "budget" }),
    status: "completed",
    trackType: "free",
    seasonId: season.id,
    minPlayers: 4,
    maxPlayers: 4,
    startedAt: "2026-07-10T18:30:00.000Z",
    endedAt: "2026-07-10T19:00:00.000Z",
  });
  const receiptId = randomUUID();
  await testDb.db.insert(schema.competitionReceipts).values({
    id: receiptId,
    seasonId: season.id,
    gameId,
    ownerId: admin.userId,
    agentProfileId: profile.id,
    agentRevisionId: revision.id,
    ownerDisplayNameSnapshot: "E2E Admin",
    agentNameSnapshot: profile.name,
    eligibilityStatus: "eligible",
    lobbySize: 4,
    placement: 1,
    basePoints: 100,
    fieldBonus: 20,
    totalPoints: 120,
    accountRatingDelta: 18,
    scoringPolicyVersion: SEASON_SCORING_POLICY_VERSION,
    earnedAt: "2026-07-10T19:00:00.000Z",
  });
  await testDb.db.insert(schema.competitionReceiptEvidence).values({
    receiptId,
    ratingPolicyVersion: COMPETITION_RATING_POLICY_VERSION,
    pregameRating: { mu: 25, sigma: 25 / 3 },
    postgameRating: { mu: 30, sigma: 7.5 },
    opponentRatings: [{ playerId: "house-1", mu: 50, sigma: 3 }],
    fieldStrengthEvidence: { bonusRate: 0.2, maximumBonusRate: 0.2 },
    createdAt: "2026-07-10T19:00:00.000Z",
  });
  await testDb.db.insert(schema.competitionRatingSnapshots).values({
    id: randomUUID(),
    gameId,
    agentProfileId: profile.id,
    agentRevisionId: revision.id,
    mu: 25,
    sigma: 25 / 3,
    ratingPolicyVersion: COMPETITION_RATING_POLICY_VERSION,
    capturedAt: "2026-07-10T18:30:00.000Z",
  });
  await testDb.db.insert(schema.agentCompetitionRatings).values({
    agentProfileId: profile.id,
    effectiveRevisionId: revision.id,
    mu: 30,
    sigma: 7.5,
    gamesPlayed: 1,
    ratingPolicyVersion: COMPETITION_RATING_POLICY_VERSION,
    updatedAt: "2026-07-10T19:00:00.000Z",
  });
  await testDb.db.insert(schema.competitionRatingEvents).values({
    id: randomUUID(),
    idempotencyKey: `browser-qa:${gameId}:${profile.id}`,
    agentProfileId: profile.id,
    agentRevisionId: revision.id,
    seasonId: season.id,
    gameId,
    eventType: "game_result",
    beforeMu: 25,
    beforeSigma: 25 / 3,
    afterMu: 30,
    afterSigma: 7.5,
    ratingPolicyVersion: COMPETITION_RATING_POLICY_VERSION,
    revisionPolicyVersion: REVISION_POLICY_VERSION,
    evidence: { placement: 1, lobbySize: 4 },
    createdAt: "2026-07-10T19:00:00.000Z",
  });
  await closeSeason(testDb.db, season.id, "2026-07-10T20:00:00.000Z");
  await finalizeSeason(testDb.db, season.id, "2026-07-10T21:00:00.000Z");

  servers = await startTestServers({
    databaseUrl: testDb.databaseUrl,
    adminAddress: admin.wallet.address,
    jwtSecret: "e2e-test-jwt-secret",
  });
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => {
  if (browser) await closeBrowser(browser);
  if (servers) await stopTestServers(servers);
  if (testDb) destroyTestDb(testDb.databaseUrl);
});

describe("E2E: Dual Crown season surfaces", () => {
  test("renders public, owner, archive, receipt, and producer views at desktop and mobile widths", async () => {
    const webUrl = servers.webUrl!;
    const publicPage = await createAnonymousPage(browser, webUrl);
    const ownerPage = await createAuthenticatedPage(browser, adminJwt, webUrl, {
      privateKey: admin.wallet.privateKey,
    });

    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      await publicPage.setViewport(viewport);
      await assertRoute(publicPage, `${webUrl}/games/free?season=${seasonSlug}`, [
        "Browser QA Championship", "AGENT CHAMPION", "ARCHITECT CHAMPION", "Dual Crown sweep",
      ]);
      await assertRoute(publicPage, `${webUrl}/games/${gameSlug}`, [
        "Championship point receipts", "QA Champion", "Place 1 of 4", "120",
      ]);
      expect(await pageText(publicPage)).not.toContain("opponentRatings");

      await ownerPage.setViewport(viewport);
      await assertRoute(ownerPage, `${webUrl}/dashboard/agents/${agentId}?season=${seasonSlug}`, [
        "SEASON SUMMARY", "GAME RECEIPTS", "QA Champion", "Export JSON", "Export CSV",
      ]);
      await assertRoute(ownerPage, `${webUrl}/admin?tab=seasons`, [
        "Season operations", "New season name", "Browser QA Championship", "Pregame rating snapshots",
        "Receipt reproduction", "Revision classifier evidence",
      ]);
    }
  }, 120_000);
});

async function assertRoute(page: Page, url: string, expected: string[]): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  for (const text of expected) {
    try {
      await page.waitForFunction(
        `document.body.innerText.includes(${JSON.stringify(text)})`,
        { timeout: 30_000 },
      );
    } catch {
      throw new Error(`Route ${url} did not render ${JSON.stringify(text)}. Visible text:\n${await pageText(page)}`);
    }
  }
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
}

async function pageText(page: Page): Promise<string> {
  return page.evaluate("document.body.innerText") as Promise<string>;
}
