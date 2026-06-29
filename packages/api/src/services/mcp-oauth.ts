import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { getPermissionsForAddress } from "../db/rbac.js";
import type { AuthUser } from "../middleware/auth.js";

export const MCP_OAUTH_SCOPE = "mcp";
export const MCP_OAUTH_GAMES_SCOPE = "games";
export const MCP_OAUTH_AUDIENCE = "game-mcp";
export const MCP_OAUTH_PURPOSE = "mcp_access";
export const MCP_OAUTH_ISSUER = "influence-game-mcp";
export const DEFAULT_MCP_OAUTH_GAMES_RESOURCE_URI = "http://127.0.0.1:3000/mcp";
export const DEFAULT_MCP_OAUTH_PRODUCER_RESOURCE_URI = "http://127.0.0.1:3000/mcp/producer";
export const MCP_OAUTH_CLIENT_ID =
  process.env.MCP_OAUTH_CLIENT_ID ?? "influence-game-mcp-local";
export const MCP_OAUTH_DYNAMIC_CLIENT_ID_PREFIX = "influence-game-mcp-client-";
export const MCP_OAUTH_CODE_TTL_SECONDS = 5 * 60;
export const MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

const DEFAULT_LOOPBACK_REDIRECT_PATH = "/oauth/callback";

export type McpOAuthScope = typeof MCP_OAUTH_GAMES_SCOPE | typeof MCP_OAUTH_SCOPE;
export type McpOAuthProfileName = "games" | "producer";
export type McpAuthProfile = "games_subject" | "producer_mcp";

export interface McpOAuthResourceProfile {
  name: McpOAuthProfileName;
  authProfile: McpAuthProfile;
  scope: McpOAuthScope;
  resourcePath: string;
  protectedResourceMetadataPath: string;
  resourceName: string;
  requiresMcpRole: boolean;
  defaultResourceUri: string;
  envVar: string;
}

const MCP_OAUTH_RESOURCE_PROFILES: Record<McpOAuthProfileName, McpOAuthResourceProfile> = {
  games: {
    name: "games",
    authProfile: "games_subject",
    scope: MCP_OAUTH_GAMES_SCOPE,
    resourcePath: "/mcp",
    protectedResourceMetadataPath: "/.well-known/oauth-protected-resource/mcp",
    resourceName: "Influence Games MCP",
    requiresMcpRole: false,
    defaultResourceUri: DEFAULT_MCP_OAUTH_GAMES_RESOURCE_URI,
    envVar: "MCP_OAUTH_GAMES_RESOURCE_URI",
  },
  producer: {
    name: "producer",
    authProfile: "producer_mcp",
    scope: MCP_OAUTH_SCOPE,
    resourcePath: "/mcp/producer",
    protectedResourceMetadataPath: "/.well-known/oauth-protected-resource/mcp/producer",
    resourceName: "Influence Producer MCP",
    requiresMcpRole: true,
    defaultResourceUri: DEFAULT_MCP_OAUTH_PRODUCER_RESOURCE_URI,
    envVar: "MCP_OAUTH_PRODUCER_RESOURCE_URI",
  },
};

export interface McpOAuthAuthorizeInput {
  response_type?: unknown;
  client_id?: unknown;
  redirect_uri?: unknown;
  resource?: unknown;
  scope?: unknown;
  state?: unknown;
  code_challenge?: unknown;
  code_challenge_method?: unknown;
  decision?: unknown;
}

export interface McpOAuthTokenInput {
  grant_type?: unknown;
  code?: unknown;
  refresh_token?: unknown;
  redirect_uri?: unknown;
  resource?: unknown;
  scope?: unknown;
  client_id?: unknown;
  code_verifier?: unknown;
}

export interface McpOAuthRevocationInput {
  token?: unknown;
  token_type_hint?: unknown;
  client_id?: unknown;
}

export interface McpOAuthClientRegistrationInput {
  redirect_uris?: unknown;
  client_name?: unknown;
  client_uri?: unknown;
  logo_uri?: unknown;
  tos_uri?: unknown;
  policy_uri?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
  scope?: unknown;
  token_endpoint_auth_method?: unknown;
}

export interface McpOAuthIntrospection {
  active: boolean;
  iss?: string;
  aud?: string;
  sub?: string;
  client_id?: string;
  resource?: string;
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
  resourceUri: string;
  scope: McpOAuthScope;
  profile: McpOAuthResourceProfile;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

interface ValidAuthorizationCodeTokenRequest {
  grantType: "authorization_code";
  code: string;
  redirectUri: string;
  resourceUri: string;
  profile: McpOAuthResourceProfile;
  clientId: string;
  codeVerifier: string;
}

interface ValidRefreshTokenRequest {
  grantType: "refresh_token";
  refreshToken: string;
  clientId: string;
  resourceUri?: string;
  scope?: McpOAuthScope;
}

type ValidTokenRequest = ValidAuthorizationCodeTokenRequest | ValidRefreshTokenRequest;

interface OAuthError extends Record<string, unknown> {
  error: string;
  error_description: string;
}

export interface McpOAuthAuditMetadata {
  userId?: string;
  walletAddress?: string;
  clientId?: string;
  resource?: string;
  scope?: string;
  authProfile?: McpAuthProfile;
  grantType?: "authorization_code" | "refresh_token";
}

export type ServiceResponse<TBody> = {
  status: 200 | 201 | 400 | 401 | 403 | 503;
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

export function getMcpOAuthProfiles(): McpOAuthResourceProfile[] {
  return [MCP_OAUTH_RESOURCE_PROFILES.games, MCP_OAUTH_RESOURCE_PROFILES.producer];
}

export function getMcpOAuthProfile(name: McpOAuthProfileName): McpOAuthResourceProfile {
  return MCP_OAUTH_RESOURCE_PROFILES[name];
}

export function getMcpOAuthResourceUri(profileName: McpOAuthProfileName = "games"): string {
  const profile = getMcpOAuthProfile(profileName);
  const configured = requiredString(process.env[profile.envVar]);
  return normalizeResourceUri(configured ?? profile.defaultResourceUri) ??
    profile.defaultResourceUri;
}

export function getMcpOAuthProducerResourceUri(): string {
  return getMcpOAuthResourceUri("producer");
}

export function getMcpOAuthProfileResourceUri(profile: McpOAuthResourceProfile): string {
  return getMcpOAuthResourceUri(profile.name);
}

export function isCanonicalMcpResourceUri(
  resourceUri: string,
  profileName?: McpOAuthProfileName,
): boolean {
  const normalized = normalizeResourceUri(resourceUri);
  if (!normalized) return false;
  if (profileName) return normalized === getMcpOAuthResourceUri(profileName);
  return getMcpOAuthProfiles().some((profile) =>
    normalized === getMcpOAuthProfileResourceUri(profile)
  );
}

export function profileForMcpResourceUri(
  resourceUri: string,
): McpOAuthResourceProfile | null {
  const normalized = normalizeResourceUri(resourceUri);
  if (!normalized) return null;
  return getMcpOAuthProfiles().find((profile) =>
    normalized === getMcpOAuthProfileResourceUri(profile)
  ) ?? null;
}

export function profileForMcpScope(scope: string): McpOAuthResourceProfile | null {
  return getMcpOAuthProfiles().find((profile) => profile.scope === scope) ?? null;
}

export function getMcpOAuthAuthorizationEndpoint(): string {
  const webBase = requiredString(process.env.WEB_BASE_URL);

  if (!webBase) {
    throw new Error("WEB_BASE_URL is not configured");
  }
  return new URL("/oauth/mcp/authorize", webBase).toString();
}

export function getMcpOAuthTokenEndpoint(): string {
  return new URL("/api/oauth/mcp/token", getMcpOAuthPublicApiOrigin()).toString();
}

export function getMcpOAuthRegistrationEndpoint(): string {
  return new URL("/api/oauth/mcp/register", getMcpOAuthPublicApiOrigin()).toString();
}

export function getMcpOAuthRevocationEndpoint(): string {
  return new URL("/api/oauth/mcp/revoke", getMcpOAuthPublicApiOrigin()).toString();
}

export function getMcpOAuthAuthorizationServerIssuer(): string {
  return getMcpOAuthPublicApiOrigin();
}

function getMcpOAuthPublicApiOrigin(): string {
  return new URL(getMcpOAuthResourceUri("games")).origin;
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

  const clientValidation = await validateMcpOAuthClientRedirect(
    db,
    parsed.request.clientId,
    parsed.request.redirectUri,
    parsed.request.scope,
  );
  if (!clientValidation.ok) {
    return oauthFailure({
      error: clientValidation.error,
      error_description: clientValidation.errorDescription,
    });
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
  if (parsed.request.profile.requiresMcpRole && !hasRole) {
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
        resource: parsed.request.resourceUri,
        scope: parsed.request.scope,
        authProfile: parsed.request.profile.authProfile,
        hasMcpRole: hasRole,
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
    walletAddress: user.walletAddress,
    clientId: parsed.request.clientId,
    redirectUri: parsed.request.redirectUri,
    resourceUri: parsed.request.resourceUri,
    scope: parsed.request.scope,
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

export async function registerMcpOAuthClient(
  db: DrizzleDB,
  input: McpOAuthClientRegistrationInput,
  now = new Date(),
): Promise<ServiceResponse<Record<string, unknown>>> {
  const parsed = validateClientRegistrationInput(input);
  if (!parsed.ok) {
    return {
      status: 400,
      body: {
        error: parsed.error,
        error_description: parsed.errorDescription,
      },
    };
  }

  const clientId = `${MCP_OAUTH_DYNAMIC_CLIENT_ID_PREFIX}${randomUUID()}`;
  const createdAt = now.toISOString();
  await db.insert(schema.mcpOauthClients).values({
    clientId,
    clientName: parsed.registration.clientName,
    redirectUris: parsed.registration.redirectUris,
    grantTypes: parsed.registration.grantTypes,
    responseTypes: parsed.registration.responseTypes,
    scope: parsed.registration.scope,
    tokenEndpointAuthMethod: "none",
    clientUri: parsed.registration.clientUri,
    logoUri: parsed.registration.logoUri,
    tosUri: parsed.registration.tosUri,
    policyUri: parsed.registration.policyUri,
    createdAt,
  });

  return {
    status: 201,
    body: {
      client_id: clientId,
      client_id_issued_at: Math.floor(now.getTime() / 1000),
      client_name: parsed.registration.clientName,
      redirect_uris: parsed.registration.redirectUris,
      grant_types: parsed.registration.grantTypes,
      response_types: parsed.registration.responseTypes,
      scope: parsed.registration.scope,
      token_endpoint_auth_method: "none",
      ...(parsed.registration.clientUri ? { client_uri: parsed.registration.clientUri } : {}),
      ...(parsed.registration.logoUri ? { logo_uri: parsed.registration.logoUri } : {}),
      ...(parsed.registration.tosUri ? { tos_uri: parsed.registration.tosUri } : {}),
      ...(parsed.registration.policyUri ? { policy_uri: parsed.registration.policyUri } : {}),
    },
    audit: {
      clientId,
      scope: parsed.registration.scope,
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
  if (parsed.request.grantType === "refresh_token") {
    return refreshMcpOAuthAccessToken(db, parsed.request, now);
  }
  const codeRequest = parsed.request;

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
    codeRow.resourceUri !== parsed.request.resourceUri ||
    codeRow.scope !== parsed.request.profile.scope ||
    codeRow.codeChallengeMethod !== "S256"
  ) {
    return invalidGrant("Authorization code does not match this token request", {
      userId: codeRow.userId,
      walletAddress: codeRow.walletAddress ?? undefined,
      clientId: codeRow.clientId,
      resource: codeRow.resourceUri,
      scope: codeRow.scope,
      authProfile: parsed.request.profile.authProfile,
    });
  }
  if (pkceS256(parsed.request.codeVerifier) !== codeRow.codeChallenge) {
    return invalidGrant("PKCE verification failed", {
      userId: codeRow.userId,
      walletAddress: codeRow.walletAddress ?? undefined,
      clientId: codeRow.clientId,
      resource: codeRow.resourceUri,
      scope: codeRow.scope,
      authProfile: parsed.request.profile.authProfile,
    });
  }

  const user = (await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, codeRow.userId)))[0];
  if (!user) {
    return invalidGrant("Authorization subject is no longer active", {
      userId: codeRow.userId,
      walletAddress: codeRow.walletAddress ?? undefined,
      clientId: codeRow.clientId,
      resource: codeRow.resourceUri,
      scope: codeRow.scope,
      authProfile: parsed.request.profile.authProfile,
    });
  }
  if (parsed.request.profile.requiresMcpRole && !(await hasCurrentMcpRole(db, user))) {
    return invalidGrant("MCP role is no longer active for this user", {
      userId: codeRow.userId,
      walletAddress: codeRow.walletAddress ?? undefined,
      clientId: codeRow.clientId,
      resource: codeRow.resourceUri,
      scope: codeRow.scope,
      authProfile: parsed.request.profile.authProfile,
    });
  }

  const shouldIssueRefreshToken =
    codeRequest.profile.scope === MCP_OAUTH_GAMES_SCOPE &&
    await clientAllowsMcpRefreshTokens(db, codeRow.clientId);
  const rawToken = generateOpaqueSecret();
  const rawRefreshToken = shouldIssueRefreshToken ? generateOpaqueSecret() : undefined;
  const refreshTokenId = rawRefreshToken ? randomUUID() : undefined;
  const refreshTokenFamilyId = rawRefreshToken ? randomUUID() : undefined;
  const expiresAt = new Date(
    now.getTime() + MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000,
  ).toISOString();
  const refreshExpiresAt = new Date(
    now.getTime() + MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000,
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

    if (rawRefreshToken && refreshTokenId && refreshTokenFamilyId) {
      await tx.insert(schema.mcpOauthRefreshTokens).values({
        id: refreshTokenId,
        tokenHash: hashOpaqueSecret(rawRefreshToken),
        tokenFamilyId: refreshTokenFamilyId,
        userId: user.id,
        walletAddress: user.walletAddress,
        clientId: codeRow.clientId,
        resourceUri: codeRow.resourceUri,
        scope: codeRequest.profile.scope,
        audience: MCP_OAUTH_AUDIENCE,
        purpose: MCP_OAUTH_PURPOSE,
        expiresAt: refreshExpiresAt,
        createdAt: nowIso,
      });
    }

    await tx.insert(schema.mcpOauthAccessTokens).values({
      id: randomUUID(),
      tokenHash: hashOpaqueSecret(rawToken),
      userId: user.id,
      walletAddress: user.walletAddress,
      clientId: codeRow.clientId,
      resourceUri: codeRow.resourceUri,
      scope: codeRequest.profile.scope,
      audience: MCP_OAUTH_AUDIENCE,
      purpose: MCP_OAUTH_PURPOSE,
      refreshTokenId,
      refreshTokenFamilyId,
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
      scope: codeRequest.profile.scope,
      audience: MCP_OAUTH_AUDIENCE,
      purpose: MCP_OAUTH_PURPOSE,
      resource: codeRow.resourceUri,
      ...(rawRefreshToken ? { refresh_token: rawRefreshToken } : {}),
    },
    audit: {
      userId: user.id,
      walletAddress: user.walletAddress ?? undefined,
      clientId: codeRow.clientId,
      resource: codeRow.resourceUri,
      scope: codeRequest.profile.scope,
      authProfile: codeRequest.profile.authProfile,
      grantType: "authorization_code",
    },
  };
}

async function refreshMcpOAuthAccessToken(
  db: DrizzleDB,
  request: ValidRefreshTokenRequest,
  now: Date,
): Promise<ServiceResponse<Record<string, unknown>>> {
  const tokenHash = hashOpaqueSecret(request.refreshToken);
  const tokenRow = (await db
    .select()
    .from(schema.mcpOauthRefreshTokens)
    .where(eq(schema.mcpOauthRefreshTokens.tokenHash, tokenHash)))[0];

  if (!tokenRow) {
    return invalidGrant("Refresh token is invalid", { grantType: "refresh_token" });
  }

  const profile = profileForMcpScope(tokenRow.scope);
  const audit: McpOAuthAuditMetadata = {
    userId: tokenRow.userId,
    walletAddress: tokenRow.walletAddress ?? undefined,
    clientId: tokenRow.clientId,
    resource: tokenRow.resourceUri,
    scope: tokenRow.scope,
    authProfile: profile?.authProfile,
    grantType: "refresh_token",
  };

  if (
    tokenRow.clientId !== request.clientId ||
    (request.resourceUri && tokenRow.resourceUri !== request.resourceUri) ||
    (request.scope && tokenRow.scope !== request.scope)
  ) {
    return invalidGrant("Refresh token does not match this token request", audit);
  }

  if (!profile || profile.scope !== MCP_OAUTH_GAMES_SCOPE) {
    return invalidGrant("Refresh token is not valid for games access", audit);
  }
  if (tokenRow.revokedAt) {
    return invalidGrant("Refresh token has been revoked", audit);
  }
  if (tokenRow.replacedAt) {
    await markMcpRefreshTokenReuse(db, tokenRow.id, tokenRow.tokenFamilyId, now);
    return invalidGrant("Refresh token has already been used", audit);
  }
  if (new Date(tokenRow.expiresAt).getTime() <= now.getTime()) {
    return invalidGrant("Refresh token has expired", audit);
  }

  const user = (await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, tokenRow.userId)))[0];
  if (!user) {
    return invalidGrant("Authorization subject is no longer active", audit);
  }

  const rawAccessToken = generateOpaqueSecret();
  const rawRefreshToken = generateOpaqueSecret();
  const refreshTokenId = randomUUID();
  const nowIso = now.toISOString();
  const accessExpiresAt = new Date(
    now.getTime() + MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000,
  ).toISOString();
  const refreshExpiresAt = new Date(
    now.getTime() + MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000,
  ).toISOString();

  const rotated = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.mcpOauthRefreshTokens)
      .set({ replacedAt: nowIso, lastUsedAt: nowIso })
      .where(and(
        eq(schema.mcpOauthRefreshTokens.id, tokenRow.id),
        isNull(schema.mcpOauthRefreshTokens.replacedAt),
        isNull(schema.mcpOauthRefreshTokens.revokedAt),
      ))
      .returning({ id: schema.mcpOauthRefreshTokens.id });

    if (updated.length === 0) {
      await tx
        .update(schema.mcpOauthRefreshTokens)
        .set({ reusedAt: nowIso, revokedAt: nowIso })
        .where(eq(schema.mcpOauthRefreshTokens.id, tokenRow.id));
      await tx
        .update(schema.mcpOauthRefreshTokens)
        .set({ revokedAt: nowIso })
        .where(and(
          eq(schema.mcpOauthRefreshTokens.tokenFamilyId, tokenRow.tokenFamilyId),
          isNull(schema.mcpOauthRefreshTokens.revokedAt),
        ));
      await tx
        .update(schema.mcpOauthAccessTokens)
        .set({ revokedAt: nowIso })
        .where(and(
          eq(schema.mcpOauthAccessTokens.refreshTokenFamilyId, tokenRow.tokenFamilyId),
          isNull(schema.mcpOauthAccessTokens.revokedAt),
        ));
      return false;
    }

    await tx.insert(schema.mcpOauthRefreshTokens).values({
      id: refreshTokenId,
      tokenHash: hashOpaqueSecret(rawRefreshToken),
      tokenFamilyId: tokenRow.tokenFamilyId,
      userId: user.id,
      walletAddress: user.walletAddress,
      clientId: tokenRow.clientId,
      resourceUri: tokenRow.resourceUri,
      scope: MCP_OAUTH_GAMES_SCOPE,
      audience: MCP_OAUTH_AUDIENCE,
      purpose: MCP_OAUTH_PURPOSE,
      expiresAt: refreshExpiresAt,
      createdAt: nowIso,
    });

    await tx.insert(schema.mcpOauthAccessTokens).values({
      id: randomUUID(),
      tokenHash: hashOpaqueSecret(rawAccessToken),
      userId: user.id,
      walletAddress: user.walletAddress,
      clientId: tokenRow.clientId,
      resourceUri: tokenRow.resourceUri,
      scope: MCP_OAUTH_GAMES_SCOPE,
      audience: MCP_OAUTH_AUDIENCE,
      purpose: MCP_OAUTH_PURPOSE,
      refreshTokenId,
      refreshTokenFamilyId: tokenRow.tokenFamilyId,
      expiresAt: accessExpiresAt,
    });

    return true;
  });

  if (!rotated) {
    return invalidGrant("Refresh token has already been used", audit);
  }

  return {
    status: 200,
    body: {
      access_token: rawAccessToken,
      refresh_token: rawRefreshToken,
      token_type: "Bearer",
      expires_in: MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      scope: MCP_OAUTH_GAMES_SCOPE,
      audience: MCP_OAUTH_AUDIENCE,
      purpose: MCP_OAUTH_PURPOSE,
      resource: tokenRow.resourceUri,
    },
    audit,
  };
}

export async function revokeMcpOAuthToken(
  db: DrizzleDB,
  input: McpOAuthRevocationInput,
  now = new Date(),
): Promise<ServiceResponse<Record<string, unknown>>> {
  const token = requiredString(input.token);
  if (!token) {
    return {
      status: 400,
      body: {
        error: "invalid_request",
        error_description: "token is required",
      },
    };
  }

  const tokenHash = hashOpaqueSecret(token);
  const nowIso = now.toISOString();
  const refreshToken = (await db
    .select()
    .from(schema.mcpOauthRefreshTokens)
    .where(eq(schema.mcpOauthRefreshTokens.tokenHash, tokenHash)))[0];

  if (refreshToken) {
    await revokeMcpRefreshTokenFamily(db, refreshToken.tokenFamilyId, nowIso);
    const profile = profileForMcpScope(refreshToken.scope);
    return {
      status: 200,
      body: {},
      audit: {
        userId: refreshToken.userId,
        walletAddress: refreshToken.walletAddress ?? undefined,
        clientId: refreshToken.clientId,
        resource: refreshToken.resourceUri,
        scope: refreshToken.scope,
        authProfile: profile?.authProfile,
      },
    };
  }

  const accessToken = (await db
    .select()
    .from(schema.mcpOauthAccessTokens)
    .where(eq(schema.mcpOauthAccessTokens.tokenHash, tokenHash)))[0];
  if (accessToken) {
    await db
      .update(schema.mcpOauthAccessTokens)
      .set({ revokedAt: nowIso })
      .where(eq(schema.mcpOauthAccessTokens.id, accessToken.id));
    const profile = profileForMcpScope(accessToken.scope);
    return {
      status: 200,
      body: {},
      audit: {
        userId: accessToken.userId,
        walletAddress: accessToken.walletAddress ?? undefined,
        clientId: accessToken.clientId,
        resource: accessToken.resourceUri,
        scope: accessToken.scope,
        authProfile: profile?.authProfile,
      },
    };
  }

  return {
    status: 200,
    body: {},
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
  const profile = profileForMcpResourceUri(tokenRow.resourceUri);
  if (!profile || tokenRow.scope !== profile.scope) {
    return { active: false };
  }
  if (new Date(tokenRow.expiresAt).getTime() <= now.getTime()) {
    return { active: false };
  }

  const user = (await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, tokenRow.userId)))[0];
  if (!user) {
    return { active: false };
  }
  if (profile.requiresMcpRole && !(await hasCurrentMcpRole(db, user))) {
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
    resource: tokenRow.resourceUri,
    scope: tokenRow.scope,
    token_type: "Bearer",
    exp: Math.floor(new Date(tokenRow.expiresAt).getTime() / 1000),
    purpose: tokenRow.purpose,
  };
}

async function clientAllowsMcpRefreshTokens(
  db: DrizzleDB,
  clientId: string,
): Promise<boolean> {
  if (clientId === MCP_OAUTH_CLIENT_ID) {
    return true;
  }

  const client = (await db
    .select({ grantTypes: schema.mcpOauthClients.grantTypes })
    .from(schema.mcpOauthClients)
    .where(eq(schema.mcpOauthClients.clientId, clientId)))[0];
  return client?.grantTypes.includes("refresh_token") ?? false;
}

async function markMcpRefreshTokenReuse(
  db: DrizzleDB,
  refreshTokenId: string,
  tokenFamilyId: string,
  now: Date,
): Promise<void> {
  const nowIso = now.toISOString();
  await db
    .update(schema.mcpOauthRefreshTokens)
    .set({ reusedAt: nowIso, revokedAt: nowIso })
    .where(eq(schema.mcpOauthRefreshTokens.id, refreshTokenId));
  await revokeMcpRefreshTokenFamily(db, tokenFamilyId, nowIso);
}

async function revokeMcpRefreshTokenFamily(
  db: DrizzleDB,
  tokenFamilyId: string,
  nowIso: string,
): Promise<void> {
  await db
    .update(schema.mcpOauthRefreshTokens)
    .set({ revokedAt: nowIso })
    .where(and(
      eq(schema.mcpOauthRefreshTokens.tokenFamilyId, tokenFamilyId),
      isNull(schema.mcpOauthRefreshTokens.revokedAt),
    ));
  await db
    .update(schema.mcpOauthAccessTokens)
    .set({ revokedAt: nowIso })
    .where(and(
      eq(schema.mcpOauthAccessTokens.refreshTokenFamilyId, tokenFamilyId),
      isNull(schema.mcpOauthAccessTokens.revokedAt),
    ));
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
  const clientId = requiredString(input.client_id);
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
  if (!clientId) {
    return validationError(
      "invalid_client",
      "client_id is required",
      safeRedirectUri,
      state ?? undefined,
    );
  }
  if (!redirectUri || !isValidRedirectUriSyntax(redirectUri)) {
    return validationError(
      "invalid_request",
      "redirect_uri must be an absolute http(s) URI without a fragment",
      undefined,
      state ?? undefined,
    );
  }
  const requestedScopes = parseMcpOAuthScopeSet(input.scope);
  if (!requestedScopes) {
    return validationError(
      "invalid_scope",
      "scope must include only games and/or mcp",
      safeRedirectUri,
      state ?? undefined,
    );
  }
  const resourceUri = requiredString(input.resource);
  const resourceProfile = resourceUri ? profileForMcpResourceUri(resourceUri) : null;
  if (!resourceUri || !resourceProfile || !requestedScopes.has(resourceProfile.scope)) {
    return validationError(
      "invalid_target",
      "resource must match the requested MCP scope",
      safeRedirectUri,
      state ?? undefined,
    );
  }
  if (!state) {
    return validationError(
      "invalid_request",
      "state is required",
      safeRedirectUri,
      undefined,
    );
  }
  const codeChallenge = requiredString(input.code_challenge);
  if (!codeChallenge) {
    return validationError(
      "invalid_request",
      "code_challenge is required",
      safeRedirectUri,
      state,
    );
  }
  if (requiredString(input.code_challenge_method) !== "S256") {
    return validationError(
      "invalid_request",
      "code_challenge_method must be S256",
      safeRedirectUri,
      state,
    );
  }

  return {
    ok: true,
    request: {
      responseType: "code",
      clientId,
      redirectUri,
      resourceUri: getMcpOAuthProfileResourceUri(resourceProfile),
      scope: resourceProfile.scope,
      profile: resourceProfile,
      state,
      codeChallenge,
      codeChallengeMethod: "S256",
    },
  };
}

function validateTokenInput(input: McpOAuthTokenInput):
  | { ok: true; request: ValidTokenRequest }
  | { ok: false; error: OAuthError } {
  const grantType = requiredString(input.grant_type);
  if (grantType !== "authorization_code" && grantType !== "refresh_token") {
    return {
      ok: false,
      error: {
        error: "unsupported_grant_type",
        error_description: "grant_type must be authorization_code or refresh_token",
      },
    };
  }

  const clientId = requiredString(input.client_id);
  if (!clientId) {
    return {
      ok: false,
      error: {
        error: "invalid_client",
        error_description: "client_id is required",
      },
    };
  }

  if (grantType === "refresh_token") {
    const refreshToken = requiredString(input.refresh_token);
    if (!refreshToken) {
      return {
        ok: false,
        error: {
          error: "invalid_request",
          error_description: "refresh_token is required",
        },
      };
    }

    const resourceUri = requiredString(input.resource);
    const profile = resourceUri ? profileForMcpResourceUri(resourceUri) : null;
    if (resourceUri && !profile) {
      return {
        ok: false,
        error: {
          error: "invalid_target",
          error_description: "resource must match a canonical MCP resource",
        },
      };
    }

    const requestedScopes = input.scope === undefined
      ? undefined
      : parseMcpOAuthScopeSet(input.scope);
    if (input.scope !== undefined && (!requestedScopes || requestedScopes.size !== 1)) {
      return {
        ok: false,
        error: {
          error: "invalid_scope",
          error_description: "scope must match exactly one MCP scope",
        },
      };
    }

    return {
      ok: true,
      request: {
        grantType: "refresh_token",
        refreshToken,
        clientId,
        resourceUri: profile ? getMcpOAuthProfileResourceUri(profile) : undefined,
        scope: requestedScopes ? Array.from(requestedScopes)[0] : undefined,
      },
    };
  }

  const redirectUri = requiredString(input.redirect_uri);
  if (!redirectUri || !isValidRedirectUriSyntax(redirectUri)) {
    return {
      ok: false,
      error: {
        error: "invalid_request",
        error_description: "redirect_uri must be an absolute http(s) URI without a fragment",
      },
    };
  }

  const resourceUri = requiredString(input.resource);
  const profile = resourceUri ? profileForMcpResourceUri(resourceUri) : null;
  if (!resourceUri || !profile) {
    return {
      ok: false,
      error: {
        error: "invalid_target",
        error_description: "resource must match a canonical MCP resource",
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
      resourceUri: getMcpOAuthProfileResourceUri(profile),
      profile,
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

function parseMcpOAuthScopeSet(value: unknown): Set<McpOAuthScope> | null {
  if (typeof value !== "string") return null;
  const scopes = value.split(/\s+/).filter(Boolean);
  if (scopes.length === 0) return null;
  const parsed = new Set<McpOAuthScope>();
  for (const scope of scopes) {
    if (scope !== MCP_OAUTH_GAMES_SCOPE && scope !== MCP_OAUTH_SCOPE) return null;
    parsed.add(scope);
  }
  return parsed;
}

function parseMcpOAuthRegistrationScope(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const requested = new Set(value.split(/\s+/).filter(Boolean));
  if (requested.size === 0) return null;
  const supported = getMcpOAuthProfiles().map((profile) => profile.scope);
  for (const scope of requested) {
    if (!supported.includes(scope as McpOAuthScope)) return null;
  }
  return supported.filter((scope) => requested.has(scope)).join(" ");
}

function registeredClientScopeAllows(
  registeredScope: string,
  requestedScope: McpOAuthScope,
): boolean {
  return registeredScope.split(/\s+/).includes(requestedScope);
}

async function validateMcpOAuthClientRedirect(
  db: DrizzleDB,
  clientId: string,
  redirectUri: string,
  scope: McpOAuthScope,
): Promise<
  | { ok: true }
  | { ok: false; error: "invalid_client" | "invalid_request" | "invalid_scope"; errorDescription: string }
> {
  if (clientId === MCP_OAUTH_CLIENT_ID) {
    return isAllowedRedirectUri(redirectUri)
      ? { ok: true }
      : {
          ok: false,
          error: "invalid_request",
          errorDescription: "redirect_uri is not allowed for this client",
        };
  }

  const client = (await db
    .select({
      clientId: schema.mcpOauthClients.clientId,
      redirectUris: schema.mcpOauthClients.redirectUris,
      scope: schema.mcpOauthClients.scope,
    })
    .from(schema.mcpOauthClients)
    .where(eq(schema.mcpOauthClients.clientId, clientId)))[0];

  if (!client) {
    return {
      ok: false,
      error: "invalid_client",
      errorDescription: "client_id is not registered",
    };
  }

  if (!client.redirectUris.includes(redirectUri)) {
    return {
      ok: false,
      error: "invalid_request",
      errorDescription: "redirect_uri is not registered for this client",
    };
  }
  if (!registeredClientScopeAllows(client.scope, scope)) {
    return {
      ok: false,
      error: "invalid_scope",
      errorDescription: "scope is not registered for this client",
    };
  }

  return { ok: true };
}

interface ValidClientRegistration {
  redirectUris: string[];
  clientName?: string;
  clientUri?: string;
  logoUri?: string;
  tosUri?: string;
  policyUri?: string;
  grantTypes: string[];
  responseTypes: string[];
  scope: string;
}

function validateClientRegistrationInput(input: McpOAuthClientRegistrationInput):
  | { ok: true; registration: ValidClientRegistration }
  | { ok: false; error: string; errorDescription: string } {
  const redirectUris = requiredStringArray(input.redirect_uris);
  if (!redirectUris || redirectUris.length === 0) {
    return clientRegistrationError(
      "invalid_redirect_uri",
      "redirect_uris must include at least one redirect URI",
    );
  }
  if (!redirectUris.every(isAllowedRegisteredRedirectUri)) {
    return clientRegistrationError(
      "invalid_redirect_uri",
      "redirect_uris must be loopback http(s) URIs or configured https URIs",
    );
  }

  const grantTypes = optionalStringArray(input.grant_types);
  if (grantTypes === null) {
    return clientRegistrationError(
      "invalid_client_metadata",
      "grant_types must be an array of strings",
    );
  }
  const requestedGrantTypes = grantTypes ?? ["authorization_code"];
  if (
    requestedGrantTypes.length === 0 ||
    !requestedGrantTypes.includes("authorization_code") ||
    requestedGrantTypes.some((grantType) =>
      grantType !== "authorization_code" && grantType !== "refresh_token"
    )
  ) {
    return clientRegistrationError(
      "invalid_client_metadata",
      "grant_types must include authorization_code and may include refresh_token",
    );
  }
  const resolvedGrantTypes = requestedGrantTypes.includes("refresh_token")
    ? ["authorization_code", "refresh_token"]
    : ["authorization_code"];

  const responseTypes = optionalStringArray(input.response_types);
  if (responseTypes === null) {
    return clientRegistrationError(
      "invalid_client_metadata",
      "response_types must be an array of strings",
    );
  }
  const resolvedResponseTypes = responseTypes ?? ["code"];
  if (
    resolvedResponseTypes.length === 0 ||
    resolvedResponseTypes.some((responseType) => responseType !== "code")
  ) {
    return clientRegistrationError(
      "invalid_client_metadata",
      "response_types must contain only code",
    );
  }

  const requestedScope = input.scope === undefined
    ? MCP_OAUTH_GAMES_SCOPE
    : parseMcpOAuthRegistrationScope(input.scope);
  if (!requestedScope) {
    return clientRegistrationError(
      "invalid_scope",
      "scope must include only games and/or mcp",
    );
  }

  const tokenEndpointAuthMethod =
    requiredString(input.token_endpoint_auth_method) ?? "none";
  if (tokenEndpointAuthMethod !== "none") {
    return clientRegistrationError(
      "invalid_client_metadata",
      "token_endpoint_auth_method must be none",
    );
  }

  return {
    ok: true,
    registration: {
      redirectUris,
      clientName: optionalString(input.client_name, 160),
      clientUri: optionalHttpsUri(input.client_uri),
      logoUri: optionalHttpsUri(input.logo_uri),
      tosUri: optionalHttpsUri(input.tos_uri),
      policyUri: optionalHttpsUri(input.policy_uri),
      grantTypes: uniqueStrings(resolvedGrantTypes),
      responseTypes: uniqueStrings(resolvedResponseTypes),
      scope: requestedScope,
    },
  };
}

function clientRegistrationError(
  error: string,
  errorDescription: string,
): { ok: false; error: string; errorDescription: string } {
  return { ok: false, error, errorDescription };
}

function isAllowedRedirectUri(redirectUri: string): boolean {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }

  const configured = allowedRedirectUris();
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

function isAllowedRegisteredRedirectUri(redirectUri: string): boolean {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  if (!isValidRedirectUrl(url)) return false;
  if (isLoopbackUrl(url)) return url.protocol === "http:" || url.protocol === "https:";
  if (url.protocol !== "https:") return false;
  return allowedRedirectUris().includes(redirectUri) ||
    process.env.MCP_OAUTH_ALLOW_DYNAMIC_HTTPS_REDIRECTS === "true";
}

function isValidRedirectUriSyntax(redirectUri: string): boolean {
  try {
    return isValidRedirectUrl(new URL(redirectUri));
  } catch {
    return false;
  }
}

function isValidRedirectUrl(url: URL): boolean {
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.hash &&
    !url.username &&
    !url.password
  );
}

function isLoopbackUrl(url: URL): boolean {
  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]"
  );
}

function allowedRedirectUris(): string[] {
  return (process.env.MCP_OAUTH_ALLOWED_REDIRECT_URIS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function requiredStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings: string[] = [];
  for (const entry of value) {
    const parsed = requiredString(entry);
    if (!parsed) return null;
    strings.push(parsed);
  }
  return uniqueStrings(strings);
}

function optionalStringArray(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  return requiredStringArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  const text = requiredString(value);
  if (!text) return undefined;
  return text.slice(0, maxLength);
}

function optionalHttpsUri(value: unknown): string | undefined {
  const text = requiredString(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.hash || url.username || url.password) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizeResourceUri(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hash) return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}
