import { describe, expect, it } from "bun:test";
import {
  buildSimulationConfig,
  computeAggregateStats,
  isMingleVariant,
  isPowerLobbyVariant,
  parseArgs,
  type GameResult,
} from "../simulate";
import { instrumentGame } from "../simulation-instrumentation";
import { DEFAULT_CONFIG } from "../types";
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
    progressPath: "game-1-progress.jsonl",
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
    expect(config.mingleSessionsPerRound).toBe(2);
  });

  it("applies simulator-only LLM call bounds", () => {
    const config = buildSimulationConfig("mingle");

    expect(config.lobbyMessagesPerPlayer).toBe(1);
    expect(config.maxDiaryFollowUps).toBe(0);
    expect(config.diaryRoomAfterPhases).toEqual([]);
    expect(config.enableLobbyIntent).toBe(false);
    expect(config.enableStrategicReflections).toBe(false);
    expect(config.agentActionTimeoutMs).toBe(90_000);
  });

  it("enables mild pair cooldown for mingle simulator variants", () => {
    expect(buildSimulationConfig("baseline").minglePairCooldownRounds).toBe(1);
    expect(buildSimulationConfig("mingle").minglePairCooldownRounds).toBe(1);
    expect(buildSimulationConfig("power-lobby").minglePairCooldownRounds).toBe(0);
  });

  it("maps single-feature simulator variants to the correct flags", () => {
    expect(isPowerLobbyVariant("power-lobby")).toBe(true);
    expect(isMingleVariant("power-lobby")).toBe(false);
    expect(buildSimulationConfig("power-lobby").powerLobbyAfterVote).toBe(true);

    expect(isPowerLobbyVariant("mingle")).toBe(false);
    expect(isMingleVariant("mingle")).toBe(true);
    expect(buildSimulationConfig("mingle").powerLobbyAfterVote).toBe(false);
    expect(buildSimulationConfig("mingle").mingleSessionsPerRound).toBe(2);
  });

  it("maps combined simulator variants to both experimental flags", () => {
    const config = buildSimulationConfig("power-lobby-mingle");

    expect(isPowerLobbyVariant("power-lobby-mingle")).toBe(true);
    expect(isMingleVariant("power-lobby-mingle")).toBe(true);
    expect(config.powerLobbyAfterVote).toBe(true);
    expect(config.mingleSessionsPerRound).toBe(2);
  });

  it("computes partial aggregate stats from completed games only", () => {
    const metadata = {
      variant: "power-lobby-diversity-mingle",
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
        variant: "power-lobby-diversity-mingle",
        gameTimeoutMs: 600000,
        llmTimeoutMs: 45000,
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

  it("accepts the configured max player count for CLI simulation runs", () => {
    const args = parseArgs(["--players", String(DEFAULT_CONFIG.maxPlayers)]);

    expect(args.players).toBe(DEFAULT_CONFIG.maxPlayers);
  });

  it("clamps CLI player count to configured max players", () => {
    const args = parseArgs(["--players", String(DEFAULT_CONFIG.maxPlayers + 4)]);

    expect(args.players).toBe(DEFAULT_CONFIG.maxPlayers);
  });

  it("parses bounded simulation timeout flags", () => {
    const args = parseArgs([
      "--game-timeout-sec",
      "30",
      "--llm-timeout-ms",
      "5000",
    ]);

    expect(args.gameTimeoutMs).toBe(30000);
    expect(args.llmTimeoutMs).toBe(5000);
  });

  it("uses a larger default timeout for 8-player simulation batches", () => {
    const previous = process.env.INFLUENCE_SIM_GAME_TIMEOUT_MS;
    delete process.env.INFLUENCE_SIM_GAME_TIMEOUT_MS;
    try {
      const args = parseArgs(["--players", "8"]);

      expect(args.gameTimeoutMs).toBe(900000);
    } finally {
      if (previous === undefined) {
        delete process.env.INFLUENCE_SIM_GAME_TIMEOUT_MS;
      } else {
        process.env.INFLUENCE_SIM_GAME_TIMEOUT_MS = previous;
      }
    }
  });

  it("honors explicit large simulation timeout overrides", () => {
    const args = parseArgs(["--players", "8", "--game-timeout-ms", "1200000"]);

    expect(args.gameTimeoutMs).toBe(1200000);
  });
});
