import { expect, it } from "bun:test";
import { visualSpeechDurationMs, visualSpeechOpacity, visualSpeechReadingMs } from "../visual-speech";

it("gives short bubbles a readable minimum and scales long messages without truncating their time", () => {
  expect(visualSpeechDurationMs("   ")).toBe(0);
  expect(visualSpeechReadingMs("My vote is Mara.")).toBe(3000);
  expect(visualSpeechReadingMs(Array(100).fill("word").join(" "))).toBe(31000);
  expect(visualSpeechReadingMs("One\n\t two")).toBe(3000);
});

it("expires bubbles deterministically, including replay seeking and reduced motion", () => {
  const text = "My vote is Mara.";
  expect(visualSpeechOpacity(text, -1)).toBe(0);
  expect(visualSpeechOpacity(text, 0)).toBe(0);
  expect(visualSpeechOpacity(text, 100)).toBe(.5);
  expect(visualSpeechOpacity(text, 1500)).toBe(1);
  expect(visualSpeechOpacity(text, 3300)).toBe(.5);
  expect(visualSpeechOpacity(text, 3400)).toBe(0);
  expect(visualSpeechOpacity(text, 99999, true)).toBe(0);
  expect(visualSpeechOpacity(text, 0, true)).toBe(1);
});
