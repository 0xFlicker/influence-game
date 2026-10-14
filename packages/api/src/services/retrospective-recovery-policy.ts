import { getPermissionsForUser } from "../db/rbac.js";
import type { DrizzleDB } from "../db/index.js";

/** Producer diagnostic access alone never grants generation. */
export async function hasRetrospectiveRecoveryAccess(db: Pick<DrizzleDB, "select">, userId: string) {
  const current = await getPermissionsForUser(db, userId);
  return current.permissions.includes("resume_game_retrospective") && current.roles.some(role => ["sysop", "admin", "producer"].includes(role));
}
