import { loadPayloads } from "../services/payload-storage.js";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Browser, Page } from "puppeteer";
import { schema } from "../db/index.js";
import { createCompletedCanonicalEventFixture, insertCanonicalEventRows, insertOwner } from "../__tests__/durable-run-test-utils.js";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";
import { recordCurrentLegalAcceptance } from "../services/legal-acceptance.js";
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
  rejectOptionalAnalytics,
} from "./test-browser.js";
import {
  createIsolatedTestDb,
  destroyIsolatedTestDb,
  type TestDB,
} from "./test-db.js";
import { startTestServers, stopTestServers, type TestServerHandles } from "./test-server.js";
import { cleanupE2eResources } from "./cleanup.js";
import {completedCurrentWerewolfFixture} from "@influence/engine/fixtures/werewolf-results";
import {chooseWerewolfAudience} from "./shared-watch-browser.js";

process.env.JWT_SECRET = "e2e-test-jwt-secret";

let testDb: TestDB;
let servers: TestServerHandles;
let browser: Browser;
let admin: AdminUserResult;
let adminJwt: string;
let agentId: string;
let gameSlug: string;
let seasonSlug: string;
let seasonId: string;

beforeAll(async () => {
  testDb = await createIsolatedTestDb();
  admin = await createAdminUser(testDb.db);
  await recordCurrentLegalAcceptance(
    testDb.db,
    admin.userId,
    "existing_account",
    "0123456789abcdef0123456789abcdef01234567",
  );
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
  const revision = (await loadPayloads(testDb.db.select().from(schema.agentRevisions)))
    .find((candidate) => candidate.agentProfileId === profile.id)!;

  const season = await createSeason(testDb.db, {
    slug: `browser-season-${randomUUID()}`,
    name: "Browser QA Championship",
    createdById: admin.userId,
  });
  seasonSlug = season.slug;
  seasonId = season.id;
  const gameId = randomUUID();
  gameSlug = `browser-rated-${gameId}`;
  await testDb.db.insert(schema.games).values({
    id: gameId,
    slug: gameSlug,
    config: JSON.stringify({
      modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" },
    }),
    status: "completed",
    trackType: "free",
    seasonId: season.id,
    minPlayers: 4,
    maxPlayers: 4,
    startedAt: "2026-07-10T18:30:00.000Z",
    endedAt: "2026-07-10T19:00:00.000Z",
  });
  await testDb.db.insert(schema.gameResults).values({
    id: randomUUID(),
    gameId,
    winnerId: null,
    roundsPlayed: 1,
    tokenUsage: JSON.stringify({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
    }),
    finishedAt: "2026-07-10T19:00:00.000Z",
  });
  const events = createCompletedCanonicalEventFixture(gameId);
  const ownerEpoch = await insertOwner(testDb.db, gameId, { status: "closed", lastPersistedEventSequence: events.length });
  await insertCanonicalEventRows(testDb.db, gameId, ownerEpoch, events);
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
  await cleanupE2eResources([
    ["browser", async () => { if (browser) await closeBrowser(browser); }],
    ["servers", async () => { if (servers) await stopTestServers(servers); }],
    ["database", async () => { if (testDb) await destroyIsolatedTestDb(testDb.databaseUrl); }],
  ]);
}, 60_000);

describe("E2E: Dual Crown season surfaces", () => {
  test("season replay keeps the chosen audience when changing games", async () => {
    for (const id of ["season-wolf-one","season-wolf-two"]) {
      const events = await completedCurrentWerewolfFixture(id,10);
      await testDb.db.insert(schema.games).values({id,slug:id,gameKind:"werewolf",status:"completed",trackType:"free",seasonId,maxPlayers:6,
        startedAt:"2026-07-10T18:30:00.000Z",endedAt:"2026-07-10T19:00:00.000Z",config:JSON.stringify({visibility:"public",preset:"one_wolf"})});
      await testDb.db.insert(schema.werewolfEvents).values(events.map(event => ({gameId:id,sequence:event.sequence,event})));
    }
    const page = await createAnonymousPage(browser,servers.webUrl!);
    const reads:string[] = [];
    page.on("request",request=>{if (request.url().includes("/watch?")) reads.push(request.url());});
    try {
      await page.setViewport({width:1440,height:1000});
      await page.goto(`${servers.webUrl}/seasons?season=${seasonSlug}`,{waitUntil:"domcontentloaded"});
      await page.waitForFunction(`Array.from(document.querySelectorAll('button')).some(button=>button.textContent.includes('season-wolf-one'))`);
      await page.evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('season-wolf-one')).click()`);
      expect(reads).toEqual([]);
      await page.click('[data-testid="season-player"] button[aria-label="Watch Omniscient"]');
      await page.waitForSelector('[data-testid="season-player"][data-audience="omniscient"] button[aria-label^="Viewing mode:"]',{timeout:15000});
      await page.waitForSelector('[data-testid="season-player"] [data-werewolf-opening]',{timeout:15000});
      await chooseWerewolfAudience(page,"mystery");
      await page.waitForSelector('[data-testid="season-player"][data-audience="mystery"]');
      await page.evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('season-wolf-two')).click()`);
      await page.waitForSelector('[data-testid="season-player"][data-audience="mystery"] button[aria-label^="Viewing mode:"]',{timeout:15000});
      expect(page.url()).toContain(`/seasons?season=${seasonSlug}`);
      await page.screenshot({path:"/tmp/season-replay-audience.png"});
    } finally {await page.close();}
  },120_000);
  test("renders public, owner, archive, receipt, and producer views at desktop and mobile widths", async () => {
    const webUrl = servers.webUrl!;
    const publicPage = await createAnonymousPage(browser, webUrl);
    await rejectOptionalAnalytics(publicPage);
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
      const standings = 'section[aria-label="Season standings"]';
      const agentsTab = `${standings} [role="tab"][aria-selected="true"]`;
      expect(await publicPage.$eval(`${standings} table`, table => table.scrollWidth <= table.clientWidth)).toBe(true);
      if (viewport.width === 390) {
        expect(await publicPage.evaluate(`document.querySelector(${JSON.stringify(standings + " table tbody")})?.innerText`)).toContain("1 win");
      }
      await publicPage.focus(agentsTab);
      await publicPage.keyboard.press("ArrowRight");
      expect(await publicPage.$eval(`${standings} [role="tab"][aria-selected="true"]`, tab => tab.textContent)).toBe("Architect Crown");
      await publicPage.keyboard.press("ArrowLeft");
      await publicPage.evaluate("document.activeElement?.blur()");
      await (await publicPage.waitForSelector(standings))?.screenshot({ path: `/tmp/house-season-standings-${viewport.width}.png` });
      await assertRoute(publicPage, `${webUrl}/games/${gameSlug}/results`, [
        "Championship point receipts", "QA Champion", "Place 1 of 4", "120",
      ]);
      expect(await pageText(publicPage)).not.toContain("opponentRatings");

      await ownerPage.setViewport(viewport);
      await assertRoute(ownerPage, `${webUrl}/dashboard/agents/${agentId}?season=${seasonSlug}`, [
        "SEASON SUMMARY", "GAME RECEIPTS", "QA Champion", "Export JSON", "Export CSV",
      ]);
      await assertRoute(ownerPage, `${webUrl}/admin/seasons`, [
        "Season operations", "New season name", "Browser QA Championship", "Pregame rating snapshots",
        "Receipt reproduction", "Revision classifier evidence",
      ]);
    }
  }, 120_000);

  test("shows public opening lineup and current enrollment with detailed eligibility in Admin", async () => {
    const active = await createSeason(testDb.db, { slug: "enrollment-qa", name: "Season 1" });
    const queuedAgentId = randomUUID();
    await testDb.db.insert(schema.agentProfiles).values({
      id: queuedAgentId, userId: admin.userId, name: "Enrollment QA", personality: "Patient.",
      fullBodyReferenceUrl: "/avatars/personas/full-body-v1/diplomat.webp",
    });
    await testDb.db.insert(schema.freeGameQueue).values({
      id: randomUUID(), userId: admin.userId, agentProfileId: queuedAgentId,
    });

    const webUrl = servers.webUrl!;
    const publicPage = await createAnonymousPage(browser, webUrl);
    const adminPage = await createAuthenticatedPage(browser, adminJwt, webUrl, { privateKey: admin.wallet.privateKey });
    await rejectOptionalAnalytics(publicPage);
    const enrollment = 'section[aria-label="Season enrollment"]';
    const eligibility = '[aria-label="Draw eligibility"]';
    const publicUrl = `${webUrl}/seasons?season=${active.slug}`;
    const adminUrl = `${webUrl}/admin/seasons`;

    try {
      await assertRoute(adminPage, adminUrl, ["Season enrollment", "Agents entered", "Seats per draw", "Next draw"]);
      expect(await adminPage.$(eligibility)).toBeNull();

      const busyGameId = randomUUID();
      await testDb.db.insert(schema.games).values({
        id: busyGameId, slug: busyGameId, status: "in_progress", trackType: "free", config: "{}",
      });
      await testDb.db.insert(schema.gamePlayers).values({
        id: randomUUID(), gameId: busyGameId, userId: admin.userId, agentProfileId: queuedAgentId,
        persona: JSON.stringify({ name: "Enrollment QA" }), agentConfig: "{}",
      });

      for (const width of [1440, 390]) {
        await publicPage.setViewport({ width, height: 900 });
        await adminPage.setViewport({ width, height: 900 });
        await assertRoute(publicPage, publicUrl, [
          "Season enrollment", "Agents entered", "Seats per draw", "Next draw",
          "Opening lineup", "0 / 12", "Enrollment QA", "Architect · E2E Admin", "Standings",
        ]);
        const card = `section[aria-labelledby="season-lineup-title"] a[href="/agents/${queuedAgentId}"]`;
        await publicPage.$eval(card, link => link.scrollIntoView({ block: "center" }));
        await publicPage.waitForFunction(`document.querySelector(${JSON.stringify(card + " img")})?.naturalWidth > 0`);
        expect(await publicPage.$(card + ' img[data-portrait="false"]')).not.toBeNull();
        expect(await publicPage.$('[aria-labelledby="season-watch-title"]')).toBeNull();
        await assertRoute(adminPage, adminUrl, ["Season enrollment", "Temporarily unavailable"]);
        expect(await publicPage.$(eligibility)).toBeNull();
        expect(await adminPage.$$eval(`${eligibility} dd`, values => values.map(value => value.textContent))).toEqual(["0", "1"]);

        for (const page of [publicPage, adminPage]) {
          expect(await page.$$eval(`${enrollment} dl:first-of-type dd`, values => values.slice(0, 2).map(value => value.textContent))).toEqual(["1", "12"]);
        }
        expect(await publicPage.$eval(`${enrollment} time`, time => time.getAttribute("datetime")))
          .toBe(await adminPage.$eval(`${enrollment} time`, time => time.getAttribute("datetime")));
      }

      await publicPage.focus(`section[aria-labelledby="season-lineup-title"] a[href="/agents/${queuedAgentId}"]`);
      await Promise.all([
        publicPage.waitForFunction(`location.pathname === "/agents/${queuedAgentId}"`),
        publicPage.keyboard.press("Enter"),
      ]);
      await publicPage.waitForFunction('document.querySelector("h1")?.textContent.includes("Enrollment QA")');

      const artwork = [
        "strategic", "observer", "social", "paranoid", "loyalist",
        "deceptive", "honest", "aggressive", "wildcard", "contrarian",
      ];
      for (const [index, archetype] of artwork.entries()) {
        const ownerId = randomUUID();
        const profileId = randomUUID();
        await testDb.db.insert(schema.users).values({ id: ownerId, displayName: `Architect ${index + 1}` });
        await testDb.db.insert(schema.agentProfiles).values({
          id: profileId, userId: ownerId, name: `Lineup Agent ${index + 1}`, personality: "Patient.",
          fullBodyReferenceUrl: `/avatars/personas/full-body-v1/${archetype}.webp`,
        });
        await testDb.db.insert(schema.freeGameQueue).values({
          id: randomUUID(), userId: ownerId, agentProfileId: profileId,
        });
      }
      for (const width of [1440, 390]) {
        await publicPage.setViewport({ width, height: 900 });
        await assertRoute(publicPage, publicUrl, ["Opening lineup", "10 / 12"]);
        await publicPage.$eval("#season-lineup-title", heading => heading.scrollIntoView({ block: "start" }));
        const bodyImages = 'section[aria-labelledby="season-lineup-title"] img[data-portrait="false"]';
        const loadedBodies = `Array.from(document.querySelectorAll('${bodyImages}')).filter(image => image.naturalWidth > 0).length`;
        await publicPage.waitForFunction(`${loadedBodies} >= 6`);
        await publicPage.$eval('section[aria-label="Season standings"]', standings => standings.scrollIntoView({ block: "end" }));
        await publicPage.waitForFunction(`${loadedBodies} === 11`);
        await publicPage.evaluate("window.scrollTo(0, 0)");
        await publicPage.screenshot({ path: `/tmp/house-season-${width}.png`, fullPage: true });
      }
      await publicPage.select('[aria-label="Choose a season"]', seasonSlug);
      await publicPage.waitForFunction('document.querySelector("#season-title")?.textContent === "Browser QA Championship"');
      expect(await publicPage.$(enrollment)).toBeNull();
      await adminPage.select("select", seasonId);
      await adminPage.waitForFunction('document.body.innerText.includes("Pregame rating snapshots")');
      expect(await adminPage.$(enrollment)).toBeNull();
    } finally {
      await publicPage.close();
      await adminPage.close();
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
