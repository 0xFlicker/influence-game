import { describe, expect, it } from "bun:test";
import {
  buildMcpSetupClients,
  getMcpResourceUrl,
} from "../lib/mcp-setup";

describe("getMcpResourceUrl", () => {
  it("derives /mcp from the runtime API origin", () => {
    expect(getMcpResourceUrl("https://api.influence.example/")).toBe(
      "https://api.influence.example/mcp",
    );
  });

  it("falls back to the local API default when runtime config is absent", () => {
    expect(getMcpResourceUrl("")).toBe("http://127.0.0.1:3000/mcp");
  });
});

describe("buildMcpSetupClients", () => {
  it("builds Codex and Claude Code command snippets for the same MCP URL", () => {
    const clients = buildMcpSetupClients("https://api.influence.example/mcp");

    expect(clients.map((client) => client.id)).toEqual([
      "codex",
      "claude-code",
    ]);
    expect(clients[0]?.commands).toEqual([
      "codex mcp add the-house-influence --url https://api.influence.example/mcp",
    ]);
    expect(clients[0]).not.toHaveProperty("refreshCommands");
    expect(clients[1]?.commands).toEqual([
      "claude mcp add --transport http the-house-influence https://api.influence.example/mcp",
    ]);
  });

  it("keeps generated snippets on the player-facing MCP boundary", () => {
    const serialized = JSON.stringify(
      buildMcpSetupClients("https://api.influence.example/mcp"),
    );

    expect(serialized).toContain("/mcp");
    expect(serialized).not.toContain("/mcp/producer");
    expect(serialized).not.toContain("scope=mcp");
    expect(serialized).not.toContain("TOML");
    expect(serialized).not.toContain("JSON config");
    expect(serialized).not.toContain("ChatGPT");
    expect(serialized).not.toContain("Grok");
  });
});
