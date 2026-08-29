import { describe, expect, it } from "bun:test";
import { GameRunner } from "../game-runner";
import { GameState } from "../game-state";
import { replayCanonicalEvents } from "../game-projection";
import { ContextBuilder } from "../context-builder";
import { compileRecallPlan } from "../context-recall-plan";
import { TranscriptLogger } from "../transcript-logger";
import { DEFAULT_CONFIG, Phase } from "../types";
import type { UUID } from "../types";
import type { CanonicalGameEvent } from "../canonical-events";
import type { GameStreamEvent } from "../game-runner.types";
import { MockAgent } from "./mock-agent";
import { formatResolutionAggregate } from "../formats";

function fixedClock(): () => number {
  let ticks = 0;
  return () => 1_700_000_000_000 + ticks++;
}

describe("canonical event replay", () => {
  it("replays private Mingle coordination receipts without changing game mechanics", () => {
    const gs = new GameState([
      { id: "alice", name: "Alice" },
      { id: "bob", name: "Bob" },
      { id: "cara", name: "Cara" },
    ], { gameId: "game-private-mingle-receipt", now: fixedClock() });
    gs.startRound();
    const beforeVotes = gs.getDomainProjection().currentVoteTally;
    gs.recordMingleCoordinationReceipt({
      id: "receipt-1",
      round: 1,
      phase: Phase.MINGLE,
      actorId: "alice",
      audiencePlayerIds: ["alice", "bob"],
      roomId: 1,
      factKind: "proposal",
      actionKind: "empower_vote",
      targetPlayerId: "bob",
      noProposal: false,
      createdAt: "2026-07-25T00:00:00.000Z",
    });

    const event = gs.getCanonicalEvents().at(-1)!;
    expect(event).toMatchObject({ type: "mingle.coordination_receipt_recorded", visibility: "producer" });
    const replayed = replayCanonicalEvents(gs.getCanonicalEvents());
    expect(replayed.mingleCoordinationReceipts["receipt-1"]?.audiencePlayerIds).toEqual(["alice", "bob"]);
    const resumed = GameState.fromCanonicalEvents(gs.getCanonicalEvents());
    expect(resumed.getMingleCoordinationReceipts()).toEqual([expect.objectContaining({
      id: "receipt-1",
      targetPlayerId: "bob",
    })]);
    expect(replayed.currentVoteTally).toEqual(beforeVotes);
  });

  it("memoizes getDomainProjection until the event head advances", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "charlie", name: "Charlie" },
        { id: "dave", name: "Dave" },
      ],
      { gameId: "game-projection-cache", now: fixedClock() },
    );
    gs.startRound();

    const first = gs.getDomainProjection();
    const second = gs.getDomainProjection();
    expect(second).toBe(first);
    expect(second).toEqual(replayCanonicalEvents(gs.getCanonicalEvents()));

    gs.recordVote("alice", "bob", "charlie");
    const afterAppend = gs.getDomainProjection();
    expect(afterAppend).not.toBe(first);
    expect(afterAppend.currentVoteTally.empowerVotes.alice).toBe("bob");
    expect(afterAppend).toEqual(replayCanonicalEvents(gs.getCanonicalEvents()));

    const afterAppendAgain = gs.getDomainProjection();
    expect(afterAppendAgain).toBe(afterAppend);
  });

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

  it("preserves and replays the deprecated last-message event contract", () => {
    const gs = new GameState(
      [{ id: "alice", name: "Alice" }],
      { gameId: "game-fixed", now: fixedClock() },
    );
    gs.startRound();

    gs.recordLastMessage("alice", "Good game.");

    const event = gs.getCanonicalEvents().at(-1);
    expect(event).toMatchObject({
      type: "player.last_message_recorded",
      phase: Phase.LOBBY,
      visibility: "public",
      payload: { playerId: "alice", message: "Good game." },
    });
    expect(gs.getPlayer("alice")?.lastMessage).toBe("Good game.");
    expect(replayCanonicalEvents(gs.getCanonicalEvents()).players.alice?.lastMessage).toBe("Good game.");
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

  it("replays prose-backed huddle v1 as safe metadata with no factual atoms", () => {
    const state = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
      ],
      { gameId: "legacy-huddle-v1", now: fixedClock() },
    );
    const roster = state.getCanonicalEvents()[0]!;
    const legacyOutcome = {
      id: "outcome-legacy",
      sessionId: "session-legacy",
      allianceId: "alliance-legacy",
      window: "pre_vote" as const,
      round: 1,
      ask: "Target Bob.",
      plan: "Everyone agreed to target Bob.",
      promises: ["Alice promised Bob safety."],
      dissent: ["No dissent."],
      confidence: "high",
      posture: "locked",
      leakOrBetrayalClaims: ["Alice leaked the plan."],
      createdAt: "2026-08-27T00:00:00.000Z",
    };
    const legacyEvent: CanonicalGameEvent = {
      sequence: 2,
      gameId: "legacy-huddle-v1",
      round: 1,
      phase: Phase.PRE_VOTE_HUDDLE,
      type: "alliance.huddle_outcome_recorded",
      timestamp: "2026-08-27T00:00:00.000Z",
      source: "replay",
      visibility: "producer",
      payloadVersion: 1,
      sourcePointers: [],
      payload: { outcome: legacyOutcome },
    };

    const projection = replayCanonicalEvents([roster, legacyEvent]);

    expect(projection.allianceHuddleOutcomes[legacyOutcome.id]).toEqual({
      id: legacyOutcome.id,
      sessionId: legacyOutcome.sessionId,
      allianceId: legacyOutcome.allianceId,
      window: legacyOutcome.window,
      round: legacyOutcome.round,
      facts: [],
      participantPlayerIds: [],
      createdAt: legacyOutcome.createdAt,
    });
    expect(JSON.stringify(projection.allianceHuddleOutcomes[legacyOutcome.id])).not.toContain("Target Bob");
  });

  it("replays historical version-1 resolution bags for the original format trio", () => {
    const state = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "cara", name: "Cara" },
      ],
      { gameId: "historical-v1-trio", now: fixedClock() },
    );
    const roster = state.getCanonicalEvents()[0]!;
    if (roster.type !== "game.roster_initialized") throw new Error("expected roster");
    const historicalRoster: CanonicalGameEvent = {
      ...roster,
      payload: { players: roster.payload.players },
    };
    const common = {
      gameId: "historical-v1-trio",
      phase: Phase.FORMAT_RESOLVE,
      source: "replay" as const,
      visibility: "public" as const,
      payloadVersion: 1 as const,
      sourcePointers: [],
    };
    const historical: CanonicalGameEvent[] = [
      {
        ...common,
        sequence: 2,
        round: 1,
        type: "format.resolved",
        timestamp: "2026-06-11T00:00:02.000Z",
        payload: {
          formatId: "save_or_eliminate",
          empoweredId: "alice",
          eliminatedId: "bob",
          resolutionKind: "auto",
          tiedPlayerIds: ["bob"],
          tiebreakerId: null,
          saveOrEliminate: {
            nets: { alice: 1, bob: -2, cara: 1 },
            savesReceived: { alice: 1, bob: 0, cara: 1 },
            eliminateReceived: { alice: 0, bob: 2, cara: 0 },
          },
          voteBomb: null,
          safetyBounce: null,
        },
      },
      {
        ...common,
        sequence: 3,
        round: 2,
        type: "format.resolved",
        timestamp: "2026-06-11T00:00:03.000Z",
        payload: {
          formatId: "vote_bomb",
          empoweredId: "alice",
          eliminatedId: "bob",
          resolutionKind: "auto",
          tiedPlayerIds: ["bob"],
          tiebreakerId: null,
          saveOrEliminate: null,
          voteBomb: {
            totals: { alice: 0, bob: 1, cara: 2 },
            zeroSafePlayerIds: ["alice"],
          },
          safetyBounce: null,
        },
      },
      {
        ...common,
        sequence: 4,
        round: 3,
        type: "format.resolved",
        timestamp: "2026-06-11T00:00:04.000Z",
        payload: {
          formatId: "safety_bounce",
          empoweredId: "alice",
          eliminatedId: "bob",
          resolutionKind: "auto",
          tiedPlayerIds: [],
          tiebreakerId: null,
          saveOrEliminate: null,
          voteBomb: null,
          safetyBounce: {
            starterId: "alice",
            safePlayerIds: ["alice", "cara"],
            vulnerablePlayerIds: ["bob"],
            voteTotals: {},
          },
        },
      },
    ];
    const events = [historicalRoster, ...historical];

    expect(() => GameState.fromCanonicalEvents(events)).not.toThrow();
    expect(replayCanonicalEvents(events).lastSequence).toBe(4);
    expect(historical.map((event) => {
      if (event.type !== "format.resolved") throw new Error("expected format resolution");
      return formatResolutionAggregate(event).capability;
    })).toEqual(["sealed_polarity", "sealed_elim", "public_chain"]);
  });

  it("rejects unsupported format.resolved payload versions", () => {
    const state = new GameState([{ id: "alpha", name: "Alpha" }], {
      gameId: "unsupported-format-version",
    });
    const invalid = {
      ...state.getCanonicalEvents()[0]!,
      type: "format.resolved",
      payloadVersion: 3,
      payload: {},
    } as unknown as CanonicalGameEvent;

    expect(() => replayCanonicalEvents([invalid])).toThrow(
      "Unsupported canonical event payload version 3 for format.resolved",
    );
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

  it("replays endgame and judgment speech as non-mutating accepted facts", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "carol", name: "Carol" },
      ],
      { gameId: "game-fixed", now: fixedClock() },
    );

    const beforeSpeech = gs.getDomainProjection();

    gs.recordEndgameSpeech({
      speechKind: "plea",
      playerId: "alice",
      text: "I deserve the final.",
      provenance: "agent",
      phase: Phase.PLEA,
      correlationKey: "endgame:plea:r0:PLEA:alice",
    });
    gs.recordEndgameSpeech({
      speechKind: "accusation",
      playerId: "bob",
      text: "Alice backstabbed me.",
      provenance: "agent",
      phase: Phase.ACCUSATION,
      targetId: "alice",
      correlationKey: "endgame:accusation:r0:ACCUSATION:bob:talice",
    });
    gs.recordEndgameSpeech({
      speechKind: "defense",
      playerId: "alice",
      text: "I did what I had to.",
      provenance: "agent",
      phase: Phase.DEFENSE,
      counterpartId: "bob",
      correlationKey: "endgame:defense:r0:DEFENSE:alice:cbob",
    });
    gs.recordJudgmentSpeech({
      speechKind: "closing_argument",
      playerId: "alice",
      text: "Vote for the better game.",
      provenance: "agent",
      phase: Phase.CLOSING_ARGUMENTS,
    });

    const afterSpeech = gs.getDomainProjection();
    const replayed = replayCanonicalEvents(gs.getCanonicalEvents());

    // Board projection fields that speech must never mutate (phase/sequence advance only).
    expect(afterSpeech.players).toEqual(beforeSpeech.players);
    expect(afterSpeech.playerOrder).toEqual(beforeSpeech.playerOrder);
    expect(afterSpeech.juryVoteTally).toEqual(beforeSpeech.juryVoteTally);
    expect(afterSpeech.acceptedOutcomes).toEqual(beforeSpeech.acceptedOutcomes);
    expect(afterSpeech.currentVoteTally).toEqual(beforeSpeech.currentVoteTally);
    expect(afterSpeech.endgameStage).toEqual(beforeSpeech.endgameStage);
    expect(afterSpeech.empoweredId).toEqual(beforeSpeech.empoweredId);
    expect(afterSpeech.roundResults).toEqual(beforeSpeech.roundResults);

    expect(replayed).toEqual(afterSpeech);
    expect(replayed.players).toEqual(beforeSpeech.players);
    expect(
      gs.getCanonicalEvents().filter((e) => e.type === "endgame.speech_recorded"),
    ).toHaveLength(3);
    expect(
      gs.getCanonicalEvents().filter((e) => e.type === "judgment.speech_recorded"),
    ).toHaveLength(1);
  });

  it("reconstructs identical Judgment history and recent decisions from canonical speech alone", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "cara", name: "Cara" },
      ],
      { gameId: "game-judgment-context-replay", now: fixedClock() },
    );
    gs.startRound();
    gs.recordJudgmentSpeech({
      speechKind: "jury_question",
      playerId: "cara",
      text: "Which move best proves your control?",
      provenance: "agent",
      phase: Phase.JURY_QUESTIONS,
      addresseeId: "alice",
    });
    gs.recordJudgmentSpeech({
      speechKind: "jury_answer",
      playerId: "alice",
      text: "The final Council vote.",
      provenance: "agent",
      phase: Phase.JURY_QUESTIONS,
      addresseeId: "cara",
    });

    const originalLogger = new TranscriptLogger(gs);
    originalLogger.logPublic(
      "bob",
      "[QUESTION to Alice] This display row was never accepted.",
      Phase.JURY_QUESTIONS,
    );
    const originalContext = new ContextBuilder(
      gs,
      originalLogger,
      new Map(),
      3,
    ).buildPhaseContext("alice", Phase.JURY_QUESTIONS);

    const resumed = GameState.fromCanonicalEvents(
      JSON.parse(JSON.stringify(gs.getCanonicalEvents())),
      { now: fixedClock() },
    );
    const replayedContext = new ContextBuilder(
      resumed,
      new TranscriptLogger(resumed),
      new Map(),
      3,
    ).buildPhaseContext("alice", Phase.JURY_QUESTIONS);

    expect(replayedContext.judgmentQuestionHistory).toEqual(
      originalContext.judgmentQuestionHistory,
    );
    expect(replayedContext.recentDecisions).toEqual(originalContext.recentDecisions);
    expect(replayedContext.judgmentQuestionHistory).toEqual([{
      jurorName: "Cara",
      finalistName: "Alice",
      question: "Which move best proves your control?",
      answer: "The final Council vote.",
    }]);
    expect(replayedContext.recentDecisions).toContainEqual({
      round: 1,
      phase: Phase.JURY_QUESTIONS,
      label: "Judgment Answer",
      detail: 'Your Judgment answer to Cara: "The final Council vote."',
    });
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
      formatManifest: ["save_or_eliminate", "vote_bomb", "safety_bounce"],
    }, undefined, {
      durableEventSink: (events) => {
        flushedSequences.push(...events.map((event) => event.sequence));
      },
    });

    const streamedTypes: string[] = [];
    const viewerEvents: GameStreamEvent[] = [];
    runner.setCanonicalEventListener((event) => streamedTypes.push(event.type));
    runner.setStreamListener((event) => viewerEvents.push(event));

    await runner.run();

    expect(viewerEvents.some((event) => event.type === "game_over")).toBeFalse();
    expect(viewerEvents.some((event) => (
      event.type === "transcript_entry"
      && event.entry.text.includes("THE WINNER IS")
    ))).toBeFalse();
    runner.releaseTerminalStream();
    expect(viewerEvents.some((event) => event.type === "game_over")).toBeTrue();
    expect(viewerEvents.some((event) => (
      event.type === "transcript_entry"
      && event.entry.text.includes("THE WINNER IS")
    ))).toBeTrue();

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

  it("hydrates huddle participant snapshots for protected Recall Plan without leaking to non-members", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "cara", name: "Cara" },
      ],
      { gameId: "game-recall-huddle-replay", now: fixedClock() },
    );
    gs.startRound();
    gs.recordAllianceProposal({
      allianceId: "alliance-ab",
      lineageId: "lineage-ab",
      versionId: "version-ab",
      proposerId: "alice",
      name: "Alice Bob",
      memberIds: ["alice", "bob"],
      purpose: "Coordinate.",
      timebox: null,
    });
    gs.recordAllianceResponse({
      lineageId: "lineage-ab",
      versionId: "version-ab",
      playerId: "bob",
      response: "accepted",
    });
    gs.recordAllianceHuddleCompleted({
      id: "session-ab",
      scheduleId: "schedule-ab",
      allianceId: "alliance-ab",
      window: "pre_vote",
      round: gs.round,
      pass: 1,
      speakerIds: ["alice", "bob"],
      completedAt: "2026-07-26T00:00:00.000Z",
    });
    gs.recordAllianceHuddleOutcome({
      id: "outcome-ab",
      sessionId: "session-ab",
      allianceId: "alliance-ab",
      window: "pre_vote",
      round: gs.round,
      facts: [{
        kind: "commitment",
        factId: "fact-ab",
        sessionId: "session-ab",
        actorPlayerId: "alice",
        actionKind: "council_vote",
        targetPlayerId: "cara",
        confidence: "high",
      }],
      participantPlayerIds: ["alice", "bob"],
      createdAt: "2026-07-26T00:00:01.000Z",
    });

    const resumed = GameState.fromCanonicalEvents(
      JSON.parse(JSON.stringify(gs.getCanonicalEvents())),
      { now: fixedClock() },
    );
    expect(resumed.getAllianceHuddleOutcomes()[0]?.participantPlayerIds).toEqual(["alice", "bob"]);

    const logger = new TranscriptLogger(resumed);
    const builder = new ContextBuilder(resumed, logger, new Map(), 3);
    const emptyContinuity = {
      compactStrategy: {
        lifecycle: "opening" as const,
        baseline: null,
        deltas: [],
        priorEpoch: null,
        revision: 0,
      },
    };
    const alicePlan = compileRecallPlan({
      actorId: "alice" as UUID,
      promptClass: "strategic_decision",
      continuity: emptyContinuity,
      phaseContext: builder.buildPhaseContext("alice", Phase.VOTE),
      transcript: [],
    });
    const caraPlan = compileRecallPlan({
      actorId: "cara" as UUID,
      promptClass: "strategic_decision",
      continuity: emptyContinuity,
      phaseContext: builder.buildPhaseContext("cara", Phase.VOTE),
      transcript: [],
    });
    expect(alicePlan.protected.huddleOutcomes.map((o) => o.id)).toEqual(["outcome-ab"]);
    expect(caraPlan.protected.huddleOutcomes).toEqual([]);
  });

  it("replays canonical state identically whether private compact strategy exists or not", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "cara", name: "Cara" },
      ],
      { gameId: "game-private-strategy-replay", now: fixedClock() },
    );
    gs.startRound();
    const events = gs.getCanonicalEvents();
    const context = new ContextBuilder(
      gs,
      new TranscriptLogger(gs),
      new Map(),
      3,
    ).buildPhaseContext("alice", Phase.VOTE);
    const before = replayCanonicalEvents(events);

    compileRecallPlan({
      actorId: "alice" as UUID,
      promptClass: "strategic_decision",
      continuity: {
        compactStrategy: {
          lifecycle: "active",
          baseline: "Keep Bob close while checking Cara's public commitments.",
          deltas: ["Ask Bob for one concrete vote promise."],
          priorEpoch: null,
          revision: 2,
        },
      },
      phaseContext: context,
      transcript: [],
    });

    expect(gs.getCanonicalEvents()).toEqual(events);
    expect(replayCanonicalEvents(events)).toEqual(before);
  });
});
