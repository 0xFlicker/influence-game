/**
 * E2E Test Puppeteer Helpers
 *
 * Browser launch, JWT injection, and page navigation utilities
 * for e2e browser tests.
 */

import puppeteer, { type Browser, type Page } from "puppeteer";

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
 * Navigates to the web app origin, injects the JWT into localStorage
 * using the same key the frontend uses (`influence_session`), then
 * reloads to pick up the auth state.
 */
export async function createAuthenticatedPage(
  browser: Browser,
  jwt: string,
  webUrl: string,
): Promise<Page> {
  const page = await browser.newPage();

  // Navigate to the app first so we can set localStorage on the correct origin
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });

  // Inject JWT into localStorage (matches TOKEN_KEY in packages/web/src/lib/api.ts)
  await page.evaluate((token: string) => {
    localStorage.setItem("influence_session", token);
  }, jwt);

  // Reload to pick up the authenticated session
  await page.reload({ waitUntil: "domcontentloaded" });

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
