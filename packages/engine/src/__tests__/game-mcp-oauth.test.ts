import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MCP_OAUTH_CLIENT_ID,
  MCP_OAUTH_ISSUER,
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  parseOAuthCallbackUrl,
  pkceS256,
  requireSafeHttpBaseUrl,
} from "../game-mcp/oauth";
import {
  AuthenticatedGameMcpJsonRpcServer,
  isActiveGameMcpToken,
} from "../game-mcp/oauth-bridge";
import {
  loadStoredMcpAccessToken,
  saveMcpOAuthToken,
} from "../game-mcp/oauth-token-store";
import { createGameMcpServer } from "../game-mcp/server";

let tempDirs: string[] = [];

function makeTempCorpus(): string {
  const dir = mkdtempSync(join(tmpdir(), "influence-game-mcp-oauth-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("Game MCP OAuth helper utilities", () => {
  const futureExp = () => Math.floor(Date.now() / 1000) + 60;
  const resourceUri = "http://127.0.0.1:3000/mcp";

  it("builds an authorization URL with PKCE S256 and resource inputs", () => {
    const authorizeUrl = buildAuthorizeUrl({
      webBaseUrl: new URL("http://localhost:3001"),
      clientId: MCP_OAUTH_CLIENT_ID,
      redirectUri: "http://127.0.0.1:34567/oauth/callback",
      resourceUri,
      state: "state-123",
      codeChallenge: "challenge-123",
    });

    expect(authorizeUrl.toString()).toStartWith("http://localhost:3001/oauth/mcp/authorize?");
    expect(authorizeUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizeUrl.searchParams.get("client_id")).toBe(MCP_OAUTH_CLIENT_ID);
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:34567/oauth/callback",
    );
    expect(authorizeUrl.searchParams.get("resource")).toBe(resourceUri);
    expect(authorizeUrl.searchParams.get("scope")).toBe("producer");
    expect(authorizeUrl.searchParams.get("state")).toBe("state-123");
    expect(authorizeUrl.searchParams.get("code_challenge")).toBe("challenge-123");
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("requires HTTPS except for explicit loopback hosts", () => {
    expect(requireSafeHttpBaseUrl("http://localhost:3001", "web").origin).toBe(
      "http://localhost:3001",
    );
    expect(requireSafeHttpBaseUrl("http://127.0.0.1:3000", "api").origin).toBe(
      "http://127.0.0.1:3000",
    );
    expect(requireSafeHttpBaseUrl("https://influence.example", "web").origin).toBe(
      "https://influence.example",
    );

    expect(() => requireSafeHttpBaseUrl("http://influence.example", "web")).toThrow(
      "web must use HTTPS outside loopback development hosts",
    );
    expect(() => requireSafeHttpBaseUrl("https://user:pass@influence.example", "web")).toThrow(
      "web must not include credentials",
    );
  });

  it("parses callbacks only when state matches", () => {
    const ok = parseOAuthCallbackUrl(
      new URL("http://127.0.0.1:34567/oauth/callback?code=abc&state=expected"),
      "expected",
    );
    expect(ok).toEqual({ code: "abc" });

    const stateMismatch = parseOAuthCallbackUrl(
      new URL("http://127.0.0.1:34567/oauth/callback?code=abc&state=wrong"),
      "expected",
    );
    expect(stateMismatch).toMatchObject({ error: "invalid_state" });

    const denied = parseOAuthCallbackUrl(
      new URL("http://127.0.0.1:34567/oauth/callback?error=access_denied&error_description=nope&state=expected"),
      "expected",
    );
    expect(denied).toEqual({ error: "access_denied", errorDescription: "nope" });
  });

  it("computes RFC-compatible S256 PKCE challenges", () => {
    expect(pkceS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("exchanges an authorization code with the resource parameter", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: string | null = null;
    globalThis.fetch = (async (
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      capturedBody = String(init?.body);
      return new Response(JSON.stringify({
        access_token: "resource-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "producer",
        audience: "game-mcp",
        purpose: "mcp_access",
        resource: "http://localhost:3000/mcp",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const token = await exchangeAuthorizationCode({
        apiBaseUrl: new URL("http://127.0.0.1:3000"),
        clientId: MCP_OAUTH_CLIENT_ID,
        code: "code-123",
        redirectUri: "http://127.0.0.1:34567/oauth/callback",
        resourceUri,
        codeVerifier: "verifier-123",
      });

      expect(token.access_token).toBe("resource-token");
      expect(token.resource).toBe("http://localhost:3000/mcp");
      const form = new URLSearchParams(capturedBody ?? "");
      expect(form.get("resource")).toBe(resourceUri);
      expect(form.get("code")).toBe("code-123");
      expect(form.get("code_verifier")).toBe("verifier-123");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("saves and reloads a short-lived MCP token from a hidden local file", () => {
    const tokenFile = join(makeTempCorpus(), ".influence-game", "mcp-token.json");
    const now = new Date("2026-06-18T12:00:00.000Z");
    const stored = saveMcpOAuthToken({
      access_token: "saved-token",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "producer",
      audience: "game-mcp",
      purpose: "mcp_access",
      resource: resourceUri,
    }, tokenFile, now);

    expect(stored.expiresAt).toBe("2026-06-18T13:00:00.000Z");
    expect(loadStoredMcpAccessToken(tokenFile, now)).toBe("saved-token");
    expect((statSync(tokenFile).mode & 0o777).toString(8)).toBe("600");
    expect(() => loadStoredMcpAccessToken(
      tokenFile,
      new Date("2026-06-18T13:00:00.000Z"),
    )).toThrow("Saved MCP token is expired");
  });

  it("accepts only active global game MCP token metadata", () => {
    expect(isActiveGameMcpToken({
      active: true,
      iss: MCP_OAUTH_ISSUER,
      aud: "game-mcp",
      client_id: MCP_OAUTH_CLIENT_ID,
      scope: "producer",
      token_type: "Bearer",
      purpose: "mcp_access",
      exp: futureExp(),
    })).toBe(true);

    expect(isActiveGameMcpToken({
      active: true,
      iss: MCP_OAUTH_ISSUER,
      aud: "trace-mcp",
      client_id: MCP_OAUTH_CLIENT_ID,
      scope: "producer",
      token_type: "Bearer",
      purpose: "mcp_access",
      exp: futureExp(),
    })).toBe(false);
    expect(isActiveGameMcpToken({
      active: false,
      iss: MCP_OAUTH_ISSUER,
      aud: "game-mcp",
      client_id: MCP_OAUTH_CLIENT_ID,
      scope: "producer",
      token_type: "Bearer",
      purpose: "mcp_access",
      exp: futureExp(),
    })).toBe(false);
    expect(isActiveGameMcpToken({
      active: true,
      iss: MCP_OAUTH_ISSUER,
      aud: "game-mcp",
      client_id: "wrong-client",
      scope: "producer",
      token_type: "Bearer",
      purpose: "mcp_access",
      exp: futureExp(),
    })).toBe(false);
    expect(isActiveGameMcpToken({
      active: true,
      iss: MCP_OAUTH_ISSUER,
      aud: "game-mcp",
      client_id: MCP_OAUTH_CLIENT_ID,
      scope: "producer",
      token_type: "Bearer",
      purpose: "mcp_access",
      exp: Math.floor(Date.now() / 1000) - 1,
    })).toBe(false);
  });

  it("introspects before delegating to the existing Game MCP server", async () => {
    const corpus = makeTempCorpus();
    let calls = 0;
    const server = new AuthenticatedGameMcpJsonRpcServer(
      createGameMcpServer(corpus),
      "token",
      async () => {
        calls += 1;
        return {
          active: true,
          iss: MCP_OAUTH_ISSUER,
          aud: "game-mcp",
          client_id: MCP_OAUTH_CLIENT_ID,
          scope: "producer",
          token_type: "Bearer",
          purpose: "mcp_access",
          exp: futureExp(),
        };
      },
    );

    const response = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    expect(calls).toBe(1);
    expect(response?.error).toBeUndefined();
    expect(response?.result).toMatchObject({
      protocolVersion: "2025-06-18",
      serverInfo: { name: "influence-game-log" },
    });
  });

  it("rejects inactive MCP tokens before the read model handles the request", async () => {
    const corpus = makeTempCorpus();
    const server = new AuthenticatedGameMcpJsonRpcServer(
      createGameMcpServer(corpus),
      "token",
      async () => ({ active: false }),
    );

    const response = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32001,
        message: "Unauthorized MCP token",
      },
    });
  });

  it("rejects introspection failures before the read model handles the request", async () => {
    const corpus = makeTempCorpus();
    const server = new AuthenticatedGameMcpJsonRpcServer(
      createGameMcpServer(corpus),
      "token",
      async () => {
        throw new Error("introspection unavailable");
      },
    );

    const response = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32001,
        message: "Unauthorized MCP token",
      },
    });
  });
});
