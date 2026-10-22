import { testUserIdForWallet } from "../__tests__/rbac-fixtures.js";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Browser, Page } from "puppeteer";
import { schema } from "../db/index.js";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";
import { recordCurrentLegalAcceptance } from "../services/legal-acceptance.js";
import { createAdminUser, createPlayerUser, mintTestJwt, assignRole, type PlayerUserResult } from "./test-auth.js";
import { closeBrowser, createAuthenticatedPage, launchBrowser } from "./test-browser.js";
import { createIsolatedTestDb, destroyIsolatedTestDb, type TestDB } from "./test-db.js";
import { startTestServers, stopTestServers, type TestServerHandles } from "./test-server.js";
import { cleanupE2eResources } from "./cleanup.js";
import { storeJson } from "../services/payload-storage.js";

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
  await database.db.update(schema.agentScreenings).set({ status: "completed", recommendation: "review", result: await storeJson({ recommendation: "review", summary: "Review the submitted content.", findings: [{ category: "outside_game_collusion", source: "text", field: "personality", quote: "First submitted personality", assetHash: "", explanation: "Deterministic UI fixture; no real provider assessment." }] }) }).where(eq(schema.agentScreenings.contentRevisionId, agent.profile.contentRevisionId!));
  const [screening] = await database.db.select().from(schema.agentScreenings);
  for (const [stage, status, body, outcome] of [
    ["moderation", 200, { model: "omni-moderation-latest", results: [{ flagged: false, categories: { hate: false }, category_scores: { hate: 0.00000195 } }] }, "accepted"],
    ["luna", 400, { error: { code: "content_policy_violation" } }, "failed"],
    ["luna_collusion", 200, { status: "completed" }, "accepted"],
  ] as const) await database.db.insert(schema.agentScreeningAttempts).values({ id: randomUUID(), screeningId: screening!.id, stage, ordinal: 1,
    request: await storeJson({ evidence: {} }), response: await storeJson({ evidence: { status, body: JSON.stringify(body) } }), outcome });
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
  try {
    await page.waitForFunction(`document.body.innerText.includes(${JSON.stringify(value)})`, { timeout: 20000 });
  } catch (error) {
    console.error("Missing text", value, await page.evaluate("document.body.innerText"));
    throw error;
  }
}
async function click(page: Page, label: string) {
  try {
    await page.waitForFunction(`Array.from(document.querySelectorAll("button")).some(b => b.textContent?.trim() === ${JSON.stringify(label)} && !b.disabled)`);
  } catch (error) {
    console.error("Missing button", label, await page.evaluate("document.body.innerText"));
    throw error;
  }
  await page.evaluate(`Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === ${JSON.stringify(label)})?.click()`);
}
test("moderator claims, previews and rejects; owner recovers a held correction after reload", async () => {
  const page = await createAuthenticatedPage(browser, moderator.jwt, `${servers.webUrl}/moderation`, { privateKey: moderator.wallet.privateKey });
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await text(page, "Review Character");
    await text(page, "1 screened or queued revisions · Moderator queue only");
    expect(await page.evaluate(`Array.from(document.querySelectorAll('[aria-label="Screening overview"] dl > div')).find(item => item.querySelector('dt')?.textContent === 'Completed')?.querySelector('dd')?.textContent`)).toBe("1");
    expect(await page.evaluate(`Array.from(document.querySelectorAll('button')).filter(button => /refresh/i.test(button.textContent)).length`)).toBe(1);
    await page.waitForSelector('nav a[href="/moderation"]');
    await click(page, "Take next");
    await text(page, "Your claim:");
    await text(page, "A provider refused the safety assessment.");
    await text(page, "Text-only collusion result:");
    await text(page, "content_policy_violation");
    await text(page, "luna_collusion");
    expect(await page.$eval('[aria-label="AI shadow screening"]', el => el.textContent)).toContain("0.0000019500");
    const [screening] = await database.db.select().from(schema.agentScreenings);
    await database.db.update(schema.agentScreenings).set({ status: "incomplete", recommendation: null, result: null, failureCode: "provider_timeout" });
    await click(page, "Refresh");
    await text(page, "provider_timeout: 1");
    await text(page, "Screening incomplete — no clearance");
    expect(await page.$eval('[aria-label="Review queue"]', el => el.textContent)).toContain("Screening incomplete");
    expect(await page.$eval('[aria-label="AI shadow screening"]', el => el.textContent)).toContain("Screening incomplete — no clearance");
    await database.db.update(schema.agentScreenings).set({ status: "completed", recommendation: "review", result: screening!.result, failureCode: null });
    await click(page, "Refresh");
    await text(page, "No screening failures recorded.");
    await text(page, "Review the submitted content.");
    expect(await page.$eval('[aria-label="Review queue"]', el => el.textContent)).toContain("AI recommends review");
    expect(await page.$eval('[aria-label="AI shadow screening"]', el => el.textContent)).toContain("Human review recommended");
    await text(page, "AI recommendation · Shadow mode");
    await text(page, "Human review recommended");
    await text(page, "Outside-game collusion");
    await text(page, "does not change publication");
    expect(await page.$('a[href^="/admin/inference"]')).toBeNull();
    await page.waitForSelector("textarea:not([disabled])");
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
    await page.waitForSelector("textarea:not([disabled])");
    await page.type("textarea", "Needs admin judgement"); await click(page, "Pass to admin"); await text(page, "Passed to admin review.");
    const response = await fetch(`${servers.apiUrl}/api/moderation/queue?route=escalated`, { headers: { Authorization: `Bearer ${moderator.jwt}` } });
    expect(response.status).toBe(404);
    await database.db.delete(schema.userRoles).where(eq(schema.userRoles.userId, testUserIdForWallet(moderator.wallet.address.toLowerCase())));
    await click(page, "Refresh"); await text(page, "Moderator access is required.");
  } finally { await page.close(); }
  const adminPage = await createAuthenticatedPage(browser, adminUser.jwt, `${servers.webUrl}/moderation`, { privateKey: adminUser.wallet.privateKey });
  try {
    await text(adminPage, "Admin recovery and resolved reviews");
    await text(adminPage, "All review queues");
    await adminPage.select('select[aria-label="Queue"]', "escalated"); await text(adminPage, "Review Character");
    await click(adminPage, "Take next"); await text(adminPage, "Your claim:");
    await adminPage.waitForSelector('a[href^="/admin/inference?userId="]');
    await adminPage.setViewport({ width: 390, height: 844 });
    await adminPage.screenshot({ path: "/tmp/moderation-admin-mobile.png", fullPage: true });
    await click(adminPage, "Accept — keep allowed"); await text(adminPage, "Confirm whole-revision decision"); await click(adminPage, "Confirm decision"); await text(adminPage, "Decision recorded.");
    const [profile] = await database.db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, profileId));
    expect(profile!.personality).toBe("Recovered correction");
    await adminPage.goto(`${servers.webUrl}/moderation/recovery`, { waitUntil: "networkidle0" }); await text(adminPage, "Resolved reviews");
    await adminPage.goto(`${servers.webUrl}/moderation?review=${reviewId}`, { waitUntil: "networkidle0" });
    await text(adminPage, "Review Character");
    await adminPage.evaluate(`Array.from(document.querySelectorAll('details summary')).find(el => el.textContent === 'Review history')?.click()`); await click(adminPage, "Preview undo"); await text(adminPage, "Confirm whole-revision decision");
    await adminPage.waitForSelector("textarea:not([disabled])");
    await adminPage.type("textarea", "Undo earlier rejection without replacing the accepted correction");
    await click(adminPage, "Confirm decision"); await text(adminPage, "Decision recorded.");
    const [afterUndo] = await database.db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, profileId));
    expect(afterUndo!.personality).toBe("Recovered correction");
  } finally { await adminPage.close(); }
}, 120_000);
