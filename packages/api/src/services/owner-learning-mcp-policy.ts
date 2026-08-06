import type { McpOAuthScope } from "./mcp-scope-policy.js";

export const OWNER_LEARNING_MCP_REQUIRED_SCOPES_VERSION =
  "owner-learning-mcp-scopes-v1";

export const OWNER_LEARNING_MCP_READ_SCOPES = [
  "agents:read",
  "games:read",
] as const satisfies readonly McpOAuthScope[];

export const OWNER_LEARNING_MCP_WRITE_SCOPES = [
  "agents:read",
  "games:read",
  "agents:write",
] as const satisfies readonly McpOAuthScope[];
