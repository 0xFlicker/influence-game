import { Phase } from "../types";
import type { ViewerDecisionEvent } from "../viewer-decision-events";

export const FORMAT_KERNEL_VIEWER_GAME_ID = "format-kernel-viewer";

export const FORMAT_KERNEL_VIEWER_ROSTER = [
  { id: "atlas", name: "Atlas" },
  { id: "lyra", name: "Lyra" },
  { id: "echo", name: "Echo" },
  { id: "rex", name: "Rex" },
] as const;

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
      saveOrEliminate: null,
      voteBomb: null,
      safetyBounce: {
        starterId: "atlas",
        safePlayerIds: ["atlas", "echo"],
        vulnerablePlayerIds: ["lyra", "rex"],
        voteTotals: { lyra: 2, rex: 2 },
      },
    }),
  ];
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

