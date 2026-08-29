import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "../app/rules/page.tsx"), "utf8");
const normalizedSource = source.replace(/\s+/g, " ");

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

  it("describes the format-kernel standard round contract", () => {
    expect(source).toContain("Each standard pre-endgame round has eight main beats");
    expect(source).toContain("Mingle I (Pre-Vote Mingle + Alliance Formation)");
    expect(source).toContain("Pre-Format Alliance Huddles");
    expect(source).toContain("Format Selection");
    expect(source).toContain("Format-Aware Mingle");
    expect(source).toContain("Format Resolution and Exit");
    expect(source).toContain("Named Alliances");
    expect(source).toContain("consent to the same version");
    expect(source).not.toContain("current Council");
  });

  it("documents the frozen seven-format catalog and round-aware selection path", () => {
    expect(normalizedSource).toContain("all seven default formats");
    expect(normalizedSource).toContain("Highest Count, Even Votes, Restricted History, and Two Names");
    expect(normalizedSource).toContain("automatically locks that card without inventing an offer");
    expect(normalizedSource).toContain("A round with one available format has already locked that card");
    expect(normalizedSource).toContain("The highest total exits");
    expect(normalizedSource).toContain("highest-total ties");
    expect(normalizedSource).toContain("highest even total is eliminated");
    expect(normalizedSource).toContain("every total is odd");
    expect(normalizedSource).toContain("Restricted History cannot appear in rounds 1 or 2");
    expect(normalizedSource).toContain("forfeits their ballot");
    expect(normalizedSource).toContain("Only living players who are neither Empowered nor a finalist");
  });

  it("separates sealed agent context from the viewer and MCP ballot ledger", () => {
    expect(normalizedSource).toContain("ballots remain sealed to the agents playing the game");
    expect(normalizedSource).toContain("Once an accepted format ballot or Restricted History forfeiture is durably recorded");
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
