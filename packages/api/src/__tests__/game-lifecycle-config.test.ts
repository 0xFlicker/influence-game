import { describe, expect, test } from "bun:test";
import { Phase } from "@influence/engine";
import {
  buildEngineConfigFromGameRecord,
  providerRequestTimeoutMs,
} from "../services/game-lifecycle.js";

describe("game lifecycle engine config", () => {
  test("bounds API provider request deadlines", () => {
    expect(providerRequestTimeoutMs({})).toBe(45_000);
    expect(providerRequestTimeoutMs({ INFLUENCE_LLM_REQUEST_TIMEOUT_MS: "15000" })).toBe(15_000);
    expect(providerRequestTimeoutMs({ INFLUENCE_LLM_REQUEST_TIMEOUT_MS: "1" })).toBe(1_000);
    expect(providerRequestTimeoutMs({ INFLUENCE_LLM_REQUEST_TIMEOUT_MS: "600000" })).toBe(300_000);
    expect(providerRequestTimeoutMs({ INFLUENCE_LLM_REQUEST_TIMEOUT_MS: "invalid" })).toBe(45_000);
  });

  test("hydrates the frozen format manifest and rejects corrupt stored ids", () => {
    expect(buildEngineConfigFromGameRecord({
      formatManifest: ["vote_bomb", "majority_elimination"],
    }, 4, 8).formatManifest).toEqual(["vote_bomb", "majority_elimination"]);

    expect(buildEngineConfigFromGameRecord({}, 4, 8).formatManifest).toEqual([
      "save_or_eliminate",
      "vote_bomb",
      "safety_bounce",
    ]);
    expect(() => buildEngineConfigFromGameRecord({
      formatManifest: ["unknown_format"],
    }, 4, 8)).toThrow("registered");
  });

  test("enables format-kernel diaries while retaining the legacy Council boundary", () => {
    const config = buildEngineConfigFromGameRecord(
      {
        maxRounds: 11,
        timers: {
          introduction: 15_000,
          mingle: 20_000,
          whisper: 20_000,
        },
      },
      4,
      10,
    );

    expect(config.diaryRoomAfterPhases).toEqual([Phase.FORMAT_RESOLVE, Phase.COUNCIL]);
    expect(config.timers.mingle).toBe(20_000);
    expect("whisper" in config.timers).toBeFalse();
  });

  test("does not restore the removed strategic-reflection switch from stored config", () => {
    const config = buildEngineConfigFromGameRecord(
      { enableStrategicReflections: true },
      4,
      8,
    );

    expect("enableStrategicReflections" in config).toBeFalse();
  });

  test("forwards House narrative configuration from the game record", () => {
    const config = buildEngineConfigFromGameRecord(
      {
        maxRounds: 8,
        enableHouseRoundSummaries: false,
        enableHouseLongFormSummaries: true,
      },
      4,
      8,
    );

    expect(config.enableHouseRoundSummaries).toBe(false);
    expect(config.enableHouseLongFormSummaries).toBe(true);
  });
});
