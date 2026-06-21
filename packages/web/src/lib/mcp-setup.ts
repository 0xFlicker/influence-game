export const DEFAULT_MCP_SERVER_NAME = "influence-game";
export const DEFAULT_LOCAL_API_URL = "http://127.0.0.1:3000";

export type McpSetupClientId = "codex" | "claude";

export interface McpSetupClient {
  id: McpSetupClientId;
  name: string;
  summary: string;
  commands: string[];
  refreshCommands?: string[];
  authHint: string;
}

function trimmed(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function originFrom(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function getMcpResourceUrl(
  apiUrl?: string | null,
  browserOrigin?: string | null,
): string {
  const configuredOrigin = originFrom(trimmed(apiUrl));
  if (configuredOrigin) return `${configuredOrigin}/mcp`;

  const localOrigin = originFrom(DEFAULT_LOCAL_API_URL);
  if (localOrigin) return `${localOrigin}/mcp`;

  const fallbackOrigin = originFrom(trimmed(browserOrigin));
  return `${fallbackOrigin ?? ""}/mcp`;
}

export function buildMcpSetupClients(
  mcpUrl: string,
  serverName = DEFAULT_MCP_SERVER_NAME,
): McpSetupClient[] {
  return [
    {
      id: "codex",
      name: "Codex",
      summary: "Add the Streamable HTTP server. Codex opens browser authorization when setup needs OAuth.",
      commands: [
        `codex mcp add ${serverName} --url ${mcpUrl}`,
      ],
      refreshCommands: [
        `codex mcp login ${serverName} --scopes games`,
      ],
      authHint: "Use login later if the saved MCP token expires and Codex needs a refresh.",
    },
    {
      id: "claude",
      name: "Claude Code",
      summary: "Add the HTTP MCP server, then authenticate when Claude Code prompts.",
      commands: [
        `claude mcp add --transport http ${serverName} ${mcpUrl}`,
      ],
      authHint: "In Claude Code, use the MCP flow to complete browser authorization when prompted.",
    },
  ];
}
