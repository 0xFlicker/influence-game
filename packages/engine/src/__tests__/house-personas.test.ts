import { describe, expect, it } from "bun:test";
import { getHousePersonaDetails } from "../house-personas";

describe("House persona prompt defaults", () => {
  it("describes the martyr through social-game risk without scapegoat language", () => {
    const martyr = getHousePersonaDetails("martyr");

    expect(martyr.strategyHints).toContain("take blame for allies");
    expect(martyr.strategyHints).not.toContain("scapegoat");
  });
});
