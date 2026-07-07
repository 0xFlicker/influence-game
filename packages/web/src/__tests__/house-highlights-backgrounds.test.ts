import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  houseHighlightBackdropAsset,
  houseHighlightBackdropClass,
  houseHighlightGeneratedBackgroundAsset,
} from "../app/games/[slug]/components/house-highlights-backgrounds";

describe("house highlights backgrounds", () => {
  it("maps safe reusable categories to static plate assets", () => {
    expect(houseHighlightBackdropAsset("abstract_vote_board"))
      .toBe("/house-highlights/plates/abstract-vote-board.svg");
    expect(houseHighlightBackdropClass("abstract_vote_board"))
      .toContain("abstract-vote-board.svg");
    expect(houseHighlightBackdropClass("abstract_vote_board"))
      .toContain("linear-gradient");
  });

  it("falls back for unknown categories without requiring an asset", () => {
    expect(houseHighlightBackdropAsset("mystery_backdrop")).toBeNull();
    expect(houseHighlightBackdropClass("mystery_backdrop")).toContain("#111113");
  });

  it("maps every visual type to a generated background asset", () => {
    const visualTypes = [
      "alliance_formation",
      "alliance_rupture",
      "betrayal_vote",
      "vote_flip",
      "unlikely_survival",
      "shield_survival",
      "power_streak",
      "council_slate",
      "revenge_vote",
      "jury_judgment",
      "endgame_collapse",
    ];

    for (const visualType of visualTypes) {
      const asset = houseHighlightGeneratedBackgroundAsset(visualType);
      expect(asset).toMatch(/^\/house-highlights\/generated\/.+\.jpg$/);
      expect(existsSync(join(import.meta.dir, "../../public", asset!.replace(/^\//, "")))).toBe(true);
    }
    expect(houseHighlightGeneratedBackgroundAsset("mystery_visual")).toBeNull();
  });
});
