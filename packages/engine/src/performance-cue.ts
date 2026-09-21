import Ajv from "ajv";
import type { PerformanceCue } from "./visual-mode";

export const PERFORMANCE_CUE_SCHEMA = {
  anyOf: [
    { type: "null" },
    {
      type: "object", additionalProperties: false,
      required: ["behavior", "delivery", "intendedAction"],
      properties: Object.fromEntries(["behavior", "delivery", "intendedAction"].map((key) => [key, { type: "string", maxLength: 400 }])),
    },
  ],
};
const validateCue = new Ajv().compile<PerformanceCue | null>(PERFORMANCE_CUE_SCHEMA);
export function decodePerformanceCue(value: unknown): PerformanceCue | null {
  if (!validateCue(value)) throw new Error("Performance cue must be null or an exact observable behavior/delivery/intendedAction object");
  return value;
}

export const PERFORMANCE_CUE_GUIDANCE = "You may return a performance cue alongside your turn. Use null when no cue is needed. behavior describes visible posture, facial expression or gesture; delivery describes audible pace, volume and tone; intendedAction describes a desired visual performance, never a completed game action. Keep cues brief and observable. Do not expose private thinking, strategy, hidden intentions or claims about other players. A cue cannot move you between rooms, cast a vote or change game state. Room cues are more recent than the still image and may inform your reaction.";
