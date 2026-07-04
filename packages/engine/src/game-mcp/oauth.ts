import { createHash, randomBytes } from "node:crypto";

export const MCP_OAUTH_CLIENT_ID =
  process.env.MCP_OAUTH_CLIENT_ID ?? "influence-game-mcp-local";
export const MCP_OAUTH_SCOPE = "producer";
export const MCP_OAUTH_ISSUER = "influence-game-mcp";
export const MCP_OAUTH_AUTHORIZE_PATH = "/oauth/mcp/authorize";
export const MCP_OAUTH_CALLBACK_PATH = "/oauth/callback";
export const MCP_OAUTH_AUDIENCE = "game-mcp";

export interface AuthorizeUrlOptions {
  webBaseUrl: URL;
  clientId: string;
  redirectUri: string;
  resourceUri: string;
  state: string;
  codeChallenge: string;
}

export interface CallbackResult {
  code?: string;
  error?: string;
  errorDescription?: string;
}

export interface TokenExchangeOptions {
  apiBaseUrl: URL;
  clientId: string;
  code: string;
  redirectUri: string;
  resourceUri: string;
  codeVerifier: string;
}

export interface McpOAuthTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
  audience: string;
  purpose: string;
  resource: string;
}

export function generateOAuthSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function pkceS256(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export function requireSafeHttpBaseUrl(rawUrl: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }

  if (url.username || url.password) {
    throw new Error(`${label} must not include credentials`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    throw new Error(`${label} must use HTTPS outside loopback development hosts`);
  }
  return url;
}

export function buildAuthorizeUrl(options: AuthorizeUrlOptions): URL {
  const authorizeUrl = new URL(MCP_OAUTH_AUTHORIZE_PATH, options.webBaseUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", options.clientId);
  authorizeUrl.searchParams.set("redirect_uri", options.redirectUri);
  authorizeUrl.searchParams.set("resource", options.resourceUri);
  authorizeUrl.searchParams.set("scope", MCP_OAUTH_SCOPE);
  authorizeUrl.searchParams.set("state", options.state);
  authorizeUrl.searchParams.set("code_challenge", options.codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  return authorizeUrl;
}

export function parseOAuthCallbackUrl(callbackUrl: URL, expectedState: string): CallbackResult {
  const state = callbackUrl.searchParams.get("state");
  if (!state || state !== expectedState) {
    return {
      error: "invalid_state",
      errorDescription: "OAuth callback state did not match the login request",
    };
  }

  const error = callbackUrl.searchParams.get("error");
  if (error) {
    return {
      error,
      errorDescription: callbackUrl.searchParams.get("error_description") ?? undefined,
    };
  }

  const code = callbackUrl.searchParams.get("code");
  if (!code) {
    return {
      error: "invalid_request",
      errorDescription: "OAuth callback did not include a code",
    };
  }

  return { code };
}

export async function exchangeAuthorizationCode(
  options: TokenExchangeOptions,
): Promise<McpOAuthTokenResponse> {
  const tokenUrl = new URL("/api/oauth/mcp/token", options.apiBaseUrl);
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: options.clientId,
      redirect_uri: options.redirectUri,
      resource: options.resourceUri,
      code: options.code,
      code_verifier: options.codeVerifier,
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${body}`);
  }

  const parsed = JSON.parse(body) as Partial<McpOAuthTokenResponse>;
  if (
    typeof parsed.access_token !== "string" ||
    parsed.token_type !== "Bearer" ||
    typeof parsed.expires_in !== "number" ||
    !parsed.scope?.split(/\s+/).includes(MCP_OAUTH_SCOPE) ||
    parsed.audience !== MCP_OAUTH_AUDIENCE ||
    !isSameLocalResource(parsed.resource, options.resourceUri)
  ) {
    throw new Error("Token exchange returned an invalid MCP OAuth response");
  }

  return parsed as McpOAuthTokenResponse;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]";
}

function isSameLocalResource(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string") return false;
  if (actual === expected) return true;

  let actualUrl: URL;
  let expectedUrl: URL;
  try {
    actualUrl = new URL(actual);
    expectedUrl = new URL(expected);
  } catch {
    return false;
  }

  return actualUrl.protocol === expectedUrl.protocol &&
    actualUrl.port === expectedUrl.port &&
    actualUrl.pathname === expectedUrl.pathname &&
    actualUrl.search === expectedUrl.search &&
    actualUrl.hash === expectedUrl.hash &&
    isLoopbackHost(actualUrl.hostname) &&
    isLoopbackHost(expectedUrl.hostname);
}
