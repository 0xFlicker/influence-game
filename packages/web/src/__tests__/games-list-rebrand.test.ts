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
  it("keeps game-number row identity while adding the Influence badge", () => {
    expect(gamesBrowserSource).toContain("Game #{game.gameNumber}");
    expect(gamesBrowserSource).toContain("ACTIVE_GAME.badgeLabel");
    expect(gamesBrowserSource).toContain("rounded-sm bg-emerald-500/20");
  });

  it("makes Influence searchable without changing the API summary shape", () => {
    expect(gamesBrowserSource).toContain("ACTIVE_GAME.name");
    expect(gamesBrowserSource).toContain("haystack");
    expect(gamesBrowserSource).not.toContain("game.title");
    expect(gamesBrowserSource).not.toContain("game.ruleset");
  });

  it("does not expose future social deduction games as list options", () => {
    expect(combinedSource).not.toContain("Werewolf");
    expect(combinedSource).not.toContain("Mafia");
    expect(combinedSource).not.toContain("Salem");
  });
});

