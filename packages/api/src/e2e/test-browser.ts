/**
 * E2E Test Puppeteer Helpers
 *
 * Browser launch, JWT injection, and page navigation utilities
 * for e2e browser tests.
 */

import puppeteer, { type Browser, type Page } from "puppeteer";
import { injectWalletProvider } from "./test-wallet-provider.js";

/**
 * Launch a headless Puppeteer browser instance.
 */
export async function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
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
  await browser.close();
}
