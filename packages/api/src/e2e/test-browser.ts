/**
 * E2E Test Puppeteer Helpers
 *
 * Browser launch, JWT injection, and page navigation utilities
 * for e2e browser tests.
 */

import puppeteer, { type Browser, type Page } from "puppeteer";
import { existsSync } from "node:fs";
import { injectWalletProvider } from "./test-wallet-provider.js";

/**
 * Launch a headless Puppeteer browser instance.
 */
export async function launchBrowser(): Promise<Browser> {
  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return puppeteer.launch({
    headless: true,
    ...(existsSync(macChrome) ? { executablePath: macChrome } : {}),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
}

/**
 * Create a new page with an authenticated session.
 *
 * Injects the JWT into localStorage and optionally sets up an EIP-1193
 * wallet provider via `evaluateOnNewDocument`, so both are available
 * when the app boots on the first navigation (no reload needed).
 */
export async function createAuthenticatedPage(
  browser: Browser,
  jwt: string,
  webUrl: string,
  opts?: { privateKey?: `0x${string}` },
): Promise<Page> {
  const page = await browser.newPage();

  // Inject JWT into localStorage before the page loads
  await page.evaluateOnNewDocument((token: string) => {
    localStorage.setItem("influence_session", token);
  }, jwt);

  // Optionally inject EIP-1193 wallet provider for full wallet auth in e2e
  if (opts?.privateKey) {
    await injectWalletProvider(page, opts.privateKey);
  }

  // Navigate — app boots with JWT and provider already available
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });

  return page;
}

/**
 * Create an anonymous (unauthenticated) page in an incognito context.
 */
export async function createAnonymousPage(
  browser: Browser,
  webUrl: string,
): Promise<Page> {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  return page;
}

/**
 * Close the browser and clean up all associated pages and contexts.
 */
export async function closeBrowser(browser: Browser): Promise<void> {
  const child = browser.process();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const closing = browser.close().then(() => ({error: null}), error => ({error: error instanceof Error ? error : new Error(String(error))}));
  try {
    const result = await Promise.race([closing, new Promise<null>(resolve => {timer = setTimeout(() => resolve(null), 5_000);})]);
    if (result) {if (result.error) throw result.error; return;}
    if (!child) throw new Error("Browser close timed out without an owned process to terminate");
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      let onExit!: () => void;
      const exited = new Promise<void>(resolve => {onExit = resolve; child.once("exit", onExit);});
      try {
        child.kill("SIGKILL"); browser.disconnect();
        await Promise.race([exited, new Promise<never>((_, reject) => {timer = setTimeout(() => reject(new Error("Owned browser did not exit after forced shutdown")), 5_000);})]);
      } finally {child.off("exit", onExit);}
    } else browser.disconnect();
    console.warn("Graceful browser close timed out; terminated the owned browser before continuing cleanup.");
  } finally {clearTimeout(timer);}
}
