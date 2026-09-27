import { describe, expect, test } from "bun:test";
import { frameVisualScene, panScene, placeSceneBubble } from "../app/games/[slug]/components/visual-scene-layout";
import { paginateSpeech, speechPageIndex } from "../app/games/[slug]/components/speech-pages";

const head = { x: .8, y: .2, width: .06, height: .1 };
describe("responsive scene framing", () => {
  test("wide frames contain; narrow frames cover around a verified head", () => {
    expect(frameVisualScene(1600, 600, 1600, 900, head).width).toBeCloseTo(1600 * 2 / 3);
    const frame = frameVisualScene(390, 700, 1600, 900, head);
    expect(frame.height).toBe(700);
    expect(frame.left).toBeLessThan(0);
    expect(frame.left + head.x * frame.width).toBeGreaterThan(0);
    expect(frame.left + (head.x + head.width) * frame.width).toBeLessThan(390);
  });
  test("unknown or anonymous speakers show the whole image", () => {
    const frame = frameVisualScene(390, 700, 1600, 900);
    expect(frame.width).toBe(390);
    expect(frame.left).toBe(0);
    expect(frame.top).toBeGreaterThan(0);
  });
  test("focal panels center the accepted speaker on both wide and cropped stages", () => {
    for (const [width, height] of [[1920, 1080], [390, 844]]) {
      for (const x of [.02, .3, .88]) {
        const speaker = { x, y: .2, width: .08, height: .12 };
        const frame = frameVisualScene(width!, height!, 800, 1200, speaker, "focal");
        expect(frame.left + (speaker.x + speaker.width / 2) * frame.width).toBeCloseTo(width! / 2);
      }
    }
  });
  test("edge crops stay within source image", () => {
    for (const x of [0, .94]) {
      const frame = frameVisualScene(390, 700, 1600, 900, { ...head, x });
      expect(frame.left).toBeLessThanOrEqual(0);
      expect(frame.left + frame.width).toBeGreaterThanOrEqual(390);
    }
  });
  test("pan is a pure 450ms director-time interpolation", () => {
    const from = { width: 1000, height: 600, left: 0, top: 0 }, to = { ...from, left: -500 };
    expect(panScene(from, to, 0).left).toBe(0);
    expect(panScene(from, to, 225).left).toBe(-250);
    expect(panScene(from, to, 450)).toEqual(to);
    expect(panScene(from, to, 900)).toEqual(to);
  });
  test("bubble prefers above and flips below near the top", () => {
    const frame = { width: 1000, height: 700, left: 0, top: 0 };
    const above = placeSceneBubble(1000, 700, frame, { ...head, y: .6 });
    const below = placeSceneBubble(1000, 700, frame, { ...head, y: .1 });
    expect(above.below).toBe(false);
    expect(below.below).toBe(true);
    for (const b of [above, below]) {
      expect(b.left).toBeGreaterThanOrEqual(12);
      expect(b.left + b.width).toBeLessThanOrEqual(988);
      expect(b.top + b.height).toBeLessThanOrEqual(688);
    }
  });
  test("a short line still has room for its header and page footer near a high head", () => {
    const frame = { width: 720, height: 1080, left: 600, top: 0 };
    const bubble = placeSceneBubble(1920, 940, frame, { x: .44, y: .12, width: .12, height: .12 }, 94);
    expect(bubble.below).toBe(true);
    expect(bubble.height).toBeGreaterThanOrEqual(128);
    expect(bubble.top).toBeGreaterThan(1080 * .24);
  });
});
describe("speech pages", () => {
  test("preserve all text and prefer complete sentences", () => {
    const text = 'One sentence. Second sentence carries more words.\n\nLast one.';
    const pages = paginateSpeech(text, (value) => value.length <= 32);
    expect(pages.join('')).toBe(text);
    expect(pages[0]).toBe('One sentence. ');
    expect(pages.every((page) => page.length <= 32)).toBe(true);
  });
  test("unbroken text cannot overflow or disappear", () => {
    const text = 'abcdefghijklmnopqrst';
    const pages = paginateSpeech(text, (value) => value.length <= 5);
    expect(pages.join('')).toBe(text);
    expect(pages).toHaveLength(4);
  });
  test("reading position is weighted and clamps at both ends", () => {
    const pages = ['one two ', 'three four five six'];
    expect(speechPageIndex(pages, 0)).toBe(0);
    expect(speechPageIndex(pages, .34)).toBe(1);
    expect(speechPageIndex(pages, 1)).toBe(1);
  });
});
