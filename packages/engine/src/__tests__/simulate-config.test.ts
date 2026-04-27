import { describe, expect, it } from "bun:test";
import {
  buildSimulationConfig,
  computeAggregateStats,
  isOpenWhisperVariant,
  isPowerLobbyVariant,
  type GameResult,
} from "../simulate";
import { instrumentGame } from "../simulation-instrumentation";
import type { TokenUsage } from "../token-tracker";

const ZERO_USAGE: TokenUsage = {
  promptTokens: 0,
  cachedTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  callCount: 0,
  emptyResponses: 0,
};

function gameResult(overrides: Partial<GameResult>): GameResult {
  return {
    gameNumber: 1,
    status: "completed",
    winnerName: "Atlas",
    winnerPersona: "strategic",
    rounds: 2,
    eliminationOrder: [],
    endgameType: "normal",
    playerPersonas: { Atlas: "strategic" },
    durationMs: 100,
    transcriptPath: "game-1.txt",
    jsonPath: "game-1.json",
    tokenUsage: {
      perAgent: {},
      total: ZERO_USAGE,
    },
    instrumentation: instrumentGame([], {}, {}),
    ...overrides,
  };
}

describe("simulation variant config", () => {
  it("leaves experiment flags off for the baseline variant", () => {
    const config = buildSimulationConfig("baseline");

    expect(config.powerLobbyAfterVote).toBe(false);
    expect(config.whisperSessionsPerRound).toBe(2);
  });

  it("maps single-feature simulator variants to the correct flags", () => {
    expect(isPowerLobbyVariant("power-lobby")).toBe(true);
    expect(isOpenWhisperVariant("power-lobby")).toBe(false);
    expect(buildSimulationConfig("power-lobby").powerLobbyAfterVote).toBe(true);

    expect(isPowerLobbyVariant("open-whisper")).toBe(false);
    expect(isOpenWhisperVariant("open-whisper")).toBe(true);
    expect(buildSimulationConfig("open-whisper").powerLobbyAfterVote).toBe(false);
    expect(buildSimulationConfig("open-whisper").whisperSessionsPerRound).toBe(2);
  });

  it("maps combined simulator variants to both experimental flags", () => {
    const config = buildSimulationConfig("power-lobby-open-whisper");

    expect(isPowerLobbyVariant("power-lobby-open-whisper")).toBe(true);
    expect(isOpenWhisperVariant("power-lobby-open-whisper")).toBe(true);
    expect(config.powerLobbyAfterVote).toBe(true);
    expect(config.whisperSessionsPerRound).toBe(2);
  });

  it("computes partial aggregate stats from completed games only", () => {
    const metadata = {
      variant: "power-lobby-diversity-whisper",
      timestamp: "2026-04-26T00:00:00.000Z",
      command: "bun run simulate -- --games 2",
      cwd: "/repo",
      git: {
        branch: "feature",
        commitSha: "abcdef",
        commitShortSha: "abcdef",
        isDirty: false,
      },
      args: {
        games: 2,
        players: 6,
        personas: null,
        model: "gpt-5-nano",
        variant: "power-lobby-diversity-whisper",
      },
    };

    const stats = computeAggregateStats(
      [
        gameResult({ gameNumber: 1 }),
        gameResult({
          gameNumber: 2,
          status: "failed",
          winnerName: undefined,
          winnerPersona: undefined,
          rounds: 0,
          endgameType: "error",
          error: "interrupted",
        }),
      ],
      "gpt-5-nano",
      metadata,
      true,
    );

    expect(stats.requestedGames).toBe(2);
    expect(stats.attemptedGames).toBe(2);
    expect(stats.completedGames).toBe(1);
    expect(stats.failedGames).toBe(1);
    expect(stats.partial).toBe(true);
    expect(stats.totalGames).toBe(1);
    expect(stats.instrumentation.totalGames).toBe(1);
  });
});
