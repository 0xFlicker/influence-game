import {
  FORMAT_SURFACE_IDS,
  formatSurfaceId,
  type FormatSurfaceId,
} from "../format-vocabulary";
import {
  isLaunchFormatId,
  type LaunchFormatId,
} from "../format-presentation-metadata";

const FORMAT_PROPERTY_NAMES = {
  saveOrEliminate: "saveOrExit",
  voteBomb: "shortList",
  majorityElimination: "highestCount",
} as const;

const SURFACE_POLARITIES = {
  eliminate: "exit",
} as const;

export const MCP_FORMAT_FACT_TYPES = {
  format_soe_elim_with_saves: "format_save_or_exit_with_saves",
  format_vote_bomb_clear_stack: "format_short_list_clear_stack",
  format_vote_bomb_unanimous_target: "format_short_list_unanimous_target",
} as const;

const MCP_FORMAT_DERIVATION_METHODS = {
  format_soe_eliminated_with_saves: "format_save_or_exit_exited_with_saves",
  format_vote_bomb_clear_stack: "format_short_list_clear_stack",
  format_vote_bomb_unanimous_target: "format_short_list_unanimous_target",
} as const;

type MappedValue<Map, Value> =
  Value extends keyof Map ? Map[Value] : Value;

type SurfacePropertyName<Key> = MappedValue<typeof FORMAT_PROPERTY_NAMES, Key>;
type SurfacePolarity<Value> = MappedValue<typeof SURFACE_POLARITIES, Value>;
type SurfaceFormatFactType<Value> = MappedValue<typeof MCP_FORMAT_FACT_TYPES, Value>;
type SurfaceDerivationMethod<Value> = MappedValue<typeof MCP_FORMAT_DERIVATION_METHODS, Value>;

type SurfaceResolutionMethod<Value> =
  Value extends `${infer FormatId}:${infer ResolutionKind}`
    ? FormatId extends LaunchFormatId
      ? `${MappedValue<typeof FORMAT_SURFACE_IDS, FormatId> & string}:${ResolutionKind}`
      : Value
    : Value;

const FORMAT_ID_FIELDS = [
  "activeFormatId",
  "formatId",
  "formatManifest",
  "formatMethod",
  "kind",
  "offeredFormatIds",
  "selectedFormatId",
] as const;

type FormatIdField = (typeof FORMAT_ID_FIELDS)[number];

type SurfaceFormatIdValue<Value> =
  Value extends LaunchFormatId ? FormatSurfaceId
    : Value extends readonly (infer Item)[] ? SurfaceFormatIdValue<Item>[]
      : Value;

type SurfacePropertyValue<Key, Value> =
  Key extends FormatIdField ? SurfaceFormatIdValue<Value>
    : Key extends "polarity" ? SurfacePolarity<Value>
      : Key extends "method" ? SurfaceResolutionMethod<Value>
        : Key extends "derivationMethod" ? SurfaceDerivationMethod<Value>
          : Key extends "type" ? SurfaceFormatFactType<Value>
            : GameMcpFormatSurface<Value>;

/**
 * External MCP DTO shape for structured game facts that contain format IDs.
 * Canonical persistence and opaque prose stay unchanged.
 */
export type GameMcpFormatSurface<Value> =
  Value extends readonly (infer Item)[] ? GameMcpFormatSurface<Item>[]
    : Value extends object ? {
          [Key in keyof Value as SurfacePropertyName<Key>]:
            SurfacePropertyValue<Key, Value[Key]>
        }
      : Value;

const FORMAT_ID_FIELD_SET = new Set<string>(FORMAT_ID_FIELDS);

/**
 * Translate canonical structured format vocabulary at the MCP boundary.
 *
 * The walk is field-aware: it never searches or rewrites authored prose.
 */
export function toGameMcpFormatSurface<Value>(
  value: Value,
): GameMcpFormatSurface<Value> {
  return transformMcpValue(value, null) as GameMcpFormatSurface<Value>;
}

function transformMcpValue(value: unknown, field: string | null): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => transformMcpValue(item, field));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        FORMAT_PROPERTY_NAMES[key as keyof typeof FORMAT_PROPERTY_NAMES] ?? key,
        transformMcpValue(nestedValue, key),
      ]),
    );
  }

  if (
    typeof value === "string"
    && field !== null
    && FORMAT_ID_FIELD_SET.has(field)
    && isLaunchFormatId(value)
  ) {
    return formatSurfaceId(value);
  }

  if (field === "polarity" && value === "eliminate") {
    return SURFACE_POLARITIES.eliminate;
  }

  if (field === "method" && typeof value === "string") {
    const separatorIndex = value.indexOf(":");
    const formatId = separatorIndex === -1 ? value : value.slice(0, separatorIndex);
    if (separatorIndex !== -1 && isLaunchFormatId(formatId)) {
      return `${formatSurfaceId(formatId)}${value.slice(separatorIndex)}`;
    }
  }

  if (field === "derivationMethod" && typeof value === "string") {
    return MCP_FORMAT_DERIVATION_METHODS[
      value as keyof typeof MCP_FORMAT_DERIVATION_METHODS
    ] ?? value;
  }

  if (field === "type" && typeof value === "string") {
    return MCP_FORMAT_FACT_TYPES[value as keyof typeof MCP_FORMAT_FACT_TYPES] ?? value;
  }

  return value;
}
