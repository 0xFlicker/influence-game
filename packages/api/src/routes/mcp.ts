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
import {
  createProductionGameMcpServer,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ProductionGameMcpJsonRpcServer,
} from "../game-mcp/server.js";

const DEFAULT_MAX_POST_BYTES = 1024 * 1024;
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-06-18", "2025-03-26"]);

export interface GameMcpAuditEvent {
  event: "mcp.http.request";
  correlationId: string;
  result: "success" | "failure";
  status: number;
  userId?: string;
  clientId?: string;
  resource?: string;
  method?: string;
  tool?: string;
  denialReason?: string;
}

export type GameMcpAuditLogger = (event: GameMcpAuditEvent) => void;
export type GameMcpTokenValidator = (token: string) => Promise<GameMcpAuthResult>;

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

  app.get("/mcp", async (c) => {
    const auth = await preflight(c, auditLogger, tokenValidator);
    if (!auth.ok) return auth.response;

    emitAudit(auditLogger, {
      event: "mcp.http.request",
      correlationId: getCorrelationId(c),
      result: "failure",
      status: 405,
      userId: auth.context.userId,
      clientId: auth.context.clientId,
      resource: auth.context.resource,
      denialReason: "method_not_allowed",
    });
    c.header("Allow", "POST");
    return c.json({ error: "method_not_allowed", error_description: "Use POST for MCP JSON-RPC requests" }, 405);
  });

  app.post("/mcp", async (c) => {
    const correlationId = getCorrelationId(c);
    const auth = await preflight(c, auditLogger, tokenValidator);
    if (!auth.ok) return auth.response;

    const contentLength = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > maxPostBytes) {
      return fail(c, auditLogger, correlationId, auth.context, 413, "request_too_large");
    }

    if (!contentTypeIsJson(c.req.header("content-type"))) {
      return fail(c, auditLogger, correlationId, auth.context, 415, "unsupported_media_type");
    }

    if (!acceptsMcpResponse(c.req.header("accept"))) {
      return fail(c, auditLogger, correlationId, auth.context, 406, "not_acceptable");
    }

    if (!protocolVersionIsSupported(c.req.header("mcp-protocol-version"))) {
      return fail(c, auditLogger, correlationId, auth.context, 400, "unsupported_protocol_version");
    }

    let rawBody: string;
    try {
      rawBody = await c.req.text();
    } catch {
      const response = jsonRpcError(null, -32700, "Parse error");
      emitAudit(auditLogger, {
        event: "mcp.http.request",
        correlationId,
        result: "failure",
        status: 400,
        userId: auth.context.userId,
        clientId: auth.context.clientId,
        resource: auth.context.resource,
        denialReason: "parse_error",
      });
      return c.json(response, 400);
    }

    if (bodyByteLength(rawBody) > maxPostBytes) {
      return fail(c, auditLogger, correlationId, auth.context, 413, "request_too_large");
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      const response = jsonRpcError(null, -32700, "Parse error");
      emitAudit(auditLogger, {
        event: "mcp.http.request",
        correlationId,
        result: "failure",
        status: 400,
        userId: auth.context.userId,
        clientId: auth.context.clientId,
        resource: auth.context.resource,
        denialReason: "parse_error",
      });
      return c.json(response, 400);
    }

    const validation = validateJsonRpcRequest(body);
    if (!validation.ok) {
      emitAudit(auditLogger, {
        event: "mcp.http.request",
        correlationId,
        result: validation.status === 202 ? "success" : "failure",
        status: validation.status,
        userId: auth.context.userId,
        clientId: auth.context.clientId,
        resource: auth.context.resource,
        denialReason: validation.reason,
      });
      return validation.status === 202
        ? c.body(null, 202)
        : c.json(validation.response, validation.status);
    }

    const response = await server.handle(validation.request);
    emitAudit(auditLogger, {
      event: "mcp.http.request",
      correlationId,
      result: response?.error ? "failure" : "success",
      status: response ? 200 : 202,
      userId: auth.context.userId,
      clientId: auth.context.clientId,
      resource: auth.context.resource,
      method: validation.request.method,
      tool: toolName(validation.request),
      denialReason: response?.error ? "json_rpc_error" : undefined,
    });

    if (!response) return c.body(null, 202);
    return c.json(response);
  });

  return app;
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
      denialReason: "origin_not_allowed",
    });
    return {
      ok: false,
      response: c.json({ error: "forbidden", error_description: "Origin is not allowed" }, 403),
    };
  }

  const requestOrigin = new URL(c.req.url).origin;
  const token = extractBearerToken(c.req.header("Authorization"));
  if (!token) {
    c.header("WWW-Authenticate", bearerChallenge(requestOrigin));
    emitAudit(auditLogger, {
      event: "mcp.http.request",
      correlationId,
      result: "failure",
      status: 401,
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
    c.header("WWW-Authenticate", bearerChallenge(requestOrigin));
    emitAudit(auditLogger, {
      event: "mcp.http.request",
      correlationId,
      result: "failure",
      status: 503,
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
    c.header("WWW-Authenticate", bearerChallenge(requestOrigin));
    emitAudit(auditLogger, {
      event: "mcp.http.request",
      correlationId,
      result: "failure",
      status: auth.status,
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
  return typeof name === "string" ? name.slice(0, 160) : undefined;
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
