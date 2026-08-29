import { describe, expect, it } from "bun:test";
import { Phase } from "@influence/engine";
import {
  createEvenVotesClearViewerDecisions,
  createEvenVotesTieViewerDecisions,
  createMajorityEliminationClearViewerDecisions,
  createMajorityEliminationTieViewerDecisions,
  createSafetyBounceViewerDecisions,
  FORMAT_KERNEL_VIEWER_GAME_ID,
  FORMAT_KERNEL_VIEWER_ROSTER,
} from "@influence/engine/fixtures/format-kernel-viewer";
import type { ViewerDecisionEvent } from "../lib/api";
import {
  compileFormatPresentationPrefix,
  formatPresentationDecisionsFromFrames,
  formatPresentationEligibilityFromFrames,
} from "../app/games/[slug]/components/format-presentation-model";
import {
  allEqualSaveOrEliminateDecisions,
  frameFor,
  voteBombDecisions,
} from "./format-presentation-model.fixtures";

const roster = [
  { id: "atlas", name: "Atlas" },
  { id: "lyra", name: "Lyra" },
  { id: "echo", name: "Echo" },
];

function event<T extends ViewerDecisionEvent>(
  value: Omit<T, "timestamp" | "round"> & Partial<Pick<T, "timestamp" | "round">>,
): T {
  return {
    timestamp: "2026-07-26T00:00:00.000Z",
    round: 1,
    ...value,
  } as T;
}

const decisions: ViewerDecisionEvent[] = [
  event({
    sequence: 7,
    phase: Phase.VOTE,
    type: "vote.cast",
    payload: {
      voterId: "atlas",
      empowerTarget: "lyra",
    },
  }),
  event({
    sequence: 8,
    phase: Phase.VOTE,
    type: "vote.cast",
    payload: {
      voterId: "lyra",
      empowerTarget: "atlas",
    },
  }),
  event({
    sequence: 9,
    phase: Phase.VOTE,
    type: "vote.cast",
    payload: {
      voterId: "echo",
      empowerTarget: "atlas",
    },
  }),
  event({
    sequence: 10,
    phase: Phase.VOTE,
    type: "vote.empower_tally_resolved",
    payload: {
      counts: { atlas: 2, lyra: 1, echo: 0 },
      empowered: "atlas",
      tied: null,
      method: "plurality",
      cumulativeEmpowerVotes: { atlas: 2, lyra: 1 },
    },
  }),
  event({
    sequence: 12,
    phase: Phase.FORMAT_MENU,
    type: "format.menu_offered",
    payload: {
      empoweredId: "atlas",
      offeredFormatIds: ["save_or_eliminate", "vote_bomb"],
    },
  }),
  event({
    sequence: 14,
    phase: Phase.FORMAT_PICK,
    type: "format.selected",
    payload: {
      empoweredId: "atlas",
      formatId: "save_or_eliminate",
    },
  }),
  event({
    sequence: 18,
    phase: Phase.FORMAT_RESOLVE,
    type: "format.ballot_cast",
    payload: {
      formatId: "save_or_eliminate",
      voterId: "lyra",
      targetId: "echo",
      polarity: "eliminate",
    },
  }),
  event({
    sequence: 19,
    phase: Phase.FORMAT_RESOLVE,
    type: "format.ballot_cast",
    payload: {
      formatId: "save_or_eliminate",
      voterId: "echo",
      targetId: "atlas",
      polarity: "save",
    },
  }),
  event({
    sequence: 17,
    phase: Phase.FORMAT_RESOLVE,
    type: "format.ballot_cast",
    payload: {
      formatId: "save_or_eliminate",
      voterId: "atlas",
      targetId: "lyra",
      polarity: "save",
    },
  }),
  event({
    sequence: 20,
    phase: Phase.FORMAT_RESOLVE,
    type: "format.resolved",
    payload: {
      formatId: "save_or_eliminate",
      empoweredId: "atlas",
      eliminatedId: "echo",
      resolutionKind: "auto",
      tiedPlayerIds: ["echo"],
      tiebreakerId: null,
      aggregate: {
        capability: "sealed_polarity",
        nets: { atlas: 1, lyra: 1, echo: -1 },
        savesReceived: { atlas: 1, lyra: 1, echo: 0 },
        eliminateReceived: { atlas: 0, lyra: 0, echo: 1 },
      },
    },
  }),
];

describe("format presentation compiler", () => {
  it("compiles Two Names role reveals, substitution, pleas, sealed progress, and tie in canonical order", () => {
    const twoNamesRoster = ["atlas", "blair", "cyra", "dax", "echo"].map((id) => ({ id, name: id }));
    const twoNames = [
      event({ sequence: 1, phase: Phase.FORMAT_PICK, type: "format.selected", payload: { empoweredId: "atlas", formatId: "two_names" } }),
      event({ sequence: 2, phase: Phase.FORMAT_PICK, type: "format.two_names_setup", payload: { empoweredId: "atlas", initialNomineeIds: ["blair", "cyra"], overrideHolderId: "atlas" } }),
      event({ sequence: 3, phase: Phase.FORMAT_MINGLE, type: "format.two_names_mingle_completed", payload: { window: "initial_names", finalistPlayerIds: ["blair", "cyra"] } }),
      event({ sequence: 4, phase: Phase.FORMAT_MINGLE, type: "format.two_names_override_used", payload: { overrideHolderId: "atlas", removedNomineeId: "blair" } }),
      event({ sequence: 5, phase: Phase.FORMAT_MINGLE, type: "format.two_names_replacement_named", payload: { empoweredId: "atlas", replacementNomineeId: "dax", finalistPlayerIds: ["dax", "cyra"] } }),
      event({ sequence: 6, phase: Phase.FORMAT_MINGLE, type: "format.two_names_mingle_completed", payload: { window: "final_names", finalistPlayerIds: ["dax", "cyra"] } }),
      event({ sequence: 7, phase: Phase.FORMAT_RESOLVE, type: "format.two_names_plea_recorded", payload: { speakerId: "dax", ordinal: 0, status: "accepted", text: "Keep me.", absenceReason: null } }),
      event({ sequence: 8, phase: Phase.FORMAT_RESOLVE, type: "format.two_names_plea_recorded", payload: { speakerId: "cyra", ordinal: 1, status: "absent", text: null, absenceReason: "provider_unavailable" } }),
      event({ sequence: 9, phase: Phase.FORMAT_RESOLVE, type: "format.ballot_cast", payload: { formatId: "two_names", voterId: "blair", targetId: "dax", polarity: null } }),
      event({ sequence: 10, phase: Phase.FORMAT_RESOLVE, type: "format.ballot_cast", payload: { formatId: "two_names", voterId: "echo", targetId: "cyra", polarity: null } }),
      event({
        sequence: 11,
        phase: Phase.FORMAT_RESOLVE,
        type: "format.resolved",
        payload: {
          formatId: "two_names",
          empoweredId: "atlas",
          eliminatedId: "dax",
          resolutionKind: "auto",
          tiedPlayerIds: ["dax", "cyra"],
          tiebreakerId: "atlas",
          aggregate: {
            capability: "two_names",
            initialNomineeIds: ["blair", "cyra"],
            overrideHolderId: "atlas",
            overrideAction: "used",
            removedNomineeId: "blair",
            replacementNomineeId: "dax",
            finalistPlayerIds: ["dax", "cyra"],
            eligibleVoterIds: ["blair", "echo"],
            totals: { dax: 1, cyra: 1 },
          },
        },
      }),
    ] satisfies ViewerDecisionEvent[];
    const compiled = compileFormatPresentationPrefix({
      gameId: "two-names",
      gameKernel: "format",
      roster: twoNamesRoster,
      decisions: twoNames,
      formatManifest: ["two_names"],
    });

    expect(compiled.diagnostic).toBeNull();
    expect(compiled.status).toBe("ready");
    expect(compiled.cues.map((cue) => cue.kind)).toEqual([
      "format_selected",
      "format_selected",
      "two_names_empowered_intro",
      "two_names_initial_names",
      "two_names_override_draw",
      "two_names_mingle_complete",
      "two_names_override_removed",
      "two_names_replacement",
      "two_names_mingle_complete",
      "two_names_plea",
      "two_names_plea",
      "two_names_ballots_sealing",
      "two_names_ballots_sealing",
      "format_aggregate",
      "format_roll_call",
      "format_roll_call",
      "format_tiebreak",
      "format_elimination",
    ]);
    expect(compiled.snapshot.twoNames).toMatchObject({
      empoweredId: "atlas",
      overrideHolderId: "atlas",
      removedNomineeId: "blair",
      replacementNomineeId: "dax",
      finalistPlayerIds: ["dax", "cyra"],
      completedMingleWindows: ["initial_names", "final_names"],
      pleaCount: 2,
      ballotsSealed: 2,
    });
  });

  it("produces equal cue streams for live decisions and replay frames at every prefix", () => {
    const ordered = [...decisions].sort((left, right) => left.sequence - right.sequence);
    const frames = ordered.map(frameFor);

    for (let prefixLength = 0; prefixLength <= ordered.length; prefixLength += 1) {
      const live = compileFormatPresentationPrefix({
        gameId: "game-1",
        gameKernel: "format",
        roster,
        decisions: ordered.slice(0, prefixLength),
      });
      const replay = compileFormatPresentationPrefix({
        gameId: "game-1",
        gameKernel: "format",
        roster,
        decisions: formatPresentationDecisionsFromFrames(frames.slice(0, prefixLength)),
      });

      expect(replay).toEqual(live);
    }
  });

  it("deduplicates stable sequence keys and stages aggregate before roster-ordered roll call", () => {
    const ordered = [...decisions].sort((left, right) => left.sequence - right.sequence);
    const result = compileFormatPresentationPrefix({
      gameId: "game-1",
      gameKernel: "format",
      roster,
      decisions: [ordered[0]!, ordered[0]!, ...ordered.slice(1)],
    });

    expect(result.status).toBe("ready");
    expect(new Set(result.cues.map((cue) => cue.key)).size).toBe(result.cues.length);
    expect(result.cues.map((cue) => cue.kind)).toEqual([
      "empowered_tally",
      "format_menu",
      "format_selected",
      "format_selected",
      "format_aggregate",
      "format_roll_call",
      "format_roll_call",
      "format_roll_call",
      "format_elimination",
    ]);
    expect(
      result.cues
        .filter((cue) => cue.kind === "format_selected")
        .map((cue) => cue.stage),
    ).toEqual(["choice_legible", "rules_reveal"]);
    expect(
      result.cues
        .filter((cue) => cue.kind === "format_roll_call")
        .map((cue) => cue.ballot.voterId),
    ).toEqual(["atlas", "lyra", "echo"]);
    expect(
      result.cues
        .filter((cue) => cue.kind === "format_roll_call")
        .map((cue) => cue.pacing),
    ).toEqual(["brisk", "decisive", "final"]);
    expect(result.snapshot.canonicalSequence).toBe(20);
    expect(result.snapshot.eliminatedId).toBe("echo");
  });

  it("carries before and after Classification Stage snapshots without invented targets", () => {
    const bounceDecisions: ViewerDecisionEvent[] = [
      event({
        sequence: 30,
        phase: Phase.FORMAT_MENU,
        type: "format.menu_offered",
        payload: {
          empoweredId: "atlas",
          offeredFormatIds: ["safety_bounce", "vote_bomb"],
        },
      }),
      event({
        sequence: 31,
        phase: Phase.FORMAT_PICK,
        type: "format.selected",
        payload: { empoweredId: "atlas", formatId: "safety_bounce" },
      }),
      event({
        sequence: 32,
        phase: Phase.FORMAT_RESOLVE,
        type: "format.safety_bounce_started",
        payload: { starterId: "atlas" },
      }),
      event({
        sequence: 33,
        phase: Phase.FORMAT_RESOLVE,
        type: "format.safety_bounce_pointer",
        payload: {
          actorId: "atlas",
          targetId: "lyra",
          classification: "vulnerable",
        },
      }),
    ];

    const result = compileFormatPresentationPrefix({
      gameId: "game-1",
      gameKernel: "format",
      roster,
      decisions: bounceDecisions,
    });
    const pointer = result.cues.find((cue) => cue.kind === "safety_bounce_pointer");

    expect(pointer?.before.safetyBounce).toMatchObject({
      currentActorId: "atlas",
      safePlayerIds: ["atlas"],
      vulnerablePlayerIds: [],
      benchPlayerIds: ["lyra", "echo"],
    });
    expect(pointer?.after.safetyBounce).toMatchObject({
      currentActorId: "lyra",
      safePlayerIds: ["atlas"],
      vulnerablePlayerIds: ["lyra"],
      benchPlayerIds: ["echo"],
    });
  });

  it("fails closed on a contradictory selection and retains the last trustworthy snapshot", () => {
    const result = compileFormatPresentationPrefix({
      gameId: "game-1",
      gameKernel: "format",
      roster,
      decisions: [
        decisions[4]!,
        event({
          sequence: 13,
          phase: Phase.FORMAT_PICK,
          type: "format.selected",
          payload: {
            empoweredId: "atlas",
            formatId: "safety_bounce",
          },
        }),
        decisions.at(-1)!,
      ],
    });

    expect(result.status).toBe("incomplete");
    expect(result.diagnostic).toMatchObject({
      sequence: 13,
      code: "selection_not_offered",
    });
    expect(result.snapshot.offeredFormatIds).toEqual([
      "save_or_eliminate",
      "vote_bomb",
    ]);
    expect(result.snapshot.activeFormatId).toBeNull();
    expect(result.snapshot.canonicalSequence).toBe(12);
  });

  it("rejects a menu that contradicts the trusted Empowered tally", () => {
    const result = compileFormatPresentationPrefix({
      gameId: "game-1",
      gameKernel: "format",
      roster,
      decisions: [
        ...decisions.slice(0, 4),
        event({
          sequence: 12,
          phase: Phase.FORMAT_MENU,
          type: "format.menu_offered",
          payload: {
            empoweredId: "lyra",
            offeredFormatIds: ["save_or_eliminate", "vote_bomb"],
          },
        }),
      ],
    });

    expect(result.status).toBe("incomplete");
    expect(result.diagnostic?.code).toBe("empowered_mismatch");
    expect(result.snapshot.empoweredId).toBe("atlas");
  });

  it("waits for the canonical revote winner instead of trusting the tie placeholder", () => {
    const tieRoster = [...roster, { id: "rex", name: "Rex" }];
    const tiedDecisions: ViewerDecisionEvent[] = [
      event({
        sequence: 1,
        phase: Phase.VOTE,
        type: "vote.cast",
        payload: { voterId: "atlas", empowerTarget: "lyra" },
      }),
      event({
        sequence: 2,
        phase: Phase.VOTE,
        type: "vote.cast",
        payload: { voterId: "lyra", empowerTarget: "atlas" },
      }),
      event({
        sequence: 3,
        phase: Phase.VOTE,
        type: "vote.cast",
        payload: { voterId: "echo", empowerTarget: "atlas" },
      }),
      event({
        sequence: 4,
        phase: Phase.VOTE,
        type: "vote.cast",
        payload: { voterId: "rex", empowerTarget: "lyra" },
      }),
      event({
        sequence: 5,
        phase: Phase.VOTE,
        type: "vote.empower_tally_resolved",
        payload: {
          counts: { atlas: 2, lyra: 2, echo: 0, rex: 0 },
          empowered: "atlas",
          tied: ["atlas", "lyra"],
          method: "tie_pending",
          cumulativeEmpowerVotes: { atlas: 2, lyra: 2, echo: 0, rex: 0 },
        },
      }),
      event({
        sequence: 6,
        phase: Phase.VOTE,
        type: "vote.empower_vote_cleared",
        payload: { voterId: "echo" },
      }),
      event({
        sequence: 7,
        phase: Phase.VOTE,
        type: "vote.empower_vote_cleared",
        payload: { voterId: "rex" },
      }),
      event({
        sequence: 8,
        phase: Phase.VOTE,
        type: "vote.empower_revote_cast",
        payload: { voterId: "echo", target: "lyra" },
      }),
      event({
        sequence: 9,
        phase: Phase.VOTE,
        type: "vote.empower_revote_cast",
        payload: { voterId: "rex", target: "lyra" },
      }),
      event({
        sequence: 10,
        phase: Phase.VOTE,
        type: "vote.empowered_set",
        payload: { empowered: "lyra", method: "revote" },
      }),
      event({
        sequence: 11,
        phase: Phase.FORMAT_MENU,
        type: "format.menu_offered",
        payload: {
          empoweredId: "lyra",
          offeredFormatIds: ["save_or_eliminate", "vote_bomb"],
        },
      }),
    ];

    const pending = compileFormatPresentationPrefix({
      gameId: "game-1",
      gameKernel: "format",
      roster: tieRoster,
      decisions: tiedDecisions.slice(0, 5),
    });
    const resolved = compileFormatPresentationPrefix({
      gameId: "game-1",
      gameKernel: "format",
      roster: tieRoster,
      decisions: tiedDecisions,
    });

    expect(pending.status).toBe("ready");
    expect(pending.cues).toHaveLength(0);
    expect(pending.snapshot.empoweredId).toBeNull();
    expect(resolved.status).toBe("ready");
    expect(resolved.cues[0]).toMatchObject({
      kind: "empowered_tally",
      canonicalSequence: 10,
      empoweredId: "lyra",
      receipts: [
        { voterId: "atlas", targetId: "lyra", revoteTargetId: null },
        { voterId: "lyra", targetId: "atlas", revoteTargetId: null },
        { voterId: "echo", targetId: "atlas", revoteTargetId: "lyra" },
        { voterId: "rex", targetId: "lyra", revoteTargetId: "lyra" },
      ],
    });
    expect(resolved.cues[1]).toMatchObject({
      kind: "format_menu",
      empoweredId: "lyra",
    });

    const missingWinner = compileFormatPresentationPrefix({
      gameId: "game-1",
      gameKernel: "format",
      roster: tieRoster,
      decisions: [
        ...tiedDecisions.slice(0, 5),
        tiedDecisions.at(-1)!,
      ],
    });
    expect(missingWinner.status).toBe("incomplete");
    expect(missingWinner.diagnostic?.code).toBe("empowered_mismatch");
  });

  it("rejects aggregates with incomplete roster key sets", () => {
    const resolution = decisions.at(-1);
    if (
      resolution?.type !== "format.resolved"
      || resolution.payload.aggregate.capability !== "sealed_polarity"
    ) {
      throw new Error("Expected Save-or-Eliminate resolution fixture");
    }
    const result = compileFormatPresentationPrefix({
      gameId: "game-1",
      gameKernel: "format",
      roster,
      decisions: [
        ...decisions.slice(0, -1),
        {
          ...resolution,
          payload: {
            ...resolution.payload,
            aggregate: {
              capability: "sealed_polarity" as const,
              nets: { atlas: 1, lyra: 1 },
              savesReceived: { atlas: 1, lyra: 1 },
              eliminateReceived: { atlas: 0, lyra: 0 },
            },
          },
        },
      ],
    });

    expect(result.status).toBe("incomplete");
    expect(result.diagnostic?.code).toBe("aggregate_mismatch");
  });

  it("resets format state before compiling a later round", () => {
    const nextRoundMenu = event({
      sequence: 40,
      round: 2,
      phase: Phase.FORMAT_MENU,
      type: "format.menu_offered",
      payload: {
        empoweredId: "lyra",
        offeredFormatIds: ["vote_bomb", "safety_bounce"],
      },
    });
    const result = compileFormatPresentationPrefix({
      gameId: "game-1",
      gameKernel: "format",
      roster,
      decisions: [...decisions, nextRoundMenu],
    });

    expect(result.snapshot).toMatchObject({
      round: 2,
      empoweredId: "lyra",
      activeFormatId: null,
      eliminatedId: null,
      safetyBounce: null,
    });
    expect(result.cues.at(-1)).toMatchObject({
      kind: "format_menu",
      round: 2,
    });
  });

  it("uses trusted round snapshots instead of terminal roster status for later-round ballots", () => {
    const terminalRoster = [
      ...roster,
      { id: "rex", name: "Rex" },
    ];
    const roundTwoDecisions = decisions.map((decision) => ({
      ...decision,
      sequence: decision.sequence + 100,
      round: 2,
    }));
    const roundTwoFrames = roundTwoDecisions.map((decision) => ({
      ...frameFor(decision),
      players: terminalRoster.map((player) => ({
        ...player,
        persona: "",
        status: player.id === "rex" ? "eliminated" as const : "alive" as const,
        shielded: false,
        currentAgent: null,
      })),
      counts: {
        totalPlayers: terminalRoster.length,
        alivePlayers: roster.length,
        eliminatedPlayers: 1,
        unknownPlayers: 0,
      },
    }));

    const result = compileFormatPresentationPrefix({
      gameId: "game-1",
      gameKernel: "format",
      roster: terminalRoster,
      decisions: formatPresentationDecisionsFromFrames(roundTwoFrames),
      eligiblePlayerIdsByRound: formatPresentationEligibilityFromFrames(roundTwoFrames),
    });

    expect(result.status).toBe("ready");
    expect(
      result.cues
        .filter((cue) => cue.kind === "format_roll_call")
        .map((cue) => cue.ballot.voterId),
    ).toEqual(["atlas", "lyra", "echo"]);
    expect(result.cues.some(
      (cue) => cue.kind === "format_roll_call" && cue.ballot.voterId === "rex",
    )).toBe(false);
  });

  it("stages the deterministic Safety Bounce fixture aggregate-first through tiebreak and elimination", () => {
    const result = compileFormatPresentationPrefix({
      gameId: FORMAT_KERNEL_VIEWER_GAME_ID,
      gameKernel: "format",
      roster: FORMAT_KERNEL_VIEWER_ROSTER,
      decisions: createSafetyBounceViewerDecisions(),
    });
    const resolutionKinds = result.cues
      .filter((cue) =>
        cue.kind === "format_aggregate"
        || cue.kind === "format_roll_call"
        || cue.kind === "format_tiebreak"
        || cue.kind === "format_elimination"
      )
      .map((cue) => cue.kind);

    expect(result.status).toBe("ready");
    expect(resolutionKinds).toEqual([
      "format_aggregate",
      "format_roll_call",
      "format_roll_call",
      "format_roll_call",
      "format_roll_call",
      "format_tiebreak",
      "format_elimination",
    ]);
    expect(
      result.cues
        .filter((cue) => cue.kind === "format_roll_call")
        .map((cue) => [cue.ballot.voterId, cue.pacing]),
    ).toEqual([
      ["atlas", "brisk"],
      ["lyra", "decisive"],
      ["echo", "decisive"],
      ["rex", "final"],
    ]);
  });

  it("stages Majority Elimination sealed ballots into highest-total clear and tied resolutions", () => {
    const clear = compileFormatPresentationPrefix({
      gameId: FORMAT_KERNEL_VIEWER_GAME_ID,
      gameKernel: "format",
      roster: FORMAT_KERNEL_VIEWER_ROSTER,
      decisions: createMajorityEliminationClearViewerDecisions(),
    });
    const tied = compileFormatPresentationPrefix({
      gameId: FORMAT_KERNEL_VIEWER_GAME_ID,
      gameKernel: "format",
      roster: FORMAT_KERNEL_VIEWER_ROSTER,
      decisions: createMajorityEliminationTieViewerDecisions(),
    });

    expect(clear.status).toBe("ready");
    expect(clear.cues.map((cue) => cue.kind)).toEqual([
      "format_menu",
      "format_selected",
      "format_selected",
      "format_aggregate",
      "format_roll_call",
      "format_roll_call",
      "format_roll_call",
      "format_roll_call",
      "format_elimination",
    ]);
    expect(
      clear.cues.find((cue) => cue.kind === "format_aggregate"),
    ).toMatchObject({
      ballotPresentationStatus: "revealed",
      resolution: {
        formatId: "majority_elimination",
        eliminatedId: "lyra",
        aggregate: {
          capability: "sealed_elim",
          totals: { atlas: 0, lyra: 3, echo: 1, rex: 0 },
          eligiblePlayerIds: ["atlas", "lyra", "echo", "rex"],
        },
      },
    });
    expect(tied.status).toBe("ready");
    expect(tied.cues.at(-2)).toMatchObject({
      kind: "format_tiebreak",
      tiebreakerId: "atlas",
      tiedPlayerIds: ["lyra", "echo"],
    });
    expect(tied.cues.at(-1)).toMatchObject({
      kind: "format_elimination",
      eliminatedId: "echo",
    });
    expect(JSON.stringify({ clear, tied })).not.toMatch(
      /zero.safe|\bVulnerable\b|\bPower\b|\bCouncil\b/i,
    );
  });

  it("stages Even Votes with exact parity eligibility and an empowered highest-even tie", () => {
    const clear = compileFormatPresentationPrefix({
      gameId: FORMAT_KERNEL_VIEWER_GAME_ID,
      gameKernel: "format",
      roster: FORMAT_KERNEL_VIEWER_ROSTER,
      decisions: createEvenVotesClearViewerDecisions(),
    });
    const tied = compileFormatPresentationPrefix({
      gameId: FORMAT_KERNEL_VIEWER_GAME_ID,
      gameKernel: "format",
      roster: FORMAT_KERNEL_VIEWER_ROSTER,
      decisions: createEvenVotesTieViewerDecisions(),
    });

    expect(clear.status).toBe("ready");
    expect(clear.cues.find((cue) => cue.kind === "format_aggregate")).toMatchObject({
      ballotPresentationStatus: "revealed",
      resolution: {
        formatId: "even_votes",
        eliminatedId: "lyra",
        aggregate: {
          capability: "sealed_elim",
          totals: { atlas: 0, lyra: 2, echo: 1, rex: 1 },
          eligiblePlayerIds: ["atlas", "lyra"],
        },
      },
    });
    expect(tied.status).toBe("ready");
    expect(tied.cues.at(-2)).toMatchObject({
      kind: "format_tiebreak",
      tiebreakerId: "atlas",
      tiedPlayerIds: ["lyra", "echo"],
    });
    expect(tied.cues.at(-1)).toMatchObject({
      kind: "format_elimination",
      eliminatedId: "echo",
    });
  });

  it("accepts a one-format manifest selection without inventing an offer", () => {
    const selected = createMajorityEliminationClearViewerDecisions()[1]!;
    const result = compileFormatPresentationPrefix({
      gameId: "one-format-majority",
      gameKernel: "format",
      formatManifest: ["majority_elimination"],
      roster: FORMAT_KERNEL_VIEWER_ROSTER,
      decisions: [selected],
    });

    expect(result.status).toBe("ready");
    expect(result.snapshot.offeredFormatIds).toBeNull();
    expect(result.snapshot.activeFormatId).toBe("majority_elimination");
    expect(result.cues.map((cue) => cue.kind)).toEqual([
      "format_selected",
      "format_selected",
    ]);
  });

  it("renders a canonical Restricted History forfeiture in the sealed roll call", () => {
    const restricted: ViewerDecisionEvent[] = [
      event({
        sequence: 1,
        round: 3,
        phase: Phase.FORMAT_MENU,
        type: "format.menu_offered",
        payload: {
          empoweredId: "atlas",
          offeredFormatIds: ["majority_elimination", "restricted_history"],
        },
      }),
      event({
        sequence: 2,
        round: 3,
        phase: Phase.FORMAT_PICK,
        type: "format.selected",
        payload: { empoweredId: "atlas", formatId: "restricted_history" },
      }),
      event({
        sequence: 3,
        round: 3,
        phase: Phase.FORMAT_RESOLVE,
        type: "format.ballot_forfeited",
        payload: {
          formatId: "restricted_history",
          voterId: "atlas",
          reason: "history_exhausted",
        },
      }),
      event({
        sequence: 4,
        round: 3,
        phase: Phase.FORMAT_RESOLVE,
        type: "format.resolved",
        payload: {
          formatId: "restricted_history",
          empoweredId: "atlas",
          eliminatedId: "atlas",
          resolutionKind: "auto",
          tiedPlayerIds: ["atlas"],
          tiebreakerId: null,
          aggregate: {
            capability: "sealed_elim",
            totals: { atlas: 0 },
            eligiblePlayerIds: ["atlas"],
          },
        },
      }),
    ];
    const result = compileFormatPresentationPrefix({
      gameId: "restricted-history-forfeit",
      gameKernel: "format",
      roster: [{ id: "atlas", name: "Atlas" }],
      decisions: restricted,
      formatManifest: ["majority_elimination", "restricted_history"],
    });

    expect(result.status).toBe("ready");
    expect(result.cues.find((cue) => cue.kind === "format_roll_call")).toMatchObject({
      ballot: {
        voterId: "atlas",
        targetId: null,
        forfeited: true,
      },
    });

    const tooEarly = compileFormatPresentationPrefix({
      gameId: "restricted-history-too-early",
      gameKernel: "format",
      roster: [{ id: "atlas", name: "Atlas" }],
      decisions: restricted.map((decision) => ({ ...decision, round: 2 })),
      formatManifest: ["majority_elimination", "restricted_history"],
    });
    expect(tooEarly).toMatchObject({
      status: "incomplete",
      diagnostic: { code: "invalid_menu", sequence: 1 },
    });
  });

  it("paces early, middle, and closing Safety Bounce decisions without altering facts", () => {
    const sixPlayerRoster = [
      ...FORMAT_KERNEL_VIEWER_ROSTER,
      { id: "nova", name: "Nova" },
      { id: "sage", name: "Sage" },
    ];
    const bounce = [
      event({
        sequence: 1,
        phase: Phase.FORMAT_MENU,
        type: "format.menu_offered",
        payload: {
          empoweredId: "atlas",
          offeredFormatIds: ["safety_bounce", "vote_bomb"],
        },
      }),
      event({
        sequence: 2,
        phase: Phase.FORMAT_PICK,
        type: "format.selected",
        payload: { empoweredId: "atlas", formatId: "safety_bounce" },
      }),
      event({
        sequence: 3,
        phase: Phase.FORMAT_RESOLVE,
        type: "format.safety_bounce_started",
        payload: { starterId: "atlas" },
      }),
      ...[
        ["atlas", "lyra", "vulnerable"],
        ["lyra", "echo", "safe"],
        ["echo", "rex", "vulnerable"],
        ["rex", "nova", "safe"],
        ["nova", "sage", "vulnerable"],
      ].map(([actorId, targetId, classification], index) =>
        event({
          sequence: 4 + index,
          phase: Phase.FORMAT_RESOLVE,
          type: "format.safety_bounce_pointer",
          payload: {
            actorId: actorId!,
            targetId: targetId!,
            classification: classification as "safe" | "vulnerable",
          },
        }),
      ),
    ];
    const result = compileFormatPresentationPrefix({
      gameId: "adaptive-bounce",
      gameKernel: "format",
      roster: sixPlayerRoster,
      decisions: bounce,
    });
    const pointers = result.cues.filter(
      (cue) => cue.kind === "safety_bounce_pointer",
    );

    expect(result.status).toBe("ready");
    expect(pointers.map((cue) => cue.pacing)).toEqual([
      "early",
      "middle",
      "middle",
      "closing",
      "closing",
    ]);
    expect(pointers.map((cue) => cue.baseDurationMs)).toEqual([
      2_600,
      1_600,
      1_600,
      2_900,
      2_900,
    ]);
    expect(pointers.map((cue) => cue.pointerCandidateIds.at(-1))).toEqual([
      "lyra",
      "echo",
      "rex",
      "nova",
      "sage",
    ]);
  });

  it("fails closed on a Safety Bounce classification contradiction", () => {
    const contradictory = createSafetyBounceViewerDecisions().map((decision) =>
      decision.type === "format.safety_bounce_pointer" && decision.sequence === 33
        ? {
            ...decision,
            payload: { ...decision.payload, classification: "safe" as const },
          }
        : decision
    );
    const result = compileFormatPresentationPrefix({
      gameId: FORMAT_KERNEL_VIEWER_GAME_ID,
      gameKernel: "format",
      roster: FORMAT_KERNEL_VIEWER_ROSTER,
      decisions: contradictory,
    });

    expect(result.status).toBe("incomplete");
    expect(result.diagnostic?.code).toBe("safety_bounce_classification_mismatch");
    expect(
      result.cues.filter((cue) => cue.kind === "safety_bounce_pointer"),
    ).toHaveLength(0);
  });

  it("renders sole-vulnerable Safety Bounce as not applicable without roll call", () => {
    const soleVulnerable: ViewerDecisionEvent[] = [
      event({
        sequence: 1,
        phase: Phase.FORMAT_MENU,
        type: "format.menu_offered",
        payload: {
          empoweredId: "atlas",
          offeredFormatIds: ["safety_bounce", "vote_bomb"],
        },
      }),
      event({
        sequence: 2,
        phase: Phase.FORMAT_PICK,
        type: "format.selected",
        payload: { empoweredId: "atlas", formatId: "safety_bounce" },
      }),
      event({
        sequence: 3,
        phase: Phase.FORMAT_RESOLVE,
        type: "format.safety_bounce_started",
        payload: { starterId: "atlas" },
      }),
      event({
        sequence: 4,
        phase: Phase.FORMAT_RESOLVE,
        type: "format.safety_bounce_pointer",
        payload: {
          actorId: "atlas",
          targetId: "lyra",
          classification: "vulnerable",
        },
      }),
      event({
        sequence: 5,
        phase: Phase.FORMAT_RESOLVE,
        type: "format.safety_bounce_pointer",
        payload: {
          actorId: "lyra",
          targetId: "echo",
          classification: "safe",
        },
      }),
      event({
        sequence: 6,
        phase: Phase.FORMAT_RESOLVE,
        type: "format.resolved",
        payload: {
          formatId: "safety_bounce",
          empoweredId: "atlas",
          eliminatedId: "lyra",
          resolutionKind: "auto",
          tiedPlayerIds: [],
          tiebreakerId: null,
          aggregate: {
            capability: "public_chain",
            starterId: "atlas",
            safePlayerIds: ["atlas", "echo"],
            vulnerablePlayerIds: ["lyra"],
            voteTotals: {},
          },
        },
      }),
    ];
    const result = compileFormatPresentationPrefix({
      gameId: "sole-vulnerable",
      gameKernel: "format",
      roster,
      decisions: soleVulnerable,
    });
    const aggregate = result.cues.find((cue) => cue.kind === "format_aggregate");

    expect(result.status).toBe("ready");
    expect(aggregate?.ballotPresentationStatus).toBe("not_applicable");
    expect(
      result.cues.filter((cue) => cue.kind === "format_roll_call"),
    ).toHaveLength(0);
    expect(result.cues.at(-1)).toMatchObject({
      kind: "format_elimination",
      eliminatedId: "lyra",
      resolutionKind: "auto",
    });
  });

  it("accepts an ordinary Safety Bounce clear ballot without inventing a tiebreak", () => {
    const ordinaryClear = createSafetyBounceViewerDecisions().map((decision) => {
      if (
        decision.type === "format.ballot_cast"
        && decision.payload.voterId === "atlas"
      ) {
        return {
          ...decision,
          payload: { ...decision.payload, targetId: "rex" },
        };
      }
      if (decision.type === "format.resolved") {
        return {
          ...decision,
          payload: {
            ...decision.payload,
            eliminatedId: "rex",
            resolutionKind: "clear" as const,
            tiedPlayerIds: ["rex"],
            tiebreakerId: null,
            aggregate: {
              ...decision.payload.aggregate,
              voteTotals: { lyra: 1, rex: 3 },
            },
          },
        };
      }
      return decision;
    });
    const result = compileFormatPresentationPrefix({
      gameId: "ordinary-safety-clear",
      gameKernel: "format",
      roster: FORMAT_KERNEL_VIEWER_ROSTER,
      decisions: ordinaryClear,
    });

    expect(result.status).toBe("ready");
    expect(result.cues.some((cue) => cue.kind === "format_tiebreak")).toBe(false);
    expect(result.cues.at(-1)).toMatchObject({
      kind: "format_elimination",
      eliminatedId: "rex",
      resolutionKind: "clear",
    });
  });

  it("rejects a Safety Bounce final ballot outside the Vulnerable pool", () => {
    const invalid = createSafetyBounceViewerDecisions().map((decision) =>
      decision.type === "format.ballot_cast" && decision.payload.voterId === "atlas"
        ? { ...decision, payload: { ...decision.payload, targetId: "echo" } }
        : decision
    );
    const result = compileFormatPresentationPrefix({
      gameId: FORMAT_KERNEL_VIEWER_GAME_ID,
      gameKernel: "format",
      roster: FORMAT_KERNEL_VIEWER_ROSTER,
      decisions: invalid,
    });

    expect(result.status).toBe("incomplete");
    expect(result.diagnostic).toMatchObject({
      sequence: 36,
      code: "unknown_player",
    });
  });

  it("validates Save-or-Eliminate all-equal tiebreak math", () => {
    const allEqualPrefix = allEqualSaveOrEliminateDecisions();
    const valid = compileFormatPresentationPrefix({
      gameId: "soe-all-equal",
      gameKernel: "format",
      roster: FORMAT_KERNEL_VIEWER_ROSTER,
      decisions: allEqualPrefix,
    });
    const invalidResolution = allEqualPrefix.map((decision) =>
      decision.type === "format.resolved"
        ? {
            ...decision,
            payload: {
              ...decision.payload,
              resolutionKind: "auto" as const,
              tiedPlayerIds: ["rex"],
              tiebreakerId: null,
            },
          }
        : decision
    );
    const invalid = compileFormatPresentationPrefix({
      gameId: "soe-all-equal",
      gameKernel: "format",
      roster: FORMAT_KERNEL_VIEWER_ROSTER,
      decisions: invalidResolution,
    });

    expect(valid.status).toBe("ready");
    expect(valid.cues.some((cue) => cue.kind === "format_tiebreak")).toBe(true);
    expect(invalid.status).toBe("incomplete");
    expect(invalid.diagnostic?.code).toBe("aggregate_mismatch");
  });

  it("validates Vote Bomb zero safety and sole lowest-positive math", () => {
    const voteBomb = voteBombDecisions();
    const valid = compileFormatPresentationPrefix({
      gameId: "vote-bomb-zero-safe",
      gameKernel: "format",
      roster: FORMAT_KERNEL_VIEWER_ROSTER,
      decisions: voteBomb,
    });
    const contradicted = voteBomb.map((decision) =>
      decision.type === "format.resolved"
        ? {
            ...decision,
            payload: {
              ...decision.payload,
              eliminatedId: "echo",
              tiedPlayerIds: ["echo"],
            },
          }
        : decision
    );
    const invalid = compileFormatPresentationPrefix({
      gameId: "vote-bomb-zero-safe",
      gameKernel: "format",
      roster: FORMAT_KERNEL_VIEWER_ROSTER,
      decisions: contradicted,
    });

    expect(valid.status).toBe("ready");
    expect(
      valid.cues.find((cue) => cue.kind === "format_aggregate"),
    ).toMatchObject({
      resolution: {
        eliminatedId: "lyra",
        aggregate: {
          capability: "sealed_elim",
          eligiblePlayerIds: ["lyra", "echo"],
        },
      },
    });
    expect(invalid.status).toBe("incomplete");
    expect(invalid.diagnostic?.code).toBe("aggregate_mismatch");
  });

  it("rejects an outcome that is outside the canonical Safety Bounce tie", () => {
    const contradicted = createSafetyBounceViewerDecisions().map((decision) =>
      decision.type === "format.resolved"
        ? { ...decision, payload: { ...decision.payload, eliminatedId: "atlas" } }
        : decision
    );
    const result = compileFormatPresentationPrefix({
      gameId: FORMAT_KERNEL_VIEWER_GAME_ID,
      gameKernel: "format",
      roster: FORMAT_KERNEL_VIEWER_ROSTER,
      decisions: contradicted,
    });

    expect(result.status).toBe("incomplete");
    expect(result.diagnostic?.code).toBe("aggregate_mismatch");
  });
});
