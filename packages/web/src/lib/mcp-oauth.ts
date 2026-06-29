export const MCP_OAUTH_CLIENT_ID = "influence-game-mcp-local";
export const MCP_OAUTH_GAMES_SCOPE = "games";
export const MCP_OAUTH_PRODUCER_SCOPE = "mcp";
export const MCP_OAUTH_SCOPE = MCP_OAUTH_GAMES_SCOPE;

export interface McpOAuthAuthorizeRequest {
  response_type: "code";
  client_id: string;
  redirect_uri: string;
  resource?: string;
  scope: string;
  state: string;
  code_challenge: string;
  code_challenge_method: "S256";
}

export type McpOAuthDecision = "inspect" | "approve" | "deny" | "cancel";

export type McpOAuthParseResult =
  | { ok: true; request: McpOAuthAuthorizeRequest }
  | { ok: false; missing: string[]; message: string };

const REQUIRED_QUERY_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
] as const;

export function parseMcpOAuthSearchParams(
  params: URLSearchParams,
): McpOAuthParseResult {
  const resource = params.get("resource")?.trim();
  const values = Object.fromEntries(
    REQUIRED_QUERY_PARAMS.map((key) => [key, params.get(key)?.trim() ?? ""]),
  ) as Record<(typeof REQUIRED_QUERY_PARAMS)[number], string>;

  const missing = REQUIRED_QUERY_PARAMS.filter((key) => values[key].length === 0);
  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      message: "The OAuth request is missing required parameters.",
    };
  }

  if (values.response_type !== "code") {
    return {
      ok: false,
      missing: [],
      message: "The OAuth request must use response_type=code.",
    };
  }

  if (values.code_challenge_method !== "S256") {
    return {
      ok: false,
      missing: [],
      message: "The OAuth request must use PKCE S256.",
    };
  }

  return {
    ok: true,
    request: {
      response_type: "code",
      client_id: values.client_id,
      redirect_uri: values.redirect_uri,
      ...(resource ? { resource } : {}),
      scope: values.scope,
      state: values.state,
      code_challenge: values.code_challenge,
      code_challenge_method: "S256",
    },
  };
}

export function buildMcpOAuthAuthorizeBody(
  request: McpOAuthAuthorizeRequest,
  decision: McpOAuthDecision,
): McpOAuthAuthorizeRequest & { decision: McpOAuthDecision } {
  return { ...request, decision };
}
