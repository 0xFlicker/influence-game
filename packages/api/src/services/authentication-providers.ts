import { normalizeVerifiedEmail } from "../lib/verified-email.js";
import { createClerkClient } from "@clerk/backend";

export type AuthenticationProviderName = "privy" | "clerk";

export interface VerifiedEmailOwner {
  kind: "email";
  normalizedEmail: string;
}

export interface VerifiedExternalWalletOwner {
  kind: "external_wallet";
  address: string;
}

export interface UnclassifiedOwner {
  kind: "unclassified";
  reason:
    | "missing_owner"
    | "multiple_email_owners"
    | "multiple_wallet_owners"
    | "contradictory_owners"
    | "unsupported_wallet"
    | "missing_wallet_client_type"
    | "multiple_product_wallets";
}

export type VerifiedAccountOwner =
  | VerifiedEmailOwner
  | VerifiedExternalWalletOwner
  | UnclassifiedOwner;

export interface VerifiedProviderEvidence {
  provider: AuthenticationProviderName;
  subject: string;
  owner: VerifiedAccountOwner;
  /** Privy's embedded wallet, used by Influence as product state, not identity. */
  productWalletAddress: string | null;
}

export type PrivyProviderVerificationResult =
  | { status: "verified"; evidence: VerifiedProviderEvidence }
  | { status: "profile_unavailable"; provider: "privy"; subject: string }
  | { status: "invalid" };

export type ClerkProviderVerificationResult =
  | { status: "verified"; evidence: VerifiedProviderEvidence }
  | { status: "profile_unavailable" }
  | { status: "setup_incomplete" }
  | { status: "locked" }
  | { status: "invalid" };

export type ProviderVerificationResult =
  | PrivyProviderVerificationResult
  | ClerkProviderVerificationResult;

export interface AuthenticationProviderVerifier<
  Result extends ProviderVerificationResult,
> {
  readonly provider: AuthenticationProviderName;
  verify(token: string): Promise<Result>;
}

export interface PrivyAuthenticationProviderVerifier
  extends AuthenticationProviderVerifier<PrivyProviderVerificationResult> {
  readonly provider: "privy";
}

export interface ClerkAuthenticationProviderVerifier
  extends AuthenticationProviderVerifier<ClerkProviderVerificationResult> {
  readonly provider: "clerk";
}

export interface ClerkVerifiedUser {
  id: string;
  passwordEnabled: boolean;
  locked: boolean;
  banned: boolean;
  primaryEmailAddress: {
    emailAddress: string;
    verification: { status: string } | null;
  } | null;
}

export interface ClerkAdapterDependencies {
  authenticateSessionToken(token: string): Promise<string | null>;
  loadUser(subject: string): Promise<ClerkVerifiedUser>;
  timeoutMs?: number;
}

export interface ClerkVerifierConfiguration {
  secretKey: string;
  publishableKey: string;
  jwtKey: string;
  authorizedParties: string[];
  timeoutMs?: number;
}

/**
 * Verifies a Clerk session token with the pinned backend SDK. Pending sessions
 * are deliberately treated as signed out so unfinished session tasks can
 * never become an Influence session.
 */
export function createClerkSdkDependencies(
  configuration: ClerkVerifierConfiguration,
): ClerkAdapterDependencies {
  const client = createClerkClient({
    secretKey: configuration.secretKey,
    publishableKey: configuration.publishableKey,
  });
  const requestOrigin = configuration.authorizedParties[0] ?? "https://invalid.local";

  return {
    timeoutMs: configuration.timeoutMs,
    async authenticateSessionToken(token) {
      const state = await client.authenticateRequest(
        new Request(requestOrigin, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        {
          acceptsToken: "session_token",
          publishableKey: configuration.publishableKey,
          authorizedParties: configuration.authorizedParties,
          jwtKey: configuration.jwtKey,
        },
      );
      if (!state.isAuthenticated) return null;
      const auth = state.toAuth({ treatPendingAsSignedOut: true });
      return auth.isAuthenticated ? auth.userId : null;
    },
    async loadUser(subject) {
      const user = await client.users.getUser(subject);
      return {
        id: user.id,
        passwordEnabled: user.passwordEnabled,
        locked: user.locked,
        banned: user.banned,
        primaryEmailAddress: user.primaryEmailAddress
          ? {
              emailAddress: user.primaryEmailAddress.emailAddress,
              verification: user.primaryEmailAddress.verification
                ? { status: user.primaryEmailAddress.verification.status }
                : null,
            }
          : null,
      };
    },
  };
}

export function createClerkAuthenticationVerifier(
  dependencies: ClerkAdapterDependencies,
): ClerkAuthenticationProviderVerifier {
  const timeoutMs = dependencies.timeoutMs ?? 4_000;
  return {
    provider: "clerk",
    async verify(token) {
      let subject: string | null;
      try {
        subject = await withTimeout(
          dependencies.authenticateSessionToken(token),
          timeoutMs,
        );
      } catch {
        return { status: "profile_unavailable" };
      }
      if (!subject) return { status: "invalid" };

      let user: ClerkVerifiedUser;
      try {
        user = await withTimeout(dependencies.loadUser(subject), timeoutMs);
      } catch {
        return { status: "profile_unavailable" };
      }
      if (user.id !== subject) return { status: "invalid" };
      if (user.locked || user.banned) return { status: "locked" };
      const primary = user.primaryEmailAddress;
      if (
        !user.passwordEnabled
        || !primary
        || primary.verification?.status !== "verified"
      ) {
        return { status: "setup_incomplete" };
      }
      const normalizedEmail = normalizeVerifiedEmail(primary.emailAddress);
      if (!normalizedEmail) return { status: "setup_incomplete" };

      return {
        status: "verified",
        evidence: {
          provider: "clerk",
          subject,
          owner: { kind: "email", normalizedEmail },
          productWalletAddress: null,
        },
      };
    },
  };
}

export interface PrivyAdapterDependencies {
  verifyAccessToken(token: string): Promise<string | null>;
  loadUser(subject: string): Promise<unknown>;
}

/**
 * Adapts Privy's token and profile APIs to provider-neutral verified evidence.
 * A valid token remains distinguishable from a temporary profile API failure,
 * allowing an already-bound credential to authenticate without mutating it.
 */
export function createPrivyAuthenticationVerifier(
  dependencies: PrivyAdapterDependencies,
): PrivyAuthenticationProviderVerifier {
  return {
    provider: "privy",
    async verify(token) {
      const subject = await dependencies.verifyAccessToken(token);
      if (!subject) return { status: "invalid" };

      try {
        return {
          status: "verified",
          evidence: classifyPrivyUser(subject, await dependencies.loadUser(subject)),
        };
      } catch {
        return { status: "profile_unavailable", provider: "privy", subject };
      }
    },
  };
}

interface PrivyLinkedAccount {
  type?: unknown;
  address?: unknown;
  chainType?: unknown;
  walletClientType?: unknown;
}

export function classifyPrivyUser(
  subject: string,
  profile: unknown,
): VerifiedProviderEvidence {
  const linkedAccounts = readLinkedAccounts(profile);
  const emails = unique(linkedAccounts
    .filter((account) => account.type === "email" && typeof account.address === "string")
    .map((account) => normalizeVerifiedEmail(account.address as string))
    .filter(Boolean));

  const walletAccounts = linkedAccounts.filter((account) => account.type === "wallet");
  let hasUnsupportedWallet = linkedAccounts.some(
    (account) => account.type === "smart_wallet",
  );
  let hasMissingWalletClientType = false;
  const externalWallets: string[] = [];
  const productWallets: string[] = [];

  for (const wallet of walletAccounts) {
    if (wallet.chainType !== "ethereum" || !isEthereumAddress(wallet.address)) {
      hasUnsupportedWallet = true;
      continue;
    }
    if (typeof wallet.walletClientType !== "string" || wallet.walletClientType.length === 0) {
      hasMissingWalletClientType = true;
      continue;
    }
    const address = wallet.address.toLowerCase();
    if (wallet.walletClientType === "privy") {
      productWallets.push(address);
    } else {
      externalWallets.push(address);
    }
  }

  const uniqueEmails = unique(emails);
  const uniqueExternalWallets = unique(externalWallets);
  const uniqueProductWallets = unique(productWallets);
  const productWalletAddress = uniqueProductWallets.length === 1
    ? uniqueProductWallets[0]!
    : null;

  let owner: VerifiedAccountOwner;
  if (uniqueProductWallets.length > 1) {
    owner = { kind: "unclassified", reason: "multiple_product_wallets" };
  } else if (uniqueEmails.length > 1) {
    owner = { kind: "unclassified", reason: "multiple_email_owners" };
  } else if (uniqueExternalWallets.length > 1) {
    owner = { kind: "unclassified", reason: "multiple_wallet_owners" };
  } else if (uniqueEmails.length === 1 && uniqueExternalWallets.length === 1) {
    owner = { kind: "unclassified", reason: "contradictory_owners" };
  } else if (hasMissingWalletClientType) {
    owner = { kind: "unclassified", reason: "missing_wallet_client_type" };
  } else if (hasUnsupportedWallet) {
    owner = { kind: "unclassified", reason: "unsupported_wallet" };
  } else if (uniqueEmails.length === 1) {
    owner = { kind: "email", normalizedEmail: uniqueEmails[0]! };
  } else if (uniqueExternalWallets.length === 1) {
    owner = { kind: "external_wallet", address: uniqueExternalWallets[0]! };
  } else {
    owner = { kind: "unclassified", reason: "missing_owner" };
  }

  return {
    provider: "privy",
    subject,
    owner,
    productWalletAddress,
  };
}

function readLinkedAccounts(profile: unknown): PrivyLinkedAccount[] {
  if (!profile || typeof profile !== "object") return [];
  const linkedAccounts = (profile as { linkedAccounts?: unknown }).linkedAccounts;
  return Array.isArray(linkedAccounts)
    ? linkedAccounts.filter((entry): entry is PrivyLinkedAccount => (
      entry !== null && typeof entry === "object"
    ))
    : [];
}

function isEthereumAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("authentication provider timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
