import { Phase } from "../types";
import type { LaunchFormatId } from "../format-presentation-metadata";
import type { ViewerDecisionEvent } from "../viewer-decision-events";

export const FORMAT_KERNEL_VIEWER_GAME_ID = "format-kernel-viewer";

export const FORMAT_KERNEL_VIEWER_ROSTER = [
  { id: "atlas", name: "Atlas" },
  { id: "lyra", name: "Lyra" },
  { id: "echo", name: "Echo" },
  { id: "rex", name: "Rex" },
] as const;

export const FORMAT_KERNEL_VIEWER_SCENARIO_IDS = [
  "save_or_eliminate_clear",
  "vote_bomb_clear",
  "majority_elimination_clear",
  "majority_elimination_tie",
  "safety_bounce_tie",
  "safety_bounce_sole_vulnerable",
  "terminal_menu",
  "terminal_selection",
  "terminal_classification",
  "terminal_sealed_ballot",
  "terminal_resolution",
  "malformed_selection",
  "malformed_duplicate_ballot",
  "malformed_safety_actor",
] as const;

export type FormatKernelViewerScenarioId =
  (typeof FORMAT_KERNEL_VIEWER_SCENARIO_IDS)[number];

export interface FormatKernelViewerScenario {
  id: FormatKernelViewerScenarioId;
  roster: Array<{ id: string; name: string }>;
  decisions: ViewerDecisionEvent[];
  expected: {
    status: "ready" | "terminal" | "malformed";
    selectedFormatId: LaunchFormatId | null;
    resolutionKind: "clear" | "auto" | null;
    eliminatedId: string | null;
    tiebreakerId: string | null;
    ballotPresentation:
      | "sealed"
      | "revealed"
      | "not_applicable"
      | "unavailable";
  };
}

/**
 * Shared deterministic viewer scenarios. These are viewer-safe accepted facts,
 * not a second canonical event contract and not an animation script.
 */
export function createFormatKernelViewerScenario(
  id: FormatKernelViewerScenarioId,
): FormatKernelViewerScenario {
  const roster = FORMAT_KERNEL_VIEWER_ROSTER.map((player) => ({ ...player }));
  const saveOrEliminate = createSaveOrEliminateViewerDecisions();
  const voteBomb = createVoteBombViewerDecisions();
  const majorityEliminationClear = createMajorityEliminationClearViewerDecisions();
  const majorityEliminationTie = createMajorityEliminationTieViewerDecisions();
  const safetyBounce = createSafetyBounceViewerDecisions();

  switch (id) {
    case "save_or_eliminate_clear":
      return scenario(id, roster, saveOrEliminate, {
        status: "ready",
        selectedFormatId: "save_or_eliminate",
        resolutionKind: "clear",
        eliminatedId: "lyra",
        tiebreakerId: "atlas",
        ballotPresentation: "revealed",
      });
    case "vote_bomb_clear":
      return scenario(id, roster, voteBomb, {
        status: "ready",
        selectedFormatId: "vote_bomb",
        resolutionKind: "clear",
        eliminatedId: "echo",
        tiebreakerId: "atlas",
        ballotPresentation: "revealed",
      });
    case "majority_elimination_clear":
      return scenario(id, roster, majorityEliminationClear, {
        status: "ready",
        selectedFormatId: "majority_elimination",
        resolutionKind: "auto",
        eliminatedId: "lyra",
        tiebreakerId: null,
        ballotPresentation: "revealed",
      });
    case "majority_elimination_tie":
      return scenario(id, roster, majorityEliminationTie, {
        status: "ready",
        selectedFormatId: "majority_elimination",
        resolutionKind: "clear",
        eliminatedId: "echo",
        tiebreakerId: "atlas",
        ballotPresentation: "revealed",
      });
    case "safety_bounce_tie":
      return scenario(id, roster, safetyBounce, {
        status: "ready",
        selectedFormatId: "safety_bounce",
        resolutionKind: "clear",
        eliminatedId: "rex",
        tiebreakerId: "atlas",
        ballotPresentation: "revealed",
      });
    case "safety_bounce_sole_vulnerable":
      return scenario(
        id,
        roster.slice(0, 3),
        createSoleVulnerableSafetyBounceViewerDecisions(),
        {
          status: "ready",
          selectedFormatId: "safety_bounce",
          resolutionKind: "auto",
          eliminatedId: "lyra",
          tiebreakerId: null,
          ballotPresentation: "not_applicable",
        },
      );
    case "terminal_menu":
      return scenario(id, roster, saveOrEliminate.slice(0, 1), {
        status: "terminal",
        selectedFormatId: null,
        resolutionKind: null,
        eliminatedId: null,
        tiebreakerId: null,
        ballotPresentation: "sealed",
      });
    case "terminal_selection":
      return scenario(id, roster, saveOrEliminate.slice(0, 2), {
        status: "terminal",
        selectedFormatId: "save_or_eliminate",
        resolutionKind: null,
        eliminatedId: null,
        tiebreakerId: null,
        ballotPresentation: "sealed",
      });
    case "terminal_classification":
      return scenario(id, roster, safetyBounce.slice(0, 4), {
        status: "terminal",
        selectedFormatId: "safety_bounce",
        resolutionKind: null,
        eliminatedId: null,
        tiebreakerId: null,
        ballotPresentation: "sealed",
      });
    case "terminal_sealed_ballot":
      return scenario(id, roster, saveOrEliminate.slice(0, 4), {
        status: "terminal",
        selectedFormatId: "save_or_eliminate",
        resolutionKind: null,
        eliminatedId: null,
        tiebreakerId: null,
        ballotPresentation: "sealed",
      });
    case "terminal_resolution":
      return scenario(id, roster, saveOrEliminate, {
        status: "terminal",
        selectedFormatId: "save_or_eliminate",
        resolutionKind: "clear",
        eliminatedId: "lyra",
        tiebreakerId: "atlas",
        ballotPresentation: "revealed",
      });
    case "malformed_selection":
      return scenario(
        id,
        roster,
        [
          saveOrEliminate[0]!,
          viewerDecision(11, Phase.FORMAT_PICK, "format.selected", {
            empoweredId: "atlas",
            formatId: "safety_bounce",
          }),
        ],
        {
          status: "malformed",
          selectedFormatId: null,
          resolutionKind: null,
          eliminatedId: null,
          tiebreakerId: null,
          ballotPresentation: "unavailable",
        },
      );
    case "malformed_duplicate_ballot":
      return scenario(
        id,
        roster,
        [
          ...saveOrEliminate.slice(0, 3),
          viewerDecision(13, Phase.FORMAT_RESOLVE, "format.ballot_cast", {
            formatId: "save_or_eliminate",
            voterId: "atlas",
            targetId: "echo",
            polarity: "save",
          }),
        ],
        {
          status: "malformed",
          selectedFormatId: "save_or_eliminate",
          resolutionKind: null,
          eliminatedId: null,
          tiebreakerId: null,
          ballotPresentation: "unavailable",
        },
      );
    case "malformed_safety_actor":
      return scenario(
        id,
        roster,
        [
          ...safetyBounce.slice(0, 3),
          viewerDecision(33, Phase.FORMAT_RESOLVE, "format.safety_bounce_pointer", {
            actorId: "rex",
            targetId: "lyra",
            classification: "vulnerable",
          }),
        ],
        {
          status: "malformed",
          selectedFormatId: "safety_bounce",
          resolutionKind: null,
          eliminatedId: null,
          tiebreakerId: null,
          ballotPresentation: "unavailable",
        },
      );
  }
}

export function createSaveOrEliminateViewerDecisions(): ViewerDecisionEvent[] {
  return [
    viewerDecision(10, Phase.FORMAT_MENU, "format.menu_offered", {
      empoweredId: "atlas",
      offeredFormatIds: ["save_or_eliminate", "vote_bomb"],
    }),
    viewerDecision(11, Phase.FORMAT_PICK, "format.selected", {
      empoweredId: "atlas",
      formatId: "save_or_eliminate",
    }),
    viewerDecision(12, Phase.FORMAT_RESOLVE, "format.ballot_cast", {
      formatId: "save_or_eliminate",
      voterId: "atlas",
      targetId: "lyra",
      polarity: "eliminate",
    }),
    viewerDecision(13, Phase.FORMAT_RESOLVE, "format.ballot_cast", {
      formatId: "save_or_eliminate",
      voterId: "lyra",
      targetId: "echo",
      polarity: "eliminate",
    }),
    viewerDecision(14, Phase.FORMAT_RESOLVE, "format.ballot_cast", {
      formatId: "save_or_eliminate",
      voterId: "echo",
      targetId: "rex",
      polarity: "save",
    }),
    viewerDecision(15, Phase.FORMAT_RESOLVE, "format.ballot_cast", {
      formatId: "save_or_eliminate",
      voterId: "rex",
      targetId: "atlas",
      polarity: "save",
    }),
    viewerDecision(16, Phase.FORMAT_RESOLVE, "format.resolved", {
      formatId: "save_or_eliminate",
      empoweredId: "atlas",
      eliminatedId: "lyra",
      resolutionKind: "clear",
      tiedPlayerIds: ["lyra", "echo"],
      tiebreakerId: "atlas",
      aggregate: {
        capability: "sealed_polarity",
        nets: { atlas: 1, lyra: -1, echo: -1, rex: 1 },
        savesReceived: { atlas: 1, lyra: 0, echo: 0, rex: 1 },
        eliminateReceived: { atlas: 0, lyra: 1, echo: 1, rex: 0 },
      },
    }),
  ];
}

export function createVoteBombViewerDecisions(): ViewerDecisionEvent[] {
  return [
    viewerDecision(20, Phase.FORMAT_MENU, "format.menu_offered", {
      empoweredId: "atlas",
      offeredFormatIds: ["vote_bomb", "safety_bounce"],
    }),
    viewerDecision(21, Phase.FORMAT_PICK, "format.selected", {
      empoweredId: "atlas",
      formatId: "vote_bomb",
    }),
    viewerDecision(22, Phase.FORMAT_RESOLVE, "format.ballot_cast", {
      formatId: "vote_bomb",
      voterId: "atlas",
      targetId: "lyra",
      polarity: null,
    }),
    viewerDecision(23, Phase.FORMAT_RESOLVE, "format.ballot_cast", {
      formatId: "vote_bomb",
      voterId: "lyra",
      targetId: "echo",
      polarity: null,
    }),
    viewerDecision(24, Phase.FORMAT_RESOLVE, "format.ballot_cast", {
      formatId: "vote_bomb",
      voterId: "echo",
      targetId: "rex",
      polarity: null,
    }),
    viewerDecision(25, Phase.FORMAT_RESOLVE, "format.ballot_cast", {
      formatId: "vote_bomb",
      voterId: "rex",
      targetId: "lyra",
      polarity: null,
    }),
    viewerDecision(26, Phase.FORMAT_RESOLVE, "format.resolved", {
      formatId: "vote_bomb",
      empoweredId: "atlas",
      eliminatedId: "echo",
      resolutionKind: "clear",
      tiedPlayerIds: ["echo", "rex"],
      tiebreakerId: "atlas",
      aggregate: {
        capability: "sealed_elim",
        totals: { atlas: 0, lyra: 2, echo: 1, rex: 1 },
        eligiblePlayerIds: ["lyra", "echo", "rex"],
      },
    }),
  ];
}

export function createMajorityEliminationClearViewerDecisions(): ViewerDecisionEvent[] {
  return createMajorityEliminationViewerDecisions({
    sequenceStart: 60,
    ballots: [
      ["atlas", "lyra"],
      ["lyra", "echo"],
      ["echo", "lyra"],
      ["rex", "lyra"],
    ],
    eliminatedId: "lyra",
    resolutionKind: "auto",
    tiedPlayerIds: ["lyra"],
    tiebreakerId: null,
    totals: { atlas: 0, lyra: 3, echo: 1, rex: 0 },
  });
}

export function createMajorityEliminationTieViewerDecisions(): ViewerDecisionEvent[] {
  return createMajorityEliminationViewerDecisions({
    sequenceStart: 70,
    ballots: [
      ["atlas", "lyra"],
      ["lyra", "echo"],
      ["echo", "lyra"],
      ["rex", "echo"],
    ],
    eliminatedId: "echo",
    resolutionKind: "clear",
    tiedPlayerIds: ["lyra", "echo"],
    tiebreakerId: "atlas",
    totals: { atlas: 0, lyra: 2, echo: 2, rex: 0 },
  });
}

function createMajorityEliminationViewerDecisions(input: {
  sequenceStart: number;
  ballots: ReadonlyArray<readonly [string, string]>;
  eliminatedId: string;
  resolutionKind: "clear" | "auto";
  tiedPlayerIds: string[];
  tiebreakerId: string | null;
  totals: Record<string, number>;
}): ViewerDecisionEvent[] {
  return [
    viewerDecision(input.sequenceStart, Phase.FORMAT_MENU, "format.menu_offered", {
      empoweredId: "atlas",
      offeredFormatIds: ["majority_elimination", "save_or_eliminate"],
    }),
    viewerDecision(input.sequenceStart + 1, Phase.FORMAT_PICK, "format.selected", {
      empoweredId: "atlas",
      formatId: "majority_elimination",
    }),
    ...input.ballots.map(([voterId, targetId], index) =>
      viewerDecision(
        input.sequenceStart + 2 + index,
        Phase.FORMAT_RESOLVE,
        "format.ballot_cast",
        {
          formatId: "majority_elimination",
          voterId,
          targetId,
          polarity: null,
        },
      )
    ),
    viewerDecision(input.sequenceStart + 6, Phase.FORMAT_RESOLVE, "format.resolved", {
      formatId: "majority_elimination",
      empoweredId: "atlas",
      eliminatedId: input.eliminatedId,
      resolutionKind: input.resolutionKind,
      tiedPlayerIds: input.tiedPlayerIds,
      tiebreakerId: input.tiebreakerId,
      aggregate: {
        capability: "sealed_elim",
        totals: input.totals,
        eligiblePlayerIds: ["atlas", "lyra", "echo", "rex"],
      },
    }),
  ];
}

/**
 * Deterministic browser-facing Safety Bounce story. It contains accepted facts
 * only: presentation candidates are deliberately derived by the client and
 * never become fixture, event, or resolution payload data.
 */
export function createSafetyBounceViewerDecisions(): ViewerDecisionEvent[] {
  return [
    viewerDecision(30, Phase.FORMAT_MENU, "format.menu_offered", {
      empoweredId: "atlas",
      offeredFormatIds: ["safety_bounce", "vote_bomb"],
    }),
    viewerDecision(31, Phase.FORMAT_PICK, "format.selected", {
      empoweredId: "atlas",
      formatId: "safety_bounce",
    }),
    viewerDecision(32, Phase.FORMAT_RESOLVE, "format.safety_bounce_started", {
      starterId: "atlas",
    }),
    viewerDecision(33, Phase.FORMAT_RESOLVE, "format.safety_bounce_pointer", {
      actorId: "atlas",
      targetId: "lyra",
      classification: "vulnerable",
    }),
    viewerDecision(34, Phase.FORMAT_RESOLVE, "format.safety_bounce_pointer", {
      actorId: "lyra",
      targetId: "echo",
      classification: "safe",
    }),
    viewerDecision(35, Phase.FORMAT_RESOLVE, "format.safety_bounce_pointer", {
      actorId: "echo",
      targetId: "rex",
      classification: "vulnerable",
    }),
    viewerDecision(36, Phase.FORMAT_RESOLVE, "format.ballot_cast", {
      formatId: "safety_bounce",
      voterId: "atlas",
      targetId: "lyra",
      polarity: null,
    }),
    viewerDecision(37, Phase.FORMAT_RESOLVE, "format.ballot_cast", {
      formatId: "safety_bounce",
      voterId: "lyra",
      targetId: "rex",
      polarity: null,
    }),
    viewerDecision(38, Phase.FORMAT_RESOLVE, "format.ballot_cast", {
      formatId: "safety_bounce",
      voterId: "echo",
      targetId: "rex",
      polarity: null,
    }),
    viewerDecision(39, Phase.FORMAT_RESOLVE, "format.ballot_cast", {
      formatId: "safety_bounce",
      voterId: "rex",
      targetId: "lyra",
      polarity: null,
    }),
    viewerDecision(40, Phase.FORMAT_RESOLVE, "format.resolved", {
      formatId: "safety_bounce",
      empoweredId: "atlas",
      eliminatedId: "rex",
      resolutionKind: "clear",
      tiedPlayerIds: ["lyra", "rex"],
      tiebreakerId: "atlas",
      aggregate: {
        capability: "public_chain",
        starterId: "atlas",
        safePlayerIds: ["atlas", "echo"],
        vulnerablePlayerIds: ["lyra", "rex"],
        voteTotals: { lyra: 2, rex: 2 },
      },
    }),
  ];
}

export function createSoleVulnerableSafetyBounceViewerDecisions(): ViewerDecisionEvent[] {
  return [
    viewerDecision(50, Phase.FORMAT_MENU, "format.menu_offered", {
      empoweredId: "atlas",
      offeredFormatIds: ["safety_bounce", "vote_bomb"],
    }),
    viewerDecision(51, Phase.FORMAT_PICK, "format.selected", {
      empoweredId: "atlas",
      formatId: "safety_bounce",
    }),
    viewerDecision(52, Phase.FORMAT_RESOLVE, "format.safety_bounce_started", {
      starterId: "atlas",
    }),
    viewerDecision(53, Phase.FORMAT_RESOLVE, "format.safety_bounce_pointer", {
      actorId: "atlas",
      targetId: "lyra",
      classification: "vulnerable",
    }),
    viewerDecision(54, Phase.FORMAT_RESOLVE, "format.safety_bounce_pointer", {
      actorId: "lyra",
      targetId: "echo",
      classification: "safe",
    }),
    viewerDecision(55, Phase.FORMAT_RESOLVE, "format.resolved", {
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
    }),
  ];
}

function scenario(
  id: FormatKernelViewerScenarioId,
  roster: Array<{ id: string; name: string }>,
  decisions: ViewerDecisionEvent[],
  expected: FormatKernelViewerScenario["expected"],
): FormatKernelViewerScenario {
  return {
    id,
    roster: roster.map((player) => ({ ...player })),
    decisions: decisions.map(cloneViewerDecision),
    expected: { ...expected },
  };
}

function cloneViewerDecision(
  decision: ViewerDecisionEvent,
): ViewerDecisionEvent {
  return JSON.parse(JSON.stringify(decision)) as ViewerDecisionEvent;
}

function viewerDecision<
  TType extends ViewerDecisionEvent["type"],
>(
  sequence: number,
  phase: Phase,
  type: TType,
  payload: Extract<ViewerDecisionEvent, { type: TType }>["payload"],
): Extract<ViewerDecisionEvent, { type: TType }> {
  return {
    sequence,
    round: 2,
    phase,
    type,
    timestamp: new Date(1_785_024_000_000 + sequence * 1_000).toISOString(),
    payload,
  } as Extract<ViewerDecisionEvent, { type: TType }>;
}
