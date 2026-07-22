import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMcpSetupClients } from "../lib/mcp-setup";

const getMcpClientSource = readFileSync(
  join(import.meta.dir, "../app/get-mcp/get-mcp-client.tsx"),
  "utf8",
);
const pageSource = readFileSync(
  join(import.meta.dir, "../app/get-mcp/page.tsx"),
  "utf8",
);
const combinedSource = `${getMcpClientSource}\n${pageSource}`;

describe("/get-mcp setup page", () => {
  it("defines player-facing command snippets for Codex, Claude Code, and Grok Build CLI", () => {
    const clients = buildMcpSetupClients("https://api.influence.example/mcp");
    const commands = clients.flatMap((client) => client.commands);

    expect(commands).toContain(
      "codex mcp add the-house-influence --url https://api.influence.example/mcp",
    );
    expect(commands).toContain(
      "claude mcp add --transport http the-house-influence https://api.influence.example/mcp",
    );
    expect(commands).toContain(
      "grok mcp add --transport http the-house-influence https://api.influence.example/mcp",
    );
  });

  it("includes actionable Grok App connector steps", () => {
    const clients = buildMcpSetupClients("https://api.influence.example/mcp");
    const grokApp = clients.find((client) => client.id === "grok-app");

    expect(clients.map((client) => client.id)).toEqual([
      "codex",
      "claude-code",
      "grok-cli",
      "grok-app",
    ]);
    expect(grokApp?.steps).toEqual([
      "Open https://grok.com/connectors.",
      "Click New Connector, then select Custom.",
      "Enter the MCP server URL (https://api.influence.example/mcp), then press Add Connector.",
    ]);
    expect(grokApp?.authHint).toContain("Add Connector");
    expect(combinedSource).toContain("client.steps");
    expect(combinedSource).not.toContain("ChatGPT");
    expect(combinedSource).not.toContain("MCP App setup");
    expect(combinedSource).not.toContain("provider-specific blockers");
  });

  it("keeps MCP setup copy concise", () => {
    expect(combinedSource).toContain("Connect {HOUSE_VENUE.name} to your AI.");
    expect(combinedSource).toContain("let your AI inspect your {ACTIVE_GAME.name} games");
    expect(combinedSource).toContain("GetMcpClient");
    expect(combinedSource).not.toContain("If the token expires");
    expect(combinedSource).not.toContain("Use login later if the saved MCP token expires");
    expect(combinedSource).not.toContain("OAuth-backed setup");
    expect(combinedSource).not.toContain("restart Codex or Claude Code");
  });

  it("does not add an authentication prompt to setup", () => {
    expect(getMcpClientSource).not.toContain('import { useAuth } from "@/hooks/use-auth"');
    expect(getMcpClientSource).not.toContain("usePrivy");
    expect(getMcpClientSource).not.toContain("useE2EAuth");
    expect(getMcpClientSource).not.toContain("Sign in");
  });

  it("keeps setup metadata in prose instead of extra cards", () => {
    expect(combinedSource).toContain("The MCP endpoint is");
    expect(combinedSource).toContain("Copy MCP endpoint");
    expect(combinedSource).toContain("command={mcpUrl}");
    expect(combinedSource).toContain("max-w-3xl space-y-3");
    expect(combinedSource).not.toContain("<aside");
    expect(combinedSource).not.toContain("The grant covers Influence games");
    expect(combinedSource).not.toContain("internal developer evidence");
  });

  it("keeps setup metadata inline so it cannot overlap the command cards", () => {
    expect(combinedSource).toContain("max-w-6xl");
    expect(combinedSource).toContain("mt-7 max-w-3xl");
    expect(combinedSource).toContain('className="min-w-0"');
    expect(combinedSource).not.toContain("lg:grid-cols-[minmax(0,1fr)");
  });

  it("contains long commands on mobile widths", () => {
    expect(combinedSource).toContain("overflow-x-hidden");
    expect(combinedSource).toContain("influence-panel min-w-0 overflow-hidden");
    expect(combinedSource).toContain("grid min-w-0 gap-3");
    expect(combinedSource).toContain("md:grid-cols-[minmax(0,1fr)_auto]");
    expect(combinedSource).toContain("block max-w-full min-w-0 overflow-x-auto");
  });

  it("keeps player-facing setup away from producer and config-file copy", () => {
    expect(combinedSource).not.toContain("/mcp/producer");
    expect(combinedSource).not.toContain("scope=mcp");
    expect(combinedSource).not.toContain("private trace tools");
    expect(combinedSource).not.toContain("TOML");
    expect(combinedSource).not.toContain("JSON config");
  });
});
