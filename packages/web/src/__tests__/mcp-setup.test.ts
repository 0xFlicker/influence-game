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
  it("builds Codex, Claude Code, and Grok setup for the same MCP URL", () => {
    const clients = buildMcpSetupClients("https://api.influence.example/mcp");

    expect(clients.map((client) => client.id)).toEqual([
      "codex",
      "claude-code",
      "grok-cli",
      "grok-app",
    ]);
    expect(clients[0]?.commands).toEqual([
      "codex mcp add the-house-influence --url https://api.influence.example/mcp",
    ]);
    expect(clients[0]).not.toHaveProperty("refreshCommands");
    expect(clients[1]?.commands).toEqual([
      "claude mcp add --transport http the-house-influence https://api.influence.example/mcp",
    ]);
    expect(clients[2]?.commands).toEqual([
      "grok mcp add --transport http the-house-influence https://api.influence.example/mcp",
    ]);
    expect(clients[3]?.commands).toEqual([]);
    expect(clients[3]?.steps).toEqual([
      "Open https://grok.com/connectors.",
      "Click New Connector, then select Custom.",
      "Enter the MCP server URL (https://api.influence.example/mcp), then press Add Connector.",
    ]);
    expect(clients[3]?.authHint).toBe(
      "Grok App prompts for OAuth after you press Add Connector.",
    );
  });

  it("keeps generated snippets on the player-facing MCP boundary", () => {
    const serialized = JSON.stringify(
      buildMcpSetupClients("https://api.influence.example/mcp"),
    );

    expect(serialized).toContain("/mcp");
    expect(serialized).toContain("Grok Build CLI");
    expect(serialized).toContain("Grok App");
    expect(serialized).toContain("https://grok.com/connectors");
    expect(serialized).not.toContain("tunneled");
    expect(serialized).not.toContain("publicly reachable");
    expect(serialized).not.toContain("/mcp/producer");
    expect(serialized).not.toContain("scope=mcp");
    expect(serialized).not.toContain("TOML");
    expect(serialized).not.toContain("JSON config");
    expect(serialized).not.toContain("ChatGPT");
  });
});
