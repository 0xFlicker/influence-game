import path from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { schema, type DrizzleDB } from "../db/index.js";
import {
  createIsolatedTestDb,
  destroyIsolatedTestDb,
} from "./test-db.js";
import { createSessionToken } from "../middleware/auth.js";
import { createAuthRoutes } from "../routes/auth.js";
import { createMcpOAuthRoutes } from "../routes/mcp-oauth.js";
import { createProfileRoutes } from "../routes/profile.js";
import type {
  ClerkAuthenticationProviderVerifier,
  ProviderVerificationResult,
} from "../services/authentication-providers.js";

const WORKSPACE_ROOT = path.resolve(import.meta.dir, "../../../..");
const JWT_SECRET = "layered-authentication-e2e-jwt-secret";
const EMBEDDED_WALLET = "0x1111111111111111111111111111111111111111";
const EXTERNAL_WALLET = "0x2222222222222222222222222222222222222222";
const UI_EMBEDDED_WALLET = "0x4444444444444444444444444444444444444444";

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

let apiServer: ReturnType<typeof Bun.serve> | null = null;
let webProcess: Bun.Subprocess | null = null;
let isolatedDatabaseUrl: string | null = null;
let stopping = false;

async function main(): Promise<void> {
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.MANAGED_AUTH_MODE = "full";
  process.env.PRIVY_COMPATIBILITY_BRIDGE_ENABLED = "false";

  const { db, databaseUrl } = await createIsolatedTestDb();
  isolatedDatabaseUrl = databaseUrl;
  const fixture = await seedFixture(db);
  const webPort = randomPort();
  const apiPort = randomPort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://localhost:${webPort}`;
  process.env.MCP_OAUTH_RESOURCE_URI = `${apiUrl}/mcp`;
  process.env.WEB_BASE_URL = webUrl;
  process.env.INFLUENCE_MCP_INTROSPECTION_SECRET =
    "layered-authentication-e2e-introspection";

  const clerkVerifier = createInjectedClerkVerifier();
  const authDependencies = {
    managedAuthMode: "full" as const,
    clerkVerifier,
    compatibilityBridgeEnabled: false,
    verifyPrivyToken: verifyInjectedPrivyToken,
    getPrivyUser: loadInjectedPrivyUser,
  };
  const app = new Hono();
  app.use("*", cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "x-correlation-id"],
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
  }));
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.route("/", createAuthRoutes(db, authDependencies));
  app.route("/", createMcpOAuthRoutes(db));
  app.route("/", createProfileRoutes(db));

  const existingOnly = new Hono();
  existingOnly.route("/", createAuthRoutes(db, {
    ...authDependencies,
    managedAuthMode: "existing-only",
  }));
  app.route("/e2e/existing-only", existingOnly);

  const disabled = new Hono();
  disabled.route("/", createAuthRoutes(db, {
    ...authDependencies,
    managedAuthMode: "disabled",
  }));
  app.route("/e2e/disabled", disabled);

  apiServer = Bun.serve({
    hostname: "127.0.0.1",
    port: apiPort,
    fetch: app.fetch,
  });
  webProcess = Bun.spawn(
    ["bun", "run", "dev", "--hostname", "127.0.0.1"],
    {
      cwd: path.join(WORKSPACE_ROOT, "packages/web"),
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: String(webPort),
        API_URL: apiUrl,
        API_BACKEND_URL: apiUrl,
        NEXT_PUBLIC_API_URL: apiUrl,
        PRIVY_APP_ID: "e2e-test-privy-app-id-001",
        NEXT_PUBLIC_PRIVY_APP_ID: "e2e-test-privy-app-id-001",
        NEXT_PUBLIC_E2E_AUTH: "true",
        NEXT_PUBLIC_E2E_LAYERED_AUTH: "true",
        MANAGED_AUTH_MODE: "full",
        CLERK_PUBLISHABLE_KEY: "pk_test_layered_auth_e2e",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_layered_auth_e2e",
      },
      stdout: "ignore",
      stderr: "inherit",
    },
  );
  await waitForHealth(webUrl, 60_000);

  const harness: LayeredAuthHarness = {
    apiUrl,
    webUrl,
    tokens: {
      newManaged: "clerk:new",
      existingEmailManaged: "clerk:existing-email",
      walletManaged: "clerk:wallet",
      reverseManaged: "clerk:reverse",
      providerOutage: "clerk:outage",
      existingPrivy: "privy:existing",
      reversePrivy: "privy:reverse",
      walletPrivyFresh: "privy:wallet:fresh",
      walletPrivyExpired: "privy:wallet:expired",
      uiExistingPrivy: "privy:ui-existing",
      uiReversePrivy: "privy:ui-reverse",
      uiWalletPrivyFresh: "privy:ui-wallet:fresh",
      uiWalletPrivyExpired: "privy:ui-wallet:expired",
    },
    users: fixture.users,
    sessions: fixture.sessions,
  };
  console.log(`E2E_LAYERED_AUTH_READY ${JSON.stringify(harness)}`);

  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await shutdown();
}

async function seedFixture(db: DrizzleDB): Promise<{
  users: LayeredAuthHarness["users"];
  sessions: LayeredAuthHarness["sessions"];
}> {
  const existingEmail = "e2e-existing-privy-email";
  const walletOwner = "e2e-existing-wallet-owner";
  const reverseOwner = "e2e-password-reverse-owner";
  const walletless = "e2e-walletless-oauth-owner";
  const uiExistingEmail = "e2e-ui-existing-privy-email";
  const uiWalletOwner = "e2e-ui-wallet-owner";
  const uiReverseOwner = "e2e-ui-password-reverse-owner";

  await db.insert(schema.users).values([
    {
      id: existingEmail,
      email: "existing@example.test",
      walletAddress: EMBEDDED_WALLET,
      displayName: "Existing Privy Email",
      handle: "e2e-existing-email",
    },
    {
      id: walletOwner,
      walletAddress: "0x3333333333333333333333333333333333333333",
      displayName: "Existing Wallet Owner",
      handle: "e2e-wallet-owner",
    },
    {
      id: reverseOwner,
      email: "reverse@example.test",
      displayName: "Password First",
      handle: "e2e-reverse-owner",
    },
    {
      id: walletless,
      email: "walletless@example.test",
      displayName: "Walletless OAuth User",
      handle: "e2e-walletless",
    },
    {
      id: uiExistingEmail,
      email: "ui-existing@example.test",
      walletAddress: UI_EMBEDDED_WALLET,
      displayName: "UI Existing Privy Email",
      handle: "e2e-ui-existing",
    },
    {
      id: uiWalletOwner,
      walletAddress: "0x5555555555555555555555555555555555555555",
      displayName: "UI Existing Wallet Owner",
      handle: "e2e-ui-wallet",
    },
    {
      id: uiReverseOwner,
      email: "ui-reverse@example.test",
      displayName: "UI Password First",
      handle: "e2e-ui-reverse",
    },
  ]);
  await db.insert(schema.authenticationCredentials).values([
    {
      userId: existingEmail,
      provider: "privy",
      providerSubject: "did:privy:existing",
    },
    {
      userId: walletOwner,
      provider: "privy",
      providerSubject: "did:privy:wallet",
    },
    {
      userId: reverseOwner,
      provider: "clerk",
      providerSubject: "clerk-reverse",
    },
    {
      userId: walletless,
      provider: "clerk",
      providerSubject: "clerk-walletless-oauth",
    },
    {
      userId: uiExistingEmail,
      provider: "privy",
      providerSubject: "did:privy:ui-existing",
    },
    {
      userId: uiWalletOwner,
      provider: "privy",
      providerSubject: "did:privy:ui-wallet",
    },
    {
      userId: uiReverseOwner,
      provider: "clerk",
      providerSubject: "clerk-ui-reverse",
    },
  ]);
  await db.insert(schema.verifiedEmailClaims).values([
    {
      normalizedEmail: "existing@example.test",
      userId: existingEmail,
      state: "active",
    },
    {
      normalizedEmail: "reverse@example.test",
      userId: reverseOwner,
      state: "active",
    },
    {
      normalizedEmail: "ui-existing@example.test",
      userId: uiExistingEmail,
      state: "active",
    },
    {
      normalizedEmail: "ui-reverse@example.test",
      userId: uiReverseOwner,
      state: "active",
    },
  ]);

  return {
    users: { existingEmail, walletOwner, reverseOwner },
    sessions: {
      existingEmail: await createSessionToken(existingEmail),
      walletOwner: await createSessionToken(walletOwner),
      walletless: await createSessionToken(walletless),
      uiWalletOwner: await createSessionToken(uiWalletOwner),
    },
  };
}

function createInjectedClerkVerifier(): ClerkAuthenticationProviderVerifier {
  return {
    provider: "clerk",
    async verify(token): Promise<ProviderVerificationResult> {
      switch (token) {
        case "clerk:new":
          return verifiedClerk("clerk-new", "new+e2e@example.test");
        case "clerk:existing-email":
          return verifiedClerk("clerk-existing-email", "existing@example.test");
        case "clerk:wallet":
          return verifiedClerk("clerk-wallet", "wallet@example.test");
        case "clerk:reverse":
          return verifiedClerk("clerk-reverse", "reverse@example.test");
        case "clerk:outage":
          return { status: "profile_unavailable" };
        case "clerk:ui-new":
          return verifiedClerk("clerk-ui-new", "ui-new+e2e@example.test");
        case "clerk:ui-existing":
          return verifiedClerk(
            "clerk-ui-existing",
            "ui-existing@example.test",
          );
        case "clerk:ui-wallet":
          return verifiedClerk("clerk-ui-wallet", "ui-wallet@example.test");
        case "clerk:ui-reverse":
          return verifiedClerk("clerk-ui-reverse", "ui-reverse@example.test");
        case "clerk:ui-outage":
          return { status: "profile_unavailable" };
        default:
          return { status: "invalid" };
      }
    },
  };
}

function verifiedClerk(
  subject: string,
  normalizedEmail: string,
): ProviderVerificationResult {
  return {
    status: "verified",
    evidence: {
      provider: "clerk",
      subject,
      owner: { kind: "email", normalizedEmail },
      productWalletAddress: null,
    },
  };
}

async function verifyInjectedPrivyToken(token: string): Promise<string | null> {
  switch (token) {
    case "privy:existing":
      return "did:privy:existing";
    case "privy:reverse":
      return "did:privy:reverse";
    case "privy:wallet:fresh":
      return "did:privy:wallet";
    case "privy:ui-existing":
      return "did:privy:ui-existing";
    case "privy:ui-reverse":
      return "did:privy:ui-reverse";
    case "privy:ui-wallet:fresh":
      return "did:privy:ui-wallet";
    default:
      return null;
  }
}

type InjectedLinkedAccount =
  | ReturnType<typeof emailAccount>
  | ReturnType<typeof embeddedWallet>
  | ReturnType<typeof externalWallet>;

const linkedAccountsBySubject: Record<
  string,
  () => InjectedLinkedAccount[]
> = {
  "did:privy:existing": () => [
    emailAccount("existing@example.test"),
    embeddedWallet(EMBEDDED_WALLET),
  ],
  "did:privy:ui-existing": () => [
    emailAccount("ui-existing@example.test"),
    embeddedWallet(UI_EMBEDDED_WALLET),
  ],
  "did:privy:reverse": () => [emailAccount("reverse@example.test")],
  "did:privy:ui-reverse": () => [emailAccount("ui-reverse@example.test")],
  "did:privy:ui-wallet": () => [
    embeddedWallet("0x5555555555555555555555555555555555555555"),
    externalWallet(EXTERNAL_WALLET),
  ],
  "did:privy:wallet": () => [
    embeddedWallet("0x3333333333333333333333333333333333333333"),
    externalWallet(EXTERNAL_WALLET),
  ],
};

async function loadInjectedPrivyUser(subject: string) {
  const linkedAccounts = (
    linkedAccountsBySubject[subject]
    ?? linkedAccountsBySubject["did:privy:wallet"]!
  )();
  return {
    id: subject,
    createdAt: new Date(),
    isGuest: false,
    customMetadata: {},
    linkedAccounts,
  };
}

function emailAccount(address: string) {
  return {
    type: "email" as const,
    address,
    verifiedAt: new Date(),
    firstVerifiedAt: new Date(),
    latestVerifiedAt: new Date(),
  };
}

function embeddedWallet(address: string) {
  return {
    type: "wallet" as const,
    address,
    chainType: "ethereum" as const,
    walletClientType: "privy",
    verifiedAt: new Date(),
    firstVerifiedAt: new Date(),
    latestVerifiedAt: new Date(),
  };
}

function externalWallet(address: string) {
  return {
    type: "wallet" as const,
    address,
    chainType: "ethereum" as const,
    walletClientType: "metamask",
    verifiedAt: new Date(),
    firstVerifiedAt: new Date(),
    latestVerifiedAt: new Date(),
  };
}

function randomPort(): number {
  return 10_000 + Math.floor(Math.random() * 50_000);
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Process is still starting.
    }
    await Bun.sleep(250);
  }
  throw new Error(`Web harness did not start at ${url}`);
}

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (webProcess) {
    webProcess.kill("SIGTERM");
    await Promise.race([webProcess.exited, Bun.sleep(5_000)]);
    if (webProcess.exitCode === null) webProcess.kill("SIGKILL");
    webProcess = null;
  }
  apiServer?.stop(true);
  apiServer = null;
  if (isolatedDatabaseUrl) {
    await destroyIsolatedTestDb(isolatedDatabaseUrl);
    isolatedDatabaseUrl = null;
  }
}

void main().catch(async (error) => {
  console.error("Layered authentication E2E harness failed:", error);
  await shutdown();
  process.exitCode = 1;
});
