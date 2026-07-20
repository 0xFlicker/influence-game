export const DEFAULT_MCP_SERVER_NAME = "the-house-influence";
export const DEFAULT_LOCAL_API_URL = "http://127.0.0.1:3000";

export type McpSetupClientId = "codex" | "claude-code";

export interface McpSetupClient {
  id: McpSetupClientId;
  name: string;
  commands: string[];
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
      commands: [
        `codex mcp add ${serverName} --url ${mcpUrl}`,
      ],
      authHint: "Complete browser authorization when Codex prompts.",
    },
    {
      id: "claude-code",
      name: "Claude Code",
      commands: [
        `claude mcp add --transport http ${serverName} ${mcpUrl}`,
      ],
      authHint: "In Claude Code, use the MCP flow to complete browser authorization when prompted.",
    },
  ];
}
