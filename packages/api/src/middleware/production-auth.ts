import { createMiddleware } from "hono/factory";
import type { DrizzleDB } from "../db/index.js";
import { hasProductionRole } from "../db/rbac.js";
import { bearerChallenge, extractBearerToken, validateGameMcpBearerToken } from "../game-mcp/auth.js";
import { resolveMcpOAuthClientScopeEnvelope } from "../services/mcp-oauth.js";
import { requireAuth, type AuthEnv } from "./auth.js";

export type ProductionAuthEnv = AuthEnv & { Variables: { productionOperatorId: string } };

/** Only endpoints that explicitly name a scope accept MCP OAuth credentials. */
export function requireProductionAuth(db: DrizzleDB, scope?: "producer:media" | "producer:render") {
  const sessionAuth = requireAuth<ProductionAuthEnv>(db);
  return createMiddleware<ProductionAuthEnv>(async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    const token = extractBearerToken(c.req.header("Authorization"));
    // OAuth access tokens are opaque base64url, whereas session tokens are JWTs.
    if (!scope || !token || token.includes(".")) {
      return sessionAuth(c, async () => {
        if (!hasProductionRole(c.get("userRoles"))) {
          c.res = c.json({ error: "Producer or Sysop role required" }, 403);
          return;
        }
        c.set("productionOperatorId", c.get("user").id);
        await next();
      });
    }

    const authorization = await validateGameMcpBearerToken(db, token);
    if (!authorization.ok) return c.json({ error: authorization.reason }, authorization.status);
    const { context } = authorization;
    const envelope = await resolveMcpOAuthClientScopeEnvelope(db, context.clientId);
    if (!envelope || !context.scopes.every(granted => envelope.includes(granted))) {
      return c.json({ error: "OAuth client grant is inactive" }, 401);
    }
    if (!context.scopes.includes("producer")) return c.json({ error: "Production access required" }, 403);
    if (!context.scopes.includes(scope)) {
      c.header("WWW-Authenticate", bearerChallenge({ scopes: ["producer", scope], error: "insufficient_scope" }));
      return c.json({ error: `Explicit producer and ${scope} scopes are required` }, 403);
    }
    c.set("productionOperatorId", context.userId);
    await next();
  });
}
