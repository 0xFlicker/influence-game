import Ajv from "ajv";
import { assertVisualAnchors, type VisualPlayerAnchor } from "./visual-mode";

export interface VisualLocalization {
  count: number;
  anchors: VisualPlayerAnchor[];
  verifiedParticipantIds?: string[];
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
  if (value.count !== playerIds.length) throw new VisualIdentityFailure("Generated scene has an unexpected occupant count");
  assertVisualAnchors(value.anchors, playerIds);
  return value;
}

/** Identity matching is separate from geometry so reference ordering cannot become placement. */
export function visualIdentitySchema(playerIds: readonly string[]) {
  return {
    type: "object", additionalProperties: false, required: ["count", "matches"],
    properties: {
      count: { type: "integer", minimum: 0, maximum: 100 },
      matches: { type: "array", minItems: playerIds.length, maxItems: playerIds.length, items: {
        type: "object", additionalProperties: false, required: ["playerId", "label", "confidence"],
        properties: { playerId: { type: "string", enum: [...playerIds] }, label: { type: "integer", minimum: 1, maximum: playerIds.length }, confidence: { type: "string", enum: ["clear", "uncertain"] } },
      } },
    },
  };
}
export function decodeVisualIdentities(text: string, playerIds: readonly string[], candidates: readonly VisualPlayerAnchor[]): VisualLocalization {
  const value: unknown = JSON.parse(text);
  type IdentityResult = { count: number; matches: Array<Pick<VisualPlayerAnchor, "playerId" | "label" | "confidence">> };
  if (!new Ajv().compile<IdentityResult>(visualIdentitySchema(playerIds))(value)) throw new Error("Invalid visual identity document");
  const anchors = value.matches.map((match) => {
    const candidate = candidates.find((entry) => entry.label === match.label);
    if (!candidate) throw new Error("Identity references an unknown head label");
    return { ...match, head: { ...candidate.head } };
  });
  return decodeVisualLocalization(JSON.stringify({ count: value.count, anchors }), playerIds);
}

export class VisualIdentityFailure extends Error {
  constructor(message: string, readonly playerIds: readonly string[] = []) { super(message); }
}
export function visualCompositionSchema(playerIds: readonly string[]) {
  return { type: "object", additionalProperties: false, required: ["count", "identities"], properties: {
    count: { type: "integer", minimum: 0 },
    identities: { type: "array", minItems: playerIds.length, maxItems: playerIds.length, items: {
      type: "object", additionalProperties: false, required: ["playerId", "confidence"], properties: {
        playerId: { type: "string", ...(playerIds.length ? { enum: [...playerIds] } : {}) }, confidence: { type: "string", enum: ["clear", "uncertain"] },
      },
    } },
  } };
}
export function decodeVisualComposition(text: string, playerIds: readonly string[]): VisualLocalization {
  const value: unknown = JSON.parse(text);
  type Composition = { count: number; identities: Array<{ playerId: string; confidence: string }> };
  if (!new Ajv().compile<Composition>(visualCompositionSchema(playerIds))(value)) throw new VisualIdentityFailure("Invalid scene composition verification");
  if (value.count !== playerIds.length) throw new VisualIdentityFailure("Generated scene has an unexpected occupant count");
  const ids = value.identities.map(entry => entry.playerId);
  if (new Set(ids).size !== playerIds.length) throw new VisualIdentityFailure("Scene participants are missing or duplicated", playerIds.filter(id => ids.filter(found => found === id).length !== 1));
  const uncertainIds = value.identities.filter(entry => entry.confidence !== "clear").map(entry => entry.playerId);
  if (uncertainIds.length) throw new VisualIdentityFailure("Character identity could not be verified", uncertainIds);
  return { count: value.count, anchors: [], verifiedParticipantIds: value.identities.map((entry) => entry.playerId) };
}
