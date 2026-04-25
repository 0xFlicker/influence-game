import { describe, expect, it } from "bun:test";
import type { TranscriptEntry } from "../game-runner.types";
import { aggregateInstrumentation, instrumentGame } from "../simulation-instrumentation";
import type { TokenUsage } from "../token-tracker";
import { Phase } from "../types";

function usage(overrides: Partial<TokenUsage>): TokenUsage {
  return {
    promptTokens: 0,
    cachedTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    callCount: 0,
    emptyResponses: 0,
    ...overrides,
  };
}

function systemEntry(round: number, phase: Phase, text: string): TranscriptEntry {
  return {
    round,
    phase,
    timestamp: 1_700_000_000_000,
    from: "House",
    scope: "system",
    text,
  };
}

describe("simulation instrumentation", () => {
  it("extracts experiment counts from transcript metadata and token usage", () => {
    const transcript: TranscriptEntry[] = [
      systemEntry(1, Phase.POWER, "Vera power action: eliminate -> Finn"),
      systemEntry(1, Phase.POWER, "AUTO-ELIMINATE: Finn"),
      systemEntry(2, Phase.REVEAL, "=== REVEAL PHASE === Council candidates: Atlas vs Rex"),
      systemEntry(2, Phase.COUNCIL, "=== COUNCIL PHASE ==="),
      systemEntry(2, Phase.COUNCIL, "Atlas council vote -> Rex"),
      {
        ...systemEntry(1, Phase.WHISPER, "Room 1: Atlas & Vera | Commons: Finn"),
        roomMetadata: {
          rooms: [{ roomId: 1, playerA: "p1", playerB: "p2", round: 1 }],
          excluded: ["Finn"],
        },
      },
      {
        ...systemEntry(2, Phase.WHISPER, "Room 1: Vera & Atlas"),
        roomMetadata: {
          rooms: [{ roomId: 1, playerA: "p2", playerB: "p1", round: 2 }],
          excluded: [],
        },
      },
      systemEntry(3, Phase.PLEA, "=== RECKONING: PLEA PHASE ==="),
      systemEntry(4, Phase.ACCUSATION, "=== TRIBUNAL: ACCUSATION PHASE ==="),
      systemEntry(5, Phase.OPENING_STATEMENTS, "=== THE JUDGMENT ==="),
      systemEntry(5, Phase.JURY_QUESTIONS, "=== JUDGMENT: JURY QUESTIONS ==="),
      systemEntry(5, Phase.JURY_VOTE, "=== JUDGMENT: JURY VOTE ==="),
    ];

    const instrumentation = instrumentGame(
      transcript,
      {
        "Atlas/vote": usage({ callCount: 2, totalTokens: 100 }),
        "Vera/power": usage({ callCount: 1, totalTokens: 50, emptyResponses: 1 }),
      },
      { p1: "Atlas", p2: "Vera" },
    );

    expect(instrumentation.powerActions.total).toBe(1);
    expect(instrumentation.powerActions.counts.eliminate).toBe(1);
    expect(instrumentation.autoEliminations.total).toBe(1);
    expect(instrumentation.council.revealPhases).toBe(1);
    expect(instrumentation.council.councilPhases).toBe(1);
    expect(instrumentation.council.councilVotes).toBe(1);
    expect(instrumentation.endgame.reckoning).toBe(1);
    expect(instrumentation.endgame.tribunal).toBe(1);
    expect(instrumentation.endgame.judgment).toBe(3);
    expect(instrumentation.endgame.juryQuestions).toBe(1);
    expect(instrumentation.endgame.juryVotes).toBe(1);
    expect(instrumentation.rooms.participationByPlayer.Atlas).toBe(2);
    expect(instrumentation.rooms.participationByPlayer.Vera).toBe(2);
    expect(instrumentation.rooms.exclusionsByPlayer.Finn).toBe(1);
    expect(instrumentation.rooms.repeatedPairs.totalRepeatedOccurrences).toBe(1);
    expect(instrumentation.rooms.repeatedPairs.pairs[0]?.pair).toEqual(["Atlas", "Vera"]);
    expect(instrumentation.actionUsage.totalCalls).toBe(3);
    expect(instrumentation.actionUsage.totalEmptyResponses).toBe(1);
    expect(instrumentation.actionUsage.byAction.power?.emptyResponseRate).toBe(1);
  });

  it("aggregates game-level instrumentation across a batch", () => {
    const game = instrumentGame(
      [
        systemEntry(1, Phase.POWER, "Atlas power action: protect -> Vera"),
        {
          ...systemEntry(1, Phase.WHISPER, "Room 1: Atlas & Vera"),
          roomMetadata: {
            rooms: [{ roomId: 1, playerA: "p1", playerB: "p2", round: 1 }],
            excluded: [],
          },
        },
      ],
      {
        "Atlas/power": usage({ callCount: 1, totalTokens: 25 }),
      },
      { p1: "Atlas", p2: "Vera" },
    );

    const aggregate = aggregateInstrumentation([game, game]);

    expect(aggregate.totalGames).toBe(2);
    expect(aggregate.powerActions.counts.protect).toBe(2);
    expect(aggregate.rooms.participationByPlayer.Atlas).toBe(2);
    expect(aggregate.rooms.repeatedPairs.totalRepeatedOccurrences).toBe(0);
    expect(aggregate.actionUsage.byAction.power?.callCount).toBe(2);
    expect(aggregate.actionUsage.bySource["Atlas/power"]?.totalTokens).toBe(50);
  });
});
