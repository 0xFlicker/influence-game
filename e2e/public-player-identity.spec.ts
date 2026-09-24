import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import {
  startLocalHarness,
  stopLocalHarness,
  type LocalHarnessProcess,
} from "./local-harness";

const LOCAL_IDENTITY_RUN =
  process.env.PLAYWRIGHT_LOCAL_IDENTITY === "1"
  || process.env.PLAYWRIGHT_BASE_URL === undefined;
const PRIVATE_SENTINEL = "PRIVATE_E2E_PROFILE_SENTINEL";

interface IdentityFixture {
  handle: string;
  publicId: string;
  walletAddress: string;
  completeJwt: string;
  requiredJwt: string;
  noQueueJwt: string;
  deferrableJwt: string;
  collisionJwt: string;
}

interface LocalIdentityHarness {
  apiUrl: string;
  webUrl: string;
  fixture: IdentityFixture;
}

test.describe("local public player identity", () => {
  test.skip(
    !LOCAL_IDENTITY_RUN,
    "Set PLAYWRIGHT_LOCAL_IDENTITY=1 to run the isolated local identity story.",
  );
  test.describe.configure({ mode: "serial", retries: 0 });

  let harnessProcess: LocalHarnessProcess;
  let servers: LocalIdentityHarness;
  let fixture: IdentityFixture;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    const started = await startLocalIdentityHarness();
    harnessProcess = started.process;
    servers = started.harness;
    fixture = servers.fixture;
  });

  test.afterAll(async () => {
    if (harnessProcess) await stopLocalIdentityHarness(harnessProcess);
  });

  test("uses ordinary sign-in copy without making Privy an onboarding step", async ({ page }) => {
    await page.goto(servers.webUrl, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("button", { name: "Sign in", exact: true }))
      .toBeVisible();
    await expect(page.getByText("Sign in with Privy", { exact: true }))
      .toHaveCount(0);
  });

  test("renders the same anonymous public profile by handle and UUID without private data", async ({
    page,
  }) => {
    const webUrl = servers.webUrl;
    const handleResponse = await page.goto(
      `${webUrl}/profile/${fixture.handle}`,
      { waitUntil: "networkidle", timeout: 60_000 },
    );
    expect(handleResponse?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "E2E Flick", level: 1 }))
      .toBeVisible();
    await expect(page.getByRole("heading", { name: "Saved competitors", level: 2 }))
      .toBeVisible();
    await expect(page.getByRole("heading", { name: "Vesper E2E", level: 3 }))
      .toBeVisible();
    await expect(page.getByRole("heading", { name: "Quartz E2E", level: 3 }))
      .toBeVisible();
    await expect(page.getByText("No games yet", { exact: true }))
      .toBeVisible();
    await expect(page.locator('link[rel="canonical"]'))
      .toHaveAttribute("href", new RegExp(`/profile/${fixture.handle}$`));

    const uuidResponse = await page.goto(
      `${webUrl}/profile/${fixture.publicId}`,
      { waitUntil: "networkidle", timeout: 60_000 },
    );
    expect(uuidResponse?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "E2E Flick", level: 1 }))
      .toBeVisible();
    await expect(page.locator('link[rel="canonical"]'))
      .toHaveAttribute("href", new RegExp(`/profile/${fixture.handle}$`));

    const apiResponse = await fetch(
      `${servers.apiUrl}/api/players/${fixture.handle}`,
    );
    expect(apiResponse.status).toBe(200);
    const body = await apiResponse.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(PRIVATE_SENTINEL);
    expect(serialized).not.toContain(fixture.walletAddress);
    assertNoForbiddenPublicKeys(body);
    await expect(page.getByText(PRIVATE_SENTINEL, { exact: false })).toHaveCount(0);
  });

  test("supports hover transfer and keyboard dismissal on a profile portrait", async ({
    page,
  }) => {
    await page.goto(
      `${servers.webUrl}/profile/${fixture.handle}`,
      { waitUntil: "networkidle", timeout: 60_000 },
    );
    const trigger = page.getByRole("button", {
      name: "View Vesper E2E portrait and stats",
    });
    await trigger.hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("1");
    await tooltip.hover();
    await expect(tooltip).toBeVisible();

    await trigger.focus();
    await expect(tooltip).toBeVisible();
    await trigger.press("Escape");
    await expect(tooltip).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("pins and dismisses the preview on touch inside a narrow viewport", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    try {
      await page.goto(
        `${servers.webUrl}/profile/${fixture.handle}`,
        { waitUntil: "networkidle", timeout: 60_000 },
      );
      const trigger = page.getByRole("button", {
        name: "View Vesper E2E portrait and stats",
      });
      await trigger.click();
      const tooltip = page.getByRole("tooltip");
      await expect(tooltip).toBeVisible();
      const bounds = await tooltip.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);

      await page.getByRole("heading", { name: "E2E Flick", level: 1 }).click();
      await expect(tooltip).toBeHidden();
    } finally {
      await context.close();
    }
  });

  test("requires terms and identity before prompting a new player to create an agent", async ({
    browser,
  }) => {
    const context = await authenticatedContext(browser, fixture.requiredJwt);
    const page = await context.newPage();
    try {
      await page.goto(`${servers.webUrl}/dashboard`, {
        waitUntil: "networkidle",
        timeout: 60_000,
      });
      await expect(page.getByRole("heading", { name: "Review and accept" })).toBeVisible();
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Accept and continue" }).click();
      const dialog = page.getByRole("dialog", {
        name: "Choose how players know you",
      });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Not now" })).toHaveCount(0);

      await dialog.getByLabel("Display name").fill("Required Player");
      await dialog.getByLabel("Handle").fill("required-player");
      await dialog.getByRole("button", { name: "Create public profile" }).click();
      await expect(dialog).toBeHidden();
      const dailyAgentDialog = page.getByRole("dialog", {
        name: "Play for Free",
      });
      await expect(dailyAgentDialog).toBeVisible({ timeout: 2_500 });
      await expect(dailyAgentDialog.getByRole("button", {
        name: "Create an agent",
      })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("offers first-agent creation after onboarding when Daily Free is unavailable", async ({ browser }) => {
    test.setTimeout(60_000);
    const context = await authenticatedContext(browser, fixture.noQueueJwt);
    const page = await context.newPage();
    try {
      // A fresh ephemeral database has no active season, so this read is ineligible.
      await page.route("**/api/free-queue", async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          json: { ...await response.json(), promptEligible: false },
        });
      });
      await page.goto(`${servers.webUrl}/dashboard`, { waitUntil: "networkidle" });
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Accept and continue" }).click();
      const profile = page.getByRole("dialog", { name: "Choose how players know you" });
      await profile.getByLabel("Display name").fill("No Queue Player");
      await profile.getByLabel("Handle").fill("no-queue-player");
      await profile.getByRole("button", { name: "Create public profile" }).click();
      const agent = page.getByRole("dialog", { name: "Create your first Agent" });
      await expect(agent).toBeVisible({ timeout: 2_500 });
      await agent.getByRole("button", { name: "Create an Agent" }).click();
      await expect(page).toHaveURL(`${servers.webUrl}/dashboard/agents/create`, { timeout: 30_000 });
      await page.getByRole("button", { name: "Advanced create", exact: false }).click();
      await expect(page.locator("#agent-name")).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("guides character approval and headshot confirmation on desktop and mobile", async ({ browser }) => {
    test.setTimeout(120_000);
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const context = await authenticatedContext(browser, fixture.completeJwt);
      const page = await context.newPage();
      await page.setViewportSize(viewport);
      const sourceUrl = `${servers.webUrl}/creation-fixture.svg`;
      const character = { name: "Mira Vale", gender: "female", personaKey: "diplomat", personality: "A warm diplomat with a long memory and a secret fear of betrayal. She listens carefully, records promises, and tests trust through small favors.", backstory: "An exiled ambassador building a new coalition.", strategyStyle: "Build trust before asking for a decisive vote.", performanceInstructions: "Quiet, precise gestures.", visualDesign: "A blue dragon in a gold coat.", introQuips: ["A promise is a beginning.", "I remember our deal.", "Tea before betrayal?"] };
      const imageReady = Promise.withResolvers<void>();
      let generated = 0;
      let imageRequests = 0;
      let exported: Record<string, unknown> | null = null;
      try {
        await page.route("**/creation-fixture.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#333950"/><circle cx="300" cy="165" r="85" fill="#8faee0"/><rect x="175" y="270" width="250" height="480" rx="60" fill="#d0a646"/></svg>' }));
        await page.route("**/api/agent-profiles/creation-assistant", route => {
          const { stage, message } = route.request().postDataJSON();
          return route.fulfill({ json: { command: stage === "character" ? "revise_character" : stage === "review" ? message.startsWith("Yes") ? "accept_character" : "revise_character" : "generate_appearance" } });
        });
        await page.route("**/api/agent-profiles/generate", route => {
          if (generated === 0) {
            expect(route.request().postDataJSON().creationTraitIds).toEqual(["gender-non-binary", "streamer", "gamer"]);
          }
          return route.fulfill({ json: { ...character, personality: ++generated >= 2 ? "A suspicious diplomat who verifies every promise." : character.personality } });
        });
        await page.route("**/api/agent-profiles/visual-reference", async route => {
          imageRequests++;
          await imageReady.promise;
          await route.fulfill({ json: { fullBodyReferenceUrl: sourceUrl, avatarUrl: sourceUrl, portraitCrop: { sourceUrl, x: 0.2, y: 0.02, width: 0.6, height: 0.4 }, headSuggestion: { sourceUrl, sourceHash: "a".repeat(64), sourceWidth: 600, sourceHeight: 900, rect: { x: 0.36, y: 0.09, width: 0.28, height: 0.2 } } } });
        });
        await page.route("**/api/agent-profiles/portrait-crop", route => {
          const { headRectangle, ...portraitCrop } = route.request().postDataJSON();
          exported = portraitCrop;
          return route.fulfill({ json: { avatarUrl: sourceUrl, portraitCrop, headPosition: { sourceUrl, sourceHash: "a".repeat(64), sourceWidth: 600, sourceHeight: 900, rect: headRectangle } } });
        });
        await page.goto(`${servers.webUrl}/dashboard/agents/create`, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: /Create with an AI assistant/ }).click();
        // The global acquisition prompt must not interrupt a longer creation session.
        await page.evaluate(() => window.dispatchEvent(new Event("free-queue:changed")));
        await page.waitForTimeout(3500);
        await expect(page.getByRole("dialog", { name: "Play for Free", exact: true })).toHaveCount(0);
        const composer = page.getByLabel("Message the character assistant", { exact: true });
        await expect(page.getByText("Interests", { exact: true })).toHaveCount(0);
        await expect(page.getByText("Background", { exact: true })).toHaveCount(1);
        await page.getByRole("button", { name: "Add Non-binary ingredient", exact: true }).click();
        await expect(page.getByRole("button", { name: "Remove Non-binary ingredient", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Add Streamer ingredient", exact: true }).click();
        await page.getByRole("button", { name: "Add Gamer ingredient", exact: true }).click();
        await expect(page.getByRole("button", { name: "Remove Streamer ingredient", exact: true })).toBeVisible();
        await page.screenshot({ path: `/tmp/agent-starter-pills-${viewport.width}.png` });
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await expect(page.getByRole("button", { name: "Yes, that feels right" })).toBeVisible();
        await page.getByRole("button", { name: "Read Name", exact: true }).click();
        const nameReader = page.getByRole("dialog", { name: "Name", exact: true });
        await expect(nameReader.getByText("Mira Vale", { exact: true })).toBeVisible();
        await nameReader.getByRole("button", { name: "Close", exact: true }).click();
        await expect(page.getByRole("button", { name: "Remove change Name" })).toHaveCount(0);
        await page.getByRole("button", { name: "Read Character prompt", exact: true }).click();
        const reader = page.getByRole("dialog", { name: "Character prompt", exact: true });
        await expect(reader.getByText(character.personality, { exact: true })).toBeVisible();
        expect((await reader.boundingBox())?.height).toBe(viewport.height);
        await page.screenshot({ path: `/tmp/character-section-reader-${viewport.width}.png` });
        await reader.getByRole("button", { name: "Edit Character prompt", exact: true }).click();
        await expect(reader).toBeHidden();
        await expect(composer).toBeFocused();
        await expect(page.getByRole("button", { name: "Remove change Character prompt" })).toBeVisible();
        await composer.fill("No, make her suspicious");
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await expect(page.getByText("A suspicious diplomat who verifies every promise.")).toBeVisible();
        await page.getByRole("button", { name: "Yes, that feels right" }).click();
        await expect(page.getByText(/What do they look like/)).toBeVisible();
        await expect(page.getByRole("button", { name: "Add Dragon ingredient", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Add Dragon ingredient", exact: true }).click();
        await composer.fill("A blue dragon in a gold coat");
        await page.screenshot({ path: `/tmp/agent-visual-tags-${viewport.width}.png` });
        const inputBounds = await composer.boundingBox();
        const sendBounds = await page.getByRole("button", { name: "Send", exact: true }).boundingBox();
        expect(inputBounds && sendBounds && sendBounds.x > inputBounds.x && sendBounds.x + sendBounds.width < inputBounds.x + inputBounds.width).toBeTruthy();
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await expect(page.getByRole("button", { name: "Assistant working", exact: true })).toBeDisabled();
        await expect(composer).toHaveValue("");
        await expect(composer).toBeHidden();
        await expect(page.getByText("Visual ingredients", { exact: true })).toBeHidden();
        await expect(page.getByRole("status", { name: "Assistant typing" })).toBeVisible();
        const formation = page.getByRole("status", { name: "Creating character image" });
        await expect(formation).toBeVisible();
        await expect(page.getByRole("button", { name: "Read Name", exact: true })).toHaveCount(0);
        await page.screenshot({ path: `/tmp/character-formation-${viewport.width}.png` });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await expect(formation.locator("svg")).toBeVisible();
        await page.screenshot({ path: `/tmp/character-formation-reduced-${viewport.width}.png` });
        await page.emulateMedia({ reducedMotion: "no-preference" });
        imageReady.resolve();
        const dialog = page.getByRole("dialog", { name: "Adjust character images" });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Head position", exact: true })).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Confirm this headshot", exact: true })).toBeEnabled();
        await dialog.getByText("Precise adjustments", { exact: true }).click();
        const frame = dialog.getByRole("slider", { name: "Frame size", exact: true });
        const originalFrameSize = await frame.inputValue();
        const confirm = dialog.getByRole("button", { name: "Confirm this headshot", exact: true });
        const beforeWarning = await confirm.evaluate(element => element.getBoundingClientRect().top + (element.closest("dialog")?.scrollTop ?? 0));
        await frame.evaluate(element => { (element as HTMLInputElement).value = "32"; element.dispatchEvent(new Event("input", { bubbles: true })); });
        await expect(dialog.getByRole("img", { name: "Head outside portrait crop" })).toBeVisible();
        await expect(confirm).toBeDisabled();
        const duringWarning = await confirm.evaluate(element => element.getBoundingClientRect().top + (element.closest("dialog")?.scrollTop ?? 0));
        expect(duringWarning).toBeCloseTo(beforeWarning, 1);
        await page.screenshot({ path: `/tmp/crop-warning-${viewport.width}.png` });
        await frame.evaluate((element, value) => { (element as HTMLInputElement).value = value; element.dispatchEvent(new Event("input", { bubbles: true })); }, originalFrameSize);
        await expect(dialog.getByRole("img", { name: "Head outside portrait crop" })).toHaveCount(0);
        await expect(confirm).toBeEnabled();
        await dialog.getByText("Precise adjustments", { exact: true }).click();
        const dialogBounds = await dialog.boundingBox();
        expect(dialogBounds?.height).toBe(viewport.height);
        await page.screenshot({ path: `/tmp/agent-auto-crop-${viewport.width}.png` });
        if (viewport.width < 500) {
          const box = dialog.getByLabel("Portrait box; drag to move");
          await expect(box).toBeVisible();
          const rect = await box.boundingBox();
          if (!rect) throw new Error("Portrait box has no bounds");
          // Native touch events exercise pointer capture and touch-action, not synthetic DOM events.
          const cdp = await context.newCDPSession(page);
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }] });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: rect.x + rect.width / 2 + 4, y: rect.y + rect.height / 2 + 4 }] });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          const corner = await dialog.getByLabel("Resize portrait box").boundingBox();
          if (!corner) throw new Error("Portrait resize handle has no bounds");
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: corner.x + 8, y: corner.y + 8 }] });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: corner.x + 13, y: corner.y + 13 }] });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await cdp.detach();
          await dialog.getByRole("button", { name: "Head position", exact: true }).click();
          const head = await dialog.getByLabel("Head box; drag to move").boundingBox();
          if (!head) throw new Error("Head box has no bounds");
          await page.mouse.move(head.x + head.width / 2, head.y + head.height / 2);
          await page.mouse.down(); await page.mouse.move(head.x + head.width / 2 + 3, head.y + head.height / 2 + 3); await page.mouse.up();
          const headCorner = await dialog.getByLabel("Resize head box").boundingBox();
          if (!headCorner) throw new Error("Head resize handle has no bounds");
          await page.mouse.move(headCorner.x + 8, headCorner.y + 8);
          await page.mouse.down(); await page.mouse.move(headCorner.x + 6, headCorner.y + 6); await page.mouse.up();
          await page.screenshot({ path: "/tmp/agent-crop-mobile.png", fullPage: false });
        }
        await dialog.getByRole("button", { name: "Confirm this headshot", exact: true }).click();
        await expect(page.getByRole("dialog")).toBeHidden();
        expect(exported).not.toBeNull();
        if (viewport.width < 500) {
          expect(Number(exported?.["x"])).toBeGreaterThan(0.2);
          expect(Number(exported?.["width"])).toBeGreaterThan(0.6);
        }
        await expect(page.getByRole("button", { name: "Create Agent", exact: true })).toBeEnabled();
        await page.getByRole("button", { name: "Read Strategy", exact: true }).click();
        await page.getByRole("dialog", { name: "Strategy", exact: true }).getByRole("button", { name: "Edit Strategy", exact: true }).click();
        await composer.fill("Be more patient with allies");
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await expect(page.getByRole("button", { name: "Yes, that feels right" })).toBeVisible();
        await page.getByRole("button", { name: "Yes, that feels right" }).click();
        await expect(page.getByRole("button", { name: "Create Agent", exact: true })).toBeEnabled();
        await expect(page.getByText("Visual ingredients", { exact: true })).toHaveCount(0);
        expect(imageRequests).toBe(1);
        // Appearance generation must not replace the approved character prompt.
        await expect(page.getByText("A suspicious diplomat who verifies every promise.")).toBeVisible();
        await page.getByRole("button", { name: "Advanced create", exact: true }).click();
        await expect(page.locator("#agent-personality")).toHaveValue("A suspicious diplomat who verifies every promise.");
        await expect(page.locator("#agent-name")).toHaveValue("Mira Vale");
      } finally { await context.close(); }
    }
  });

  test("lets a pre-cutoff user defer once per browser session and keeps recovery visible", async ({
    browser,
  }) => {
    const firstContext = await authenticatedContext(browser, fixture.deferrableJwt);
    const firstPage = await firstContext.newPage();
    try {
      await firstPage.goto(`${servers.webUrl}/dashboard/profile`, {
        waitUntil: "networkidle",
        timeout: 60_000,
      });
      const dialog = firstPage.getByRole("dialog", {
        name: "Choose how players know you",
      });
      await dialog.getByRole("button", { name: "Not now" }).click();
      await expect(dialog).toBeHidden();
      await expect(firstPage.getByRole("button", {
        name: "Complete your public profile",
      })).toBeVisible();
    } finally {
      await firstContext.close();
    }

    const freshContext = await authenticatedContext(browser, fixture.deferrableJwt);
    const freshPage = await freshContext.newPage();
    try {
      await freshPage.goto(`${servers.webUrl}/dashboard/profile`, {
        waitUntil: "networkidle",
        timeout: 60_000,
      });
      await expect(freshPage.getByRole("dialog", {
        name: "Choose how players know you",
      })).toBeVisible();
    } finally {
      await freshContext.close();
    }
  });

  test("keeps collision recovery editable and hides an empty invite-code section", async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const collisionContext = await authenticatedContext(browser, fixture.collisionJwt);
    const collisionPage = await collisionContext.newPage();
    try {
      await collisionPage.goto(`${servers.webUrl}/dashboard`, {
        waitUntil: "networkidle",
        timeout: 60_000,
      });
      const dialog = collisionPage.getByRole("dialog", {
        name: "Choose how players know you",
      });
      await dialog.getByLabel("Display name").fill("Collision Player");
      const handle = dialog.getByLabel("Handle");
      await handle.click();
      await expect(handle).toHaveValue("collision-player-2");
      await handle.fill("collision-player");
      await handle.press("Tab");
      await expect(handle).toHaveValue("collision-player");
      await dialog.getByRole("button", { name: "Create public profile" }).click();
      await expect(dialog.getByRole("alert")).toContainText("handle is taken");
      await expect(handle).toHaveValue("collision-player");
      await expect(handle).toBeEditable();
    } finally {
      await collisionContext.close();
    }

    const completeContext = await authenticatedContext(browser, fixture.completeJwt);
    const completePage = await completeContext.newPage();
    try {
      await completePage.goto(`${servers.webUrl}/dashboard/profile`, {
        waitUntil: "networkidle",
        timeout: 60_000,
      });
      await expect(completePage.getByRole("heading", { name: "Invite Codes" }))
        .toHaveCount(0);
    } finally {
      await completeContext.close();
    }
  });
});

async function authenticatedContext(
  browser: Browser,
  jwt: string,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addInitScript((token) => {
    localStorage.setItem("influence_session", token);
  }, jwt);
  return context;
}

async function startLocalIdentityHarness(): Promise<{
  process: LocalHarnessProcess;
  harness: LocalIdentityHarness;
}> {
  return startLocalHarness<LocalIdentityHarness>({
    script: "packages/api/src/e2e/public-player-identity-harness.ts",
    readyPrefix: "E2E_IDENTITY_READY ",
    startupTimeoutMs: 100_000,
    errorLabel: "Local identity harness exited before it was ready.",
  });
}

async function stopLocalIdentityHarness(
  child: LocalHarnessProcess,
): Promise<void> {
  await stopLocalHarness(child);
}

function assertNoForbiddenPublicKeys(value: unknown): void {
  const forbidden = new Set([
    "id",
    "internalUserId",
    "userId",
    "ownerId",
    "walletAddress",
    "email",
    "personality",
    "backstory",
    "strategyStyle",
    "agentProfileId",
    "agentRevisionId",
    "currentRevisionId",
  ]);
  walkPublicValue(value, (key) => {
    expect(forbidden.has(key), `public response leaked key ${key}`).toBe(false);
  });
}

function walkPublicValue(
  value: unknown,
  visitKey: (key: string) => void,
): void {
  if (Array.isArray(value)) {
    for (const item of value) walkPublicValue(item, visitKey);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    visitKey(key);
    walkPublicValue(child, visitKey);
  }
}
