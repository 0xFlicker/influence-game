import {
  displayNameForFormat,
  formatPresentationMetadata,
  type LaunchFormatId,
} from "./format-presentation-metadata";
import type { UUID } from "./types";

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
  return formatPresentationMetadata(formatId).ruleSheet;
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
