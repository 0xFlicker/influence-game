import type { CanonicalGameEvent } from "./canonical-events";

/** Closed presentation intervals. A new phase closes its predecessor, not itself. */
export function closedViewerPhases(events: readonly CanonicalGameEvent[], completed: boolean) {
  const phases: Array<{ startSequence: number; throughSequence: number; nextPhaseSequence: number | null }> = [];
  let startSequence = 0;
  for (const event of events) {
    if (event.type === "game.phase_entered") {
      if (event.sequence > 1) phases.push({ startSequence, throughSequence: event.sequence - 1, nextPhaseSequence: event.sequence });
      startSequence = event.sequence;
    }
  }
  const tail = events.at(-1);
  // Completed games without a retrospective are valid historical recordings.
  // An unfinished retrospective never becomes complete just because a winner exists.
  const retrospectiveStarted = events.some(event => event.type === "retrospective.started" || event.phase === "RETROSPECTIVE");
  const retrospectiveCompleted = events.some(event => event.type === "retrospective.completed");
  if (tail && (retrospectiveCompleted || completed && !retrospectiveStarted)) {
    phases.push({ startSequence, throughSequence: tail.sequence, nextPhaseSequence: null });
  }
  return phases;
}
