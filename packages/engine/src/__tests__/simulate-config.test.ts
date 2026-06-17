import { describe, expect, it } from "bun:test";
import {
  buildSimulationConfig,
  computeAggregateStats,
  formatAgentTurnTrace,
  isMingleVariant,
  isPowerLobbyVariant,
  parseArgs,
  serializeAgentTurnEvent,
  serializeCanonicalGameEvent,
  type GameResult,
} from "../simulate";
import type { AgentTurnEvent } from "../game-runner";
import type { IAgent, StrategyPacketSummary } from "../game-runner.types";
import type { CanonicalGameEvent } from "../canonical-events";
import { GameState } from "../game-state";
import { replayCanonicalEvents } from "../game-projection";
import { instrumentGame } from "../simulation-instrumentation";
import { transcriptThinkingFor } from "../phases/phase-runner-context";
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
    expect(config.mingleSessionsPerRound).toBe(3);
  });

  it("applies simulator-only LLM call bounds", () => {
    const config = buildSimulationConfig("mingle");

    expect(config.lobbyMessagesPerPlayer).toBe(1);
    expect(config.maxDiaryFollowUps).toBe(0);
    expect(config.diaryRoomAfterPhases).toEqual([]);
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

  it("can print live House summaries without chatty transcript output", () => {
    const args = parseArgs(["--house-summaries"]);

    expect(args.houseSummaries).toBe(true);
    expect(args.chatty).toBe(false);
  });

  it("supports the short summaries alias and explicit disable flag", () => {
    expect(parseArgs(["--summaries"]).houseSummaries).toBe(true);
    expect(parseArgs(["--summaries", "--no-house-summaries"]).houseSummaries).toBe(false);
  });

  it("enables rich producer simulation mode from CLI args", () => {
    const args = parseArgs(["--rich-producer"]);
    const config = buildSimulationConfig("mingle", {
      richProducer: args.richProducer,
      enableDiary: args.enableDiary,
      enableStrategicReflections: args.enableStrategicReflections,
    });

    expect(args.richProducer).toBe(true);
    expect(args.enableDiary).toBe(true);
    expect(args.enableStrategicReflections).toBe(true);
    expect(config.enableStrategicReflections).toBe(true);
    expect(config.diaryRoomAfterPhases).toEqual([Phase.COUNCIL]);
    expect(config.enableHouseRoundSummaries).toBe(true);
    expect(config.enableHouseStrategyBible).toBe(true);
    expect(config.enableHouseLongFormSummaries).toBe(true);
    expect(config.enableHouseProducerBriefs).toBe(true);
  });

  it("can enable bounded diary sessions without rich producer packets", () => {
    const args = parseArgs(["--diary"]);
    const config = buildSimulationConfig("mingle", {
      richProducer: args.richProducer,
      enableDiary: args.enableDiary,
    });

    expect(args.enableDiary).toBe(true);
    expect(args.richProducer).toBe(false);
    expect(config.diaryRoomAfterPhases).toEqual([Phase.COUNCIL]);
    expect(config.enableHouseRoundSummaries).toBe(true);
    expect(config.enableHouseStrategyBible).toBe(false);
    expect(config.enableHouseLongFormSummaries).toBe(false);
    expect(config.enableHouseProducerBriefs).toBe(false);
  });

  it("does not configure hidden pair cooldown for simulator variants", () => {
    expect("minglePairCooldownRounds" in buildSimulationConfig("baseline")).toBe(false);
    expect("minglePairCooldownRounds" in buildSimulationConfig("mingle")).toBe(false);
    expect("minglePairCooldownRounds" in buildSimulationConfig("power-lobby")).toBe(false);
    expect(buildSimulationConfig("mingle").mingleSessionsPerRound).toBe(3);
  });

  it("maps single-feature simulator variants to the correct flags", () => {
    expect(isPowerLobbyVariant("power-lobby")).toBe(true);
    expect(isMingleVariant("power-lobby")).toBe(false);
    expect(buildSimulationConfig("power-lobby").powerLobbyAfterVote).toBe(true);

    expect(isPowerLobbyVariant("mingle")).toBe(false);
    expect(isMingleVariant("mingle")).toBe(true);
    expect(buildSimulationConfig("mingle").powerLobbyAfterVote).toBe(false);
    expect(buildSimulationConfig("mingle").mingleSessionsPerRound).toBe(3);
  });

  it("maps combined simulator variants to both experimental flags", () => {
    const config = buildSimulationConfig("power-lobby-mingle");

    expect(isPowerLobbyVariant("power-lobby-mingle")).toBe(true);
    expect(isMingleVariant("power-lobby-mingle")).toBe(true);
    expect(config.powerLobbyAfterVote).toBe(true);
    expect(config.mingleSessionsPerRound).toBe(3);
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

  it("formats private-only Mingle agent-turn traces for chatty live output", () => {
    const event: AgentTurnEvent = {
      type: "agent_turn",
      round: 1,
      phase: Phase.MINGLE,
      timestamp: 1_700_000_000_000,
      action: "mingle-turn",
      actor: { id: "atlas-id", name: "Atlas", role: "player" },
      visibility: "private",
      response: { action: "no_reply", messageDelivered: false },
      thinking: "Atlas should pressure Rune without sounding desperate.",
      reasoningContext: "Native trace about post-vote pressure.",
      scope: "mingle",
      to: ["Rune"],
      roomId: 2,
    };

    const formatted = formatAgentTurnTrace(event);

    expect(formatted).toContain("R1/MINGLE Atlas [trace:mingle-turn→Rune room=2]");
    expect(formatted).toContain("thinking: Atlas should pressure Rune without sounding desperate.");
    expect(formatted).toContain("reasoning: Native trace about post-vote pressure.");
    expect(formatted).toContain("\x1b[97mthinking:");
    expect(formatted).toContain("\x1b[96mreasoning:");
    expect(formatted).not.toContain("\x1b[2m\x1b[90mthinking:");
  });

  it("formats private-only non-Mingle agent-turn traces for chatty live output", () => {
    const event: AgentTurnEvent = {
      type: "agent_turn",
      round: 1,
      phase: Phase.VOTE,
      timestamp: 1_700_000_000_000,
      action: "strategic-reflection",
      actor: { id: "atlas-id", name: "Atlas", role: "player" },
      visibility: "private",
      response: { plan: "Keep Mira close and test Vera." },
      thinking: "Private reflection should be visible in chatty output.",
    };

    const formatted = formatAgentTurnTrace(event);

    expect(formatted).toContain("R1/VOTE Atlas [trace:strategic-reflection]");
    expect(formatted).toContain("thinking: Private reflection should be visible in chatty output.");
  });

  it("formats private exposure-bench choice traces without treating them as public transcript", () => {
    const event: AgentTurnEvent = {
      type: "agent_turn",
      round: 1,
      phase: Phase.VOTE,
      timestamp: 1_700_000_000_000,
      action: "candidate-selection",
      actor: { id: "mira-id", name: "Mira", role: "player" },
      visibility: "private",
      response: {
        eligibleChoices: [{ id: "nyx-id", name: "Nyx" }],
        selectedCandidates: [{ id: "nyx-id", name: "Nyx" }],
        fallbackApplied: false,
      },
      thinking: "Choosing Nyx creates debt I can cite later.",
      reasoningContext: "Native trace for accountable candidate choice.",
      scope: "system",
      text: "Mira privately resolved Council candidate ambiguity.",
    };

    const serialized = serializeAgentTurnEvent(1, 1_700_000_000_000, event, 1_700_000_000_500);
    const formatted = formatAgentTurnTrace(event);

    expect(serialized).toMatchObject({
      type: "agent_turn",
      action: "candidate-selection",
      visibility: "private",
      thinking: "Choosing Nyx creates debt I can cite later.",
      reasoningContext: "Native trace for accountable candidate choice.",
    });
    expect(formatted).toContain("R1/VOTE Mira [trace:candidate-selection]");
    expect(formatted).toContain("Mira privately resolved Council candidate ambiguity.");
    expect(formatted).toContain("thinking: Choosing Nyx creates debt I can cite later.");
    expect(formatted).toContain("reasoning: Native trace for accountable candidate choice.");
  });

  it("does not duplicate transcript-backed agent-turn traces in chatty live output", () => {
    const event: AgentTurnEvent = {
      type: "agent_turn",
      round: 1,
      phase: Phase.VOTE,
      timestamp: 1_700_000_000_000,
      action: "vote",
      actor: { id: "atlas-id", name: "Atlas", role: "player" },
      visibility: "private",
      response: { empower: "Mira", expose: "Vera" },
      thinking: "Vote math is already shown on the transcript entry.",
    };

    expect(formatAgentTurnTrace(event)).toBeNull();
  });

  it("keeps transcript thinking when an agent has a strategy packet", () => {
    const strategyPacket: StrategyPacketSummary = {
      revisionId: "r1-vote-1",
      previousRevisionId: null,
      updatedAtRound: 1,
      updatedAtPhase: Phase.VOTE,
      objective: "Keep Mira close.",
      targetPosture: "Pressure Vera.",
      coalitionPosture: "Stay warm with Atlas.",
      nextSocialProbe: "Ask Rune about the vote.",
      strategicLens: "information_control",
      strategicLensRationale: "The vote exposed unstable alliances.",
      uncertainty: "Whether Vera is actually isolated.",
      reviseTrigger: "Mira breaks trust.",
      changedSincePrevious: "initial packet",
    };
    const agent = {
      getStrategyPacket: () => strategyPacket,
    } as unknown as IAgent;

    expect(transcriptThinkingFor(agent, "Use the packet, but revise if needed.", "Native trace.")).toEqual({
      thinking: "Use the packet, but revise if needed.",
      reasoningContext: "Native trace.",
    });
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

  it("replays simulator JSONL records and API persisted envelopes through the same projection contract", () => {
    let tick = 0;
    const gameState = new GameState(
      [
        { id: "atlas-id", name: "Atlas" },
        { id: "mira-id", name: "Mira" },
        { id: "vera-id", name: "Vera" },
        { id: "rex-id", name: "Rex" },
      ],
      {
        gameId: "game-fixed",
        now: () => 1_700_000_000_000 + tick++,
      },
    );
    gameState.startRound();
    gameState.recordVote("atlas-id", "mira-id", "vera-id");
    const events = gameState.getCanonicalEvents();

    const simulatorJsonlEnvelopes = events.map((event) =>
      serializeCanonicalGameEvent(1, 1_700_000_000_000, event).canonicalEvent as CanonicalGameEvent
    );
    const apiPersistedEnvelopes = events.map((event) => ({
      sequence: event.sequence,
      eventType: event.type,
      envelope: event,
    }));

    expect(replayCanonicalEvents(simulatorJsonlEnvelopes)).toEqual(gameState.getDomainProjection());
    expect(replayCanonicalEvents(apiPersistedEnvelopes.map((row) => row.envelope))).toEqual(gameState.getDomainProjection());
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
