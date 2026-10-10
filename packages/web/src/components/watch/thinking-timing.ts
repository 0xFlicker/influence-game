/** A complete private-thought shot precedes speech on the shared playback clock. */
export interface SpeechBoundaries {
  showAtMs: number;
  readAtMs: number;
  hideAtMs: number;
  hiddenAtMs: number;
}
export interface ThoughtTiming {
  text: string;
  duration: number;
  insertAt: number;
  enterMs: number;
  showAtMs: number;
  readAtMs: number;
  hideAtMs: number;
  returnAtMs: number;
}
export function thoughtTiming(text: string | null, speech: SpeechBoundaries | null,
  {readingRate = 1, motionScale = 1}: {readingRate?: number; motionScale?: number} = {}): ThoughtTiming | null {
  const normalized = text?.trim();
  if (!normalized) return null;
  const enterMs = 900 * motionScale;
  const showAtMs = enterMs + 150 * motionScale;
  const readAtMs = showAtMs + 250 * motionScale;
  const hideAtMs = readAtMs + Math.max(2800, normalized.split(/\s+/).length * 320) / readingRate;
  const returnAtMs = hideAtMs + 250 * motionScale;
  return {text: normalized, insertAt: speech?.showAtMs ?? 0, enterMs, showAtMs, readAtMs, hideAtMs, returnAtMs,
    duration: returnAtMs + 900 * motionScale};
}
export function thoughtContentTime(elapsed: number, thought: ThoughtTiming | null): number {
  return !thought || elapsed <= thought.insertAt ? elapsed : Math.max(thought.insertAt, elapsed - thought.duration);
}
export function thoughtSpeechBoundaries(speech: SpeechBoundaries | null, thought: ThoughtTiming | null): SpeechBoundaries | null {
  if (!speech || !thought) return speech;
  const shift = (time: number) => time >= thought.insertAt ? time + thought.duration : time;
  return {showAtMs: shift(speech.showAtMs), readAtMs: shift(speech.readAtMs), hideAtMs: shift(speech.hideAtMs), hiddenAtMs: shift(speech.hiddenAtMs)};
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => {const t = clamp(n); return t * t * (3 - 2 * t);};
export function sampleThought(timeline: number, thought: ThoughtTiming | null) {
  if (!thought) return null;
  const elapsed = timeline - thought.insertAt;
  if (elapsed < 0 || elapsed >= thought.duration) return null;
  const focus = elapsed < thought.returnAtMs ? ease(elapsed / Math.max(1, thought.enterMs))
    : 1 - ease((elapsed - thought.returnAtMs) / Math.max(1, thought.duration - thought.returnAtMs));
  const opacity = elapsed < thought.readAtMs ? clamp((elapsed - thought.showAtMs) / Math.max(1, thought.readAtMs - thought.showAtMs))
    : 1 - clamp((elapsed - thought.hideAtMs) / Math.max(1, thought.returnAtMs - thought.hideAtMs));
  return {text: thought.text, elapsedMs: Math.max(0, Math.min(elapsed - thought.readAtMs, thought.hideAtMs - thought.readAtMs)),
    durationMs: thought.hideAtMs - thought.readAtMs, opacity, focus};
}
