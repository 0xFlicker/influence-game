import {
  LAUNCH_FORMAT_IDS,
  type LaunchFormatId,
} from "./format-presentation-metadata";

/**
 * Current product/provider/MCP identifiers for canonical round formats.
 *
 * Canonical IDs remain the persisted game authority. Convert only at an
 * external or model-facing boundary, and map accepted values back before
 * validation, journaling, checkpointing, or event emission.
 */
export const FORMAT_SURFACE_IDS = {
  save_or_eliminate: "save_or_exit",
  vote_bomb: "short_list",
  safety_bounce: "safety_bounce",
  majority_elimination: "highest_count",
  even_votes: "even_votes",
  restricted_history: "restricted_history",
  two_names: "two_names",
} as const satisfies Record<LaunchFormatId, string>;

export type FormatSurfaceId =
  (typeof FORMAT_SURFACE_IDS)[LaunchFormatId];

const CANONICAL_FORMAT_IDS_BY_SURFACE = new Map<
  FormatSurfaceId,
  LaunchFormatId
>(
  LAUNCH_FORMAT_IDS.map((canonicalId) => [
    FORMAT_SURFACE_IDS[canonicalId],
    canonicalId,
  ]),
);

export function formatSurfaceId(formatId: LaunchFormatId): FormatSurfaceId {
  return FORMAT_SURFACE_IDS[formatId];
}

export function canonicalFormatIdForSurface(
  value: unknown,
): LaunchFormatId | null {
  return typeof value === "string"
    ? CANONICAL_FORMAT_IDS_BY_SURFACE.get(value as FormatSurfaceId) ?? null
    : null;
}
