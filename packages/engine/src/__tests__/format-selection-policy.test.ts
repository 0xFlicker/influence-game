import { describe, expect, it } from "bun:test";
import {
  canFormatAppearInStandardRounds,
  isFormatEligibleForSelection,
} from "../format-selection-policy";

describe("format selection policy", () => {
  it("keeps Restricted History out of a six-player game and admits it with eight", () => {
    expect(canFormatAppearInStandardRounds("restricted_history", 6)).toBe(false);
    expect(canFormatAppearInStandardRounds("restricted_history", 8)).toBe(true);
  });

  it("applies round and living-player eligibility independently", () => {
    expect(isFormatEligibleForSelection("restricted_history", {
      round: 2,
      livingPlayerCount: 8,
    })).toBe(false);
    expect(isFormatEligibleForSelection("two_names", {
      round: 1,
      livingPlayerCount: 4,
    })).toBe(false);
  });
});
