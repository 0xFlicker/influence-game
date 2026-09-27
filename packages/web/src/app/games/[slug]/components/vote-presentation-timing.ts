import { sceneCameraProgress } from "./visual-scene-layout";
import { SOLO_EXIT_MS, SOLO_SPEECH_FADE_MS, SOLO_SPEECH_START_MS } from "./solo-presentation-timing";

/** Receipts appear with the spoken reveal; collection starts after its speech fades. */
export function votePresentationTiming(elapsedMs: number, durationMs: number, reducedMotion = false) {
  const revealed = elapsedMs >= SOLO_SPEECH_START_MS + SOLO_SPEECH_FADE_MS;
  const collectionMs = SOLO_EXIT_MS - SOLO_SPEECH_FADE_MS;
  const progress = sceneCameraProgress(elapsedMs - (durationMs - collectionMs), collectionMs);
  return { revealed, progress: reducedMotion && progress > 0 ? 1 : progress };
}
