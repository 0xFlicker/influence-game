export const DEFAULT_MCP_SERVER_NAME = "the-house-influence";
export const DEFAULT_LOCAL_MCP_RESOURCE_URI = "http://localhost:3000/mcp";
export const GROK_CONNECTORS_URL = "https://grok.com/connectors";

export type McpSetupClientId =
  | "codex"
  | "claude-code"
  | "grok-cli"
  | "grok-app";

export interface McpSetupClient {
  id: McpSetupClientId;
  name: string;
  commands: string[];
  /** Numbered UI steps for non-CLI flows (for example hosted Grok App connectors). */
  steps?: string[];
  authHint: string;
}

function trimmed(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function originFrom(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isLoopbackOrigin(origin: string): boolean {
  const hostname = new URL(origin).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function getMcpResourceUrl(
  resourceUri?: string | null,
  browserOrigin?: string | null,
): string {
  const configuredResourceUri = trimmed(resourceUri);
  if (isHttpUrl(configuredResourceUri)) return configuredResourceUri;

  const fallbackOrigin = originFrom(trimmed(browserOrigin));
  if (fallbackOrigin && !isLoopbackOrigin(fallbackOrigin)) {
    return `${fallbackOrigin}/mcp`;
  }

  return DEFAULT_LOCAL_MCP_RESOURCE_URI;
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
    {
      id: "grok-cli",
      name: "Grok Build CLI",
      commands: [
        `grok mcp add --transport http ${serverName} ${mcpUrl}`,
      ],
      authHint:
        "Complete browser authorization when Grok prompts. In a session, open /mcps and press i if auth is still needed.",
    },
    {
      id: "grok-app",
      name: "Grok App",
      commands: [],
      steps: [
        `Open ${GROK_CONNECTORS_URL}.`,
        "Click New Connector, then select Custom.",
        `Enter the MCP server URL (${mcpUrl}), then press Add Connector.`,
      ],
      authHint: "Grok App prompts for OAuth after you press Add Connector.",
    },
  ];
}
