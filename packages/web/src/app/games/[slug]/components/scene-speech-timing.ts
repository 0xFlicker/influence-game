import { visualSpeechOpacity } from "@influence/engine/visual-speech";

import {SCENE_SPEECH_START_MS} from "@influence/engine/visual-speech";
export {SCENE_SPEECH_START_MS, SCENE_EXIT_HOLD_MS, SCENE_READ_START_MS, sceneSpeechDurationMs} from "@influence/engine/visual-speech";

export function sceneSpeechOpacity(text: string, elapsedMs: number, reducedMotion = false): number {
  if (elapsedMs <= SCENE_SPEECH_START_MS) return 0;
  return visualSpeechOpacity(text, elapsedMs - SCENE_SPEECH_START_MS, reducedMotion);
}
