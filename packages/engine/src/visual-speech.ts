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

/** Shared shot durations for browser playback and the compact watch timing index. */
export const SCENE_SPEECH_START_MS = 650;
export const SCENE_EXIT_HOLD_MS = 400;
export const SOLO_IMAGE_FADE_MS = 350;
export const SOLO_SETTLE_MS = 650;
export const SOLO_SPEECH_FADE_MS = 250;
export const SOLO_EXIT_HOLD_MS = 400;
export const SOLO_SPEECH_START_MS = SOLO_IMAGE_FADE_MS + SOLO_SETTLE_MS;
export const SOLO_READ_START_MS = SOLO_SPEECH_START_MS + SOLO_SPEECH_FADE_MS;
export const SOLO_EXIT_MS = SOLO_SPEECH_FADE_MS + SOLO_EXIT_HOLD_MS + SOLO_IMAGE_FADE_MS;
export const SCENE_READ_START_MS = SCENE_SPEECH_START_MS + VISUAL_SPEECH_FADE_MS;
export const SILENT_BALLOT_DURATION_MS = 2200;
export const WOLF_TRANSFORM_MS = 3600;
export const WOLF_STAGGER_MS = 240;
export function sceneSpeechDurationMs(text: string): number {
  return SCENE_SPEECH_START_MS + visualSpeechDurationMs(text) + SCENE_EXIT_HOLD_MS;
}
export function soloPresentationDurationMs(text: string): number {
  return SOLO_SPEECH_START_MS + SOLO_SPEECH_FADE_MS * 2 + visualSpeechReadingMs(text) + SOLO_EXIT_HOLD_MS + SOLO_IMAGE_FADE_MS;
}
