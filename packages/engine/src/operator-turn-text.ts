/**
 * Compact operator/sim-facing one-line summaries for agent_turn traces.
 * These are diagnostic (chatty + turns JSONL), not player-safe surfaces.
 */

import type { AllianceAction } from "./game-runner.types";
import type { MingleIntentSummary } from "./types";

function clip(value: string, max = 96): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function listOrNone(names: readonly string[]): string {
  return names.length > 0 ? names.join(",") : "none";
}

export function formatMingleIntentOperatorText(
  playerName: string,
  intent: MingleIntentSummary,
): string {
  const parts: string[] = [
    `lens=${intent.strategicLens}`,
    `size=${intent.preferredRoomSize}`,
    `seek=${listOrNone(intent.seekPlayers)}`,
    `avoid=${listOrNone(intent.avoidPlayers)}`,
  ];
  if (intent.provisionalTarget) {
    parts.push(`target=${intent.provisionalTarget}`);
  } else if (intent.noTargetReason) {
    parts.push(`target=none (${clip(intent.noTargetReason, 48)})`);
  } else {
    parts.push("target=none");
  }
  if (intent.openingAsk.trim()) parts.push(`ask=${clip(intent.openingAsk)}`);
  if (intent.purpose.trim()) parts.push(`purpose=${clip(intent.purpose)}`);
  return `${playerName} intent: ${parts.join(" | ")}`;
}

export function formatMingleRoomAssignmentOperatorText(params: {
  playerName: string;
  assignedRoomId: number;
  assignmentSource: string;
  roommateNames: readonly string[];
  repairNotes?: readonly string[];
}): string {
  const withClause =
    params.roommateNames.length > 0
      ? ` with ${params.roommateNames.join(", ")}`
      : " (solo)";
  const repair =
    params.repairNotes && params.repairNotes.length > 0
      ? ` | repaired: ${clip(params.repairNotes.join("; "), 64)}`
      : "";
  return `${params.playerName} → room ${params.assignedRoomId} (${params.assignmentSource})${withClause}${repair}`;
}

export function formatMingleTurnOperatorText(params: {
  playerName: string;
  roomId: number;
  message: string | null | undefined;
  messageSent: boolean;
  toRoomId: number;
  moved: boolean;
  gotoRoomId: number | null;
  gotoPlayerName: string | null;
  gotoStatus: string;
}): string {
  const talk = params.messageSent && params.message
    ? `says: ${clip(params.message, 120)}`
    : "no_reply";
  let next: string;
  if (params.moved) {
    next = `next→room ${params.toRoomId}`;
  } else if (params.gotoPlayerName) {
    next = `next: follow ${params.gotoPlayerName} (${params.gotoStatus})`;
  } else if (params.gotoRoomId != null) {
    next = `next: room ${params.gotoRoomId} (${params.gotoStatus})`;
  } else {
    next = "next: stay";
  }
  return `${params.playerName} room ${params.roomId}: ${talk} | ${next}`;
}

/** Optional resolved identity for operator-facing alliance lines (name + roster + short id). */
export interface AllianceActionOperatorContext {
  /** Human alliance/proposal name when known. */
  allianceName?: string | null;
  /** Live member display names for the current terms/roster. */
  memberNames?: readonly string[];
  /** Short correlator (usually first 8 chars of lineage id). */
  shortId?: string | null;
}

function allianceIdentityBits(context?: AllianceActionOperatorContext): {
  namePart: string;
  membersPart: string;
  idPart: string;
} {
  const name = context?.allianceName?.trim();
  const shortId = context?.shortId?.trim();
  const namePart = name ? `"${clip(name, 40)}"` : "";
  const membersPart =
    context?.memberNames && context.memberNames.length > 0
      ? ` members=${listOrNone(context.memberNames)}`
      : "";
  // Always keep a short id when we have one so accepts can match proposes.
  const idPart = shortId ? ` #${shortId}` : "";
  return { namePart, membersPart, idPart };
}

export function formatAllianceActionOperatorText(
  playerName: string,
  action: AllianceAction,
  result: string,
  context?: AllianceActionOperatorContext,
): string {
  switch (action.action) {
    case "propose": {
      const { membersPart, idPart } = allianceIdentityBits({
        allianceName: action.name,
        memberNames: context?.memberNames?.length ? context.memberNames : action.memberNames,
        shortId: context?.shortId,
      });
      return `${playerName} alliance propose "${clip(action.name, 40)}"${idPart}${membersPart} → ${result}`;
    }
    case "counter":
    case "amend": {
      const { membersPart, idPart } = allianceIdentityBits({
        allianceName: action.name,
        memberNames: context?.memberNames?.length ? context.memberNames : action.memberNames,
        shortId: context?.shortId ?? action.lineageId.slice(0, 8),
      });
      return `${playerName} alliance ${action.action} "${clip(action.name, 40)}"${idPart}${membersPart} → ${result}`;
    }
    case "accept":
    case "decline":
    case "defer":
    case "trial": {
      const { namePart, membersPart, idPart } = allianceIdentityBits({
        allianceName: context?.allianceName,
        memberNames: context?.memberNames,
        shortId: context?.shortId ?? action.lineageId.slice(0, 8),
      });
      const target = namePart || idPart.trim() || `lineage=${action.lineageId.slice(0, 8)}`;
      // When name is present, idPart still follows for correlation; when only id, target is "#abc".
      const afterVerb = namePart
        ? `${namePart}${idPart}${membersPart}`
        : `${target}${membersPart}`;
      return `${playerName} alliance ${action.action} ${afterVerb} → ${result}`;
    }
    case "pass":
      return `${playerName} alliance pass → ${result}`;
    default: {
      const exhaustive: never = action;
      return `${playerName} alliance ${(exhaustive as { action?: string }).action ?? "unknown"} → ${result}`;
    }
  }
}

export function formatAllianceHuddleScheduleOperatorText(params: {
  decision: string;
  allianceName?: string | null;
  memberNames: readonly string[];
  rationale?: string | null;
}): string {
  const name = params.allianceName ? ` ${params.allianceName}` : "";
  if (params.decision === "skipped") {
    const why = params.rationale ? ` — ${clip(params.rationale, 80)}` : "";
    return `House huddle skip${name}${why}`;
  }
  const members = params.memberNames.length > 0 ? ` [${params.memberNames.join(", ")}]` : "";
  const why = params.rationale ? ` — ${clip(params.rationale, 80)}` : "";
  return `House huddle grant${name}${members}${why}`;
}

export function formatAllianceHuddleTurnOperatorText(params: {
  playerName: string;
  allianceName: string;
  message: string | null;
}): string {
  if (params.message) {
    return `${params.playerName} huddle (${params.allianceName}): ${clip(params.message, 120)}`;
  }
  return `${params.playerName} huddle (${params.allianceName}): no_reply`;
}

export function formatAllianceHuddleOutcomeOperatorText(params: {
  allianceName?: string | null;
  ask: string;
  plan: string;
  posture: string;
  confidence: string | number;
}): string {
  const name = params.allianceName ? `${params.allianceName}: ` : "";
  return `House huddle outcome — ${name}posture=${params.posture} conf=${params.confidence} | ask=${clip(params.ask, 64)} | plan=${clip(params.plan, 64)}`;
}

export function formatHouseProducerBriefOperatorText(params: {
  playerName: string;
  storyRole: string;
  pressurePoints: readonly string[];
  questionAngles: readonly string[];
}): string {
  return `House brief for ${params.playerName}: role=${clip(params.storyRole, 40)} | pressure=${listOrNone(params.pressurePoints.slice(0, 3))} | angles=${listOrNone(params.questionAngles.slice(0, 2))}`;
}
