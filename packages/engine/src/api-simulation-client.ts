/** Shared session exchange and HTTP transport for local API simulation CLIs. */
import { loadStoredMcpAccessToken } from "./game-mcp/oauth-token-store";

interface AuthExchangeResponse {
  token: string;
  user: { permissions: string[] };
}

export async function resolveSessionToken(apiBaseUrl: string, requiredPermissions = ["create_game", "fill_game", "start_game"]): Promise<string> {
  const configured = process.env.INFLUENCE_API_SESSION_TOKEN?.trim();
  if (configured) return configured;

  const mcpToken = process.env.INFLUENCE_MCP_TOKEN?.trim() || loadStoredMcpAccessToken();
  const exchanged = await apiFetch<AuthExchangeResponse>(
    apiBaseUrl,
    "/api/auth/local-cli-session",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${mcpToken}` },
      body: JSON.stringify({}),
    },
  );
  const missing = requiredPermissions.filter(
    (permission) => !exchanged.user.permissions.includes(permission),
  );
  if (missing.length > 0) {
    throw new Error(`Authenticated CLI user is missing permissions: ${missing.join(", ")}`);
  }
  return exchanged.token;
}


export async function apiFetch<T = unknown>(
  apiBaseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = new URL(path, apiBaseUrl);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`${init?.method ?? "GET"} ${url.pathname} failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<T>;
}

export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
