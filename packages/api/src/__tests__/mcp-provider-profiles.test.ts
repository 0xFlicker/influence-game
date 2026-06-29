import { describe, expect, test } from "bun:test";
import {
  MCP_APP_PROVIDER_IDS,
  parseMcpAppProviderId,
} from "../game-mcp/provider-profiles.js";
import {
  createRedirectAuditDetail,
  providerRedirectRuleForUri,
} from "../game-mcp/oauth-provider-compat.js";

describe("MCP App provider audit hints", () => {
  test("defines bounded provider IDs for app hosts and tool clients", () => {
    expect(MCP_APP_PROVIDER_IDS).toEqual([
      "chatgpt",
      "claude",
      "grok",
      "codex",
      "claude-code",
    ]);
  });

  test("parses provider hints case-insensitively and rejects unknown values", () => {
    expect(parseMcpAppProviderId(" Grok ")).toBe("grok");
    expect(parseMcpAppProviderId("CLAUDE-CODE")).toBe("claude-code");
    expect(parseMcpAppProviderId("unknown")).toBeUndefined();
  });

  test("keeps hosted OAuth callbacks in code-owned provider config", () => {
    const claudeCallback = "https://claude.ai/api/mcp/auth_callback";
    expect(providerRedirectRuleForUri(claudeCallback)).toEqual({
      providerId: "claude",
      redirectUri: claudeCallback,
    });
    expect(createRedirectAuditDetail(
      "https://chatgpt.com/mcp/oauth/callback",
      "rejected",
    )).toMatchObject({
      protocol: "https",
      host: "chatgpt.com",
      path: "/mcp/oauth/callback",
      hasQuery: false,
      providerId: "chatgpt",
      matchSource: "rejected",
    });
  });
});
