import { and, desc, eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";

export const CURRENT_TERMS_VERSION = "2026-08-12";
export const CURRENT_PRIVACY_VERSION = "2026-08-12";

export interface LegalAcceptanceVersions {
  termsVersion: string;
  privacyVersion: string;
}

type LegalAcceptanceWriter = Pick<DrizzleDB, "insert">;

export type LegalAcceptanceSource =
  | "account_creation"
  | "existing_account";

export function currentLegalAcceptanceVersions(): LegalAcceptanceVersions {
  return {
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
  };
}

export function hasCurrentLegalAcceptanceVersions(
  value: LegalAcceptanceVersions | null | undefined,
): boolean {
  return value?.termsVersion === CURRENT_TERMS_VERSION
    && value.privacyVersion === CURRENT_PRIVACY_VERSION;
}

export async function recordCurrentLegalAcceptance(
  db: LegalAcceptanceWriter,
  userId: string,
  source: LegalAcceptanceSource,
): Promise<void> {
  await db.insert(schema.legalAcceptances).values({
    userId,
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    source,
  }).onConflictDoNothing();
}

export async function projectCurrentLegalAcceptance(
  db: DrizzleDB,
  userId: string,
) {
  const acceptance = (await db
    .select({ acceptedAt: schema.legalAcceptances.acceptedAt })
    .from(schema.legalAcceptances)
    .where(and(
      eq(schema.legalAcceptances.userId, userId),
      eq(schema.legalAcceptances.termsVersion, CURRENT_TERMS_VERSION),
      eq(schema.legalAcceptances.privacyVersion, CURRENT_PRIVACY_VERSION),
    ))
    .orderBy(desc(schema.legalAcceptances.acceptedAt))
    .limit(1))[0];

  return {
    ...currentLegalAcceptanceVersions(),
    accepted: Boolean(acceptance),
    acceptedAt: acceptance?.acceptedAt ?? null,
  };
}
