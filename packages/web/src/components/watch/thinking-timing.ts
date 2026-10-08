/** Shared semantic thought timing; independent of browser timers and render order. */
export type ThinkingOrder = "thinking-first" | "speech-first";
export interface SpeechBoundaries {
  showAtMs: number;
  readAtMs: number;
  hideAtMs: number;
  hiddenAtMs: number;
}
export interface ThoughtTiming {
  text: string;
  order: ThinkingOrder;
  duration: number;
  insertAt: number;
}

export function thoughtTiming(
  text: string | null,
  order: ThinkingOrder,
  baseDurationMs: number,
  speech: SpeechBoundaries | null,
): ThoughtTiming | null {
  const normalized = text?.trim();
  return normalized
    ? {
        text: normalized,
        order,
        duration: Math.max(2800, normalized.split(/\s+/).length * 320),
        insertAt:
          order === "thinking-first"
            ? (speech?.showAtMs ?? 0)
            : (speech?.hiddenAtMs ?? baseDurationMs),
      }
    : null;
}
export function thoughtContentTime(
  elapsed: number,
  thought: ThoughtTiming | null,
): number {
  return !thought || elapsed <= thought.insertAt
    ? elapsed
    : Math.max(thought.insertAt, elapsed - thought.duration);
}
export function thoughtSpeechBoundaries(
  speech: SpeechBoundaries | null,
  thought: ThoughtTiming | null,
): SpeechBoundaries | null {
  if (!speech || !thought) return speech;
  const shift = (time: number) =>
    time >= thought.insertAt ? time + thought.duration : time;
  return {
    showAtMs: shift(speech.showAtMs),
    readAtMs: shift(speech.readAtMs),
    hideAtMs: shift(speech.hideAtMs),
    hiddenAtMs: shift(speech.hiddenAtMs),
  };
}
export function sampleThought(
  timeline: number,
  thought: ThoughtTiming | null,
  speech: SpeechBoundaries | null,
) {
  if (!thought) return null;
  const elapsed = timeline - thought.insertAt;
  const shifted =
    thought.order === "thinking-first"
      ? thoughtSpeechBoundaries(speech, thought)
      : null;
  const end = shifted?.hiddenAtMs ?? thought.insertAt + thought.duration;
  if (elapsed < 0 || timeline >= end) return null;
  const opacity =
    shifted && timeline > shifted.hideAtMs
      ? Math.max(
          0,
          (shifted.hiddenAtMs - timeline) /
            Math.max(1, shifted.hiddenAtMs - shifted.hideAtMs),
        )
      : 1;
  return {
    text: thought.text,
    elapsedMs: Math.min(elapsed, thought.duration),
    durationMs: thought.duration,
    opacity,
  };
}
