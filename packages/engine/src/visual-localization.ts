import Ajv from "ajv";
import { assertVisualAnchors, type VisualPlayerAnchor } from "./visual-mode";

export interface VisualLocalization {
  count: number;
  anchors: VisualPlayerAnchor[];
  verifiedParticipantIds?: string[];
  missingParticipantIds?: string[];
}

/** Best effort still requires an exact account of every identity and every person. */
export function partialVisualLocalizationSchema(playerIds: readonly string[]) {
  const schema = visualLocalizationSchema(playerIds);
  return { ...schema, required: [...schema.required, "missingParticipantIds"], properties: {
    ...schema.properties,
    anchors: { ...schema.properties.anchors, minItems: Math.max(0, playerIds.length - 1) },
    missingParticipantIds: { type: "array", maxItems: 1, items: { type: "string", enum: [...playerIds] } },
  } };
}
export function decodePartialVisualLocalization(text: string, playerIds: readonly string[]): VisualLocalization {
  const value: unknown = JSON.parse(text);
  if (!new Ajv().compile<VisualLocalization>(partialVisualLocalizationSchema(playerIds))(value)) throw new Error("Invalid partial scene localization document");
  const visible = value.anchors.map(anchor => anchor.playerId);
  const accounted = [...visible, ...value.missingParticipantIds!];
  if (!visible.length || value.count !== visible.length || accounted.length !== playerIds.length || new Set(accounted).size !== playerIds.length || playerIds.some(id => !accounted.includes(id))) throw new VisualIdentityFailure("Partial scene contains extra, duplicated or unaccounted people");
  assertVisualAnchors(value.anchors, visible);
  return { ...value, verifiedParticipantIds: visible };
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
            playerId: { type: "string", ...(playerIds.length ? { enum: [...playerIds] } : {}) },
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
  const uncertainIds = value.anchors.filter(anchor => anchor.confidence !== "clear").map(anchor => anchor.playerId);
  if (uncertainIds.length) throw new VisualIdentityFailure("Character identity could not be verified", uncertainIds);
  try { assertVisualAnchors(value.anchors, playerIds); }
  catch (error) { throw new VisualIdentityFailure(error instanceof Error ? error.message : "Invalid scene anchors"); }
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
        properties: { playerId: { type: "string", ...(playerIds.length ? { enum: [...playerIds] } : {}) }, label: { type: "integer", minimum: 1, maximum: playerIds.length }, confidence: { type: "string", enum: ["clear", "uncertain"] } },
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
