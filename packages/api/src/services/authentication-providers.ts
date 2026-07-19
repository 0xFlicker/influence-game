import { normalizeVerifiedEmail } from "../lib/verified-email.js";

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

export type ProviderVerificationResult =
  | { status: "verified"; evidence: VerifiedProviderEvidence }
  | { status: "profile_unavailable"; provider: AuthenticationProviderName; subject: string }
  | { status: "invalid" };

export interface AuthenticationProviderVerifier {
  readonly provider: AuthenticationProviderName;
  verify(token: string): Promise<ProviderVerificationResult>;
}

export interface PrivyAuthenticationProviderVerifier
  extends AuthenticationProviderVerifier {
  readonly provider: "privy";
}

/** Implemented in U5; defined here so account resolution remains provider-neutral. */
export interface ClerkAuthenticationProviderVerifier
  extends AuthenticationProviderVerifier {
  readonly provider: "clerk";
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
