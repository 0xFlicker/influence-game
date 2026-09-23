import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface StoredMcpOAuthToken {
  accessToken?: unknown;
  tokenType?: unknown;
  scope?: unknown;
  audience?: unknown;
  purpose?: unknown;
  expiresAt?: unknown;
}

export function loadStoredMcpAccessToken(): string {
  const filePath = process.env.INFLUENCE_MCP_TOKEN_FILE?.trim()
    || join(homedir(), ".influence-game", "mcp-token.json");
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as StoredMcpOAuthToken;
  if (
    typeof parsed.accessToken !== "string"
    || parsed.tokenType !== "Bearer"
    || typeof parsed.scope !== "string"
    || typeof parsed.audience !== "string"
    || typeof parsed.purpose !== "string"
    || typeof parsed.expiresAt !== "string"
  ) {
    throw new Error(`Saved MCP token is invalid: ${filePath}`);
  }
  if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
    throw new Error(`Saved MCP token is expired. Rerun mcp:game:login: ${filePath}`);
  }
  return parsed.accessToken;
}
