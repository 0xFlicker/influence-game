import type { DrizzleDB } from "../db/index.js";
import {
  getMcpOAuthProfile,
  getMcpOAuthProfileResourceUri,
  getMcpOAuthProfiles,
  getMcpOAuthResourceUri,
  introspectMcpAccessToken,
  MCP_OAUTH_AUDIENCE,
  MCP_OAUTH_PURPOSE,
  type McpAuthProfile,
  type McpOAuthProfileName,
  type McpOAuthScope,
} from "../services/mcp-oauth.js";

export interface GameMcpAuthContext {
  userId: string;
  clientId: string;
  resource: string;
  scope: McpOAuthScope;
  authProfile: McpAuthProfile;
  expiresAt: number;
}

export type GameMcpAuthResult =
  | { ok: true; context: GameMcpAuthContext }
  | { ok: false; status: 401 | 403; reason: string };

export function bearerChallenge(
  requestOrigin: string,
  profileName: McpOAuthProfileName = "games",
): string {
  const profile = getMcpOAuthProfile(profileName);
  const metadataUrl = new URL(
    profile.protectedResourceMetadataPath,
    requestOrigin,
  ).toString();
  return [
    'Bearer realm="influence-game-mcp"',
    `resource_metadata="${metadataUrl}"`,
    `scope="${profile.scope}"`,
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
  expectedProfileName: McpOAuthProfileName = "games",
): Promise<GameMcpAuthResult> {
  const expectedProfile = getMcpOAuthProfile(expectedProfileName);
  const introspection = await introspectMcpAccessToken(db, token);
  if (!introspection.active) {
    return { ok: false, status: 401, reason: "inactive_token" };
  }

  if (
    introspection.aud !== MCP_OAUTH_AUDIENCE ||
    introspection.purpose !== MCP_OAUTH_PURPOSE ||
    introspection.scope !== expectedProfile.scope ||
    introspection.resource !== getMcpOAuthProfileResourceUri(expectedProfile) ||
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
      scope: expectedProfile.scope,
      authProfile: expectedProfile.authProfile,
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
  for (const profile of getMcpOAuthProfiles()) {
    allowed.add(new URL(getMcpOAuthProfileResourceUri(profile)).origin);
  }
  allowed.add(new URL(getMcpOAuthResourceUri()).origin);
  return allowed.has(origin);
}
