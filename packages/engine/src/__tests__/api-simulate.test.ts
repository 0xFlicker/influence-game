import { describe, expect, it } from "bun:test";
import {
  buildGameCreateBody,
  catalogIdFromProviderAndModel,
  defaultApiSimulationMaxRounds,
  parseArgs,
} from "../api-simulate";
import { computeMaxRounds, MIN_NEW_GAME_PLAYERS } from "../types";

describe("API-backed simulation config", () => {
  it("defaults new API simulation games to the shared six-player minimum", () => {
    const args = parseArgs([], {});

    expect(args.players).toBe(MIN_NEW_GAME_PLAYERS);
    expect(args.maxRounds).toBe(7);
  });

  it("rejects invalid or under-minimum API simulation player counts", () => {
    expect(() => parseArgs(["--players", "5"], {})).toThrow("at least 6");
    expect(() => parseArgs(["--players", "not-a-number"], {})).toThrow("at least 6");
    expect(() => parseArgs([], { INFLUENCE_API_SIM_PLAYERS: "5" })).toThrow("at least 6");
  });

  it("defaults short smoke games to player-scaled max rounds", () => {
    expect(defaultApiSimulationMaxRounds(4)).toBe(5);
    expect(defaultApiSimulationMaxRounds(8)).toBe(9);
    expect(defaultApiSimulationMaxRounds(10)).toBe(11);
  });

  it("derives default max rounds after CLI player args are parsed", () => {
    const args = parseArgs(["--players", "6", "--provider", "katana", "--model", "q-naifu-a3b"], {});

    expect(args.players).toBe(6);
    expect(args.maxRounds).toBe(7);
  });

  it("preserves explicit max rounds from env or CLI args", () => {
    expect(parseArgs(["--players", "6"], { INFLUENCE_API_SIM_MAX_ROUNDS: "7" }).maxRounds).toBe(7);
    expect(parseArgs(["--players", "6", "--max-rounds", "auto"], {}).maxRounds).toBe("auto");
    expect(parseArgs(["--players", "6", "--max-rounds", "6"], {}).maxRounds).toBe(6);
  });

  it("defaults API-backed games to Flex and forwards the standard opt-out", () => {
    const flex = parseArgs([], {});
    const standard = parseArgs(["--no-flex"], {});

    expect(catalogIdFromProviderAndModel("openai", undefined)).toBe("openai:gpt-5.6-luna");
    expect(flex.serviceTier).toBe("flex");
    expect(standard.serviceTier).toBe("auto");
    expect(buildGameCreateBody(standard, "openai:gpt-5-nano").serviceTier).toBe("auto");
  });

  it("forwards a validated format subset to API game creation", () => {
    const args = parseArgs(["--formats", "vote_bomb,majority_elimination"], {});
    expect(args.formatManifest).toEqual(["vote_bomb", "majority_elimination"]);
    expect(buildGameCreateBody(args, "openai:gpt-5.6-luna").formatManifest)
      .toEqual(["vote_bomb", "majority_elimination"]);
    expect(() => parseArgs(["--formats", "vote_bomb,vote_bomb"], {})).toThrow("duplicate");
  });
});

describe("engine max-round scaling", () => {
  it("does not force 4-player games back up to the default public cap", () => {
    expect(computeMaxRounds(4)).toBe(5);
  });
});
