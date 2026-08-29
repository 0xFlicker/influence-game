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

export function normalizeDeploymentSha(value: unknown): string | null {
  const deploymentSha = typeof value === "string" ? value.trim() : "";
  if (deploymentSha && /^[0-9a-f]{40}$/i.test(deploymentSha)) {
    return deploymentSha.toLowerCase();
  }
  if (deploymentSha === "unknown" && process.env.NODE_ENV !== "production") {
    return deploymentSha;
  }
  return null;
}

export function assertRuntimeDeploymentSha(): void {
  if (
    process.env.NODE_ENV === "production"
    && normalizeDeploymentSha(process.env.GIT_SHA) === null
  ) {
    throw new Error("GIT_SHA must be a full 40-character commit SHA");
  }
}

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
  presentedDeploymentSha: string,
): Promise<void> {
  const deploymentSha = normalizeDeploymentSha(presentedDeploymentSha);
  if (deploymentSha === null) {
    throw new Error("Legal acceptance requires a valid presentation deployment SHA");
  }
  await db.insert(schema.legalAcceptances).values({
    userId,
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    deploymentSha,
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
