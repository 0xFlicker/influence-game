import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { Browser, Page } from "puppeteer";
import { schema } from "../db/index.js";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";
import { recordCurrentLegalAcceptance } from "../services/legal-acceptance.js";
import { createAdminUser, createPlayerUser, mintTestJwt, assignRole, type PlayerUserResult } from "./test-auth.js";
import { closeBrowser, createAuthenticatedPage, launchBrowser } from "./test-browser.js";
import { createIsolatedTestDb, destroyIsolatedTestDb, type TestDB } from "./test-db.js";
import { startTestServers, stopTestServers, type TestServerHandles } from "./test-server.js";
import { cleanupE2eResources } from "./cleanup.js";

process.env.JWT_SECRET = "e2e-test-jwt-secret";
let database: TestDB;
let servers: TestServerHandles;
let browser: Browser;
let adminUser: Awaited<ReturnType<typeof createAdminUser>>;
let moderator: PlayerUserResult;
let owner: PlayerUserResult;
let profileId: string;
let reviewId: string;
beforeAll(async () => {
  database = await createIsolatedTestDb();
  const admin = await createAdminUser(database.db); adminUser = admin;
  moderator = await createPlayerUser(database.db, 0);
  owner = await createPlayerUser(database.db, 1);
  await assignRole(database.db, { walletAddress: moderator.wallet.address, roleName: "moderator" });
  moderator.jwt = await mintTestJwt(moderator.userId, { roles: ["moderator"], permissions: ["review_agent_content", "join_game"] });
  for (const userId of [moderator.userId, owner.userId, admin.userId]) await recordCurrentLegalAcceptance(database.db, userId, "existing_account", "0123456789abcdef0123456789abcdef01234567");
  const agent = await createOwnedAgentProfile(database.db, { userId: owner.userId }, { name: "Review Character", personality: "First submitted personality", gender: "non-binary" });
  profileId = agent.profile.id; reviewId = agent.receipt.moderationRecordId!;
  servers = await startTestServers({ databaseUrl: database.databaseUrl, adminAddress: admin.wallet.address, jwtSecret: process.env.JWT_SECRET, logDirectory: "/tmp/moderation-browser-logs" });
  browser = await launchBrowser();
}, 120_000);
afterAll(async () => {
  await cleanupE2eResources([
    ["browser", async () => { if (browser) await closeBrowser(browser); }],
    ["servers", async () => { if (servers) await stopTestServers(servers); }],
    ["database", async () => { if (database) await destroyIsolatedTestDb(database.databaseUrl); }],
  ]);
}, 60000);
async function text(page: Page, value: string) {
  await page.waitForFunction(`document.body.innerText.includes(${JSON.stringify(value)})`, { timeout: 20000 });
}
async function click(page: Page, label: string) {
  await page.waitForFunction(`Array.from(document.querySelectorAll("button")).some(b => b.textContent?.trim() === ${JSON.stringify(label)} && !b.disabled)`);
  await page.evaluate(`Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === ${JSON.stringify(label)})?.click()`);
}
test("moderator claims, previews and rejects; owner recovers a held correction after reload", async () => {
  const page = await createAuthenticatedPage(browser, moderator.jwt, `${servers.webUrl}/moderation`, { privateKey: moderator.wallet.privateKey });
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await text(page, "Review Character");
    await page.waitForSelector('nav a[href="/moderation"]');
    await click(page, "Take next");
    await text(page, "Your claim:");
    await page.type("textarea", "Remove this submitted revision");
    await click(page, "Reject — remove revision");
    await text(page, "Character will be unavailable for future games.");
    await page.screenshot({ path: "/tmp/moderation-desktop.png", fullPage: true });
    await click(page, "Confirm decision");
    await text(page, "Decision recorded.");
    const [profile] = await database.db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, profileId));
    expect(profile!.contentRevisionId).toBeNull();
    const denied = await fetch(`${servers.apiUrl}/api/moderation/reviews/${reviewId}`, { headers: { Authorization: `Bearer ${owner.jwt}` } });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("cache-control")).toContain("no-store");
  } finally { await page.close(); }
  const editor = await createAuthenticatedPage(browser, owner.jwt, `${servers.webUrl}/dashboard/agents/${profileId}/edit`, { privateKey: owner.wallet.privateKey });
  try {
    await editor.waitForSelector("#agent-personality");
    await editor.focus("#agent-personality");
    await editor.keyboard.down("Control"); await editor.keyboard.press("KeyA"); await editor.keyboard.up("Control");
    await editor.evaluate(`(() => { const el = document.querySelector("#agent-personality"); if (el) { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; setter.call(el, "Recovered correction"); el.dispatchEvent(new Event("input", { bubbles: true })); } })()`);
    await click(editor, "Save changes");
    await text(editor, "Submitted for review");
    await editor.reload({ waitUntil: "networkidle0" });
    await editor.waitForFunction(`document.querySelector("#agent-personality")?.value === "Recovered correction"`);
    await editor.setViewport({ width: 390, height: 844 });
    await editor.screenshot({ path: "/tmp/moderation-owner-mobile.png", fullPage: true });
    const [profile] = await database.db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, profileId));
    expect(profile!.personality).toBe("First submitted personality");
  } finally { await editor.close(); }
}, 120_000);

test("pass is admin-only, and a revoked moderator loses access without changing sessions", async () => {
  const page = await createAuthenticatedPage(browser, moderator.jwt, `${servers.webUrl}/moderation`, { privateKey: moderator.wallet.privateKey });
  try {
    await text(page, "Review Character"); await click(page, "Take next"); await text(page, "Your claim:");
    await page.type("textarea", "Needs admin judgement"); await click(page, "Pass to admin"); await text(page, "Passed to admin review.");
    const response = await fetch(`${servers.apiUrl}/api/moderation/queue?route=escalated`, { headers: { Authorization: `Bearer ${moderator.jwt}` } });
    expect(response.status).toBe(404);
    await database.db.delete(schema.addressRoles).where(eq(schema.addressRoles.walletAddress, moderator.wallet.address.toLowerCase()));
    await click(page, "Refresh"); await text(page, "Moderator access is required.");
  } finally { await page.close(); }
  const adminPage = await createAuthenticatedPage(browser, adminUser.jwt, `${servers.webUrl}/moderation`, { privateKey: adminUser.wallet.privateKey });
  try {
    await text(adminPage, "Admin recovery and resolved reviews");
    await adminPage.select('select[aria-label="Queue"]', "escalated"); await text(adminPage, "Review Character");
    await click(adminPage, "Take next"); await text(adminPage, "Your claim:");
    await adminPage.setViewport({ width: 390, height: 844 });
    await adminPage.screenshot({ path: "/tmp/moderation-admin-mobile.png", fullPage: true });
    await click(adminPage, "Accept — keep allowed"); await text(adminPage, "Confirm whole-revision decision"); await click(adminPage, "Confirm decision"); await text(adminPage, "Decision recorded.");
    const [profile] = await database.db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, profileId));
    expect(profile!.personality).toBe("Recovered correction");
    await adminPage.goto(`${servers.webUrl}/moderation/recovery`, { waitUntil: "networkidle0" }); await text(adminPage, "Resolved reviews");
    await adminPage.goto(`${servers.webUrl}/moderation?review=${reviewId}`, { waitUntil: "networkidle0" });
    await text(adminPage, "Review Character");
    await adminPage.click("details summary"); await click(adminPage, "Preview undo"); await text(adminPage, "Confirm whole-revision decision");
    await adminPage.waitForSelector("textarea:not([disabled])");
    await adminPage.type("textarea", "Undo earlier rejection without replacing the accepted correction");
    await click(adminPage, "Confirm decision"); await text(adminPage, "Decision recorded.");
    const [afterUndo] = await database.db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, profileId));
    expect(afterUndo!.personality).toBe("Recovered correction");
  } finally { await adminPage.close(); }
}, 120_000);
