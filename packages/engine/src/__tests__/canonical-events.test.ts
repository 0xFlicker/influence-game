import { describe, expect, it, mock } from "bun:test";
import { CanonicalEventLog } from "../canonical-event-log";
import {
  ACCEPTED_ACTION_REGISTRY,
  acceptedActionRegistryEntry,
  canonicalEventIsVisibleTo,
  validateCanonicalGameEvent,
  type CanonicalGameEvent,
} from "../canonical-events";
import {
  projectViewerDecisionEvent,
  reconstructSafetyBouncePrefix,
} from "../viewer-decision-events";
import { GameState } from "../game-state";
import { Phase, PlayerStatus } from "../types";

function sampleEvent(): CanonicalGameEvent {
  return {
    sequence: 1,
    gameId: "game-fixed",
    round: 0,
    phase: Phase.INIT,
    type: "game.roster_initialized",
    timestamp: "2026-06-11T00:00:00.000Z",
    source: "engine",
    visibility: "system",
    payloadVersion: 1,
    sourcePointers: [
      {
        kind: "agent_turn",
        sequence: 7,
        gameNumber: 1,
        actorId: "atlas",
        action: "mingle-turn",
        round: 1,
        phase: Phase.MINGLE,
      },
      {
        kind: "simulation_jsonl",
        gameNumber: 1,
        file: "game-1-turns.jsonl",
        line: 42,
      },
    ],
    payload: {
      players: [
        { id: "atlas", name: "Atlas", status: PlayerStatus.ALIVE, shielded: false },
      ],
    },
  };
}

describe("canonical event envelope", () => {
  it("validates required event envelope fields and source pointers", () => {
    const result = validateCanonicalGameEvent(sampleEvent());

    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("rejects events missing sequence, game id, visibility, or payload version", () => {
    const invalid = {
      ...sampleEvent(),
      sequence: 0,
      gameId: "",
      visibility: "hidden",
      payloadVersion: 2,
    };

    const result = validateCanonicalGameEvent(invalid);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("sequence must be a positive integer");
    expect(result.errors).toContain("gameId is required");
    expect(result.errors).toContain("visibility is invalid");
    expect(result.errors).toContain(
      "payloadVersion for game.roster_initialized must be 1, got 2",
    );
  });

  it("rejects unknown event types before replay can silently ignore them", () => {
    const result = validateCanonicalGameEvent({ ...sampleEvent(), type: "future.event" });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("type is unsupported: future.event");
  });

  it("accepts v2 only for aggregate-shaped format resolutions", () => {
    const state = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
      ],
      { gameId: "format-v2-validation" },
    );
    state.recordFormatResolution({
      formatId: "vote_bomb",
      empoweredId: "alice",
      eliminatedId: "bob",
      resolutionKind: "auto",
      tiedPlayerIds: ["bob"],
      tiebreakerId: null,
      aggregate: {
        capability: "sealed_elim",
        totals: { alice: 0, bob: 1 },
        eligiblePlayerIds: ["bob"],
      },
    });
    const resolution = state.getCanonicalEvents().at(-1)!;
    expect(validateCanonicalGameEvent(resolution)).toEqual({ ok: true, errors: [] });
    expect(validateCanonicalGameEvent({
      ...resolution,
      payload: { ...resolution.payload, voteBomb: null },
    }).errors).toContain(
      "format.resolved v2 payload must not contain legacy bag voteBomb",
    );
    expect(validateCanonicalGameEvent({
      ...resolution,
      payloadVersion: 3,
    }).errors).toContain(
      "payloadVersion for format.resolved must be 1 or 2, got 3",
    );
    expect(validateCanonicalGameEvent({
      ...sampleEvent(),
      payloadVersion: 2,
    }).errors).toContain(
      "payloadVersion for game.roster_initialized must be 1, got 2",
    );
  });

  it("filters producer-only events out of player-visible query modes", () => {
    const event = { ...sampleEvent(), visibility: "producer" as const };

    expect(canonicalEventIsVisibleTo(event, "producer")).toBe(true);
    expect(canonicalEventIsVisibleTo(event, "player")).toBe(false);
    expect(canonicalEventIsVisibleTo(event, "public")).toBe(false);
  });
});

describe("viewer decision events", () => {
  it("projects only an allowlisted decision payload and strips private raw-envelope fields", () => {
    const state = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
      ],
      { gameId: "game-viewer-event", now: () => 1_700_000_000_000 },
    );
    state.startRound();
    state.recordVote("alice", "bob", "alice", [
      {
        kind: "agent_turn",
        actorId: "alice",
        action: "vote",
        decisionId: "private-decision-id",
        round: 1,
        phase: Phase.VOTE,
        file: "private-trace.jsonl",
      },
    ]);

    const vote = state.getCanonicalEvents().find((event) => event.type === "vote.cast");
    expect(vote).toBeDefined();
    if (!vote || vote.type !== "vote.cast") throw new Error("Expected canonical vote event");

    const viewerEvent = projectViewerDecisionEvent(vote);

    expect(viewerEvent).toEqual({
      sequence: vote.sequence,
      timestamp: vote.timestamp,
      round: vote.round,
      phase: vote.phase,
      type: "vote.cast",
      payload: {
        voterId: "alice",
        empowerTarget: "bob",
        exposeTarget: "alice",
      },
    });
    const json = JSON.stringify(viewerEvent);
    expect(json).not.toContain("sourcePointers");
    expect(json).not.toContain("private-decision-id");
    expect(json).not.toContain("private-trace.jsonl");
    expect(projectViewerDecisionEvent(sampleEvent())).toBeNull();
  });

  it("keeps accepted format ballots as sanitized operator-readable viewer decisions", () => {
    const state = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
      ],
      { gameId: "game-viewer-format-ballot", now: () => 1_700_000_000_000 },
    );
    state.startRound();
    state.recordFormatBallot(
      {
        formatId: "save_or_eliminate",
        voterId: "alice",
        targetId: "bob",
        polarity: "eliminate",
      },
      [{
        kind: "agent_turn",
        actorId: "alice",
        action: "format-save-or-eliminate-ballot",
        decisionId: "private-format-decision",
        round: 1,
        phase: Phase.FORMAT_RESOLVE,
      }],
    );

    const ballot = state.getCanonicalEvents().find(
      (event) => event.type === "format.ballot_cast",
    );
    if (!ballot || ballot.type !== "format.ballot_cast") {
      throw new Error("Expected canonical format ballot");
    }

    const viewerEvent = projectViewerDecisionEvent(ballot);
    expect(viewerEvent).toEqual({
      sequence: ballot.sequence,
      timestamp: ballot.timestamp,
      round: 1,
      phase: Phase.FORMAT_RESOLVE,
      type: "format.ballot_cast",
      payload: {
        formatId: "save_or_eliminate",
        voterId: "alice",
        targetId: "bob",
        polarity: "eliminate",
      },
    });
    expect(JSON.stringify(viewerEvent)).not.toContain("private-format-decision");
  });
});

describe("Safety Bounce canonical prefixes", () => {
  function bounceState(): GameState {
    const state = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "charlie", name: "Charlie" },
        { id: "dave", name: "Dave" },
      ],
      { gameId: "game-safety-bounce-prefix", now: () => 1_700_000_000_000 },
    );
    state.startRound();
    state.recordFormatMenu("alice", ["safety_bounce", "vote_bomb"]);
    state.recordFormatSelected("alice", "safety_bounce");
    state.recordSafetyBounceStarted("alice");
    state.recordSafetyBouncePointer("alice", "bob", "vulnerable");
    state.recordSafetyBouncePointer("bob", "charlie", "safe");
    state.recordSafetyBouncePointer("charlie", "dave", "vulnerable");
    return state;
  }

  const roster = ["alice", "bob", "charlie", "dave"].map((id) => ({ id }));

  it("reconstructs every accepted prefix from sequence order without transcript repair", () => {
    const state = bounceState();
    const events = state.getCanonicalEvents();
    const startIndex = events.findIndex((event) => event.type === "format.safety_bounce_started");
    const pointerIndexes = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.type === "format.safety_bounce_pointer")
      .map(({ index }) => index);

    const prefixes = [startIndex, ...pointerIndexes].map((index) =>
      reconstructSafetyBouncePrefix({ roster, events: events.slice(0, index + 1) }),
    );

    expect(prefixes.map((prefix) => ({
      currentActorId: prefix.currentActorId,
      benchPlayerIds: prefix.benchPlayerIds,
      safePlayerIds: prefix.safePlayerIds,
      vulnerablePlayerIds: prefix.vulnerablePlayerIds,
      diagnostics: prefix.diagnostics,
    }))).toEqual([
      {
        currentActorId: "alice",
        benchPlayerIds: ["bob", "charlie", "dave"],
        safePlayerIds: ["alice"],
        vulnerablePlayerIds: [],
        diagnostics: [],
      },
      {
        currentActorId: "bob",
        benchPlayerIds: ["charlie", "dave"],
        safePlayerIds: ["alice"],
        vulnerablePlayerIds: ["bob"],
        diagnostics: [],
      },
      {
        currentActorId: "charlie",
        benchPlayerIds: ["dave"],
        safePlayerIds: ["alice", "charlie"],
        vulnerablePlayerIds: ["bob"],
        diagnostics: [],
      },
      {
        currentActorId: "dave",
        benchPlayerIds: [],
        safePlayerIds: ["alice", "charlie"],
        vulnerablePlayerIds: ["bob", "dave"],
        diagnostics: [],
      },
    ]);
  });

  it("reports invalid continuity, duplicate targets, missing roster players, and sequence gaps without repairing", () => {
    const events = bounceState().getCanonicalEvents();
    const pointerIndex = events.findIndex((event) => event.type === "format.safety_bounce_pointer");
    if (pointerIndex === -1) throw new Error("Expected Safety Bounce pointer");

    const invalidActor = events.map((event, index) => (
      index === pointerIndex && event.type === "format.safety_bounce_pointer"
        ? { ...event, payload: { ...event.payload, actorId: "charlie" } }
        : event
    ));
    const duplicateTarget = events.map((event, index) => (
      index === pointerIndex + 1 && event.type === "format.safety_bounce_pointer"
        ? { ...event, payload: { ...event.payload, targetId: "bob" } }
        : event
    ));
    const missingPlayer = events.map((event, index) => (
      index === pointerIndex && event.type === "format.safety_bounce_pointer"
        ? { ...event, payload: { ...event.payload, targetId: "nobody" } }
        : event
    ));
    const classificationMismatch = events.map((event, index) => (
      index === pointerIndex && event.type === "format.safety_bounce_pointer"
        ? { ...event, payload: { ...event.payload, classification: "safe" as const } }
        : event
    ));
    const sequenceGap = events.map((event, index) => (
      index === pointerIndex
        ? { ...event, sequence: event.sequence + 1 }
        : event
    ));

    expect(reconstructSafetyBouncePrefix({ roster, events: invalidActor }).diagnostics.map((d) => d.code))
      .toContain("safety_bounce_invalid_actor");
    expect(reconstructSafetyBouncePrefix({ roster, events: duplicateTarget }).diagnostics.map((d) => d.code))
      .toContain("safety_bounce_duplicate_target");
    expect(reconstructSafetyBouncePrefix({ roster, events: missingPlayer }).diagnostics.map((d) => d.code))
      .toContain("safety_bounce_missing_roster_player");
    expect(
      reconstructSafetyBouncePrefix({ roster, events: classificationMismatch })
        .diagnostics.map((diagnostic) => diagnostic.code),
    ).toContain("safety_bounce_classification_mismatch");
    expect(reconstructSafetyBouncePrefix({ roster, events: sequenceGap }).diagnostics.map((d) => d.code))
      .toContain("safety_bounce_event_gap");
  });

  it("distinguishes sole-vulnerable auto-elimination from a final ballot", () => {
    const state = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "charlie", name: "Charlie" },
      ],
      { gameId: "game-safety-bounce-auto", now: () => 1_700_000_000_000 },
    );
    state.startRound();
    state.recordSafetyBounceStarted("alice");
    state.recordSafetyBouncePointer("alice", "bob", "vulnerable");
    state.recordSafetyBouncePointer("bob", "charlie", "safe");
    state.recordFormatResolution({
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
        safePlayerIds: ["alice", "charlie"],
        vulnerablePlayerIds: ["bob"],
        voteTotals: {},
      },
    });

    const prefix = reconstructSafetyBouncePrefix({
      roster: roster.slice(0, 3),
      events: state.getCanonicalEvents(),
    });

    expect(prefix.completion).toBe("sole_vulnerable_auto_elimination");
    expect(prefix.finalBallotCount).toBe(0);
    expect(prefix.diagnostics).toEqual([]);
  });
});

describe("accepted action registry", () => {
  it("enumerates every direct action family and excludes downstream mechanical facts", () => {
    expect(Object.keys(ACCEPTED_ACTION_REGISTRY).sort()).toEqual([
      "alliance.amendment_resolved",
      "alliance.counter_submitted",
      "alliance.proposal_submitted",
      "alliance.response_recorded",
      "council.vote_cast",
      "endgame.elimination_resolved",
      "endgame.elimination_vote_cast",
      "format.ballot_cast",
      "format.resolved",
      "format.safety_bounce_pointer",
      "format.selected",
      "jury.vote_cast",
      "power.action_set",
      "vote.cast",
      "vote.empower_revote_cast",
    ]);
    expect(acceptedActionRegistryEntry("power.action_set")).toMatchObject({
      sourceActions: ["power", "power-action"],
      traceActions: ["power"],
      cardinality: "one_to_one",
    });
    expect(acceptedActionRegistryEntry("format.ballot_cast")).toMatchObject({
      sourceActions: expect.arrayContaining(["format-majority-elimination-ballot"]),
      traceActions: expect.arrayContaining(["format-majority-elimination-ballot"]),
      cardinality: "one_to_one",
    });
    expect(acceptedActionRegistryEntry("endgame.elimination_resolved")).toMatchObject({
      traceActions: ["tribunal-jury-tiebreaker-vote"],
      cardinality: "many_to_one",
    });
    expect(acceptedActionRegistryEntry("vote.empower_tally_resolved")).toBeUndefined();
    expect(acceptedActionRegistryEntry("player.eliminated")).toBeUndefined();
    expect(acceptedActionRegistryEntry("round.result_recorded")).toBeUndefined();
  });
});

describe("canonical event log", () => {
  it("replays existing events to new subscribers and then streams new events", () => {
    const log = new CanonicalEventLog();
    log.append({
      gameId: "game-fixed",
      round: 0,
      phase: Phase.INIT,
      type: "game.roster_initialized",
      timestamp: "2026-06-11T00:00:00.000Z",
      visibility: "system",
      payload: {
        players: [
          { id: "atlas", name: "Atlas", status: PlayerStatus.ALIVE, shielded: false },
        ],
      },
    });

    const seen: number[] = [];
    log.subscribe((event) => seen.push(event.sequence), { replayExisting: true });

    log.append({
      gameId: "game-fixed",
      round: 1,
      phase: Phase.LOBBY,
      type: "round.started",
      timestamp: "2026-06-11T00:00:01.000Z",
      visibility: "system",
      payload: { round: 1 },
    });

    expect(seen).toEqual([1, 2]);
  });

  it("keeps appending events when one subscriber throws", () => {
    const originalWarn = console.warn;
    console.warn = mock(() => undefined);
    const log = new CanonicalEventLog();
    try {
      log.subscribe(() => {
        throw new Error("observer failed");
      });
      const seen: number[] = [];
      log.subscribe((event) => seen.push(event.sequence));

      log.append({
        gameId: "game-fixed",
        round: 0,
        phase: Phase.INIT,
        type: "game.roster_initialized",
        timestamp: "2026-06-11T00:00:00.000Z",
        visibility: "system",
        payload: {
          players: [
            { id: "atlas", name: "Atlas", status: PlayerStatus.ALIVE, shielded: false },
          ],
        },
      });

      expect(seen).toEqual([1]);
      expect(log.list()).toHaveLength(1);
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("GameState canonical append timing", () => {
  it("emits vote events before the live vote tally is mutated", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "charlie", name: "Charlie" },
        { id: "dave", name: "Dave" },
      ],
      { gameId: "game-fixed", now: () => 1_700_000_000_000 },
    );
    gs.startRound();

    const tallyAtAppend: Array<Record<string, string>> = [];
    gs.subscribeCanonicalEvents((event) => {
      if (event.type === "vote.cast") {
        tallyAtAppend.push({ ...gs.currentVoteTally.empowerVotes });
      }
    });

    gs.recordVote("alice", "bob", "charlie");

    expect(tallyAtAppend).toEqual([{}]);
    expect(gs.currentVoteTally.empowerVotes.alice).toBe("bob");
  });
});

describe("accepted action source pointers", () => {
  it("preserves exact receipts for direct vote, power, Council, endgame, and jury writers", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "charlie", name: "Charlie" },
        { id: "dave", name: "Dave" },
      ],
      { gameId: "game-action-pointers", now: () => 1_700_000_000_000 },
    );
    gs.startRound();
    const pointer = (actorId: string, action: string, decisionId: string) => ({
      kind: "agent_turn" as const,
      actorId,
      action,
      round: 1,
      phase: Phase.VOTE,
      decisionId,
    });

    gs.recordVote("alice", "bob", null, [pointer("alice", "vote", "decision-vote")]);
    gs.recordEmpowerReVote("alice", "charlie", [
      pointer("alice", "empower-revote", "decision-revote"),
    ]);
    gs.setPowerAction({ action: "protect", target: "bob" }, [
      { ...pointer("alice", "power", "decision-power"), phase: Phase.POWER },
    ]);
    gs.recordCouncilVote("charlie", "dave", [
      { ...pointer("charlie", "council-vote", "decision-council"), phase: Phase.COUNCIL },
    ]);
    gs.recordEndgameEliminationVote("alice", "bob", [
      pointer("alice", "elimination-vote", "decision-endgame"),
    ]);
    gs.recordJuryVote("dave", "alice", [
      { ...pointer("dave", "jury-vote", "decision-jury"), phase: Phase.JURY_VOTE },
    ]);

    const decisionsByType = Object.fromEntries(
      gs.getCanonicalEvents()
        .filter((event) => event.sourcePointers[0]?.decisionId)
        .map((event) => [event.type, event.sourcePointers[0]?.decisionId]),
    );
    expect(decisionsByType).toMatchObject({
      "vote.cast": "decision-vote",
      "vote.empower_revote_cast": "decision-revote",
      "power.action_set": "decision-power",
      "council.vote_cast": "decision-council",
      "endgame.elimination_vote_cast": "decision-endgame",
      "jury.vote_cast": "decision-jury",
    });
  });

  it("allows many Tribunal jury receipts on one resolution and none on downstream elimination facts", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "charlie", name: "Charlie" },
        { id: "dave", name: "Dave" },
      ],
      { gameId: "game-tribunal-pointers", now: () => 1_700_000_000_000 },
    );
    gs.startRound();
    gs.recordEndgameEliminationVote("alice", "bob");
    gs.recordEndgameEliminationVote("bob", "alice");
    gs.recordEndgameEliminationVote("charlie", "bob");
    gs.recordEndgameEliminationVote("dave", "alice");

    const pointer = (jurorId: string, decisionId: string) => ({
      kind: "agent_turn" as const,
      actorId: jurorId,
      action: "tribunal-jury-tiebreaker-vote",
      round: 1,
      phase: Phase.VOTE,
      decisionId,
    });
    gs.tallyTribunalVotes(
      { juror1: "alice", juror2: "alice" },
      [pointer("juror1", "decision-juror-1"), pointer("juror2", "decision-juror-2")],
    );

    const resolution = gs.getCanonicalEvents().find(
      (event) => event.type === "endgame.elimination_resolved",
    );
    expect(resolution?.sourcePointers.map((source) => source.decisionId)).toEqual([
      "decision-juror-1",
      "decision-juror-2",
    ]);
    expect(
      gs.getCanonicalEvents().filter((event) =>
        event.type === "player.eliminated" || event.type === "round.result_recorded"
      ),
    ).toSatisfy((events: CanonicalGameEvent[]) =>
      events.every((event) => event.sourcePointers.every((source) => !source.decisionId))
    );
  });
});

describe("round.result_recorded", () => {
  it("defaults legacy results to Council and records format results in FORMAT_RESOLVE", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
      ],
      { gameId: "game-fixed", now: () => 1_700_000_000_000 },
    );
    gs.startRound();

    gs.recordRoundResult({
      round: gs.round,
      empoweredId: "alice",
      exposeScores: {},
      candidates: ["alice", "bob"],
      powerAction: null,
      powerTarget: null,
      eliminated: "bob",
    });
    gs.recordRoundResult(
      {
        round: gs.round,
        empoweredId: "alice",
        exposeScores: {},
        candidates: null,
        powerAction: null,
        powerTarget: null,
        eliminated: "bob",
        formatId: "vote_bomb",
        formatMethod: "vote_bomb",
      },
      Phase.FORMAT_RESOLVE,
    );

    const results = gs
      .getCanonicalEvents()
      .filter((event) => event.type === "round.result_recorded");
    expect(results[0]?.phase).toBe(Phase.COUNCIL);
    expect(results[1]?.phase).toBe(Phase.FORMAT_RESOLVE);
    expect(results[1]?.payload.result.formatId).toBe("vote_bomb");
  });
});

describe("format.menu_offered", () => {
  it("records the empowered chooser and exactly the two offered formats as a public canonical fact", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
      ],
      { gameId: "game-fixed", now: () => 1_700_000_000_000 },
    );
    gs.startRound();

    gs.recordFormatMenu("alice", ["safety_bounce", "vote_bomb"]);

    expect(gs.getCanonicalEvents().at(-1)).toMatchObject({
      type: "format.menu_offered",
      phase: Phase.FORMAT_MENU,
      visibility: "public",
      payload: {
        empoweredId: "alice",
        offeredFormatIds: ["safety_bounce", "vote_bomb"],
      },
    });
    expect(gs.getDomainProjection().formatMenu).toEqual({
      empoweredId: "alice",
      offeredFormatIds: ["safety_bounce", "vote_bomb"],
      selectedFormatId: null,
    });
  });

  it("records format.selected and selectedFormatId on the projection", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
      ],
      { gameId: "game-fixed", now: () => 1_700_000_000_000 },
    );
    gs.startRound();
    gs.recordFormatMenu("alice", ["safety_bounce", "vote_bomb"]);
    gs.recordFormatSelected("alice", "safety_bounce");

    expect(gs.getCanonicalEvents().at(-1)).toMatchObject({
      type: "format.selected",
      phase: Phase.FORMAT_PICK,
      visibility: "public",
      payload: { empoweredId: "alice", formatId: "safety_bounce" },
    });
    expect(gs.getDomainProjection().formatMenu).toEqual({
      empoweredId: "alice",
      offeredFormatIds: ["safety_bounce", "vote_bomb"],
      selectedFormatId: "safety_bounce",
    });
  });

  it("keeps sealed format ballots producer-only while bounce pointers stay public", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "charlie", name: "Charlie" },
      ],
      { gameId: "game-fixed", now: () => 1_700_000_000_000 },
    );
    gs.startRound();
    gs.recordFormatMenu("alice", ["safety_bounce", "vote_bomb"]);
    gs.recordFormatSelected("alice", "safety_bounce");
    gs.recordSafetyBounceStarted("bob");
    gs.recordSafetyBouncePointer("bob", "charlie", "vulnerable");
    gs.recordFormatBallot({
      formatId: "safety_bounce",
      voterId: "alice",
      targetId: "charlie",
    });

    const events = gs.getCanonicalEvents();
    expect(events.find((e) => e.type === "format.safety_bounce_pointer")).toMatchObject({
      visibility: "public",
      payload: { actorId: "bob", targetId: "charlie", classification: "vulnerable" },
    });
    expect(events.find((e) => e.type === "format.ballot_cast")).toMatchObject({
      visibility: "producer",
      payload: {
        formatId: "safety_bounce",
        voterId: "alice",
        targetId: "charlie",
        polarity: null,
      },
    });
  });

  it("carries direct decision pointers through format selection, bounce, and tiebreak writers", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "charlie", name: "Charlie" },
      ],
      { gameId: "game-fixed", now: () => 1_700_000_000_000 },
    );
    gs.startRound();
    const sourcePointer = {
      kind: "agent_turn" as const,
      actorId: "alice",
      action: "format-pick",
      round: 1,
      phase: Phase.FORMAT_PICK,
      decisionId: "decision-format-pick",
    };

    gs.recordFormatMenu("alice", ["safety_bounce", "vote_bomb"]);
    gs.recordFormatSelected("alice", "safety_bounce", [sourcePointer]);
    gs.recordSafetyBouncePointer("alice", "bob", "vulnerable", [
      { ...sourcePointer, action: "bounce-pointer", phase: Phase.FORMAT_RESOLVE },
    ]);
    gs.recordFormatResolution(
      {
        formatId: "safety_bounce",
        empoweredId: "alice",
        eliminatedId: "bob",
        resolutionKind: "clear",
        tiedPlayerIds: ["bob", "charlie"],
        tiebreakerId: "alice",
        saveOrEliminate: null,
        voteBomb: null,
        safetyBounce: {
          starterId: "alice",
          safePlayerIds: ["alice", "charlie"],
          vulnerablePlayerIds: ["bob"],
          voteTotals: { bob: 1, charlie: 1 },
        },
      },
      [{ ...sourcePointer, action: "format-tiebreak", phase: Phase.FORMAT_RESOLVE }],
    );

    const events = gs.getCanonicalEvents();
    expect(events.find((event) => event.type === "format.selected")?.sourcePointers).toEqual([
      sourcePointer,
    ]);
    expect(
      events.find((event) => event.type === "format.safety_bounce_pointer")?.sourcePointers,
    ).toEqual([
      { ...sourcePointer, action: "bounce-pointer", phase: Phase.FORMAT_RESOLVE },
    ]);
    expect(events.find((event) => event.type === "format.resolved")?.sourcePointers).toEqual([
      { ...sourcePointer, action: "format-tiebreak", phase: Phase.FORMAT_RESOLVE },
    ]);
  });
});

describe("judgment.speech_recorded", () => {
  it("appends a public closing speech with phase CLOSING_ARGUMENTS", () => {
    const gs = new GameState(
      [
        { id: "iris", name: "Iris" },
        { id: "maya", name: "Maya" },
      ],
      { gameId: "game-fixed", now: () => 1_700_000_000_000 },
    );

    const event = gs.recordJudgmentSpeech({
      speechKind: "closing_argument",
      playerId: "iris",
      text: "My game was clean.",
      provenance: "agent",
      phase: Phase.CLOSING_ARGUMENTS,
    });

    expect(event.type).toBe("judgment.speech_recorded");
    expect(event.phase).toBe(Phase.CLOSING_ARGUMENTS);
    expect(event.visibility).toBe("public");
    expect(event.payload).toEqual({
      speechKind: "closing_argument",
      playerId: "iris",
      text: "My game was clean.",
      provenance: "agent",
    });
    expect(canonicalEventIsVisibleTo(event, "public")).toBe(true);
    expect(canonicalEventIsVisibleTo(event, "player")).toBe(true);
    expect(canonicalEventIsVisibleTo(event, "producer")).toBe(true);
  });

  it("is idempotent for the same key and payload, and throws on conflict", () => {
    const gs = new GameState(
      [
        { id: "iris", name: "Iris" },
        { id: "maya", name: "Maya" },
      ],
      { gameId: "game-fixed", now: () => 1_700_000_000_000 },
    );

    const first = gs.recordJudgmentSpeech({
      speechKind: "closing_argument",
      playerId: "iris",
      text: "My game was clean.",
      provenance: "agent",
      phase: Phase.CLOSING_ARGUMENTS,
    });
    const second = gs.recordJudgmentSpeech({
      speechKind: "closing_argument",
      playerId: "iris",
      text: "My game was clean.",
      provenance: "agent",
      phase: Phase.CLOSING_ARGUMENTS,
    });
    expect(second.sequence).toBe(first.sequence);
    expect(gs.getCanonicalEvents().filter((e) => e.type === "judgment.speech_recorded")).toHaveLength(1);

    expect(() =>
      gs.recordJudgmentSpeech({
        speechKind: "closing_argument",
        playerId: "iris",
        text: "Different text",
        provenance: "agent",
        phase: Phase.CLOSING_ARGUMENTS,
      }),
    ).toThrow(/conflict/);
  });

  it("allows multiple jury answers from the same finalist to different jurors", () => {
    const gs = new GameState(
      [
        { id: "iris", name: "Iris" },
        { id: "maya", name: "Maya" },
        { id: "juror-a", name: "JurorA" },
        { id: "juror-b", name: "JurorB" },
      ],
      { gameId: "game-fixed", now: () => 1_700_000_000_000 },
    );

    gs.recordJudgmentSpeech({
      speechKind: "jury_answer",
      playerId: "iris",
      text: "Answer A",
      provenance: "agent",
      phase: Phase.JURY_QUESTIONS,
      addresseeId: "juror-a",
    });
    gs.recordJudgmentSpeech({
      speechKind: "jury_answer",
      playerId: "iris",
      text: "Answer B",
      provenance: "agent",
      phase: Phase.JURY_QUESTIONS,
      addresseeId: "juror-b",
    });

    const answers = gs
      .getCanonicalEvents()
      .filter((e) => e.type === "judgment.speech_recorded" && e.payload.speechKind === "jury_answer");
    expect(answers).toHaveLength(2);
  });

  it("rejects empty playerId, missing speech text, and jury_answer without addresseeId", () => {
    const gs = new GameState([{ id: "iris", name: "Iris" }], { gameId: "game-fixed" });

    expect(() =>
      gs.recordJudgmentSpeech({
        speechKind: "closing_argument",
        playerId: "",
        text: "hi",
        provenance: "agent",
        phase: Phase.CLOSING_ARGUMENTS,
      }),
    ).toThrow(/playerId/);

    expect(() =>
      gs.recordJudgmentSpeech({
        speechKind: "closing_argument",
        playerId: "iris",
        text: "",
        provenance: "agent",
        phase: Phase.CLOSING_ARGUMENTS,
      }),
    ).toThrow(/non-empty/);

    expect(() =>
      gs.recordJudgmentSpeech({
        speechKind: "jury_answer",
        playerId: "iris",
        text: "answer",
        provenance: "agent",
        phase: Phase.JURY_QUESTIONS,
      }),
    ).toThrow(/addresseeId/);
  });
});

describe("endgame.speech_recorded", () => {
  it("appends public plea/accusation/defense with safe provenance and no cognitive fields", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "carol", name: "Carol" },
      ],
      { gameId: "game-fixed", now: () => 1_700_000_000_000 },
    );

    const plea = gs.recordEndgameSpeech({
      speechKind: "plea",
      playerId: "alice",
      text: "I played hard.",
      provenance: "agent",
      phase: Phase.PLEA,
      correlationKey: "endgame:plea:r0:PLEA:alice",
    });
    expect(plea.type).toBe("endgame.speech_recorded");
    expect(plea.visibility).toBe("public");
    expect(plea.phase).toBe(Phase.PLEA);
    expect(plea.payload).toEqual({
      speechKind: "plea",
      playerId: "alice",
      text: "I played hard.",
      provenance: "agent",
      correlationKey: "endgame:plea:r0:PLEA:alice",
    });
    expect(plea.payload).not.toHaveProperty("thinking");
    expect(plea.payload).not.toHaveProperty("strategy");
    expect(canonicalEventIsVisibleTo(plea, "public")).toBe(true);

    const accusation = gs.recordEndgameSpeech({
      speechKind: "accusation",
      playerId: "bob",
      text: "Alice cut deals.",
      provenance: "timeout",
      phase: Phase.ACCUSATION,
      targetId: "alice",
      correlationKey: "endgame:accusation:r0:ACCUSATION:bob:talice",
    });
    expect(accusation.type).toBe("endgame.speech_recorded");
    if (accusation.type !== "endgame.speech_recorded") throw new Error("expected endgame speech");
    expect(accusation.payload.speechKind).toBe("accusation");
    expect(accusation.payload.targetId).toBe("alice");
    expect(accusation.payload.provenance).toBe("timeout");

    const defense = gs.recordEndgameSpeech({
      speechKind: "defense",
      playerId: "alice",
      text: "Those deals kept me alive.",
      provenance: "fallback",
      phase: Phase.DEFENSE,
      counterpartId: "bob",
      correlationKey: "endgame:defense:r0:DEFENSE:alice:cbob",
    });
    expect(defense.type).toBe("endgame.speech_recorded");
    if (defense.type !== "endgame.speech_recorded") throw new Error("expected endgame speech");
    expect(defense.payload.speechKind).toBe("defense");
    expect(defense.payload.counterpartId).toBe("bob");
    expect(defense.payload.provenance).toBe("fallback");
  });

  it("is idempotent for the same key and payload, and throws on conflict", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
      ],
      { gameId: "game-fixed", now: () => 1_700_000_000_000 },
    );

    const first = gs.recordEndgameSpeech({
      speechKind: "plea",
      playerId: "alice",
      text: "My plea.",
      provenance: "agent",
      phase: Phase.PLEA,
      correlationKey: "endgame:plea:r0:PLEA:alice",
    });
    const second = gs.recordEndgameSpeech({
      speechKind: "plea",
      playerId: "alice",
      text: "My plea.",
      provenance: "agent",
      phase: Phase.PLEA,
      correlationKey: "endgame:plea:r0:PLEA:alice",
    });
    expect(second.sequence).toBe(first.sequence);
    expect(gs.getCanonicalEvents().filter((e) => e.type === "endgame.speech_recorded")).toHaveLength(1);

    expect(() =>
      gs.recordEndgameSpeech({
        speechKind: "plea",
        playerId: "alice",
        text: "Different plea.",
        provenance: "agent",
        phase: Phase.PLEA,
        correlationKey: "endgame:plea:r0:PLEA:alice",
      }),
    ).toThrow(/conflict/);

    expect(() =>
      gs.recordEndgameSpeech({
        speechKind: "plea",
        playerId: "alice",
        text: "My plea.",
        provenance: "timeout",
        phase: Phase.PLEA,
        correlationKey: "endgame:plea:r0:PLEA:alice",
      }),
    ).toThrow(/conflict/);
  });

  it("keys accusations by player+target and defenses by player+counterpart", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "carol", name: "Carol" },
      ],
      { gameId: "game-fixed", now: () => 1_700_000_000_000 },
    );

    gs.recordEndgameSpeech({
      speechKind: "accusation",
      playerId: "alice",
      text: "vs bob",
      provenance: "agent",
      phase: Phase.ACCUSATION,
      targetId: "bob",
      correlationKey: "endgame:accusation:r0:ACCUSATION:alice:tbob",
    });
    gs.recordEndgameSpeech({
      speechKind: "accusation",
      playerId: "alice",
      text: "vs carol",
      provenance: "agent",
      phase: Phase.ACCUSATION,
      targetId: "carol",
      correlationKey: "endgame:accusation:r0:ACCUSATION:alice:tcarol",
    });
    const accusations = gs
      .getCanonicalEvents()
      .filter((e) => e.type === "endgame.speech_recorded" && e.payload.speechKind === "accusation");
    expect(accusations).toHaveLength(2);

    expect(() =>
      gs.recordEndgameSpeech({
        speechKind: "accusation",
        playerId: "alice",
        text: "different text same target",
        provenance: "agent",
        phase: Phase.ACCUSATION,
        targetId: "bob",
        correlationKey: "endgame:accusation:r0:ACCUSATION:alice:tbob",
      }),
    ).toThrow(/conflict/);

    expect(() =>
      gs.recordEndgameSpeech({
        speechKind: "accusation",
        playerId: "bob",
        text: "no target",
        provenance: "agent",
        phase: Phase.ACCUSATION,
        correlationKey: "endgame:accusation:r0:ACCUSATION:bob",
      }),
    ).toThrow(/targetId/);

    expect(() =>
      gs.recordEndgameSpeech({
        speechKind: "defense",
        playerId: "bob",
        text: "no counterpart",
        provenance: "agent",
        phase: Phase.DEFENSE,
        correlationKey: "endgame:defense:r0:DEFENSE:bob",
      }),
    ).toThrow(/counterpartId/);
  });
});

describe("AcceptedFormalSpeech factory", () => {
  it("rejects private/cognitive construction and requires accusation target", async () => {
    const {
      createAcceptedFormalSpeech,
      buildFormalSpeechCorrelationKey,
      FORMAL_SPEECH_VOCABULARY,
    } = await import("../accepted-formal-speech");

    expect(FORMAL_SPEECH_VOCABULARY.endgameKinds).toEqual(["plea", "accusation", "defense"]);
    expect(FORMAL_SPEECH_VOCABULARY.eventTypes.endgame).toBe("endgame.speech_recorded");
    expect(FORMAL_SPEECH_VOCABULARY.eventTypes.judgment).toBe("judgment.speech_recorded");

    const speech = createAcceptedFormalSpeech({
      kind: "plea",
      playerId: "alice",
      text: "Please.",
      provenance: "agent",
      phase: Phase.PLEA,
      round: 3,
    });
    expect(speech.correlationKey).toBe(
      buildFormalSpeechCorrelationKey({
        kind: "plea",
        playerId: "alice",
        round: 3,
        phase: Phase.PLEA,
      }),
    );
    expect(speech).not.toHaveProperty("thinking");
    expect(speech).not.toHaveProperty("reasoningContext");
    expect(speech).not.toHaveProperty("strategy");

    expect(() =>
      createAcceptedFormalSpeech({
        kind: "accusation",
        playerId: "alice",
        text: "You!",
        provenance: "agent",
        phase: Phase.ACCUSATION,
        round: 1,
      }),
    ).toThrow(/targetId/);

    expect(() =>
      createAcceptedFormalSpeech({
        kind: "defense",
        playerId: "bob",
        text: "No.",
        provenance: "agent",
        phase: Phase.DEFENSE,
        round: 1,
      }),
    ).toThrow(/counterpartId/);

    expect(() =>
      createAcceptedFormalSpeech({
        kind: "plea",
        playerId: "alice",
        text: "",
        provenance: "agent",
        phase: Phase.PLEA,
        round: 1,
      }),
    ).toThrow(/non-empty/);
  });
});
