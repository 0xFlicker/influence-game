import { describe, expect, it } from "bun:test";
import type { CanonicalGameEvent, CanonicalSourcePointer } from "../canonical-events";
import { GameState } from "../game-state";
import { buildRevealedRoundFacts } from "../revealed-round-facts";
import { Phase } from "../types";

function fixedClock(): () => number {
  let ticks = 0;
  return () => 1_700_000_000_000 + ticks++;
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

function createGameState(): GameState {
  return new GameState(
    [
      { id: "alice", name: "Alice" },
      { id: "bob", name: "Bob" },
      { id: "charlie", name: "Charlie" },
      { id: "dave", name: "Dave" },
    ],
    { gameId: "game-round-facts", now: fixedClock() },
  );
}

function createCompleteRoundEvents(): readonly CanonicalGameEvent[] {
  const state = createGameState();
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
  state.recordCouncilVote("alice", candidates[0], [sourcePointer("council_vote", "alice")]);
  state.recordCouncilVote("bob", candidates[1], [sourcePointer("council_vote", "bob")]);
  state.recordCouncilVote("dave", candidates[0], [sourcePointer("council_vote", "dave")]);
  const eliminated = state.tallyCouncilVotes(empowered);
  state.recordLastMessage(eliminated, "Good game.");
  state.eliminatePlayer(eliminated);

  return state.getCanonicalEvents();
}

describe("buildRevealedRoundFacts", () => {
  it("returns resolved round facts without raw event envelopes or source pointers", () => {
    const read = buildRevealedRoundFacts({ events: createCompleteRoundEvents(), round: 1 });
    const facts = read.roundFacts;

    expect(read.availability.canonicalFactsStatus).toBe("available");
    expect(read.availability.artifactDerivedFacts.status).toBe("not_used");
    expect(facts.round).toBe(1);
    expect(facts.standardVote.status).toBe("available");
    expect(facts.standardVote.ledger).toHaveLength(4);
    expect(facts.standardVote.empowered).toEqual({ id: "bob", name: "Bob" });
    expect(facts.power?.status).toBe("available");
    expect(facts.power?.action).toEqual({ action: "protect", target: { id: "charlie", name: "Charlie" } });
    expect(facts.power?.shieldGranted).toEqual({ id: "charlie", name: "Charlie" });
    expect(facts.power?.finalCouncilCandidates).toHaveLength(2);
    expect(facts.council?.status).toBe("available");
    expect(facts.council?.ledger.length).toBeGreaterThanOrEqual(3);
    expect(facts.council?.eliminated).not.toBeNull();
    expect(facts.players.eliminated).toHaveLength(1);

    const json = JSON.stringify(read);
    expect(json).not.toContain("sourcePointers");
    expect(json).not.toContain("payloadVersion");
    expect(json).not.toContain("private-trace-source-pointer");
  });

  it("includes empower revote targets after the vote resolves", () => {
    const state = createGameState();
    state.startRound();
    state.recordVote("alice", "bob", "charlie");
    state.recordVote("bob", "alice", "charlie");
    state.recordVote("charlie", "bob", "dave");
    state.recordVote("dave", "alice", "charlie");
    const tied = state.tallyEmpowerVotes();
    expect(tied.tied).toEqual(["alice", "bob"]);

    state.recordEmpowerReVote("alice", "bob");
    state.recordEmpowerReVote("bob", "bob");
    state.recordEmpowerReVote("charlie", "bob");
    state.recordEmpowerReVote("dave", "alice");
    state.setEmpowered("bob", "revote");

    const read = buildRevealedRoundFacts({ events: state.getCanonicalEvents(), round: 1 });
    const aliceLedger = read.roundFacts.standardVote.ledger.find((entry) => entry.voter.id === "alice");

    expect(read.roundFacts.standardVote.status).toBe("available");
    expect(read.roundFacts.standardVote.method).toBe("revote");
    expect(read.roundFacts.standardVote.tied.map((player) => player.id)).toEqual(["alice", "bob"]);
    expect(aliceLedger?.empowerTarget).toEqual({ id: "bob", name: "Bob" });
    expect(aliceLedger?.revoteEmpowerTarget).toEqual({ id: "bob", name: "Bob" });
  });

  it("withholds the standard vote ledger before empower resolution", () => {
    const state = createGameState();
    state.startRound();
    state.recordVote("alice", "bob", "charlie");
    state.recordVote("bob", "alice", "charlie");

    const read = buildRevealedRoundFacts({ events: state.getCanonicalEvents(), round: 1 });

    expect(read.roundFacts.standardVote.status).toBe("not_yet_resolved");
    expect(read.roundFacts.standardVote.ledger).toEqual([]);
    expect(read.availability.diagnostics.map((diagnostic) => diagnostic.code)).toContain("standard_vote_not_yet_resolved");
  });

  it("keeps power unavailable until the power outcome is persisted", () => {
    const state = createGameState();
    state.startRound();
    state.recordVote("alice", "bob", "charlie");
    state.recordVote("bob", "alice", "charlie");
    state.recordVote("charlie", "bob", "dave");
    state.recordVote("dave", "bob", "charlie");
    state.tallyEmpowerVotes();

    const read = buildRevealedRoundFacts({ events: state.getCanonicalEvents(), round: 1 });

    expect(read.roundFacts.standardVote.status).toBe("available");
    expect(read.roundFacts.power?.status).toBe("not_yet_resolved");
    expect(read.roundFacts.power?.finalCouncilCandidates).toEqual([]);
  });

  it("withholds the council vote ledger before elimination resolves", () => {
    const state = createGameState();
    state.startRound();
    state.recordVote("alice", "bob", "charlie");
    state.recordVote("bob", "alice", "charlie");
    state.recordVote("charlie", "bob", "dave");
    state.recordVote("dave", "bob", "charlie");
    const { empowered } = state.tallyEmpowerVotes();
    state.setPowerAction({ action: "pass", target: empowered });
    const resolved = state.determineCandidates();
    const candidates = resolved.candidates;
    if (!candidates) throw new Error("Expected council candidates");
    state.recordCouncilVote("alice", candidates[0]);

    const read = buildRevealedRoundFacts({ events: state.getCanonicalEvents(), round: 1 });

    expect(read.roundFacts.power?.status).toBe("available");
    expect(read.roundFacts.council?.status).toBe("not_yet_resolved");
    expect(read.roundFacts.council?.ledger).toEqual([]);
  });

  it("returns not-yet-flushed diagnostics for an empty event log", () => {
    const read = buildRevealedRoundFacts({
      events: [],
      round: 1,
      eventLogStatus: "empty",
      projectionStatus: "empty",
    });

    expect(read.availability.canonicalFactsStatus).toBe("not_yet_flushed");
    expect(read.roundFacts.standardVote.status).toBe("not_yet_flushed");
    expect(read.availability.diagnostics.map((diagnostic) => diagnostic.code)).toContain("canonical_event_log_empty");
  });

  it("returns unavailable diagnostics for an invalid or non-contiguous event prefix", () => {
    const state = new GameState([{ id: "alice", name: "Alice" }], {
      gameId: "game-invalid-round-facts",
      now: fixedClock(),
    });
    const first = state.getCanonicalEvents()[0];
    if (!first) throw new Error("Expected roster event");
    const skipped: CanonicalGameEvent = {
      sequence: 3,
      gameId: "game-invalid-round-facts",
      round: 1,
      phase: Phase.LOBBY,
      type: "round.started",
      timestamp: "2026-06-19T00:00:00.000Z",
      source: "engine",
      visibility: "system",
      payloadVersion: 1,
      sourcePointers: [],
      payload: { round: 1 },
    };

    const read = buildRevealedRoundFacts({ events: [first, skipped], eventLogStatus: "complete" });

    expect(read.availability.canonicalFactsStatus).toBe("unavailable");
    expect(read.roundFacts.standardVote.status).toBe("unavailable");
    expect(read.availability.diagnostics.map((diagnostic) => diagnostic.code)).toContain("canonical_event_log_unavailable");
  });

  it("does not surface private adjacent fields from nested resolution records", () => {
    const events = createCompleteRoundEvents().map((event) => {
      if (event.type !== "power.candidates_resolved") return event;
      return {
        ...event,
        sourcePointers: [sourcePointer("power", "bob")],
        payload: {
          ...event.payload,
          initialResolution: {
            ...(event.payload.initialResolution ?? {}),
            sourcePointers: [sourcePointer("power", "bob")],
            traceId: "private-trace-id",
            storageKey: "private/storage/key",
            thinking: "hidden chain",
            reasoningContext: "hidden context",
            decisionLog: "agent receipt",
            rawProviderResponse: "provider payload",
          },
        },
      };
    });

    const json = JSON.stringify(buildRevealedRoundFacts({ events, round: 1 }));

    expect(json).not.toContain("sourcePointers");
    expect(json).not.toContain("private-trace-id");
    expect(json).not.toContain("storageKey");
    expect(json).not.toContain("thinking");
    expect(json).not.toContain("reasoningContext");
    expect(json).not.toContain("decisionLog");
    expect(json).not.toContain("rawProviderResponse");
  });

  it("keeps accepted Save-or-Eliminate ballots operator-readable and reveals them in roster order", () => {
    const state = createGameState();
    state.startRound();
    state.recordFormatMenu("alice", ["save_or_eliminate", "vote_bomb"]);
    state.recordFormatSelected("alice", "save_or_eliminate");
    state.recordFormatBallot({
      formatId: "save_or_eliminate",
      voterId: "dave",
      targetId: "bob",
      polarity: "eliminate",
    });
    state.recordFormatBallot({
      formatId: "save_or_eliminate",
      voterId: "bob",
      targetId: "charlie",
      polarity: "save",
    });
    state.recordFormatBallot({
      formatId: "save_or_eliminate",
      voterId: "alice",
      targetId: "bob",
      polarity: "eliminate",
    });
    state.recordFormatBallot({
      formatId: "save_or_eliminate",
      voterId: "charlie",
      targetId: "bob",
      polarity: "eliminate",
    });
    state.recordFormatResolution({
      formatId: "save_or_eliminate",
      empoweredId: "alice",
      eliminatedId: "bob",
      resolutionKind: "clear",
      tiedPlayerIds: ["bob", "charlie"],
      tiebreakerId: "alice",
      saveOrEliminate: {
        nets: { alice: 0, bob: -3, charlie: 1, dave: 0 },
        savesReceived: { alice: 0, bob: 0, charlie: 1, dave: 0 },
        eliminateReceived: { alice: 0, bob: 3, charlie: 0, dave: 0 },
      },
      voteBomb: null,
      safetyBounce: null,
    });

    const publicRead = buildRevealedRoundFacts({ events: state.getCanonicalEvents(), round: 1 });
    const format = publicRead.roundFacts.format;

    expect(format.status).toBe("available");
    expect(format.empowered).toEqual({ id: "alice", name: "Alice" });
    expect(format.offeredFormatIds).toEqual(["save_or_eliminate", "vote_bomb"]);
    expect(format.selectedFormatId).toBe("save_or_eliminate");
    expect(format.eliminated).toEqual({ id: "bob", name: "Bob" });
    expect(format.tied.map((p) => p.id)).toEqual(["bob", "charlie"]);
    expect(format.tiebreaker).toEqual({ id: "alice", name: "Alice" });
    expect(format.saveOrEliminate?.nets.find((row) => row.player.id === "bob")?.votes).toBe(-3);
    expect(format.acceptedBallots.map((entry) => entry.voter.id)).toEqual([
      "dave",
      "bob",
      "alice",
      "charlie",
    ]);
    expect(format.ballotPresentation).toEqual({
      status: "revealed",
      rollCall: [
      {
        voter: { id: "alice", name: "Alice" },
        target: { id: "bob", name: "Bob" },
        polarity: "eliminate",
      },
      {
        voter: { id: "bob", name: "Bob" },
        target: { id: "charlie", name: "Charlie" },
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
    // Format-kernel omits classic Power/Council keys entirely.
    expect(publicRead.roundFacts.power).toBeUndefined();
    expect(publicRead.roundFacts.council).toBeUndefined();
    expect(publicRead.availability.diagnostics.map((d) => d.code)).not.toContain("power_not_yet_resolved");
    expect(publicRead.availability.diagnostics.map((d) => d.code)).not.toContain("council_not_yet_resolved");
    // Empower ledger must not emit null expose noise on format-kernel rounds.
    for (const entry of publicRead.roundFacts.standardVote.ledger) {
      expect("exposeTarget" in entry).toBe(false);
    }

  });

  it("keeps Vote Bomb accepted ballots readable while presentation stays sealed until resolution", () => {
    const state = createGameState();
    state.startRound();
    state.recordFormatMenu("bob", ["vote_bomb", "safety_bounce"]);
    state.recordFormatSelected("bob", "vote_bomb");
    const ballotPrefixes = [];
    for (const [index, voter] of (["alice", "bob", "charlie", "dave"] as const).entries()) {
      state.recordFormatBallot({
        formatId: "vote_bomb",
        voterId: voter,
        targetId: voter === "charlie" || voter === "dave" ? "alice" : "charlie",
      });
      if (index === 0 || index === 1 || index === 3) {
        ballotPrefixes.push(
          buildRevealedRoundFacts({ events: state.getCanonicalEvents(), round: 1 }),
        );
      }
    }
    expect(ballotPrefixes.map((prefix) =>
      prefix.roundFacts.format.acceptedBallots.map((entry) => entry.voter.id)
    )).toEqual([
      ["alice"],
      ["alice", "bob"],
      ["alice", "bob", "charlie", "dave"],
    ]);
    expect(ballotPrefixes.map((prefix) => prefix.roundFacts.format.ballotPresentation.status))
      .toEqual(["sealed", "sealed", "sealed"]);
    const beforeResolution = ballotPrefixes.at(-1)!;
    expect(beforeResolution.roundFacts.format.eliminated).toBeNull();
    expect(beforeResolution.roundFacts.format.acceptedBallots).toEqual([
      {
        voter: { id: "alice", name: "Alice" },
        target: { id: "charlie", name: "Charlie" },
        polarity: null,
      },
      {
        voter: { id: "bob", name: "Bob" },
        target: { id: "charlie", name: "Charlie" },
        polarity: null,
      },
      {
        voter: { id: "charlie", name: "Charlie" },
        target: { id: "alice", name: "Alice" },
        polarity: null,
      },
      {
        voter: { id: "dave", name: "Dave" },
        target: { id: "alice", name: "Alice" },
        polarity: null,
      },
    ]);
    expect(beforeResolution.roundFacts.format.ballotPresentation).toEqual({
      status: "sealed",
      rollCall: [],
    });

    state.recordFormatResolution({
      formatId: "vote_bomb",
      empoweredId: "bob",
      eliminatedId: "alice",
      resolutionKind: "clear",
      tiedPlayerIds: ["alice", "charlie"],
      tiebreakerId: "bob",
      saveOrEliminate: null,
      voteBomb: {
        totals: { alice: 2, bob: 0, charlie: 2, dave: 0 },
        zeroSafePlayerIds: ["bob", "dave"],
      },
      safetyBounce: null,
    });

    const read = buildRevealedRoundFacts({ events: state.getCanonicalEvents(), round: 1 });
    expect(read.roundFacts.format.selectedFormatId).toBe("vote_bomb");
    expect(read.roundFacts.format.voteBomb?.zeroSafe.map((p) => p.id).sort()).toEqual(["bob", "dave"]);
    expect(read.roundFacts.format.voteBomb?.totals.find((row) => row.player.id === "charlie")?.votes).toBe(2);
    expect(read.roundFacts.format.acceptedBallots).toEqual(
      beforeResolution.roundFacts.format.acceptedBallots,
    );
    expect(read.roundFacts.format.ballotPresentation).toEqual({
      status: "revealed",
      rollCall: beforeResolution.roundFacts.format.acceptedBallots,
    });
  });

  it("reveals menu-less Majority Elimination totals and rejects a conflicting outcome", () => {
    const state = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "charlie", name: "Charlie" },
        { id: "dave", name: "Dave" },
      ],
      {
        gameId: "game-round-facts-majority-elimination",
        now: fixedClock(),
        formatManifest: ["majority_elimination"],
      },
    );
    state.startRound();
    state.recordFormatSelected("alice", "majority_elimination");
    state.recordFormatBallot({ formatId: "majority_elimination", voterId: "alice", targetId: "bob" });
    state.recordFormatBallot({ formatId: "majority_elimination", voterId: "bob", targetId: "charlie" });
    state.recordFormatBallot({ formatId: "majority_elimination", voterId: "charlie", targetId: "bob" });
    state.recordFormatBallot({ formatId: "majority_elimination", voterId: "dave", targetId: "bob" });
    state.recordFormatResolution({
      formatId: "majority_elimination",
      empoweredId: "alice",
      eliminatedId: "bob",
      resolutionKind: "auto",
      tiedPlayerIds: ["bob"],
      tiebreakerId: null,
      aggregate: {
        capability: "sealed_elim",
        totals: { alice: 0, bob: 3, charlie: 1, dave: 0 },
        eligiblePlayerIds: ["alice", "bob", "charlie", "dave"],
      },
    });

    const read = buildRevealedRoundFacts({ events: state.getCanonicalEvents(), round: 1 });
    expect(read.roundFacts.format.selectedFormatId).toBe("majority_elimination");
    expect(read.roundFacts.format.offeredFormatIds).toBeNull();
    expect(read.roundFacts.format.majorityElimination?.totals).toEqual([
      { player: { id: "bob", name: "Bob" }, votes: 3 },
      { player: { id: "charlie", name: "Charlie" }, votes: 1 },
      { player: { id: "alice", name: "Alice" }, votes: 0 },
      { player: { id: "dave", name: "Dave" }, votes: 0 },
    ]);
    expect(read.roundFacts.format.voteBomb).toBeNull();
    expect(read.roundFacts.format.safetyBounce).toBeNull();
    expect(read.roundFacts.format.ballotPresentation.status).toBe("revealed");
    expect(read.roundFacts.power).toBeUndefined();
    expect(read.roundFacts.council).toBeUndefined();

    const contradicted: CanonicalGameEvent[] = state.getCanonicalEvents().map((event) =>
      event.type === "format.resolved"
        ? ({
            ...event,
            payload: { ...event.payload, eliminatedId: "charlie" },
          } as CanonicalGameEvent)
        : event
    );
    expect(buildRevealedRoundFacts({ events: contradicted, round: 1 })
      .roundFacts.format.ballotPresentation).toEqual({
      status: "unavailable",
      rollCall: [],
    });

    const aggregateMismatch: CanonicalGameEvent[] = state.getCanonicalEvents().map((event) =>
      event.type === "format.resolved" && event.payloadVersion === 2
        ? ({
            ...event,
            payload: {
              ...event.payload,
              aggregate: {
                capability: "sealed_elim",
                totals: { alice: 0, bob: 2, charlie: 2, dave: 0 },
                eligiblePlayerIds: ["alice", "bob", "charlie", "dave"],
              },
            },
          } as CanonicalGameEvent)
        : event
    );
    expect(buildRevealedRoundFacts({ events: aggregateMismatch, round: 1 })
      .roundFacts.format.ballotPresentation).toEqual({
      status: "unavailable",
      rollCall: [],
    });
  });

  it("exposes Safety Bounce public chain, sole-vulnerable auto-elim, and live in-progress facts", () => {
    const state = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "charlie", name: "Charlie" },
      ],
      { gameId: "game-round-facts-sole-vulnerable", now: fixedClock() },
    );
    state.startRound();
    state.recordFormatMenu("charlie", ["safety_bounce", "save_or_eliminate"]);
    state.recordFormatSelected("charlie", "safety_bounce");
    state.recordSafetyBounceStarted("alice");
    state.recordSafetyBouncePointer("alice", "bob", "vulnerable");

    const inProgress = buildRevealedRoundFacts({ events: state.getCanonicalEvents(), round: 1 });
    expect(inProgress.roundFacts.format.status).toBe("available");
    expect(inProgress.roundFacts.format.selectedFormatId).toBe("safety_bounce");
    expect(inProgress.roundFacts.format.eliminated).toBeNull();
    expect(inProgress.roundFacts.format.safetyBounce?.starter).toEqual({ id: "alice", name: "Alice" });
    expect(inProgress.roundFacts.format.safetyBounce?.pointers).toEqual([
      {
        actor: { id: "alice", name: "Alice" },
        target: { id: "bob", name: "Bob" },
        classification: "vulnerable",
      },
    ]);
    expect(inProgress.roundFacts.format.safetyBounce?.safe.map((p) => p.id)).toEqual(["alice"]);
    expect(inProgress.roundFacts.format.safetyBounce?.vulnerable.map((p) => p.id)).toEqual(["bob"]);
    expect(inProgress.availability.diagnostics.map((d) => d.code)).toContain("format_in_progress");

    // Finish classification with sole vulnerable auto-elim (no sealed vote).
    state.recordSafetyBouncePointer("bob", "charlie", "safe");
    state.recordFormatResolution({
      formatId: "safety_bounce",
      empoweredId: "charlie",
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

    const resolved = buildRevealedRoundFacts({ events: state.getCanonicalEvents(), round: 1 });
    expect(resolved.roundFacts.format.resolutionKind).toBe("auto");
    expect(resolved.roundFacts.format.eliminated).toEqual({ id: "bob", name: "Bob" });
    expect(resolved.roundFacts.format.safetyBounce?.vulnerable.map((p) => p.id)).toEqual(["bob"]);
    expect(resolved.roundFacts.format.safetyBounce?.voteTotals).toEqual([]);
    expect(resolved.roundFacts.format.acceptedBallots).toEqual([]);
    expect(resolved.roundFacts.format.ballotPresentation).toEqual({
      status: "not_applicable",
      rollCall: [],
    });
  });

  it("marks missing, duplicate, unknown-player, wrong-format, and aggregate-mismatch ballots unavailable", () => {
    function validVoteBombEvents(): CanonicalGameEvent[] {
      const state = createGameState();
      state.startRound();
      state.recordFormatMenu("alice", ["vote_bomb", "save_or_eliminate"]);
      state.recordFormatSelected("alice", "vote_bomb");
      state.recordFormatBallot({ formatId: "vote_bomb", voterId: "dave", targetId: "bob" });
      state.recordFormatBallot({ formatId: "vote_bomb", voterId: "bob", targetId: "charlie" });
      state.recordFormatBallot({ formatId: "vote_bomb", voterId: "alice", targetId: "bob" });
      state.recordFormatBallot({ formatId: "vote_bomb", voterId: "charlie", targetId: "bob" });
      state.recordFormatResolution({
        formatId: "vote_bomb",
        empoweredId: "alice",
        eliminatedId: "charlie",
        resolutionKind: "auto",
        tiedPlayerIds: ["charlie"],
        tiebreakerId: null,
        saveOrEliminate: null,
        voteBomb: {
          totals: { alice: 0, bob: 3, charlie: 1, dave: 0 },
          zeroSafePlayerIds: ["alice", "dave"],
        },
        safetyBounce: null,
      });
      return [...state.getCanonicalEvents()];
    }

    const ballotIndexes = validVoteBombEvents()
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.type === "format.ballot_cast")
      .map(({ index }) => index);
    const firstBallotIndex = ballotIndexes[0]!;
    const secondBallotIndex = ballotIndexes[1]!;

    const cases: Array<{ name: string; events: CanonicalGameEvent[] }> = [
      {
        name: "missing",
        events: validVoteBombEvents()
          .filter((_, index) => index !== firstBallotIndex)
          .map((event, index) => ({ ...event, sequence: index + 1 })),
      },
      {
        name: "duplicate",
        events: validVoteBombEvents().map((event, index) =>
          index === secondBallotIndex && event.type === "format.ballot_cast"
            ? { ...event, payload: { ...event.payload, voterId: "dave" } }
            : event
        ),
      },
      {
        name: "unknown-player",
        events: validVoteBombEvents().map((event, index) =>
          index === firstBallotIndex && event.type === "format.ballot_cast"
            ? { ...event, payload: { ...event.payload, targetId: "unknown" } }
            : event
        ),
      },
      {
        name: "wrong-format",
        events: validVoteBombEvents().map((event, index) =>
          index === firstBallotIndex && event.type === "format.ballot_cast"
            ? { ...event, payload: { ...event.payload, formatId: "save_or_eliminate" } }
            : event
        ),
      },
      {
        name: "aggregate-mismatch",
        events: validVoteBombEvents().map((event) =>
          event.type === "format.resolved" && event.payloadVersion === 2
            ? {
                ...event,
                payload: {
                  ...event.payload,
                  aggregate: {
                    capability: "sealed_elim" as const,
                    totals: { alice: 0, bob: 2, charlie: 2, dave: 0 },
                    eligiblePlayerIds: ["bob", "charlie"],
                  },
                },
              }
            : event
        ),
      },
    ];

    for (const testCase of cases) {
      const presentation = buildRevealedRoundFacts({
        events: testCase.events,
        round: 1,
      }).roundFacts.format.ballotPresentation;
      expect(presentation.status, testCase.name).toBe("unavailable");
      expect(presentation.rollCall, testCase.name).toEqual([]);
    }
  });

  it("freezes last regular empower across startRound into endgame.stage_set and endgame facts", () => {
    const state = createGameState();
    state.startRound();
    state.setEmpowered("alice", "initial");
    state.recordFormatMenu("alice", ["save_or_eliminate", "vote_bomb"]);
    state.recordFormatSelected("alice", "save_or_eliminate");
    state.recordFormatResolution({
      formatId: "save_or_eliminate",
      empoweredId: "alice",
      eliminatedId: "bob",
      resolutionKind: "clear",
      tiedPlayerIds: [],
      tiebreakerId: null,
      saveOrEliminate: {
        nets: { alice: 0, bob: -1, charlie: 0, dave: 0 },
        savesReceived: { alice: 0, bob: 0, charlie: 0, dave: 0 },
        eliminateReceived: { alice: 0, bob: 1, charlie: 0, dave: 0 },
      },
      voteBomb: null,
      safetyBounce: null,
    });
    // Reckoning lobby clears per-round empower then opens endgame — sticky last empower must survive.
    state.startRound();
    state.setEndgameStage("reckoning");

    const stageSet = state.getCanonicalEvents().find((event) => event.type === "endgame.stage_set");
    expect(stageSet?.type).toBe("endgame.stage_set");
    if (stageSet?.type === "endgame.stage_set") {
      expect(stageSet.payload.lastEmpoweredFromRegularRounds).toBe("alice");
    }

    const endgameRound = state.round;
    const facts = buildRevealedRoundFacts({
      events: state.getCanonicalEvents(),
      round: endgameRound,
      kernel: "format",
    });
    expect(facts.roundFacts.endgame?.stage).toBe("reckoning");
    expect(facts.roundFacts.endgame?.lastEmpoweredFromRegularRounds).toEqual({
      id: "alice",
      name: "Alice",
    });
  });

  it("backfills lastEmpowered from prior empower/format events when stage_set stored null", () => {
    const state = createGameState();
    state.startRound();
    state.setEmpowered("bob", "initial");
    state.recordFormatMenu("bob", ["vote_bomb", "safety_bounce"]);
    state.recordFormatSelected("bob", "vote_bomb");
    // Force the historical bug: stage_set written after startRound cleared empower → null payload.
    state.startRound();
    state.setEndgameStage("reckoning");
    const events = state.getCanonicalEvents().map((event) => {
      if (event.type !== "endgame.stage_set") return event;
      return {
        ...event,
        payload: {
          ...event.payload,
          lastEmpoweredFromRegularRounds: null,
        },
      };
    });
    // Reader must recover bob from prior empower/format events even when payload is null.
    const facts = buildRevealedRoundFacts({
      events,
      round: state.round,
      kernel: "format",
    });
    expect(facts.roundFacts.endgame?.lastEmpoweredFromRegularRounds).toEqual({
      id: "bob",
      name: "Bob",
    });
  });

  it("never leaks thinking or decision receipts into format facts under any ballot scope", () => {
    const state = createGameState();
    state.startRound();
    state.recordFormatMenu("alice", ["save_or_eliminate", "vote_bomb"]);
    state.recordFormatSelected("alice", "save_or_eliminate");
    state.recordFormatBallot(
      {
        formatId: "save_or_eliminate",
        voterId: "alice",
        targetId: "bob",
        polarity: "save",
      },
      [sourcePointer("format-ballot", "alice")],
    );
    state.recordFormatResolution({
      formatId: "save_or_eliminate",
      empoweredId: "alice",
      eliminatedId: "bob",
      resolutionKind: "clear",
      tiedPlayerIds: [],
      tiebreakerId: null,
      saveOrEliminate: {
        nets: { alice: 0, bob: 1, charlie: 0, dave: 0 },
        savesReceived: { alice: 0, bob: 1, charlie: 0, dave: 0 },
        eliminateReceived: { alice: 0, bob: 0, charlie: 0, dave: 0 },
      },
      voteBomb: null,
      safetyBounce: null,
    });

    const json = JSON.stringify(
      buildRevealedRoundFacts({
        events: state.getCanonicalEvents(),
        round: 1,
      }),
    );
    expect(json).not.toContain("thinking");
    expect(json).not.toContain("reasoningContext");
    expect(json).not.toContain("decisionLog");
    expect(json).not.toContain("sourcePointers");
    expect(json).not.toContain("private-trace-source-pointer");
  });
});
