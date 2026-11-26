import { createHash, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";
import {
  clerkSetup,
  setupClerkTestingToken,
} from "@clerk/testing/playwright";
import {
  startLocalHarness,
  stopLocalHarness,
  type LocalHarnessProcess,
} from "./local-harness";

const DETERMINISTIC_RUN =
  process.env.PLAYWRIGHT_LAYERED_AUTH === "deterministic";
const REAL_CLERK_RUN =
  process.env.PLAYWRIGHT_LAYERED_AUTH === "real-clerk";
const REDIRECT_URI = "http://127.0.0.1:34567/oauth/callback";

interface LayeredAuthHarness {
  apiUrl: string;
  webUrl: string;
  tokens: {
    newManaged: string;
    existingEmailManaged: string;
    walletManaged: string;
    reverseManaged: string;
    providerOutage: string;
    existingPrivy: string;
    reversePrivy: string;
    walletPrivyFresh: string;
    walletPrivyExpired: string;
    uiExistingPrivy: string;
    uiNewPrivy: string;
    uiExistingOnlyPrivy: string;
    uiDisabledPrivy: string;
    uiOutagePrivy: string;
    uiReversePrivy: string;
    uiWalletPrivyFresh: string;
    uiWalletPrivyExpired: string;
  };
  users: {
    existingEmail: string;
    walletOwner: string;
    reverseOwner: string;
  };
  sessions: {
    existingEmail: string;
    walletOwner: string;
    walletless: string;
    uiWalletOwner: string;
    accountOperator: string;
  };
}

test.describe("deterministic layered authentication", () => {
  test.skip(
    !DETERMINISTIC_RUN,
    "Use bun run test:e2e:layered-auth for injected provider adapters.",
  );
  test.describe.configure({ mode: "serial", retries: 0 });

  let harnessProcess: LocalHarnessProcess;
  let harness: LayeredAuthHarness;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    const started = await startHarness();
    harnessProcess = started.process;
    harness = started.harness;
  });

  test.afterAll(async () => {
    if (harnessProcess) await stopHarness(harnessProcess);
  });

  test.beforeEach(async ({ context }) => {
    await installTurnstileFixture(context);
  });

  test("shows an exhausted bucket in the signup panel before asking for credentials", async ({ page }, testInfo) => {
    let nextAvailableAt: string | null = new Date(Date.now() + 86_400_000).toISOString();
    await page.route("**/api/auth/signup-availability", async route => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { available: !nextAvailableAt, rate: 1, nextAvailableAt } });
    });
    await page.goto(`${harness.webUrl}/sign-up`);
    const panel = page.getByRole("dialog", { name: "Influence authentication" });
    await expect(panel.getByRole("status")).toHaveText("Signups are full. Try again in about 24 hours.");
    await expect(panel.getByLabel("Email", { exact: true })).toHaveCount(0);
    await expect(panel.getByLabel("Password", { exact: true })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Continue with Privy" })).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath("signup-preflight-full-mobile.png") });
    await panel.getByRole("tab", { name: "Sign in" }).focus();
    await page.keyboard.press("Enter");
    await expect(panel.getByLabel("Email", { exact: true })).toBeVisible();
    await panel.getByRole("tab", { name: "Create account" }).click();
    await expect(panel.getByRole("status")).toHaveText(/Signups are full/);
    nextAvailableAt = null;
    await panel.getByRole("button", { name: "Check again" }).click();
    await expect(panel.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Continue with Privy" })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({ path: testInfo.outputPath("signup-preflight-available.png") });
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  });

  test("recovers account creation from sign in and keeps creation consent explicit", async ({
    page,
  }, testInfo) => {
    await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
      route => route.abort("failed"), { times: 1 });
    let signupFull = false;
    let signupAvailabilityChecks = 0;
    await page.route("**/api/auth/signup-availability", async route => {
      signupAvailabilityChecks += 1;
      const response = await route.fetch();
      if (signupFull) {
        await route.fulfill({ response, json: {
          available: false, nextAvailableAt: new Date(Date.now() + 12 * 60_000).toISOString(), rate: 25,
        } });
      } else await route.fulfill({ response });
    });
    let transientFailure = true;
    await page.route("**/api/auth/managed/create", async route => {
      const headers = {
        "access-control-allow-origin": new URL(harness.webUrl).origin,
        "access-control-allow-credentials": "true",
      };
      if (route.request().method() === "POST" && signupFull) {
        await route.fulfill({ status: 429, headers, json: {
          code: "SIGNUP_LIMIT_REACHED", error: "Signups are full.",
          nextAvailableAt: new Date(Date.now() + 12 * 60_000).toISOString(),
        } });
      } else if (route.request().method() === "POST" && route.request().postDataJSON()?.turnstileToken && transientFailure) {
        transientFailure = false;
        await route.fulfill({ status: 503, headers, json: {
          code: "SIGNUP_VERIFICATION_UNAVAILABLE", error: "Human verification is temporarily unavailable. Try again.",
        } });
      } else await route.continue();
    });
    await page.addInitScript((token) => {
      window.__INFLUENCE_E2E_AUTH__ = { privyToken: token };
    }, harness.tokens.uiNewPrivy);
    await page.goto(`${harness.webUrl}/get-mcp`, {
      waitUntil: "networkidle",
    });

    await clickNavigationSignIn(page);
    await page.getByLabel("Email").fill("ui-signin-new+e2e@example.test");
    await page.getByLabel("Password").fill("test-password");
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await expect(page.getByRole("heading", { name: "Create your account" }))
      .toBeVisible();
    await expect(page.getByText(
      "We couldn't find an account for ui-signin-new+e2e@example.test. Create one with these details to continue.",
      { exact: true },
    )).toBeVisible();
    const clerkConsent = page.getByRole("dialog", {
      name: "Influence authentication",
    }).getByRole("checkbox");
    await expect(clerkConsent).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Create account" }))
      .toBeDisabled();
    await clerkConsent.check();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Verify your email" }))
      .toBeVisible();
    signupFull = true;
    await page.getByLabel("Verification code").fill("424242");
    await page.getByRole("button", { name: "Verify code" }).click();
    const waiting = page.getByRole("region", { name: "Signup availability" });
    await expect(waiting.getByText(/Signups are full/)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.getByLabel("Verification code")).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath("signup-full-mobile.png") });
    await page.setViewportSize({ width: 1280, height: 720 });
    signupFull = false;
    await waiting.getByRole("button", { name: "Check again" }).click();
    const challenge = page.getByRole("region", { name: "Verify to create your account" });
    await expect(challenge.getByRole("alert")).toHaveText("Verification could not load. Try again.");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await challenge.getByRole("button", { name: "Try again" }).click();
    await expect(challenge.getByRole("button", { name: "Create account" })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("signup-available.png") });
    await finishHumanVerification(page);
    await expect(challenge.getByRole("alert")).toHaveText(/temporarily unavailable/);
    await page.screenshot({ path: testInfo.outputPath("signup-verify-retry.png") });
    await finishHumanVerification(page);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.getByLabel("Display name").fill("Sign-in Recovery E2E");
    await page.getByLabel("Handle").fill("e2e-signin-recovery");
    await page.getByLabel("Handle").press("Enter");
    await expect(page.getByRole("heading", {
      name: "Choose how players know you",
    })).toBeHidden();
    await page.getByRole("button", { name: "Sign out" }).click();

    signupFull = true;
    const checksBeforePrivySignIn = signupAvailabilityChecks;
    await clickNavigationSignIn(page);
    const privyPanel = page.getByRole("dialog", { name: "Influence authentication" });
    const unlinked = privyPanel.getByRole("heading", { name: "Privy sign-in has no linked account" });
    await privyPanel.getByRole("button", { name: "Continue with Privy" }).click();
    await expect(unlinked).toBeFocused();
    await expect(privyPanel.getByText(/Signups are full/)).toHaveCount(0);
    expect(signupAvailabilityChecks).toBe(checksBeforePrivySignIn);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath("privy-unlinked-mobile.png") });
    const emailSignIn = privyPanel.getByRole("button", { name: "Sign in with email" });
    await emailSignIn.focus();
    await page.keyboard.press("Enter");
    await expect(privyPanel.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(privyPanel.getByText(/Signups are full/)).toHaveCount(0);
    await privyPanel.getByRole("button", { name: "Continue with Privy" }).click();
    await expect(unlinked).toBeVisible();
    await page.getByRole("button", {
      name: "Use a different Privy account",
    }).click();
    await expect(page.getByRole("tab", { name: "Sign in" })).toBeVisible();
    expect(await page.evaluate(
      () => window.__INFLUENCE_E2E_AUTH__?.privyToken ?? null,
    )).toBeNull();
    await page.evaluate((token) => {
      window.__INFLUENCE_E2E_AUTH__ = { privyToken: token };
    }, harness.tokens.uiNewPrivy);
    await page.getByRole("button", { name: "Continue with Privy" }).click();
    await expect(unlinked).toBeVisible();
    await privyPanel.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Create your account" }))
      .toBeVisible();
    await expect(privyPanel.getByText(/Signups are full/)).toBeVisible();
    await expect(privyPanel.getByRole("button", { name: "Back to sign in" })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({ path: testInfo.outputPath("privy-explicit-signup-full.png") });
    signupFull = false;
    await privyPanel.getByRole("button", { name: "Check again" }).click();
    const privyConsent = page.getByRole("dialog", {
      name: "Influence authentication",
    }).getByRole("checkbox");
    await expect(privyConsent).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Continue with Privy" }))
      .toBeDisabled();
    await privyConsent.check();
    await page.getByRole("button", { name: "Continue with Privy" }).click();
    await finishHumanVerification(page);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.getByLabel("Display name").fill("Privy Recovery E2E");
    await page.getByLabel("Handle").fill("e2e-privy-recovery");
    await page.getByLabel("Handle").press("Enter");
    await expect(page.getByRole("heading", {
      name: "Choose how players know you",
    })).toBeHidden();
    await page.getByRole("button", { name: "Sign out" }).click();

    signupFull = true;
    const checksBeforeLinkedPrivySignIn = signupAvailabilityChecks;
    await clickNavigationSignIn(page);
    await privyPanel.getByRole("button", { name: "Continue with Privy" }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    expect(signupAvailabilityChecks).toBe(checksBeforeLinkedPrivySignIn);
    await page.getByRole("button", { name: "Sign out" }).click();
    signupFull = false;

    await clickNavigationSignIn(page);
    await page.getByRole("tab", { name: "Create account" }).click();
    await page.getByRole("checkbox", { name: /I agree to the Terms of Use/ }).check();
    await page.getByRole("button", { name: "Continue with Privy" }).click();
    await expect(page.getByRole("heading", { name: "Account already exists" }))
      .toBeVisible();
    await page.getByRole("button", { name: "Continue with Privy" }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();

    await clickNavigationSignIn(page);
    await page.getByRole("tab", { name: "Create account" }).click();
    await page.getByLabel("Email").fill("ui-reverse@example.test");
    await page.getByLabel("Password").fill("must-be-cleared");
    await expect(page.getByRole("button", { name: "Create account" }))
      .toBeDisabled();
    await expect(page.getByRole("button", { name: "Continue with Privy" }))
      .toBeDisabled();
    await page.getByRole("checkbox", { name: /I agree to the Terms of Use/ }).check();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Account already exists" }))
      .toBeVisible();
    await page.getByRole("button", { name: "Go to sign in" }).click();
    await expect(page.getByLabel("Email")).toHaveValue("ui-reverse@example.test");
    await expect(page.getByLabel("Password")).toHaveValue("");
  });

  test("keeps verified Clerk consent bound while recovering through the invite gate", async ({
    page,
  }) => {
    const creationBodies: Array<Record<string, unknown>> = [];
    await page.route("**/api/auth/managed/create", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      creationBodies.push(body);
      if (creationBodies.length === 1) {
        await route.fulfill({
          status: 403,
          json: { error: "Invite code required", code: "INVITE_REQUIRED" },
        });
        return;
      }
      if (creationBodies.length === 2) {
        await route.fulfill({
          status: 403,
          json: {
            error: "Invalid or already used invite code",
            code: "INVALID_INVITE_CODE",
          },
        });
        return;
      }
      const existing = await fetch(`${harness.apiUrl}/api/auth/me`, {
        headers: {
          authorization: `Bearer ${harness.sessions.walletless}`,
        },
      });
      await route.fulfill({
        status: existing.status,
        contentType: "application/json",
        body: JSON.stringify({
          token: harness.sessions.walletless,
          user: await existing.json(),
        }),
      });
    });

    await page.goto(`${harness.webUrl}/get-mcp`, { waitUntil: "networkidle" });
    await clickNavigationSignIn(page);
    await page.getByRole("tab", { name: "Create account" }).click();
    await page.getByLabel("Email").fill("ui-new+e2e@example.test");
    await page.getByLabel("Password").fill("test-password");
    await page.getByRole("checkbox", { name: /I agree to the Terms of Use/ }).check();
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByLabel("Verification code").fill("424242");
    await page.getByRole("button", { name: "Verify code" }).click();

    await expect(page.getByRole("heading", { name: "Invite Code Required" }))
      .toBeVisible();
    await page.getByLabel("Invite code").fill("INVALID");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText(
      "That invite code is invalid or has already been used.",
    ))
      .toBeVisible();
    await page.getByLabel("Invite code").fill("VALID123");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    expect(creationBodies).toHaveLength(3);
    const consentKeys = [
      "acceptTerms",
      "termsVersion",
      "privacyVersion",
      "deploymentSha",
    ] as const;
    for (const key of consentKeys) {
      expect(creationBodies[1]?.[key]).toBe(creationBodies[0]?.[key]);
      expect(creationBodies[2]?.[key]).toBe(creationBodies[0]?.[key]);
    }
    expect(creationBodies[0]?.inviteCode).toBeUndefined();
    expect(creationBodies[1]?.inviteCode).toBe("INVALID");
    expect(creationBodies[2]?.inviteCode).toBe("VALID123");
  });

  test("lets a pending Privy signup hand off to the invite prompt", async ({ page }) => {
    await page.addInitScript((token) => {
      window.__INFLUENCE_E2E_AUTH__ = { privyToken: token };
    }, harness.tokens.uiNewPrivy);
    const attempts: Array<{ intent: string; inviteCode?: string; verified: boolean }> = [];
    await page.route("**/api/auth/login", async (route) => {
      const request = route.request().postDataJSON();
      attempts.push({ intent: request.intent, inviteCode: request.inviteCode, verified: Boolean(request.turnstileToken) });
      if (request.intent === "sign_in") {
        return route.fulfill({ status: 409, json: { error: "Account creation required", code: "ACCOUNT_CREATION_REQUIRED" } });
      }
      if (request.inviteCode !== "VALID123") {
        return route.fulfill({ status: 403, json: { error: "Invite code required", code: "INVITE_REQUIRED" } });
      }
      if (!request.turnstileToken) {
        return route.fulfill({ status: 403, json: {
          error: "Complete human verification to create an account.", code: "SIGNUP_VERIFICATION_REQUIRED",
        } });
      }
      const token = harness.sessions.walletless;
      const response = await fetch(`${harness.apiUrl}/api/auth/me`, {
        headers: { authorization: `Bearer ${token}` },
      });
      return route.fulfill({ status: response.status, json: { token, user: await response.json() } });
    });

    await page.goto(`${harness.webUrl}/get-mcp`, { waitUntil: "networkidle" });
    await clickNavigationSignIn(page);
    await page.getByRole("button", { name: "Continue with Privy", exact: true }).click();
    const authentication = page.getByRole("dialog", { name: "Influence authentication" });
    await authentication.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(authentication.getByRole("heading", { name: "Create your account", exact: true })).toBeVisible();
    await authentication.getByRole("checkbox").check();
    await authentication.getByRole("button", { name: "Continue with Privy", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Invite Code Required", exact: true })).toBeVisible();
    await expect(authentication).toHaveCount(0);
    await expect(page.getByText("Opening Privy…", { exact: true })).toHaveCount(0);
    await page.getByPlaceholder("e.g. ABC12345").fill("VALID123");
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    const verification = page.getByRole("region", { name: "Verify to create your account" });
    await expect(page.getByRole("dialog", { name: "Signup invite" }).getByRole("region", {
      name: "Verify to create your account",
    })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.getByLabel("Invite code", { exact: true })).toBeHidden();
    await verification.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    expect(attempts).toEqual([
      { intent: "sign_in", inviteCode: undefined, verified: false },
      { intent: "create_account", inviteCode: undefined, verified: false },
      { intent: "create_account", inviteCode: "VALID123", verified: false },
      { intent: "create_account", inviteCode: "VALID123", verified: true },
    ]);
  });

  test("keeps Privy account creation available in managed rollout modes", async ({
    browser,
  }) => {
    for (const scenario of [
      {
        mode: "existing-only" as const,
        token: harness.tokens.uiExistingOnlyPrivy,
      },
      {
        mode: "disabled" as const,
        token: harness.tokens.uiDisabledPrivy,
      },
    ]) {
      const context = await browser.newContext();
      await installTurnstileFixture(context);
      await context.addInitScript((token) => {
        window.__INFLUENCE_E2E_AUTH__ = { privyToken: token };
      }, scenario.token);
      const page = await context.newPage();
      await page.route("**/runtime-config", async (route) => {
        await route.fulfill({
          json: {
            PRIVY_APP_ID: "e2e-test-privy-app-id-001",
            CLERK_PUBLISHABLE_KEY: "pk_test_layered_auth_e2e",
            TURNSTILE_SITE_KEY: "fixture-site-key",
            MANAGED_AUTH_MODE: scenario.mode,
            API_URL: harness.apiUrl,
            WS_URL: harness.apiUrl,
            MCP_OAUTH_RESOURCE_URI: `${harness.apiUrl}/mcp`,
            ADMIN_ADDRESS: "",
            EPHEMERAL: false,
            EPHEMERAL_PR: "",
          },
        });
      });
      await page.goto(`${harness.webUrl}/get-mcp`, {
        waitUntil: "networkidle",
      });
      await clickNavigationSignIn(page);
      await page.getByRole("button", { name: "Continue with Privy" }).click();
      await page.getByRole("button", { name: "Create account", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Create your account" }))
        .toBeVisible();
      const consent = page.getByRole("dialog", {
        name: "Influence authentication",
      }).getByRole("checkbox");
      await consent.check();
      await page.getByRole("button", { name: "Continue with Privy" }).click();
      await finishHumanVerification(page);
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
      await context.close();
    }
  });

  test("shows a retryable message when Privy is unavailable", async ({ page }) => {
    await page.addInitScript((token) => {
      window.__INFLUENCE_E2E_AUTH__ = { privyToken: token };
    }, harness.tokens.uiOutagePrivy);
    await page.goto(`${harness.webUrl}/get-mcp`, { waitUntil: "networkidle" });
    await clickNavigationSignIn(page);
    await page.getByRole("button", { name: "Continue with Privy" }).click();
    await expect(page.getByText(
      "Privy is temporarily unavailable. Try again.",
      { exact: true },
    )).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Privy" }))
      .toBeVisible();
  });

  test("drives the unified browser wrapper through signup, linking, reverse collision, and outage fallback", async ({
    page,
  }) => {
    await page.addInitScript((tokens) => {
      window.__INFLUENCE_E2E_AUTH__ = {
        privyToken: tokens.uiExistingPrivy,
        walletProofToken: tokens.uiWalletPrivyFresh,
      };
    }, harness.tokens);
    await page.goto(`${harness.webUrl}/get-mcp`, {
      waitUntil: "networkidle",
    });

    await clickNavigationSignIn(page);
    await page.getByRole("tab", { name: "Create account" }).click();
    await page.getByLabel("Email").fill("ui-new+e2e@example.test");
    await page.getByLabel("Password").fill("test-password");
    await page
      .getByRole("dialog", { name: "Influence authentication" })
      .getByRole("checkbox")
      .check();
    await page
      .getByRole("dialog", { name: "Influence authentication" })
      .locator("form")
      .getByRole("button", { name: "Create account" })
      .click();
    await expect(page.getByRole("heading", { name: "Verify your email" }))
      .toBeVisible();
    await page.getByLabel("Verification code").fill("424242");
    await page.getByRole("button", { name: "Verify code" }).click();
    await finishHumanVerification(page);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("heading", {
      name: "Choose how players know you",
    })).toBeVisible();
    await page.getByLabel("Display name").fill("Layered Auth E2E");
    await page.getByLabel("Handle").fill("e2e-layered-auth");
    await page.getByLabel("Handle").press("Enter");
    await expect(page.getByRole("heading", {
      name: "Choose how players know you",
    })).toBeHidden();

    await page.getByRole("button", { name: "Sign out" }).click();
    await clickNavigationSignIn(page);
    await page.getByLabel("Email").fill("ui-new+e2e@example.test");
    await page.getByLabel("Password").fill("test-password");
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await clickNavigationSignIn(page);
    await page.getByLabel("Email").fill("ui-existing@example.test");
    await page.getByLabel("Password").fill("test-password");
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await expect(page.getByRole("heading", {
      name: "Link this sign-in to your account?",
    })).toBeVisible();
    await page.getByRole("button", { name: "Link email/password" }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.evaluate((token) => {
      window.__INFLUENCE_E2E_AUTH__ = { privyToken: token };
    }, harness.tokens.uiReversePrivy);
    await clickNavigationSignIn(page);
    await page.getByRole("button", { name: "Continue with Privy" }).click();
    await expect(page.getByRole("heading", {
      name: "Link Privy to your account?",
    })).toBeVisible();
    await page.getByRole("button", {
      name: "Continue with email/password",
    }).click();
    await page.getByLabel("Email").fill("ui-reverse@example.test");
    await page.getByLabel("Password").fill("test-password");
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await expect(page.getByRole("heading", {
      name: "Accept the Terms to continue",
    })).toBeVisible();
    await page.getByRole("checkbox", { name: /I agree to the Terms of Use/ }).check();
    await page.getByRole("button", { name: "Accept and link Privy" }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await clickNavigationSignIn(page);
    await page.getByLabel("Email").fill("ui-outage@example.test");
    await page.getByLabel("Password").fill("test-password");
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await expect(page.getByRole("dialog", { name: "Influence authentication" }).getByRole("alert"))
      .toHaveText("Request failed (HTTP 503).");
    await page.evaluate((token) => {
      window.__INFLUENCE_E2E_AUTH__ = { privyToken: token };
    }, harness.tokens.uiExistingPrivy);
    await page.getByRole("button", { name: "Continue with Privy" }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("shows wallet reauthentication and permits a later fresh retry", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await context.addInitScript(({ session, expiredProof }) => {
      localStorage.setItem("influence_session", session);
      window.__INFLUENCE_E2E_AUTH__ = {
        walletProofToken: expiredProof,
      };
    }, {
      session: harness.sessions.uiWalletOwner,
      expiredProof: harness.tokens.uiWalletPrivyExpired,
    });
    const page = await context.newPage();
    await page.goto(`${harness.webUrl}/dashboard`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("button", { name: /Settings/ }).click();
    await page.getByRole("button", { name: "Add email/password" }).click();
    await expect(page.getByRole("heading", { name: "Add email/password" }))
      .toBeVisible();
    await page.getByLabel("Email").fill("ui-wallet@example.test");
    await page.getByLabel("Password").fill("test-password");
    await page.getByRole("button", { name: "Verify and link" }).click();
    await page.getByLabel("Verification code").fill("424242");
    await page.getByRole("button", { name: "Verify code" }).click();
    await page.getByRole("button", { name: "Link email/password" }).click();
    await expect(page.getByRole("heading", {
      name: "Verify your wallet account",
    })).toBeVisible();

    await page.getByRole("button", { name: "Continue with Privy" }).click();
    await expect(page.getByRole("heading", {
      name: "Verify your wallet account",
    })).toBeVisible();
    await page.evaluate((token) => {
      window.__INFLUENCE_E2E_AUTH__ = { walletProofToken: token };
    }, harness.tokens.uiWalletPrivyFresh);
    await page.getByRole("button", { name: "Continue with Privy" }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await context.close();
  });

  test("creates a walletless account and returns to it through managed login", async ({
    request,
  }) => {
    const before = await authRequest(
      request,
      harness,
      "/api/auth/managed/exchange",
      { token: harness.tokens.newManaged },
    );
    expect(before.status()).toBe(409);
    expect(await before.json()).toMatchObject({
      code: "ACCOUNT_CREATION_REQUIRED",
    });

    const created = await authRequest(
      request,
      harness,
      "/api/auth/managed/create",
      {
        token: harness.tokens.newManaged,
        acceptTerms: true,
        termsVersion: "2026-11-12",
        privacyVersion: "2026-11-12",
        deploymentSha: "unknown",
      },
    );
    expect(created.status()).toBe(200);
    const createdBody = await created.json();
    expect(createdBody.user).toMatchObject({
      walletAddress: null,
      loginMethods: { privy: false, emailPassword: true },
    });

    const loggedInAgain = await authRequest(
      request,
      harness,
      "/api/auth/managed/exchange",
      { token: harness.tokens.newManaged },
    );
    expect(loggedInAgain.status()).toBe(200);
    expect((await loggedInAgain.json()).user.id).toBe(createdBody.user.id);
  });

  test("links email and wallet-owned Privy accounts without duplicate users", async ({
    request,
  }) => {
    const emailCollision = await authRequest(
      request,
      harness,
      "/api/auth/managed/exchange",
      { token: harness.tokens.existingEmailManaged },
    );
    expect(emailCollision.status()).toBe(409);
    expect(await emailCollision.json()).toMatchObject({
      code: "ACCOUNT_LINK_CONFIRMATION_REQUIRED",
    });
    const emailLinked = await authRequest(
      request,
      harness,
      "/api/auth/managed/link",
      { token: harness.tokens.existingEmailManaged, confirm: true },
    );
    expect(emailLinked.status()).toBe(200);
    expect((await emailLinked.json()).user.id).toBe(harness.users.existingEmail);

    const expiredWalletProof = await authRequest(
      request,
      harness,
      "/api/auth/managed/link",
      {
        token: harness.tokens.walletManaged,
        privyToken: harness.tokens.walletPrivyExpired,
        confirm: true,
      },
      harness.sessions.walletOwner,
    );
    expect(expiredWalletProof.status()).toBe(401);
    expect(await expiredWalletProof.json()).toMatchObject({
      code: "WALLET_REAUTH_REQUIRED",
    });

    const walletLinked = await authRequest(
      request,
      harness,
      "/api/auth/managed/link",
      {
        token: harness.tokens.walletManaged,
        privyToken: harness.tokens.walletPrivyFresh,
        confirm: true,
      },
      harness.sessions.walletOwner,
    );
    expect(walletLinked.status()).toBe(200);
    expect((await walletLinked.json()).user.id).toBe(harness.users.walletOwner);
  });

  test("requires password proof and confirmation for a reverse Privy collision", async ({
    request,
  }) => {
    const collision = await authRequest(
      request,
      harness,
      "/api/auth/login",
      { token: harness.tokens.reversePrivy, intent: "sign_in" },
    );
    expect(collision.status()).toBe(409);
    expect(await collision.json()).toMatchObject({
      code: "ACCOUNT_LINK_REQUIRED",
    });

    const passwordProof = await authRequest(
      request,
      harness,
      "/api/auth/managed/exchange",
      { token: harness.tokens.reverseManaged },
    );
    expect(passwordProof.status()).toBe(200);
    const passwordSession = await passwordProof.json();

    const pendingLink = await authRequest(
      request,
      harness,
      "/api/auth/privy/link",
      { token: harness.tokens.reversePrivy, confirm: true },
      passwordSession.token,
    );
    expect(pendingLink.status()).toBe(403);
    expect(await pendingLink.json()).toMatchObject({
      code: "LEGAL_ACCEPTANCE_REQUIRED",
    });

    const acceptance = await authRequest(
      request,
      harness,
      "/api/auth/legal-acceptance",
      {
        acceptTerms: true,
        termsVersion: "2026-11-12",
        privacyVersion: "2026-11-12",
        deploymentSha: "unknown",
      },
      passwordSession.token,
    );
    expect(acceptance.status()).toBe(200);
    const acceptedSession = await acceptance.json();

    const linked = await authRequest(
      request,
      harness,
      "/api/auth/privy/link",
      { token: harness.tokens.reversePrivy, confirm: true },
      acceptedSession.token,
    );
    expect(linked.status()).toBe(200);
    expect((await linked.json()).user).toMatchObject({
      id: harness.users.reverseOwner,
      loginMethods: { privy: true, emailPassword: true },
    });
  });

  test("keeps Privy usable during a managed-provider outage and gates modes", async ({
    request,
  }) => {
    const outage = await authRequest(
      request,
      harness,
      "/api/auth/managed/exchange",
      { token: harness.tokens.providerOutage },
    );
    expect(outage.status()).toBe(503);

    const privy = await authRequest(
      request,
      harness,
      "/api/auth/login",
      { token: harness.tokens.existingPrivy, intent: "sign_in" },
    );
    expect(privy.status()).toBe(200);
    expect((await privy.json()).user.id).toBe(harness.users.existingEmail);

    const existingOnlyLogin = await authRequest(
      request,
      harness,
      "/e2e/existing-only/api/auth/managed/exchange",
      { token: harness.tokens.reverseManaged },
    );
    expect(existingOnlyLogin.status()).toBe(200);
    const existingOnlyCreate = await authRequest(
      request,
      harness,
      "/e2e/existing-only/api/auth/managed/create",
      {
        token: "clerk:unused",
        acceptTerms: true,
        termsVersion: "2026-11-12",
        privacyVersion: "2026-11-12",
        deploymentSha: "unknown",
      },
    );
    expect(existingOnlyCreate.status()).toBe(403);
    const disabled = await authRequest(
      request,
      harness,
      "/e2e/disabled/api/auth/managed/exchange",
      { token: harness.tokens.reverseManaged },
    );
    expect(disabled.status()).toBe(404);
  });

  test("expires a bad Influence session and completes unchanged OAuth consent", async ({
    browser,
  }) => {
    const expiredContext = await browser.newContext();
    await expiredContext.addInitScript(() => {
      localStorage.setItem("influence_session", "expired-influence-session");
    });
    const expiredPage = await expiredContext.newPage();
    await expiredPage.goto(`${harness.webUrl}/get-mcp`, {
      waitUntil: "networkidle",
    });
    await expect(
      expiredPage
        .getByRole("navigation")
        .getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
    expect(await expiredPage.evaluate(
      () => localStorage.getItem("influence_session"),
    )).toBeNull();
    await expiredContext.close();

    const context = await browser.newContext();
    await context.addInitScript((token) => {
      localStorage.setItem("influence_session", token);
    }, harness.sessions.walletless);
    const page = await context.newPage();
    await page.route(`${REDIRECT_URI}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<title>OAuth callback received</title>",
      });
    });
    const verifier = "layered-authentication-e2e-verifier";
    const authorizeUrl = new URL(`${harness.webUrl}/oauth/mcp/authorize`);
    authorizeUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: "influence-game-mcp-local",
      redirect_uri: REDIRECT_URI,
      resource: `${harness.apiUrl}/mcp`,
      scope: "agents:read games:read",
      state: "layered-auth-state",
      code_challenge: pkceS256(verifier),
      code_challenge_method: "S256",
    }).toString();

    await page.goto(authorizeUrl.toString(), { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Review and accept" }))
      .toBeVisible();
    const agreeButton = page.getByRole("button", { name: "Accept and continue" });
    await expect(agreeButton).toBeDisabled();
    await page.getByRole("checkbox", { name: /I agree to the Terms of Use/ }).check();
    await expect(agreeButton).toBeEnabled();
    await agreeButton.click();
    await expect(page.getByRole("heading", { name: "Game MCP Access" }))
      .toBeVisible();
    await expect(page.getByText("No wallet", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page).toHaveURL(/oauth\/callback\?.*code=/);
    const callback = new URL(page.url());
    expect(callback.searchParams.get("state")).toBe("layered-auth-state");
    expect(callback.searchParams.get("code")).toBeTruthy();
    await context.close();
  });

  test("admin finds an account and confirms deletion by profile name", async ({ page }, testInfo) => {
    await page.addInitScript(token => localStorage.setItem("influence_session", token), harness.sessions.accountOperator);
    await page.goto(`${harness.webUrl}/admin/users`);
    const targetName = "A Long Profile Name For Mobile Confirmation Proof";
    const email = page.getByLabel("Find by email");
    await expect(page.getByRole("link", { name: targetName, exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("directory-desktop.png") });
    await email.fill("Support-Target@Example.Test");
    await page.getByRole("button", { name: "Find user" }).click({ timeout: 10000 });
    await expect(page).toHaveURL(/\/admin\/users\/[0-9a-f-]+$/, { timeout: 30000 });
    await expect(page.getByRole("heading", { name: targetName })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("heading", { name: "Sign-in providers" })).toBeVisible();
    await expect(page.getByText("Privy", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("account-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Delete this account?" });
    const input = confirmation.getByRole("textbox");
    await expect(input).toBeFocused();
    await input.fill("Wrong name");
    await expect(confirmation.getByRole("button", { name: "Delete account" })).toBeDisabled();
    await input.press("Escape");
    await expect(confirmation).toBeHidden();
    await expect(page.getByRole("button", { name: "Delete account", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    await input.fill(targetName);
    await expect(confirmation.getByRole("button", { name: "Delete account" })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("account-confirmation-mobile.png"), fullPage: true });
    await confirmation.getByRole("button", { name: "Delete account" }).click();
    await expect(page.getByText(/Account closed on/)).toBeVisible();
  });

});

test.describe("real Clerk development project", () => {
  test.skip(
    !REAL_CLERK_RUN,
    "Use bun run test:e2e:layered-auth:clerk with development-instance credentials.",
  );
  test.describe.configure({ mode: "serial", retries: 0 });

  const requiredEnvironment = [
    "CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
    "CLERK_JWT_KEY",
    "PLAYWRIGHT_BASE_URL",
  ] as const;
  const missingEnvironment = requiredEnvironment.filter(
    (name) => !process.env[name]?.trim(),
  );
  const disposableEnvironment =
    process.env.CLERK_E2E_DISPOSABLE_ENVIRONMENT === "1";
  const email = `influence-${randomUUID()}+clerk_test@example.com`;
  const initialPassword = `E2E-${randomUUID()}-aA1!`;
  const resetPassword = `Reset-${randomUUID()}-bB2!`;
  const profileHandle = `clerk-${randomUUID().slice(0, 8)}`;

  test.beforeAll(async () => {
    if (missingEnvironment.length > 0 || !disposableEnvironment) return;
    await clerkSetup({
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    });
  });

  test.afterAll(async () => {
    if (missingEnvironment.length > 0 || !disposableEnvironment) return;
    const { createClerkClient } = await import("@clerk/backend");
    const client = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    const users = await client.users.getUserList({
      emailAddress: [email],
      limit: 10,
    });
    await Promise.all(users.data.map((user) => client.users.deleteUser(user.id)));
  });

  test("signs up, logs out/in, and resets with Clerk test credentials @real-clerk", async ({
    browser,
    page,
  }) => {
    test.skip(
      missingEnvironment.length > 0,
      `Missing real Clerk environment: ${missingEnvironment.join(", ")}`,
    );
    test.skip(
      !disposableEnvironment,
      "Real Clerk tests require a disposable Influence database.",
    );
    await setupClerkTestingToken({ page });
    await page.goto("/sign-up");
    await expect(page.getByRole("heading", {
      name: "Create account",
    })).toBeVisible();
    const authenticationDialog = page.getByRole("dialog", {
      name: "Influence authentication",
    });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(initialPassword);
    await authenticationDialog.getByRole("checkbox").check();
    await authenticationDialog
      .locator("form")
      .getByRole("button", { name: "Create account" })
      .click();
    await page.getByLabel("Verification code").fill("424242");
    await page.getByRole("button", { name: "Verify code" }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("heading", {
      name: "Choose how players know you",
    })).toBeVisible();
    await page.getByLabel("Display name").fill("Clerk E2E");
    await page.getByLabel("Handle").fill(profileHandle);
    await page.getByRole("button", { name: "Create public profile" }).click();
    await expect(page.getByRole("heading", {
      name: "Choose how players know you",
    })).toBeHidden();

    await page.getByRole("button", { name: "Sign out" }).click();
    const signInContext = await browser.newContext();
    const signInPage = await signInContext.newPage();
    await setupClerkTestingToken({ page: signInPage });
    await signInPage.goto("/sign-in");
    await signInPage.getByLabel("Email").fill(email);
    await signInPage.getByLabel("Password").fill(initialPassword);
    await signInPage
      .getByRole("button", { name: "Sign in with email" })
      .click();
    await expect(
      signInPage.getByRole("button", { name: "Sign out" }),
    ).toBeVisible();

    await signInPage.getByRole("button", { name: "Sign out" }).click();
    await clickNavigationSignIn(signInPage);
    await signInPage.getByRole("button", { name: "Forgot password?" }).click();
    await signInPage.getByLabel("Email").fill(email);
    await signInPage.getByRole("button", { name: "Send reset code" }).click();
    await signInPage.getByLabel("Verification code").fill("424242");
    await signInPage.getByRole("button", { name: "Verify code" }).click();
    await signInPage.getByLabel("New password").fill(resetPassword);
    await signInPage.getByRole("button", { name: "Reset password" }).click();

    await expect(
      signInPage.getByRole("button", { name: "Sign out" }),
    ).toBeVisible();
    await signInPage.getByRole("button", { name: "Sign out" }).click();
    await clickNavigationSignIn(signInPage);
    await signInPage.getByLabel("Email").fill(email);
    await signInPage.getByLabel("Password").fill(resetPassword);
    await signInPage
      .getByRole("button", { name: "Sign in with email" })
      .click();
    await expect(
      signInPage.getByRole("button", { name: "Sign out" }),
    ).toBeVisible();
    await signInContext.close();
  });
});

async function authRequest(
  request: APIRequestContext,
  harness: LayeredAuthHarness,
  path: string,
  body: Record<string, unknown>,
  influenceToken?: string,
) {
  return request.post(`${harness.apiUrl}${path}`, {
    headers: influenceToken
      ? { Authorization: `Bearer ${influenceToken}` }
      : undefined,
    data: path === "/api/auth/managed/create" ? { ...body, turnstileToken: randomUUID() } : body,
  });
}

function pkceS256(verifier: string): string {
  return createHash("sha256")
    .update(verifier)
    .digest("base64url");
}

async function finishHumanVerification(page: import("@playwright/test").Page) {
  await page.getByRole("region", { name: "Verify to create your account" })
    .getByRole("button", { name: "Create account" }).click();
}

async function installTurnstileFixture(context: BrowserContext) {
  await context.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", route =>
    route.fulfill({ contentType: "application/javascript", body: `
      window.turnstile = {
        render(_target, options) {
          queueMicrotask(() => options.callback(crypto.randomUUID()));
          return "fixture-widget";
        },
        remove() {}
      };
    ` }));
}

async function clickNavigationSignIn(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
}

async function startHarness(): Promise<{
  process: LocalHarnessProcess;
  harness: LayeredAuthHarness;
}> {
  return startLocalHarness<LayeredAuthHarness>({
    script: "packages/api/src/e2e/layered-authentication-harness.ts",
    readyPrefix: "E2E_LAYERED_AUTH_READY ",
    startupTimeoutMs: 100_000,
    errorLabel: "Layered auth harness exited before ready.",
  });
}

async function stopHarness(
  child: LocalHarnessProcess,
): Promise<void> {
  await stopLocalHarness(child);
}
