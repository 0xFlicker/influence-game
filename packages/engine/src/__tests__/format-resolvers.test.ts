import { describe, expect, it } from "bun:test";
import {
  applyBouncePointer,
  applyFormatTiebreak,
  buildFormatMenu,
  computeSaveOrEliminateNets,
  computeVoteBombTallies,
  createBounceBoard,
  expectedBouncePoolSizes,
  isLegalBouncePointer,
  isLegalSaveOrEliminateBallot,
  isLegalVoteBombBallot,
  pickFormatFromMenu,
  resolveSafetyBounceVote,
  resolveSaveOrEliminate,
  resolveVoteBomb,
  type LaunchFormatId,
  type SaveOrEliminateBallot,
  type VoteBombBallot,
} from "../formats";
import {
  buildFormatPressureProjection,
  ruleSheetForFormat,
} from "../format-pressure";

const ids = (...names: string[]) => names.map((n) => n.toLowerCase());

describe("format menu", () => {
  it("offers two distinct formats", () => {
    const { offered } = buildFormatMenu({ lastFormatId: null, random: () => 0 });
    expect(offered).toHaveLength(2);
    expect(offered[0]).not.toBe(offered[1]);
  });

  it("hard-bans last format when two alternatives remain", () => {
    const { offered } = buildFormatMenu({ lastFormatId: "vote_bomb" });
    expect(offered).toContain("save_or_eliminate");
    expect(offered).toContain("safety_bounce");
    expect(offered).not.toContain("vote_bomb");
  });

  it("pickFormatFromMenu accepts only offered ids", () => {
    const offered: [LaunchFormatId, LaunchFormatId] = ["vote_bomb", "safety_bounce"];
    expect(pickFormatFromMenu(offered, "vote_bomb")).toBe("vote_bomb");
    expect(pickFormatFromMenu(offered, "save_or_eliminate")).toBeNull();
    expect(pickFormatFromMenu(offered, "nope")).toBeNull();
  });
});

describe("format pressure", () => {
  it("projects the locked format and public bounce board without sealed ballot targets", () => {
    const bounceBoard = {
      safe: ["a"],
      vulnerable: ["b"],
      unclassified: ["c", "d"],
      nextActorId: "b",
    };
    const pressure = buildFormatPressureProjection({
      empoweredId: "a",
      empoweredName: "Alpha",
      offeredFormats: ["vote_bomb", "safety_bounce"],
      selectedFormat: "safety_bounce",
      bounceBoard,
    });

    expect(pressure).toEqual({
      empoweredId: "a",
      empoweredName: "Alpha",
      offeredFormats: ["vote_bomb", "safety_bounce"],
      selectedFormat: "safety_bounce",
      ruleSheetSummary: ruleSheetForFormat("safety_bounce"),
      bounceBoard,
    });
    expect("targetId" in pressure).toBe(false);
    expect("ballots" in pressure).toBe(false);
  });
});

describe("save-or-eliminate", () => {
  it("Covers AE2: dual lowest net → tie for empowered", () => {
    const alive = ids("A", "B", "C", "D");
    // nets A:+2, B:-1, C:-1, D:0 — two saves for A, one elim each for B and C
    const legal: SaveOrEliminateBallot[] = [
      { voterId: "b", polarity: "save", targetId: "a" },
      { voterId: "c", polarity: "save", targetId: "a" },
      { voterId: "d", polarity: "eliminate", targetId: "b" },
      { voterId: "a", polarity: "eliminate", targetId: "c" },
    ];
    const { nets } = computeSaveOrEliminateNets(alive, legal);
    expect(nets.a).toBe(2);
    expect(nets.b).toBe(-1);
    expect(nets.c).toBe(-1);
    expect(nets.d).toBe(0);

    const resolution = resolveSaveOrEliminate(alive, legal);
    expect(resolution.kind).toBe("tie");
    expect(resolution.tiedSet.sort()).toEqual(["b", "c"]);
    expect(resolution.eliminatedId).toBeNull();

    const broken = applyFormatTiebreak(resolution.tiedSet, "b");
    expect(broken).toEqual({ kind: "clear", eliminatedId: "b", tiedSet: ["b", "c"] });
  });

  it("sole lowest net auto-elims", () => {
    const alive = ids("A", "B", "C");
    const ballots: SaveOrEliminateBallot[] = [
      { voterId: "a", polarity: "eliminate", targetId: "b" },
      { voterId: "c", polarity: "eliminate", targetId: "b" },
      { voterId: "b", polarity: "save", targetId: "a" },
    ];
    const resolution = resolveSaveOrEliminate(alive, ballots);
    expect(resolution.kind).toBe("auto");
    expect(resolution.eliminatedId).toBe("b");
  });

  it("rejects self-save and self-eliminate", () => {
    const alive = ids("A", "B");
    expect(isLegalSaveOrEliminateBallot("a", "a", "save", alive)).toBe(false);
    expect(isLegalSaveOrEliminateBallot("a", "a", "eliminate", alive)).toBe(false);
    expect(isLegalSaveOrEliminateBallot("a", "b", "save", alive)).toBe(true);
  });
});

describe("vote bomb", () => {
  it("Covers AE3: zero safe + dual fewest positive → tie", () => {
    // A:3 B:1 C:1 D:0 E:0
    const alive5 = ids("A", "B", "C", "D", "E");
    const ballots5: VoteBombBallot[] = [
      { voterId: "b", targetId: "a" },
      { voterId: "c", targetId: "a" },
      { voterId: "d", targetId: "a" },
      { voterId: "e", targetId: "b" },
      { voterId: "a", targetId: "c" },
    ];
    const tallies = computeVoteBombTallies(alive5, ballots5);
    expect(tallies.totals.a).toBe(3);
    expect(tallies.totals.b).toBe(1);
    expect(tallies.totals.c).toBe(1);
    expect(tallies.totals.d).toBe(0);
    expect(tallies.zeroSafeIds).toContain("d");

    const resolution = resolveVoteBomb(alive5, ballots5);
    expect(resolution.kind).toBe("tie");
    expect(resolution.tiedSet.sort()).toEqual(["b", "c"]);
    expect(resolution.eliminatedId).toBeNull();
  });

  it("sole positive fewest auto-elims", () => {
    const alive = ids("A", "B", "C");
    const ballots: VoteBombBallot[] = [
      { voterId: "b", targetId: "a" },
      { voterId: "c", targetId: "a" },
      { voterId: "a", targetId: "b" },
    ];
    // A:2 B:1 C:0 → fewest positive is B
    const resolution = resolveVoteBomb(alive, ballots);
    expect(resolution.kind).toBe("auto");
    expect(resolution.eliminatedId).toBe("b");
  });

  it("rejects self-votes", () => {
    expect(isLegalVoteBombBallot("a", "a", ids("A", "B"))).toBe(false);
    expect(isLegalVoteBombBallot("a", "b", ids("A", "B"))).toBe(true);
  });
});

describe("safety bounce", () => {
  it("starter is safe and points first", () => {
    const alive = ids("A", "B", "C", "D", "E");
    const board = createBounceBoard(alive, "a");
    expect(board.safe).toEqual(["a"]);
    expect(board.vulnerable).toEqual([]);
    expect(board.unclassified.sort()).toEqual(["b", "c", "d", "e"]);
    expect(board.nextActorId).toBe("a");
  });

  it("Covers AE4: only vulnerable pool is vote-eligible after full chain", () => {
    const alive = ids("A", "B", "C", "D", "E");
    let board = createBounceBoard(alive, "a");
    // a(safe)→b vulnerable
    board = applyBouncePointer(board, { actorId: "a", targetId: "b" });
    // b(vuln)→c safe
    board = applyBouncePointer(board, { actorId: "b", targetId: "c" });
    // c(safe)→d vulnerable
    board = applyBouncePointer(board, { actorId: "c", targetId: "d" });
    // d(vuln)→e safe
    board = applyBouncePointer(board, { actorId: "d", targetId: "e" });

    expect(board.unclassified).toEqual([]);
    expect(board.nextActorId).toBeNull();
    expect(board.safe.sort()).toEqual(["a", "c", "e"]);
    expect(board.vulnerable.sort()).toEqual(["b", "d"]);
    expect(expectedBouncePoolSizes(5)).toEqual({ safe: 3, vulnerable: 2 });
  });

  it("matches expected pool sizes for N=5..12", () => {
    for (let n = 5; n <= 12; n++) {
      const alive = Array.from({ length: n }, (_, i) => `p${i}`);
      let board = createBounceBoard(alive, "p0");
      while (board.nextActorId !== null) {
        const target = board.unclassified[0]!;
        board = applyBouncePointer(board, { actorId: board.nextActorId, targetId: target });
      }
      const expected = expectedBouncePoolSizes(n);
      expect(board.safe.length).toBe(expected.safe);
      expect(board.vulnerable.length).toBe(expected.vulnerable);
    }
  });

  it("rejects self and already-classified targets", () => {
    const alive = ids("A", "B", "C");
    const board = createBounceBoard(alive, "a");
    expect(isLegalBouncePointer(board, { actorId: "a", targetId: "a" })).toBe(false);
    expect(isLegalBouncePointer(board, { actorId: "a", targetId: "b" })).toBe(true);
    const after = applyBouncePointer(board, { actorId: "a", targetId: "b" });
    expect(isLegalBouncePointer(after, { actorId: "b", targetId: "a" })).toBe(false);
  });

  it("sole vulnerable auto-elims without vote tallies", () => {
    const resolution = resolveSafetyBounceVote(["b"], {});
    expect(resolution.kind).toBe("auto");
    expect(resolution.eliminatedId).toBe("b");
    if (resolution.kind === "auto") {
      expect(resolution.reason).toBe("sole_vulnerable");
    }
  });

  it("most votes in vulnerable pool wins; ties need empowered", () => {
    const clear = resolveSafetyBounceVote(["b", "c", "e"], { b: 2, c: 1, e: 0 });
    expect(clear.kind).toBe("clear");
    expect(clear.eliminatedId).toBe("b");

    const tie = resolveSafetyBounceVote(["b", "c"], { b: 2, c: 2 });
    expect(tie.kind).toBe("tie");
    expect(tie.tiedSet.sort()).toEqual(["b", "c"]);
  });
});
