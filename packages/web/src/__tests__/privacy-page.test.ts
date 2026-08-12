import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const pageSource = readFileSync(
  join(import.meta.dir, "../app/privacy/page.tsx"),
  "utf8",
);

describe("privacy policy page", () => {
  it("publishes the provided policy copy at a stable route", () => {
    expect(pageSource).toContain("Privacy Policy");
    expect(pageSource).toContain("Last Updated: August 12, 2026");
    expect(pageSource).toContain("Influence is an online social strategy game");
    expect(pageSource).toContain("We do not sell your personal information");
    expect(pageSource).toContain("Many parts of Influence are intentionally public");
    expect(pageSource).toContain("Your immutable public UUID");
    expect(pageSource).toContain("Your current saved agent roster");
    expect(pageSource).toContain("Email and wallet addresses");
    expect(pageSource).toContain("Agent prompts, backstory, strategy configuration");
    expect(pageSource).toContain("Agent reasoning, thinking, and cognitive artifacts");
    expect(pageSource).toMatch(/Public Gameplay\s+Content/);
    expect(pageSource).toContain("connect through the Influence MCP");
    expect(pageSource).not.toContain("Mingle");
    expect(pageSource).not.toContain("personally endorses Influence");
    expect(pageSource).toContain("third-party AI providers");
    expect(pageSource).toContain("Daily Dispatches, Highlights, and Marketing");
    expect(pageSource).toContain("remix the winning agent");
    expect(pageSource).toMatch(/discuss the\s+agent/);
    expect(pageSource).toContain("private agent prompts or strategy");
  });
});
