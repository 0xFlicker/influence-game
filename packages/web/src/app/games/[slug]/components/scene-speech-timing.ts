import { VISUAL_SPEECH_FADE_MS, visualSpeechDurationMs, visualSpeechOpacity } from "@influence/engine/visual-speech";

/** Let the camera finish its 450 ms pan before introducing the next bubble. */
export const SCENE_SPEECH_START_MS = 650;
export const SCENE_EXIT_HOLD_MS = 400;
export const SCENE_READ_START_MS = SCENE_SPEECH_START_MS + VISUAL_SPEECH_FADE_MS;

export function sceneSpeechDurationMs(text: string): number {
  return SCENE_SPEECH_START_MS + visualSpeechDurationMs(text) + SCENE_EXIT_HOLD_MS;
}

export function sceneSpeechOpacity(text: string, elapsedMs: number, reducedMotion = false): number {
  if (elapsedMs <= SCENE_SPEECH_START_MS) return 0;
  return visualSpeechOpacity(text, elapsedMs - SCENE_SPEECH_START_MS, reducedMotion);
}
