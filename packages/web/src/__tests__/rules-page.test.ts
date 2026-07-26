import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "../app/rules/page.tsx"), "utf8");
const normalizedSource = source.replace(/\s+/g, " ");

describe("rules page format-kernel copy", () => {
  it("frames Influence rules under The House without using active Whisper wording", () => {
    expect(source).toContain("ACTIVE_GAME.name} Rules");
    expect(source).toContain("THE_HOUSE_PRESENTS_INFLUENCE");
    expect(source).toContain("Inside an");
    expect(source).toContain("Mingle");
    expect(source).not.toContain('"Whisper"');
  });

  it("describes the format-kernel standard round contract", () => {
    expect(source).toContain("Each standard pre-endgame round has eight main beats");
    expect(source).toContain("Mingle I (Pre-Vote Mingle + Alliance Formation)");
    expect(source).toContain("Pre-Format Alliance Huddles");
    expect(source).toContain("Two-Format Menu");
    expect(source).toContain("Format-Aware Mingle");
    expect(source).toContain("Format Resolution and Elimination");
    expect(source).toContain("Named Alliances");
    expect(source).toContain("consent to the same version");
    expect(source).not.toContain("current Council");
  });

  it("separates sealed agent context from the viewer and MCP ballot ledger", () => {
    expect(normalizedSource).toContain("ballots remain sealed to the agents playing the game");
    expect(normalizedSource).toContain("Once an accepted format ballot is durably recorded");
    expect(normalizedSource).toContain("sanitized voter, target, and polarity ledger");
    expect(normalizedSource).toContain("does not make it agent knowledge");
    expect(normalizedSource).toContain("canonical viewer/MCP");
    expect(normalizedSource).toContain("not transcript wording");
  });

  it("keeps season scoring experimental instead of publishing a formula", () => {
    expect(source).toContain("public Agent and Architect leaderboards");
    expect(source).toContain("Wins and strong play");
    expect(source).not.toContain("100 base points");
    expect(source).not.toContain("up to 20%");
    expect(source).not.toContain("100%, 50%, and 25%");
  });
});
