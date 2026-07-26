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
});
