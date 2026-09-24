import { expect, test } from "bun:test";
import { visualSpeechReadingMs, VISUAL_SPEECH_FADE_MS } from "@influence/engine/visual-speech";
import { soloPresentationDurationMs, soloPresentationMotion, SOLO_IMAGE_FADE_MS, SOLO_SPEECH_START_MS, SOLO_SPEECH_FADE_MS, SOLO_EXIT_HOLD_MS } from "../app/games/[slug]/components/solo-presentation-timing";

const text = "Echo";
test("solo shot fades in, settles, reads the complete line, then reverses through black", () => {
  const start = SOLO_SPEECH_START_MS;
  const end = start + SOLO_SPEECH_FADE_MS * 2 + visualSpeechReadingMs(text);
  const duration = soloPresentationDurationMs(text);
  expect(soloPresentationMotion(text, 0)).toMatchObject({ imageOpacity: 0, speechOpacity: 0 });
  expect(soloPresentationMotion(text, SOLO_IMAGE_FADE_MS / 2)).toMatchObject({ imageOpacity: .5, speechOpacity: 0 });
  expect(soloPresentationMotion(text, start - 1)).toMatchObject({ imageOpacity: 1, speechOpacity: 0 });
  expect(soloPresentationMotion(text, start + SOLO_SPEECH_FADE_MS / 2)).toMatchObject({ imageOpacity: 1, speechOpacity: .5 });
  expect(soloPresentationMotion(text, start + SOLO_SPEECH_FADE_MS)).toMatchObject({ speechOpacity: 1, speechElapsedMs: VISUAL_SPEECH_FADE_MS });
  expect(soloPresentationMotion(text, end - SOLO_SPEECH_FADE_MS / 2)).toMatchObject({ imageOpacity: 1, speechOpacity: .5 });
  expect(soloPresentationMotion(text, end + SOLO_EXIT_HOLD_MS / 2)).toMatchObject({ imageOpacity: 1, speechOpacity: 0 });
  expect(soloPresentationMotion(text, duration - SOLO_IMAGE_FADE_MS / 2)).toMatchObject({ imageOpacity: .5, speechOpacity: 0 });
  expect(soloPresentationMotion(text, duration)).toMatchObject({ imageOpacity: 0, speechOpacity: 0 });
});

test("pause freezes a fade, while the initial paused image waits for a speech click", () => {
  expect(soloPresentationMotion(text, 125, true)).toEqual(soloPresentationMotion(text, 125));
  expect(soloPresentationMotion(text, 0, true)).toMatchObject({ imageOpacity: 1, speechOpacity: 0 });
  expect(soloPresentationMotion(text, soloPresentationDurationMs(text), true)).toMatchObject({ imageOpacity: 0, speechOpacity: 0 });
});

test("reduced motion keeps staging and reading time, without intermediate opacity", () => {
  expect(soloPresentationMotion(text, 125, false, true)).toMatchObject({ imageOpacity: 1, speechOpacity: 0 });
  expect(soloPresentationMotion(text, SOLO_SPEECH_START_MS + 125, false, true)).toMatchObject({ imageOpacity: 1, speechOpacity: 1 });
  const long = "Every word retains its reading time. ".repeat(100);
  expect(soloPresentationDurationMs(long) - soloPresentationDurationMs(text)).toBe(visualSpeechReadingMs(long) - visualSpeechReadingMs(text));
});
