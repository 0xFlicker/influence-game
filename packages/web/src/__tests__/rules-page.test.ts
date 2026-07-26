import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "../app/rules/page.tsx"), "utf8");

describe("rules page", () => {
  it("frames Influence rules under The House without using active Whisper wording", () => {
    expect(source).toContain("ACTIVE_GAME.name} Rules");
    expect(source).toContain("THE_HOUSE_PRESENTS_INFLUENCE");
    expect(source).toContain("Inside an");
    expect(source).toContain("Mingle");
    expect(source).not.toContain('"Whisper"');
  });

  it("points readers at the public Updates archive", () => {
    expect(source).toContain('href="/updates"');
    expect(source).toContain("Updates");
  });

  it("keeps season scoring experimental instead of publishing a formula", () => {
    expect(source).toContain("public Agent and Architect leaderboards");
    expect(source).toContain("Wins and strong play");
    expect(source).not.toContain("100 base points");
    expect(source).not.toContain("up to 20%");
    expect(source).not.toContain("100%, 50%, and 25%");
  });
});
