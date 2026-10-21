import { describe, expect, test } from "bun:test";
import { formatCountdown } from "../app/games/free/free-game-content";

describe("Intake countdown", () => {
  test.each([
    [100_200_000, "1d 03:50:00"],
    [604_800_000, "7d 00:00:00"],
    [86_400_000, "1d 00:00:00"],
    [86_399_000, "0d 23:59:59"],
    [61_000, "0d 00:01:01"],
    [0, "Starting soon..."],
    [-1_000, "Starting soon..."],
  ])("formats %i milliseconds as %s", (remaining, expected) => {
    expect(formatCountdown(remaining)).toBe(expected);
  });
});
