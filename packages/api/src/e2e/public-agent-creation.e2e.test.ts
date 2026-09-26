import { afterAll, beforeAll, expect, test } from "bun:test";
import { Hono } from "hono";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { Browser } from "puppeteer";
import { schema } from "../db/index.js";
import { createAuthRoutes } from "../routes/auth.js";
import { createProfileRoutes } from "../routes/profile.js";
import { createAnonymousAgentCreationRoutes } from "../routes/anonymous-agent-creation.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { runAccountText } from "../services/account-text-usage.js";
import { decodeAnonymousCreationTurn } from "../services/anonymous-agent-creation.js";
import { createIsolatedTestDb, destroyIsolatedTestDb, type TestDB } from "./test-db.js";
import { launchBrowser, closeBrowser } from "./test-browser.js";
import { cleanupE2eResources } from "./cleanup.js";

let database: TestDB, browser: Browser, api: ReturnType<typeof Bun.serve>, web: Bun.Subprocess;
let webUrl: string;
const temporaryPath = (name: string) => join(tmpdir(), name);
const profile = { name: "Mira Vale", personaKey: "diplomat", gender: "female", personality: "A warm diplomat who keeps receipts.",
  backstory: "An exiled ambassador.", strategyStyle: "Build trust at the risk of waiting too long.",
  performanceInstructions: "Quiet gestures.", visualDesign: "A blue coat.", introQuips: ["Trust takes time.", "I keep receipts.", "We can talk."] };
const response = { id: "deterministic-preview", object: "chat.completion" as const, created: 0, model: "gpt-5.6-luna", choices: [],
  usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } };

beforeAll(async () => {
  process.env.JWT_SECRET = "public-creation-browser-secret";
  database = await createIsolatedTestDb();
  const app = new Hono<AuthEnv>();
  app.get("/health", c => c.json({ status: "ok" }));
  app.route("/", createAuthRoutes(database.db, {
    managedAuthMode: "full", compatibilityBridgeEnabled: false, isInviteRequired: async () => false,
    clerkVerifier: { provider: "clerk", verify: async token => token === "clerk:ui-new" ? {
      status: "verified", evidence: { provider: "clerk", subject: "public-creator-new", owner: { kind: "email", normalizedEmail: "ui-new+e2e@example.test" }, productWalletAddress: null },
    } : { status: "invalid" } },
  }));
  app.route("/", createProfileRoutes(database.db));
  app.route("/", createAnonymousAgentCreationRoutes(database.db, async (_input, _signal, record) => {
    await record(response);
    return decodeAnonymousCreationTurn(JSON.stringify({ reply: "Mira builds trust, but may hesitate to act. Does she feel right?", profile }));
  }));
  app.post("/api/agent-profiles/creation-assistant", requireAuth(database.db), async c => c.json(await runAccountText(database.db, {
    userId: c.get("user").id, requestKey: c.req.header("Idempotency-Key")!, kind: "creation_assistant", model: response.model, payload: await c.req.json(),
  }, async record => { await record(response); return { command: "clarify", reply: "Your account is ready. We can keep shaping Mira." }; })));
  api = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  const webPort = 20000 + Math.floor(Math.random() * 30000);
  webUrl = `http://localhost:${webPort}`;
  web = Bun.spawn([process.execPath, "run", "dev", "--hostname", "127.0.0.1"], {
    cwd: `${import.meta.dir}/../../../web`,
    env: { ...process.env, NODE_ENV: "development", PORT: String(webPort), API_URL: "", NEXT_PUBLIC_API_URL: "", API_BACKEND_URL: `http://127.0.0.1:${api.port}`,
      PRIVY_APP_ID: "e2e-test-privy-app-id-001", NEXT_PUBLIC_PRIVY_APP_ID: "e2e-test-privy-app-id-001",
      NEXT_PUBLIC_E2E_AUTH: "true", NEXT_PUBLIC_E2E_LAYERED_AUTH: "true", MANAGED_AUTH_MODE: "full",
      CLERK_PUBLISHABLE_KEY: "pk_test_layered_auth_e2e", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_layered_auth_e2e" },
    stdout: Bun.file(temporaryPath("public-creator-browser-web.log")), stderr: Bun.file(temporaryPath("public-creator-browser-web-errors.log")),
  });
  const deadline = Date.now() + 60_000;
  while (true) {
    try { const result = await fetch(`${webUrl}/agents/create`, { signal: AbortSignal.timeout(1000) }); if (result.ok) break; }
    catch { /* Child startup is polled until the bounded deadline. */ }
    if (Date.now() >= deadline) throw new Error(`Public creator web server did not start; see ${temporaryPath("public-creator-browser-web-errors.log")}`);
    await Bun.sleep(250);
  }
  browser = await launchBrowser();
}, 120_000);

afterAll(async () => { await cleanupE2eResources([
  ["browser", async () => { if (browser) await closeBrowser(browser); }],
  ["web", async () => { if (web) { web.kill(); await web.exited; } }],
  ["api", async () => { if (api) api.stop(true); }],
  ["database", async () => { if (database) await destroyIsolatedTestDb(database.databaseUrl); }],
]); }, 60_000);

test("public hall → one tracked preview → image signup → free account messages, with draft preserved", async () => {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on("console", message => { if (message.type() === "error") console.error("[browser]", message.text()); });
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`${webUrl}/agents/create`, { waitUntil: "networkidle0" });
    await page.waitForSelector('textarea[aria-label="Message the character assistant"]:not([disabled])');
    expect(await page.$('[role="dialog"]')).toBeNull();
    expect(await page.evaluate("document.body.innerText.includes('Sign in to access this page.')")).toBe(false);
    await page.screenshot({ path: temporaryPath("public-creator-desktop.png") });
    await page.type('textarea[aria-label="Message the character assistant"]', "An exiled diplomat who keeps receipts");
    await page.click('button[aria-label="Send"]');
    await page.waitForFunction("document.querySelector('button[aria-label=\"Read Name\"]')?.textContent?.includes('Mira Vale')");
    expect(await page.$('[role="dialog"]')).toBeNull();
    expect((await database.db.select().from(schema.anonymousTextOperations))).toHaveLength(1);
    expect((await database.db.select().from(schema.users))).toHaveLength(0);
    await page.evaluate("Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Yes, that feels right')?.click()");
    await page.type('textarea[aria-label="Message the character assistant"]', "A blue coat and gold rings");
    await page.click('button[aria-label="Send"]');
    await page.waitForSelector('[role="dialog"][aria-label="Influence authentication"]');
    expect(await page.$eval('[role="dialog"]', element => element.closest("[inert]"))).toBeNull();
    await page.screenshot({ path: temporaryPath("public-creator-signup-desktop.png") });
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: temporaryPath("public-creator-signup-mobile.png") });
    await page.type('[role="dialog"] input[type="email"]', "ui-new+e2e@example.test");
    await page.type('[role="dialog"] input[type="password"]', "test-password");
    await page.click('[role="dialog"] input[type="checkbox"]');
    await page.click('[role="dialog"] button[type="submit"]');
    await page.waitForFunction("document.querySelector('[role=\"dialog\"]')?.textContent?.includes('Verification code')");
    await page.type('[role="dialog"] input[inputmode="numeric"]', "424242");
    await page.evaluate("Array.from(document.querySelectorAll('[role=\"dialog\"] button')).find(button => button.textContent === 'Verify code')?.click()");
    await page.waitForFunction("!document.querySelector('[role=\"dialog\"][aria-label=\"Influence authentication\"]')");
    expect(await page.$eval('button[aria-label="Read Name"]', element => element.textContent)).toContain("Mira Vale");
    expect(await page.evaluate("document.querySelector('textarea[aria-label=\"Message the character assistant\"]').value")).toBe("A blue coat and gold rings");
    await page.waitForSelector('[aria-labelledby="public-identity-title"]');
    await page.type('[aria-labelledby="public-identity-title"] input[placeholder="Flick"]', "Mira Player");
    await page.type('[aria-labelledby="public-identity-title"] input[placeholder="flick"]', "mira-player");
    await page.click('[aria-labelledby="public-identity-title"] button[type="submit"]');
    await page.waitForFunction("!document.querySelector('[aria-labelledby=\"public-identity-title\"]')");
    await page.click('button[aria-label="Send"]');
    await page.waitForFunction("document.body.innerText.includes('Your account is ready. We can keep shaping Mira.')");
    const [owner] = await database.db.select().from(schema.users).where(eq(schema.users.email, "ui-new+e2e@example.test"));
    expect(owner).toBeDefined();
    const [allowance] = await database.db.select().from(schema.inferenceAccounts).where(eq(schema.inferenceAccounts.userId, owner!.id));
    expect(allowance).toMatchObject({ textBalance: 99, imageBalance: 25, planId: "free" });
    expect(await database.db.select().from(schema.anonymousTextOperations)).toHaveLength(1);
    await page.screenshot({ path: temporaryPath("public-creator-after-signup-mobile.png") });
  } catch (error) {
    await page.screenshot({ path: temporaryPath("public-creator-browser-failure.png") });
    console.error("[browser failure]", await page.evaluate("document.body.innerText"));
    throw error;
  } finally { await context.close(); }
}, 120_000);
