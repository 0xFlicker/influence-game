import { describe, expect, it } from "bun:test";
import {
  houseHighlightBackdropAsset,
  houseHighlightBackdropClass,
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
});
