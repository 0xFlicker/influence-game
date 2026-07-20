import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dir, "../app/dashboard/dashboard-content.tsx"),
  "utf8",
);

describe("dashboard MCP setup card", () => {
  it("adds a contextual dashboard bridge to the setup page", () => {
    expect(source).toContain("McpSetupCard");
    expect(source).toContain('href="/get-mcp"');
    expect(source).toContain("Connect {HOUSE_VENUE.name} to your Chatbot or AI Agent");
    expect(source).toContain("control.stats.gamesPlayed > 0");
  });

  it("has useful copy for players with and without history", () => {
    expect(source).toContain("Use your Influence history from an AI coding client");
    expect(source).toContain("Join or complete an Influence game");
    expect(source).toContain("games tied to your account");
  });

  it("places the setup card before Mission Control", () => {
    expect(source.indexOf("<McpSetupCard")).toBeLessThan(
      source.indexOf("<MissionControlOverview"),
    );
  });

  it("does not link directly to protocol or producer endpoints", () => {
    expect(source).not.toContain('href="/mcp"');
    expect(source).not.toContain("/mcp/producer");
    expect(source).not.toContain("scope=mcp");
  });
});
