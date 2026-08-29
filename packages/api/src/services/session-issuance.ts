import { and, eq, isNull } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { getPermissionsForAddress } from "../db/rbac.js";
import { createSessionToken } from "../middleware/auth.js";
import { projectAuthenticatedPublicIdentity } from "./authenticated-public-identity.js";
import type { AuthenticatedAccount } from "./account-authentication.js";
import { projectCurrentLegalAcceptance } from "./legal-acceptance.js";

export async function projectLoginMethods(db: DrizzleDB, userId: string) {
  const credentials = await db
    .select({ provider: schema.authenticationCredentials.provider })
    .from(schema.authenticationCredentials)
    .where(and(
      eq(schema.authenticationCredentials.userId, userId),
      isNull(schema.authenticationCredentials.retiredAt),
    ));
  const providers = new Set(credentials.map((credential) => credential.provider));
  return {
    privy: providers.has("privy"),
    emailPassword: providers.has("clerk"),
    farcaster: providers.has("farcaster"),
  };
}

/**
 * One post-commit session projection for every login provider. Roles and
 * permissions remain Influence data and are never accepted from Clerk/Privy.
 */
export async function issueInfluenceSession(
  db: DrizzleDB,
  user: AuthenticatedAccount,
) {
  const [resolved, loginMethods, legal] = await Promise.all([
    user.walletAddress
      ? getPermissionsForAddress(db, user.walletAddress)
      : Promise.resolve({ roles: [], permissions: [] }),
    projectLoginMethods(db, user.id),
    projectCurrentLegalAcceptance(db, user.id),
  ]);
  const token = await createSessionToken(user.id, {
    ...resolved,
    legalAcceptance: legal.accepted
      ? {
        termsVersion: legal.termsVersion,
        privacyVersion: legal.privacyVersion,
      }
      : null,
  });

  return {
    token,
    user: {
      id: user.id,
      walletAddress: user.walletAddress,
      email: user.email,
      ...projectAuthenticatedPublicIdentity(user),
      roles: resolved.roles,
      permissions: resolved.permissions,
      loginMethods,
      legal,
    },
  };
}
