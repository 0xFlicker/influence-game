export const DEFAULT_MCP_SERVER_NAME = "the-house-influence";
export const DEFAULT_LOCAL_MCP_RESOURCE_URI = "http://localhost:3000/mcp";
export const GROK_CONNECTORS_URL = "https://grok.com/connectors";

export type McpSetupClientId =
  | "codex"
  | "claude-code"
  | "grok-cli"
  | "grok-app"
  | "chatgpt"
  | "muse-assistant"
  | "muse-code";

export interface McpSetupClient {
  id: McpSetupClientId;
  name: string;
  commands: string[];
  /** Numbered UI steps for non-CLI flows (for example hosted Grok App connectors). */
  steps?: string[];
  prompt?: string;
  /** Label shown above a paste-in prompt block (defaults to a generic label). */
  promptLabel?: string;
  docsUrl?: string;
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

export function buildMuseSetupPrompt(mcpUrl: string): string {
  const origin = new URL(mcpUrl).origin;
  return `Connect to The House, an AI-agent gaming platform, using its MCP server.

Server: ${mcpUrl}

Use the secure/custom connector flow your platform provides for adding an
MCP server — do not ask me to paste any token, key, or secret into chat.
The server uses OAuth 2.1 (authorization code + PKCE) with dynamic client
registration, so no app or client credentials need to be created in
advance. Discovery metadata:
- Protected resource: ${origin}/.well-known/oauth-protected-resource/mcp
- Authorization server: ${origin}/.well-known/oauth-authorization-server
  (issuer ${origin}; registration endpoint
   ${origin}/api/oauth/mcp/register)

Request exactly these scopes — they are the standard player set:
  agents:read   (view my agents)
  agents:write  (create and manage my agents)
  games:read    (view games)

When my browser consent step appears, let me complete the login and scope
approval myself. After the connection succeeds, verify it with a harmless
read — list the available tools, then list my games or agents — and report
back what you can see and do. Do not create, modify, or enter anything
until I ask.`;
}

export function buildMuseCodeSetupPrompt(mcpUrl: string): string {
  return `Connect The House MCP server for me.

1. Add this entry under "mcpServers" in ~/.config/muse/settings.json (create the key if it is missing; keep everything else):
"the-house": { "transport": "streamable_http", "url": "${mcpUrl}" }
2. Run: muse mcp login the-house --scope agents:read --scope agents:write --scope games:read
I will approve access in the browser. Never ask me to paste a token, key, or secret.
3. Restart Muse, run /mcp to confirm the-house is connected, then call list_agents and report what you find. Do not create or change anything yet.`;
}

export function buildMcpSetupClients(
  mcpUrl: string,
  serverName = DEFAULT_MCP_SERVER_NAME,
): McpSetupClient[] {
  return [
    {
      id: "chatgpt",
      name: "ChatGPT",
      commands: [],
      steps: [
        "Open ChatGPT on the web. If your interface requires developer mode, enable it in Settings (look under Apps → Advanced settings or Security and login). Workspace access may require an administrator.",
        "Open Apps → Create, or in the newer Plugins interface select + → Add custom MCP server.",
        `Name it The House and paste ${mcpUrl} as the MCP server URL. Select Streamable HTTP if a transport selector is shown.`,
        "Choose OAuth and dynamic client registration (DCR) if offered. Leave client ID and client secret blank; The House registers the client automatically.",
        "Review the custom-server warning, then create the app or plugin. Complete The House login and approve agents:read, agents:write, and games:read in your browser.",
        "Install or enable The House, then select it from the tools menu or @ mention it in a new chat. Ask it to list your agents before requesting changes.",
      ],
      docsUrl: "https://developers.openai.com/api/docs/guides/custom-mcp-server",
      authHint: "This is a custom MCP connection; The House is not yet listed in the ChatGPT directory. Available settings depend on your account and workspace.",
    },
    {
      id: "muse-assistant",
      name: "Muse Assistant",
      commands: [],
      steps: [
        "Paste the prompt below into Muse Assistant chat to ask it to connect to The House.",
        "Complete the browser login and consent yourself, then let Muse Assistant verify the connection with a read.",
      ],
      prompt: buildMuseSetupPrompt(mcpUrl),
      promptLabel: "Paste into Muse Assistant chat",
      authHint: "Use the secure connector flow. Never paste tokens, keys, or secrets into chat.",
    },
    {
      id: "muse-code",
      name: "Muse",
      commands: [],
      steps: [
        "Paste the prompt below into a Muse session. It updates its own MCP settings and runs the login.",
        "Approve access in the browser when the login opens it, then restart Muse when it tells you to.",
      ],
      prompt: buildMuseCodeSetupPrompt(mcpUrl),
      promptLabel: "Paste into Muse",
      authHint: "Muse edits ~/.config/muse/settings.json and runs muse mcp login. Approve the browser consent yourself; never paste tokens or secrets.",
    },
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
