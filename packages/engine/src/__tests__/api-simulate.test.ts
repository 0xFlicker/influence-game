import { describe, expect, it } from "bun:test";
import { defaultApiSimulationMaxRounds, parseArgs } from "../api-simulate";
import { computeMaxRounds } from "../types";

describe("API-backed simulation config", () => {
  it("defaults short smoke games to player-scaled max rounds", () => {
    expect(defaultApiSimulationMaxRounds(4)).toBe(5);
    expect(defaultApiSimulationMaxRounds(8)).toBe(9);
    expect(defaultApiSimulationMaxRounds(10)).toBe(11);
  });

  it("derives default max rounds after CLI player args are parsed", () => {
    const args = parseArgs(["--players", "4", "--provider", "katana", "--model", "q-naifu-a3b"], {});

    expect(args.players).toBe(4);
    expect(args.maxRounds).toBe(5);
  });

  it("preserves explicit max rounds from env or CLI args", () => {
    expect(parseArgs(["--players", "4"], { INFLUENCE_API_SIM_MAX_ROUNDS: "7" }).maxRounds).toBe(7);
    expect(parseArgs(["--players", "4", "--max-rounds", "auto"], {}).maxRounds).toBe("auto");
    expect(parseArgs(["--players", "4", "--max-rounds", "6"], {}).maxRounds).toBe(6);
  });
});

describe("engine max-round scaling", () => {
  it("does not force 4-player games back up to the default public cap", () => {
    expect(computeMaxRounds(4)).toBe(5);
  });
});
