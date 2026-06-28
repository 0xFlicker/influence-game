export type McpAppProviderId =
  | "chatgpt"
  | "claude"
  | "grok"
  | "codex"
  | "claude-code";

export type McpAppAuditStage =
  | "discovery"
  | "oauth_start"
  | "callback_token_exchange"
  | "app_resource_fetch";

export const MCP_APP_PROVIDER_IDS: McpAppProviderId[] = [
  "chatgpt",
  "claude",
  "grok",
  "codex",
  "claude-code",
];

export function parseMcpAppProviderId(
  value: string | null | undefined,
): McpAppProviderId | undefined {
  const normalized = value?.trim().toLowerCase();
  return MCP_APP_PROVIDER_IDS.find((providerId) => providerId === normalized);
}
