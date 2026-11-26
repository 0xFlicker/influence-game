import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { createAuthRoutes } from "../routes/auth.js";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "../services/legal-acceptance.js";
import { setupTestDB } from "./test-utils.js";
import {
  admitSignup, CAMPAIGN_COOKIE, changeSignupRate, createSignupCampaign,
  issueCampaignSession, signupAvailability,
} from "../services/signup-admission.js";

test("concurrent signups take 25 slots, then refill continuously at the configured rate", async () => {
  const db = await setupTestDB();
  const results = await Promise.allSettled(Array.from({ length: 26 }, () =>
    db.transaction(tx => admitSignup(tx, randomUUID()))));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(25);
  expect(results.find(result => result.status === "rejected")).toMatchObject({
    reason: { code: "SIGNUP_LIMIT_REACHED" },
  });
  const first = await signupAvailability(db);
  const delay = Date.parse(first.nextAvailableAt!) - Date.now();
  expect(delay).toBeGreaterThan(3_450_000);
  expect(delay).toBeLessThanOrEqual(3_456_000);
  await db.execute(sql`UPDATE signup_bucket SET balance = 0, updated_ms = floor(extract(epoch from clock_timestamp()) * 1000)::bigint - 1728000`);
  const changed = await changeSignupRate(db, 12);
  expect(changed.available).toBe(false);
  const next = Date.parse(changed.nextAvailableAt!) - Date.now();
  expect(next).toBeGreaterThan(3_590_000);
  expect(next).toBeLessThanOrEqual(3_600_000);
  await changeSignupRate(db, Number.MAX_SAFE_INTEGER);
  await db.execute(sql`UPDATE signup_bucket SET updated_ms = updated_ms - 86400000`);
  await db.transaction(tx => admitSignup(tx, randomUUID()));
  expect(await signupAvailability(db)).toMatchObject({ rate: Number.MAX_SAFE_INTEGER, available: true });
});

test("concurrent settings and signups preserve the existing balance", async () => {
  const db = await setupTestDB();
  await changeSignupRate(db, 2);
  const attempts = await Promise.allSettled([
    db.transaction(tx => admitSignup(tx, "first-proof")),
    changeSignupRate(db, 4),
    db.transaction(tx => admitSignup(tx, "second-proof")),
    db.transaction(tx => admitSignup(tx, "third-proof")),
  ]);
  expect(attempts.filter(attempt => attempt.status === "fulfilled")).toHaveLength(3);
  expect(attempts[1]).toMatchObject({ status: "fulfilled", value: { rate: 4 } });
  expect(attempts.find(attempt => attempt.status === "rejected")).toMatchObject({
    reason: { code: "SIGNUP_LIMIT_REACHED" },
  });
  expect(await signupAvailability(db)).toMatchObject({ rate: 4, available: false });
});

test("a campaign session survives closing and is consumed once, only by a committed signup", async () => {
  const db = await setupTestDB();
  await changeSignupRate(db, 1);
  await db.transaction(tx => admitSignup(tx, "ordinary"));
  const campaign = await createSignupCampaign(db, "Fixture", new Date(Date.now() - 1_000), new Date(Date.now() + 60_000));
  const session = await issueCampaignSession(db, campaign.code);
  if (!session || session.existing) throw new Error("Missing campaign session");
  const second = await issueCampaignSession(db, campaign.code);
  if (!second || second.existing) throw new Error("Missing second campaign session");
  expect(second.maxAge).toBe(86_400);
  const expiredDigest = createHash("sha256").update(second.token).digest("hex");
  await db.execute(sql`UPDATE signup_campaign_sessions
    SET expires_at = clock_timestamp() - interval '1 millisecond' WHERE digest = ${expiredDigest}`);
  expect(await signupAvailability(db, second.token)).toMatchObject({ available: false });
  await expect(db.transaction(tx => admitSignup(tx, "expired", second.token)))
    .rejects.toMatchObject({ code: "SIGNUP_LIMIT_REACHED" });
  expect(await issueCampaignSession(db, campaign.code, session.token)).toEqual({ existing: true });
  await db.execute(sql`UPDATE signup_campaigns SET closed_at = now() WHERE id = ${campaign.id}`);
  expect(await issueCampaignSession(db, campaign.code)).toBeNull();
  expect(await signupAvailability(db, session.token)).toMatchObject({ available: true });
  await expect(db.transaction(async tx => {
    await admitSignup(tx, "rolled-back", session.token);
    throw new Error("rollback");
  })).rejects.toThrow("rollback");
  await db.transaction(tx => admitSignup(tx, "rolled-back", session.token));
  await expect(db.transaction(tx => admitSignup(tx, "fresh", session.token))).rejects.toMatchObject({ code: "SIGNUP_LIMIT_REACHED" });
  await expect(db.transaction(tx => admitSignup(tx, "rolled-back", session.token))).rejects.toMatchObject({ code: "SIGNUP_VERIFICATION_REQUIRED" });
});

test("Farcaster requires proof for a new account, preserves existing sign-in and rejects reused proof", async () => {
  const db = await setupTestDB();
  process.env.JWT_SECRET = "signup-availability-test";
  const app = new Hono().route("/", createAuthRoutes(db, {
    managedAuthMode: "disabled", farcasterAuthDomain: "thehouse.test",
    farcasterVerifier: { provider: "farcaster", verify: async token => {
      const fid = Number(token);
      return { status: "verified", evidence: {
        provider: "farcaster", subject: token, owner: { kind: "farcaster", fid }, productWalletAddress: null,
      } };
    } },
    verifySignupHuman: async token => createHash("sha256").update(token).digest("hex"),
  }));
  const signup = (token: string, turnstileToken?: string, cookie?: string) => app.request("/api/auth/farcaster/login", {
    method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ token, turnstileToken }),
  });
  expect(await (await signup("11")).json()).toMatchObject({ code: "SIGNUP_VERIFICATION_REQUIRED" });
  expect((await signup("11", "proof")).status).toBe(200);
  expect((await signup("11")).status).toBe(200);
  expect(await (await signup("22", "proof")).json()).toMatchObject({ code: "SIGNUP_VERIFICATION_REQUIRED" });
  await changeSignupRate(db, 1);
  await db.execute(sql`UPDATE signup_bucket SET balance = 0`);
  const denied = await signup("22");
  expect(denied.status).toBe(429);
  expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThan(86_390);
  expect(await denied.json()).toMatchObject({ code: "SIGNUP_LIMIT_REACHED", nextAvailableAt: expect.any(String) });
  const campaign = await createSignupCampaign(db, "Fixture", new Date(Date.now() - 1_000), new Date(Date.now() + 60_000));
  const session = await issueCampaignSession(db, campaign.code);
  if (!session || session.existing) throw new Error("Missing campaign session");
  const cookie = `${CAMPAIGN_COOKIE}=${session.token}`;
  expect((await signup("22", undefined, cookie)).status).toBe(403);
  expect((await signup("22", "other-proof", cookie)).status).toBe(200);
});

test("Clerk, Privy and Farcaster compete for the same one-use verification", async () => {
  const db = await setupTestDB();
  process.env.JWT_SECRET = "shared-signup-verification-test";
  let invitesRequired = true;
  const app = new Hono().route("/", createAuthRoutes(db, {
    managedAuthMode: "full",
    isInviteRequired: async () => invitesRequired,
    clerkVerifier: { provider: "clerk", verify: async subject => ({
      status: "verified", evidence: {
        provider: "clerk", subject, owner: { kind: "email", normalizedEmail: "clerk@example.test" }, productWalletAddress: null,
      },
    }) },
    verifyPrivyToken: async () => "did:privy:shared-proof",
    getPrivyUser: async id => ({
      id, createdAt: new Date(), isGuest: false, customMetadata: {},
      linkedAccounts: [{
        type: "email", address: "privy@example.test",
        verifiedAt: new Date(), firstVerifiedAt: new Date(), latestVerifiedAt: new Date(),
      }],
    }),
    farcasterAuthDomain: "thehouse.test",
    farcasterVerifier: { provider: "farcaster", verify: async subject => ({
      status: "verified", evidence: {
        provider: "farcaster", subject, owner: { kind: "farcaster", fid: 31 }, productWalletAddress: null,
      },
    }) },
    verifySignupHuman: async token => createHash("sha256").update(token).digest("hex"),
  }));
  const legal = {
    acceptTerms: true, termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION, deploymentSha: "a".repeat(40),
  };
  const paths = [
    { path: "/api/auth/managed/create", body: { token: "clerk-account", ...legal } },
    { path: "/api/auth/login", body: { token: "privy-account", intent: "create_account", ...legal } },
    { path: "/api/auth/farcaster/login", body: { token: "31" } },
  ];
  const signup = ({ path, body }: typeof paths[number], turnstileToken?: string) => app.request(path, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, turnstileToken }),
  });
  await changeSignupRate(db, 1);
  await db.execute(sql`UPDATE signup_bucket SET balance = 0`);
  for (const path of paths) {
    const denied = await signup(path);
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).not.toBeNull();
    expect(await denied.json()).toMatchObject({ code: "SIGNUP_LIMIT_REACHED", nextAvailableAt: expect.any(String) });
  }
  await changeSignupRate(db, 25);
  await db.execute(sql`UPDATE signup_bucket SET updated_ms = updated_ms - 86400000`);
  for (const path of paths) {
    const needsInvite = await signup(path);
    expect(needsInvite.status).toBe(403);
    expect(await needsInvite.json()).toMatchObject({ code: "INVITE_REQUIRED" });
  }
  invitesRequired = false;
  for (const path of paths) {
    const denied = await signup(path);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "SIGNUP_VERIFICATION_REQUIRED" });
  }
  const shared = await Promise.all(paths.map(path => signup(path, "one-verification")));
  expect(shared.map(response => response.status).sort()).toEqual([200, 403, 403]);
  for (const [index, response] of shared.entries()) {
    if (response.status === 200) continue;
    expect(await response.json()).toMatchObject({ code: "SIGNUP_VERIFICATION_REQUIRED" });
    expect((await signup(paths[index]!, randomUUID())).status).toBe(200);
  }
});

test("Siteverify requires the expected signup action and hostname without sending IP", async () => {
  const { verifySignupHuman } = await import("../services/signup-admission.js");
  const { spyOn } = await import("bun:test");
  const key = process.env.TURNSTILE_SECRET_KEY;
  const webBaseUrl = process.env.WEB_BASE_URL;
  process.env.TURNSTILE_SECRET_KEY = "fixture-secret";
  process.env.WEB_BASE_URL = "https://STAGING.thehouse.test:8443/";
  const fetchSpy = spyOn(globalThis, "fetch");
  try {
    fetchSpy.mockResolvedValueOnce(Response.json({ success: true, action: "house_signup", hostname: "staging.thehouse.test" }));
    const value = "test-response";
    expect(await verifySignupHuman(value)).toBe(createHash("sha256").update(value).digest("hex"));
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(String(init?.body)).toBe("secret=fixture-secret&response=test-response");
    for (const response of [
      { success: true, hostname: "staging.thehouse.test", action: "other" },
      { success: true, hostname: "other.test", action: "house_signup" },
      { success: false, "error-codes": ["timeout-or-duplicate"] },
    ]) {
      fetchSpy.mockResolvedValueOnce(Response.json(response));
      await expect(verifySignupHuman(value)).rejects.toMatchObject({ code: "SIGNUP_VERIFICATION_REQUIRED" });
    }
    fetchSpy.mockResolvedValueOnce(new Response("", { status: 503 }));
    await expect(verifySignupHuman(value)).rejects.toMatchObject({ code: "SIGNUP_VERIFICATION_UNAVAILABLE" });
    const previousCalls = fetchSpy.mock.calls.length;
    for (const invalid of ["", "staging.thehouse.test", "ftp://staging.thehouse.test"]) {
      process.env.WEB_BASE_URL = invalid;
      await expect(verifySignupHuman(value)).rejects.toMatchObject({ code: "SIGNUP_VERIFICATION_UNAVAILABLE" });
    }
    expect(fetchSpy.mock.calls.length).toBe(previousCalls);
  } finally {
    fetchSpy.mockRestore();
    if (key === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = key;
    if (webBaseUrl === undefined) delete process.env.WEB_BASE_URL;
    else process.env.WEB_BASE_URL = webBaseUrl;
  }
});
