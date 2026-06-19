import type { DrizzleDB } from "../db/index.js";
import {
  getMcpOAuthResourceUri,
  introspectMcpAccessToken,
  MCP_OAUTH_AUDIENCE,
  MCP_OAUTH_PURPOSE,
  MCP_OAUTH_SCOPE,
} from "../services/mcp-oauth.js";

export interface GameMcpAuthContext {
  userId: string;
  clientId: string;
  resource: string;
  scope: typeof MCP_OAUTH_SCOPE;
  expiresAt: number;
}

export type GameMcpAuthResult =
  | { ok: true; context: GameMcpAuthContext }
  | { ok: false; status: 401 | 403; reason: string };

export function bearerChallenge(requestOrigin: string): string {
  const metadataUrl = new URL(
    "/.well-known/oauth-protected-resource",
    requestOrigin,
  ).toString();
  return [
    'Bearer realm="influence-game-mcp"',
    `resource_metadata="${metadataUrl}"`,
    `scope="${MCP_OAUTH_SCOPE}"`,
  ].join(", ");
}

export function extractBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function validateGameMcpBearerToken(
  db: DrizzleDB,
  token: string,
): Promise<GameMcpAuthResult> {
  const introspection = await introspectMcpAccessToken(db, token);
  if (!introspection.active) {
    return { ok: false, status: 401, reason: "inactive_token" };
  }

  if (
    introspection.aud !== MCP_OAUTH_AUDIENCE ||
    introspection.purpose !== MCP_OAUTH_PURPOSE ||
    introspection.scope !== MCP_OAUTH_SCOPE ||
    introspection.resource !== getMcpOAuthResourceUri() ||
    !introspection.client_id ||
    !introspection.sub ||
    !introspection.exp
  ) {
    return { ok: false, status: 401, reason: "invalid_token_claims" };
  }

  return {
    ok: true,
    context: {
      userId: introspection.sub,
      clientId: introspection.client_id,
      resource: introspection.resource,
      scope: MCP_OAUTH_SCOPE,
      expiresAt: introspection.exp,
    },
  };
}

export function originIsAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  const allowed = new Set(
    (process.env.MCP_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  allowed.add(new URL(getMcpOAuthResourceUri()).origin);
  return allowed.has(origin);
}
