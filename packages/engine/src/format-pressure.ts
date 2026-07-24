import type { LaunchFormatId } from "./formats";
import type { UUID } from "./types";

const RULE_SHEETS: Record<LaunchFormatId, string> = {
  save_or_eliminate:
    "Each player casts one sealed ballot: SAVE (+1 net) or ELIMINATE (−1 net) against someone else. Lowest net is eliminated. The empowered player breaks lowest-net ties.",
  vote_bomb:
    "Each player casts one sealed non-self elimination-direction vote. Zero votes = safe. Among players with at least one vote, fewest votes is eliminated. The empowered player breaks fewest-positive ties.",
  safety_bounce:
    "After mingle: one random starter is SAFE and points publicly. A SAFE player's pointer makes the target VULNERABLE; a VULNERABLE player's pointer makes the target SAFE until all are classified. Then a sealed vote among the vulnerable pool only — most votes out. Sole vulnerable auto-elims. Empowered breaks ties.",
};

export interface FormatPressureProjection {
  empoweredId: UUID;
  empoweredName: string;
  offeredFormats: [LaunchFormatId, LaunchFormatId];
  selectedFormat: LaunchFormatId | null;
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
    selectedFormat: input.selectedFormat,
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
  const offered = projection.offeredFormats.join(" | ");
  if (!projection.selectedFormat) {
    return `Format menu: ${offered}. Empowered: ${projection.empoweredName}.`;
  }
  return `Format locked: ${projection.selectedFormat}. Empowered: ${projection.empoweredName}. ${projection.ruleSheetSummary ?? ""}`;
}
