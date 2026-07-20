import { beforeEach, describe, expect, test } from "bun:test";
import { schema, type DrizzleDB } from "../db/index.js";
import { normalizeVerifiedEmail } from "../lib/verified-email.js";
import {
  createClerkAuthenticationVerifier,
  createClerkSdkDependencies,
  createPrivyAuthenticationVerifier,
  classifyPrivyUser,
  type VerifiedProviderEvidence,
} from "../services/authentication-providers.js";
import {
  createManagedAccountAuthentication,
  exchangeExistingAccountAuthentication,
  linkManagedAuthenticationCredential,
  linkPrivyAuthenticationCredential,
  resolveAccountAuthentication,
} from "../services/account-authentication.js";
import { setupTestDB } from "./test-utils.js";

const EMBEDDED_WALLET = "0x1111111111111111111111111111111111111111";
const EXTERNAL_WALLET = "0x2222222222222222222222222222222222222222";
const OTHER_WALLET = "0x3333333333333333333333333333333333333333";

describe("verified email normalization", () => {
  test("normalizes only surrounding whitespace and case", () => {
    expect(normalizeVerifiedEmail("  Person+tag@Example.COM  "))
      .toBe("person+tag@example.com");
  });
});

describe("Privy identity classification", () => {
  test("an email owner and embedded wallet classify identically in either order", () => {
    const email = {
      type: "email",
      address: " Person+tag@Example.COM ",
    };
    const embedded = {
      type: "wallet",
      address: EMBEDDED_WALLET.toUpperCase().replace("0X", "0x"),
      chainType: "ethereum",
      walletClientType: "privy",
    };

    const first = classifyPrivyUser("did:privy:email", {
      linkedAccounts: [email, embedded],
    });
    const second = classifyPrivyUser("did:privy:email", {
      linkedAccounts: [embedded, email],
    });

    expect(first).toEqual(second);
    expect(first.owner).toEqual({
      kind: "email",
      normalizedEmail: "person+tag@example.com",
    });
    expect(first.productWalletAddress).toBe(EMBEDDED_WALLET);
  });

  test("an external owner remains distinct from the embedded product wallet", () => {
    const evidence = externalEvidence("did:privy:wallet");
    const reversed = classifyPrivyUser("did:privy:wallet", {
      linkedAccounts: [
        {
          type: "wallet",
          address: EXTERNAL_WALLET,
          chainType: "ethereum",
          walletClientType: "metamask",
        },
        {
          type: "wallet",
          address: EMBEDDED_WALLET,
          chainType: "ethereum",
          walletClientType: "privy",
        },
      ],
    });
    expect(evidence).toEqual(reversed);
    expect(evidence.owner).toEqual({
      kind: "external_wallet",
      address: EXTERNAL_WALLET,
    });
    expect(evidence.productWalletAddress).toBe(EMBEDDED_WALLET);
  });

  test("fails closed for missing client type, smart wallets, and contradictory owners", () => {
    const missingClient = classifyPrivyUser("missing-client", {
      linkedAccounts: [{
        type: "wallet",
        address: EXTERNAL_WALLET,
        chainType: "ethereum",
      }],
    });
    const smartWallet = classifyPrivyUser("smart", {
      linkedAccounts: [{
        type: "smart_wallet",
        address: EXTERNAL_WALLET,
      }],
    });
    const contradictory = classifyPrivyUser("contradictory", {
      linkedAccounts: [
        { type: "email", address: "owner@example.com" },
        {
          type: "wallet",
          address: EXTERNAL_WALLET,
          chainType: "ethereum",
          walletClientType: "metamask",
        },
      ],
    });

    expect(missingClient.owner).toEqual({
      kind: "unclassified",
      reason: "missing_wallet_client_type",
    });
    expect(smartWallet.owner).toEqual({
      kind: "unclassified",
      reason: "unsupported_wallet",
    });
    expect(contradictory.owner).toEqual({
      kind: "unclassified",
      reason: "contradictory_owners",
    });
  });
});

describe("Privy authentication verification", () => {
  test("bounds stalled token and profile calls without accepting late completion", async () => {
    const stalledToken = createPrivyAuthenticationVerifier({
      timeoutMs: 5,
      verifyAccessToken: async () => new Promise(() => {}),
      loadUser: async () => {
        throw new Error("must not load");
      },
    });
    const stalledProfile = createPrivyAuthenticationVerifier({
      timeoutMs: 5,
      verifyAccessToken: async () => "did:privy:stalled-profile",
      loadUser: async () => new Promise(() => {}),
    });

    expect(await stalledToken.verify("stalled-token")).toEqual({
      status: "profile_unavailable",
      provider: "privy",
      subject: null,
    });
    expect(await stalledProfile.verify("stalled-profile")).toEqual({
      status: "profile_unavailable",
      provider: "privy",
      subject: "did:privy:stalled-profile",
    });
  });
});

describe("Clerk authentication verification", () => {
  test("configured SDK verification includes the required publishable-key boundary", async () => {
    const dependencies = createClerkSdkDependencies({
      secretKey: "sk_test_private",
      publishableKey: "pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk",
      jwtKey: "not-used-for-a-malformed-token",
      authorizedParties: ["https://example.test"],
    });

    expect(await dependencies.authenticateSessionToken("not-a-session-token"))
      .toBeNull();
  });

  test("accepts only password-enabled users with a verified primary email", async () => {
    const verifier = createClerkAuthenticationVerifier({
      authenticateSessionToken: async () => "user_clerk",
      loadUser: async () => ({
        id: "user_clerk",
        passwordEnabled: true,
        locked: false,
        banned: false,
        primaryEmailAddress: {
          emailAddress: " Person+tag@Example.COM ",
          verification: { status: "verified" },
        },
      }),
    });

    expect(await verifier.verify("session")).toEqual({
      status: "verified",
      evidence: managedEvidence("user_clerk", "person+tag@example.com"),
    });
  });

  test("fails closed for pending, locked, and unverified provider state", async () => {
    const pending = createClerkAuthenticationVerifier({
      authenticateSessionToken: async () => null,
      loadUser: async () => {
        throw new Error("must not load a pending session");
      },
    });
    const locked = createClerkAuthenticationVerifier({
      authenticateSessionToken: async () => "locked",
      loadUser: async () => ({
        id: "locked",
        passwordEnabled: true,
        locked: true,
        banned: false,
        primaryEmailAddress: {
          emailAddress: "locked@example.com",
          verification: { status: "verified" },
        },
      }),
    });
    const unverified = createClerkAuthenticationVerifier({
      authenticateSessionToken: async () => "unverified",
      loadUser: async () => ({
        id: "unverified",
        passwordEnabled: true,
        locked: false,
        banned: false,
        primaryEmailAddress: {
          emailAddress: "unverified@example.com",
          verification: { status: "unverified" },
        },
      }),
    });

    expect(await pending.verify("pending")).toEqual({ status: "invalid" });
    expect(await locked.verify("locked")).toEqual({ status: "locked" });
    expect(await unverified.verify("unverified"))
      .toEqual({ status: "setup_incomplete" });
  });

  test("bounds a stalled provider call without accepting late completion", async () => {
    const verifier = createClerkAuthenticationVerifier({
      timeoutMs: 5,
      authenticateSessionToken: async () => new Promise(() => {}),
      loadUser: async () => {
        throw new Error("must not load");
      },
    });

    expect(await verifier.verify("stalled")).toEqual({
      status: "profile_unavailable",
    });
  });
});

describe("account authentication resolver", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("attaches subject-only legacy accounts without changing account data", async () => {
    const subject = "did:privy:legacy-subject";
    await insertUser(db, subject, null, "legacy@example.com");

    const outcome = await resolveAccountAuthentication(db, {
      provider: "privy",
      subject,
      evidence: emailEvidence(subject, "legacy@example.com"),
    });

    expect(outcome.status).toBe("authenticated");
    if (outcome.status !== "authenticated") return;
    expect(outcome.user.id).toBe(subject);
    expect(outcome.user.walletAddress).toBeNull();
    expect(await credentials(db)).toHaveLength(1);
    expect(await claims(db)).toHaveLength(1);
  });

  test("attaches a credential when the same active claim already exists", async () => {
    const subject = "did:privy:claim-first";
    await insertUser(db, subject, null, "claim-first@example.com");
    await db.insert(schema.verifiedEmailClaims).values({
      normalizedEmail: "claim-first@example.com",
      userId: subject,
      state: "active",
    });

    const outcome = await resolveAccountAuthentication(db, {
      provider: "privy",
      subject,
      evidence: emailEvidence(subject, "claim-first@example.com"),
    });

    expect(outcome.status).toBe("authenticated");
    expect(await credentials(db)).toHaveLength(1);
    expect(await claims(db)).toHaveLength(1);
  });

  test("attaches a wallet-only legacy account", async () => {
    await insertUser(db, "durable-wallet-user", EMBEDDED_WALLET, null);
    const subject = "did:privy:wallet-only";

    const outcome = await resolveAccountAuthentication(db, {
      provider: "privy",
      subject,
      evidence: externalEvidence(subject),
    });

    expect(outcome.status).toBe("authenticated");
    if (outcome.status !== "authenticated") return;
    expect(outcome.user.id).toBe("durable-wallet-user");
    expect((await credentials(db))[0]?.userId).toBe("durable-wallet-user");
  });

  test("keeps a legacy external owning-wallet mapping repeatably authenticatable", async () => {
    await insertUser(db, "durable-external-wallet-user", EXTERNAL_WALLET, null);
    const subject = "did:privy:external-wallet-only";
    const input = {
      provider: "privy" as const,
      subject,
      evidence: externalEvidence(subject),
    };

    const first = await resolveAccountAuthentication(db, input);
    const second = await resolveAccountAuthentication(db, input);

    expect(first.status).toBe("authenticated");
    expect(second.status).toBe("authenticated");
    if (second.status !== "authenticated") return;
    expect(second.user.id).toBe("durable-external-wallet-user");
    expect(second.user.walletAddress).toBe(EXTERNAL_WALLET);
    expect(await credentials(db)).toHaveLength(1);
  });

  test("attaches agreeing subject and wallet mappings only once", async () => {
    const subject = "did:privy:agreeing";
    await insertUser(db, subject, EMBEDDED_WALLET, null);
    const input = {
      provider: "privy" as const,
      subject,
      evidence: externalEvidence(subject),
    };

    const first = await resolveAccountAuthentication(db, input);
    const second = await resolveAccountAuthentication(db, input);

    expect(first.status).toBe("authenticated");
    expect(second.status).toBe("authenticated");
    expect(await credentials(db)).toHaveLength(1);
  });

  test("conflicting subject and wallet mappings block with zero mutation", async () => {
    const subject = "did:privy:conflict";
    await insertUser(db, subject, null, null);
    await insertUser(db, "different-wallet-user", EMBEDDED_WALLET, null);

    const outcome = await resolveAccountAuthentication(db, {
      provider: "privy",
      subject,
      evidence: externalEvidence(subject),
    });

    expect(outcome).toEqual({ status: "support_blocked" });
    expect(await credentials(db)).toHaveLength(0);
    expect(await claims(db)).toHaveLength(0);
  });

  test("creates a durable UUID account, credential, and claim for a new email owner", async () => {
    const subject = "did:privy:new-email";
    const outcome = await resolveAccountAuthentication(db, {
      provider: "privy",
      subject,
      evidence: emailEvidence(subject, "New+tag@Example.com"),
    });

    expect(outcome.status).toBe("authenticated");
    if (outcome.status !== "authenticated") return;
    expect(outcome.created).toBe(true);
    expect(outcome.user.id).not.toBe(subject);
    expect(outcome.user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(outcome.user.email).toBe("new+tag@example.com");
    expect((await credentials(db))[0]?.providerSubject).toBe(subject);
    expect((await claims(db))[0]?.normalizedEmail).toBe("new+tag@example.com");
  });

  test("creates a wallet-owned account using the embedded product wallet projection", async () => {
    const subject = "did:privy:new-wallet";
    const outcome = await resolveAccountAuthentication(db, {
      provider: "privy",
      subject,
      evidence: externalEvidence(subject),
    });

    expect(outcome.status).toBe("authenticated");
    if (outcome.status !== "authenticated") return;
    expect(outcome.user.id).not.toBe(subject);
    expect(outcome.user.walletAddress).toBe(EMBEDDED_WALLET);
    expect(outcome.user.email).toBeNull();
  });

  test("never uses users.email as an implicit merge key", async () => {
    await insertUser(db, "unclaimed-email-user", null, "same@example.com");
    const subject = "did:privy:same-email";

    const outcome = await resolveAccountAuthentication(db, {
      provider: "privy",
      subject,
      evidence: emailEvidence(subject, "same@example.com"),
    });

    expect(outcome.status).toBe("authenticated");
    if (outcome.status !== "authenticated") return;
    expect(outcome.user.id).not.toBe("unclaimed-email-user");
    expect((await db.select().from(schema.users))).toHaveLength(2);
  });

  test("returns link_required instead of merging a matching active email claim", async () => {
    await insertUser(db, "claimed-email-user", null, "claimed@example.com");
    await db.insert(schema.verifiedEmailClaims).values({
      normalizedEmail: "claimed@example.com",
      userId: "claimed-email-user",
      state: "active",
    });
    const subject = "did:privy:claimed-email";

    const outcome = await resolveAccountAuthentication(db, {
      provider: "privy",
      subject,
      evidence: emailEvidence(subject, "claimed@example.com"),
      compatibilityBridgeEnabled: false,
    });

    expect(outcome).toEqual({ status: "link_required" });
    expect(await credentials(db)).toHaveLength(0);
    expect((await db.select().from(schema.users))).toHaveLength(1);
  });

  test("bridge-disabled legacy inference blocks without creating a duplicate", async () => {
    const subject = "did:privy:bridge-disabled-legacy";
    await insertUser(db, subject, null, "legacy@example.com");

    const outcome = await resolveAccountAuthentication(db, {
      provider: "privy",
      subject,
      evidence: emailEvidence(subject, "legacy@example.com"),
      compatibilityBridgeEnabled: false,
    });

    expect(outcome).toEqual({ status: "support_blocked" });
    expect(await credentials(db)).toHaveLength(0);
    expect(await claims(db)).toHaveLength(0);
    expect((await db.select().from(schema.users))).toHaveLength(1);
  });

  test("known credentials authenticate during profile outage without mutation", async () => {
    await insertUser(db, "known-user", null, null);
    await db.insert(schema.authenticationCredentials).values({
      userId: "known-user",
      provider: "privy",
      providerSubject: "did:privy:known",
    });

    const outcome = await resolveAccountAuthentication(db, {
      provider: "privy",
      subject: "did:privy:known",
      evidence: null,
    });

    expect(outcome.status).toBe("authenticated");
    expect(await credentials(db)).toHaveLength(1);
    expect(await claims(db)).toHaveLength(0);
  });

  test("invite requirements apply only when a new account would be created", async () => {
    await insertUser(db, "known-invited-user", null, null);
    await db.insert(schema.authenticationCredentials).values({
      userId: "known-invited-user",
      provider: "privy",
      providerSubject: "did:privy:known-invite",
    });

    const existing = await resolveAccountAuthentication(db, {
      provider: "privy",
      subject: "did:privy:known-invite",
      evidence: null,
      checkInviteRequired: async () => true,
    });
    const newAccount = await resolveAccountAuthentication(db, {
      provider: "privy",
      subject: "did:privy:new-invite",
      evidence: emailEvidence("did:privy:new-invite", "invite@example.com"),
      checkInviteRequired: async () => true,
    });

    expect(existing.status).toBe("authenticated");
    expect(newAccount).toEqual({ status: "invite_required" });
    expect((await db.select().from(schema.users))).toHaveLength(1);
    expect(await credentials(db)).toHaveLength(1);
  });

  test("an invalid invite rolls back the account, credential, and email claim", async () => {
    const subject = "did:privy:invalid-invite";
    const outcome = await resolveAccountAuthentication(db, {
      provider: "privy",
      subject,
      evidence: emailEvidence(subject, "invalid-invite@example.com"),
      checkInviteRequired: async () => true,
      redeemInvite: async () => false,
    });

    expect(outcome).toEqual({ status: "invalid_invite" });
    expect(await db.select().from(schema.users)).toHaveLength(0);
    expect(await credentials(db)).toHaveLength(0);
    expect(await claims(db)).toHaveLength(0);
  });

  test("unknown credentials fail closed during profile outage", async () => {
    const outcome = await resolveAccountAuthentication(db, {
      provider: "privy",
      subject: "did:privy:unknown",
      evidence: null,
    });

    expect(outcome).toEqual({ status: "profile_unavailable" });
    expect((await db.select().from(schema.users))).toHaveLength(0);
  });

  test("concurrent first logins converge on one account and credential", async () => {
    const subject = "did:privy:concurrent";
    const input = {
      provider: "privy" as const,
      subject,
      evidence: emailEvidence(subject, "concurrent@example.com"),
    };

    const outcomes = await Promise.all([
      resolveAccountAuthentication(db, input),
      resolveAccountAuthentication(db, input),
    ]);

    expect(outcomes.map((outcome) => outcome.status))
      .toEqual(["authenticated", "authenticated"]);
    const ids = outcomes.flatMap((outcome) => (
      outcome.status === "authenticated" ? [outcome.user.id] : []
    ));
    expect(new Set(ids).size).toBe(1);
    expect(await credentials(db)).toHaveLength(1);
    expect(await claims(db)).toHaveLength(1);
    expect((await db.select().from(schema.users))).toHaveLength(1);
  });

  test("concurrent distinct subjects cannot create duplicate claimed-email accounts", async () => {
    const firstSubject = "did:privy:email-race-one";
    const secondSubject = "did:privy:email-race-two";

    const outcomes = await Promise.all([
      resolveAccountAuthentication(db, {
        provider: "privy",
        subject: firstSubject,
        evidence: emailEvidence(firstSubject, "race@example.com", EMBEDDED_WALLET),
      }),
      resolveAccountAuthentication(db, {
        provider: "privy",
        subject: secondSubject,
        evidence: emailEvidence(secondSubject, "race@example.com", OTHER_WALLET),
      }),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort())
      .toEqual(["authenticated", "link_required"]);
    expect((await db.select().from(schema.users))).toHaveLength(1);
    expect(await credentials(db)).toHaveLength(1);
    expect(await claims(db)).toHaveLength(1);
  });

  test("a known credential with facts bound to another account support-blocks", async () => {
    await insertUser(db, "known-user", null, null);
    await insertUser(db, "other-user", OTHER_WALLET, null);
    await db.insert(schema.authenticationCredentials).values({
      userId: "known-user",
      provider: "privy",
      providerSubject: "did:privy:known-conflict",
    });

    const evidence = externalEvidence("did:privy:known-conflict", OTHER_WALLET);
    const outcome = await resolveAccountAuthentication(db, {
      provider: "privy",
      subject: evidence.subject,
      evidence,
    });

    expect(outcome).toEqual({ status: "support_blocked" });
  });

  test("managed exchange never creates, while explicit completion is resumable and convergent", async () => {
    const evidence = managedEvidence("clerk-new", "managed-new@example.com");
    expect(await exchangeExistingAccountAuthentication(db, evidence))
      .toEqual({ status: "setup_incomplete" });

    await expect(createManagedAccountAuthentication(
      db,
      evidence,
      async () => {
        throw new Error("injected database failure");
      },
    )).rejects.toThrow("injected database failure");
    expect(await db.select().from(schema.users)).toHaveLength(0);
    expect(await credentials(db)).toHaveLength(0);

    const outcomes = await Promise.all([
      createManagedAccountAuthentication(db, evidence),
      createManagedAccountAuthentication(db, evidence),
    ]);
    expect(outcomes.every((outcome) => outcome.status === "authenticated")).toBe(true);
    const userIds = outcomes.flatMap((outcome) => (
      outcome.status === "authenticated" ? [outcome.user.id] : []
    ));
    expect(new Set(userIds).size).toBe(1);
    expect(await db.select().from(schema.users)).toHaveLength(1);
    expect(await credentials(db)).toHaveLength(1);
    expect((await db.select().from(schema.users))[0]?.walletAddress).toBeNull();
  });

  test("matching email-owned Privy account requires confirmation then links without Privy proof", async () => {
    const privy = emailEvidence(
      "did:privy:managed-link",
      "same-owner@example.com",
    );
    const created = await resolveAccountAuthentication(db, {
      provider: "privy",
      subject: privy.subject,
      evidence: privy,
    });
    expect(created.status).toBe("authenticated");
    if (created.status !== "authenticated") return;

    const clerk = managedEvidence("clerk-link", "same-owner@example.com");
    expect(await exchangeExistingAccountAuthentication(db, clerk))
      .toEqual({ status: "link_required" });
    const linked = await linkManagedAuthenticationCredential(db, {
      evidence: clerk,
    });
    expect(linked.status).toBe("authenticated");
    expect(await credentials(db)).toHaveLength(2);
    expect(await claims(db)).toHaveLength(1);
  });

  test("wallet-owned account requires matching current external-owner proof", async () => {
    const privy = externalEvidence("did:privy:wallet-link");
    const created = await resolveAccountAuthentication(db, {
      provider: "privy",
      subject: privy.subject,
      evidence: privy,
    });
    expect(created.status).toBe("authenticated");
    if (created.status !== "authenticated") return;
    const clerk = managedEvidence("clerk-wallet-link", "wallet-link@example.com");

    expect(await linkManagedAuthenticationCredential(db, {
      userId: created.user.id,
      evidence: clerk,
    })).toEqual({ status: "reauth_required" });
    expect(await credentials(db)).toHaveLength(1);

    const embeddedOnly = emailEvidence(
      privy.subject,
      "unrelated@example.com",
      EMBEDDED_WALLET,
    );
    expect(await linkManagedAuthenticationCredential(db, {
      userId: created.user.id,
      evidence: clerk,
      privyOwnerEvidence: embeddedOnly,
    })).toEqual({ status: "support_blocked" });

    const linked = await linkManagedAuthenticationCredential(db, {
      userId: created.user.id,
      evidence: clerk,
      privyOwnerEvidence: privy,
    });
    expect(linked.status).toBe("authenticated");
    expect(await credentials(db)).toHaveLength(2);
  });

  test("explicit reverse Privy link attaches its credential and product wallet", async () => {
    const clerk = managedEvidence("clerk-reverse", "reverse@example.com");
    const created = await createManagedAccountAuthentication(db, clerk);
    expect(created.status).toBe("authenticated");
    if (created.status !== "authenticated") return;
    expect(created.user.walletAddress).toBeNull();

    const privy = emailEvidence("did:privy:reverse", "reverse@example.com");
    expect(await resolveAccountAuthentication(db, {
      provider: "privy",
      subject: privy.subject,
      evidence: privy,
    })).toEqual({ status: "link_required" });

    const linked = await linkPrivyAuthenticationCredential(db, {
      userId: created.user.id,
      evidence: privy,
    });
    expect(linked.status).toBe("authenticated");
    if (linked.status !== "authenticated") return;
    expect(linked.user.walletAddress).toBe(EMBEDDED_WALLET);
    expect(await credentials(db)).toHaveLength(2);
  });

  test("reverse Privy link rejects an unrelated wallet-owned identity", async () => {
    const clerk = managedEvidence("clerk-walletless", "walletless@example.com");
    const created = await createManagedAccountAuthentication(db, clerk);
    expect(created.status).toBe("authenticated");
    if (created.status !== "authenticated") return;

    const linked = await linkPrivyAuthenticationCredential(db, {
      userId: created.user.id,
      evidence: externalEvidence("did:privy:unrelated-wallet"),
    });

    expect(linked).toEqual({ status: "support_blocked" });
    expect(await credentials(db)).toHaveLength(1);
    expect((await db.select().from(schema.users))[0]?.walletAddress).toBeNull();
  });

  test("conflicting managed subject and email mappings support-block atomically", async () => {
    await insertUser(db, "first", null, "first@example.com");
    await insertUser(db, "second", null, "second@example.com");
    await db.insert(schema.authenticationCredentials).values({
      userId: "first",
      provider: "clerk",
      providerSubject: "clerk-conflict",
    });
    await db.insert(schema.verifiedEmailClaims).values({
      normalizedEmail: "second@example.com",
      userId: "second",
      state: "active",
    });

    expect(await exchangeExistingAccountAuthentication(
      db,
      managedEvidence("clerk-conflict", "second@example.com"),
    )).toEqual({ status: "support_blocked" });
    expect(await credentials(db)).toHaveLength(1);
  });
});

function emailEvidence(
  subject: string,
  address: string,
  productWalletAddress = EMBEDDED_WALLET,
): VerifiedProviderEvidence {
  return classifyPrivyUser(subject, {
    linkedAccounts: [
      { type: "email", address },
      {
        type: "wallet",
        address: productWalletAddress,
        chainType: "ethereum",
        walletClientType: "privy",
      },
    ],
  });
}

function externalEvidence(
  subject: string,
  productWalletAddress = EMBEDDED_WALLET,
): VerifiedProviderEvidence {
  return classifyPrivyUser(subject, {
    linkedAccounts: [
      {
        type: "wallet",
        address: productWalletAddress,
        chainType: "ethereum",
        walletClientType: "privy",
      },
      {
        type: "wallet",
        address: EXTERNAL_WALLET,
        chainType: "ethereum",
        walletClientType: "metamask",
      },
    ],
  });
}

function managedEvidence(
  subject: string,
  email: string,
): VerifiedProviderEvidence {
  return {
    provider: "clerk",
    subject,
    owner: {
      kind: "email",
      normalizedEmail: normalizeVerifiedEmail(email),
    },
    productWalletAddress: null,
  };
}

async function insertUser(
  db: DrizzleDB,
  id: string,
  walletAddress: string | null,
  email: string | null,
): Promise<void> {
  await db.insert(schema.users).values({
    id,
    walletAddress,
    email,
    displayName: "Existing",
  });
}

async function credentials(db: DrizzleDB) {
  return db.select().from(schema.authenticationCredentials);
}

async function claims(db: DrizzleDB) {
  return db.select().from(schema.verifiedEmailClaims);
}
