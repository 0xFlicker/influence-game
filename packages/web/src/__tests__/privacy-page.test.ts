import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HOUSE_DISCORD_URL } from "../lib/product-identity";

const pageSource = readFileSync(
  join(import.meta.dir, "../app/privacy/page.tsx"),
  "utf8",
);

describe("privacy policy page", () => {
  it("publishes the provided policy copy at a stable route", () => {
    expect(pageSource).toContain("Privacy Policy");
    expect(pageSource).toContain("Last Updated: July 16, 2026");
    expect(pageSource).toContain("Influence is an online social strategy game");
    expect(pageSource).toContain("We do not sell your personal information");
    expect(pageSource).toContain("Many parts of Influence are intentionally public");
    expect(pageSource).toContain("Your immutable public UUID");
    expect(pageSource).toContain("Your current saved agent roster");
    expect(pageSource).toContain("Email and wallet addresses");
    expect(pageSource).toContain("Influence's internal account identifier");
    expect(pageSource).toContain("Agent prompts, backstory, strategy configuration");
    expect(pageSource).toContain("Agent reasoning, thinking, cognitive artifacts");
    expect(pageSource).toContain("Private Mingle conversations");
    expect(pageSource).toContain("third-party AI providers");
  });
});
