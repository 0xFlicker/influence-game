import { describe, expect, test } from "bun:test";
import {
  MCP_APP_PROVIDER_IDS,
  parseMcpAppProviderId,
} from "../game-mcp/provider-profiles.js";

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
});
