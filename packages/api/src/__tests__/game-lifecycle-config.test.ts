import { describe, expect, test } from "bun:test";
import { Phase } from "@influence/engine";
import { buildEngineConfigFromGameRecord } from "../services/game-lifecycle.js";

describe("game lifecycle engine config", () => {
  test("enables only post-Council diary rooms for live API games", () => {
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

    expect(config.diaryRoomAfterPhases).toEqual([Phase.COUNCIL]);
    expect(config.timers.mingle).toBe(20_000);
    expect("whisper" in config.timers).toBeFalse();
  });
});
