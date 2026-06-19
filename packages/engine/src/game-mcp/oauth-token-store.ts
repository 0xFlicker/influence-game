import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { McpOAuthTokenResponse } from "./oauth";

export interface StoredMcpOAuthToken {
  accessToken: string;
  tokenType: "Bearer";
  scope: string;
  audience: string;
  purpose: string;
  issuedAt: string;
  expiresAt: string;
}

export function getDefaultMcpTokenFilePath(): string {
  return join(homedir(), ".influence-game", "mcp-token.json");
}

export function getMcpTokenFilePath(): string {
  return process.env.INFLUENCE_MCP_TOKEN_FILE ?? getDefaultMcpTokenFilePath();
}

export function saveMcpOAuthToken(
  token: McpOAuthTokenResponse,
  filePath = getMcpTokenFilePath(),
  now = new Date(),
): StoredMcpOAuthToken {
  const payload: StoredMcpOAuthToken = {
    accessToken: token.access_token,
    tokenType: token.token_type,
    scope: token.scope,
    audience: token.audience,
    purpose: token.purpose,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + token.expires_in * 1000).toISOString(),
  };

  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  chmodSync(filePath, 0o600);
  return payload;
}

export function loadStoredMcpAccessToken(
  filePath = getMcpTokenFilePath(),
  now = new Date(),
): string {
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as Partial<StoredMcpOAuthToken>;
  if (
    typeof parsed.accessToken !== "string" ||
    parsed.tokenType !== "Bearer" ||
    typeof parsed.scope !== "string" ||
    typeof parsed.audience !== "string" ||
    typeof parsed.purpose !== "string" ||
    typeof parsed.expiresAt !== "string"
  ) {
    throw new Error(`Saved MCP token file is invalid: ${filePath}`);
  }

  if (new Date(parsed.expiresAt).getTime() <= now.getTime()) {
    throw new Error(`Saved MCP token is expired. Rerun mcp:game:login: ${filePath}`);
  }

  return parsed.accessToken;
}
