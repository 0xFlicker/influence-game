import { sql } from "drizzle-orm";
import { schema } from "../db/index.js";
import { getPublicDisplayName } from "../lib/display-name.js";

interface UserEmailAccessInput {
  requesterUserId: string;
  requesterWalletAddress: string | null;
}

function userEmailAccessCondition(input: UserEmailAccessInput) {
  const isRequester = sql`${schema.users.id} = ${input.requesterUserId}`;
  if (!input.requesterWalletAddress) return isRequester;

  return sql`(
    ${isRequester}
    OR EXISTS (
      SELECT 1
      FROM ${schema.addressRoles}
      INNER JOIN ${schema.roles}
        ON ${schema.addressRoles.roleId} = ${schema.roles.id}
      WHERE LOWER(${schema.addressRoles.walletAddress})
        = LOWER(${input.requesterWalletAddress})
        AND (
          ${schema.roles.name} = 'sysop'
          OR ${schema.roles.name} = 'admin'
          OR ${schema.roles.name} = 'producer'
        )
    )
  )`;
}

export function userEmailAccessProjection(input: UserEmailAccessInput) {
  return sql<boolean>`${userEmailAccessCondition(input)}`;
}

export function userEmailProjection(input: UserEmailAccessInput) {
  return sql<string | null>`
    CASE
      WHEN ${userEmailAccessCondition(input)} THEN ${schema.users.email}
      ELSE NULL
    END
  `;
}

export function userDisplayNameContainsEmailProjection() {
  return sql<boolean>`
    COALESCE(
      BTRIM(${schema.users.email}) <> ''
        AND POSITION(
          LOWER(BTRIM(${schema.users.email}))
          IN LOWER(${schema.users.displayName})
        ) > 0,
      FALSE
    )
  `;
}

export function userDisplayNameForEmailPolicy(input: {
  canReadEmail: boolean;
  displayNameContainsEmail: boolean;
  displayName: string | null;
  walletAddress: string | null;
}): string | null {
  if (input.canReadEmail) return input.displayName;
  if (input.displayNameContainsEmail) {
    return "Anonymous";
  }

  return getPublicDisplayName({
    displayName: input.displayName,
    email: null,
    walletAddress: input.walletAddress,
  });
}
