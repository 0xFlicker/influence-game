import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { getPostgresConstraintName } from "../lib/postgres-errors.js";
import { getSafeDefaultDisplayName } from "../lib/display-name.js";
import type {
  AuthenticationProviderName,
  VerifiedProviderEvidence,
} from "./authentication-providers.js";

type AuthenticationTransaction =
  Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

export interface AuthenticatedAccount {
  id: string;
  walletAddress: string | null;
  email: string | null;
  displayName: string | null;
  publicId: string;
  handle: string | null;
  createdAt: string;
}

export type AccountAuthenticationOutcome =
  | { status: "authenticated"; user: AuthenticatedAccount; created: boolean }
  | { status: "profile_unavailable" }
  | { status: "support_blocked" }
  | { status: "link_required" }
  | { status: "invite_required" }
  | { status: "invalid_invite" };

export interface ResolveAccountAuthenticationInput {
  provider: AuthenticationProviderName;
  subject: string;
  /** Null only when token verification passed but the provider profile was unavailable. */
  evidence: VerifiedProviderEvidence | null;
  compatibilityBridgeEnabled?: boolean;
  checkInviteRequired?: (
    tx: AuthenticationTransaction,
  ) => Promise<boolean>;
  redeemInvite?: (
    tx: AuthenticationTransaction,
    userId: string,
  ) => Promise<boolean>;
}

const RETRYABLE_AUTH_CONSTRAINTS = new Set([
  "authentication_credentials_provider_subject_unique",
  "verified_email_claims_pkey",
  "verified_email_claims_active_user_id_unique",
  "users_pkey",
  "users_wallet_address_unique",
]);

class InvalidInviteError extends Error {}

/**
 * Resolve verified provider evidence to one durable Influence account.
 *
 * Every identity write happens in one transaction. A named unique constraint
 * race gets one fresh transaction retry, which converges on the winner.
 */
export async function resolveAccountAuthentication(
  db: DrizzleDB,
  input: ResolveAccountAuthenticationInput,
): Promise<AccountAuthenticationOutcome> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await db.transaction((tx) => resolveInTransaction(tx, input));
    } catch (error) {
      if (error instanceof InvalidInviteError) {
        return { status: "invalid_invite" };
      }
      const constraint = getPostgresConstraintName(error);
      if (attempt === 0 && constraint && RETRYABLE_AUTH_CONSTRAINTS.has(constraint)) {
        continue;
      }
      throw error;
    }
  }
  return { status: "support_blocked" };
}

async function resolveInTransaction(
  tx: AuthenticationTransaction,
  input: ResolveAccountAuthenticationInput,
): Promise<AccountAuthenticationOutcome> {
  const credential = await findCredential(tx, input.provider, input.subject);

  if (credential) {
    if (credential.retiredAt) return { status: "support_blocked" };
    const user = await loadUser(tx, credential.userId);
    if (!user) return { status: "support_blocked" };
    if (!input.evidence) {
      return { status: "authenticated", user, created: false };
    }
    if (!evidenceMatchesBinding(input.evidence, input.provider, input.subject)) {
      return { status: "support_blocked" };
    }
    if (!await knownEvidenceIsConsistent(tx, user, input.evidence)) {
      return { status: "support_blocked" };
    }
    return { status: "authenticated", user, created: false };
  }

  if (!input.evidence) return { status: "profile_unavailable" };
  if (!evidenceMatchesBinding(input.evidence, input.provider, input.subject)) {
    return { status: "support_blocked" };
  }
  if (input.evidence.owner.kind === "unclassified") {
    return { status: "support_blocked" };
  }

  const legacyUser = input.compatibilityBridgeEnabled === false
    ? { status: "none" as const }
    : await resolveLegacyUser(tx, input.evidence);

  if (legacyUser.status === "conflict") return { status: "support_blocked" };
  if (legacyUser.status === "found") {
    const claimOutcome = await validateClaimAttachment(tx, legacyUser.user.id, input.evidence);
    if (claimOutcome !== "ok") return { status: claimOutcome };

    await insertCredentialAndClaim(tx, legacyUser.user.id, input.evidence);
    return { status: "authenticated", user: legacyUser.user, created: false };
  }

  const preflight = await validateNewAccount(tx, input.evidence);
  if (preflight !== "ok") {
    // Under READ COMMITTED, a same-subject transaction can commit between our
    // initial credential lookup and email-claim preflight. Re-read the
    // credential after seeing that claim so both completions converge.
    if (preflight === "link_required") {
      const concurrentCredential = await findCredential(
        tx,
        input.provider,
        input.subject,
      );
      if (concurrentCredential && !concurrentCredential.retiredAt) {
        const concurrentUser = await loadUser(tx, concurrentCredential.userId);
        if (
          concurrentUser
          && await knownEvidenceIsConsistent(tx, concurrentUser, input.evidence)
        ) {
          return {
            status: "authenticated",
            user: concurrentUser,
            created: false,
          };
        }
      }
    }
    return { status: preflight };
  }
  const inviteRequired = await input.checkInviteRequired?.(tx) ?? false;
  if (inviteRequired && !input.redeemInvite) {
    return { status: "invite_required" };
  }

  const userId = randomUUID();
  const projectedWalletAddress = getProjectedWalletAddress(input.evidence);
  const email = input.evidence.owner.kind === "email"
    ? input.evidence.owner.normalizedEmail
    : null;
  const [createdUser] = await tx.insert(schema.users).values({
    id: userId,
    walletAddress: projectedWalletAddress,
    email,
    displayName: getSafeDefaultDisplayName({ walletAddress: projectedWalletAddress }),
  }).returning();

  if (!createdUser) return { status: "support_blocked" };
  await insertCredentialAndClaim(tx, userId, input.evidence);

  if (inviteRequired && input.redeemInvite && !await input.redeemInvite(tx, userId)) {
    throw new InvalidInviteError();
  }

  return { status: "authenticated", user: createdUser, created: true };
}

function evidenceMatchesBinding(
  evidence: VerifiedProviderEvidence,
  provider: AuthenticationProviderName,
  subject: string,
): boolean {
  return evidence.provider === provider && evidence.subject === subject;
}

async function findCredential(
  tx: AuthenticationTransaction,
  provider: AuthenticationProviderName,
  subject: string,
) {
  return (await tx
    .select()
    .from(schema.authenticationCredentials)
    .where(and(
      eq(schema.authenticationCredentials.provider, provider),
      eq(schema.authenticationCredentials.providerSubject, subject),
    )))[0];
}

async function loadUser(
  tx: AuthenticationTransaction,
  userId: string,
): Promise<AuthenticatedAccount | null> {
  return (await tx
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId)))[0] ?? null;
}

async function knownEvidenceIsConsistent(
  tx: AuthenticationTransaction,
  user: AuthenticatedAccount,
  evidence: VerifiedProviderEvidence,
): Promise<boolean> {
  if (evidence.owner.kind === "unclassified") return false;

  const candidateAddresses = getVerifiedWalletFacts(evidence);
  if (candidateAddresses.length > 0) {
    const mappedUsers = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.walletAddress, candidateAddresses));
    if (mappedUsers.some((candidate) => candidate.id !== user.id)) return false;
  }

  if (
    user.walletAddress
    && candidateAddresses.length > 0
    && !candidateAddresses.includes(user.walletAddress)
  ) {
    return false;
  }

  if (evidence.owner.kind === "email") {
    const claim = (await tx
      .select()
      .from(schema.verifiedEmailClaims)
      .where(eq(
        schema.verifiedEmailClaims.normalizedEmail,
        evidence.owner.normalizedEmail,
      )))[0];
    if (claim && (claim.state !== "active" || claim.userId !== user.id)) return false;
  }
  return true;
}

async function resolveLegacyUser(
  tx: AuthenticationTransaction,
  evidence: VerifiedProviderEvidence,
): Promise<
  | { status: "none" }
  | { status: "found"; user: AuthenticatedAccount }
  | { status: "conflict" }
> {
  const candidates = new Map<string, AuthenticatedAccount>();
  const subjectUser = await loadUser(tx, evidence.subject);
  if (subjectUser) candidates.set(subjectUser.id, subjectUser);

  const addresses = getVerifiedWalletFacts(evidence);
  if (addresses.length > 0) {
    const walletUsers = await tx
      .select()
      .from(schema.users)
      .where(inArray(schema.users.walletAddress, addresses));
    for (const user of walletUsers) candidates.set(user.id, user);
  }

  if (candidates.size === 0) return { status: "none" };
  if (candidates.size > 1) return { status: "conflict" };
  return { status: "found", user: [...candidates.values()][0]! };
}

async function validateClaimAttachment(
  tx: AuthenticationTransaction,
  userId: string,
  evidence: VerifiedProviderEvidence,
): Promise<"ok" | "support_blocked" | "link_required"> {
  if (evidence.owner.kind !== "email") return "ok";

  const [claim, existingUserClaim] = await Promise.all([
    tx.select()
      .from(schema.verifiedEmailClaims)
      .where(eq(
        schema.verifiedEmailClaims.normalizedEmail,
        evidence.owner.normalizedEmail,
      ))
      .then((rows) => rows[0]),
    tx.select()
      .from(schema.verifiedEmailClaims)
      .where(and(
        eq(schema.verifiedEmailClaims.userId, userId),
        eq(schema.verifiedEmailClaims.state, "active"),
      ))
      .then((rows) => rows[0]),
  ]);

  if (claim && (claim.state !== "active" || claim.userId !== userId)) {
    return "support_blocked";
  }
  if (
    existingUserClaim
    && existingUserClaim.normalizedEmail !== evidence.owner.normalizedEmail
  ) {
    return "support_blocked";
  }
  return "ok";
}

async function validateNewAccount(
  tx: AuthenticationTransaction,
  evidence: VerifiedProviderEvidence,
): Promise<"ok" | "support_blocked" | "link_required"> {
  if (evidence.owner.kind !== "email") return "ok";
  const claim = (await tx
    .select()
    .from(schema.verifiedEmailClaims)
    .where(eq(
      schema.verifiedEmailClaims.normalizedEmail,
      evidence.owner.normalizedEmail,
    )))[0];
  if (!claim) return "ok";
  return claim.state === "active" ? "link_required" : "support_blocked";
}

async function insertCredentialAndClaim(
  tx: AuthenticationTransaction,
  userId: string,
  evidence: VerifiedProviderEvidence,
): Promise<void> {
  await tx.insert(schema.authenticationCredentials).values({
    userId,
    provider: evidence.provider,
    providerSubject: evidence.subject,
  });

  if (evidence.owner.kind === "email") {
    const existingClaim = (await tx
      .select()
      .from(schema.verifiedEmailClaims)
      .where(eq(
        schema.verifiedEmailClaims.normalizedEmail,
        evidence.owner.normalizedEmail,
      )))[0];
    if (
      existingClaim?.state === "active"
      && existingClaim.userId === userId
    ) {
      return;
    }
    await tx.insert(schema.verifiedEmailClaims).values({
      normalizedEmail: evidence.owner.normalizedEmail,
      userId,
      state: "active",
    });
  }
}

function getProjectedWalletAddress(evidence: VerifiedProviderEvidence): string | null {
  if (evidence.productWalletAddress) return evidence.productWalletAddress;
  return evidence.owner.kind === "external_wallet"
    ? evidence.owner.address
    : null;
}

function getVerifiedWalletFacts(evidence: VerifiedProviderEvidence): string[] {
  const addresses = new Set<string>();
  if (evidence.productWalletAddress) addresses.add(evidence.productWalletAddress);
  if (evidence.owner.kind === "external_wallet") addresses.add(evidence.owner.address);
  return [...addresses];
}
