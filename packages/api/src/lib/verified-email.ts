/**
 * Canonical form for a provider-verified email address.
 *
 * Do not apply provider-specific aliases here. Plus tags and dots are part of
 * the address presented by the identity provider and remain significant.
 */
export function normalizeVerifiedEmail(email: string): string {
  return email.trim().toLowerCase();
}
