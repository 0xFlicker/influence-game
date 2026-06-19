import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { getPermissionsForAddress } from "../db/rbac.js";
import type { AuthUser } from "../middleware/auth.js";

export const MCP_OAUTH_SCOPE = "mcp";
export const MCP_OAUTH_AUDIENCE = "game-mcp";
export const MCP_OAUTH_PURPOSE = "mcp_access";
export const MCP_OAUTH_ISSUER = "influence-game-mcp";
export const MCP_OAUTH_CLIENT_ID =
  process.env.MCP_OAUTH_CLIENT_ID ?? "influence-game-mcp-local";
export const MCP_OAUTH_CODE_TTL_SECONDS = 5 * 60;
export const MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

const DEFAULT_LOOPBACK_REDIRECT_PATH = "/oauth/callback";

export interface McpOAuthAuthorizeInput {
  response_type?: unknown;
  client_id?: unknown;
  redirect_uri?: unknown;
  scope?: unknown;
  state?: unknown;
  code_challenge?: unknown;
  code_challenge_method?: unknown;
  decision?: unknown;
}

export interface McpOAuthTokenInput {
  grant_type?: unknown;
  code?: unknown;
  redirect_uri?: unknown;
  client_id?: unknown;
  code_verifier?: unknown;
}

export interface McpOAuthIntrospection {
  active: boolean;
  iss?: string;
  aud?: string;
  sub?: string;
  client_id?: string;
  scope?: string;
  token_type?: "Bearer";
  exp?: number;
  purpose?: string;
}

type OAuthDecision = "approve" | "deny" | "cancel" | "inspect";

interface ValidAuthorizeRequest {
  responseType: "code";
  clientId: string;
  redirectUri: string;
  scope: typeof MCP_OAUTH_SCOPE;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

interface ValidTokenRequest {
  grantType: "authorization_code";
  code: string;
  redirectUri: string;
  clientId: string;
  codeVerifier: string;
}

interface OAuthError extends Record<string, unknown> {
  error: string;
  error_description: string;
}

export interface McpOAuthAuditMetadata {
  userId?: string;
  walletAddress?: string;
  clientId?: string;
  scope?: string;
}

export type ServiceResponse<TBody> = {
  status: 200 | 400 | 401 | 403 | 503;
  body: TBody;
  audit?: McpOAuthAuditMetadata;
};

export function hashOpaqueSecret(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function generateOpaqueSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function pkceS256(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export function secretsEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}

export async function hasCurrentMcpRole(
  db: DrizzleDB,
  user: Pick<AuthUser, "walletAddress">,
): Promise<boolean> {
  if (!user.walletAddress) return false;
  const resolved = await getPermissionsForAddress(db, user.walletAddress);
  return resolved.roles.includes("mcp");
}

export async function authorizeMcpOAuth(
  db: DrizzleDB,
  user: AuthUser,
  input: McpOAuthAuthorizeInput,
  now = new Date(),
): Promise<ServiceResponse<Record<string, unknown>>> {
  const parsed = validateAuthorizeInput(input);
  if (!parsed.ok) {
    return oauthFailure(parsed.error, parsed.safeRedirectUri, parsed.state);
  }

  const decision = parseDecision(input.decision);
  if (decision === "deny") {
    return {
      status: 200,
      body: {
        redirectTo: buildOAuthRedirect(parsed.request.redirectUri, {
          error: "access_denied",
          error_description: "MCP access was denied",
          state: parsed.request.state,
        }),
      },
    };
  }

  if (decision === "cancel") {
    return {
      status: 200,
      body: {
        redirectTo: buildOAuthRedirect(parsed.request.redirectUri, {
          error: "access_denied",
          error_description: "MCP access was canceled",
          state: parsed.request.state,
        }),
      },
    };
  }

  const hasRole = await hasCurrentMcpRole(db, user);
  if (!hasRole) {
    return {
      status: 403,
      body: {
        error: "access_denied",
        error_description: "The current user does not have the mcp role",
        redirectTo: buildOAuthRedirect(parsed.request.redirectUri, {
          error: "access_denied",
          error_description: "MCP role required",
          state: parsed.request.state,
        }),
      },
    };
  }

  if (decision === "inspect") {
    return {
      status: 200,
      body: {
        clientId: parsed.request.clientId,
        redirectUri: parsed.request.redirectUri,
        scope: MCP_OAUTH_SCOPE,
        hasMcpRole: true,
        expiresIn: MCP_OAUTH_CODE_TTL_SECONDS,
        walletAddress: user.walletAddress,
      },
    };
  }

  const rawCode = generateOpaqueSecret();
  const expiresAt = new Date(
    now.getTime() + MCP_OAUTH_CODE_TTL_SECONDS * 1000,
  ).toISOString();

  await db.insert(schema.mcpOauthAuthorizationCodes).values({
    id: randomUUID(),
    codeHash: hashOpaqueSecret(rawCode),
    userId: user.id,
    walletAddress: user.walletAddress!,
    clientId: parsed.request.clientId,
    redirectUri: parsed.request.redirectUri,
    scope: MCP_OAUTH_SCOPE,
    codeChallenge: parsed.request.codeChallenge,
    codeChallengeMethod: parsed.request.codeChallengeMethod,
    expiresAt,
  });

  return {
    status: 200,
    body: {
      redirectTo: buildOAuthRedirect(parsed.request.redirectUri, {
        code: rawCode,
        state: parsed.request.state,
      }),
      expiresIn: MCP_OAUTH_CODE_TTL_SECONDS,
    },
  };
}

export async function exchangeMcpOAuthCode(
  db: DrizzleDB,
  input: McpOAuthTokenInput,
  now = new Date(),
): Promise<ServiceResponse<Record<string, unknown>>> {
  const parsed = validateTokenInput(input);
  if (!parsed.ok) {
    return {
      status: 400,
      body: parsed.error,
    };
  }

  const codeHash = hashOpaqueSecret(parsed.request.code);
  const codeRow = (await db
    .select()
    .from(schema.mcpOauthAuthorizationCodes)
    .where(eq(schema.mcpOauthAuthorizationCodes.codeHash, codeHash)))[0];

  if (!codeRow) {
    return invalidGrant("Authorization code is invalid");
  }
  if (codeRow.usedAt) {
    return invalidGrant("Authorization code has already been used");
  }
  if (new Date(codeRow.expiresAt).getTime() <= now.getTime()) {
    return invalidGrant("Authorization code has expired");
  }
  if (
    codeRow.clientId !== parsed.request.clientId ||
    codeRow.redirectUri !== parsed.request.redirectUri ||
    codeRow.scope !== MCP_OAUTH_SCOPE ||
    codeRow.codeChallengeMethod !== "S256"
  ) {
    return invalidGrant("Authorization code does not match this token request", {
      userId: codeRow.userId,
      walletAddress: codeRow.walletAddress,
      clientId: codeRow.clientId,
      scope: codeRow.scope,
    });
  }
  if (pkceS256(parsed.request.codeVerifier) !== codeRow.codeChallenge) {
    return invalidGrant("PKCE verification failed", {
      userId: codeRow.userId,
      walletAddress: codeRow.walletAddress,
      clientId: codeRow.clientId,
      scope: codeRow.scope,
    });
  }

  const user = (await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, codeRow.userId)))[0];
  if (!user || !(await hasCurrentMcpRole(db, user))) {
    return invalidGrant("MCP role is no longer active for this user", {
      userId: codeRow.userId,
      walletAddress: codeRow.walletAddress,
      clientId: codeRow.clientId,
      scope: codeRow.scope,
    });
  }

  const rawToken = generateOpaqueSecret();
  const expiresAt = new Date(
    now.getTime() + MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000,
  ).toISOString();
  const nowIso = now.toISOString();

  const issued = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.mcpOauthAuthorizationCodes)
      .set({ usedAt: nowIso })
      .where(and(
        eq(schema.mcpOauthAuthorizationCodes.codeHash, codeHash),
        isNull(schema.mcpOauthAuthorizationCodes.usedAt),
      ))
      .returning({ id: schema.mcpOauthAuthorizationCodes.id });

    if (updated.length === 0) {
      return false;
    }

    await tx.insert(schema.mcpOauthAccessTokens).values({
      id: randomUUID(),
      tokenHash: hashOpaqueSecret(rawToken),
      userId: user.id,
      walletAddress: user.walletAddress!,
      clientId: codeRow.clientId,
      scope: MCP_OAUTH_SCOPE,
      audience: MCP_OAUTH_AUDIENCE,
      purpose: MCP_OAUTH_PURPOSE,
      expiresAt,
    });

    return true;
  });

  if (!issued) {
    return invalidGrant("Authorization code has already been used");
  }

  return {
    status: 200,
    body: {
      access_token: rawToken,
      token_type: "Bearer",
      expires_in: MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      scope: MCP_OAUTH_SCOPE,
      audience: MCP_OAUTH_AUDIENCE,
      purpose: MCP_OAUTH_PURPOSE,
    },
    audit: {
      userId: user.id,
      walletAddress: user.walletAddress ?? undefined,
      clientId: codeRow.clientId,
      scope: MCP_OAUTH_SCOPE,
    },
  };
}

export async function introspectMcpAccessToken(
  db: DrizzleDB,
  token: string,
  now = new Date(),
): Promise<McpOAuthIntrospection> {
  const tokenHash = hashOpaqueSecret(token);
  const tokenRow = (await db
    .select()
    .from(schema.mcpOauthAccessTokens)
    .where(eq(schema.mcpOauthAccessTokens.tokenHash, tokenHash)))[0];

  if (!tokenRow || tokenRow.revokedAt) {
    return { active: false };
  }
  if (new Date(tokenRow.expiresAt).getTime() <= now.getTime()) {
    return { active: false };
  }

  const user = (await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, tokenRow.userId)))[0];
  if (!user || !(await hasCurrentMcpRole(db, user))) {
    return { active: false };
  }

  await db
    .update(schema.mcpOauthAccessTokens)
    .set({ lastUsedAt: now.toISOString() })
    .where(eq(schema.mcpOauthAccessTokens.id, tokenRow.id));

  return {
    active: true,
    iss: MCP_OAUTH_ISSUER,
    aud: tokenRow.audience,
    sub: tokenRow.userId,
    client_id: tokenRow.clientId,
    scope: tokenRow.scope,
    token_type: "Bearer",
    exp: Math.floor(new Date(tokenRow.expiresAt).getTime() / 1000),
    purpose: tokenRow.purpose,
  };
}

export function buildOAuthRedirect(
  redirectUri: string,
  params: Record<string, string>,
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function validateAuthorizeInput(input: McpOAuthAuthorizeInput):
  | { ok: true; request: ValidAuthorizeRequest }
  | { ok: false; error: OAuthError; safeRedirectUri?: string; state?: string } {
  const redirectUri = requiredString(input.redirect_uri);
  const state = requiredString(input.state);

  const safeRedirectUri = redirectUri && isAllowedRedirectUri(redirectUri)
    ? redirectUri
    : undefined;

  if (requiredString(input.response_type) !== "code") {
    return validationError(
      "unsupported_response_type",
      "response_type must be code",
      safeRedirectUri,
      state ?? undefined,
    );
  }
  if (requiredString(input.client_id) !== MCP_OAUTH_CLIENT_ID) {
    return validationError(
      "invalid_client",
      "client_id is not allowed",
      safeRedirectUri,
      state ?? undefined,
    );
  }
  if (!redirectUri || !isAllowedRedirectUri(redirectUri)) {
    return validationError(
      "invalid_request",
      "redirect_uri is not allowed",
      undefined,
      state ?? undefined,
    );
  }
  if (!scopeIncludesOnlyMcp(input.scope)) {
    return validationError(
      "invalid_scope",
      "scope must be exactly mcp",
      redirectUri,
      state ?? undefined,
    );
  }
  if (!state) {
    return validationError(
      "invalid_request",
      "state is required",
      redirectUri,
      undefined,
    );
  }
  const codeChallenge = requiredString(input.code_challenge);
  if (!codeChallenge) {
    return validationError(
      "invalid_request",
      "code_challenge is required",
      redirectUri,
      state,
    );
  }
  if (requiredString(input.code_challenge_method) !== "S256") {
    return validationError(
      "invalid_request",
      "code_challenge_method must be S256",
      redirectUri,
      state,
    );
  }

  return {
    ok: true,
    request: {
      responseType: "code",
      clientId: MCP_OAUTH_CLIENT_ID,
      redirectUri,
      scope: MCP_OAUTH_SCOPE,
      state,
      codeChallenge,
      codeChallengeMethod: "S256",
    },
  };
}

function validateTokenInput(input: McpOAuthTokenInput):
  | { ok: true; request: ValidTokenRequest }
  | { ok: false; error: OAuthError } {
  if (requiredString(input.grant_type) !== "authorization_code") {
    return {
      ok: false,
      error: {
        error: "unsupported_grant_type",
        error_description: "grant_type must be authorization_code",
      },
    };
  }

  const clientId = requiredString(input.client_id);
  if (clientId !== MCP_OAUTH_CLIENT_ID) {
    return {
      ok: false,
      error: {
        error: "invalid_client",
        error_description: "client_id is not allowed",
      },
    };
  }

  const redirectUri = requiredString(input.redirect_uri);
  if (!redirectUri || !isAllowedRedirectUri(redirectUri)) {
    return {
      ok: false,
      error: {
        error: "invalid_request",
        error_description: "redirect_uri is not allowed",
      },
    };
  }

  const code = requiredString(input.code);
  const codeVerifier = requiredString(input.code_verifier);
  if (!code || !codeVerifier) {
    return {
      ok: false,
      error: {
        error: "invalid_request",
        error_description: "code and code_verifier are required",
      },
    };
  }

  return {
    ok: true,
    request: {
      grantType: "authorization_code",
      code,
      redirectUri,
      clientId,
      codeVerifier,
    },
  };
}

function oauthFailure(
  error: OAuthError,
  safeRedirectUri?: string,
  state?: string,
): ServiceResponse<Record<string, unknown>> {
  if (safeRedirectUri) {
    return {
      status: 400,
      body: {
        ...error,
        redirectTo: buildOAuthRedirect(safeRedirectUri, {
          error: error.error,
          error_description: error.error_description,
          ...(state ? { state } : {}),
        }),
      },
    };
  }
  return { status: 400, body: error };
}

function invalidGrant(
  errorDescription: string,
  audit?: McpOAuthAuditMetadata,
): ServiceResponse<Record<string, unknown>> {
  return {
    status: 400,
    body: {
      error: "invalid_grant",
      error_description: errorDescription,
    },
    audit,
  };
}

function validationError(
  error: string,
  errorDescription: string,
  safeRedirectUri?: string,
  state?: string,
): { ok: false; error: OAuthError; safeRedirectUri?: string; state?: string } {
  return {
    ok: false,
    error: { error, error_description: errorDescription },
    safeRedirectUri,
    state,
  };
}

function parseDecision(value: unknown): OAuthDecision {
  if (value === "approve" || value === "deny" || value === "cancel") return value;
  return "inspect";
}

function requiredString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function scopeIncludesOnlyMcp(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const scopes = value.split(/\s+/).filter(Boolean);
  return scopes.length === 1 && scopes[0] === MCP_OAUTH_SCOPE;
}

function isAllowedRedirectUri(redirectUri: string): boolean {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }

  const configured = (process.env.MCP_OAUTH_ALLOWED_REDIRECT_URIS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.includes(redirectUri)) {
    return url.protocol === "https:";
  }

  const isLoopbackHost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]";
  const isLoopbackProtocol = url.protocol === "http:" || url.protocol === "https:";
  const expectedPath =
    process.env.MCP_OAUTH_LOOPBACK_REDIRECT_PATH ?? DEFAULT_LOOPBACK_REDIRECT_PATH;

  return isLoopbackHost && isLoopbackProtocol && url.pathname === expectedPath;
}
