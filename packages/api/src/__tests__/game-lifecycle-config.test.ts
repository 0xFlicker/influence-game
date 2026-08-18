import { describe, expect, test } from "bun:test";
import { Phase } from "@influence/engine";
import { buildEngineConfigFromGameRecord } from "../services/game-lifecycle.js";

describe("game lifecycle engine config", () => {
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

  test("forwards sealed House Strategy Bible configuration from the game record", () => {
    const config = buildEngineConfigFromGameRecord(
      {
        maxRounds: 8,
        enableHouseStrategyBible: true,
        enableHouseRoundSummaries: false,
        enableHouseLongFormSummaries: true,
        enableHouseProducerBriefs: false,
      },
      4,
      8,
    );

    expect(config.enableHouseStrategyBible).toBe(true);
    expect(config.enableHouseRoundSummaries).toBe(false);
    expect(config.enableHouseLongFormSummaries).toBe(true);
    expect(config.enableHouseProducerBriefs).toBe(false);
  });
});
