import { describe, expect, it } from "bun:test";
import { Phase } from "@influence/engine";
import type { GameWatchReplayFrame, ViewerDecisionEvent } from "../lib/api";
import {
  compileFormatPresentationPrefix,
  formatPresentationDecisionsFromFrames,
  formatPresentationEligibilityFromFrames,
} from "../app/games/[slug]/components/format-presentation-model";

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
      resolutionKind: "clear",
      tiedPlayerIds: [],
      tiebreakerId: null,
      saveOrEliminate: {
        nets: { atlas: 1, lyra: 1, echo: -1 },
        savesReceived: { atlas: 1, lyra: 1, echo: 0 },
        eliminateReceived: { atlas: 0, lyra: 0, echo: 1 },
      },
      voteBomb: null,
      safetyBounce: null,
    },
  }),
];

describe("format presentation compiler", () => {
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
    if (resolution?.type !== "format.resolved" || !resolution.payload.saveOrEliminate) {
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
            saveOrEliminate: {
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
});

function frameFor(decision: ViewerDecisionEvent): GameWatchReplayFrame {
  return {
    schemaVersion: 3,
    gameId: "game-1",
    slug: "game-1",
    sequence: decision.sequence,
    eventType: decision.type,
    timestamp: Date.parse(decision.timestamp),
    round: decision.round,
    phase: decision.phase ?? "INIT",
    players: roster.map((player) => ({
      ...player,
      persona: "",
      status: "alive",
      shielded: false,
      currentAgent: null,
    })),
    counts: {
      totalPlayers: roster.length,
      alivePlayers: roster.length,
      eliminatedPlayers: 0,
      unknownPlayers: 0,
    },
    viewerDecisionEvent: decision,
  };
}
