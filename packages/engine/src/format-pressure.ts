import { displayNameForFormat, type LaunchFormatId } from "./formats";
import type { UUID } from "./types";

const RULE_SHEETS: Record<LaunchFormatId, string> = {
  save_or_eliminate:
    "Each player casts one sealed ballot: SAVE (+1 net) or ELIMINATE (−1 net) against someone else. Lowest net is eliminated. The empowered player breaks lowest-net ties.",
  vote_bomb:
    "Each living player casts one sealed vote for another living player. Zero votes is safe. Among players with at least one vote, fewest votes is eliminated. The empowered player breaks fewest-positive ties.",
  safety_bounce:
    "After mingle: one random starter is SAFE and points publicly. A SAFE player's pointer makes the target VULNERABLE; a VULNERABLE player's pointer makes the target SAFE until all are classified. Then a sealed vote among the vulnerable pool only — most votes out. Sole vulnerable auto-elims. Empowered breaks ties.",
};

export interface FormatPressureProjection {
  empoweredId: UUID;
  empoweredName: string;
  offeredFormats: [LaunchFormatId, LaunchFormatId];
  /** Human-facing labels for the offered pair (same order as offeredFormats). Filled by buildFormatPressureProjection. */
  offeredFormatNames?: [string, string];
  selectedFormat: LaunchFormatId | null;
  /** Human-facing locked format name. Filled by buildFormatPressureProjection. */
  selectedFormatName?: string | null;
  ruleSheetSummary: string | null;
  bounceBoard?: {
    safe: UUID[];
    vulnerable: UUID[];
    unclassified: UUID[];
    nextActorId: UUID | null;
  };
}

export function ruleSheetForFormat(formatId: LaunchFormatId): string {
  return RULE_SHEETS[formatId];
}

export function buildFormatPressureProjection(input: {
  empoweredId: UUID;
  empoweredName: string;
  offeredFormats: [LaunchFormatId, LaunchFormatId];
  selectedFormat: LaunchFormatId | null;
  bounceBoard?: FormatPressureProjection["bounceBoard"];
}): FormatPressureProjection {
  return {
    empoweredId: input.empoweredId,
    empoweredName: input.empoweredName,
    offeredFormats: [...input.offeredFormats],
    offeredFormatNames: [
      displayNameForFormat(input.offeredFormats[0]),
      displayNameForFormat(input.offeredFormats[1]),
    ],
    selectedFormat: input.selectedFormat,
    selectedFormatName: input.selectedFormat ? displayNameForFormat(input.selectedFormat) : null,
    ruleSheetSummary: input.selectedFormat ? ruleSheetForFormat(input.selectedFormat) : null,
    ...(input.bounceBoard
      ? {
          bounceBoard: {
            safe: [...input.bounceBoard.safe],
            vulnerable: [...input.bounceBoard.vulnerable],
            unclassified: [...input.bounceBoard.unclassified],
            nextActorId: input.bounceBoard.nextActorId,
          },
        }
      : {}),
  };
}

export function formatPressureSummary(projection: FormatPressureProjection): string {
  const offered = (projection.offeredFormatNames
    ?? projection.offeredFormats.map((id) => displayNameForFormat(id))
  ).join(" | ");
  if (!projection.selectedFormat) {
    return `Format menu: ${offered}. Empowered: ${projection.empoweredName}.`;
  }
  const locked = projection.selectedFormatName ?? displayNameForFormat(projection.selectedFormat);
  return `Format locked: ${locked}. Empowered: ${projection.empoweredName}. ${projection.ruleSheetSummary ?? ""}`;
}
