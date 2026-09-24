import { VISUAL_SPEECH_FADE_MS, visualSpeechReadingMs } from "@influence/engine/visual-speech";

export const SOLO_IMAGE_FADE_MS = 350;
export const SOLO_SETTLE_MS = 650;
export const SOLO_SPEECH_FADE_MS = 250;
export const SOLO_EXIT_HOLD_MS = 400;
export const SOLO_SPEECH_START_MS = SOLO_IMAGE_FADE_MS + SOLO_SETTLE_MS;
export const SOLO_READ_START_MS = SOLO_SPEECH_START_MS + SOLO_SPEECH_FADE_MS;
export const SOLO_EXIT_MS = SOLO_SPEECH_FADE_MS + SOLO_EXIT_HOLD_MS + SOLO_IMAGE_FADE_MS;

export function soloPresentationDurationMs(text: string) {
  return SOLO_SPEECH_START_MS + SOLO_SPEECH_FADE_MS * 2 + visualSpeechReadingMs(text) + SOLO_EXIT_HOLD_MS + SOLO_IMAGE_FADE_MS;
}

/** One director clock owns the shot, both pauses, the bubble, and its reading pages. */
export function soloPresentationMotion(text: string, elapsedMs: number, paused = false, reducedMotion = false) {
  const reading = visualSpeechReadingMs(text);
  const duration = soloPresentationDurationMs(text);
  // A paused initial frame exposes the image; the next click reveals its bubble.
  const time = paused && elapsedMs === 0 ? SOLO_SPEECH_START_MS : elapsedMs;
  const speechEnd = SOLO_SPEECH_START_MS + SOLO_SPEECH_FADE_MS * 2 + reading;
  const ramp = (value: number) => Math.max(0, Math.min(1, value));
  const imageOpacity = time < 0 || time >= duration ? 0 : reducedMotion ? 1
    : ramp(Math.min(time / SOLO_IMAGE_FADE_MS, (duration - time) / SOLO_IMAGE_FADE_MS));
  const speechOpacity = time <= SOLO_SPEECH_START_MS || time >= speechEnd ? 0 : reducedMotion ? 1
    : ramp(Math.min((time - SOLO_SPEECH_START_MS) / SOLO_SPEECH_FADE_MS, (speechEnd - time) / SOLO_SPEECH_FADE_MS));
  return { imageOpacity, speechOpacity,
    speechElapsedMs: VISUAL_SPEECH_FADE_MS + Math.max(0, Math.min(reading, time - SOLO_SPEECH_START_MS - SOLO_SPEECH_FADE_MS)) };
}
