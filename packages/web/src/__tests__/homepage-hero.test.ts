import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dir, "../components/home/homepage-hero.tsx"),
  "utf8",
);

describe("homepage MCP CTA", () => {
  it("links curious visitors to the setup page without replacing primary actions", () => {
    expect(source).toContain('href="/games"');
    expect(source).toContain('href="/dashboard"');
    expect(source).toContain('href="/get-mcp"');
    expect(source).toContain("Codex / Claude");
    expect(source).toContain("THE_HOUSE_PRESENTS_INFLUENCE");
    expect(source).toContain("Connect The House to your Influence games in Codex or Claude Code");
  });

  it("does not point homepage visitors at protocol or producer endpoints", () => {
    expect(source).not.toContain('href="/mcp"');
    expect(source).not.toContain("/mcp/producer");
  });
});
