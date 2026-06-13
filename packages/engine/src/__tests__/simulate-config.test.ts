import { describe, expect, it } from "bun:test";
import {
  buildSimulationConfig,
  computeAggregateStats,
  isMingleVariant,
  isPowerLobbyVariant,
  parseArgs,
  serializeAgentTurnEvent,
  serializeCanonicalGameEvent,
  type GameResult,
} from "../simulate";
import type { AgentTurnEvent } from "../game-runner";
import type { CanonicalGameEvent } from "../canonical-events";
import { instrumentGame } from "../simulation-instrumentation";
import { DEFAULT_CONFIG, Phase } from "../types";
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
    turnsPath: "game-1-turns.jsonl",
    eventsPath: "game-1-events.jsonl",
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

  it("can opt simulation runs into strategic-reflection capture", () => {
    const args = parseArgs(["--strategic-reflections"]);
    const config = buildSimulationConfig("mingle", {
      enableStrategicReflections: args.enableStrategicReflections,
    });

    expect(args.enableStrategicReflections).toBe(true);
    expect(config.enableStrategicReflections).toBe(true);
  });

  it("does not configure hidden pair cooldown for simulator variants", () => {
    expect("minglePairCooldownRounds" in buildSimulationConfig("baseline")).toBe(false);
    expect("minglePairCooldownRounds" in buildSimulationConfig("mingle")).toBe(false);
    expect("minglePairCooldownRounds" in buildSimulationConfig("power-lobby")).toBe(false);
    expect(buildSimulationConfig("mingle").mingleSessionsPerRound).toBe(2);
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
        enableStrategicReflections: false,
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

  it("serializes agent turns as clean structured JSON records", () => {
    const event: AgentTurnEvent = {
      type: "agent_turn",
      round: 1,
      phase: Phase.VOTE,
      timestamp: 1_700_000_000_000,
      action: "vote",
      actor: { id: "atlas-id", name: "Atlas", role: "player" },
      visibility: "private",
      response: {
        empowerTarget: { id: "mira-id", name: "\x1b[33mMira\x1b[0m" },
        exposeTarget: { id: "vera-id", name: "Vera" },
      },
      thinking: "\x1b[2mMira is my ally.\x1b[0m",
      reasoningContext: "\x1b[36mHidden local reasoning.\x1b[0m",
      scope: "system",
      text: "\x1b[33mAtlas votes: empower=Mira, expose=Vera\x1b[0m",
    };

    const serialized = serializeAgentTurnEvent(2, 1_700_000_000_000, event, 1_700_000_001_234);
    const json = JSON.stringify(serialized);

    expect(serialized).toMatchObject({
      timestamp: "2023-11-14T22:13:21.234Z",
      elapsedMs: 1234,
      gameNumber: 2,
      type: "agent_turn",
      action: "vote",
      thinking: "Mira is my ally.",
      reasoningContext: "Hidden local reasoning.",
      text: "Atlas votes: empower=Mira, expose=Vera",
    });
    expect(json).not.toContain("\x1b");
  });

  it("serializes canonical game events as clean structured JSON records", () => {
    const event: CanonicalGameEvent = {
      sequence: 3,
      gameId: "game-fixed",
      round: 1,
      phase: Phase.VOTE,
      type: "vote.cast",
      timestamp: "2026-06-11T00:00:00.000Z",
      source: "engine",
      visibility: "producer",
      payloadVersion: 1,
      sourcePointers: [{ kind: "agent_turn", sequence: 9, action: "vote" }],
      payload: {
        voterId: "atlas-id",
        empowerTarget: "mira-id",
        exposeTarget: "vera-id",
      },
    };

    const serialized = serializeCanonicalGameEvent(2, 1_700_000_000_000, event, 1_700_000_001_234);

    expect(serialized).toMatchObject({
      timestamp: "2023-11-14T22:13:21.234Z",
      elapsedMs: 1234,
      gameNumber: 2,
      eventSequence: 3,
      eventType: "vote.cast",
      visibility: "producer",
      payloadVersion: 1,
    });
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
