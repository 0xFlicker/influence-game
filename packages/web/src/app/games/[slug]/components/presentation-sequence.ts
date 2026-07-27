import type { PresentationCue } from "./types";

/**
 * Resolve the first presentation cue index at or after a canonical event sequence.
 * Prefer an exact sequence match (first stage of multi-stage classic cues); if none,
 * land on the next cue at or after the target; if the target is past the end, the last cue.
 */
export function findPresentationCueIndexForSequence(
  cues: readonly PresentationCue[],
  sequence: number,
): number {
  if (cues.length === 0) return 0;
  let exactIndex = -1;
  let atOrAfterIndex = -1;
  for (let index = 0; index < cues.length; index += 1) {
    const cueSequence = cues[index]!.canonicalSequence;
    if (cueSequence === null) continue;
    if (cueSequence === sequence && exactIndex < 0) exactIndex = index;
    if (cueSequence >= sequence && atOrAfterIndex < 0) atOrAfterIndex = index;
  }
  if (exactIndex >= 0) return exactIndex;
  if (atOrAfterIndex >= 0) return atOrAfterIndex;
  return cues.length - 1;
}
