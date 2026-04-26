import { describe, expect, it } from "bun:test";
import {
  buildSimulationConfig,
  isAntiRepeatWhisperVariant,
  isPowerLobbyVariant,
} from "../simulate";

describe("simulation variant config", () => {
  it("leaves experiment flags off for the baseline variant", () => {
    const config = buildSimulationConfig("baseline");

    expect(config.powerLobbyAfterVote).toBe(false);
    expect(config.experimentalAntiRepeatWhisperRooms).toBe(false);
  });

  it("maps single-feature simulator variants to the correct flags", () => {
    expect(isPowerLobbyVariant("power-lobby")).toBe(true);
    expect(isAntiRepeatWhisperVariant("power-lobby")).toBe(false);
    expect(buildSimulationConfig("power-lobby").powerLobbyAfterVote).toBe(true);
    expect(buildSimulationConfig("power-lobby").experimentalAntiRepeatWhisperRooms).toBe(false);

    expect(isPowerLobbyVariant("anti-repeat")).toBe(false);
    expect(isAntiRepeatWhisperVariant("anti-repeat")).toBe(true);
    expect(buildSimulationConfig("anti-repeat").powerLobbyAfterVote).toBe(false);
    expect(buildSimulationConfig("anti-repeat").experimentalAntiRepeatWhisperRooms).toBe(true);
  });

  it("maps combined simulator variants to both experimental flags", () => {
    const config = buildSimulationConfig("power-lobby-anti-repeat");

    expect(isPowerLobbyVariant("power-lobby-anti-repeat")).toBe(true);
    expect(isAntiRepeatWhisperVariant("power-lobby-anti-repeat")).toBe(true);
    expect(config.powerLobbyAfterVote).toBe(true);
    expect(config.experimentalAntiRepeatWhisperRooms).toBe(true);
  });
});
