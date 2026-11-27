import { requestCharacterReference } from "../services/character-reference-jobs.js";
import {
  listAgentGenerations,
  cancelAgentGeneration,
} from "../services/agent-generations.js";
import { characterGenerationInput } from "../__tests__/character-generation-fixture.js";
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { mkdir } from "node:fs/promises";
import type { Browser, Page } from "puppeteer";
import { schema } from "../db/index.js";
import { processMockCharacterReference } from "../__tests__/character-generation-fixture.js";
import {
  createOwnedAgentProfile,
  updateOwnedAgentProfile,
} from "../services/agent-profile-management.js";
import { publishScreenedAgent } from "../services/agent-screening-publication.js";
import { createWerewolfLobby } from "../services/werewolf-lobbies.js";
import { recordCurrentLegalAcceptance } from "../services/legal-acceptance.js";
import {
  createAdminUser,
  createPlayerUser,
  type PlayerUserResult,
} from "./test-auth.js";
import {
  createAuthenticatedPage,
  launchBrowser,
  closeBrowser,
} from "./test-browser.js";
import {
  createIsolatedTestDb,
  destroyIsolatedTestDb,
  type TestDB,
} from "./test-db.js";
import {
  startTestServers,
  stopTestServers,
  type TestServerHandles,
} from "./test-server.js";
import { cleanupE2eResources } from "./cleanup.js";

let database: TestDB,
  servers: TestServerHandles,
  browser: Browser,
  owner: PlayerUserResult,
  agentId: string;
const proof = new URL("../../../../.renders/agent-workspace/", import.meta.url)
  .pathname;
const hydrationErrors: string[] = [];
beforeAll(async () => {
  process.env.JWT_SECRET = "agent-workspace-test-secret";
  database = await createIsolatedTestDb();
  const admin = await createAdminUser(database.db);
  owner = await createPlayerUser(database.db, 1);
  await recordCurrentLegalAcceptance(
    database.db,
    owner.userId,
    "existing_account",
    "0123456789abcdef0123456789abcdef01234567",
  );
  const body = await Bun.file(
    new URL(
      "../../../web/public/avatars/personas/full-body-v1/diplomat.webp",
      import.meta.url,
    ),
  ).bytes();
  const size = await sharp(body).metadata();
  const headPosition = {
    sourceUrl: "/avatars/personas/full-body-v1/diplomat.webp",
    sourceHash: createHash("sha256").update(body).digest("hex"),
    sourceWidth: size.width!,
    sourceHeight: size.height!,
    rect: { x: 0.35, y: 0.03, width: 0.3, height: 0.18 },
  };
  const created = await createOwnedAgentProfile(
    database.db,
    { userId: owner.userId },
    {
      name: "Mira Voss",
      gender: "female",
      personality: "Patient, observant, and quietly theatrical.",
      backstory: "A former stage magician.",
      strategyStyle: "Build trust through commitments.",
      werewolfStrategyStyle: "Test claims before voting.",
      avatarUrl: "/avatars/personas/diplomat.png",
      fullBodyReferenceUrl: "/avatars/personas/full-body-v1/diplomat.webp",
      headPosition,
    },
  );
  agentId = created.profile.id;
  await database.db
    .update(schema.agentScreenings)
    .set({ status: "completed", recommendation: "no_concern" })
    .where(
      eq(
        schema.agentScreenings.contentRevisionId,
        created.profile.latestContentRevisionId!,
      ),
    );
  await publishScreenedAgent(
    database.db,
    created.profile.latestContentRevisionId!,
  );
  servers = await startTestServers({
    databaseUrl: database.databaseUrl,
    adminAddress: admin.wallet.address,
    jwtSecret: process.env.JWT_SECRET,
    logDirectory: proof + "logs",
  });
  browser = await launchBrowser();
  browser.on("targetcreated", async (target) => {
    const page = await target.page();
    page?.on("console", (message) => {
      if (
        message.type() === "error" &&
        /hydration|cannot be a descendant|cannot contain a nested/i.test(
          message.text(),
        )
      )
        hydrationErrors.push(message.text());
    });
  });
  await mkdir(proof, { recursive: true });
}, 120_000);
afterAll(async () => {
  await cleanupE2eResources([
    [
      "browser",
      async () => {
        if (browser) await closeBrowser(browser);
      },
    ],
    [
      "servers",
      async () => {
        if (servers) await stopTestServers(servers);
      },
    ],
    [
      "database",
      async () => {
        if (database) await destroyIsolatedTestDb(database.databaseUrl);
      },
    ],
  ]);
}, 60_000);
afterEach(async () => {
  for (const row of await listAgentGenerations(database.db, owner.userId))
    await cancelAgentGeneration(database.db, owner.userId, row.id, row.source);
  // A failed journey must not leave an account draft for the next journey.
  await database.db
    .delete(schema.agentEditorDrafts)
    .where(eq(schema.agentEditorDrafts.userId, owner.userId));
  expect(hydrationErrors.splice(0)).toEqual([]);
});
async function button(page: Page, label: string) {
  const selector = `[...([...document.querySelectorAll("dialog[open]")].at(-1)??document.querySelector('[role="dialog"][aria-modal="true"]')??document).querySelectorAll("button")].find(button=>(button.textContent?.trim()===${JSON.stringify(label)}||button.getAttribute("aria-label")===${JSON.stringify(label)})&&!button.matches(":disabled")&&button.checkVisibility())`;
  try {
    await page.waitForFunction(selector);
  } catch (error) {
    await page.screenshot({
      path:
        proof +
        "failure-" +
        label.toLowerCase().replace(/[^a-z]/g, "") +
        ".png",
      fullPage: true,
    });
    throw new Error(
      `Button ${label} unavailable: ${await page.$eval("body", (element) => element.innerText)}`,
      { cause: error },
    );
  }
  await page.evaluate(selector + ".click()");
}

test.each(["automatic", "manual", "adjusted"] as const)("entry artwork %s portrait reaches the original lobby after review", async (mode) => {
  const detectsHead = mode !== "manual";
  const name = `Vera Calder ${mode}`;
  const created = await createOwnedAgentProfile(database.db, { userId: owner.userId }, {
    name,
    gender: "female",
    personality: "Patient and observant.",
    avatarUrl: "/avatars/personas/diplomat.png",
  });
  async function publish(revisionId: string) {
    await database.db.update(schema.agentScreenings)
      .set({ status: "completed", recommendation: "no_concern" })
      .where(eq(schema.agentScreenings.contentRevisionId, revisionId));
    await publishScreenedAgent(database.db, revisionId);
  }
  await publish(created.profile.latestContentRevisionId!);
  const lobby = await createWerewolfLobby(database.db, owner.userId, { preset: "two_wolves" });
  const url = servers.webUrl + `/agents/prepare?flow=join_game&gameId=${lobby.id}&agentId=${created.profile.id}`;
  const page = await createAuthenticatedPage(browser, owner.jwt, url, { privateKey: owner.wallet.privateKey });
  let manualCrops = 0;
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/agent-profiles/portrait-crop") manualCrops++;
  });
  const primaryAction = detectsHead ? "Save image & join" : "Set portrait";
  try {
    const focused = '[data-entry-artwork="true"]';
    await page.waitForSelector(focused, { visible: true });
    for (const viewport of [{ width: 1690, height: 957 }, { width: 320, height: 820 }]) {
      await page.setViewport(viewport);
      await page.evaluate("document.fonts.ready");
      expect(await page.$eval(focused, element => {
        const back = element.querySelector('nav button')!;
        const heading = element.querySelector('section h1')!;
        const artwork = element.querySelector('aside')!;
        return heading.getBoundingClientRect().top > back.getBoundingClientRect().bottom + 16
          && !artwork.checkVisibility()
          && element.getBoundingClientRect().height < 580
          && element.ownerDocument.documentElement.scrollWidth <= element.ownerDocument.defaultView!.innerWidth;
      })).toBe(true);
      await page.screenshot({ path: proof + `entry-artwork-${mode}-${viewport.width}.png`, fullPage: true });
    }
    expect(await page.$('input[type="file"]')).toBeNull();
    const queued = page.waitForResponse(response =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/agent-profiles/visual-reference",
    );
    await button(page, "Generate image");
    expect((await queued).ok()).toBe(true);
    await page.waitForSelector('[data-image-updating="true"]');
    expect(await page.$('[data-image-updating="true"] [aria-hidden="true"]')).not.toBeNull();
    await processMockCharacterReference(database.db, await Bun.file(
      new URL("../../../web/public/avatars/personas/full-body-v1/diplomat.webp", import.meta.url),
    ).bytes(), false, detectsHead);
    await page.waitForSelector('img[alt="New artwork candidate"]', { visible: true });
    const headshot = `img[alt="${name} headshot preview"]`;
    if (detectsHead) await page.waitForFunction(`document.querySelector(${JSON.stringify(headshot)})?.naturalWidth > 0`);
    else expect(await page.$(headshot)).toBeNull();
    expect(await page.$('dialog[open]')).toBeNull();
    for (const viewport of [{ width: 1295, height: 945 }, { width: 1280, height: 700 }, { width: 320, height: 820 }]) {
      await page.setViewport(viewport);
      await page.evaluate("window.scrollTo(0, 0)");
      await page.screenshot({ path: proof + `entry-candidate-${mode}-${viewport.width}x${viewport.height}.png`, fullPage: true });
      expect(await page.$eval(focused, (element, action, headshotSelector) => {
        const image = element.querySelector('img[alt="New artwork candidate"]')!;
        const headshotPreview = element.querySelector(headshotSelector);
        const useImage = [...element.querySelectorAll('button')].find(button => button.textContent?.trim() === action)!;
        const discard = [...element.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Discard' && button.checkVisibility())!;
        const actions = [useImage, discard];
        if (headshotPreview) actions.push([...element.querySelectorAll('button')]
          .find(button => button.textContent?.trim() === 'Adjust portrait' && button.checkVisibility())!);
        const viewport = element.ownerDocument.defaultView!;
        const imageBottom = image.getBoundingClientRect().bottom;
        return {
          actionsClickable: actions.every(button => {
            const rect = button.getBoundingClientRect();
            const hit = element.ownerDocument.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return button.checkVisibility() && rect.top >= 0 && rect.bottom <= viewport.innerHeight
              && Boolean(hit && button.contains(hit));
          }),
          imageContained: imageBottom <= element.getBoundingClientRect().bottom,
          mobileImageBeforeActions: viewport.innerWidth > 700 || imageBottom < useImage.getBoundingClientRect().top,
          fitsWidth: element.ownerDocument.documentElement.scrollWidth <= viewport.innerWidth,
          headshotBesideBody: Boolean(headshotPreview && headshotPreview.checkVisibility() &&
            headshotPreview.getBoundingClientRect().left >= image.getBoundingClientRect().right),
        };
      }, primaryAction, headshot)).toEqual({
        actionsClickable: true, imageContained: true, mobileImageBeforeActions: true,
        fitsWidth: true, headshotBesideBody: detectsHead,
      });
    }
    if (mode !== "automatic") {
      await button(page, detectsHead ? "Adjust portrait" : primaryAction);
      const portraitEditor = await page.waitForSelector('dialog[open]');
      const dialogText = await portraitEditor!.evaluate(editor => editor.textContent);
      expect(dialogText).toContain(detectsHead ? "Check the gold head box" : "Automatic head detection couldn’t locate a head.");
      await page.waitForSelector('[aria-label="Head box; drag to move"]', { visible: true });
      await page.waitForSelector('[aria-label="Portrait box; drag to move"]', { visible: true });
      if (detectsHead) {
        await button(page, "Close");
        await page.waitForSelector(headshot, { visible: true });
        expect(await page.$eval('main button[type="submit"]:not([disabled])', button => button.textContent)).toBe("Save image & join");
        await button(page, "Adjust portrait");
      }
      await button(page, "Confirm");
      await page.waitForSelector(headshot, { visible: true });
    }
    await button(page, "Save image & join");
    await page.waitForFunction('document.querySelector("main h1")?.textContent === "Waiting for approval"');
    expect(manualCrops).toBe(mode === "automatic" ? 0 : 1);
    expect(await database.db.select().from(schema.werewolfLobbySeats)
      .where(eq(schema.werewolfLobbySeats.gameId, lobby.id))).toHaveLength(0);
    const [submitted] = await database.db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, created.profile.id));
    await publish(submitted!.latestContentRevisionId!);
    await page.waitForFunction(`location.pathname === ${JSON.stringify(`/games/${lobby.slug}`)}`);
    const [seat] = await database.db.select().from(schema.werewolfLobbySeats)
      .where(eq(schema.werewolfLobbySeats.gameId, lobby.id));
    expect(seat?.agentProfileId).toBe(created.profile.id);
    const [published] = await database.db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, created.profile.id));
    expect(published?.headPosition?.confirmation?.userId).toBe(owner.userId);
    expect(published?.fullBodyReferenceUrl).toBeTruthy();
    expect(published?.portraitCrop?.sourceUrl).toBe(published?.fullBodyReferenceUrl ?? undefined);
  } finally {
    await page.close();
  }
}, 60_000);

test("management image and name open the public profile and editing returns to its agent", async () => {
  const page = await createAuthenticatedPage(browser, owner.jwt, servers.webUrl + "/dashboard/agents", { privateKey: owner.wallet.privateKey });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(String(error)));
  try {
    const agentPath = `/agents/${agentId}`;
    const collectionPath = `/dashboard/agents?at=${agentId}`;
    const selector = `#agent-${agentId} a[href="${agentPath}"]`;
    await page.goto(servers.webUrl + `/dashboard/agents?attention=1&q=Mira&at=${agentId}`);
    await page.waitForFunction('!new URL(location.href).searchParams.has("attention")');
    expect(new URL(page.url()).searchParams.get("q")).toBe("Mira");
    expect(new URL(page.url()).searchParams.get("at")).toBe(agentId);
    expect(await page.$$eval('main button', elements => elements.some(element => element.textContent?.trim() === "Needs attention"))).toBe(false);
    await page.goto(servers.webUrl + "/dashboard/agents");
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
      await page.setViewport(viewport);
      for (const target of ["img", "h3"]) {
        await page.waitForSelector(`${selector} ${target}`);
        expect(await page.$('main header button[aria-label="Activity"]')).toBeNull();
        expect(await page.$('main header a[href="/agents/create"]')).toBeNull();
        expect(await page.$("main aside")).toBeNull();
        expect(await page.$eval(`#agent-${agentId}`, element => {
          const grid = element.parentElement!.getBoundingClientRect();
          const header = element.ownerDocument.querySelector("main h1")!.closest("header")!.getBoundingClientRect();
          return Math.abs(grid.left - header.left) < 1 && Math.abs(grid.width - header.width) < 1;
        })).toBe(true);
        expect(await page.$$(selector)).toHaveLength(1);
        expect(await page.$$eval(`#agent-${agentId} a, #agent-${agentId} button`, elements => elements.some(element => element.textContent?.trim() === "View"))).toBe(false);
        expect(await page.$(`#agent-${agentId} button[aria-label="Edit Mira Voss"]`)).not.toBeNull();
        expect(await page.$(`#agent-${agentId} button[aria-label="Share Mira Voss profile"]`)).not.toBeNull();
        expect(await page.$eval(`#agent-${agentId}`, element => {
          const heading = element.querySelector("h3")!.getBoundingClientRect();
          const picture = element.querySelector("a")!.getBoundingClientRect();
          const metadata = element.querySelector('[aria-label="Agent details"]')!.getBoundingClientRect();
          const actions = element.querySelector("button")!.getBoundingClientRect();
          return heading.top >= picture.top && metadata.bottom <= picture.bottom && actions.top > picture.bottom;
        })).toBe(true);
        expect(await page.$(`#agent-${agentId} details`)).toBeNull();
        expect(await page.$eval(`#agent-${agentId} a[aria-label="Analyze Mira Voss"]`, element => element.getAttribute("href"))).toBe(`/dashboard/agents/${agentId}`);
        await page.click(`${selector} ${target}`);
        await page.waitForFunction('document.querySelector("h1")?.textContent === "Mira Voss"');
        expect(new URL(page.url()).pathname).toBe(agentPath);
        expect(await page.$eval("main", element => element.textContent)).not.toContain("Patient, observant, and quietly theatrical.");
        await page.waitForSelector('main button[aria-label="Share Mira Voss profile"]:enabled', { visible: true });
        await page.waitForSelector('#profile-agent-request', { visible: true });
        if (target === "img") await page.screenshot({ path: proof + `public-profile-${viewport.width}.png`, fullPage: true });
        await page.goBack({ waitUntil: "domcontentloaded" });
        await page.waitForSelector(selector);
      }
      await page.screenshot({ path: proof + `management-profile-link-${viewport.width}.png`, fullPage: true });
    }
    await page.click(`#agent-${agentId} button[aria-label="Edit Mira Voss"]`);
    await page.waitForSelector('[data-agent-workspace]', { visible: true });
    const editorUrl = new URL(page.url());
    expect(editorUrl.pathname).toBe(`/dashboard/agents/${agentId}/edit`);
    expect(editorUrl.searchParams.get("returnTo")).toBe(collectionPath);
    await page.click(`nav[aria-label="Breadcrumb"] a[href="${collectionPath}"]`);
    await page.waitForSelector(selector);
    const beforeArchive = await page.$eval(`#agent-${agentId}`, element => ({ top: element.getBoundingClientRect().top, height: element.getBoundingClientRect().height }));
    await page.click(`#agent-${agentId} button[aria-label="Archive Mira Voss"]`);
    await page.waitForSelector('dialog[open][aria-label="Archive Mira Voss?"]');
    expect(await page.$$eval('dialog[open] button', elements => elements.map(element => element.textContent?.trim()))).toEqual(["Cancel", "Archive"]);
    expect(await page.$eval(`#agent-${agentId}`, element => ({ top: element.getBoundingClientRect().top, height: element.getBoundingClientRect().height }))).toEqual(beforeArchive);
    await button(page, "Cancel");
    await page.waitForFunction('!document.querySelector("dialog[open]")');
    expect(await page.evaluate('document.activeElement?.getAttribute("aria-label")')).toBe("Archive Mira Voss");
    let archiveRequests = 0;
    await page.setRequestInterception(true);
    page.on("request", request => {
      if (new URL(request.url()).pathname === `/api/agent-profiles/${agentId}` && request.method() === "DELETE") {
        archiveRequests++;
        void request.respond({
          status: archiveRequests < 3 ? 409 : 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": servers.webUrl!, "Access-Control-Allow-Credentials": "true" },
          body: JSON.stringify(archiveRequests < 3 ? { error: "This agent is in a game." } : { ok: true }),
        });
      } else void request.continue();
    });
    await page.click(`#agent-${agentId} button[aria-label="Archive Mira Voss"]`);
    await button(page, "Archive");
    await page.waitForSelector('dialog[open] [role="alert"]');
    expect(await page.$eval('dialog[open] [role="alert"]', element => element.textContent)).toBe("This agent is in a game.");
    expect(await page.$('main header button[aria-label="Activity"]')).toBeNull();
    await button(page, "Cancel");
    await page.click(`#agent-${agentId} button[aria-label="Archive Mira Voss"]`);
    expect(await page.$('dialog[open] [role="alert"]')).toBeNull();
    await button(page, "Archive");
    await page.waitForSelector('dialog[open] [role="alert"]');
    await button(page, "Archive");
    await page.waitForFunction('!document.querySelector("dialog[open]")');
    expect(archiveRequests).toBe(3);
    expect(await page.$('main header button[aria-label="Activity"]')).toBeNull();
    await page.focus(selector);
    expect(await page.$eval(selector, element => element === element.ownerDocument.activeElement)).toBe(true);
    await page.keyboard.press("Enter");
    await page.waitForFunction('document.querySelector("h1")?.textContent === "Mira Voss"');
    expect(new URL(page.url()).pathname).toBe(agentPath);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}, 60_000);

test("management badges fit the artwork in every activity state without moving actions", async () => {
  const response = await fetch(servers.apiUrl + "/api/agent-profiles", {
    headers: { Authorization: `Bearer ${owner.jwt}` },
  });
  expect(response.ok).toBe(true);
  const baseline = (await response.json() as Array<Record<string, unknown>>).find(agent => agent.id === agentId)!;
  const variants = [
    { name: "Professor Mara Tideglass of the Western Lighthouse", personaKey: "diplomat", voiceId: "carina", modelPreference: { catalogId: "meta-muse:muse-spark-1.3-contributor" }, expectedStatus: null },
    { name: "Generating", visualActivity: { status: "processing", stage: "image" }, expectedStatus: "Generating image" },
    { name: "Reviewing changes", reviewState: "reviewing", expectedStatus: "Reviewing" },
    { name: "Held changes", reviewState: "held", expectedStatus: "Held for moderation" },
    { name: "Artwork", visualActivity: { status: "ready", stage: "ready" }, expectedStatus: "Artwork ready" },
    { name: "Failed", visualActivity: { status: "failed", stage: "image" }, expectedStatus: "Image failed" },
    { name: "First image", fullBodyReferenceUrl: null, transparentBodyUrl: null, avatarUrl: null, contentRevisionId: null, visualActivity: { status: "queued", stage: "waiting" }, expectedStatus: "Queued" },
    { name: "Missing image", fullBodyReferenceUrl: null, transparentBodyUrl: null, expectedStatus: "Full-body image missing" },
    { name: "Reviewing new agent", reviewState: "reviewing", contentRevisionId: null, expectedStatus: "Reviewing" },
    { name: "Image conflict", visualActivity: { status: "conflict", stage: "ready" }, expectedStatus: "Artwork needs review" },
  ];
  const fixtures = variants.map(({ expectedStatus: _expectedStatus, ...variant }) => {
    const id = crypto.randomUUID();
    return {
      ...baseline, reviewState: "accepted" as const, visualActivity: null, ...variant,
      id, profileHref: variant.contentRevisionId === null ? null : `/agents/${id}`,
    };
  });
  const page = await createAuthenticatedPage(browser, owner.jwt, servers.webUrl + "/dashboard/agents", { privateKey: owner.wallet.privateKey });
  try {
    await page.setRequestInterception(true);
    page.on("request", request => {
      if (new URL(request.url()).pathname === "/api/agent-profiles" && request.method() === "GET") {
        void request.respond({
          status: 200, contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": servers.webUrl!, "Access-Control-Allow-Credentials": "true" },
          body: JSON.stringify(fixtures),
        });
      } else void request.continue();
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(`#agent-${fixtures.at(-1)!.id}`);
    expect(await page.$$eval('main button', elements => elements.some(element => element.textContent?.trim() === "Needs attention"))).toBe(true);
    await page.waitForFunction('Array.from(document.querySelectorAll("article img")).every(image => image.complete && image.naturalWidth > 0)');
    for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 320, height: 844 }]) {
      await page.setViewport(viewport);
      await page.evaluate("document.fonts.ready");
      expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
      const geometry = await page.$$eval('article[id^="agent-"]', elements => elements.map(element => {
        const picture = element.querySelector("a")!.getBoundingClientRect();
        const heading = element.querySelector("h3")!.getBoundingClientRect();
        const image = element.querySelector("img")!.getBoundingClientRect();
        const badges = Array.from(element.querySelector('[aria-label="Agent details"]')!.children as ArrayLike<typeof element>).map(badge => badge.getBoundingClientRect());
        const actions = Array.from(element.querySelectorAll(":scope > div > button, :scope > div > a.action") as ArrayLike<typeof element>).map(action => action.getBoundingClientRect());
        const inside = (rect: { left: number; right: number; top: number; bottom: number }) => rect.left >= picture.left && rect.right <= picture.right && rect.top >= picture.top && rect.bottom <= picture.bottom;
        return {
          height: element.getBoundingClientRect().height, pictureHeight: picture.height,
          allTextInside: [heading, ...badges].every(inside), imageInside: inside(image),
          imageBelowName: image.top >= heading.bottom,
          onlyActionsBelow: element.children.length === 2 && actions.every(rect => rect.top > picture.bottom),
          actionsAligned: actions.every(rect => rect.top === actions[0]!.top),
          labelsFit: Array.from(element.querySelectorAll('h3, [aria-label="Agent details"] > span') as ArrayLike<typeof element>).every(badge => badge.scrollWidth <= badge.clientWidth + 1),
        };
      }));
      expect(geometry).toHaveLength(fixtures.length);
      for (const card of geometry) {
        expect(card.pictureHeight).toBe(380);
        expect(card.height).toBe(geometry[0]!.height);
        expect(card.allTextInside).toBe(true);
        expect(card.imageInside).toBe(true);
        expect(card.imageBelowName).toBe(true);
        expect(card.onlyActionsBelow).toBe(true);
        expect(card.actionsAligned).toBe(true);
        expect(card.labelsFit).toBe(true);
      }
      await page.screenshot({ path: proof + `management-badges-${viewport.width}.png`, fullPage: true });
    }
    for (const [index, fixture] of fixtures.entries()) {
      const card = `#agent-${fixture.id}`;
      const href = await page.$eval(`${card} > a`, element => element.getAttribute("href")!);
      expect(new URL(href, page.url()).pathname).toBe(fixture.profileHref ?? `/dashboard/agents/${fixture.id}/edit`);
      expect(await page.$(`${card} button[aria-haspopup="dialog"]`) !== null).toBe(Boolean(fixture.profileHref));
      const status = await page.$(`${card} > a [role="status"]`);
      if (variants[index]!.expectedStatus === null) expect(status).toBeNull();
      else expect(await status!.evaluate(element => element.textContent)).toContain(variants[index]!.expectedStatus!);
    }
    expect(await page.$eval(`#agent-${fixtures[0]!.id} [aria-label="Agent details"]`, element => element.textContent)).toContain("CarinaF");
    expect(await page.$eval(`#agent-${fixtures[2]!.id} > a [role="status"]`, element => element.textContent)).toContain("Still usable");
    expect(await page.$eval(`#agent-${fixtures[8]!.id} > a [role="status"]`, element => element.textContent)).not.toContain("Still usable");
    expect(await page.$(`#agent-${fixtures[2]!.id} [data-image-updating="true"]`)).toBeNull();
    const active = `#agent-${fixtures[1]!.id} [data-image-updating="true"]`;
    expect(await page.$(active)).not.toBeNull();
    const animation = () => page.$eval(`${active} > div > span[aria-hidden="true"]`, element => element.ownerDocument.defaultView!.getComputedStyle(element, "::after").animationName);
    expect(await animation()).not.toBe("none");
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    expect(await animation()).toBe("none");
  } finally {
    await page.close();
  }
}, 60_000);

test("Guided field readers and identity editors preserve draft intent and focus", async () => {
  const page = await createAuthenticatedPage(browser, owner.jwt,
    servers.webUrl + `/dashboard/agents/${agentId}/edit?profileRequest=1`,
    { privateKey: owner.wallet.privateKey });
  const longBackstory = "Nori repairs antique radios on a floating night market.\n\n" + "Rain rattles the lanterns while Nori listens for lost signals. ".repeat(18) + "The last sentence is visible in full.";
  let providerCalls = 0;
  const uiErrors: string[] = [];
  page.on("console", message => {
    // This harness authenticates with a local JWT and deliberately has no real Privy app.
    if (message.type() === "error" && message.location().url !== "https://auth.privy.io/api/v1/apps/e2e-test-privy-app-id-001") {
      uiErrors.push(message.text() + " " + message.location().url);
    }
  });
  page.on("pageerror", error => uiErrors.push(String(error)));
  page.on("request", request => {
    if (request.method() === "POST" && /\/(generate|creation-assistant|edit-assistant|character-reference-jobs)$/.test(new URL(request.url()).pathname)) providerCalls++;
  });
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await page.waitForSelector("#agent-creation-message", { visible: true });
    await button(page, "Advanced");
    await fill(page, "#agent-backstory", longBackstory);
    await button(page, "Guided");
    await page.evaluate("document.fonts.ready");
    const before = await editorPositions(page);
    await page.hover('[aria-label="Revise Backstory"]');
    expect(await page.$('[role="tooltip"]')).toBeNull();
    await page.waitForSelector('[role="tooltip"]', { visible: true });
    expect(await page.$eval('[role="tooltip"]', element => element.textContent)).toContain(longBackstory);
    expectSamePositions(before, await editorPositions(page));
    await page.screenshot({ path: proof + "guided-field-hover-1440.png", fullPage: false });
    await page.setViewport({ width: 1280, height: 650 });
    await page.hover('[aria-label="Revise Backstory"]');
    await page.waitForFunction('(()=>{const e=document.querySelector(\'[role="tooltip"]\');if(!e)return false;const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;})()');
    await page.setViewport({ width: 1440, height: 900 });
    await page.click('[aria-label="View full Backstory"]');
    await page.waitForSelector('dialog[open][aria-label="Backstory"]');
    expect(await page.$eval('dialog[open]', element => element.textContent)).toContain(longBackstory);
    expect(await page.$('[aria-label="Selected sections"]')).toBeNull();
    expect(await page.$('[role="tooltip"]')).toBeNull();
    await page.screenshot({ path: proof + "guided-field-reader-1440.png", fullPage: false });
    await button(page, "Close");
    expect(await page.evaluate('document.activeElement?.getAttribute("aria-label")')).toBe("View full Backstory");
    await page.click('[aria-label="Revise Backstory"]');
    expect(await page.$eval('[aria-label="Selected sections"]', element => element.textContent)).toContain(longBackstory);
    expect(await page.evaluate('document.activeElement?.id')).toBe("agent-creation-message");
    await button(page, "Remove change Backstory");
    await page.click('[aria-label="Edit Name"]');
    await page.waitForSelector('dialog[open] input[aria-label="Name"]');
    expect(await page.evaluate('document.activeElement?.getAttribute("aria-label")')).toBe("Name");
    await page.waitForFunction('document.querySelector("dialog[open]")?.style.opacity === "1"');
    expect(await page.evaluate('(()=>{const field=document.querySelector(\'[aria-label="Edit Name"]\').parentElement.getBoundingClientRect();const modal=document.querySelector("dialog[open]").getBoundingClientRect();return Math.min(Math.abs(modal.top-field.bottom),Math.abs(modal.bottom-field.top));})()')).toBeLessThanOrEqual(12);
    await fill(page, 'dialog[open] input', "Unsaved name");
    await button(page, "Cancel");
    expect(await page.$eval('[aria-label="Revise Name"]', element => element.textContent)).toContain("Mira Voss");
    await page.click('[aria-label="Edit Name"]');
    await fill(page, 'dialog[open] input', "Mira Guided Draft");
    for (const width of [1440, 390, 320]) {
      await page.setViewport({ width, height: 900 });
      await page.waitForFunction('(()=>{const r=document.querySelector("dialog[open]").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()');
      expect(await page.$eval('dialog[open]', element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: proof + `guided-name-editor-${width}.png`, fullPage: false });
    }
    await page.keyboard.press("Enter");
    expect(await page.$eval('[aria-label="Revise Name"]', element => element.textContent)).toContain("Mira Guided Draft");
    expect(await page.$('[aria-label="Review changes"]')).toBeNull();
    await page.click('[aria-label="Edit Archetype"]');
    await page.click('dialog[open] button[aria-haspopup="listbox"]');
    await page.waitForSelector('dialog[open] [role="option"]');
    expect(await page.$eval('dialog[open] [role="listbox"]', element => element.getBoundingClientRect().height)).toBeGreaterThan(250);
    await page.screenshot({ path: proof + "guided-archetype-editor-320.png", fullPage: false });
    const pickDeceiver = async () => {
      for (const option of await page.$$('dialog[open] [role="option"]')) {
        if (await option.evaluate(element => element.textContent?.includes("Deceiver"))) {
          await option.click();
          return;
        }
      }
      throw new Error("Deceiver option unavailable");
    };
    await pickDeceiver();
    await button(page, "Cancel");
    expect(await page.$eval('[aria-label="Revise Archetype"]', element => element.textContent)).not.toContain("Deceiver");
    await page.click('[aria-label="Edit Archetype"]');
    await page.click('dialog[open] button[aria-haspopup="listbox"]');
    await pickDeceiver();
    await button(page, "OK");
    expect(await page.$eval('[aria-label="Revise Archetype"]', element => element.textContent)).toContain("Deceiver");
    await page.setViewport({ width: 390, height: 844 });
    await fill(page, "#agent-creation-message", "Keep the lighthouse backstory.");
    await page.click('[aria-label="Edit Name"]');
    await fill(page, 'dialog[open] input', "Another unsaved name");
    await button(page, "Change Name with AI");
    await page.waitForSelector('[aria-label="Selected sections"]');
    await page.waitForFunction('document.activeElement?.id === "agent-creation-message"');
    expect(await page.$eval('[aria-label="Selected sections"]', element => element.textContent)).toContain("Mira Guided Draft");
    expect(await page.$eval('#agent-creation-message', element => element.value)).toBe("Keep the lighthouse backstory.");
    expect(await page.$eval('[aria-label="Revise Name"]', element => element.textContent)).not.toContain("Another unsaved name");
    await button(page, "Advanced");
    expect(await page.$eval('#agent-name', element => element.value)).toBe("Mira Guided Draft");
    expect(await page.$eval('#agent-archetype', element => element.textContent)).toContain("Deceiver");
    expect(providerCalls).toBe(0);
    expect(uiErrors).toEqual([]);
    await button(page, "Cancel");
    await button(page, "Discard");
  } finally {
    await page.close();
  }
}, 60_000);

test("management → Edit → Guided/Advanced → review → Reviewing preserves the public version", async () => {
  const page = await createAuthenticatedPage(
    browser,
    owner.jwt,
    servers.webUrl + "/dashboard/agents",
    { privateKey: owner.wallet.privateKey },
  );
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  try {
    await page.waitForFunction('document.body.innerText.includes("Mira Voss")');
    await page.screenshot({ path: proof + "management.png", fullPage: true });
    await button(page, "Edit");
    await page.waitForSelector("#agent-personality");
    for (const mode of ["Advanced", "Guided"]) {
      await button(page, mode);
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 1280, height: 800 },
        { width: 768, height: 1024 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewport(viewport);
        await page.screenshot({
          path: proof + `edit-${mode.toLowerCase()}-${viewport.width}.png`,
          fullPage: true,
        });
        expect(
          await page.evaluate(
            "document.documentElement.scrollWidth<=innerWidth",
          ),
        ).toBe(true);
        if (viewport.width >= 1280)
          expect(
            await page.evaluate(
              '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review").getBoundingClientRect().bottom <= innerHeight',
            ),
          ).toBe(true);
      }
    }
    await page.setViewport({ width: 1440, height: 900 });
    await button(page, "Advanced");
    await page.evaluate(
      'const input=document.querySelector("#agent-personality");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,"A skeptical magician who asks precise questions.");input.dispatchEvent(new Event("input",{bubbles:true}));',
    );
    await button(page, "Refine Personality");
    await page.waitForFunction(
      'document.activeElement?.id === "agent-creation-message"',
    );
    expect(await page.$("dialog[open]")).toBeNull();
    expect(
      await page.$eval(
        '[aria-label="Selected sections"]',
        (element) => element.textContent,
      ),
    ).toContain("A skeptical magician who asks precise questions.");
    await page.screenshot({
      path: proof + "refine-direct.png",
      fullPage: true,
    });
    await button(page, "Remove change Character prompt");
    await button(page, "Advanced");
    await button(page, "Refine Personality");
    await page.waitForFunction(
      'document.activeElement?.id === "agent-creation-message"',
    );
    await page.click('input[type="radio"][value="male"]');
    expect(
      await page.$eval(
        'input[type="radio"][value="male"]',
        (element) => (element as unknown as { checked: boolean }).checked,
      ),
    ).toBe(true);
    await page.click('input[type="radio"][value="female"]');
    await button(page, "Revise");
    await page.waitForFunction(
      'document.activeElement?.id === "agent-creation-message"',
    );
    expect(
      await page.$eval(
        '[aria-label="Selected sections"]',
        (element) => element.textContent,
      ),
    ).toContain("Appearance");
    expect(await page.$("dialog[open]")).toBeNull();
    await button(page, "Advanced");
    await page.focus('[role="tab"][aria-selected="true"]');
    await page.keyboard.press("ArrowRight");
    expect(
      await page.$eval('[role="tabpanel"]', (element) =>
        element.getAttribute("aria-labelledby"),
      ),
    ).toBe("agent-tab-strategy");
    await page.screenshot({
      path: proof + "connected-tabs.png",
      fullPage: true,
    });
    await page.keyboard.press("Home");
    expect(
      await page.$eval(
        "#agent-personality",
        (element) => (element as unknown as { value: string }).value,
      ),
    ).toBe("A skeptical magician who asks precise questions.");
    await button(page, "Review");
    await page.waitForFunction(
      'document.body.innerText.includes("Review changes")',
    );
    expect(
      await page.$eval("body", (element) => element.textContent),
    ).toContain("Patient, observant, and quietly theatrical.");
    await page.screenshot({ path: proof + "review.png", fullPage: true });
    await button(page, "Save");
    await page.waitForFunction(
      'location.pathname==="/dashboard/agents"&&document.body.innerText.includes("Reviewing")',
    );
    const [profile] = await database.db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, agentId));
    expect(profile!.personality).toBe(
      "Patient, observant, and quietly theatrical.",
    );
    expect(profile!.latestContentRevisionId).not.toBe(
      profile!.contentRevisionId,
    );
    await page.screenshot({ path: proof + "reviewing.png", fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({
      path: proof + "management-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        "document.documentElement.scrollWidth<=window.innerWidth",
      ),
    ).toBe(true);
  } finally {
    await page.close();
  }
}, 120_000);

async function fill(page: Page, selector: string, value: string) {
  await page.evaluate(
    `{const field=document.querySelector(${JSON.stringify(selector)});const prototype=field.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,"value").set.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event("input",{bubbles:true}));}`,
  );
}
test("Advanced creation saves voice and ready artwork directly from review", async () => {
  const page = await createAuthenticatedPage(
    browser,
    owner.jwt,
    servers.webUrl + "/agents/create",
    { privateKey: owner.wallet.privateKey },
  );
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  try {
    await button(page, "Advanced");
    await page.waitForSelector("#agent-name", { visible: true });
    await fill(page, "#agent-name", "Arden Workshop");
    await fill(page, "#agent-personality", "A precise, patient investigator.");
    await button(page, "Non-binary");
    await page.focus('[aria-haspopup="listbox"][aria-labelledby*="-label"]');
    await page.keyboard.press("Space");
    await page.waitForSelector('[role="option"]');
    await page.screenshot({
      path: proof + "archetype-picker.png",
      fullPage: true,
    });
    await page.keyboard.type("Strategist");
    await page.waitForFunction(
      'document.activeElement?.getAttribute("role")==="option" && document.activeElement.textContent.includes("Strategist")',
    );
    await page.keyboard.press("Enter");
    expect(
      await page.$eval(
        '[aria-haspopup="listbox"][aria-labelledby*="-label"]',
        (element) => element.textContent,
      ),
    ).toContain("Strategist");
    await page.evaluate(
      'const label=[...document.querySelectorAll("label")].find(label=>label.textContent==="Voice");document.getElementById(label.htmlFor).click();',
    );
    await button(page, "Ara Female");
    await button(page, "Guided");
    await button(page, "Advanced");
    expect(
      await page.$eval(
        "#agent-name",
        (element) => (element as unknown as { value: string }).value,
      ),
    ).toBe("Arden Workshop");
    await button(page, "Appearance");
    await button(page, "Generate");
    let job: typeof schema.characterReferenceJobs.$inferSelect | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await database.db
        .select()
        .from(schema.characterReferenceJobs)
        .where(eq(schema.characterReferenceJobs.userId, owner.userId));
      job = rows.find((row) => !row.agentId);
      if (job) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(job).toBeDefined();
    await page.waitForSelector('[data-image-updating="true"]');
    expect(await page.$eval('[data-image-updating="true"]', element => element.getAttribute("aria-busy"))).toBe("true");
    await button(page, "Close");
    await page.waitForFunction('location.pathname==="/dashboard/agents"');
    const art = await Bun.file(
      new URL(
        "../../../web/public/avatars/personas/full-body-v1/strategic.webp",
        import.meta.url,
      ),
    ).bytes();
    await processMockCharacterReference(database.db, art);
    await page.goto(servers.webUrl + "/agents/create");
    await button(page, "Resume");
    await page.waitForFunction('document.body.innerText.includes("Artwork ready")');
    await button(page, "Review");
    await page.screenshot({
      path: proof + "creation-review.png",
      fullPage: true,
    });
    await button(page, "Create");
    await page.waitForFunction(
      'location.pathname==="/dashboard/agents"&&document.body.innerText.includes("Arden Workshop")',
    );
    const [created] = await database.db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.name, "Arden Workshop"));
    expect(created!.contentRevisionId).toBeNull();
    expect(created!.latestContentRevisionId).toBeTruthy();
    expect(
      (
        await database.db
          .select()
          .from(schema.characterReferenceJobs)
          .where(eq(schema.characterReferenceJobs.id, job!.id))
      )[0]!.status,
    ).toBe("selected");
    expect(
      await database.db.select().from(schema.visualRenderAttempts),
    ).toHaveLength(2);
    await database.db
      .update(schema.agentScreenings)
      .set({ status: "completed", recommendation: "no_concern" })
      .where(
        eq(
          schema.agentScreenings.contentRevisionId,
          created!.latestContentRevisionId!,
        ),
      );
    await publishScreenedAgent(database.db, created!.latestContentRevisionId!);
    expect(
      (
        await database.db
          .select()
          .from(schema.agentVoices)
          .where(eq(schema.agentVoices.agentProfileId, created!.id))
      )[0]!.assignment.voiceId,
    ).toBe("ara");
  } finally {
    await page.close();
  }
}, 120_000);

test("creation layout at desktop and mobile sizes", async () => {
  const page = await createAuthenticatedPage(
    browser,
    owner.jwt,
    servers.webUrl + "/agents/create",
    { privateKey: owner.wallet.privateKey },
  );
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  try {
    await page.waitForSelector(
      'textarea[aria-label="Message the character assistant"]',
      { visible: true },
    );
    await page.waitForSelector('section[aria-label="Model and voice"]', {
      visible: true,
    });
    expect(await page.$('input[type="file"]')).toBeNull();
    expect(
      await page.$eval("body", (element) => element.textContent),
    ).not.toContain("Use an exact model ID");
    expect(
      await page.$eval("body", (element) => element.textContent),
    ).not.toContain("Best effort.");
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewport(viewport);
      await page.screenshot({
        path: proof + `create-guided-${viewport.width}.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate("document.documentElement.scrollWidth<=innerWidth"),
      ).toBe(true);
      if (viewport.width >= 1280)
        expect(
          await page.evaluate(
            '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review").getBoundingClientRect().bottom <= innerHeight',
          ),
        ).toBe(true);
    }
    expect(
      await page.evaluate(
        '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review").disabled',
      ),
    ).toBe(true);
    await button(page, "Advanced");
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewport(viewport);
      await page.screenshot({
        path: proof + `create-advanced-${viewport.width}.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate("document.documentElement.scrollWidth<=innerWidth"),
      ).toBe(true);
      if (viewport.width >= 1280)
        expect(
          await page.evaluate(
            '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review").getBoundingClientRect().bottom <= innerHeight',
          ),
        ).toBe(true);
    }
    await button(page, "Cancel");
  } finally {
    await page.close();
  }
}, 120000);

async function mockCharacterAssistant(
  page: Page,
  name: string,
  personality: string,
  generationReady: Promise<void> = Promise.resolve(),
) {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      ["/api/agent-profiles/creation-assistant", "/api/agent-profiles/edit-assistant"].includes(url.pathname) &&
      request.method() === "POST"
    ) {
      const body = JSON.parse(request.postData()!);
      void request.respond({
        status: 200,
        contentType: "application/json",
        headers: {
          "Access-Control-Allow-Origin": new URL(servers.webUrl!).origin,
          "Access-Control-Allow-Credentials": "true",
        },
        body: JSON.stringify(url.pathname.endsWith("/edit-assistant") ? {tool:"update_character",fields:["personality"],generateImages:false} : {
          command:
            body.stage === "appearance"
              ? "generate_appearance"
              : body.stage === "portrait"
                ? "revise_appearance"
                : "revise_character",
          reply: "",
        }),
      });
    } else if (
      url.pathname === "/api/agent-profiles/generate" &&
      request.method() === "POST"
    ) {
      const body = JSON.parse(request.postData()!);
      void generationReady.then(() => request.respond({
        status: 200,
        contentType: "application/json",
        headers: {
          "Access-Control-Allow-Origin": new URL(servers.webUrl!).origin,
          "Access-Control-Allow-Credentials": "true",
        },
        body: JSON.stringify({
          introQuips: [],
          visualDesign: "An adult investigator in a bronze coat",
          name,
          backstory: "A former stage magician.",
          strategyStyle: "Build trust through commitments.",
          personaKey: "strategic",
          gender: "non-binary",
          ...body.existingProfile,
          performanceInstructions: body.existingProfile?.performanceInstructions || "Calm delivery",
          werewolfStrategyStyle: body.existingProfile?.werewolfStrategyStyle || "Test claims before voting.",
          ...(body.selectedFields?.includes("visualDesign")
            ? { visualDesign: "An adult investigator in a green coat" }
            : {}),
          personality,
        }),
      }));
    } else void request.continue();
  });
}
async function latestPendingJob(name: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const jobs = await database.db
      .select()
      .from(schema.characterReferenceJobs)
      .where(eq(schema.characterReferenceJobs.userId, owner.userId));
    for (const job of jobs.filter((row) => row.status === "queued")) {
      const { readJson } = await import("../services/payload-storage.js");
      if ((await readJson(job.input)).name === name) return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Expected a durable generated artwork job");
}
test("first guided conversation stays readable while generation is pending", async () => {
  const generation = Promise.withResolvers<void>();
  const page = await createAuthenticatedPage(browser, owner.jwt, servers.webUrl + "/agents/create", { privateKey: owner.wallet.privateKey });
  try {
    await mockCharacterAssistant(page, "Pending Character", "An observant player.", generation.promise);
    await page.waitForFunction('!document.querySelector("#agent-creation-message")?.disabled');
    await fill(page, "#agent-creation-message", "A patient lighthouse keeper who charts storms and quietly brokers alliances, but distrusts easy promises.");
    await button(page, "Send");
    await page.waitForSelector('[role="status"][aria-label="Assistant typing"]');
    for (const viewport of [
      { width: 320, height: 568 }, { width: 390, height: 844 },
      { width: 768, height: 1024 }, { width: 1024, height: 768 },
      { width: 1440, height: 900 }, { width: 1920, height: 1080 },
    ]) {
      await page.setViewport(viewport);
      const layout = await page.evaluate(`(() => {
        const log = document.querySelector('[role="log"][aria-label="Character creation conversation"]');
        const intro = document.querySelector('.agent-creation-visual-empty');
        const typing = document.querySelector('[role="status"][aria-label="Assistant typing"]');
        const footer = document.querySelector('footer[aria-label="Editor actions"]');
        return { height: log.clientHeight, introVisible: intro.checkVisibility(), overflow: document.documentElement.scrollWidth > innerWidth,
          typingBottom: typing.getBoundingClientRect().bottom, footerTop: footer.getBoundingClientRect().top };
      })()`) as { height: number; introVisible: boolean; overflow: boolean; typingBottom: number; footerTop: number };
      expect(layout.introVisible).toBe(false);
      expect(layout.height).toBeGreaterThanOrEqual(160);
      expect(layout.overflow).toBe(false);
      expect(layout.typingBottom).toBeLessThanOrEqual(layout.footerTop);
      await page.screenshot({ path: proof + `guided-first-turn-${viewport.width}.png`, fullPage: true });
    }
  } finally {
    generation.resolve();
    await page.close();
  }
}, 120_000);
test("Guided creation saves model, voice and ready artwork directly from review", async () => {
  const page = await createAuthenticatedPage(
    browser,
    owner.jwt,
    servers.webUrl + "/agents/create",
    { privateKey: owner.wallet.privateKey },
  );
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  try {
    await page.waitForSelector('section[aria-label="Model and voice"]', {
      visible: true,
    });
    await mockCharacterAssistant(
      page,
      "Rowan Guided",
      "A curious investigator who listens carefully.",
    );
    await fill(
      page,
      "#agent-creation-message",
      "Create Rowan, a patient investigator.",
    );
    await button(page, "Send");
    await page.waitForFunction(
      'document.querySelector("h1")?.textContent==="Rowan Guided"',
    );
    await button(page, "Continue");
    await fill(
      page,
      "#agent-creation-message",
      "A bronze coat, full body, transparent background.",
    );
    await button(page, "Send");
    const job = await latestPendingJob("Rowan Guided");
    await page.waitForSelector('[data-image-updating="true"]');
    for (const mode of ["Guided", "Advanced"]) {
      await button(page, mode);
      for (const width of [1440, 390]) {
        await page.setViewport({ width, height: width === 390 ? 844 : 900 });
        await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
        expect(await page.evaluate('getComputedStyle(document.querySelector(\'[data-image-updating="true"]\'), "::after").animationName')).toContain("agent-image-scan");
        await page.evaluate('for (const animation of document.querySelector(\'[data-image-updating="true"]\').getAnimations({subtree:true})) { animation.pause(); animation.currentTime = 2400; }');
        await page.screenshot({ path: proof + `image-scan-${mode.toLowerCase()}-${width}.png`, fullPage: false });
        await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
        expect(await page.evaluate('getComputedStyle(document.querySelector(\'[data-image-updating="true"]\'), "::after").animationName')).toBe("none");
      }
    }
    await button(page, "Guided");
    const before = await database.db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.name, "Rowan Guided"));
    expect(before).toHaveLength(0);
    expect(
      await page.evaluate(
        '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review").disabled',
      ),
    ).toBe(true);
    await page.setViewport({ width: 1280, height: 800 });
    await page.screenshot({
      path: proof + "create-guided-generating.png",
      fullPage: true,
    });
    const art = await Bun.file(
      new URL(
        "../../../web/public/avatars/personas/full-body-v1/strategic.webp",
        import.meta.url,
      ),
    ).bytes();
    await processMockCharacterReference(database.db, art);
    await page.waitForFunction(
      'document.body.innerText.includes("Artwork ready")',
    );
    expect(await page.$('[data-image-updating="true"]')).toBeNull();
    await button(page, "Activity");
    await page.waitForFunction('document.querySelector(\'dialog[open] [aria-label="Image requests"]\')?.textContent.includes("Image ready")');
    expect(await page.$eval('dialog[open] [aria-label="Image requests"]', element => element.textContent)).toContain("Image ready");
    await button(page, "Close");
    await page.focus('input[role="combobox"][aria-label="Preferred model"], input[role="combobox"]');
    await page.waitForSelector('[role="option"]');
    await page.evaluate('[...document.querySelectorAll("[role=option]")].find(option=>option.textContent.includes("openai:gpt-6-luna")).click()');
    await page.evaluate('const label=[...document.querySelectorAll("label")].find(label=>label.textContent==="Voice");document.getElementById(label.htmlFor).click()');
    await button(page, "Ara Female");
    await button(page, "Review");
    await page.waitForSelector('[role="dialog"][aria-label="Review changes"]');
    await button(page, "Create");
    await page.waitForFunction(
      'location.pathname==="/dashboard/agents"&&document.body.innerText.includes("Rowan Guided")',
    );
    const [created] = await database.db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.name, "Rowan Guided"));
    expect(created!.contentRevisionId).toBeNull();
    expect(created!.latestContentRevisionId).toBeTruthy();
    expect(created!.modelPreference).toMatchObject({ catalogId: "openai:gpt-6-luna" });
    await database.db.update(schema.agentScreenings).set({ status: "completed", recommendation: "no_concern" }).where(eq(schema.agentScreenings.contentRevisionId, created!.latestContentRevisionId!));
    await publishScreenedAgent(database.db, created!.latestContentRevisionId!);
    const [published] = await database.db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, created!.id));
    expect(published!.fullBodyReferenceUrl).toBeTruthy();
    expect(published!.avatarUrl).toBe(published!.fullBodyReferenceUrl);
    expect(published!.headPosition).toBeNull();
    expect((await database.db.select().from(schema.agentVoices).where(eq(schema.agentVoices.agentProfileId, created!.id)))[0]!.assignment.voiceId).toBe("ara");
    expect(
      (
        await database.db
          .select()
          .from(schema.characterReferenceJobs)
          .where(eq(schema.characterReferenceJobs.id, job.id))
      )[0]!.status,
    ).toBe("selected");
  } finally {
    await page.close();
  }
}, 120000);

test("Guided update changes text without generating artwork and keeps accepted content usable", async () => {
  const generation = Promise.withResolvers<void>();
  const page = await createAuthenticatedPage(
    browser,
    owner.jwt,
    servers.webUrl + `/dashboard/agents/${agentId}/edit?profileRequest=1`,
    { privateKey: owner.wallet.privateKey },
  );
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  try {
    await page.waitForSelector("#agent-creation-message", { visible: true });
    await mockCharacterAssistant(
      page,
      "Mira Voss",
      "A warm investigator who invites precise answers.",
      generation.promise,
    );
    const jobsBefore = await database.db
      .select()
      .from(schema.characterReferenceJobs);
    await fill(
      page,
      "#agent-creation-message",
      "Make her warmer, keeping her current appearance.",
    );
    await button(page, "Send");
    await page.waitForSelector('[aria-label="Revise Character prompt"][data-updating="true"]');
    expect(await page.$('[data-image-updating="true"]')).toBeNull();
    expect(await page.$('[aria-label="Revise Name"][data-updating="true"]')).toBeNull();
    for (const mode of ["Guided", "Advanced"]) {
      await button(page, mode);
      for (const width of [1440, 390]) {
        await page.setViewport({ width, height: width === 390 ? 844 : 900 });
        const target = mode === "Guided" ? '[aria-label="Revise Character prompt"]' : "#agent-personality";
        await page.evaluate(`document.querySelector(${JSON.stringify(target)}).scrollIntoView({block:"center"})`);
        await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
        expect(await page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(target)})).animationName`)).toContain("agent-text-scan");
        await page.evaluate(`for (const animation of document.querySelector(${JSON.stringify(target)}).getAnimations({subtree:true})) { animation.pause(); animation.currentTime = 1900; }`);
        await page.screenshot({ path: proof + `text-scan-${mode.toLowerCase()}-${width}.png`, fullPage: false });
        await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
        expect(await page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(target)})).animationName`)).toBe("none");
      }
    }
    await button(page, "Guided");
    generation.resolve();
    await page.waitForFunction(
      'document.body.innerText.includes("Does that feel right")',
    );
    expect(await page.$('[data-updating="true"]')).toBeNull();
    await button(page, "Review");
    await page.waitForSelector('[role="dialog"][aria-label="Review changes"]');
    expect(
      await page.$eval(
        '[role="dialog"][aria-label="Review changes"]',
        (element) => element.textContent,
      ),
    ).toContain("A warm investigator who invites precise answers.");
    await button(page, "Save");
    await page.waitForFunction('location.pathname==="/dashboard/agents"');
    const [profile] = await database.db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, agentId));
    expect(profile!.personality).toBe(
      "Patient, observant, and quietly theatrical.",
    );
    expect(
      await database.db.select().from(schema.characterReferenceJobs),
    ).toHaveLength(jobsBefore.length);
  } finally {
    generation.resolve();
    await page.close();
  }
}, 120000);

test("an interrupted image request shows one short notice and can be discarded without changing the saved agent", async () => {
  const page = await createAuthenticatedPage(
    browser,
    owner.jwt,
    servers.webUrl + `/dashboard/agents/${agentId}/edit`,
    { privateKey: owner.wallet.privateKey },
  );
  try {
    await page.waitForSelector("#agent-name", { visible: true });
    await button(page, "Generate");
    const job = await latestPendingJob("Mira Voss").catch(async (cause) => {
      await page.screenshot({
        path: proof + "generation-start-failed.png",
        fullPage: true,
      });
      const notices = await page.$$eval(
        '[role="alert"], [aria-label="Choose draft"], [aria-label="Saved draft"]',
        (elements) => elements.map((element) => element.textContent),
      );
      throw new Error(`${String(cause)}; UI: ${JSON.stringify(notices)}`);
    });
    const { randomUUID } = await import("node:crypto");
    const operationId = randomUUID(),
      attemptId = randomUUID();
    await database.db.insert(schema.visualRenderOperations).values({
      id: operationId,
      userId: owner.userId,
      operationKey: `full-body:${job.id}`,
      inputHash: "interrupted-browser-fixture",
    });
    await database.db.insert(schema.visualRenderAttempts).values({
      id: attemptId,
      operationId,
      generation: 1,
      provider: "openai",
      model: "gpt-image-2.6-sunburst",
      requestHash: "interrupted-browser-fixture",
    });
    await database.db
      .update(schema.characterReferenceJobs)
      .set({
        status: "failed",
        error:
          "Reference generation needs operator reconciliation before another paid request",
      })
      .where(eq(schema.characterReferenceJobs.id, job.id));
    await page.waitForSelector('[data-agent-issue="artwork"]');
    expect(await page.$('[data-image-updating="true"]')).toBeNull();
    expect(
      await page.$eval(
        '[data-agent-issue="artwork"]',
        (element) => element.textContent,
      ),
    ).toBe("Image generation stopped.DiscardSupport");
    const supportSelector =
      '[data-agent-issue="artwork"] button[aria-haspopup="dialog"]';
    await page.setViewport({ width: 1440, height: 900 });
    await page.click(supportSelector);
    await page.waitForSelector(
      'dialog[open][aria-labelledby="generation-contact-title"]',
    );
    expect(
      await page.$eval("dialog[open]", (element) => element.textContent),
    ).toContain("Get help");
    expect(
      await page.$eval("dialog[open]", (element) => element.textContent),
    ).toContain("ask for help with your agent");
    expect(
      await page.$eval("dialog[open] pre", (element) => element.textContent),
    ).toContain(job.id);
    const email = await page.$eval(
      'dialog[open] a[href^="mailto:"]',
      (element) => element.getAttribute("href"),
    );
    expect(email).toStartWith("mailto:support@falsefloor.ai?");
    expect(decodeURIComponent(email!)).toContain(job.id);
    await page.evaluate(
      'Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>{window.copiedSupportReference=text;}}})',
    );
    await button(page, "Copy");
    await page.waitForFunction(
      'document.querySelector("dialog[open] [role=status]")?.textContent === "Copied"',
    );
    expect(await page.evaluate("window.copiedSupportReference")).toContain(
      job.id,
    );
    await page.screenshot({
      path: proof + "support-desktop.png",
      fullPage: false,
    });
    await page.setViewport({ width: 390, height: 844 });
    expect(
      await page.$eval("dialog[open]", (element) => {
        const rect = element.getBoundingClientRect();
        const viewport = element.ownerDocument.defaultView;
        return (
          !!viewport &&
          rect.top >= 0 &&
          rect.left >= 0 &&
          rect.bottom <= viewport.innerHeight &&
          rect.right <= viewport.innerWidth
        );
      }),
    ).toBe(true);
    await page.screenshot({
      path: proof + "support-mobile.png",
      fullPage: false,
    });
    expect(
      await page.evaluate(
        "document.documentElement.scrollWidth<=window.innerWidth",
      ),
    ).toBe(true);
    await button(page, "Close");
    await page.waitForFunction('!document.querySelector("dialog[open]")');
    expect(await page.evaluate("document.activeElement?.textContent")).toBe(
      "Support",
    );
    await page.click(supportSelector);
    await page.waitForSelector("dialog[open]");
    await page.keyboard.press("Escape");
    await page.waitForFunction('!document.querySelector("dialog[open]")');
    await page.setViewport({ width: 1440, height: 900 });
    expect(
      await page.evaluate(
        '[...document.querySelectorAll("[role=alert]")].filter(element=>element.checkVisibility()).length',
      ),
    ).toBe(1);
    expect(
      await page.evaluate(
        '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Retry")?.disabled ?? true',
      ),
    ).toBe(true);
    await page.goto(servers.webUrl + "/dashboard/agents");
    await button(page, "Activity");
    const stoppedSupport =
      '[aria-label="Image requests"] [data-status="stopped"] button[aria-haspopup="dialog"]';
    await page.waitForSelector(stoppedSupport);
    await page.click(stoppedSupport);
    await page.waitForSelector(
      'dialog[open][aria-labelledby="generation-contact-title"]',
    );
    expect(
      await page.$eval("dialog[open] pre", (element) => element.textContent),
    ).toContain(job.id);
    await button(page, "Close");
    // The user may have already lost the draft. The activity link alone must
    // still offer Discard and retire the owned request.
    await database.db
      .delete(schema.agentEditorDrafts)
      .where(eq(schema.agentEditorDrafts.scope, `edit:${agentId}`));
    await page.evaluate("sessionStorage.clear()");
    await page.goto(
      servers.webUrl +
        `/dashboard/agents/${agentId}/edit?imageRequest=${job.id}`,
    );
    await page.waitForSelector('[data-agent-issue="artwork"]');
    await button(page, "Guided");
    expect(
      await page.evaluate(
        '[...document.querySelectorAll("[role=alert]")].filter(element=>element.checkVisibility()).length',
      ),
    ).toBe(1);
    expect(
      await page.$eval("body", (element) => element.innerText),
    ).not.toContain("reconciliation");
    await page.setViewport({ width: 1280, height: 800 });
    await page.screenshot({
      path: proof + "image-support-required.png",
      fullPage: true,
    });
    await button(page, "Discard");
    await button(page, "Discard");
    await page.waitForFunction('location.pathname==="/dashboard/agents"');
    expect(
      (
        await database.db
          .select()
          .from(schema.characterReferenceJobs)
          .where(eq(schema.characterReferenceJobs.id, job.id))
      )[0]!.status,
    ).toBe("discarded");
    expect(
      await database.db
        .select()
        .from(schema.agentEditorDrafts)
        .where(eq(schema.agentEditorDrafts.scope, `edit:${agentId}`)),
    ).toHaveLength(0);
    expect(
      (
        await database.db
          .select()
          .from(schema.visualRenderAttempts)
          .where(eq(schema.visualRenderAttempts.id, attemptId))
      )[0]!.receipt,
    ).toBeNull();
    expect(
      (
        await database.db
          .select()
          .from(schema.agentProfiles)
          .where(eq(schema.agentProfiles.id, agentId))
      )[0]!.personality,
    ).toBe("Patient, observant, and quietly theatrical.");
  } finally {
    await page.close();
  }
}, 120000);

test("exhausted generations retain the contact dialog and the unsent revision", async () => {
  const page = await createAuthenticatedPage(
    browser,
    owner.jwt,
    servers.webUrl + `/dashboard/agents/${agentId}/edit?profileRequest=1`,
    { privateKey: owner.wallet.privateKey },
  );
  try {
    await page.waitForSelector("#agent-creation-message", { visible: true });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (
        request.url().includes("/api/agent-profiles/creation-assistant") &&
        request.method() === "POST"
      ) {
        void request.respond({
          status: 402,
          contentType: "application/json",
          headers: {
            "Access-Control-Allow-Origin": servers.webUrl,
            "Access-Control-Allow-Credentials": "true",
          },
          body: JSON.stringify({
            error: "Generation allowance exhausted",
            code: "generation_exhausted",
          }),
        });
      } else void request.continue();
    });
    await fill(
      page,
      "#agent-creation-message",
      "Make their approach more patient.",
    );
    await button(page, "Send");
    await page.waitForSelector(
      'dialog[open][aria-labelledby="generation-contact-title"]',
    );
    expect(
      await page.$eval("dialog[open]", (element) => element.textContent),
    ).toContain("Need more generations?");
    expect(
      await page.$eval('dialog[open] a[href^="mailto:"]', (element) =>
        element.getAttribute("href"),
      ),
    ).toBe("mailto:support@falsefloor.ai");
    expect(
      await page.$eval('dialog[open] a[href*="discord.gg"]', (element) =>
        element.getAttribute("href"),
      ),
    ).toBe("https://discord.gg/J3DaYDzxNq");
    await page.screenshot({
      path: proof + "generation-limit.png",
      fullPage: true,
    });
    await button(page, "Dismiss");
    expect(
      await page.$eval(
        "#agent-creation-message",
        (element) => (element as unknown as { value: string }).value,
      ),
    ).toBe("Make their approach more patient.");
    expect(await page.$$('[role="alert"]')).toHaveLength(1);
  } finally {
    await page.close();
  }
}, 120000);

test("pending requests are visible before generation and cancellation keeps edits in editor and management", async () => {
  const reservationsBefore = (
    await database.db.select().from(schema.inferenceReservations)
  ).length;
  const id = crypto.randomUUID();
  const input = {
    ...characterGenerationInput(id, "Mira Voss"),
    agentId,
    draftScope: `edit:${agentId}`,
  };
  await requestCharacterReference(
    database.db,
    owner.userId,
    input,
    servers.apiUrl,
  );
  const page = await createAuthenticatedPage(
    browser,
    owner.jwt,
    servers.webUrl + "/dashboard/agents",
    { privateKey: owner.wallet.privateKey },
  );
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  try {
    const indicator = 'main header button[aria-label="Activity"]';
    await page.waitForSelector(indicator);
    expect(await page.$eval(indicator, element => element.getAttribute("data-working"))).toBe("true");
    expect(Number(await page.$eval(indicator, element => element.getAttribute("data-activity-count")))).toBeGreaterThan(0);
    expect(await page.evaluate(`getComputedStyle(document.querySelector('${indicator} svg')).animationName`)).toBe("none");
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    expect(await page.evaluate(`getComputedStyle(document.querySelector('${indicator} svg')).animationName`)).toContain("management-activity-spin");
    await page.screenshot({ path: proof + "management-active.png", fullPage: false });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await button(page, "Activity");
    await page.waitForSelector('[aria-label="Image requests"]');
    expect(
      await page.$eval(
        '[aria-label="Image requests"]',
        (element) => element.textContent,
      ),
    ).toContain("Waiting to start");
    await page.screenshot({
      path: proof + "pending-management.png",
      fullPage: true,
    });
    await page.click('dialog[open] [aria-label="Image requests"] a');
    await page.waitForSelector("#agent-name", { visible: true });
    expect(
      await page.evaluate(
        `[...document.querySelectorAll('button')].filter(button=>button.textContent.trim()==='Generate'&&button.checkVisibility()).every(button=>button.disabled)`,
      ),
    ).toBe(true);
    await fill(
      page,
      "#agent-personality",
      "These character edits survive image cancellation.",
    );
    await page.waitForFunction(
      "document.body.innerText.includes('Draft saved')",
    );
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewport(viewport);
      await page.screenshot({
        path: proof + `pending-editor-${viewport.width}.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(
          "document.documentElement.scrollWidth <= innerWidth",
        ),
      ).toBe(true);
    }
    await page.setViewport({ width: 1440, height: 900 });
    await button(page, "Activity");
    await page.waitForSelector('[aria-label="Image requests"]');
    await button(page, "Cancel image for Mira Voss");
    await page.waitForSelector("dialog[open]");
    await button(page, "Cancel");
    await page.waitForFunction(
      `!document.querySelector('[aria-label="Image requests"]')`,
    );
    expect(await page.$('[data-image-updating="true"]')).toBeNull();
    expect(
      await page.$eval(
        "#agent-personality",
        (element) => (element as unknown as { value: string }).value,
      ),
    ).toBe("These character edits survive image cancellation.");
    expect(
      (
        await database.db
          .select()
          .from(schema.characterReferenceJobs)
          .where(eq(schema.characterReferenceJobs.id, id))
      )[0]!.status,
    ).toBe("discarded");
    const nextId = crypto.randomUUID();
    await requestCharacterReference(
      database.db,
      owner.userId,
      { ...input, requestId: nextId },
      servers.apiUrl,
    );
    await page.goto(servers.webUrl + "/dashboard/agents", {
      waitUntil: "domcontentloaded",
    });
    await button(page, "Activity");
    await page.waitForSelector('[aria-label="Image requests"]');
    await button(page, "Cancel image for Mira Voss");
    await page.waitForSelector("dialog[open]");
    await button(page, "Cancel");
    await page.waitForFunction(
      `!document.querySelector('[aria-label="Image requests"]')`,
    );
    const { readAgentDraft } = await import(
      "../services/agent-editor-drafts.js"
    );
    expect(
      (await readAgentDraft(database.db, owner.userId, `edit:${agentId}`))
        ?.document,
    ).toMatchObject({
      current: {
        personality: "These character edits survive image cancellation.",
      },
    });
    expect(
      await database.db.select().from(schema.inferenceReservations),
    ).toHaveLength(reservationsBefore);
  } finally {
    await page.close();
  }
}, 120000);

test("generates and saves replacement artwork with touch on an iPhone viewport", async () => {
  const { profile } = await createOwnedAgentProfile(
    database.db,
    { userId: owner.userId },
    {
      name: "Mobile Artwork",
      gender: "female",
      personaKey: "diplomat",
      personality: "A patient negotiator.",
      avatarUrl: "/avatars/personas/diplomat.png",
    },
  );
  const page = await createAuthenticatedPage(
    browser,
    owner.jwt,
    servers.webUrl + "/dashboard/agents",
    { privateKey: owner.wallet.privateKey },
  );
  try {
    await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
    const card = `#agent-${profile.id}`;
    await page.waitForSelector(`${card} img`);
    await page.screenshot({ path: proof + "iphone-management-before-artwork.png" });
    await button(page, "Edit Mobile Artwork");
    async function visibleAction(label: string) {
      const selector = `Array.from((document.querySelector('dialog[open]') ?? document).querySelectorAll('button')).find(button => button.textContent.trim() === ${JSON.stringify(label)} && !button.disabled && button.checkVisibility())`;
      await page.waitForFunction(selector);
      const bounds = await page.evaluate(`(() => {
        const action = ${selector};
        const { x, y, width, height } = action.getBoundingClientRect();
        const center = document.elementFromPoint(x + width / 2, y + height / 2);
        const footer = action.closest("dialog") ? null : document.querySelector('[aria-label="Editor actions"]');
        return { x, y, width, height, hit: action.contains(center), visibleBottom: footer?.getBoundingClientRect().top ?? innerHeight };
      })()`) as { x: number; y: number; width: number; height: number; hit: boolean; visibleBottom: number };
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(bounds.visibleBottom);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.hit).toBe(true);
      return bounds;
    }
    async function tap(label: string) {
      const bounds = await visibleAction(label);
      await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    }
    const requested = page.waitForResponse(response =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/agent-profiles/visual-reference",
    );
    await tap("Generate");
    const request = await requested;
    expect({ status: request.status(), body: await request.json() }).toMatchObject({ status: 202 });
    const art = await Bun.file(
      new URL("../../../web/public/avatars/personas/full-body-v1/strategic.webp", import.meta.url),
    ).bytes();
    expect(await processMockCharacterReference(database.db, art)).toBe(1);
    await page.waitForFunction('document.body.innerText.includes("Artwork ready")');
    await visibleAction("Select");
    await page.screenshot({ path: proof + "iphone-artwork-ready.png" });
    await tap("Select");
    await page.waitForSelector('dialog[open] img[alt="Mobile Artwork portrait preview"]', { visible: true });
    for (const [width, height] of [[375, 667], [390, 844]] as const) {
      await page.setViewport({ width, height, isMobile: true, hasTouch: true });
      const bounds = await visibleAction("Save artwork");
      const headshot = await page.$eval('dialog[open] figure', element => {
        const { top, bottom, right } = element.getBoundingClientRect();
        return { top, bottom, right };
      });
      expect(headshot.top).toBeGreaterThan(bounds.y);
      expect(headshot.bottom).toBeLessThanOrEqual(height);
      expect(headshot.right).toBeLessThanOrEqual(width);
      await page.screenshot({ path: proof + `iphone-headshot-${width}.png` });
      if (width === 375) {
        expect(await page.evaluate(`(() => {
          const details = document.querySelector("dialog[open] details");
          details.open = true;
          details.scrollIntoView({ block: "end" });
          return details.closest(".overflow-y-auto").scrollTop > 0;
        })()`)).toBe(true);
        const whileScrolling = await visibleAction("Save artwork");
        expect(whileScrolling.y).toBe(bounds.y);
        await page.screenshot({ path: proof + "iphone-headshot-adjustments-375.png" });
        await page.evaluate(`(() => {
          const details = document.querySelector("dialog[open] details");
          details.open = false;
          details.closest(".overflow-y-auto").scrollTop = 0;
        })()`);
      }
    }
    async function boxBounds(label: string) {
      const box = await page.waitForSelector(`dialog[open] :is([aria-label="${label}"], [alt="${label}"])`);
      const bounds = await box?.boundingBox();
      await box?.dispose();
      if (!bounds) throw new Error(`No visible geometry for ${label}`);
      return bounds;
    }
    async function drag(label: string, dx: number, dy: number) {
      const rect = await boxBounds(label);
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      const touch = await page.touchscreen.touchStart(x, y);
      await touch.move(x + dx, y + dy);
      await touch.end();
    }
    async function pinch(dx: number) {
      const preview = await boxBounds("Mobile Artwork full image");
      const x = preview.x + preview.width / 2;
      const y = preview.y + preview.height * 0.55;
      const first = await page.touchscreen.touchStart(x - 25, y);
      const second = await page.touchscreen.touchStart(x + 25, y);
      await second.move(x + 25 + dx, y);
      await second.end();
      await first.move(x - 40, y - 10);
      await first.end();
    }
    const portrait = "Portrait box; drag to move";
    const head = "Head box; drag to move";
    await tap("Portrait");
    const original = await boxBounds(portrait);
    await drag(portrait, 5, 0);
    const moved = await boxBounds(portrait);
    expect(moved.x).toBeGreaterThan(original.x + 2);
    for (const { label, corner, distance } of [
      { label: portrait, corner: "Resize portrait box", distance: 5 },
      { label: head, corner: "Resize head box", distance: -5 },
    ]) {
      if (label === head) await tap("Head");
      const beforeCorner = await boxBounds(label);
      await drag(corner, distance, distance);
      const afterCorner = await boxBounds(label);
      expect(afterCorner.x).toBe(beforeCorner.x);
      expect(afterCorner.y).toBe(beforeCorner.y);
      expect(Math.sign(afterCorner.width - beforeCorner.width)).toBe(Math.sign(distance));
      await pinch(distance);
      const afterPinch = await boxBounds(label);
      expect(afterPinch.x).toBe(beforeCorner.x);
      expect(afterPinch.y).toBe(beforeCorner.y);
      expect(Math.sign(afterPinch.width - afterCorner.width)).toBe(Math.sign(distance));
      expect(afterPinch.width / afterPinch.height).toBeCloseTo(afterCorner.width / afterCorner.height, 1);
    }
    const patched = page.waitForRequest(request =>
      request.method() === "PATCH" && new URL(request.url()).pathname === `/api/agent-profiles/${profile.id}`,
    );
    await tap("Save artwork");
    const { fullBodyReferenceUrl } = JSON.parse((await patched).postData()!) as { fullBodyReferenceUrl: string };
    await page.waitForFunction('location.pathname === "/dashboard/agents"');
    const [saved] = await database.db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, profile.id));
    expect(saved!.latestContentRevisionId).not.toBe(profile.latestContentRevisionId);
    const image = `${card}[data-review-state="reviewing"] img[alt="Mobile Artwork"]`;
    for (const reload of [false, true]) {
      if (reload) await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(`(() => {
        const img = document.querySelector(${JSON.stringify(image)});
        return img?.currentSrc.startsWith("blob:") && img.naturalWidth > 0;
      })()`);
      const displayedHash = await page.$eval(image, async img => {
        const bytes = await (await fetch((img as unknown as { currentSrc: string }).currentSrc)).arrayBuffer();
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
      });
      expect(displayedHash).toBe(fullBodyReferenceUrl.split("/").at(-1)!);
    }
    await page.screenshot({ path: proof + "iphone-management-saved-artwork.png" });
    const { readAgentDraft } = await import("../services/agent-editor-drafts.js");
    expect(await readAgentDraft(database.db, owner.userId, `edit:${profile.id}`)).toBeNull();
  } catch (error) {
    await page.screenshot({ path: proof + "iphone-artwork-failure.png" });
    throw error;
  } finally {
    await page.close();
  }
}, 120000);

test("clearing old artwork then revising appearance also completes missing game notes", async () => {
  const [baseline] = await database.db
    .select()
    .from(schema.agentProfiles)
    .where(eq(schema.agentProfiles.id, agentId));
  const created = await createOwnedAgentProfile(
    database.db,
    { userId: owner.userId },
    {
      name: "Appearance Regression",
      gender: "female",
      personaKey: "observer",
      personality: "A patient investigator.",
      backstory: "A former magician.",
      strategyStyle: "Build trust.",
      werewolfStrategyStyle: "",
      performanceInstructions: "Measured gestures.",
      visualDesign: "An investigator in a bronze coat.",
      avatarUrl: baseline!.avatarUrl,
      fullBodyReferenceUrl: baseline!.fullBodyReferenceUrl,
      headPosition: baseline!.headPosition,
    },
  );
  const profileId = created.profile.id;
  const oldId = crypto.randomUUID();
  await requestCharacterReference(
    database.db,
    owner.userId,
    {
      ...characterGenerationInput(oldId, "Appearance Regression"),
      agentId: profileId,
      draftScope: `edit:${profileId}`,
    },
    "",
  );
  await database.db
    .update(schema.characterReferenceJobs)
    .set({ status: "failed", errorCode: "artwork_recovery_required" })
    .where(eq(schema.characterReferenceJobs.id, oldId));
  const page = await createAuthenticatedPage(
    browser,
    owner.jwt,
    servers.webUrl + `/dashboard/agents/${profileId}/edit`,
    { privateKey: owner.wallet.privateKey },
  );
  try {
    await button(page, "Activity");
    await page.waitForSelector(
      '[aria-label="Image requests"] [data-status="stopped"]',
    );
    await button(page, "Clear image for Appearance Regression");
    await page.waitForSelector("dialog[open]");
    await button(page, "Clear");
    await page.waitForFunction(
      '!document.querySelector("dialog[open]") && !document.querySelector("[data-status=stopped]")',
    );
    const requests: Record<string, unknown>[] = [];
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/agent-profiles/generate" &&
        request.method() === "POST"
      )
        requests.push(JSON.parse(request.postData()!));
    });
    await mockCharacterAssistant(
      page,
      "Appearance Regression",
      "A patient investigator.",
    );
    await button(page, "Revise");
    await page.waitForFunction(
      'document.activeElement?.id === "agent-creation-message"',
    );
    await fill(page, "#agent-creation-message", "Make their coat green.");
    await button(page, "Send");
    const job = await latestPendingJob("Appearance Regression");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      selectedFields: ["visualDesign"],
      existingProfile: { werewolfStrategyStyle: "" },
    });
    const { readJson } = await import("../services/payload-storage.js");
    expect(await readJson(job.input)).toMatchObject({
      operation: "edit",
      visualDesign: "An adult investigator in a green coat",
    });
    expect(
      (
        await database.db
          .select()
          .from(schema.agentProfiles)
          .where(eq(schema.agentProfiles.id, profileId))
      )[0]!.werewolfStrategyStyle,
    ).toBeNull();
    expect(await page.$('[data-agent-issue="assistant"]')).toBeNull();
    expect(await page.evaluate('document.querySelector("#agent-werewolfStrategyStyle").value')).toBe("Test claims before voting.");
    await page.waitForSelector('[data-image-updating="true"]');
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
      await page.evaluate('document.querySelector(\'[data-image-updating="true"]\').scrollIntoView({block:"center"})');
      expect(await page.evaluate('getComputedStyle(document.querySelector(\'[data-image-updating="true"]\'), "::after").animationName')).toContain("agent-image-scan");
      expect(await page.evaluate('document.querySelector(\'[data-image-updating="true"]\').getAnimations({subtree:true}).length')).toBeGreaterThan(0);
      await page.evaluate('for (const animation of document.querySelector(\'[data-image-updating="true"]\').getAnimations({subtree:true})) { animation.pause(); animation.currentTime = 2400; }');
      await page.screenshot({ path: proof + `existing-image-scan-${width}.png`, fullPage: false });
    }
  } finally {
    await page.close();
  }
}, 120000);

async function editorPositions(page: Page) {
  return page.$eval("[data-agent-workspace]", (workspace) =>
    Object.fromEntries(
      [
        ["heading", "header"],
        ["tabs", '[role="tablist"]'],
        ["composer", "#agent-creation-message"],
        ["preferences", '[aria-label="Model and voice"]'],
        ["footer", '[aria-label="Editor actions"]'],
      ].map(([name, selector]) => {
        const rect = workspace
          .querySelector(selector!)!
          .getBoundingClientRect();
        return [
          name,
          {
            top: rect.top,
            height: rect.height,
            left: rect.left,
            width: rect.width,
          },
        ];
      }),
    ),
  );
}
function expectSamePositions(
  before: Awaited<ReturnType<typeof editorPositions>>,
  after: Awaited<ReturnType<typeof editorPositions>>,
) {
  for (const name of Object.keys(before))
    for (const key of ["top", "height", "left", "width"] as const) {
      const delta = Math.abs(after[name]![key] - before[name]![key]);
      if (delta > 1)
        throw new Error(
          `${name}.${key} moved ${delta}px: ${JSON.stringify({ before, after })}`,
        );
      expect(delta).toBeLessThanOrEqual(1);
    }
}

test("delayed image status never moves the editor in any mode or viewport", async () => {
  for (const editing of [false, true])
    for (const guided of [false, true])
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 1280, height: 650 },
        { width: 390, height: 844 },
      ]) {
        const path = editing
          ? `/dashboard/agents/${agentId}/edit`
          : "/agents/create";
        const page = await createAuthenticatedPage(
          browser,
          owner.jwt,
          servers.webUrl + path,
          { privateKey: owner.wallet.privateKey },
        );
        const release = Promise.withResolvers<void>(),
          requested = Promise.withResolvers<void>();
        const row = {
          id: crypto.randomUUID(),
          source: "reference",
          agentId: editing ? agentId : null,
          draftScope: editing ? `edit:${agentId}` : "create:manage:none",
          name: "Pending image",
          status: "queued",
          stage: "waiting",
          createdAt: new Date().toISOString(),
          blocksGeneration: true,
        };
        let rows: Record<string, unknown>[] = [row];
        try {
          await page.setViewport(viewport);
          await page.setRequestInterception(true);
          page.on("request", (request) => {
            if (
              new URL(request.url()).pathname ===
                "/api/agent-profiles/generations" &&
              request.method() === "GET"
            ) {
              requested.resolve();
              void release.promise.then(() =>
                request.respond({
                  status: 200,
                  contentType: "application/json",
                  headers: {
                    "Access-Control-Allow-Origin": servers.webUrl,
                    "Access-Control-Allow-Credentials": "true",
                  },
                  body: JSON.stringify(rows),
                }),
              );
            } else void request.continue();
          });
          await page.reload({ waitUntil: "domcontentloaded" });
          await requested.promise;
          await page.waitForSelector('[aria-label="Editor actions"]');
          await button(page, guided ? "Guided" : "Advanced");
          await page.evaluate("document.fonts.ready");
          const before = await editorPositions(page);
          release.resolve();
          await page.waitForFunction(
            'document.querySelector("[aria-label=\\"Editor actions\\"]")?.textContent.includes("Queued")',
          );
          expectSamePositions(before, await editorPositions(page));
          if (editing) expect(await page.$('[data-image-updating="true"]')).not.toBeNull();
          rows = [{ ...row, status: "stopped", blocksGeneration: false }];
          await page.waitForFunction(
            'document.querySelector("[aria-label=\\"Editor actions\\"]")?.textContent.includes("Generation stopped")',
          );
          expectSamePositions(before, await editorPositions(page));
          expect(await page.$('[data-image-updating="true"]')).toBeNull();
          expect(
            await page.$eval(
              '[aria-label="Editor actions"]',
              (element) => element.getBoundingClientRect().bottom,
            ),
          ).toBeLessThanOrEqual(viewport.height);
          await page.screenshot({
            path:
              proof +
              `stable-${editing ? "edit" : "create"}-${guided ? "guided" : "advanced"}-${viewport.width}.png`,
            fullPage: false,
          });
        } finally {
          release.resolve();
          await page.close();
          await database.db
            .delete(schema.agentEditorDrafts)
            .where(eq(schema.agentEditorDrafts.userId, owner.userId));
        }
      }
}, 120000);

test("late account draft recovery and Resume keep the editor shell stationary", async () => {
  const first = await createAuthenticatedPage(
    browser,
    owner.jwt,
    servers.webUrl + `/dashboard/agents/${agentId}/edit`,
    { privateKey: owner.wallet.privateKey },
  );
  await first.waitForSelector("#agent-personality", { visible: true });
  await fill(
    first,
    "#agent-personality",
    "A saved draft that should resume without moving the editor.",
  );
  await first.waitForFunction(
    'document.querySelector("[aria-label=\\"Editor actions\\"]")?.textContent.includes("Draft saved")',
  );
  await first.close();
  const page = await createAuthenticatedPage(
    browser,
    owner.jwt,
    servers.webUrl + `/dashboard/agents/${agentId}/edit`,
    { privateKey: owner.wallet.privateKey },
  );
  const release = Promise.withResolvers<void>(),
    requested = Promise.withResolvers<void>();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (
        decodeURIComponent(new URL(request.url()).pathname) ===
          `/api/agent-profiles/drafts/edit:${agentId}` &&
        request.method() === "GET"
      ) {
        requested.resolve();
        void release.promise.then(() => request.continue());
      } else void request.continue();
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await requested.promise;
    await page.waitForSelector("#agent-name", { visible: true });
    await page.evaluate("document.fonts.ready");
    const before = await editorPositions(page);
    release.resolve();
    await button(page, "Resume");
    await page.waitForFunction(
      'document.querySelector("#agent-personality")?.value === "A saved draft that should resume without moving the editor."',
    );
    expectSamePositions(before, await editorPositions(page));
    expect(await page.$("dialog[open]")).toBeNull();
    await page.screenshot({
      path: proof + "stable-resumed-draft.png",
      fullPage: false,
    });
  } finally {
    release.resolve();
    await page.close();
  }
}, 120000);

test("review acceptance keeps gallery order and card positions unchanged", async () => {
  const [baseline] = await database.db
    .select()
    .from(schema.agentProfiles)
    .where(eq(schema.agentProfiles.id, agentId));
  const profiles = [];
  for (const [index, name] of [
    "Stable Older",
    "Stable Reviewing",
    "Stable Newer",
  ].entries()) {
    const created = await createOwnedAgentProfile(
      database.db,
      { userId: owner.userId },
      {
        name,
        gender: "female",
        personality: "An attentive investigator.",
        strategyStyle: "Build trust.",
        werewolfStrategyStyle: "Test claims.",
        avatarUrl: baseline!.avatarUrl,
        fullBodyReferenceUrl: baseline!.fullBodyReferenceUrl,
        headPosition: baseline!.headPosition,
      },
    );
    profiles.push(created.profile);
    await database.db
      .update(schema.agentProfiles)
      .set({ createdAt: `2026-01-0${index + 1}T00:00:00Z` })
      .where(eq(schema.agentProfiles.id, created.profile.id));
    await database.db
      .update(schema.agentScreenings)
      .set({ status: "completed", recommendation: "no_concern" })
      .where(
        eq(
          schema.agentScreenings.contentRevisionId,
          created.profile.latestContentRevisionId!,
        ),
      );
    await publishScreenedAgent(
      database.db,
      created.profile.latestContentRevisionId!,
    );
  }
  const target = profiles[1]!;
  const updated = await updateOwnedAgentProfile(
    database.db,
    { userId: owner.userId },
    target.id,
    {
      personality: "An attentive investigator who questions assumptions.",
      expectedContentRevisionId: target.latestContentRevisionId,
    },
  );
  const page = await createAuthenticatedPage(
    browser,
    owner.jwt,
    servers.webUrl + "/dashboard/agents?at=" + target.id,
    { privateKey: owner.wallet.privateKey },
  );
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await page.waitForSelector(
      "#agent-" + target.id + '[data-review-state="reviewing"]',
    );
    await page.evaluate("document.fonts.ready");
    const positions = () =>
      page.$$eval('article[id^="agent-"]', (elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            id: element.id,
            top: rect.top,
            left: rect.left,
            height: rect.height,
          };
        }),
      );
    const activityBefore = Number(await page.$eval('main header button[aria-label="Activity"]', element => element.getAttribute("data-activity-count")));
    await button(page, "Activity");
    expect(await page.$eval('dialog[open] [aria-label="Reviewing agents"]', element => element.textContent)).toContain(target.name);
    await button(page, "Close");
    const before = await positions();
    expect(await page.$eval(`#agent-${target.id} > a [role="status"]`, element => element.textContent)).toContain("Reviewing");
    expect(await page.$eval(`#agent-${target.id} > a [role="status"]`, element => element.textContent)).toContain("Still usable");
    await database.db
      .update(schema.agentScreenings)
      .set({ status: "completed", recommendation: "no_concern" })
      .where(
        eq(
          schema.agentScreenings.contentRevisionId,
          updated.profile.latestContentRevisionId!,
        ),
      );
    await publishScreenedAgent(
      database.db,
      updated.profile.latestContentRevisionId!,
    );
    await database.db
      .update(schema.agentProfiles)
      .set({ updatedAt: "2099-01-01T00:00:00Z" })
      .where(eq(schema.agentProfiles.id, target.id));
    await page.waitForSelector(
      "#agent-" + target.id + '[data-review-state="accepted"]',
    );
    const after = await positions();
    const remainingActivity = await page.$('main header button[aria-label="Activity"]');
    expect(remainingActivity ? Number(await remainingActivity.evaluate(element => element.getAttribute("data-activity-count"))) : 0).toBe(activityBefore - 1);
    expect(await page.$(`#agent-${target.id} > a [role="status"]`)).toBeNull();
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    before.forEach((row, index) => {
      expect(Math.abs(row.top - after[index]!.top)).toBeLessThanOrEqual(1);
      expect(row.left).toBe(after[index]!.left);
      expect(row.height).toBe(after[index]!.height);
    });
    await page.screenshot({
      path: proof + "stable-gallery-accepted.png",
      fullPage: false,
    });
  } finally {
    await page.close();
  }
}, 120000);
