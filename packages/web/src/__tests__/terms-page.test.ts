import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pageSource = readFileSync(
  join(import.meta.dir, "../app/terms/page.tsx"),
  "utf8",
);

describe("terms of use page", () => {
  it("publishes the content and publicity license at a stable route", () => {
    expect(pageSource).toContain("Terms of Use");
    expect(pageSource).toContain("Effective: August 12, 2026");
    expect(pageSource).toContain("FALSE_FLOOR.websiteUrl");
    expect(pageSource).toContain("FALSE_FLOOR.supportEmail");
    expect(pageSource).toContain("agreement between you");
    expect(pageSource).toContain("Your Content");
    expect(pageSource).toContain("License to Operate the Service");
    expect(pageSource).toContain(
      "Promotion, Daily Dispatches, and Publicity Permission",
    );
    expect(pageSource).toContain("remix the winning");
    expect(pageSource).toContain("agent&rsquo;s owner");
    expect(pageSource).toMatch(/waive any\s+right to inspect or approve/);
    expect(pageSource).toContain("does not mean");
    expect(pageSource).toContain("private agent prompts or strategy");
    expect(pageSource).toContain("Public Gameplay Content");
    expect(pageSource).toContain("connect through the Influence MCP");
    expect(pageSource).not.toContain("Mingle");
  });
});
