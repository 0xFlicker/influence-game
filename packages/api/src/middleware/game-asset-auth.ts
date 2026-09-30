import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { getPermissionsForUser } from "../db/rbac.js";
import { validateGameMcpBearerToken } from "../game-mcp/auth.js";
import { hasCurrentLegalAcceptanceVersions, projectCurrentLegalAcceptance } from "../services/legal-acceptance.js";
import { verifySessionToken } from "./auth.js";
import { GameAssetError } from "../services/game-asset-storage.js";

export interface GameAssetActor { id: string; walletAddress: string | null; permissions: string[]; authority: "session" | "oauth"; scope: string }
export type GameAssetEnv = { Variables: { assetActor: GameAssetActor | null } };

/** Anonymous reads and app sessions are supported only in this endpoint family. */
export function gameAssetAuth(db: DrizzleDB) {
  return createMiddleware<GameAssetEnv>(async (c, next) => {
    c.set("assetActor", null);
    const header = c.req.header("Authorization");
    if (header) {
      if (!header.startsWith("Bearer ") || !header.slice(7).trim()) throw new GameAssetError("asset_unauthorized", 401, "Invalid bearer token");
      const token = header.slice(7).trim();
      const session = await verifySessionToken(token);
      let id: string;
      let authority: "session" | "oauth";
      let scope = "";
      if (session) {
        id = session.userId; authority = "session";
        if (!hasCurrentLegalAcceptanceVersions(session.legalAcceptance) && !(await projectCurrentLegalAcceptance(db, id)).accepted) throw new GameAssetError("LEGAL_ACCEPTANCE_REQUIRED", 403, "Current legal acceptance is required");
      } else {
        const validation = await validateGameMcpBearerToken(db, token);
        if (!validation.ok) throw new GameAssetError("asset_unauthorized", validation.status, validation.reason);
        if (!validation.context.scopes.includes("assets:manage")) throw new GameAssetError("asset_forbidden", 403, "Explicit assets:manage scope is required");
        id = validation.context.userId; authority = "oauth"; scope = validation.context.scope;
      }
      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
      if (!user) throw new GameAssetError("asset_unauthorized", 401, "Account is unavailable");
      const permissions = (await getPermissionsForUser(db, user.id)).permissions;
      if (authority === "oauth" && !permissions.includes("manage_game_assets")) throw new GameAssetError("asset_forbidden", 403, "Game asset permission is required");
      c.set("assetActor", { id, walletAddress: user.walletAddress, permissions, authority, scope });
    }
    await next();
  });
}
export function requireAssetManager(actor: GameAssetActor | null): GameAssetActor {
  if (!actor) throw new GameAssetError("asset_unauthorized", 401, "Authentication required");
  if (!actor.permissions.includes("manage_game_assets")) throw new GameAssetError("asset_forbidden", 403, "Game asset permission is required");
  return actor;
}
