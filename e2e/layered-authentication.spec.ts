import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  clerkSetup,
  setupClerkTestingToken,
} from "@clerk/testing/playwright";

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
  };
}

test.describe("deterministic layered authentication", () => {
  test.skip(
    !DETERMINISTIC_RUN,
    "Use bun run test:e2e:layered-auth for injected provider adapters.",
  );
  test.describe.configure({ mode: "serial", retries: 0 });

  let harnessProcess: ChildProcessWithoutNullStreams;
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
    await page.getByRole("button", {
      name: "Create an email/password account",
    }).click();
    await page.getByLabel("Email").fill("ui-new+e2e@example.test");
    await page.getByLabel("Password").fill("test-password");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Verify your email" }))
      .toBeVisible();
    await page.getByLabel("Verification code").fill("424242");
    await page.getByRole("button", { name: "Verify code" }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("heading", {
      name: "Choose how players know you",
    })).toBeVisible();
    await page.getByLabel("Display name").fill("Layered Auth E2E");
    await page.getByLabel("Handle").fill("e2e-layered-auth");
    await page.getByRole("button", { name: "Create public profile" }).click();
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
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await clickNavigationSignIn(page);
    await page.getByLabel("Email").fill("ui-outage@example.test");
    await page.getByLabel("Password").fill("test-password");
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await expect(page.getByText(
      "Authentication provider is temporarily unavailable",
      { exact: true },
    )).toBeVisible();
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
    await page.goto(`${harness.webUrl}/get-mcp`, {
      waitUntil: "networkidle",
    });
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("auth:open-link-password"));
    });
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
      code: "ACCOUNT_SETUP_INCOMPLETE",
    });

    const created = await authRequest(
      request,
      harness,
      "/api/auth/managed/create",
      { token: harness.tokens.newManaged, confirm: true },
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
      { token: harness.tokens.reversePrivy },
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

    const linked = await authRequest(
      request,
      harness,
      "/api/auth/privy/link",
      { token: harness.tokens.reversePrivy, confirm: true },
      passwordSession.token,
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
      { token: harness.tokens.existingPrivy },
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
      { token: "clerk:unused", confirm: true },
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
    await page.goto("/");
    await clickNavigationSignIn(page);
    await page.getByRole("button", {
      name: "Create an email/password account",
    }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(initialPassword);
    await page.getByRole("button", { name: "Create account" }).click();
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
    await clickNavigationSignIn(page);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(initialPassword);
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await clickNavigationSignIn(page);
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset code" }).click();
    await page.getByLabel("Verification code").fill("424242");
    await page.getByRole("button", { name: "Verify code" }).click();
    await page.getByLabel("New password").fill(resetPassword);
    await page.getByRole("button", { name: "Reset password" }).click();

    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await clickNavigationSignIn(page);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(resetPassword);
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
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
    data: body,
  });
}

function pkceS256(verifier: string): string {
  return createHash("sha256")
    .update(verifier)
    .digest("base64url");
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
  process: ChildProcessWithoutNullStreams;
  harness: LayeredAuthHarness;
}> {
  const child = spawn(
    "bun",
    ["run", "packages/api/src/e2e/layered-authentication-harness.ts"],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stderrTail = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-16_384);
  });
  const lines = createInterface({ input: child.stdout });
  const timeout = setTimeout(() => child.kill("SIGTERM"), 100_000);
  try {
    for await (const line of lines) {
      if (!line.startsWith("E2E_LAYERED_AUTH_READY ")) continue;
      return {
        process: child,
        harness: JSON.parse(
          line.slice("E2E_LAYERED_AUTH_READY ".length),
        ) as LayeredAuthHarness,
      };
    }
  } finally {
    clearTimeout(timeout);
    lines.close();
  }
  throw new Error(
    `Layered auth harness exited before ready.\n${stderrTail}`.trim(),
  );
}

async function stopHarness(
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
