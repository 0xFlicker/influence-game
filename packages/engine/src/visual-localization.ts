import Ajv from "ajv";
import { assertVisualAnchors, type VisualPlayerAnchor } from "./visual-mode";

export interface VisualLocalization {
  count: number;
  anchors: VisualPlayerAnchor[];
}

export function visualLocalizationSchema(playerIds: readonly string[]) {
  const coordinate = { type: "number", minimum: 0, maximum: 1 };
  return {
    type: "object", additionalProperties: false, required: ["count", "anchors"],
    properties: {
      count: { type: "integer", minimum: 0, maximum: 100 },
      anchors: {
        type: "array", minItems: playerIds.length, maxItems: playerIds.length,
        items: {
          type: "object", additionalProperties: false,
          required: ["playerId", "label", "head", "confidence"],
          properties: {
            playerId: { type: "string", enum: [...playerIds] },
            label: { type: "integer", minimum: 1, maximum: playerIds.length },
            confidence: { type: "string", enum: ["clear", "uncertain"] },
            head: {
              type: "object", additionalProperties: false, required: ["x", "y", "width", "height"],
              properties: { x: coordinate, y: coordinate, width: coordinate, height: coordinate },
            },
          },
        },
      },
    },
  };
}

/** Exact JSON only: malformed or uncertain observations never become usable scene anchors. */
export function decodeVisualLocalization(text: string, playerIds: readonly string[]): VisualLocalization {
  const value: unknown = JSON.parse(text);
  if (!new Ajv().compile<VisualLocalization>(visualLocalizationSchema(playerIds))(value)) throw new Error("Invalid visual localization document");
  if (value.count !== playerIds.length) throw new Error("Generated scene has an unexpected occupant count");
  assertVisualAnchors(value.anchors, playerIds);
  return value;
}
