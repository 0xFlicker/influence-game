import type { DrizzleDB } from "../db/index.js";
import {
  getMcpOAuthResourceUri,
  introspectMcpAccessToken,
  isCanonicalMcpResourceUri,
  MCP_OAUTH_AUDIENCE,
  MCP_OAUTH_PROTECTED_RESOURCE_METADATA_PATH,
  MCP_OAUTH_PURPOSE,
  type McpAuthProfile,
} from "../services/mcp-oauth.js";
import {
  mcpOAuthScopeSetHasProducer,
  mcpOAuthScopesToArray,
  normalizeMcpOAuthScopeSet,
  parseAndValidateMcpOAuthScopes,
  type McpOAuthScope,
} from "../services/mcp-scope-policy.js";

export interface GameMcpAuthContext {
  userId: string;
  clientId: string;
  resource: string;
  scope: string;
  scopes: McpOAuthScope[];
  authProfile: McpAuthProfile;
  expiresAt: number;
}

export type GameMcpAuthResult =
  | { ok: true; context: GameMcpAuthContext }
  | { ok: false; status: 401 | 403; reason: string };

export const GAME_MCP_STEP_UP_DESCRIPTION =
  "Additional authorization is required to use this tool.";

export interface BearerChallengeOptions {
  scopes?: readonly McpOAuthScope[];
  error?: "insufficient_scope";
  errorDescription?: string;
}

export function bearerChallenge(options: BearerChallengeOptions = {}): string {
  const metadataUrl = new URL(
    MCP_OAUTH_PROTECTED_RESOURCE_METADATA_PATH,
    getMcpOAuthResourceUri(),
  ).toString();
  const scopes = options.scopes ?? ["agents:read", "games:read"];
  const parameters = [
    'Bearer realm="influence-game-mcp"',
    `resource_metadata=${quoteBearerChallengeValue(metadataUrl)}`,
    `scope=${quoteBearerChallengeValue(normalizeMcpOAuthScopeSet(scopes))}`,
  ];
  if (options.error) {
    parameters.push(`error=${quoteBearerChallengeValue(options.error)}`);
  }
  if (options.errorDescription) {
    parameters.push(
      `error_description=${quoteBearerChallengeValue(options.errorDescription)}`,
    );
  }
  return parameters.join(", ");
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

  const parsedScopes = parseAndValidateMcpOAuthScopes(introspection.scope);
  if (!parsedScopes.ok) {
    return { ok: false, status: 401, reason: "invalid_token_claims" };
  }

  if (
    introspection.aud !== MCP_OAUTH_AUDIENCE ||
    introspection.purpose !== MCP_OAUTH_PURPOSE ||
    !introspection.resource ||
    !isCanonicalMcpResourceUri(introspection.resource) ||
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
      scope: parsedScopes.scope,
      scopes: mcpOAuthScopesToArray(parsedScopes.scopes),
      authProfile: mcpOAuthScopeSetHasProducer(parsedScopes.scopes) ? "producer" : "subject",
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

function quoteBearerChallengeValue(value: string): string {
  const safe = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  return `"${safe}"`;
}
