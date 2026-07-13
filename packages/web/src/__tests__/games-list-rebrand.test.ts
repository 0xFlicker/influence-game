import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const gamesBrowserSource = readFileSync(
  join(import.meta.dir, "../app/games/games-browser.tsx"),
  "utf8",
);
const gamesPageSource = readFileSync(
  join(import.meta.dir, "../app/games/page.tsx"),
  "utf8",
);
const combinedSource = `${gamesBrowserSource}\n${gamesPageSource}`;

describe("games list House/Influence rebrand", () => {
  it("uses canonical slugs for row identity while keeping the Influence badge", () => {
    expect(gamesBrowserSource).toContain("gameDisplayName(game)");
    expect(gamesBrowserSource).not.toContain("gameNumber");
    expect(gamesBrowserSource).toContain("ACTIVE_GAME.badgeLabel");
    expect(gamesBrowserSource).toContain("rounded-sm bg-emerald-500/20");
  });

  it("makes Influence, slugs, and season names searchable", () => {
    expect(gamesBrowserSource).toContain("ACTIVE_GAME.name");
    expect(gamesBrowserSource).toContain("g.slug");
    expect(gamesBrowserSource).toContain("g.season?.name");
    expect(gamesBrowserSource).toContain("haystack");
    expect(gamesBrowserSource).not.toContain("game.title");
    expect(gamesBrowserSource).not.toContain("game.ruleset");
  });

  it("offers dynamic season categories without tier filters", () => {
    expect(gamesBrowserSource).toContain('label: season.name');
    expect(gamesBrowserSource).toContain('label: "Free"');
    expect(gamesBrowserSource).toContain('label: "Custom"');
    expect(gamesBrowserSource).not.toContain("TierFilter");
    expect(gamesBrowserSource).not.toContain("Any tier");
  });

  it("does not expose future social deduction games as list options", () => {
    expect(combinedSource).not.toContain("Werewolf");
    expect(combinedSource).not.toContain("Mafia");
    expect(combinedSource).not.toContain("Salem");
  });
});
