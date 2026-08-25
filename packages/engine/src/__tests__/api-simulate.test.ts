import { describe, expect, it } from "bun:test";
import {
  buildGameCreateBody,
  catalogIdFromProviderAndModel,
  defaultApiSimulationMaxRounds,
  parseArgs,
} from "../api-simulate";
import { computeMaxRounds, MAX_NEW_GAME_PLAYERS, MIN_NEW_GAME_PLAYERS } from "../types";

describe("API-backed simulation config", () => {
  it("defaults new API simulation games to the shared six-player minimum", () => {
    const args = parseArgs([], {});

    expect(args.players).toBe(MIN_NEW_GAME_PLAYERS);
    expect(args.maxRounds).toBe(7);
  });

  it("rejects non-integer or out-of-range API simulation player counts", () => {
    const expectedError =
      `integer between ${MIN_NEW_GAME_PLAYERS} and ${MAX_NEW_GAME_PLAYERS}`;

    expect(() => parseArgs(["--players", "5"], {})).toThrow(expectedError);
    expect(() => parseArgs(["--players", "6.5"], {})).toThrow(expectedError);
    expect(() => parseArgs(["--players", "13"], {})).toThrow(expectedError);
    expect(() => parseArgs(["--players", "not-a-number"], {})).toThrow(expectedError);
    expect(() => parseArgs([], { INFLUENCE_API_SIM_PLAYERS: "5" })).toThrow(expectedError);
    expect(() => parseArgs([], { INFLUENCE_API_SIM_PLAYERS: "6.5" })).toThrow(expectedError);
    expect(() => parseArgs([], { INFLUENCE_API_SIM_PLAYERS: "13" })).toThrow(expectedError);
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

  it("accepts an ordered provider manifest with adaptive reasoning and fallback caps", () => {
    const args = parseArgs([
      "--provider-entry", "openai:gpt-5.6-luna,reasoning=action-policy",
      "--provider-entry", "katana:grok-4-5,reasoning=medium,max-calls=12",
      "--provider-entry", "katana:glm-5-2,reasoning=action-policy,max-calls=24",
    ], {});

    expect(args.providerManifest).toEqual([
      { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" },
      { catalogId: "katana:grok-4-5", reasoningPolicy: "medium", maxCallsPerGame: 12 },
      { catalogId: "katana:glm-5-2", reasoningPolicy: "action-policy", maxCallsPerGame: 24 },
    ]);
    expect(buildGameCreateBody(args).providerManifest).toEqual(args.providerManifest!);
  });

  it("rejects invalid provider-entry manifests before making an API call", () => {
    expect(() => parseArgs([
      "--provider-entry", "openai:gpt-5.6-luna",
      "--provider-entry", "katana:grok-4-5",
    ], {})).toThrow("maxCallsPerGame");
    expect(() => parseArgs([
      "--provider-entry", "openai:gpt-5.6-luna",
      "--provider-entry", "openai:gpt-5.6-luna,max-calls=1",
    ], {})).toThrow("duplicate");
  });

  it("lets explicit legacy CLI model flags override an environment manifest", () => {
    const args = parseArgs(["--model-catalog", "openai:gpt-5-nano"], {
      INFLUENCE_API_SIM_PROVIDER_MANIFEST: JSON.stringify([
        { catalogId: "katana:grok-4-5" },
      ]),
    });

    expect(args.providerManifest).toBeUndefined();
    expect(buildGameCreateBody(args).providerManifest).toEqual([
      { catalogId: "openai:gpt-5-nano", reasoningPolicy: "action-policy" },
    ]);
  });

  it("rejects mixing provider-entry with legacy model flags", () => {
    expect(() => parseArgs([
      "--provider-entry", "openai:gpt-5.6-luna",
      "--model-catalog", "openai:gpt-5-nano",
    ], {})).toThrow("Do not combine");
  });
});

describe("engine max-round scaling", () => {
  it("does not force 4-player games back up to the default public cap", () => {
    expect(computeMaxRounds(4)).toBe(5);
  });
});
