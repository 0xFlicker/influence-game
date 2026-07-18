import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import type { DrizzleDB } from "../db/index.js";
import {
  bearerChallenge,
  extractBearerToken,
  originIsAllowed,
  validateGameMcpBearerToken,
  type GameMcpAuthContext,
  type GameMcpAuthResult,
} from "../game-mcp/auth.js";
import { getMcpOAuthResourceUri } from "../services/mcp-oauth.js";
import {
  createProductionGameMcpServer,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ProductionGameMcpJsonRpcServer,
} from "../game-mcp/server.js";
import {
  INFLUENCE_MCP_APP_RESOURCE_URI,
} from "../game-mcp/app-resource.js";
import {
  parseMcpAppProviderId,
  type McpAppAuditStage,
  type McpAppProviderId,
} from "../game-mcp/provider-profiles.js";
import { MCP_OAUTH_SCOPE_VALUES } from "../services/mcp-scope-policy.js";
import {
  GAME_MCP_TOOL_ACCESS,
  isGameMcpToolName,
} from "../game-mcp/tool-authorization.js";

const DEFAULT_MAX_POST_BYTES = 1024 * 1024;
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-06-18", "2025-03-26"]);
const UNKNOWN_TOOL_AUDIT_NAME = "unknown_tool";

type GameMcpJsonRpcAuditDenialReason =
  | "insufficient_scope"
  | "tool_error"
  | "json_rpc_error"
  | "internal_error";

export interface GameMcpAuditEvent {
  event: "mcp.http.request";
  correlationId: string;
  result: "success" | "failure";
  status: number;
  userId?: string;
  clientId?: string;
  resource?: string;
  scope?: string;
  authProfile?: string;
  method?: string;
  tool?: string;
  providerId?: McpAppProviderId;
  appStage?: McpAppAuditStage;
  appResourceUri?: string;
  denialReason?: string;
}

export type GameMcpAuditLogger = (event: GameMcpAuditEvent) => void;
export type GameMcpTokenValidator = (
  token: string,
) => Promise<GameMcpAuthResult>;

export interface CreateMcpRoutesOptions {
  server?: ProductionGameMcpJsonRpcServer;
  auditLogger?: GameMcpAuditLogger;
  tokenValidator?: GameMcpTokenValidator;
  maxPostBytes?: number;
}

export function createMcpRoutes(
  db: DrizzleDB,
  options: CreateMcpRoutesOptions = {},
) {
  const app = new Hono();
  const server = options.server ?? createProductionGameMcpServer(db);
  const auditLogger = options.auditLogger ?? defaultAuditLogger;
  const tokenValidator = options.tokenValidator ?? ((token) =>
    validateGameMcpBearerToken(db, token)
  );
  const maxPostBytes = options.maxPostBytes ?? DEFAULT_MAX_POST_BYTES;

  registerMcpResource(app, {
    path: new URL(getMcpOAuthResourceUri()).pathname,
    server,
    auditLogger,
    tokenValidator,
    maxPostBytes,
  });

  return app;
}

function registerMcpResource(
  app: Hono,
  params: {
    path: string;
    server: ProductionGameMcpJsonRpcServer;
    auditLogger: GameMcpAuditLogger;
    tokenValidator: GameMcpTokenValidator;
    maxPostBytes: number;
  },
): void {
  app.get(params.path, async (c) => {
    const auth = await preflight(c, params.auditLogger, params.tokenValidator);
    if (!auth.ok) return auth.response;

    emitAudit(params.auditLogger, {
      event: "mcp.http.request",
      correlationId: getCorrelationId(c),
      result: "failure",
      status: 405,
      userId: auth.context.userId,
      clientId: auth.context.clientId,
      resource: auth.context.resource,
      scope: auth.context.scope,
      authProfile: auth.context.authProfile,
      providerId: providerIdHint(c),
      denialReason: "method_not_allowed",
    });
    c.header("Allow", "POST");
    return c.json({ error: "method_not_allowed", error_description: "Use POST for MCP JSON-RPC requests" }, 405);
  });

  app.post(params.path, async (c) => {
    const correlationId = getCorrelationId(c);
    const auth = await preflight(c, params.auditLogger, params.tokenValidator);
    if (!auth.ok) return auth.response;

    const contentLength = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > params.maxPostBytes) {
      return fail(c, params.auditLogger, correlationId, auth.context, 413, "request_too_large");
    }

    if (!contentTypeIsJson(c.req.header("content-type"))) {
      return fail(c, params.auditLogger, correlationId, auth.context, 415, "unsupported_media_type");
    }

    if (!acceptsMcpResponse(c.req.header("accept"))) {
      return fail(c, params.auditLogger, correlationId, auth.context, 406, "not_acceptable");
    }

    if (!protocolVersionIsSupported(c.req.header("mcp-protocol-version"))) {
      return fail(c, params.auditLogger, correlationId, auth.context, 400, "unsupported_protocol_version");
    }

    let rawBody: string;
    try {
      rawBody = await c.req.text();
    } catch {
      const response = jsonRpcError(null, -32700, "Parse error");
      emitAudit(params.auditLogger, {
        event: "mcp.http.request",
        correlationId,
        result: "failure",
        status: 400,
        userId: auth.context.userId,
        clientId: auth.context.clientId,
        resource: auth.context.resource,
        scope: auth.context.scope,
        authProfile: auth.context.authProfile,
        providerId: providerIdHint(c),
        denialReason: "parse_error",
      });
      return c.json(response, 400);
    }

    if (bodyByteLength(rawBody) > params.maxPostBytes) {
      return fail(c, params.auditLogger, correlationId, auth.context, 413, "request_too_large");
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      const response = jsonRpcError(null, -32700, "Parse error");
      emitAudit(params.auditLogger, {
        event: "mcp.http.request",
        correlationId,
        result: "failure",
        status: 400,
        userId: auth.context.userId,
        clientId: auth.context.clientId,
        resource: auth.context.resource,
        scope: auth.context.scope,
        authProfile: auth.context.authProfile,
        providerId: providerIdHint(c),
        denialReason: "parse_error",
      });
      return c.json(response, 400);
    }

    const validation = validateJsonRpcRequest(body);
    if (!validation.ok) {
      emitAudit(params.auditLogger, {
        event: "mcp.http.request",
        correlationId,
        result: validation.status === 202 ? "success" : "failure",
        status: validation.status,
        userId: auth.context.userId,
        clientId: auth.context.clientId,
        resource: auth.context.resource,
        scope: auth.context.scope,
        authProfile: auth.context.authProfile,
        providerId: providerIdHint(c),
        denialReason: validation.reason,
      });
      return validation.status === 202
        ? c.body(null, 202)
        : c.json(validation.response, validation.status);
    }

    const response = await params.server.handle(validation.request, auth.context);
    const auditOutcome = classifyJsonRpcResponseForAudit(response);
    emitAudit(params.auditLogger, {
      event: "mcp.http.request",
      correlationId,
      result: auditOutcome.result,
      status: response ? 200 : 202,
      userId: auth.context.userId,
      clientId: auth.context.clientId,
      resource: auth.context.resource,
      scope: auth.context.scope,
      authProfile: auth.context.authProfile,
      method: validation.request.method,
      tool: toolName(validation.request),
      providerId: providerIdHint(c),
      appStage: appStageForRequest(validation.request),
      appResourceUri: appResourceUriForRequest(validation.request),
      denialReason: auditOutcome.denialReason,
    });

    if (!response) return c.body(null, 202);
    return c.json(response);
  });
}

async function preflight(
  c: Context,
  auditLogger: GameMcpAuditLogger,
  tokenValidator: GameMcpTokenValidator,
): Promise<
  | { ok: true; context: GameMcpAuthContext }
  | { ok: false; response: Response }
> {
  const correlationId = getCorrelationId(c);
  const origin = c.req.header("origin");

  if (hasQueryToken(c)) {
    emitAudit(auditLogger, {
      event: "mcp.http.request",
      correlationId,
      result: "failure",
      status: 400,
      providerId: providerIdHint(c),
      denialReason: "query_token_rejected",
    });
    return {
      ok: false,
      response: c.json({
        error: "invalid_request",
        error_description: "Bearer tokens must be sent in the Authorization header",
      }, 400),
    };
  }

  if (!originIsAllowed(origin)) {
    emitAudit(auditLogger, {
      event: "mcp.http.request",
      correlationId,
      result: "failure",
      status: 403,
      providerId: providerIdHint(c),
      denialReason: "origin_not_allowed",
    });
    return {
      ok: false,
      response: c.json({ error: "forbidden", error_description: "Origin is not allowed" }, 403),
    };
  }

  const token = extractBearerToken(c.req.header("Authorization"));
  if (!token) {
    c.header("WWW-Authenticate", bearerChallenge({
      scopes: MCP_OAUTH_SCOPE_VALUES,
    }));
    emitAudit(auditLogger, {
      event: "mcp.http.request",
      correlationId,
      result: "failure",
      status: 401,
      providerId: providerIdHint(c),
      denialReason: "missing_bearer_token",
    });
    return {
      ok: false,
      response: c.json({ error: "invalid_token", error_description: "MCP bearer token required" }, 401),
    };
  }

  let auth: GameMcpAuthResult;
  try {
    auth = await tokenValidator(token);
  } catch {
    c.header("WWW-Authenticate", bearerChallenge());
    emitAudit(auditLogger, {
      event: "mcp.http.request",
      correlationId,
      result: "failure",
      status: 503,
      providerId: providerIdHint(c),
      denialReason: "token_validation_error",
    });
    return {
      ok: false,
      response: c.json({
        error: "server_error",
        error_description: "MCP bearer token validation failed",
      }, 503),
    };
  }
  if (!auth.ok) {
    c.header("WWW-Authenticate", bearerChallenge());
    emitAudit(auditLogger, {
      event: "mcp.http.request",
      correlationId,
      result: "failure",
      status: auth.status,
      providerId: providerIdHint(c),
      denialReason: auth.reason,
    });
    return {
      ok: false,
      response: c.json({ error: "invalid_token", error_description: auth.reason }, auth.status),
    };
  }

  return { ok: true, context: auth.context };
}

function validateJsonRpcRequest(body: unknown):
  | { ok: true; request: JsonRpcRequest }
  | { ok: false; status: 202; reason: string }
  | { ok: false; status: 400; reason: string; response: JsonRpcResponse } {
  if (Array.isArray(body)) {
    return {
      ok: false,
      status: 400,
      reason: "batch_unsupported",
      response: jsonRpcError(null, -32600, "Batch JSON-RPC requests are not supported"),
    };
  }
  if (!isRecord(body)) {
    return {
      ok: false,
      status: 400,
      reason: "invalid_request",
      response: jsonRpcError(null, -32600, "Invalid Request"),
    };
  }
  if (body.method === undefined && ("result" in body || "error" in body)) {
    return { ok: false, status: 202, reason: "accepted_json_rpc_response" };
  }
  if (body.jsonrpc !== undefined && body.jsonrpc !== "2.0") {
    return {
      ok: false,
      status: 400,
      reason: "invalid_jsonrpc_version",
      response: jsonRpcError(idForError(body.id), -32600, "jsonrpc must be 2.0"),
    };
  }
  if (typeof body.method !== "string") {
    return {
      ok: false,
      status: 400,
      reason: "method_required",
      response: jsonRpcError(idForError(body.id), -32600, "method is required"),
    };
  }
  return {
    ok: true,
    request: {
      jsonrpc: "2.0",
      id: body.id as string | number | null | undefined,
      method: body.method,
      params: body.params,
    },
  };
}

function fail(
  c: Context,
  auditLogger: GameMcpAuditLogger,
  correlationId: string,
  auth: GameMcpAuthContext,
  status: 400 | 406 | 413 | 415,
  denialReason: string,
): Response {
  emitAudit(auditLogger, {
    event: "mcp.http.request",
    correlationId,
    result: "failure",
    status,
    userId: auth.userId,
    clientId: auth.clientId,
    resource: auth.resource,
    scope: auth.scope,
    authProfile: auth.authProfile,
    providerId: providerIdHint(c),
    denialReason,
  });
  return c.json({ error: denialReason }, status);
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

function hasQueryToken(c: Context): boolean {
  const url = new URL(c.req.url);
  return url.searchParams.has("access_token") || url.searchParams.has("token");
}

function acceptsMcpResponse(accept: string | undefined): boolean {
  if (!accept) return true;
  return accept.includes("application/json") ||
    accept.includes("text/event-stream") ||
    accept.includes("*/*");
}

function contentTypeIsJson(contentType: string | undefined): boolean {
  return typeof contentType === "string" && contentType.includes("application/json");
}

function protocolVersionIsSupported(value: string | undefined): boolean {
  if (!value) return true;
  return SUPPORTED_PROTOCOL_VERSIONS.has(value.trim());
}

function bodyByteLength(body: string): number {
  return new TextEncoder().encode(body).length;
}

function toolName(request: JsonRpcRequest): string | undefined {
  if (request.method !== "tools/call") return undefined;
  const params = isRecord(request.params) ? request.params : {};
  const name = params.name;
  return typeof name === "string" && isGameMcpToolName(name)
    ? GAME_MCP_TOOL_ACCESS[name].name
    : UNKNOWN_TOOL_AUDIT_NAME;
}

function classifyJsonRpcResponseForAudit(response: JsonRpcResponse | null):
  | { result: "success"; denialReason?: undefined }
  | { result: "failure"; denialReason: GameMcpJsonRpcAuditDenialReason } {
  if (!response) return { result: "success" };
  if (response.error) {
    return {
      result: "failure",
      denialReason: response.error.code === -32603
        ? "internal_error"
        : "json_rpc_error",
    };
  }
  if (!isErroredToolResult(response.result)) return { result: "success" };
  return {
    result: "failure",
    denialReason: hasMcpAuthorizationChallenge(response.result)
      ? "insufficient_scope"
      : "tool_error",
  };
}

function isErroredToolResult(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.isError === true;
}

function hasMcpAuthorizationChallenge(result: Record<string, unknown>): boolean {
  const meta = result._meta;
  if (!isRecord(meta) || !Object.hasOwn(meta, "mcp/www_authenticate")) {
    return false;
  }
  const challenges = meta["mcp/www_authenticate"];
  return Array.isArray(challenges) &&
    challenges.length === 1 &&
    typeof challenges[0] === "string" &&
    challenges[0].startsWith("Bearer ") &&
    challenges[0].includes('error="insufficient_scope"');
}

function appStageForRequest(request: JsonRpcRequest | undefined): McpAppAuditStage | undefined {
  if (!request) return undefined;
  if (request.method === "resources/read" && appResourceUriForRequest(request)) return "app_resource_fetch";
  return undefined;
}

function appResourceUriForRequest(request: JsonRpcRequest | undefined): string | undefined {
  if (!request) return undefined;
  if (request.method !== "resources/read") return undefined;
  const params = isRecord(request.params) ? request.params : {};
  return params.uri === INFLUENCE_MCP_APP_RESOURCE_URI ? INFLUENCE_MCP_APP_RESOURCE_URI : undefined;
}

function providerIdHint(c: Context): McpAppProviderId | undefined {
  return parseMcpAppProviderId(c.req.header("x-mcp-app-provider"));
}

function idForError(id: unknown): string | number | null {
  return typeof id === "string" || typeof id === "number" || id === null
    ? id
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getCorrelationId(c: Context): string {
  return c.req.header("x-correlation-id") ||
    c.req.header("x-request-id") ||
    randomUUID();
}

function defaultAuditLogger(event: GameMcpAuditEvent): void {
  console.info("[game-mcp-audit]", JSON.stringify(event));
}

function emitAudit(
  auditLogger: GameMcpAuditLogger,
  event: GameMcpAuditEvent,
): void {
  try {
    auditLogger(event);
  } catch (error) {
    console.warn(
      "[game-mcp-audit] audit logger failed:",
      error instanceof Error ? error.message : error,
    );
  }
}
