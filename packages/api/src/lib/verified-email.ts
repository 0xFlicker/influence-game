import { createHmac } from "node:crypto";

/**
 * Canonical form for a provider-verified email address.
 *
 * Do not apply provider-specific aliases here. Plus tags and dots are part of
 * the address presented by the identity provider and remain significant.
 */
export function normalizeVerifiedEmail(email: string): string {
  return email.trim().toLowerCase();
}


export function accountEmailHashKey(): Buffer {
  const value = process.env.ACCOUNT_EMAIL_HMAC_KEY ?? "";
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) {
    throw new Error("ACCOUNT_EMAIL_HMAC_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

export function hashAccountEmail(email: string): string {
  return createHmac("sha256", accountEmailHashKey())
    .update("house:account-email:v1\0")
    .update(normalizeVerifiedEmail(email))
    .digest("hex");
}

export function accountEmailKeyCheck(): string {
  return createHmac("sha256", accountEmailHashKey()).update("house:account-email-key-check:v1").digest("hex");
}
