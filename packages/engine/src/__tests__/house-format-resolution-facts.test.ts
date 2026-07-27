import { describe, expect, it } from "bun:test";
import { buildHouseFormatResolutionFacts } from "../formats/house-resolution-facts";
import { GameState } from "../game-state";

function fixedClock(): () => number {
  let ticks = 0;
  return () => 1_700_300_000_000 + ticks++;
}

function names(state: GameState) {
  return (id: string) => state.getPlayerName(id);
}

describe("buildHouseFormatResolutionFacts", () => {
  it("rebuilds Save-or-Eliminate omniscient facts from durable events only", () => {
    const state = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "charlie", name: "Charlie" },
        { id: "dave", name: "Dave" },
      ],
      { gameId: "house-soe-facts", now: fixedClock() },
    );
    state.startRound();
    state.setEmpowered("alice", "initial");
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
      targetId: "alice",
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
      tiedPlayerIds: [],
      tiebreakerId: null,
      saveOrEliminate: {
        nets: { alice: 1, bob: -3, charlie: 0, dave: 0 },
        savesReceived: { alice: 1, bob: 0, charlie: 0, dave: 0 },
        eliminateReceived: { alice: 0, bob: 3, charlie: 0, dave: 0 },
      },
      voteBomb: null,
      safetyBounce: null,
    });

    const facts = buildHouseFormatResolutionFacts(state.getCanonicalEvents(), 1, names(state));
    expect(facts).not.toBeNull();
    if (!facts) throw new Error("expected facts");
    expect(facts.formatId).toBe("save_or_eliminate");
    expect(facts.offeredFormatIds).toEqual(["save_or_eliminate", "vote_bomb"]);
    expect(facts.ballots).toHaveLength(4);
    expect(facts.ballots.map((ballot) => ballot.voterName)).toEqual([
      "Alice",
      "Bob",
      "Charlie",
      "Dave",
    ]);
    expect(facts.ballots.some((b) => b.voterName === "Alice" && b.polarity === "eliminate")).toBe(true);
    expect(facts.scores.find((s) => s.playerName === "Bob")?.value).toBe(-3);
    expect(facts.eliminatedName).toBe("Bob");
    expect(facts.resolutionKind).toBe("clear");
    expect(facts.resolutionSummary).toContain("Bob");
  });

  it("rebuilds Vote Bomb and Safety Bounce scoreboards from the same event path", () => {
    const voteBomb = new GameState(
      [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
        { id: "c", name: "C" },
        { id: "d", name: "D" },
      ],
      { gameId: "house-vb-facts", now: fixedClock() },
    );
    voteBomb.startRound();
    voteBomb.setEmpowered("a", "initial");
    voteBomb.recordFormatMenu("a", ["vote_bomb", "safety_bounce"]);
    voteBomb.recordFormatSelected("a", "vote_bomb");
    voteBomb.recordFormatBallot({ formatId: "vote_bomb", voterId: "a", targetId: "b" });
    voteBomb.recordFormatBallot({ formatId: "vote_bomb", voterId: "b", targetId: "c" });
    voteBomb.recordFormatBallot({ formatId: "vote_bomb", voterId: "c", targetId: "b" });
    voteBomb.recordFormatBallot({ formatId: "vote_bomb", voterId: "d", targetId: "b" });
    voteBomb.recordFormatResolution({
      formatId: "vote_bomb",
      empoweredId: "a",
      eliminatedId: "c",
      resolutionKind: "clear",
      tiedPlayerIds: [],
      tiebreakerId: null,
      saveOrEliminate: null,
      voteBomb: {
        totals: { a: 0, b: 3, c: 1, d: 0 },
        zeroSafePlayerIds: ["a", "d"],
      },
      safetyBounce: null,
    });

    const vb = buildHouseFormatResolutionFacts(voteBomb.getCanonicalEvents(), 1, names(voteBomb));
    expect(vb?.formatId).toBe("vote_bomb");
    expect(vb?.zeroSafeNames.sort()).toEqual(["A", "D"]);
    expect(vb?.scores.find((s) => s.playerName === "B")?.bucket).toBe("positive");
    expect(vb?.ballots).toHaveLength(4);

    const bounce = new GameState(
      [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
        { id: "c", name: "C" },
        { id: "d", name: "D" },
      ],
      { gameId: "house-sb-facts", now: fixedClock() },
    );
    bounce.startRound();
    bounce.setEmpowered("a", "initial");
    bounce.recordFormatMenu("a", ["safety_bounce", "vote_bomb"]);
    bounce.recordFormatSelected("a", "safety_bounce");
    bounce.recordSafetyBounceStarted("a");
    bounce.recordSafetyBouncePointer("a", "b", "vulnerable");
    bounce.recordSafetyBouncePointer("b", "c", "safe");
    bounce.recordSafetyBouncePointer("c", "d", "vulnerable");
    bounce.recordFormatBallot({ formatId: "safety_bounce", voterId: "a", targetId: "d" });
    bounce.recordFormatBallot({ formatId: "safety_bounce", voterId: "b", targetId: "d" });
    bounce.recordFormatBallot({ formatId: "safety_bounce", voterId: "c", targetId: "d" });
    bounce.recordFormatBallot({ formatId: "safety_bounce", voterId: "d", targetId: "b" });
    bounce.recordFormatResolution({
      formatId: "safety_bounce",
      empoweredId: "a",
      eliminatedId: "d",
      resolutionKind: "clear",
      tiedPlayerIds: [],
      tiebreakerId: null,
      saveOrEliminate: null,
      voteBomb: null,
      safetyBounce: {
        starterId: "a",
        safePlayerIds: ["a", "c"],
        vulnerablePlayerIds: ["b", "d"],
        voteTotals: { b: 1, d: 3 },
      },
    });

    const sb = buildHouseFormatResolutionFacts(bounce.getCanonicalEvents(), 1, names(bounce));
    expect(sb?.formatId).toBe("safety_bounce");
    expect(sb?.bouncePointers).toHaveLength(3);
    expect(sb?.safeNames.sort()).toEqual(["A", "C"]);
    expect(sb?.vulnerableNames.sort()).toEqual(["B", "D"]);
    expect(sb?.scores.find((s) => s.playerName === "D")?.value).toBe(3);
  });

  it("returns null when the round has no format.resolved event", () => {
    const state = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "charlie", name: "Charlie" },
        { id: "dave", name: "Dave" },
      ],
      { gameId: "house-no-resolve", now: fixedClock() },
    );
    state.startRound();
    state.setEmpowered("alice", "initial");
    state.recordFormatMenu("alice", ["vote_bomb", "save_or_eliminate"]);
    expect(buildHouseFormatResolutionFacts(state.getCanonicalEvents(), 1, names(state))).toBeNull();
  });
});
