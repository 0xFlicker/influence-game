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
    const chatGptCallback = "https://chatgpt.com/connector/oauth/_syG1DzKsjXV";
    const claudeCallback = "https://claude.ai/api/mcp/auth_callback";
    const grokCallback = "https://grok.com/connectors-oauth-exchange-code/";
    expect(providerRedirectRuleForUri(chatGptCallback)).toEqual({
      providerId: "chatgpt",
      redirectUri: chatGptCallback,
    });
    expect(providerRedirectRuleForUri(claudeCallback)).toEqual({
      providerId: "claude",
      redirectUri: claudeCallback,
    });
    expect(providerRedirectRuleForUri(grokCallback)).toEqual({
      providerId: "grok",
      redirectUri: grokCallback,
    });
    expect(createRedirectAuditDetail(chatGptCallback, "provider_config")).toMatchObject({
      protocol: "https",
      host: "chatgpt.com",
      path: "/connector/oauth/_syG1DzKsjXV",
      hasQuery: false,
      providerId: "chatgpt",
      matchSource: "provider_config",
    });
    expect(createRedirectAuditDetail(grokCallback, "provider_config")).toMatchObject({
      protocol: "https",
      host: "grok.com",
      path: "/connectors-oauth-exchange-code/",
      hasQuery: false,
      providerId: "grok",
      matchSource: "provider_config",
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
