import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  createMcpRoutes,
  type GameMcpAuditEvent,
} from "../routes/mcp.js";
import { schema, type DrizzleDB } from "../db/index.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { createSessionToken } from "../middleware/auth.js";
import type {
  JsonRpcRequest,
  ProductionGameMcpJsonRpcServer,
} from "../game-mcp/server.js";
import type { GameMcpAuthResult } from "../game-mcp/auth.js";
import {
  MCP_OAUTH_AUDIENCE,
  MCP_OAUTH_CLIENT_ID,
  MCP_OAUTH_PURPOSE,
  hashOpaqueSecret,
} from "../services/mcp-oauth.js";
import { setupTestDB } from "./test-utils.js";

const MCP_OAUTH_DEFAULT_READ_SCOPE = "agents:read games:read";
const MCP_OAUTH_AGENT_READ_SCOPE = "agents:read";
const MCP_OAUTH_FULL_USER_SCOPE = "agents:read agents:write games:read";
const MCP_OAUTH_ALL_SCOPE = "agents:read agents:write games:read producer";
const MCP_OAUTH_SCOPE = "producer";
const RESOURCE_URI = "http://127.0.0.1:3000/mcp";
const PRODUCER_RESOURCE_URI = RESOURCE_URI;

beforeAll(() => {
  process.env.JWT_SECRET = "test-jwt-secret-mcp-http";
  process.env.MCP_OAUTH_RESOURCE_URI = RESOURCE_URI;
  process.env.MCP_ALLOWED_ORIGINS = "";
});

describe("/mcp Streamable HTTP route", () => {
  test("returns a full-scope OAuth bearer challenge when auth is missing", async () => {
    const auditEvents: GameMcpAuditEvent[] = [];
    const app = createTestApp({}, {
      auditLogger: (event) => auditEvents.push(event),
    });
    const response = await app.request("/mcp", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      "/.well-known/oauth-protected-resource",
    );
    expect(response.headers.get("www-authenticate")).toContain(
      `scope="${MCP_OAUTH_ALL_SCOPE}"`,
    );
    expect(auditEvents).toContainEqual(expect.objectContaining({
      result: "failure",
      status: 401,
      denialReason: "missing_bearer_token",
    }));
  });

  test("derives the OAuth bearer challenge from the canonical MCP resource origin", async () => {
    const previousResource = process.env.MCP_OAUTH_RESOURCE_URI;
    process.env.MCP_OAUTH_RESOURCE_URI = "https://influence-staging.example/mcp";

    try {
      const app = createTestApp();
      const response = await app.request("http://internal-caddy/mcp", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        'resource_metadata="https://influence-staging.example/.well-known/oauth-protected-resource/mcp"',
      );
    } finally {
      restoreOptionalEnv("MCP_OAUTH_RESOURCE_URI", previousResource);
    }
  });

  test("does not register /mcp/producer as an active resource", async () => {
    const app = createTestApp();
    const response = await app.request("/mcp/producer", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });

    expect(response.status).toBe(404);
  });

  test("rejects bearer tokens in query strings before dispatch", async () => {
    const calls: string[] = [];
    const app = createTestApp({
      handle: async () => {
        calls.push("dispatched");
        return null;
      },
    });
    const response = await app.request("/mcp?access_token=secret", {
      method: "POST",
      headers: jsonHeaders({ Authorization: "Bearer good-token" }),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });

    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  test("rejects unapproved browser origins before dispatch", async () => {
    const calls: string[] = [];
    const app = createTestApp({
      handle: async () => {
        calls.push("dispatched");
        return null;
      },
    });
    const response = await app.request("/mcp", {
      method: "POST",
      headers: jsonHeaders({
        Authorization: "Bearer good-token",
        Origin: "https://example.com",
      }),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });

    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });

  test("dispatches one authenticated JSON-RPC request", async () => {
    const calls: string[] = [];
    const app = createTestApp({
      handle: async (request) => {
        calls.push(request.method);
        return { jsonrpc: "2.0", id: request.id ?? null, result: { ok: true } };
      },
    });
    const response = await app.request("/mcp", {
      method: "POST",
      headers: jsonHeaders({ Authorization: "Bearer good-token" }),
      body: JSON.stringify({ jsonrpc: "2.0", id: "init", method: "initialize" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: "init",
      result: { ok: true },
    });
    expect(calls).toEqual(["initialize"]);
  });

  test("audits JSON-RPC failures without raw error messages", async () => {
    const auditEvents: GameMcpAuditEvent[] = [];
    const app = createTestApp({
      handle: async (request) => ({
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: { code: -32000, message: "storage bucket private-key-detail leaked" },
      }),
    }, {
      auditLogger: (event) => auditEvents.push(event),
    });
    const response = await app.request("/mcp", {
      method: "POST",
      headers: jsonHeaders({ Authorization: "Bearer good-token" }),
      body: JSON.stringify({ jsonrpc: "2.0", id: "trace", method: "tools/call" }),
    });

    expect(response.status).toBe(200);
    expect(auditEvents).toContainEqual(expect.objectContaining({
      result: "failure",
      status: 200,
      tool: "unknown_tool",
      denialReason: "json_rpc_error",
    }));
    expect(JSON.stringify(auditEvents)).not.toContain("private-key-detail");
  });

  test("audits insufficient-scope tool results as bounded failures", async () => {
    const auditEvents: GameMcpAuditEvent[] = [];
    const privateChallenge = [
      "Bearer resource_metadata=\"https://chatgpt.com/connector_platform_oauth_redirect\",",
      "scope=\"agents:read agents:write\", error=\"insufficient_scope\",",
      "error_description=\"private authorization detail\", token=\"secret-token\"",
    ].join(" ");
    const app = createTestApp({
      handle: async (request) => ({
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: {
          isError: true,
          content: [{ type: "text", text: "private authorization detail" }],
          _meta: { "mcp/www_authenticate": [privateChallenge] },
        },
      }),
    }, {
      auditLogger: (event) => auditEvents.push(event),
    });

    const response = await app.request("/mcp", {
      method: "POST",
      headers: jsonHeaders({ Authorization: "Bearer good-token" }),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "step-up",
        method: "tools/call",
        params: { name: "update_agent", arguments: {} },
      }),
    });

    expect(response.status).toBe(200);
    expect(auditEvents).toContainEqual(expect.objectContaining({
      result: "failure",
      status: 200,
      tool: "update_agent",
      denialReason: "insufficient_scope",
    }));
    const serializedAudit = JSON.stringify(auditEvents);
    expect(serializedAudit).not.toContain("mcp/www_authenticate");
    expect(serializedAudit).not.toContain("connector_platform_oauth_redirect");
    expect(serializedAudit).not.toContain("secret-token");
    expect(serializedAudit).not.toContain("private authorization detail");
  });

  test("audits ordinary errored tool results without trusting result fields", async () => {
    const auditEvents: GameMcpAuditEvent[] = [];
    const app = createTestApp({
      handle: async (request) => ({
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: {
          isError: true,
          denialReason: "attacker_controlled",
          content: [{ type: "text", text: "database row and stack trace" }],
          _meta: {
            denialReason: "attacker_meta_value",
            "mcp/www_authenticate": ["https://evil.example/callback?code=private-code"],
            callbackUri: "https://evil.example/callback?code=private-code",
            accessToken: "private-access-token",
          },
        },
      }),
    }, {
      auditLogger: (event) => auditEvents.push(event),
    });

    const response = await app.request("/mcp", {
      method: "POST",
      headers: jsonHeaders({ Authorization: "Bearer good-token" }),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "domain-error",
        method: "tools/call",
        params: { name: "update_agent", arguments: {} },
      }),
    });

    expect(response.status).toBe(200);
    expect(auditEvents).toContainEqual(expect.objectContaining({
      result: "failure",
      status: 200,
      tool: "update_agent",
      denialReason: "tool_error",
    }));
    const serializedAudit = JSON.stringify(auditEvents);
    expect(serializedAudit).not.toContain("attacker_controlled");
    expect(serializedAudit).not.toContain("attacker_meta_value");
    expect(serializedAudit).not.toContain("database row and stack trace");
    expect(serializedAudit).not.toContain("evil.example");
    expect(serializedAudit).not.toContain("private-code");
    expect(serializedAudit).not.toContain("private-access-token");
  });

  test("audits successful retried tool calls as success with the canonical name", async () => {
    const auditEvents: GameMcpAuditEvent[] = [];
    const app = createTestApp({
      handle: async (request) => ({
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: { content: [{ type: "text", text: "updated" }] },
      }),
    }, {
      auditLogger: (event) => auditEvents.push(event),
    });

    const response = await app.request("/mcp", {
      method: "POST",
      headers: jsonHeaders({ Authorization: "Bearer good-token" }),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "authorized-retry",
        method: "tools/call",
        params: { name: "update_agent", arguments: {} },
      }),
    });

    expect(response.status).toBe(200);
    expect(auditEvents).toContainEqual(expect.objectContaining({
      result: "success",
      status: 200,
      tool: "update_agent",
      denialReason: undefined,
    }));
  });

  test("audits eligibility internal errors without dependency details", async () => {
    const auditEvents: GameMcpAuditEvent[] = [];
    const app = createTestApp({
      handle: async (request) => ({
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: {
          code: -32603,
          message: "Internal error: postgres role lookup private failure",
          data: { stack: "private database stack" },
        },
      }),
    }, {
      auditLogger: (event) => auditEvents.push(event),
    });

    const response = await app.request("/mcp", {
      method: "POST",
      headers: jsonHeaders({ Authorization: "Bearer good-token" }),
      body: JSON.stringify({ jsonrpc: "2.0", id: "eligibility-error", method: "tools/list" }),
    });

    expect(response.status).toBe(200);
    expect(auditEvents).toContainEqual(expect.objectContaining({
      result: "failure",
      status: 200,
      denialReason: "internal_error",
    }));
    const serializedAudit = JSON.stringify(auditEvents);
    expect(serializedAudit).not.toContain("postgres role lookup");
    expect(serializedAudit).not.toContain("private database stack");
  });

  test("uses one bounded audit sentinel for hostile unknown tool names", async () => {
    const hostileNames: unknown[] = [
      "definitely_unknown",
      { injected: true },
      ["list_games"],
      "x".repeat(2_000),
      "quoted\"\n\u0000control",
      "Bearer private-token-value",
      "https://evil.example/callback?code=private-code",
    ];
    const auditEvents: GameMcpAuditEvent[] = [];
    const app = createTestApp({
      handle: async (request) => ({
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: { code: -32000, message: "Unknown or unauthorized MCP tool" },
      }),
    }, {
      auditLogger: (event) => auditEvents.push(event),
    });

    for (const [index, name] of hostileNames.entries()) {
      const response = await app.request("/mcp", {
        method: "POST",
        headers: jsonHeaders({ Authorization: "Bearer good-token" }),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `hostile-${index}`,
          method: "tools/call",
          params: { name, arguments: {} },
        }),
      });
      expect(response.status).toBe(200);
    }

    const toolEvents = auditEvents.filter((event) => event.method === "tools/call");
    expect(toolEvents).toHaveLength(hostileNames.length);
    expect(toolEvents.every((event) => event.tool === "unknown_tool")).toBe(true);
    const serializedAudit = JSON.stringify(auditEvents);
    expect(serializedAudit).not.toContain("definitely_unknown");
    expect(serializedAudit).not.toContain("quoted");
    expect(serializedAudit).not.toContain("private-token-value");
    expect(serializedAudit).not.toContain("evil.example");
    expect(serializedAudit).not.toContain("private-code");
    expect(serializedAudit).not.toContain("x".repeat(160));
  });

  test("audits MCP App stages and provider hints without changing authorization", async () => {
    const auditEvents: GameMcpAuditEvent[] = [];
    const app = createTestApp({
      handle: async (request) => ({
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: { ok: true },
      }),
    }, {
      auditLogger: (event) => auditEvents.push(event),
    });

    await app.request("/mcp", {
      method: "POST",
      headers: jsonHeaders({
        Authorization: "Bearer good-token",
        "x-mcp-app-provider": "grok",
      }),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "app-resource",
        method: "resources/read",
        params: { uri: "ui://influence/app" },
      }),
    });
    await app.request("/mcp", {
      method: "POST",
      headers: jsonHeaders({
        Authorization: "Bearer good-token",
        "x-mcp-app-provider": "grok",
      }),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "list-games",
        method: "tools/call",
        params: { name: "list_games", arguments: { limit: 5 } },
      }),
    });

    expect(auditEvents).toContainEqual(expect.objectContaining({
      providerId: "grok",
      appStage: "app_resource_fetch",
      appResourceUri: "ui://influence/app",
      method: "resources/read",
    }));
    expect(auditEvents).toContainEqual(expect.objectContaining({
      providerId: "grok",
      method: "tools/call",
      tool: "list_games",
      appStage: undefined,
    }));
  });

  test("rejects unsupported protocol versions before dispatch", async () => {
    const calls: string[] = [];
    const app = createTestApp({
      handle: async () => {
        calls.push("dispatched");
        return null;
      },
    });
    const response = await app.request("/mcp", {
      method: "POST",
      headers: jsonHeaders({
        Authorization: "Bearer good-token",
        "MCP-Protocol-Version": "1999-01-01",
      }),
      body: JSON.stringify({ jsonrpc: "2.0", id: "init", method: "initialize" }),
    });

    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  test("fails closed when token validation throws", async () => {
    const auditEvents: Array<{ status: number; denialReason?: string }> = [];
    const app = createTestApp({}, {
      auditLogger: (event) => auditEvents.push(event),
      tokenValidator: async () => {
        throw new Error("database unavailable");
      },
    });
    const response = await app.request("/mcp", {
      method: "POST",
      headers: jsonHeaders({ Authorization: "Bearer good-token" }),
      body: JSON.stringify({ jsonrpc: "2.0", id: "init", method: "initialize" }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "server_error",
      error_description: "MCP bearer token validation failed",
    });
    expect(response.headers.get("www-authenticate")).toContain(
      "/.well-known/oauth-protected-resource",
    );
    expect(auditEvents).toContainEqual(expect.objectContaining({
      status: 503,
      denialReason: "token_validation_error",
    }));
  });

  test("rejects oversized request bodies by actual byte length before dispatch", async () => {
    const calls: string[] = [];
    const app = createTestApp({
      handle: async () => {
        calls.push("dispatched");
        return null;
      },
    }, { maxPostBytes: 16 });
    const response = await app.request("/mcp", {
      method: "POST",
      headers: jsonHeaders({ Authorization: "Bearer good-token" }),
      body: JSON.stringify({ jsonrpc: "2.0", id: "init", method: "initialize" }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "request_too_large" });
    expect(calls).toEqual([]);
  });

  test("accepts JSON-RPC notifications with 202", async () => {
    const app = createTestApp({
      handle: async () => null,
    });
    const response = await app.request("/mcp", {
      method: "POST",
      headers: jsonHeaders({ Authorization: "Bearer good-token" }),
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });

    expect(response.status).toBe(202);
  });

  test("accepts JSON-RPC response objects with 202", async () => {
    const calls: string[] = [];
    const app = createTestApp({
      handle: async (request) => {
        calls.push(request.method);
        return null;
      },
    });

    const resultResponse = await app.request("/mcp", {
      method: "POST",
      headers: jsonHeaders({ Authorization: "Bearer good-token" }),
      body: JSON.stringify({ jsonrpc: "2.0", id: "client-result", result: { ok: true } }),
    });
    const errorResponse = await app.request("/mcp", {
      method: "POST",
      headers: jsonHeaders({ Authorization: "Bearer good-token" }),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "client-error",
        error: { code: -32000, message: "client failed" },
      }),
    });

    expect(resultResponse.status).toBe(202);
    expect(errorResponse.status).toBe(202);
    expect(calls).toEqual([]);
  });

  test("GET authenticates and then returns method not allowed", async () => {
    const app = createTestApp();
    const response = await app.request("/mcp", {
      method: "GET",
      headers: { Authorization: "Bearer good-token" },
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  describe("with DB-backed bearer validation", () => {
    let db: DrizzleDB;

    beforeEach(async () => {
      db = await setupTestDB();
      await seedRBAC(db);
    });

    test("dispatches requests with an active MCP access token", async () => {
      const issued = await issueMcpAccessToken(db, { walletAddress: "0xmcphttp00000000000000000000000000000001" });
      const calls: string[] = [];
      const auditEvents: Array<{
        status: number;
        userId?: string;
        clientId?: string;
        resource?: string;
        scope?: string;
        authProfile?: string;
      }> = [];
      const app = createDbBackedTestApp(
        db,
        {
          handle: async (request) => {
            calls.push(request.method);
            return { jsonrpc: "2.0", id: request.id ?? null, result: { ok: true } };
          },
        },
        (event) => auditEvents.push(event),
      );

      const response = await app.request("/mcp", {
        method: "POST",
        headers: jsonHeaders({ Authorization: `Bearer ${issued.accessToken}` }),
        body: JSON.stringify({ jsonrpc: "2.0", id: "init", method: "initialize" }),
      });

      expect(response.status).toBe(200);
      expect(calls).toEqual(["initialize"]);
      expect(auditEvents).toContainEqual(expect.objectContaining({
        status: 200,
        userId: issued.userId,
        clientId: MCP_OAUTH_CLIENT_ID,
        resource: RESOURCE_URI,
        scope: MCP_OAUTH_DEFAULT_READ_SCOPE,
        authProfile: "subject",
      }));

      const tokenRow = (await db
        .select({ lastUsedAt: schema.mcpOauthAccessTokens.lastUsedAt })
        .from(schema.mcpOauthAccessTokens)
        .where(eq(schema.mcpOauthAccessTokens.tokenHash, hashOpaqueSecret(issued.accessToken))))[0];
      expect(tokenRow?.lastUsedAt).toBeTruthy();
    });

    test("accepts active local tokens bound to an equivalent loopback resource alias", async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      const previousResource = process.env.MCP_OAUTH_RESOURCE_URI;
      process.env.NODE_ENV = "development";
      process.env.MCP_OAUTH_RESOURCE_URI = "http://localhost:3000/mcp";

      try {
        const issued = await issueMcpAccessToken(db, {
          walletAddress: "0xmcphttp00000000000000000000000000000008",
          resourceUri: "http://127.0.0.1:3000/mcp",
        });
        const app = createDbBackedTestApp(db);

        const response = await app.request("/mcp", {
          method: "POST",
          headers: jsonHeaders({ Authorization: `Bearer ${issued.accessToken}` }),
          body: JSON.stringify({ jsonrpc: "2.0", id: "init", method: "initialize" }),
        });

        expect(response.status).toBe(200);
      } finally {
        restoreOptionalEnv("NODE_ENV", previousNodeEnv);
        restoreOptionalEnv("MCP_OAUTH_RESOURCE_URI", previousResource);
      }
    });

    test("rejects inactive DB token states before dispatch", async () => {
      const revoked = await issueMcpAccessToken(db, {
        walletAddress: "0xmcphttp00000000000000000000000000000002",
        revokedAt: "2026-06-19T00:00:00.000Z",
      });
      const expired = await issueMcpAccessToken(db, {
        walletAddress: "0xmcphttp00000000000000000000000000000003",
        expiresAt: "2020-01-01T00:00:00.000Z",
      });
      const wrongResource = await issueMcpAccessToken(db, {
        walletAddress: "0xmcphttp00000000000000000000000000000004",
        resourceUri: "https://example.com/mcp",
      });

      const appSessionUserId = await insertUser(db, "0xmcphttp00000000000000000000000000000006");
      const appSessionToken = await createSessionToken(appSessionUserId, {
        roles: ["producer"],
      });

      const scenarios = [
        { name: "unknown token", token: "not-a-stored-mcp-token" },
        { name: "revoked token", token: revoked.accessToken },
        { name: "expired token", token: expired.accessToken },
        { name: "wrong resource token", token: wrongResource.accessToken },
        { name: "app session token", token: appSessionToken },
      ];
      const calls: string[] = [];
      const app = createDbBackedTestApp(db, {
        handle: async (request) => {
          calls.push(request.method);
          return { jsonrpc: "2.0", id: request.id ?? null, result: { ok: true } };
        },
      });

      for (const scenario of scenarios) {
        const response = await app.request("/mcp", {
          method: "POST",
          headers: jsonHeaders({ Authorization: `Bearer ${scenario.token}` }),
          body: JSON.stringify({ jsonrpc: "2.0", id: scenario.name, method: "initialize" }),
        });

        expect({ name: scenario.name, status: response.status }).toEqual({
          name: scenario.name,
          status: 401,
        });
        expect(await response.json()).toMatchObject({
          error: "invalid_token",
          error_description: "inactive_token",
        });
      }
      expect(calls).toEqual([]);
    });

    test("revalidates dynamic client deletion and envelope narrowing in the real MCP chain", async () => {
      const clientId = "influence-game-mcp-client-http-eligibility";
      await db.insert(schema.mcpOauthClients).values({
        clientId,
        redirectUris: ["http://127.0.0.1:43124/callback"],
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        scope: MCP_OAUTH_FULL_USER_SCOPE,
        tokenEndpointAuthMethod: "none",
      });
      const issued = await issueMcpAccessToken(db, {
        walletAddress: "0xmcphttp00000000000000000000000000000009",
        clientId,
        scope: MCP_OAUTH_FULL_USER_SCOPE,
      });
      const app = createMcpRoutes(db);
      const request = (id: string, method: string, params?: unknown) =>
        app.request("/mcp", {
          method: "POST",
          headers: jsonHeaders({ Authorization: `Bearer ${issued.accessToken}` }),
          body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        });

      const listed = await request("listed", "tools/list");
      expect(listed.status).toBe(200);
      expect(JSON.stringify(await listed.json())).toContain("create_agent");

      await db.update(schema.mcpOauthClients)
        .set({ scope: "games:read" })
        .where(eq(schema.mcpOauthClients.clientId, clientId));
      const narrowed = await request("narrowed", "tools/call", {
        name: "list_archetypes",
        arguments: {
          clientId: MCP_OAUTH_CLIENT_ID,
          securitySchemes: [{ scopes: ["agents:read"] }],
        },
      });
      expect(narrowed.status).toBe(200);
      expect(await narrowed.json()).toMatchObject({
        error: {
          code: -32000,
          message: "Unknown or unauthorized MCP tool",
        },
      });

      await db.delete(schema.mcpOauthClients)
        .where(eq(schema.mcpOauthClients.clientId, clientId));
      const deleted = await request("deleted", "tools/list");
      expect(deleted.status).toBe(200);
      expect(await deleted.json()).toMatchObject({
        result: { tools: [] },
      });
    });

    test("returns eligible agent-write challenges over HTTP without mutating", async () => {
      const issued = await issueMcpAccessToken(db, {
        walletAddress: "0xmcphttp00000000000000000000000000000010",
        scope: MCP_OAUTH_AGENT_READ_SCOPE,
      });
      const auditEvents: GameMcpAuditEvent[] = [];
      const app = createMcpRoutes(db, {
        auditLogger: (event) => auditEvents.push(event),
      });

      for (const name of ["create_agent", "update_agent", "join_queue", "leave_queue"]) {
        const response = await app.request("/mcp", {
          method: "POST",
          headers: jsonHeaders({ Authorization: `Bearer ${issued.accessToken}` }),
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: name,
            method: "tools/call",
            params: { name, arguments: { ignoredUntilAuthorized: true } },
          }),
        });

        expect(response.status).toBe(200);
        const body = await response.json() as {
          result?: {
            isError?: boolean;
            _meta?: Record<string, unknown>;
          };
          error?: unknown;
        };
        expect(body.error).toBeUndefined();
        expect(body.result?.isError).toBe(true);
        const challenges = body.result?._meta?.["mcp/www_authenticate"];
        expect(challenges).toEqual([expect.any(String)]);
        expect((challenges as string[])[0]).toContain(
          'scope="agents:read agents:write"',
        );
      }

      expect(await db.select().from(schema.agentProfiles)).toEqual([]);
      expect(auditEvents).toHaveLength(4);
      expect(auditEvents.every((event) =>
        event.result === "failure" &&
        event.status === 200 &&
        event.denialReason === "insufficient_scope"
      )).toBe(true);
      expect(auditEvents.map((event) => event.tool)).toEqual([
        "create_agent",
        "update_agent",
        "join_queue",
        "leave_queue",
      ]);
      const serializedAudit = JSON.stringify(auditEvents);
      expect(serializedAudit).not.toContain("mcp/www_authenticate");
      expect(serializedAudit).not.toContain("resource_metadata");
    });

    test("accepts producer tokens on /mcp and invalidates them after role removal", async () => {
      const producer = await issueMcpAccessToken(db, {
        walletAddress: "0xmcphttp00000000000000000000000000000005",
        resourceUri: PRODUCER_RESOURCE_URI,
        scope: MCP_OAUTH_SCOPE,
        requiresMcpRole: true,
      });
      const games = await issueMcpAccessToken(db, {
        walletAddress: "0xmcphttp00000000000000000000000000000007",
      });
      const app = createDbBackedTestApp(db);

      const producerOk = await app.request("/mcp", {
        method: "POST",
        headers: jsonHeaders({ Authorization: `Bearer ${producer.accessToken}` }),
        body: JSON.stringify({ jsonrpc: "2.0", id: "producer-ok", method: "initialize" }),
      });
      expect(producerOk.status).toBe(200);

      const gamesWrongResource = await app.request("/mcp/producer", {
        method: "POST",
        headers: jsonHeaders({ Authorization: `Bearer ${games.accessToken}` }),
        body: JSON.stringify({ jsonrpc: "2.0", id: "games-wrong-boundary", method: "initialize" }),
      });
      expect(gamesWrongResource.status).toBe(404);

      await revokeMcpRole(db, producer.walletAddress);
      const roleRemoved = await app.request("/mcp", {
        method: "POST",
        headers: jsonHeaders({ Authorization: `Bearer ${producer.accessToken}` }),
        body: JSON.stringify({ jsonrpc: "2.0", id: "role-removed", method: "initialize" }),
      });

      expect(roleRemoved.status).toBe(401);
      expect(roleRemoved.headers.get("www-authenticate")).toContain(
        'scope="agents:read games:read"',
      );
      expect(await roleRemoved.json()).toMatchObject({
        error: "invalid_token",
        error_description: "inactive_token",
      });
    });
  });
});

function createTestApp(
  serverOverrides: Partial<ProductionGameMcpJsonRpcServer> = {},
  options: {
    auditLogger?: (event: GameMcpAuditEvent) => void;
    maxPostBytes?: number;
    tokenValidator?: () => Promise<GameMcpAuthResult>;
  } = {},
) {
  return createMcpRoutes({} as DrizzleDB, {
    server: {
      handle: async (request: JsonRpcRequest) => ({
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: { method: request.method },
      }),
      ...serverOverrides,
    } as unknown as ProductionGameMcpJsonRpcServer,
    tokenValidator: options.tokenValidator ?? (async (): Promise<GameMcpAuthResult> => ({
      ok: true,
      context: {
        userId: "user-1",
        clientId: "influence-game-mcp-local",
        resource: RESOURCE_URI,
        scope: MCP_OAUTH_DEFAULT_READ_SCOPE,
        scopes: ["agents:read", "games:read"],
        authProfile: "subject",
        expiresAt: 1_800_000_000,
      },
    })),
    auditLogger: options.auditLogger ?? (() => undefined),
    maxPostBytes: options.maxPostBytes,
  });
}

function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...extra,
  };
}

function restoreOptionalEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function createDbBackedTestApp(
  db: DrizzleDB,
  serverOverrides: Partial<ProductionGameMcpJsonRpcServer> = {},
  auditLogger: (event: GameMcpAuditEvent) => void = () => undefined,
) {
  return createMcpRoutes(db, {
    server: {
      handle: async (request: JsonRpcRequest) => ({
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: { method: request.method },
      }),
      ...serverOverrides,
    } as unknown as ProductionGameMcpJsonRpcServer,
    auditLogger,
  });
}

async function issueMcpAccessToken(
  db: DrizzleDB,
  params: {
    walletAddress: string;
    expiresAt?: string;
    resourceUri?: string;
    revokedAt?: string;
    scope?:
      | typeof MCP_OAUTH_AGENT_READ_SCOPE
      | typeof MCP_OAUTH_DEFAULT_READ_SCOPE
      | typeof MCP_OAUTH_FULL_USER_SCOPE
      | typeof MCP_OAUTH_SCOPE;
    clientId?: string;
    requiresMcpRole?: boolean;
  },
): Promise<{ accessToken: string; userId: string; walletAddress: string }> {
  const walletAddress = params.walletAddress.toLowerCase();
  const userId = await insertUser(db, walletAddress);
  if (params.requiresMcpRole) {
    await assignMcpRole(db, walletAddress);
  }
  const accessToken = `raw-mcp-token-${randomUUID()}`;
  await db.insert(schema.mcpOauthAccessTokens).values({
    id: randomUUID(),
    tokenHash: hashOpaqueSecret(accessToken),
    userId,
    walletAddress,
    clientId: params.clientId ?? MCP_OAUTH_CLIENT_ID,
    resourceUri: params.resourceUri ?? RESOURCE_URI,
    scope: params.scope ?? MCP_OAUTH_DEFAULT_READ_SCOPE,
    audience: MCP_OAUTH_AUDIENCE,
    purpose: MCP_OAUTH_PURPOSE,
    expiresAt: params.expiresAt ?? "2099-01-01T00:00:00.000Z",
    revokedAt: params.revokedAt,
  });
  return { accessToken, userId, walletAddress };
}

async function insertUser(db: DrizzleDB, walletAddress: string): Promise<string> {
  const userId = randomUUID();
  await db.insert(schema.users).values({
    id: userId,
    walletAddress: walletAddress.toLowerCase(),
    displayName: "MCP HTTP tester",
  });
  return userId;
}

async function assignMcpRole(db: DrizzleDB, walletAddress: string): Promise<void> {
  const role = (await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.name, "producer")))[0];
  if (!role) throw new Error("Missing producer role");
  await db.insert(schema.addressRoles).values({
    walletAddress: walletAddress.toLowerCase(),
    roleId: role.id,
    grantedBy: "test",
  });
}

async function revokeMcpRole(db: DrizzleDB, walletAddress: string): Promise<void> {
  const role = (await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.name, "producer")))[0];
  if (!role) throw new Error("Missing producer role");
  await db
    .delete(schema.addressRoles)
    .where(eq(schema.addressRoles.walletAddress, walletAddress.toLowerCase()));
}
