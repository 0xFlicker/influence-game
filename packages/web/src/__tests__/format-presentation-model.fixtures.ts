import { Phase } from "@influence/engine";
import type { GameWatchReplayFrame, ViewerDecisionEvent } from "../lib/api";

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

export function allEqualSaveOrEliminateDecisions(): ViewerDecisionEvent[] {
  return [
    event({
      sequence: 1,
      phase: Phase.FORMAT_MENU,
      type: "format.menu_offered",
      payload: {
        empoweredId: "atlas",
        offeredFormatIds: ["save_or_eliminate", "vote_bomb"],
      },
    }),
    event({
      sequence: 2,
      phase: Phase.FORMAT_PICK,
      type: "format.selected",
      payload: { empoweredId: "atlas", formatId: "save_or_eliminate" },
    }),
    ...[
      ["atlas", "lyra", "save"],
      ["lyra", "atlas", "save"],
      ["echo", "lyra", "eliminate"],
      ["rex", "atlas", "eliminate"],
    ].map(([voterId, targetId, polarity], index) =>
      event({
        sequence: 3 + index,
        phase: Phase.FORMAT_RESOLVE,
        type: "format.ballot_cast",
        payload: {
          formatId: "save_or_eliminate",
          voterId: voterId!,
          targetId: targetId!,
          polarity: polarity as "save" | "eliminate",
        },
      }),
    ),
    event({
      sequence: 7,
      phase: Phase.FORMAT_RESOLVE,
      type: "format.resolved",
      payload: {
        formatId: "save_or_eliminate",
        empoweredId: "atlas",
        eliminatedId: "rex",
        resolutionKind: "clear",
        tiedPlayerIds: ["atlas", "lyra", "echo", "rex"],
        tiebreakerId: "atlas",
        saveOrEliminate: {
          nets: { atlas: 0, lyra: 0, echo: 0, rex: 0 },
          savesReceived: { atlas: 1, lyra: 1, echo: 0, rex: 0 },
          eliminateReceived: { atlas: 1, lyra: 1, echo: 0, rex: 0 },
        },
        voteBomb: null,
        safetyBounce: null,
      },
    }),
  ];
}

export function voteBombDecisions(): ViewerDecisionEvent[] {
  return [
    event({
      sequence: 1,
      phase: Phase.FORMAT_MENU,
      type: "format.menu_offered",
      payload: {
        empoweredId: "atlas",
        offeredFormatIds: ["vote_bomb", "safety_bounce"],
      },
    }),
    event({
      sequence: 2,
      phase: Phase.FORMAT_PICK,
      type: "format.selected",
      payload: { empoweredId: "atlas", formatId: "vote_bomb" },
    }),
    ...[
      ["atlas", "echo"],
      ["lyra", "echo"],
      ["echo", "lyra"],
      ["rex", "echo"],
    ].map(([voterId, targetId], index) =>
      event({
        sequence: 3 + index,
        phase: Phase.FORMAT_RESOLVE,
        type: "format.ballot_cast",
        payload: {
          formatId: "vote_bomb",
          voterId: voterId!,
          targetId: targetId!,
          polarity: null,
        },
      }),
    ),
    event({
      sequence: 7,
      phase: Phase.FORMAT_RESOLVE,
      type: "format.resolved",
      payload: {
        formatId: "vote_bomb",
        empoweredId: "atlas",
        eliminatedId: "lyra",
        resolutionKind: "auto",
        tiedPlayerIds: ["lyra"],
        tiebreakerId: null,
        saveOrEliminate: null,
        voteBomb: {
          totals: { atlas: 0, lyra: 1, echo: 3, rex: 0 },
          zeroSafePlayerIds: ["atlas", "rex"],
        },
        safetyBounce: null,
      },
    }),
  ];
}

export function frameFor(decision: ViewerDecisionEvent): GameWatchReplayFrame {
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
