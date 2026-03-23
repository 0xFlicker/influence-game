import { describe, it, expect } from "bun:test";
import { estimateCost, isFillAccepted } from "../lib/api";
import type { FillGameResponse } from "../lib/api";

describe("estimateCost", () => {
  it("scales cost by player count relative to 6", () => {
    // 6 players = base cost
    const cost6 = estimateCost(6, "standard");
    expect(cost6).toBe("~$0.79");

    // 12 players = 2x base cost
    const cost12 = estimateCost(12, "standard");
    expect(cost12).toBe("~$1.58");
  });

  it("returns <$0.01 for very small costs", () => {
    // budget tier with few players
    const cost = estimateCost(1, "budget");
    expect(cost).toBe("<$0.01");
  });

  it("handles budget tier at 6 players", () => {
    const cost = estimateCost(6, "budget");
    expect(cost).toBe("~$0.05");
  });

  it("handles premium tier at 6 players", () => {
    const cost = estimateCost(6, "premium");
    expect(cost).toBe("~$2.10");
  });

  it("handles 4 players", () => {
    const cost = estimateCost(4, "standard");
    // 0.79 * (4/6) = 0.5266...
    expect(cost).toBe("~$0.53");
  });
});

describe("isFillAccepted", () => {
  it("returns true for FillGameAccepted responses", () => {
    const accepted: FillGameResponse = {
      filling: true,
      slotsToFill: 3,
      filled: 1,
      totalPlayers: 2,
      maxPlayers: 6,
      players: [{ id: "1", name: "Alice", archetype: "strategic" }],
    };
    expect(isFillAccepted(accepted)).toBe(true);
  });

  it("returns false for FillGameResult responses", () => {
    const result: FillGameResponse = {
      filled: 6,
      totalPlayers: 6,
      maxPlayers: 6,
      players: [{ id: "1", name: "Alice", archetype: "strategic" }],
    };
    expect(isFillAccepted(result)).toBe(false);
  });
});
