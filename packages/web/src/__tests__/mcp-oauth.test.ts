import { describe, expect, it } from "bun:test";
import {
  MCP_OAUTH_CLIENT_ID,
  buildMcpOAuthAuthorizeBody,
  parseMcpOAuthSearchParams,
} from "../lib/mcp-oauth";

describe("parseMcpOAuthSearchParams", () => {
  it("parses a complete authorization-code request", () => {
    const result = parseMcpOAuthSearchParams(new URLSearchParams({
      response_type: "code",
      client_id: MCP_OAUTH_CLIENT_ID,
      redirect_uri: "http://127.0.0.1:34567/oauth/callback",
      scope: "mcp",
      state: "state-123",
      code_challenge: "challenge-123",
      code_challenge_method: "S256",
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request).toEqual({
      response_type: "code",
      client_id: MCP_OAUTH_CLIENT_ID,
      redirect_uri: "http://127.0.0.1:34567/oauth/callback",
      scope: "mcp",
      state: "state-123",
      code_challenge: "challenge-123",
      code_challenge_method: "S256",
    });
  });

  it("reports missing required parameters", () => {
    const result = parseMcpOAuthSearchParams(new URLSearchParams({
      response_type: "code",
      client_id: MCP_OAUTH_CLIENT_ID,
    }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toEqual([
      "redirect_uri",
      "scope",
      "state",
      "code_challenge",
      "code_challenge_method",
    ]);
  });

  it("rejects non-S256 requests before contacting the API", () => {
    const result = parseMcpOAuthSearchParams(new URLSearchParams({
      response_type: "code",
      client_id: MCP_OAUTH_CLIENT_ID,
      redirect_uri: "http://127.0.0.1:34567/oauth/callback",
      scope: "mcp",
      state: "state-123",
      code_challenge: "challenge-123",
      code_challenge_method: "plain",
    }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("The OAuth request must use PKCE S256.");
  });
});

describe("buildMcpOAuthAuthorizeBody", () => {
  it("preserves the OAuth request while adding the user's decision", () => {
    const parsed = parseMcpOAuthSearchParams(new URLSearchParams({
      response_type: "code",
      client_id: MCP_OAUTH_CLIENT_ID,
      redirect_uri: "http://127.0.0.1:34567/oauth/callback",
      scope: "mcp",
      state: "state-123",
      code_challenge: "challenge-123",
      code_challenge_method: "S256",
    }));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(buildMcpOAuthAuthorizeBody(parsed.request, "approve")).toMatchObject({
      ...parsed.request,
      decision: "approve",
    });
  });
});
