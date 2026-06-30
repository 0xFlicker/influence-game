import { describe, expect, it } from "bun:test";
import {
  ACTIVE_GAME,
  HOUSE_VENUE,
  THE_HOUSE_PRESENTS_INFLUENCE,
} from "../lib/product-identity";

describe("product identity", () => {
  it("names The House as the venue and Influence as the active game", () => {
    expect(HOUSE_VENUE.name).toBe("The House");
    expect(HOUSE_VENUE.domain).toBe("thehouse.game");
    expect(ACTIVE_GAME.id).toBe("influence");
    expect(ACTIVE_GAME.name).toBe("Influence");
    expect(THE_HOUSE_PRESENTS_INFLUENCE).toBe("The House presents Influence");
  });

  it("does not expose future games as playable identity", () => {
    const serialized = JSON.stringify({
      venue: HOUSE_VENUE,
      activeGame: ACTIVE_GAME,
      presentation: THE_HOUSE_PRESENTS_INFLUENCE,
    });

    expect(serialized).not.toContain("Werewolf");
    expect(serialized).not.toContain("Mafia");
    expect(serialized).not.toContain("Salem");
  });
});
