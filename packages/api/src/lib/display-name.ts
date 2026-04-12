const EMAIL_LIKE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

interface DisplayNameInput {
  displayName?: string | null;
  email?: string | null;
  walletAddress?: string | null;
}

function truncateWallet(walletAddress: string): string {
  return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
}

export function isEmailLike(value: string | null | undefined): boolean {
  if (!value) return false;
  return EMAIL_LIKE_RE.test(value.trim());
}

export function getSafeDefaultDisplayName({
  walletAddress,
}: Pick<DisplayNameInput, "walletAddress">): string {
  if (walletAddress) {
    return truncateWallet(walletAddress);
  }

  return "Player";
}

export function getPublicDisplayName({
  displayName,
  email,
  walletAddress,
}: DisplayNameInput): string {
  const normalizedDisplayName = displayName?.trim() ?? null;
  const normalizedEmail = email?.trim().toLowerCase() ?? null;

  if (normalizedDisplayName) {
    const normalizedName = normalizedDisplayName.toLowerCase();
    if (!isEmailLike(normalizedDisplayName) && normalizedName !== normalizedEmail) {
      return normalizedDisplayName;
    }
  }

  if (walletAddress) {
    return truncateWallet(walletAddress);
  }

  return "Anonymous";
}

