import { createHash } from "node:crypto";
import type { McpAppProviderId } from "./provider-profiles.js";

export type McpOAuthRedirectMatchSource =
  | "loopback"
  | "legacy_env"
  | "provider_config"
  | "dynamic_https"
  | "invalid_syntax"
  | "rejected";

export interface McpOAuthProviderRedirectRule {
  providerId: McpAppProviderId;
  redirectUri: string;
}

export interface McpOAuthRedirectAuditDetail {
  protocol?: string;
  host?: string;
  path?: string;
  hasQuery?: boolean;
  uriHash: string;
  providerId?: McpAppProviderId;
  matchSource: McpOAuthRedirectMatchSource;
}

export const MCP_OAUTH_PROVIDER_REDIRECT_URIS: McpOAuthProviderRedirectRule[] = [
  {
    providerId: "claude",
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
  },
];

export function providerRedirectRuleForUri(
  redirectUri: string,
): McpOAuthProviderRedirectRule | undefined {
  return MCP_OAUTH_PROVIDER_REDIRECT_URIS.find((rule) =>
    rule.redirectUri === redirectUri
  );
}

export function providerIdForRedirectUrl(url: URL): McpAppProviderId | undefined {
  const exact = providerRedirectRuleForUri(url.toString());
  if (exact) return exact.providerId;

  const hostname = url.hostname.toLowerCase();
  if (hostname === "claude.ai" || hostname.endsWith(".claude.ai")) return "claude";
  if (
    hostname === "chatgpt.com" ||
    hostname.endsWith(".chatgpt.com") ||
    hostname === "openai.com" ||
    hostname.endsWith(".openai.com")
  ) {
    return "chatgpt";
  }
  if (
    hostname === "grok.com" ||
    hostname.endsWith(".grok.com") ||
    hostname === "x.ai" ||
    hostname.endsWith(".x.ai")
  ) {
    return "grok";
  }
  return undefined;
}

export function hashRedirectUri(redirectUri: string): string {
  return `sha256:${createHash("sha256").update(redirectUri).digest("hex")}`;
}

export function createRedirectAuditDetail(
  redirectUri: string,
  matchSource: McpOAuthRedirectMatchSource,
): McpOAuthRedirectAuditDetail {
  try {
    const url = new URL(redirectUri);
    return {
      protocol: url.protocol.replace(/:$/, ""),
      host: url.hostname,
      path: url.pathname,
      hasQuery: url.search.length > 0,
      uriHash: hashRedirectUri(redirectUri),
      providerId: providerIdForRedirectUrl(url),
      matchSource,
    };
  } catch {
    return {
      uriHash: hashRedirectUri(redirectUri),
      matchSource: "invalid_syntax",
    };
  }
}
