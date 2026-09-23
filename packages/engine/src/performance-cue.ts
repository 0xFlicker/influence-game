import type { PerformanceCue } from "./visual-mode";

/** Ask for free-form text; received cue content remains opaque to the engine. */
export const PERFORMANCE_CUE_SCHEMA = { type: ["string", "null"] };

export const PERFORMANCE_CUE_GUIDANCE = "You may return a free-form performance cue alongside your turn. Use null when no cue is needed. You can describe posture, facial expression, gesture, movement, audible pace, volume, tone, or other performance direction in your own words. A cue is performance direction and cannot execute movement, cast a vote or change game state. Room cues are more recent than the still image and may inform your reaction.";

/** Trim surrounding whitespace only; absent or non-string optional metadata supplies no cue. */
export function optionalPerformanceCue(value: unknown): PerformanceCue {
  return typeof value === "string" ? value.trim() : null;
}
