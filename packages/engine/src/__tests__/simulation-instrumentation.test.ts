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

function room(roomId: number, playerIds: string[], round: number, beat = 1) {
  return { roomId, playerIds, round, beat };
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
          rooms: [room(1, ["p1", "p2"], 1)],
          excluded: ["Finn"],
        },
      },
      {
        ...systemEntry(2, Phase.WHISPER, "Room 1: Vera & Atlas"),
        roomMetadata: {
          rooms: [room(1, ["p2", "p1"], 2)],
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
            rooms: [room(1, ["p1", "p2"], 1)],
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
    expect(aggregate.powerActions.actorCounts.Atlas).toBe(2);
    expect(aggregate.powerActions.actionDistributionByActor.Atlas?.protect).toBe(2);
    expect(aggregate.powerActions.repeatedProtectSameTarget.total).toBe(0);
    expect(aggregate.rooms.participationByPlayer.Atlas).toBe(2);
    expect(aggregate.rooms.repeatedPairs.totalRepeatedOccurrences).toBe(0);
    expect(aggregate.actionUsage.byAction.power?.callCount).toBe(2);
    expect(aggregate.actionUsage.bySource["Atlas/power"]?.totalTokens).toBe(50);
  });

  it("preserves whisper request diagnostics and aggregates audit flags", () => {
    const diagnostics = {
      round: 2,
      beat: 1,
      roomCount: 1,
      eligiblePlayers: [
        { id: "p1", name: "Atlas" },
        { id: "p2", name: "Vera" },
        { id: "p3", name: "Finn" },
      ],
      choices: [
        {
          player: { id: "p1", name: "Atlas" },
          requestedRoomId: 1,
          assignedRoomId: 1,
          status: "valid" as const,
        },
        {
          player: { id: "p2", name: "Vera" },
          requestedRoomId: 1,
          assignedRoomId: 1,
          status: "valid" as const,
        },
        {
          player: { id: "p3", name: "Finn" },
          requestedRoomId: null,
          assignedRoomId: 1,
          status: "missing" as const,
        },
      ],
      allocatedRooms: [
        {
          roomId: 1,
          players: [
            { id: "p1", name: "Atlas" },
            { id: "p2", name: "Vera" },
          ],
          beat: 1,
          conversationRan: true,
        },
      ],
    };
    const game = instrumentGame(
      [
        {
          ...systemEntry(2, Phase.WHISPER, "Room 1: Atlas & Vera | Commons: Finn"),
          roomMetadata: {
            rooms: [room(1, ["p1", "p2", "p3"], 2)],
            excluded: [],
            diagnostics,
          },
        },
      ],
      {},
      { p1: "Atlas", p2: "Vera", p3: "Finn" },
    );

    expect(game.rooms.whisperSessions).toEqual([diagnostics]);
    expect(game.rooms.requestSatisfaction.validRequests).toBe(2);
    expect(game.rooms.requestSatisfaction.invalidOrMissingRequests).toBe(1);

    const aggregate = aggregateInstrumentation([game, game]);
    expect(aggregate.rooms.whisperSessions).toHaveLength(2);
    expect(aggregate.rooms.requestSatisfaction.validRequests).toBe(4);
    expect(aggregate.rooms.requestSatisfaction.invalidOrMissingRequests).toBe(2);
  });

  it("summarizes repeated empowered actor and action patterns", () => {
    const instrumentation = instrumentGame(
      [
        systemEntry(1, Phase.POWER, "Lyra power action: eliminate -> Kael"),
        systemEntry(2, Phase.POWER, "Lyra power action: eliminate -> Atlas"),
        systemEntry(3, Phase.POWER, "Kael power action: protect -> Echo"),
        systemEntry(4, Phase.POWER, "Kael power action: protect -> Echo"),
        systemEntry(5, Phase.POWER, "Lyra power action: pass -> Vera"),
      ],
      {},
      {},
    );

    expect(instrumentation.powerActions.actorCounts.Lyra).toBe(3);
    expect(instrumentation.powerActions.actorCounts.Kael).toBe(2);
    expect(instrumentation.powerActions.actionDistributionByActor.Lyra?.eliminate).toBe(2);
    expect(instrumentation.powerActions.actionDistributionByActor.Lyra?.pass).toBe(1);
    expect(instrumentation.powerActions.actionDistributionByActor.Kael?.protect).toBe(2);
    expect(instrumentation.powerActions.consecutiveEliminates.total).toBe(1);
    expect(instrumentation.powerActions.consecutiveEliminates.occurrences[0]).toEqual({
      actor: "Lyra",
      previousRound: 1,
      round: 2,
      previousTarget: "Kael",
      target: "Atlas",
    });
    expect(instrumentation.powerActions.repeatedProtectSameTarget.total).toBe(1);
    expect(instrumentation.powerActions.repeatedProtectSameTarget.repeats[0]).toEqual({
      actor: "Kael",
      target: "Echo",
      protectActions: 2,
      repeatedOccurrences: 1,
      rounds: [3, 4],
    });

    const aggregate = aggregateInstrumentation([instrumentation, instrumentation]);
    expect(aggregate.powerActions.actorCounts.Lyra).toBe(6);
    expect(aggregate.powerActions.actionDistributionByActor.Kael?.protect).toBe(4);
    expect(aggregate.powerActions.consecutiveEliminates.total).toBe(2);
    expect(aggregate.powerActions.repeatedProtectSameTarget.total).toBe(2);
    expect(aggregate.powerActions.repeatedProtectSameTarget.repeats[0]?.protectActions).toBe(4);
    expect(aggregate.powerActions.repeatedProtectSameTarget.repeats[0]?.repeatedOccurrences).toBe(2);
  });

  it("handles 8-player room participation, exclusions, and repeated pairs", () => {
    const playerNameById = {
      p0: "Atlas",
      p1: "Vera",
      p2: "Finn",
      p3: "Mira",
      p4: "Rex",
      p5: "Lyra",
      p6: "Kael",
      p7: "Echo",
    };

    const transcript: TranscriptEntry[] = [
      {
        ...systemEntry(
          1,
          Phase.WHISPER,
          "Room 1: Atlas & Vera | Room 2: Finn & Mira | Room 3: Rex & Lyra | Commons: Kael, Echo",
        ),
        roomMetadata: {
          rooms: [
            room(1, ["p0", "p1"], 1),
            room(2, ["p2", "p3"], 1),
            room(3, ["p4", "p5"], 1),
          ],
          excluded: ["Kael", "Echo"],
        },
      },
      {
        ...systemEntry(
          2,
          Phase.WHISPER,
          "Room 1: Vera & Atlas | Room 2: Kael & Echo | Room 3: Finn & Rex | Commons: Mira, Lyra",
        ),
        roomMetadata: {
          rooms: [
            room(1, ["p1", "p0"], 2),
            room(2, ["p6", "p7"], 2),
            room(3, ["p2", "p4"], 2),
          ],
          excluded: ["Mira", "Lyra"],
        },
      },
      systemEntry(2, Phase.POWER, "Rex power action: pass -> Atlas"),
    ];

    const instrumentation = instrumentGame(
      transcript,
      {
        "Atlas/room-request": usage({ callCount: 2, totalTokens: 80 }),
        "Rex/power": usage({ callCount: 1, totalTokens: 40 }),
      },
      playerNameById,
    );

    expect(instrumentation.rooms.totalRooms).toBe(6);
    expect(instrumentation.rooms.whisperRounds).toBe(2);
    expect(instrumentation.rooms.totalExclusions).toBe(4);
    expect(instrumentation.rooms.participationByPlayer.Atlas).toBe(2);
    expect(instrumentation.rooms.participationByPlayer.Vera).toBe(2);
    expect(instrumentation.rooms.participationByPlayer.Finn).toBe(2);
    expect(instrumentation.rooms.participationByPlayer.Rex).toBe(2);
    expect(instrumentation.rooms.exclusionsByPlayer.Kael).toBe(1);
    expect(instrumentation.rooms.exclusionsByPlayer.Echo).toBe(1);
    expect(instrumentation.rooms.exclusionsByPlayer.Mira).toBe(1);
    expect(instrumentation.rooms.exclusionsByPlayer.Lyra).toBe(1);
    expect(instrumentation.rooms.repeatedPairs.totalRepeatedOccurrences).toBe(1);
    expect(instrumentation.rooms.repeatedPairs.maxPairCount).toBe(2);
    expect(instrumentation.rooms.repeatedPairs.maxPairShareOfRooms).toBeCloseTo(2 / 6);
    expect(instrumentation.rooms.repeatedPairs.maxPairShareOfWhisperRounds).toBe(1);
    expect(instrumentation.rooms.repeatedPairs.pairs[0]?.pair).toEqual(["Atlas", "Vera"]);
    expect(instrumentation.powerActions.counts.pass).toBe(1);
    expect(instrumentation.actionUsage.byAction["room-request"]?.callCount).toBe(2);
    expect(instrumentation.actionUsage.byAction.power?.totalTokens).toBe(40);
  });
});
