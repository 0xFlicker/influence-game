import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pageSource = readFileSync(
  join(import.meta.dir, "../app/privacy/page.tsx"),
  "utf8",
);
const navSource = readFileSync(
  join(import.meta.dir, "../components/nav.tsx"),
  "utf8",
);

describe("privacy policy page", () => {
  it("publishes the provided policy copy at a stable route", () => {
    expect(pageSource).toContain("Privacy Policy");
    expect(pageSource).toContain("Last Updated: June 29, 2026");
    expect(pageSource).toContain("Influence is an online social strategy game");
    expect(pageSource).toContain("We do not sell your personal information");
    expect(pageSource).toContain("Many parts of Influence are intentionally public");
    expect(pageSource).toContain("Private Mingle conversations");
    expect(pageSource).toContain("third-party AI providers");
  });

  it("links the policy from the primary navigation", () => {
    expect(navSource).toContain('href="/privacy"');
    expect(navSource).toContain("Privacy");
  });
});
