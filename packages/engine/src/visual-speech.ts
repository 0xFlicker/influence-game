/** Presentation time, not a gameplay timer. Long messages retain their full reading time. */
export const VISUAL_SPEECH_FADE_MS = 200;
export function visualSpeechReadingMs(text: string): number {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  return words === 0 ? 0 : Math.max(3_000, 1_000 + words * 300);
}

export function visualSpeechDurationMs(text: string): number {
  const reading = visualSpeechReadingMs(text);
  return reading === 0 ? 0 : reading + VISUAL_SPEECH_FADE_MS * 2;
}

/** Driven by the presentation clock so pause, speed changes and replay seek remain deterministic. */
export function visualSpeechOpacity(text: string, elapsedMs: number, reducedMotion = false): number {
  const duration = visualSpeechDurationMs(text);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= duration) return 0;
  if (reducedMotion) return 1;
  return Math.max(0, Math.min(1, elapsedMs / VISUAL_SPEECH_FADE_MS, (duration - elapsedMs) / VISUAL_SPEECH_FADE_MS));
}
