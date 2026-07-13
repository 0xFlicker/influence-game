import { describe, expect, test } from "bun:test";
import {
  gameCategoryLabel,
  gameCategoryValue,
  gameDisplayName,
  gameHref,
} from "../lib/game-identity";

describe("game identity", () => {
  test("uses the exact persisted slug for display and navigation", () => {
    const game = { slug: "vast-sage-coal" };
    expect(gameDisplayName(game)).toBe("vast-sage-coal");
    expect(gameHref(game)).toBe("/games/vast-sage-coal");
  });

  test("gives persisted season identity precedence over the free track", () => {
    const game = {
      trackType: "free" as const,
      season: { id: "season-id", name: "Season 0" },
    };
    expect(gameCategoryValue(game)).toBe("season:season-id");
    expect(gameCategoryLabel(game)).toBe("Season 0");
  });

  test("keeps unseasoned free games discoverable and leaves custom games unbadged", () => {
    expect(gameCategoryValue({ trackType: "free" })).toBe("free");
    expect(gameCategoryLabel({ trackType: "free" })).toBe("Free");
    expect(gameCategoryValue({ trackType: "custom" })).toBe("custom");
    expect(gameCategoryLabel({ trackType: "custom" })).toBeNull();
  });
});
