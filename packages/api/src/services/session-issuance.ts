import type { DrizzleDB } from "../db/index.js";
import { getPermissionsForAddress } from "../db/rbac.js";
import { createSessionToken } from "../middleware/auth.js";
import { projectAuthenticatedPublicIdentity } from "./authenticated-public-identity.js";
import type { AuthenticatedAccount } from "./account-authentication.js";

/**
 * One post-commit session projection for every login provider. Roles and
 * permissions remain Influence data and are never accepted from Clerk/Privy.
 */
export async function issueInfluenceSession(
  db: DrizzleDB,
  user: AuthenticatedAccount,
) {
  const resolved = user.walletAddress
    ? await getPermissionsForAddress(db, user.walletAddress)
    : { roles: [], permissions: [] };
  const token = await createSessionToken(user.id, resolved);

  return {
    token,
    user: {
      id: user.id,
      walletAddress: user.walletAddress,
      email: user.email,
      ...projectAuthenticatedPublicIdentity(user),
      roles: resolved.roles,
      permissions: resolved.permissions,
    },
  };
}
