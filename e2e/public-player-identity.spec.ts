import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

const LOCAL_IDENTITY_RUN = process.env.PLAYWRIGHT_LOCAL_IDENTITY === "1";
const PRIVATE_SENTINEL = "PRIVATE_E2E_PROFILE_SENTINEL";

interface IdentityFixture {
  handle: string;
  publicId: string;
  walletAddress: string;
  completeJwt: string;
  requiredJwt: string;
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

  let harnessProcess: ChildProcessWithoutNullStreams;
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
    await page.goto(requireWebUrl(servers), { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("button", { name: "Sign in", exact: true }))
      .toBeVisible();
    await expect(page.getByText("Sign in with Privy", { exact: true }))
      .toHaveCount(0);
  });

  test("renders the same anonymous public profile by handle and UUID without private data", async ({
    page,
  }) => {
    const webUrl = requireWebUrl(servers);
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
      `${requireWebUrl(servers)}/profile/${fixture.handle}`,
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
        `${requireWebUrl(servers)}/profile/${fixture.handle}`,
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

  test("requires identity for post-cutoff users before downstream onboarding", async ({
    browser,
  }) => {
    const context = await authenticatedContext(browser, fixture.requiredJwt);
    const page = await context.newPage();
    try {
      await page.goto(`${requireWebUrl(servers)}/dashboard`, {
        waitUntil: "networkidle",
        timeout: 60_000,
      });
      const dialog = page.getByRole("dialog", {
        name: "Choose how players know you",
      });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Not now" })).toHaveCount(0);

      await dialog.getByLabel("Display name").fill("Required Player");
      await dialog.getByLabel("Handle").fill("required-player");
      await dialog.getByRole("button", { name: "Create public profile" }).click();
      await expect(dialog).toBeHidden();
    } finally {
      await context.close();
    }
  });

  test("lets a pre-cutoff user defer once per browser session and keeps recovery visible", async ({
    browser,
  }) => {
    const firstContext = await authenticatedContext(browser, fixture.deferrableJwt);
    const firstPage = await firstContext.newPage();
    try {
      await firstPage.goto(`${requireWebUrl(servers)}/dashboard/profile`, {
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
      await freshPage.goto(`${requireWebUrl(servers)}/dashboard/profile`, {
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
      await collisionPage.goto(`${requireWebUrl(servers)}/dashboard`, {
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
      await completePage.goto(`${requireWebUrl(servers)}/dashboard/profile`, {
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

function requireWebUrl(handles: LocalIdentityHarness): string {
  return handles.webUrl;
}

async function startLocalIdentityHarness(): Promise<{
  process: ChildProcessWithoutNullStreams;
  harness: LocalIdentityHarness;
}> {
  const child = spawn(
    "bun",
    ["run", "packages/api/src/e2e/public-player-identity-harness.ts"],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const stderr: string[] = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => stderr.push(chunk));

  const lines = createInterface({ input: child.stdout });
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
  }, 100_000);

  try {
    for await (const line of lines) {
      if (!line.startsWith("E2E_IDENTITY_READY ")) continue;
      const harness = JSON.parse(
        line.slice("E2E_IDENTITY_READY ".length),
      ) as LocalIdentityHarness;
      return { process: child, harness };
    }
  } finally {
    clearTimeout(timeout);
    lines.close();
  }

  throw new Error(
    `Local identity harness exited before it was ready.\n${stderr.join("")}`.trim(),
  );
}

async function stopLocalIdentityHarness(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
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
