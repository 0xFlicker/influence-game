import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../../..");
const docs = readFileSync(
  join(repoRoot, "docs/game-mcp-production-oauth.md"),
  "utf8",
);
const setupPage = readFileSync(
  join(import.meta.dir, "../app/get-mcp/get-mcp-client.tsx"),
  "utf8",
);

describe("MCP setup docs alignment", () => {
  it("points player-facing setup to /get-mcp", () => {
    expect(docs).toContain("Player-facing setup lives at `/get-mcp`");
    expect(docs).toContain("Do not send players directly to `/mcp`");
    expect(docs).toContain("Influence games, agents, rules, and supported pre-match queues");
  });

  it("keeps producer setup in internal docs and out of the player page", () => {
    expect(docs).toContain("influence-game-producer");
    expect(docs).toContain("/mcp/producer");
    expect(setupPage).not.toContain("influence-game-producer");
    expect(setupPage).not.toContain("/mcp/producer");
    expect(setupPage).not.toContain("scope=mcp");
  });
});
