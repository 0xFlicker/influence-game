import { describe, expect, it } from "bun:test";
import {
  applyBouncePointer,
  applyFormatTiebreak,
  buildFormatMenu,
  computeMajorityEliminationTallies,
  computeEvenVotesTallies,
  computeSaveOrEliminateNets,
  computeVoteBombTallies,
  createBounceBoard,
  expectedBouncePoolSizes,
  FORMAT_CATALOG,
  getFormatRegistration,
  isLegalBouncePointer,
  isLegalMajorityEliminationBallot,
  isLegalEvenVotesBallot,
  isLegalSaveOrEliminateBallot,
  isLegalVoteBombBallot,
  LAUNCH_FORMAT_IDS,
  pickFormatFromMenu,
  requireSealedElimRegistration,
  resolveFormatManifest,
  resolveMajorityElimination,
  resolveEvenVotes,
  resolveSafetyBounceVote,
  resolveSaveOrEliminate,
  scoreSealedElimBallots,
  resolveVoteBomb,
  type LaunchFormatId,
  type SaveOrEliminateBallot,
  type SealedElimBallot,
  type VoteBombBallot,
} from "../formats";
import {
  buildFormatPressureProjection,
  ruleSheetForFormat,
} from "../format-pressure";

const ids = (...names: string[]) => names.map((n) => n.toLowerCase());

describe("format menu", () => {
  it("offers two distinct formats", () => {
    const { offered } = buildFormatMenu({
      formatManifest: ["save_or_eliminate", "vote_bomb", "safety_bounce", "majority_elimination"],
      lastFormatId: null,
      random: () => 0,
    });
    expect(offered).toHaveLength(2);
    if (!offered) throw new Error("expected offered pair");
    expect(offered[0]).not.toBe(offered[1]);
  });

  it("hard-bans last format when two alternatives remain", () => {
    const { offered } = buildFormatMenu({
      formatManifest: ["save_or_eliminate", "vote_bomb", "safety_bounce", "majority_elimination"],
      lastFormatId: "vote_bomb",
      random: () => 0,
    });
    expect(offered).not.toContain("vote_bomb");
    expect(offered).toEqual(["safety_bounce", "majority_elimination"]);
  });

  it("uses the full two-format manifest when anti-repeat cannot leave two alternatives", () => {
    const { offered } = buildFormatMenu({
      formatManifest: ["vote_bomb", "majority_elimination"],
      lastFormatId: "vote_bomb",
      random: () => 0,
    });
    expect(offered).toEqual(["majority_elimination", "vote_bomb"]);
  });

  it("auto-selects a one-format manifest without an offered menu", () => {
    expect(buildFormatMenu({
      formatManifest: ["majority_elimination"],
      lastFormatId: null,
      random: () => 0,
    })).toEqual({ offered: null, autoSelected: "majority_elimination" });
  });

  it("rejects empty, duplicate, and unregistered manifests", () => {
    expect(() => resolveFormatManifest([])).toThrow("at least one");
    expect(() => resolveFormatManifest(["vote_bomb", "vote_bomb"])).toThrow("duplicate");
    expect(() => resolveFormatManifest(["vote_bomb", "unknown_format"])).toThrow("registered");
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
      offeredFormatNames: ["Vote Bomb", "Safety Bounce"],
      selectedFormat: "safety_bounce",
      selectedFormatName: "Safety Bounce",
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

  it("limits an empowered tiebreak to the tied fewest-positive set", () => {
    const alive = ids("A", "B", "C", "D", "E");
    const ballots: VoteBombBallot[] = [
      { voterId: "b", targetId: "a" },
      { voterId: "c", targetId: "a" },
      { voterId: "d", targetId: "a" },
      { voterId: "e", targetId: "b" },
      { voterId: "a", targetId: "c" },
    ];

    const tied = resolveVoteBomb(alive, ballots);
    expect(tied).toEqual({
      kind: "tie",
      eliminatedId: null,
      tiedSet: ["b", "c"],
    });
    expect(applyFormatTiebreak(tied.tiedSet, "c")).toEqual({
      kind: "clear",
      eliminatedId: "c",
      tiedSet: ["b", "c"],
    });
    expect(applyFormatTiebreak(tied.tiedSet, "d")).toBeNull();
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

describe("majority elimination", () => {
  it("Covers AE2: tallies A:3 B:2 C:2 D:1 -> A auto-eliminated", () => {
    const alive = ids("A", "B", "C", "D", "E", "F", "G", "H");
    const ballots: SealedElimBallot[] = [
      { voterId: "b", targetId: "a" },
      { voterId: "c", targetId: "a" },
      { voterId: "d", targetId: "a" },
      { voterId: "e", targetId: "b" },
      { voterId: "f", targetId: "b" },
      { voterId: "g", targetId: "c" },
      { voterId: "h", targetId: "c" },
      { voterId: "a", targetId: "d" },
    ];

    expect(computeMajorityEliminationTallies(alive, ballots)).toEqual({
      totals: { a: 3, b: 2, c: 2, d: 1, e: 0, f: 0, g: 0, h: 0 },
      eligibleIds: alive,
    });
    expect(resolveMajorityElimination(alive, ballots)).toEqual({
      kind: "auto",
      eliminatedId: "a",
      tiedSet: ["a"],
      reason: "sole_highest",
    });
  });

  it("Covers AE3: tallies A:3 B:3 C:1 -> tiebreak set A and B only", () => {
    const alive = ids("A", "B", "C", "D", "E", "F", "G");
    const ballots: SealedElimBallot[] = [
      { voterId: "c", targetId: "a" },
      { voterId: "d", targetId: "a" },
      { voterId: "e", targetId: "a" },
      { voterId: "f", targetId: "b" },
      { voterId: "g", targetId: "b" },
      { voterId: "a", targetId: "b" },
      { voterId: "b", targetId: "c" },
    ];

    expect(resolveMajorityElimination(alive, ballots)).toEqual({
      kind: "tie",
      eliminatedId: null,
      tiedSet: ["a", "b"],
    });
  });

  it("rejects self-targets, dead voters, and dead targets", () => {
    const alive = ids("A", "B", "C");
    expect(isLegalMajorityEliminationBallot("a", "a", alive)).toBe(false);
    expect(isLegalMajorityEliminationBallot("z", "b", alive)).toBe(false);
    expect(isLegalMajorityEliminationBallot("a", "z", alive)).toBe(false);
    expect(isLegalMajorityEliminationBallot("a", "b", alive)).toBe(true);
  });
});

describe("even votes", () => {
  it("eliminates the sole highest even total while odd totals stay safe", () => {
    const alive = ids("A", "B", "C", "D", "E", "F");
    const ballots: SealedElimBallot[] = [
      { voterId: "b", targetId: "a" },
      { voterId: "c", targetId: "a" },
      { voterId: "d", targetId: "a" },
      { voterId: "e", targetId: "a" },
      { voterId: "f", targetId: "b" },
      { voterId: "a", targetId: "c" },
    ];

    expect(computeEvenVotesTallies(alive, ballots)).toEqual({
      totals: { a: 4, b: 1, c: 1, d: 0, e: 0, f: 0 },
      eligibleIds: ["a", "d", "e", "f"],
    });
    expect(resolveEvenVotes(alive, ballots)).toEqual({
      kind: "auto",
      eliminatedId: "a",
      tiedSet: ["a"],
      reason: "sole_highest_even",
    });
  });

  it("includes zero as even and restricts a tie to the highest even set", () => {
    const alive = ids("A", "B", "C", "D", "E", "F");
    const ballots: SealedElimBallot[] = [
      { voterId: "c", targetId: "a" },
      { voterId: "d", targetId: "a" },
      { voterId: "e", targetId: "b" },
      { voterId: "f", targetId: "b" },
      { voterId: "a", targetId: "c" },
      { voterId: "b", targetId: "d" },
    ];

    expect(computeEvenVotesTallies(alive, ballots)).toEqual({
      totals: { a: 2, b: 2, c: 1, d: 1, e: 0, f: 0 },
      eligibleIds: ["a", "b", "e", "f"],
    });
    expect(resolveEvenVotes(alive, ballots)).toEqual({
      kind: "tie",
      eliminatedId: null,
      tiedSet: ["a", "b"],
    });
  });

  it("sends an all-odd tally to an empowered tiebreak across the living field", () => {
    const alive = ids("A", "B", "C", "D");
    const ballots: SealedElimBallot[] = [
      { voterId: "a", targetId: "b" },
      { voterId: "b", targetId: "c" },
      { voterId: "c", targetId: "d" },
      { voterId: "d", targetId: "a" },
    ];

    expect(computeEvenVotesTallies(alive, ballots)).toEqual({
      totals: { a: 1, b: 1, c: 1, d: 1 },
      eligibleIds: alive,
    });
    expect(resolveEvenVotes(alive, ballots)).toEqual({
      kind: "tie",
      eliminatedId: null,
      tiedSet: alive,
    });
  });

  it("rejects self-targets, dead voters, and dead targets", () => {
    const alive = ids("A", "B", "C");
    expect(isLegalEvenVotesBallot("a", "a", alive)).toBe(false);
    expect(isLegalEvenVotesBallot("z", "b", alive)).toBe(false);
    expect(isLegalEvenVotesBallot("a", "z", alive)).toBe(false);
    expect(isLegalEvenVotesBallot("a", "b", alive)).toBe(true);
  });
});

describe("format catalog", () => {
  it("exhaustively registers the five launch formats by capability", () => {
    expect(Object.keys(FORMAT_CATALOG)).toEqual([...LAUNCH_FORMAT_IDS]);
    expect(FORMAT_CATALOG.save_or_eliminate.capability).toBe(
      "sealed_polarity",
    );
    expect(FORMAT_CATALOG.vote_bomb.capability).toBe("sealed_elim");
    expect(FORMAT_CATALOG.safety_bounce.capability).toBe("public_chain");
    expect(FORMAT_CATALOG.majority_elimination.capability).toBe(
      "sealed_elim",
    );
    expect(FORMAT_CATALOG.even_votes.capability).toBe("sealed_elim");
  });

  it("owns sealed-elim legality, resolution, decision, and aggregate interpretation", () => {
    const registration = FORMAT_CATALOG.majority_elimination;
    const alive = ids("A", "B", "C");
    const ballots: SealedElimBallot[] = [
      { voterId: "b", targetId: "a" },
      { voterId: "c", targetId: "a" },
      { voterId: "a", targetId: "b" },
    ];

    expect(registration.isLegalBallot("a", "b", alive)).toBe(true);
    expect(registration.resolve(alive, ballots).eliminatedId).toBe("a");
    expect(registration.decision).toMatchObject({
      handler: "sealed_elim",
      formatId: "majority_elimination",
      targetPolicy: "alive_non_self",
      publicName: "Majority Elimination",
      toolName: "majority_elimination_ballot",
      traceAction: "format-majority-elimination-ballot",
      invalidTargetReason: "invalid_majority_elimination_target",
    });
    expect(registration.decision.strategyGuidance).toContain("most votes");
    expect(
      registration.aggregate.toAggregate(registration.score(alive, ballots)),
    ).toEqual({
      totals: { a: 2, b: 1, c: 0 },
      eligiblePlayerIds: alive,
    });
    expect(registration.presentation).toEqual({
      scoring: "highest_total",
      zeroVoteTreatment: "eligible",
    });
    expect(
      registration.aggregate.fromAggregate(
        registration.aggregate.toAggregate(registration.score(alive, ballots)),
      ),
    ).toEqual(registration.score(alive, ballots));

    expect(FORMAT_CATALOG.vote_bomb.decision.formatId).toBe("vote_bomb");
    expect(FORMAT_CATALOG.vote_bomb.presentation).toEqual({
      scoring: "fewest_positive",
      zeroVoteTreatment: "safe",
    });
    expect(FORMAT_CATALOG.even_votes.decision).toMatchObject({
      handler: "sealed_elim",
      formatId: "even_votes",
      targetPolicy: "alive_non_self",
      publicName: "Even Votes",
      toolName: "even_votes_ballot",
      traceAction: "format-even-votes-ballot",
      invalidTargetReason: "invalid_even_votes_target",
    });
    expect(FORMAT_CATALOG.even_votes.presentation).toEqual({
      scoring: "highest_even",
      zeroVoteTreatment: "eligible",
    });
  });

  it("fails closed for unknown ids and wrong capability dispatch", () => {
    expect(() => getFormatRegistration("unknown_format")).toThrow(
      "Unknown format id",
    );
    expect(() => requireSealedElimRegistration("safety_bounce")).toThrow(
      "not sealed_elim",
    );
  });

  it("fails closed on incomplete sealed-elim ballot sets", () => {
    expect(() => scoreSealedElimBallots(
      FORMAT_CATALOG.vote_bomb,
      ids("A", "B", "C"),
      [
        { voterId: "a", targetId: "b" },
        { voterId: "b", targetId: "c" },
      ],
    )).toThrow("vote_bomb incomplete sealed ballots: 2/3");
  });
});
