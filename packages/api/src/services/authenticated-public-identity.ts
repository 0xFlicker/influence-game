import type { schema } from "../db/index.js";
import { getPublicDisplayName, hasSafePublicDisplayName } from "../lib/display-name.js";
import {
  classifyPublicIdentityOnboarding,
  type PublicIdentityOnboardingClassification,
} from "../lib/public-player-identity.js";

/**
 * Rollout seam for identity enforcement.
 *
 * All API producers must be deployed with the same value before this instant.
 * Accounts created by an older producer are still classified from createdAt,
 * so they cannot become permanently dismissible when a current API reads them.
 */
export const PUBLIC_IDENTITY_LAUNCH_CUTOFF =
  process.env.PUBLIC_IDENTITY_LAUNCH_CUTOFF ?? "2026-07-17T00:00:00.000Z";

type UserIdentityRow = Pick<
  typeof schema.users.$inferSelect,
  "publicId" | "handle" | "displayName" | "email" | "walletAddress" | "createdAt"
>;

export interface AuthenticatedPublicIdentity {
  publicId: string;
  handle: string | null;
  displayName: string;
  publicIdentityOnboarding: PublicIdentityOnboardingClassification;
}

export function projectAuthenticatedPublicIdentity(
  user: UserIdentityRow,
  cutoff = PUBLIC_IDENTITY_LAUNCH_CUTOFF,
): AuthenticatedPublicIdentity {
  const publicIdentityOnboarding = classifyPublicIdentityOnboarding({
    hasSafeDisplayName: hasSafePublicDisplayName(user),
    handle: user.handle,
    createdAt: user.createdAt,
    cutoff,
  });

  if (publicIdentityOnboarding.diagnosticCode) {
    console.error("[public-identity] Cannot safely classify account creation time", {
      publicId: user.publicId,
      diagnosticCode: publicIdentityOnboarding.diagnosticCode,
    });
  }

  return {
    publicId: user.publicId,
    handle: user.handle,
    displayName: getPublicDisplayName(user),
    publicIdentityOnboarding,
  };
}
