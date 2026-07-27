import { describe, expect, it } from "bun:test";
import type { CanonicalGameEvent, CanonicalSourcePointer } from "../canonical-events";
import { buildCompletedGameResults } from "../completed-game-results";
import { GameState } from "../game-state";
import { Phase } from "../types";

function fixedClock(): () => number {
  let ticks = 0;
  return () => 1_700_100_000_000 + ticks++;
}

function sourcePointer(action: string, actorId: string): CanonicalSourcePointer {
  return {
    kind: "agent_turn",
    action,
    actorId,
    round: 1,
    phase: Phase.VOTE,
    file: "private-trace-source-pointer.jsonl",
  };
}

function createStandardRoundEvents(gameId = "completed-results-standard"): readonly CanonicalGameEvent[] {
  const state = new GameState(
    [
      { id: "alice", name: "Alice" },
      { id: "bob", name: "Bob" },
      { id: "charlie", name: "Charlie" },
      { id: "dave", name: "Dave" },
    ],
    { gameId, now: fixedClock() },
  );
  state.startRound();
  state.recordVote("alice", "bob", "charlie", [sourcePointer("vote", "alice")]);
  state.recordVote("bob", "alice", "charlie", [sourcePointer("vote", "bob")]);
  state.recordVote("charlie", "bob", "dave", [sourcePointer("vote", "charlie")]);
  state.recordVote("dave", "bob", "charlie", [sourcePointer("vote", "dave")]);
  const { empowered } = state.tallyEmpowerVotes();
  state.setPowerAction({ action: "protect", target: "charlie" }, [sourcePointer("power", empowered)]);
  const resolved = state.determineCandidates();
  const candidates = resolved.candidates;
  if (!candidates) throw new Error("Expected council candidates");
  state.recordCouncilVote("alice", candidates[0], [sourcePointer("council", "alice")]);
  state.recordCouncilVote("bob", candidates[1], [sourcePointer("council", "bob")]);
  state.recordCouncilVote("dave", candidates[0], [sourcePointer("council", "dave")]);
  const eliminated = state.tallyCouncilVotes(empowered);
  state.eliminatePlayer(eliminated);
  return state.getCanonicalEvents();
}

function createJuryGameEvents(): readonly CanonicalGameEvent[] {
  const state = new GameState(
    [
      { id: "alice", name: "Alice" },
      { id: "bob", name: "Bob" },
      { id: "charlie", name: "Charlie" },
      { id: "dave", name: "Dave" },
    ],
    { gameId: "completed-results-jury", now: fixedClock() },
  );

  state.startRound();
  state.recordVote("alice", "bob", "charlie");
  state.recordVote("bob", "alice", "charlie");
  state.recordVote("charlie", "bob", "dave");
  state.recordVote("dave", "bob", "charlie");
  state.tallyEmpowerVotes();
  state.eliminatePlayer("dave");

  state.setEndgameStage("reckoning");
  state.recordEndgameEliminationVote("alice", "charlie");
  state.recordEndgameEliminationVote("bob", "charlie");
  state.recordEndgameEliminationVote("charlie", "alice");
  const endgameEliminated = state.tallyEndgameEliminationVotes();
  state.eliminatePlayer(endgameEliminated);

  state.setEndgameStage("judgment");
  state.recordJuryVote("dave", "alice");
  state.recordJuryVote("charlie", "alice");
  const { winnerId } = state.tallyJuryVotes();
  const loserId = ["alice", "bob"].find((id) => id !== winnerId);
  if (!loserId) throw new Error("Expected losing finalist");
  state.eliminatePlayer(loserId);

  return state.getCanonicalEvents();
}

describe("buildCompletedGameResults", () => {
  it("rolls up standard round facts and elimination order without raw event fields", () => {
    const read = buildCompletedGameResults({ events: createStandardRoundEvents() });

    expect(read.source).toBe("durable_canonical_events");
    expect(read.availability.status).toBe("available");
    expect(read.rounds).toHaveLength(1);
    expect(read.rounds[0]?.canonicalFacts.roundFacts.standardVote.status).toBe("available");
    expect(read.rounds[0]?.canonicalFacts.roundFacts.power?.status).toBe("available");
    expect(read.rounds[0]?.canonicalFacts.roundFacts.council?.status).toBe("available");
    expect(read.eliminationOrder).toHaveLength(1);
    expect(read.eliminationOrder[0]?.source).toBe("council");
    expect(read.players.some((player) => player.status === "eliminated")).toBe(true);

    const json = JSON.stringify(read);
    expect(json).not.toContain("sourcePointers");
    expect(json).not.toContain("payloadVersion");
    expect(json).not.toContain("private-trace-source-pointer");
  });

  it("maps format.resolved eliminations to source format with method stamp", () => {
    const state = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "charlie", name: "Charlie" },
        { id: "dave", name: "Dave" },
      ],
      { gameId: "completed-results-format", now: fixedClock() },
    );
    state.startRound();
    state.setEmpowered("alice", "initial");
    state.recordFormatMenu("alice", ["save_or_eliminate", "vote_bomb"]);
    state.recordFormatSelected("alice", "save_or_eliminate");
    state.recordFormatBallot({
      formatId: "save_or_eliminate",
      voterId: "alice",
      targetId: "bob",
      polarity: "eliminate",
    }, [sourcePointer("format-save-or-eliminate-ballot", "alice")]);
    state.recordFormatBallot({
      formatId: "save_or_eliminate",
      voterId: "bob",
      targetId: "dave",
      polarity: "save",
    });
    state.recordFormatBallot({
      formatId: "save_or_eliminate",
      voterId: "charlie",
      targetId: "bob",
      polarity: "eliminate",
    });
    state.recordFormatBallot({
      formatId: "save_or_eliminate",
      voterId: "dave",
      targetId: "bob",
      polarity: "eliminate",
    });
    state.recordFormatResolution({
      formatId: "save_or_eliminate",
      empoweredId: "alice",
      eliminatedId: "bob",
      resolutionKind: "clear",
      tiedPlayerIds: [],
      tiebreakerId: null,
      saveOrEliminate: {
        nets: { alice: 0, bob: -3, charlie: 0, dave: 1 },
        savesReceived: { alice: 0, bob: 0, charlie: 0, dave: 1 },
        eliminateReceived: { alice: 0, bob: 3, charlie: 0, dave: 0 },
      },
      voteBomb: null,
      safetyBounce: null,
    });
    state.eliminatePlayer("bob");

    const read = buildCompletedGameResults({ events: state.getCanonicalEvents() });
    expect(read.eliminationOrder).toHaveLength(1);
    expect(read.eliminationOrder[0]).toMatchObject({
      player: { id: "bob", name: "Bob" },
      source: "format",
      method: "save_or_eliminate:clear",
    });
    expect(read.rounds[0]?.canonicalFacts.roundFacts.power).toBeUndefined();
    expect(read.rounds[0]?.canonicalFacts.roundFacts.council).toBeUndefined();
    expect(read.rounds[0]?.canonicalFacts.roundFacts.format.status).toBe("available");
    expect(read.rounds[0]?.canonicalFacts.roundFacts.format.acceptedBallots).toHaveLength(4);
    expect(read.rounds[0]?.canonicalFacts.roundFacts.format.ballotPresentation).toEqual({
      status: "revealed",
      rollCall: [
      {
        voter: { id: "alice", name: "Alice" },
        target: { id: "bob", name: "Bob" },
        polarity: "eliminate",
      },
      {
        voter: { id: "bob", name: "Bob" },
        target: { id: "dave", name: "Dave" },
        polarity: "save",
      },
      {
        voter: { id: "charlie", name: "Charlie" },
        target: { id: "bob", name: "Bob" },
        polarity: "eliminate",
      },
      {
        voter: { id: "dave", name: "Dave" },
        target: { id: "bob", name: "Bob" },
        polarity: "eliminate",
      },
      ],
    });
    expect(JSON.stringify(read)).not.toContain("sourcePointers");
  });

  it("includes endgame elimination votes and final jury outcome", () => {
    const read = buildCompletedGameResults({
      events: createJuryGameEvents(),
      terminalResult: { winnerId: "alice", roundsPlayed: 1 },
    });

    expect(read.summary.winner).toEqual({ id: "alice", name: "Alice" });
    expect(read.summary.winnerMethod).toBe("majority");
    expect(read.summary.finalists.map((player) => player.id)).toEqual(["alice", "bob"]);
    expect(read.summary.rankedPlayerIds).toEqual(["alice", "bob", "charlie", "dave"]);
    expect(read.jury.status).toBe("available");
    expect(read.jury.ledger.map((entry) => entry.juror.id)).toEqual(["charlie", "dave"]);
    expect(read.jury.voteCounts).toEqual([
      { finalist: { id: "alice", name: "Alice" }, votes: 2 },
      { finalist: { id: "bob", name: "Bob" }, votes: 0 },
    ]);
    const endgameRounds = read.rounds.flatMap((round) => round.endgameEliminations);
    expect(endgameRounds).toHaveLength(1);
    expect(endgameRounds[0]?.ledger.map((entry) => entry.target.id)).toEqual(["charlie", "charlie", "alice"]);
    expect(read.eliminationOrder.map((entry) => entry.player.id)).toEqual(["dave", "charlie", "bob"]);
    expect(read.eliminationOrder.at(-1)).toMatchObject({
      player: { id: "bob", name: "Bob" },
      source: "jury",
      method: "majority",
    });
  });

  it("supplies stable vote pattern grouping keys without alliance labels", () => {
    const read = buildCompletedGameResults({ events: createStandardRoundEvents("completed-results-patterns") });
    const alice = read.votePatterns.find((pattern) => pattern.player.id === "alice");
    const dave = read.votePatterns.find((pattern) => pattern.player.id === "dave");

    expect(alice?.signature).toContain("empower=bob;expose=charlie");
    expect(dave?.signature).toContain("empower=bob;expose=charlie");
    expect(alice?.groupKey).toBe(dave?.groupKey);
    expect(JSON.stringify(read).toLowerCase()).not.toContain("alliance");
  });

  it("falls back to best-available terminal result when durable events are missing", () => {
    const read = buildCompletedGameResults({
      events: [],
      eventLogStatus: "empty",
      projectionStatus: "empty",
      terminalResult: { winnerId: "winner-player", roundsPlayed: 4 },
    });

    expect(read.source).toBe("best_available_terminal_result");
    expect(read.availability.status).toBe("degraded");
    expect(read.summary.winner).toEqual({ id: "winner-player", name: "winner-player" });
    expect(read.summary.roundsPlayed).toBe(4);
    expect(read.rounds).toEqual([]);
  });

  it("does not trust invalid canonical suffix facts", () => {
    const first = createStandardRoundEvents("completed-results-invalid")[0];
    if (!first) throw new Error("Expected first event");
    const invalid: CanonicalGameEvent = {
      ...first,
      sequence: 3,
      type: "round.started",
      round: 1,
      phase: Phase.LOBBY,
      payload: { round: 1 },
    };

    const read = buildCompletedGameResults({
      events: [first, invalid],
      eventLogStatus: "complete",
      projectionStatus: "complete",
      terminalResult: { winnerId: "alice", roundsPlayed: 1 },
    });

    expect(read.source).toBe("best_available_terminal_result");
    expect(read.availability.status).toBe("degraded");
    expect(read.availability.diagnostics.map((diagnostic) => diagnostic.code)).toContain("canonical_event_replay_failed");
    expect(read.rounds).toEqual([]);
  });
});
