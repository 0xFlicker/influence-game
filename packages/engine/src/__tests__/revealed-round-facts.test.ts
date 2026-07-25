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

  it("exposes public Save-or-Eliminate aggregates without voter→ballot mappings", () => {
    const state = createGameState();
    state.startRound();
    state.recordFormatMenu("alice", ["save_or_eliminate", "vote_bomb"]);
    state.recordFormatSelected("alice", "save_or_eliminate");
    state.recordFormatBallot({
      formatId: "save_or_eliminate",
      voterId: "alice",
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
      tiedPlayerIds: ["bob", "charlie"],
      tiebreakerId: "alice",
      saveOrEliminate: {
        nets: { alice: 0, bob: -2, charlie: 1, dave: 0 },
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
    expect(format.saveOrEliminate?.nets.find((row) => row.player.id === "bob")?.votes).toBe(-2);
    expect(format.sealedBallots).toEqual([]);
    expect(format.sealedBallotAccess).toBe("public");
    // Format-kernel omits classic Power/Council keys entirely.
    expect(publicRead.roundFacts.power).toBeUndefined();
    expect(publicRead.roundFacts.council).toBeUndefined();
    expect(publicRead.availability.diagnostics.map((d) => d.code)).not.toContain("power_not_yet_resolved");
    expect(publicRead.availability.diagnostics.map((d) => d.code)).not.toContain("council_not_yet_resolved");
    // Empower ledger must not emit null expose noise on format-kernel rounds.
    for (const entry of publicRead.roundFacts.standardVote.ledger) {
      expect("exposeTarget" in entry).toBe(false);
    }

    const ownerRead = buildRevealedRoundFacts({
      events: state.getCanonicalEvents(),
      round: 1,
      ballotAccess: { mode: "owner", ownedPlayerIds: ["alice"] },
    });
    expect(ownerRead.roundFacts.format.sealedBallotAccess).toBe("owner");
    expect(ownerRead.roundFacts.format.sealedBallots).toEqual([
      {
        voter: { id: "alice", name: "Alice" },
        target: { id: "bob", name: "Bob" },
        polarity: "eliminate",
      },
    ]);

    const producerRead = buildRevealedRoundFacts({
      events: state.getCanonicalEvents(),
      round: 1,
      ballotAccess: { mode: "producer" },
    });
    expect(producerRead.roundFacts.format.sealedBallotAccess).toBe("producer");
    expect(producerRead.roundFacts.format.sealedBallots).toHaveLength(4);
    expect(
      producerRead.roundFacts.format.sealedBallots.map((b) => b.voter.id).sort(),
    ).toEqual(["alice", "bob", "charlie", "dave"]);
  });

  it("exposes public Vote Bomb aggregates and zero-safe set without sealed mappings", () => {
    const state = createGameState();
    state.startRound();
    state.recordFormatMenu("bob", ["vote_bomb", "safety_bounce"]);
    state.recordFormatSelected("bob", "vote_bomb");
    for (const voter of ["alice", "bob", "charlie", "dave"] as const) {
      state.recordFormatBallot({
        formatId: "vote_bomb",
        voterId: voter,
        targetId: voter === "dave" ? "alice" : "charlie",
      });
    }
    state.recordFormatResolution({
      formatId: "vote_bomb",
      empoweredId: "bob",
      eliminatedId: "alice",
      resolutionKind: "clear",
      tiedPlayerIds: [],
      tiebreakerId: null,
      saveOrEliminate: null,
      voteBomb: {
        totals: { alice: 1, bob: 0, charlie: 3, dave: 0 },
        zeroSafePlayerIds: ["bob", "dave"],
      },
      safetyBounce: null,
    });

    const read = buildRevealedRoundFacts({ events: state.getCanonicalEvents(), round: 1 });
    expect(read.roundFacts.format.selectedFormatId).toBe("vote_bomb");
    expect(read.roundFacts.format.voteBomb?.zeroSafe.map((p) => p.id).sort()).toEqual(["bob", "dave"]);
    expect(read.roundFacts.format.voteBomb?.totals.find((row) => row.player.id === "charlie")?.votes).toBe(3);
    expect(read.roundFacts.format.sealedBallots).toEqual([]);
  });

  it("exposes Safety Bounce public chain, sole-vulnerable auto-elim, and live in-progress facts", () => {
    const state = createGameState();
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
    state.recordSafetyBouncePointer("charlie", "dave", "safe");
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
        safePlayerIds: ["alice", "charlie", "dave"],
        vulnerablePlayerIds: ["bob"],
        voteTotals: {},
      },
    });

    const resolved = buildRevealedRoundFacts({ events: state.getCanonicalEvents(), round: 1 });
    expect(resolved.roundFacts.format.resolutionKind).toBe("auto");
    expect(resolved.roundFacts.format.eliminated).toEqual({ id: "bob", name: "Bob" });
    expect(resolved.roundFacts.format.safetyBounce?.vulnerable.map((p) => p.id)).toEqual(["bob"]);
    expect(resolved.roundFacts.format.safetyBounce?.voteTotals).toEqual([]);
    expect(resolved.roundFacts.format.sealedBallots).toEqual([]);
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

    for (const ballotAccess of [
      undefined,
      { mode: "public" as const },
      { mode: "owner" as const, ownedPlayerIds: ["alice"] },
      { mode: "producer" as const },
    ]) {
      const json = JSON.stringify(
        buildRevealedRoundFacts({
          events: state.getCanonicalEvents(),
          round: 1,
          ballotAccess,
        }),
      );
      expect(json).not.toContain("thinking");
      expect(json).not.toContain("reasoningContext");
      expect(json).not.toContain("decisionLog");
      expect(json).not.toContain("sourcePointers");
      expect(json).not.toContain("private-trace-source-pointer");
    }
  });
});
