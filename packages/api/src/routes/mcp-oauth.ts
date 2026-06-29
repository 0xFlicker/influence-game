/**
 * MCP OAuth routes.
 *
 * These routes produce opaque bearer tokens for Game MCP access.
 * `scope=games` is user-facing; `scope=mcp` is the producer/global boundary.
 */

import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import type { DrizzleDB } from "../db/index.js";
import {
  requireAuth,
  type AuthEnv,
} from "../middleware/auth.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import {
  authorizeMcpOAuth,
  exchangeMcpOAuthCode,
  getMcpOAuthAuthorizationEndpoint,
  getMcpOAuthAuthorizationServerIssuer,
  getMcpOAuthProfile,
  getMcpOAuthProfileResourceUri,
  getMcpOAuthProfiles,
  getMcpOAuthRegistrationEndpoint,
  getMcpOAuthRevocationEndpoint,
  getMcpOAuthTokenEndpoint,
  introspectMcpAccessToken,
  MCP_OAUTH_CLIENT_ID,
  profileForMcpResourceUri,
  profileForMcpScope,
  registerMcpOAuthClient,
  revokeMcpOAuthToken,
  type McpAuthProfile,
  type McpOAuthProfileName,
  type McpOAuthAuditMetadata,
  secretsEqual,
} from "../services/mcp-oauth.js";
import {
  parseMcpAppProviderId,
  type McpAppAuditStage,
  type McpAppProviderId,
} from "../game-mcp/provider-profiles.js";

export type McpOAuthAuditEventName =
  | "mcp.oauth.register"
  | "mcp.oauth.authorize"
  | "mcp.oauth.token"
  | "mcp.oauth.revoke"
  | "mcp.oauth.introspect";

export interface McpOAuthAuditEvent extends McpOAuthAuditMetadata {
  event: McpOAuthAuditEventName;
  correlationId: string;
  result: "success" | "failure";
  status: number;
  decision?: string;
  providerId?: McpAppProviderId;
  appStage?: McpAppAuditStage;
  grantType?: "authorization_code" | "refresh_token";
  redirectUriFamily?: "loopback" | "localhost" | "https" | "custom" | "unknown";
  denialReason?: string;
  active?: boolean;
}

export type McpOAuthAuditLogger = (event: McpOAuthAuditEvent) => void;

export function createMcpOAuthRoutes(
  db: DrizzleDB,
  auditLogger: McpOAuthAuditLogger = defaultAuditLogger,
) {
  const app = new Hono<AuthEnv>();

  app.post("/api/oauth/mcp/register", async (c) => {
    const correlationId = getCorrelationId(c);
    const body = await parseOAuthBody(c, "POST /api/oauth/mcp/register");
    if (!body) {
      emitAudit(auditLogger, {
        event: "mcp.oauth.register",
        correlationId,
        result: "failure",
        status: 400,
        providerId: providerIdHint(c),
        denialReason: "invalid_request",
      });
      return c.json({ error: "invalid_request", error_description: "Invalid request body" }, 400);
    }

    const result = await registerMcpOAuthClient(db, body);
    emitAudit(auditLogger, {
      event: "mcp.oauth.register",
      correlationId,
      clientId: result.audit?.clientId,
      scope: result.audit?.scope ?? safeAuditString(result.body.scope),
      result: result.status === 201 ? "success" : "failure",
      status: result.status,
      providerId: providerIdHint(c),
      appStage: "discovery",
      denialReason: result.status === 201 ? undefined : bodyErrorCode(result.body),
    });
    return c.json(result.body, result.status);
  });

  app.post("/api/oauth/mcp/authorize", requireAuth(db), async (c) => {
    const correlationId = getCorrelationId(c);
    const body = await parseOAuthBody(c, "POST /api/oauth/mcp/authorize");
    if (!body) {
      emitAudit(auditLogger, {
        event: "mcp.oauth.authorize",
        correlationId,
        userId: c.get("user").id,
        walletAddress: c.get("user").walletAddress ?? undefined,
        result: "failure",
        status: 400,
        providerId: providerIdHint(c),
        appStage: "oauth_start",
        denialReason: "invalid_request",
      });
      return c.json({ error: "invalid_request", error_description: "Invalid request body" }, 400);
    }

    const result = await authorizeMcpOAuth(db, c.get("user"), body);
    const decision = safeAuditString(body.decision) ?? "inspect";
    emitAudit(auditLogger, {
      event: "mcp.oauth.authorize",
      correlationId,
      userId: c.get("user").id,
      walletAddress: c.get("user").walletAddress ?? undefined,
      clientId: safeAuditString(body.client_id),
      resource: safeAuditString(body.resource),
      scope: safeAuditString(body.scope),
      authProfile: auditAuthProfileForRequest(body.scope, body.resource),
      decision,
      providerId: providerIdHint(c),
      appStage: "oauth_start",
      redirectUriFamily: redirectUriFamily(body.redirect_uri),
      result: authorizeAuditResult(result.status, decision),
      status: result.status,
      denialReason: authorizeDenialReason(result.body, result.status, decision),
    });
    return c.json(result.body, result.status);
  });

  app.post("/api/oauth/mcp/token", async (c) => {
    const correlationId = getCorrelationId(c);
    const body = await parseOAuthBody(c, "POST /api/oauth/mcp/token");
    if (!body) {
      emitAudit(auditLogger, {
        event: "mcp.oauth.token",
        correlationId,
        result: "failure",
        status: 400,
        providerId: providerIdHint(c),
        appStage: "callback_token_exchange",
        grantType: undefined,
        denialReason: "invalid_request",
      });
      return c.json({ error: "invalid_request", error_description: "Invalid request body" }, 400);
    }

    const grantType = tokenGrantType(body.grant_type);
    const result = await exchangeMcpOAuthCode(db, body);
    emitAudit(auditLogger, {
      event: "mcp.oauth.token",
      correlationId,
      userId: result.audit?.userId,
      walletAddress: result.audit?.walletAddress,
      clientId: result.audit?.clientId ?? safeAuditString(body.client_id),
      resource: result.audit?.resource ?? safeAuditString(body.resource),
      scope: result.audit?.scope ?? safeAuditString(result.body.scope),
      authProfile: result.audit?.authProfile ?? auditAuthProfileForScope(result.body.scope),
      grantType: result.audit?.grantType ?? grantType,
      providerId: providerIdHint(c),
      appStage: grantType === "refresh_token" ? "token_refresh" : "callback_token_exchange",
      redirectUriFamily: redirectUriFamily(body.redirect_uri),
      result: result.status === 200 ? "success" : "failure",
      status: result.status,
      denialReason: result.status === 200 ? undefined : bodyErrorCode(result.body),
    });
    return c.json(result.body, result.status);
  });

  app.post("/api/oauth/mcp/revoke", async (c) => {
    const correlationId = getCorrelationId(c);
    const body = await parseOAuthBody(c, "POST /api/oauth/mcp/revoke");
    if (!body) {
      emitAudit(auditLogger, {
        event: "mcp.oauth.revoke",
        correlationId,
        result: "failure",
        status: 400,
        providerId: providerIdHint(c),
        denialReason: "invalid_request",
      });
      return c.json({ error: "invalid_request", error_description: "Invalid request body" }, 400);
    }

    const result = await revokeMcpOAuthToken(db, body);
    emitAudit(auditLogger, {
      event: "mcp.oauth.revoke",
      correlationId,
      userId: result.audit?.userId,
      walletAddress: result.audit?.walletAddress,
      clientId: result.audit?.clientId ?? safeAuditString(body.client_id),
      resource: result.audit?.resource,
      scope: result.audit?.scope,
      authProfile: result.audit?.authProfile,
      providerId: providerIdHint(c),
      result: result.status === 200 ? "success" : "failure",
      status: result.status,
      denialReason: result.status === 200 ? undefined : bodyErrorCode(result.body),
    });
    return c.json(result.body, result.status);
  });

  app.post("/api/oauth/mcp/introspect", async (c) => {
    const correlationId = getCorrelationId(c);
    const expectedSecret = process.env.INFLUENCE_MCP_INTROSPECTION_SECRET;
    if (!expectedSecret) {
      emitAudit(auditLogger, {
        event: "mcp.oauth.introspect",
        correlationId,
        result: "failure",
        status: 503,
        providerId: providerIdHint(c),
        denialReason: "server_error",
      });
      return c.json(
        {
          error: "server_error",
          error_description: "MCP introspection is not configured",
        },
        503,
      );
    }

    const authHeader = c.req.header("Authorization");
    const presentedSecret = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
    if (!presentedSecret || !secretsEqual(presentedSecret, expectedSecret)) {
      emitAudit(auditLogger, {
        event: "mcp.oauth.introspect",
        correlationId,
        result: "failure",
        status: 401,
        providerId: providerIdHint(c),
        denialReason: "invalid_client",
      });
      return c.json(
        {
          error: "invalid_client",
          error_description: "Invalid introspection credentials",
        },
        401,
      );
    }

    const body = await parseOAuthBody(c, "POST /api/oauth/mcp/introspect");
    const token = typeof body?.token === "string" ? body.token : null;
    if (!token) {
      emitAudit(auditLogger, {
        event: "mcp.oauth.introspect",
        correlationId,
        result: "failure",
        status: 400,
        providerId: providerIdHint(c),
        denialReason: "invalid_request",
      });
      return c.json(
        {
          error: "invalid_request",
          error_description: "token is required",
        },
        400,
      );
    }

    const introspection = await introspectMcpAccessToken(db, token);
    emitAudit(auditLogger, {
      event: "mcp.oauth.introspect",
      correlationId,
      userId: introspection.sub,
      clientId: introspection.client_id,
      resource: introspection.resource,
      scope: introspection.scope,
      authProfile: auditAuthProfileForScope(introspection.scope),
      providerId: providerIdHint(c),
      result: introspection.active ? "success" : "failure",
      status: 200,
      denialReason: introspection.active ? undefined : "inactive_token",
      active: introspection.active,
    });
    return c.json(introspection);
  });

  app.get("/.well-known/oauth-protected-resource", (c) => {
    return c.json(buildProtectedResourceMetadata("games"));
  });

  for (const profile of getMcpOAuthProfiles()) {
    app.get(profile.protectedResourceMetadataPath, (c) => {
      return c.json(buildProtectedResourceMetadata(profile.name));
    });
  }

  app.get("/.well-known/oauth-authorization-server", (c) => {
    return c.json({
      issuer: getMcpOAuthAuthorizationServerIssuer(),
      authorization_endpoint: getMcpOAuthAuthorizationEndpoint(),
      token_endpoint: getMcpOAuthTokenEndpoint(),
      revocation_endpoint: getMcpOAuthRevocationEndpoint(),
      registration_endpoint: getMcpOAuthRegistrationEndpoint(),
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: getMcpOAuthProfiles().map((profile) => profile.scope),
      client_id: MCP_OAUTH_CLIENT_ID,
    });
  });

  return app;
}

function defaultAuditLogger(event: McpOAuthAuditEvent): void {
  console.info("[mcp-oauth-audit]", JSON.stringify(event));
}

function emitAudit(
  auditLogger: McpOAuthAuditLogger,
  event: McpOAuthAuditEvent,
): void {
  try {
    auditLogger(event);
  } catch (error) {
    console.warn(
      "[mcp-oauth-audit] audit logger failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

function getCorrelationId(c: Context): string {
  return c.req.header("x-correlation-id") ||
    c.req.header("x-request-id") ||
    randomUUID();
}

function buildProtectedResourceMetadata(profileName: McpOAuthProfileName): Record<string, unknown> {
  const profile = getMcpOAuthProfile(profileName);
  return {
    resource: getMcpOAuthProfileResourceUri(profile),
    authorization_servers: [getMcpOAuthAuthorizationServerIssuer()],
    scopes_supported: [profile.scope],
    bearer_methods_supported: ["header"],
    resource_name: profile.resourceName,
  };
}

function safeAuditString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 160) : undefined;
}

function tokenGrantType(value: unknown): "authorization_code" | "refresh_token" | undefined {
  const grantType = safeAuditString(value);
  return grantType === "authorization_code" || grantType === "refresh_token"
    ? grantType
    : undefined;
}

function auditAuthProfileForScope(value: unknown): McpAuthProfile | undefined {
  const scope = safeAuditString(value);
  return scope ? profileForMcpScope(scope)?.authProfile : undefined;
}

function auditAuthProfileForRequest(
  scopeValue: unknown,
  resourceValue: unknown,
): McpAuthProfile | undefined {
  const scope = safeAuditString(scopeValue);
  const resource = safeAuditString(resourceValue);
  if (!scope || !resource) return auditAuthProfileForScope(scopeValue);
  const profile = profileForMcpResourceUri(resource);
  if (!profile) return auditAuthProfileForScope(scopeValue);
  return scope.split(/\s+/).includes(profile.scope)
    ? profile.authProfile
    : auditAuthProfileForScope(scopeValue);
}

function bodyErrorCode(body: Record<string, unknown>): string | undefined {
  return safeAuditString(body.error);
}

function providerIdHint(c: Context): McpAppProviderId | undefined {
  return parseMcpAppProviderId(c.req.header("x-mcp-app-provider"));
}

function redirectUriFamily(value: unknown): McpOAuthAuditEvent["redirectUriFamily"] {
  const uri = safeAuditString(value);
  if (!uri) return undefined;
  try {
    const parsed = new URL(uri);
    if (parsed.hostname === "127.0.0.1" || parsed.hostname === "::1") return "loopback";
    if (parsed.hostname === "localhost") return "localhost";
    if (parsed.protocol === "https:") return "https";
    return "custom";
  } catch {
    return "unknown";
  }
}

function authorizeAuditResult(
  status: number,
  decision: string,
): "success" | "failure" {
  if (status >= 400) return "failure";
  return decision === "deny" || decision === "cancel" ? "failure" : "success";
}

function authorizeDenialReason(
  body: Record<string, unknown>,
  status: number,
  decision: string,
): string | undefined {
  if (status >= 400) return bodyErrorCode(body);
  if (decision === "deny") return "access_denied";
  if (decision === "cancel") return "access_canceled";
  return undefined;
}

async function parseOAuthBody(
  c: Context,
  routeName: string,
): Promise<Record<string, unknown> | null> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    try {
      const text = await c.req.text();
      return Object.fromEntries(new URLSearchParams(text).entries());
    } catch (err) {
      console.warn(
        `[${routeName}] form body parse failed:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  return parseJsonBody(c, routeName) as Promise<Record<string, unknown> | null>;
}
