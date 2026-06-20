import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "../app/rules/page.tsx"), "utf8");

describe("rules page shield copy", () => {
  it("describes shields as lasting through the current Council only", () => {
    expect(source).toContain("current Council");
    expect(source).toContain("expire automatically after that Council");
    expect(source).not.toContain("this round or next");
    expect(source).not.toContain("next round&apos;s Reveal");
    expect(source).not.toContain("one-round shield");
  });
});
