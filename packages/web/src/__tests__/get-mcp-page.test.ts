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
  it("defines player-facing command snippets for Codex and Claude Code", () => {
    const clients = buildMcpSetupClients("https://api.influence.example/mcp");
    const commands = clients.flatMap((client) => client.commands);
    const refreshCommands = clients.flatMap(
      (client) => client.refreshCommands ?? [],
    );

    expect(commands).toContain(
      "codex mcp add influence-game --url https://api.influence.example/mcp",
    );
    expect(refreshCommands).toContain(
      'codex mcp login influence-game --scopes "agents:read games:read"',
    );
    expect(commands).toContain(
      "claude mcp add --transport http influence-game https://api.influence.example/mcp",
    );
  });

  it("does not show non-actionable MCP App provider planning notes", () => {
    const clients = buildMcpSetupClients("https://api.influence.example/mcp");

    expect(clients.map((client) => client.id)).toEqual([
      "codex",
      "claude-code",
    ]);
    expect(combinedSource).not.toContain("ChatGPT");
    expect(combinedSource).not.toContain("Grok");
    expect(combinedSource).not.toContain("MCP App setup");
    expect(combinedSource).not.toContain("provider-specific blockers");
  });


  it("includes sign-in and browser OAuth guidance", () => {
    expect(combinedSource).toContain("Connect {HOUSE_VENUE.name} to your {ACTIVE_GAME.name} games");
    expect(combinedSource).toContain("owned agents, rules, and supported pre-match queues");
    expect(combinedSource).toContain("sign in before completing");
    expect(combinedSource).toContain("OAuth-backed setup");
    expect(combinedSource).toContain("Authorization happens in your browser");
    expect(combinedSource).toContain("If the token expires");
    expect(combinedSource).toContain("restart Codex or Claude Code");
    expect(combinedSource).toContain("new tools are loaded");
    expect(combinedSource).toContain("GetMcpClient");
  });

  it("keeps setup metadata in prose instead of extra cards", () => {
    expect(combinedSource).toContain("The MCP endpoint is");
    expect(combinedSource).toContain("Authorization happens in your browser");
    expect(combinedSource).toContain("Copy MCP endpoint");
    expect(combinedSource).toContain("command={mcpUrl}");
    expect(combinedSource).toContain("Sign in");
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
