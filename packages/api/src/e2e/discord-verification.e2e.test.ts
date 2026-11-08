import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import { createSessionToken } from "../middleware/auth.js";
import { createDiscordRoutes } from "../routes/discord.js";
import { claimDiscordRoleWork, completeDiscordRoleWork } from "../services/discord-verification.js";
import { recordCurrentLegalAcceptance } from "../services/legal-acceptance.js";
import { createIsolatedTestDb, destroyIsolatedTestDb, type TestDB } from "./test-db.js";
import { startTestServers, stopTestServers, type TestServerHandles } from "./test-server.js";
import { cleanupE2eResources } from "./cleanup.js";

let database: TestDB, servers: TestServerHandles, browser: Browser;
let token: string;
const secret = "discord-browser-fixture";
const previousSecret = process.env.JWT_SECRET;
const guildId = "1521918107554152468";
const screenshots = new URL("../../../../.renders/discord-verification/", import.meta.url).pathname;
beforeAll(async () => {
  process.env.JWT_SECRET = secret;
  database = await createIsolatedTestDb();
  await database.db.insert(schema.users).values({ id: "discord-browser", displayName: "House Operator", handle: "house-operator", createdAt: "2026-01-01T00:00:00Z" });
  const [sysop] = await database.db.select().from(schema.roles).where(eq(schema.roles.name, "sysop"));
  await database.db.insert(schema.userRoles).values({ userId: "discord-browser", roleId: sysop!.id });
  await recordCurrentLegalAcceptance(database.db, "discord-browser", "existing_account", "0123456789abcdef0123456789abcdef01234567");
  token = await createSessionToken("discord-browser");
  servers = await startTestServers({ databaseUrl: database.databaseUrl, jwtSecret: secret, logDirectory: "/private/tmp/house-discord-browser" });
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  browser = await chromium.launch({ ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  await mkdir(screenshots, { recursive: true });
}, 240_000);
afterAll(async () => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
  await cleanupE2eResources([
    ["browser", async () => { if (browser) await browser.close(); }],
    ["servers", async () => { if (servers) await stopTestServers(servers); }],
    ["database", async () => { if (database) await destroyIsolatedTestDb(database.databaseUrl); }],
  ]);
}, 60_000);

test("website verification confirms the right account, persists roles, refreshes and disconnects", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const app = createDiscordRoutes(database.db, { config: () => ({ applicationId: "1521918515752472606", clientSecret: "fixture",
    guildId, redirectUri: `${servers.webUrl}/discord/callback` }), exchange: async () => ({ id: "931691901592145930", username: "flick-fixture" }) });
  await page.addInitScript(() => localStorage.setItem("house:analytics-consent", JSON.stringify({ version: 1, analytics: false })));
  // Exercise the real route/service/database with a deterministic Discord boundary.
  await page.route("**/api/discord/**", async route => {
    const request = route.request();
    const response = await app.request(new URL(request.url()).pathname, { method: request.method(), headers: request.headers(), body: request.postData() ?? undefined });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
  });
  await page.route("https://discord.com/oauth2/authorize**", async route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("scope")).toBe("identify");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const callback = new URL(`${servers.webUrl}/discord/callback`);
    callback.search = new URLSearchParams({ code: "fixture-code", state: url.searchParams.get("state")!, iss: "https://discord.com" }).toString();
    await route.fulfill({ status: 302, headers: { location: callback.href }, body: "" });
  });
  try {
    await page.goto(`${servers.webUrl}/discord/verify`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Sign in", exact: true }).waitFor({ timeout: 90_000 });
    // Simulate the existing authentication provider's accepted session, not a Discord login.
    await page.evaluate(value => localStorage.setItem("influence_session", value), token);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Connect Discord", exact: true }).click({ timeout: 60_000 });
    await page.getByRole("button", { name: "Confirm connection", exact: true }).waitFor({ timeout: 60_000 });
    expect(await page.locator("main").innerText()).toContain("@flick-fixture");
    expect(await page.locator("main").innerText()).toContain("@house-operator");
    expect(new URL(page.url()).search).toBe("");
    expect((await database.db.select().from(schema.discordConnections)).length).toBe(0);
    await page.screenshot({ path: `${screenshots}/confirm-mobile.png`, fullPage: true });
    await page.getByRole("button", { name: "Confirm connection", exact: true }).click();
    await page.getByText("Your account is connected. Server roles are waiting to be applied.", { exact: true }).waitFor();
    const work = await claimDiscordRoleWork(database.db, guildId);
    expect(work!.roles).toEqual(["user", "moderator", "admin", "sysop"]);
    await completeDiscordRoleWork(database.db, work!);
    await page.getByText("Your last requested role update is complete. Refresh roles to apply any House role changes.", { exact: true }).waitFor({ timeout: 10_000 });
    await page.screenshot({ path: `${screenshots}/connected-mobile.png`, fullPage: true });
    expect(await page.evaluate(() => {
      const browser = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number };
      return browser.document.documentElement.scrollWidth <= browser.innerWidth;
    })).toBe(true);
    await page.getByRole("button", { name: "Refresh roles", exact: true }).click();
    await page.getByText("Your account is connected. Server roles are waiting to be applied.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await page.getByRole("button", { name: "Confirm disconnect", exact: true }).click();
    await page.getByText("Disconnecting: removing your managed server roles.", { exact: true }).waitFor();
    const cleanup = await claimDiscordRoleWork(database.db, guildId);
    expect(cleanup!.roles).toEqual([]);
    await completeDiscordRoleWork(database.db, cleanup!);
    await page.getByRole("button", { name: "Connect Discord", exact: true }).waitFor({ timeout: 10_000 });
    expect(errors).toEqual([]);
  } catch (error) {
    await page.screenshot({ path: `${screenshots}/failure.png`, fullPage: true });
    console.error("Discord browser fixture failure:", await page.locator("main").innerText(), errors);
    throw error;
  } finally { await page.close(); }
}, 180_000);
