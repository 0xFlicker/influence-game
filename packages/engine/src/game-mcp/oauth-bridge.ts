#!/usr/bin/env bun
import {
  createGameMcpServer,
  type GameMcpJsonRpcServer,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./server";
import {
  MCP_OAUTH_AUDIENCE,
  MCP_OAUTH_CLIENT_ID,
  MCP_OAUTH_ISSUER,
  MCP_OAUTH_SCOPE,
  requireSafeHttpBaseUrl,
} from "./oauth";
import {
  getMcpTokenFilePath,
  loadStoredMcpAccessToken,
} from "./oauth-token-store";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:3000";

export interface McpTokenIntrospection {
  active: boolean;
  iss?: string;
  aud?: string;
  client_id?: string;
  scope?: string;
  token_type?: "Bearer";
  purpose?: string;
  exp?: number;
}

export type McpTokenIntrospector = (token: string) => Promise<McpTokenIntrospection>;

export class AuthenticatedGameMcpJsonRpcServer {
  constructor(
    private readonly inner: GameMcpJsonRpcServer,
    private readonly token: string,
    private readonly introspect: McpTokenIntrospector,
  ) {}

  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    if (request.id === undefined) {
      return null;
    }

    let tokenState: McpTokenIntrospection;
    try {
      tokenState = await this.introspect(this.token);
    } catch {
      tokenState = { active: false };
    }
    if (!isActiveGameMcpToken(tokenState)) {
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: {
          code: -32001,
          message: "Unauthorized MCP token",
        },
      };
    }

    return this.inner.handle(request);
  }
}

export function isActiveGameMcpToken(tokenState: McpTokenIntrospection): boolean {
  const scopes = tokenState.scope?.split(/\s+/).filter(Boolean) ?? [];
  const expiresInFuture = typeof tokenState.exp === "number"
    ? tokenState.exp > Math.floor(Date.now() / 1000)
    : false;
  return tokenState.active === true &&
    tokenState.iss === MCP_OAUTH_ISSUER &&
    tokenState.aud === MCP_OAUTH_AUDIENCE &&
    tokenState.client_id === MCP_OAUTH_CLIENT_ID &&
    scopes.includes(MCP_OAUTH_SCOPE) &&
    tokenState.token_type === "Bearer" &&
    tokenState.purpose === "mcp_access" &&
    expiresInFuture;
}

export function createApiTokenIntrospector(
  apiBaseUrl: URL,
  introspectionSecret: string,
): McpTokenIntrospector {
  return async (token: string) => {
    const introspectionUrl = new URL("/api/oauth/mcp/introspect", apiBaseUrl);
    const response = await fetch(introspectionUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${introspectionSecret}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token }),
    });

    if (!response.ok) {
      return { active: false };
    }

    const parsed = await response.json() as Partial<McpTokenIntrospection>;
    return {
      active: parsed.active === true,
      iss: typeof parsed.iss === "string" ? parsed.iss : undefined,
      aud: typeof parsed.aud === "string" ? parsed.aud : undefined,
      client_id: typeof parsed.client_id === "string" ? parsed.client_id : undefined,
      scope: typeof parsed.scope === "string" ? parsed.scope : undefined,
      token_type: parsed.token_type === "Bearer" ? "Bearer" : undefined,
      purpose: typeof parsed.purpose === "string" ? parsed.purpose : undefined,
      exp: typeof parsed.exp === "number" ? parsed.exp : undefined,
    };
  };
}

export function createAuthenticatedGameMcpServer(
  simulationsRoot: string,
  token: string,
  introspect: McpTokenIntrospector,
): AuthenticatedGameMcpJsonRpcServer {
  return new AuthenticatedGameMcpJsonRpcServer(
    createGameMcpServer(simulationsRoot),
    token,
    introspect,
  );
}

export async function runAuthenticatedStdioGameMcpServer(
  simulationsRoot: string,
  token: string,
  introspect: McpTokenIntrospector,
): Promise<void> {
  const server = createAuthenticatedGameMcpServer(simulationsRoot, token, introspect);
  let buffer = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        let request: JsonRpcRequest;
        try {
          request = JSON.parse(line) as JsonRpcRequest;
        } catch {
          const response: JsonRpcResponse = {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
          };
          process.stdout.write(`${JSON.stringify(response)}\n`);
          newlineIndex = buffer.indexOf("\n");
          continue;
        }
        const response = await server.handle(request);
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      }
      newlineIndex = buffer.indexOf("\n");
    }
  }
}

if (import.meta.main) {
  const simulationsRoot = process.argv[2];
  if (!simulationsRoot) {
    console.error("Usage: bun run src/game-mcp/oauth-bridge.ts <simulations-root-or-batch-dir>");
    process.exit(1);
  }

  const token = process.env.INFLUENCE_MCP_TOKEN ?? loadStoredTokenForBridge();
  if (!token) {
    console.error("INFLUENCE_MCP_TOKEN is required, or rerun mcp:game:login to save a token");
    process.exit(1);
  }

  const introspectionSecret = process.env.INFLUENCE_MCP_INTROSPECTION_SECRET;
  if (!introspectionSecret) {
    console.error("INFLUENCE_MCP_INTROSPECTION_SECRET is required");
    process.exit(1);
  }

  const apiBaseUrl = requireSafeHttpBaseUrl(
    process.env.INFLUENCE_MCP_API_BASE_URL ?? DEFAULT_API_BASE_URL,
    "INFLUENCE_MCP_API_BASE_URL",
  );

  runAuthenticatedStdioGameMcpServer(
    simulationsRoot,
    token,
    createApiTokenIntrospector(apiBaseUrl, introspectionSecret),
  ).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

function loadStoredTokenForBridge(): string | null {
  const tokenFilePath = getMcpTokenFilePath();
  try {
    const token = loadStoredMcpAccessToken(tokenFilePath);
    console.error(`[mcp-oauth] Loaded MCP token from ${tokenFilePath}`);
    return token;
  } catch (error) {
    console.error(
      `[mcp-oauth] No usable saved MCP token at ${tokenFilePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}
