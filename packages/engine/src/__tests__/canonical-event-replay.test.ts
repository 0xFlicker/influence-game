import { describe, expect, it } from "bun:test";
import { GameRunner } from "../game-runner";
import { GameState } from "../game-state";
import { replayCanonicalEvents } from "../game-projection";
import { DEFAULT_CONFIG, Phase } from "../types";
import type { UUID } from "../types";
import type { CanonicalGameEvent } from "../canonical-events";
import { MockAgent } from "./mock-agent";

function fixedClock(): () => number {
  let ticks = 0;
  return () => 1_700_000_000_000 + ticks++;
}

describe("canonical event replay", () => {
  it("rebuilds a deterministic domain projection from fixed game and player ids", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "charlie", name: "Charlie" },
        { id: "dave", name: "Dave" },
      ],
      { gameId: "game-fixed", now: fixedClock() },
    );

    gs.startRound();
    gs.recordVote("alice", "bob", "charlie");
    gs.recordVote("bob", "alice", "charlie");
    gs.recordVote("charlie", "bob", "dave");
    gs.recordVote("dave", "bob", "charlie");
    const { empowered } = gs.tallyEmpowerVotes();
    expect(empowered).toBe("bob");

    gs.setPowerAction({ action: "protect", target: "charlie" });
    const resolved = gs.determineCandidates();
    expect(resolved.shieldGranted).toBe("charlie");

    const candidates = resolved.candidates;
    if (!candidates) throw new Error("Expected council candidates");
    expect(candidates).not.toContain("charlie");
    gs.recordCouncilVote("alice", candidates[0]);
    gs.recordCouncilVote("bob", candidates[1]);
    gs.recordCouncilVote("dave", candidates[0]);
    const eliminated = gs.tallyCouncilVotes("bob");
    gs.recordLastMessage(eliminated, "Good game.");
    gs.eliminatePlayer(eliminated);

    const replayed = replayCanonicalEvents(gs.getCanonicalEvents());

    expect(replayed).toEqual(gs.getDomainProjection());
    expect(replayed.gameId).toBe("game-fixed");
    expect(replayed.playerOrder).toEqual(["alice", "bob", "charlie", "dave"]);
  });

  it("uses recorded accepted outcomes instead of re-running randomness or phase decisions", () => {
    const events = new GameState(
      [
        { id: "alpha", name: "Alpha" },
        { id: "beta", name: "Beta" },
      ],
      { gameId: "game-fixed", now: fixedClock() },
    ).getCanonicalEvents();
    const winnerEvent: CanonicalGameEvent = {
      sequence: 2,
      gameId: "game-fixed",
      round: 4,
      phase: Phase.JURY_VOTE,
      type: "jury.winner_determined",
      timestamp: "2026-06-11T00:00:02.000Z",
      source: "engine",
      visibility: "system",
      payloadVersion: 1,
      sourcePointers: [],
      payload: {
        tally: { votes: {} },
        winnerId: "beta",
        method: "random_tiebreaker",
        voteCounts: [
          { id: "alpha", name: "Alpha", votes: 0 },
          { id: "beta", name: "Beta", votes: 0 },
        ],
      },
    };

    const first = replayCanonicalEvents([...events, winnerEvent]);
    const second = replayCanonicalEvents([...events, winnerEvent]);

    expect(first.acceptedOutcomes.juryWinner).toEqual({ winnerId: "beta", method: "random_tiebreaker" });
    expect(second.acceptedOutcomes.juryWinner).toEqual(first.acceptedOutcomes.juryWinner);
  });

  it("fails on unsupported future payload versions instead of inventing state", () => {
    const gs = new GameState([{ id: "alpha", name: "Alpha" }], { gameId: "game-fixed" });
    const invalid = { ...gs.getCanonicalEvents()[0]!, payloadVersion: 2 } as unknown as CanonicalGameEvent;

    expect(() => replayCanonicalEvents([invalid])).toThrow("Unsupported canonical event payload version");
  });

  it("fails when a canonical event log has sequence gaps", () => {
    const gs = new GameState([{ id: "alpha", name: "Alpha" }], { gameId: "game-fixed" });
    const first = gs.getCanonicalEvents()[0]!;
    const skipped: CanonicalGameEvent = {
      sequence: 3,
      gameId: "game-fixed",
      round: 1,
      phase: Phase.LOBBY,
      type: "round.started",
      timestamp: "2026-06-11T00:00:03.000Z",
      source: "engine",
      visibility: "system",
      payloadVersion: 1,
      sourcePointers: [],
      payload: { round: 1 },
    };

    expect(() => replayCanonicalEvents([first, skipped])).toThrow("expected 2 but got 3");
  });
});

describe("GameRunner canonical events", () => {
  it("uses an externally supplied game ID before emitting the roster event", async () => {
    class CapturingAgent extends MockAgent {
      startedGameId: UUID | null = null;

      override onGameStart(gameId: UUID, allPlayers: Array<{ id: UUID; name: string }>): void {
        super.onGameStart(gameId, allPlayers);
        this.startedGameId = gameId;
      }
    }

    const apiGameId = "api-game-fixed";
    const agents = [
      new CapturingAgent("alpha", "Alpha"),
      new CapturingAgent("beta", "Beta"),
      new CapturingAgent("gamma", "Gamma"),
      new CapturingAgent("delta", "Delta"),
    ];
    const runner = new GameRunner(agents, DEFAULT_CONFIG, undefined, { gameId: apiGameId });

    const firstEvent = runner.getCanonicalEvents()[0];

    expect(firstEvent?.type).toBe("game.roster_initialized");
    expect(firstEvent?.sequence).toBe(1);
    expect(firstEvent?.gameId).toBe(apiGameId);
    expect(runner.getStateSnapshot().gameId).toBe(apiGameId);

    const runPromise = runner.run();
    runner.abort();
    await runPromise;
    for (const agent of agents) {
      expect(agent.startedGameId).toBe(apiGameId);
    }
  });

  it("flushes roster events through the durable sink before agent start", async () => {
    const sinkBatches: number[][] = [];

    class CapturingAgent extends MockAgent {
      flushedSequencesAtStart: number[] = [];

      override onGameStart(gameId: UUID, allPlayers: Array<{ id: UUID; name: string }>): void {
        super.onGameStart(gameId, allPlayers);
        this.flushedSequencesAtStart = sinkBatches.flat();
      }
    }

    const agents = [
      new CapturingAgent("alpha", "Alpha"),
      new CapturingAgent("beta", "Beta"),
      new CapturingAgent("gamma", "Gamma"),
      new CapturingAgent("delta", "Delta"),
    ];
    const runner = new GameRunner(agents, DEFAULT_CONFIG, undefined, {
      gameId: "api-game-durable",
      durableEventSink: (events) => {
        sinkBatches.push(events.map((event) => event.sequence));
      },
    });
    const streamedTypes: string[] = [];
    runner.setStreamListener((event) => streamedTypes.push(event.type));

    const runPromise = runner.run();
    runner.abort();
    await expect(runPromise).rejects.toThrow("Game run aborted");

    expect(streamedTypes).not.toContain("game_over");
    expect(sinkBatches[0]).toEqual([1]);
    for (const agent of agents) {
      expect(agent.flushedSequencesAtStart).toEqual([1]);
    }
  });

  it("writes checkpoint capsules after durable event flushes", async () => {
    const flushedSequences: number[] = [];
    const checkpointViews: Array<{
      kind: string;
      sequence: number;
      flushedAtWrite: number[];
      transcriptEntries: number;
    }> = [];

    class CapturingAgent extends MockAgent {
      checkpointsAtStart = 0;

      override onGameStart(gameId: UUID, allPlayers: Array<{ id: UUID; name: string }>): void {
        super.onGameStart(gameId, allPlayers);
        this.checkpointsAtStart = checkpointViews.length;
      }
    }

    const agents = [
      new CapturingAgent("alpha", "Alpha"),
      new CapturingAgent("beta", "Beta"),
      new CapturingAgent("gamma", "Gamma"),
      new CapturingAgent("delta", "Delta"),
    ];
    const runner = new GameRunner(agents, DEFAULT_CONFIG, undefined, {
      gameId: "api-game-checkpoints",
      durableEventSink: (events) => {
        flushedSequences.push(...events.map((event) => event.sequence));
      },
      durableCheckpointSink: (checkpoint) => {
        checkpointViews.push({
          kind: checkpoint.checkpointKind,
          sequence: checkpoint.lastEventSequence,
          flushedAtWrite: [...flushedSequences],
          transcriptEntries: checkpoint.transcriptCursor.entries,
        });
      },
    });

    const runPromise = runner.run();
    runner.abort();
    await expect(runPromise).rejects.toThrow("Game run aborted");

    expect(checkpointViews[0]).toEqual({
      kind: "initial",
      sequence: 1,
      flushedAtWrite: [1],
      transcriptEntries: 0,
    });
    for (const agent of agents) {
      expect(agent.checkpointsAtStart).toBe(1);
    }
  });

  it("does not start agents when the durable sink rejects the roster event", async () => {
    class CapturingAgent extends MockAgent {
      startedGameId: UUID | null = null;

      override onGameStart(gameId: UUID, allPlayers: Array<{ id: UUID; name: string }>): void {
        super.onGameStart(gameId, allPlayers);
        this.startedGameId = gameId;
      }
    }

    const agents = [
      new CapturingAgent("alpha", "Alpha"),
      new CapturingAgent("beta", "Beta"),
      new CapturingAgent("gamma", "Gamma"),
      new CapturingAgent("delta", "Delta"),
    ];
    const streamedTypes: string[] = [];
    const runner = new GameRunner(agents, DEFAULT_CONFIG, undefined, {
      gameId: "api-game-failing-sink",
      durableEventSink: () => {
        throw new Error("durable append failed");
      },
    });
    runner.setStreamListener((event) => streamedTypes.push(event.type));

    await expect(runner.run()).rejects.toThrow("durable append failed");

    for (const agent of agents) {
      expect(agent.startedGameId).toBeNull();
    }
    expect(streamedTypes).toEqual([]);
  });

  it("replays existing roster events to listeners and exposes a live domain projection", async () => {
    const agents = [
      new MockAgent("alpha", "Alpha"),
      new MockAgent("beta", "Beta"),
      new MockAgent("gamma", "Gamma"),
      new MockAgent("delta", "Delta"),
      new MockAgent("echo", "Echo"),
    ];
    const flushedSequences: number[] = [];
    const runner = new GameRunner(agents, {
      ...DEFAULT_CONFIG,
      timers: {
        introduction: 0,
        lobby: 0,
        mingle: 0,
        rumor: 0,
        vote: 0,
        power: 0,
        council: 0,
      },
      maxRounds: 5,
      mingleSessionsPerRound: 1,
      maxDiaryFollowUps: 0,
      diaryRoomAfterPhases: [],
      enableStrategicReflections: false,
    }, undefined, {
      durableEventSink: (events) => {
        flushedSequences.push(...events.map((event) => event.sequence));
      },
    });

    const streamedTypes: string[] = [];
    runner.setCanonicalEventListener((event) => streamedTypes.push(event.type));

    await runner.run();

    expect(streamedTypes[0]).toBe("game.roster_initialized");
    expect(streamedTypes).toContain("mingle.rooms_allocated");
    expect(streamedTypes).toContain("vote.cast");
    expect(runner.getCanonicalEvents().length).toBe(streamedTypes.length);
    expect(replayCanonicalEvents(runner.getCanonicalEvents())).toEqual(runner.getDomainProjection());
    expect(runner.getCanonicalEvents().some((event) =>
      event.type === "vote.cast" &&
      event.sourcePointers.some((pointer) => pointer.kind === "agent_turn" && pointer.action === "vote"),
    )).toBe(true);
    expect(flushedSequences).toEqual(runner.getCanonicalEvents().map((event) => event.sequence));
  });
});
