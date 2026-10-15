import { describe, expect, it } from "bun:test";
import {
  buildMcpSetupClients,
  getMcpResourceUrl,
} from "../lib/mcp-setup";

describe("getMcpResourceUrl", () => {
  it("uses the configured OAuth resource URI without rebuilding it", () => {
    expect(getMcpResourceUrl("https://api.influence.example/mcp?tenant=game")).toBe(
      "https://api.influence.example/mcp?tenant=game",
    );
  });

  it("falls back to the public browser origin when runtime config is absent", () => {
    expect(getMcpResourceUrl("", "https://thehouse.game")).toBe(
      "https://thehouse.game/mcp",
    );
  });

  it("uses localhost for local browser origins when runtime config is absent", () => {
    expect(getMcpResourceUrl("", "http://localhost:3001")).toBe(
      "http://localhost:3000/mcp",
    );
    expect(getMcpResourceUrl("", "http://127.0.0.1:3001")).toBe(
      "http://localhost:3000/mcp",
    );
  });
});

describe("buildMcpSetupClients", () => {
  it("builds a secure Muse prompt using the current environment and a guided ChatGPT flow", () => {
    const clients = buildMcpSetupClients("https://thehouse.game/mcp");
    const meta = clients.find((client) => client.id === "meta");
    expect(meta?.prompt).toContain("Server: https://thehouse.game/mcp");
    expect(meta?.prompt).toContain("https://thehouse.game/api/oauth/mcp/register");
    expect(meta?.prompt).toContain("https://thehouse.game/.well-known/oauth-protected-resource/mcp");
    expect(meta?.prompt).toContain("agents:read   (view my agents)");
    expect(meta?.prompt).toContain("agents:write  (create and manage my agents)");
    expect(meta?.prompt).toContain("games:read    (view games)");
    expect(meta?.prompt).toContain("Do not create, modify, or enter anything");
    expect(meta?.prompt).toContain("do not ask me to paste any token, key, or secret into chat");
    expect(meta?.prompt).not.toContain("producer");
    const chatgpt = clients.find((client) => client.id === "chatgpt");
    expect(chatgpt?.steps?.join(" ")).toContain("developer mode");
    expect(chatgpt?.steps?.join(" ")).toContain("Streamable HTTP");
    expect(chatgpt?.steps?.join(" ")).toContain("Leave client ID and client secret blank");
  });
  it("builds Codex, Claude Code, and Grok setup for the same MCP URL", () => {
    const clients = buildMcpSetupClients("https://api.influence.example/mcp");

    expect(clients.map((client) => client.id)).toEqual([
      "chatgpt",
      "meta",
      "codex",
      "claude-code",
      "grok-cli",
      "grok-app",
    ]);
    expect(clients[2]?.commands).toEqual([
      "codex mcp add the-house-influence --url https://api.influence.example/mcp",
    ]);
    expect(clients[0]).not.toHaveProperty("refreshCommands");
    expect(clients[3]?.commands).toEqual([
      "claude mcp add --transport http the-house-influence https://api.influence.example/mcp",
    ]);
    expect(clients[4]?.commands).toEqual([
      "grok mcp add --transport http the-house-influence https://api.influence.example/mcp",
    ]);
    expect(clients[5]?.commands).toEqual([]);
    expect(clients[5]?.steps).toEqual([
      "Open https://grok.com/connectors.",
      "Click New Connector, then select Custom.",
      "Enter the MCP server URL (https://api.influence.example/mcp), then press Add Connector.",
    ]);
    expect(clients[5]?.authHint).toBe(
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
    expect(serialized).toContain("ChatGPT");
  });
});
