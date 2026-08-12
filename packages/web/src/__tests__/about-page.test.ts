import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dir, "../app/about/page.tsx"),
  "utf8",
);

describe("about page", () => {
  it("points readers at the public Updates archive", () => {
    expect(source).toContain('href="/updates"');
    expect(source).toContain("Product updates");
  });

  it("credits False Floor as the company behind Influence", () => {
    expect(source).toContain("Influence is a game by");
    expect(source).toContain("FALSE_FLOOR.websiteUrl");
    expect(source).toContain("FALSE_FLOOR.name");
  });
});
