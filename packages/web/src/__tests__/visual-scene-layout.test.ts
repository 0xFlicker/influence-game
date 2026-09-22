import { expect, test } from "bun:test";
import { layoutVisualScene } from "../app/games/[slug]/components/visual-scene-layout";

const head = { x: .7, y: .6, width: .1, height: .1 };
test("prefers above when both directions have room", () => {
  const layout = layoutVisualScene({ width: 1000, height: 700, bubbleHeight: 100, head });
  expect(layout.below).toBe(false);
  expect(layout.imageTop).toBe(0);
  expect(layout.bubbleTop).toBeGreaterThanOrEqual(12);
  expect(layout.bubbleTop + 100).toBeLessThan(head.y * layout.imageHeight);
});
test("uses the space below a high head without shifting the image", () => {
  const layout = layoutVisualScene({ width: 1000, height: 700, bubbleHeight: 250, head: { ...head, y: .15 } });
  expect(layout.below).toBe(true);
  expect(layout.imageTop).toBe(0);
  expect(layout.bubbleTop).toBeGreaterThan(.25 * layout.imageHeight);
  expect(layout.bubbleTop + 250).toBeLessThanOrEqual(700);
});
test("reserves space and shrinks the image when neither side fits", () => {
  const layout = layoutVisualScene({ width: 1000, height: 500, bubbleHeight: 300, head: { ...head, y: .4 } });
  expect(layout.below).toBe(false);
  expect(layout.imageTop).toBeGreaterThan(0);
  expect(layout.bubbleTop).toBeCloseTo(12);
  expect(layout.contentHeight).toBeLessThanOrEqual(500);
  expect(layout.imageWidth / layout.imageHeight).toBeCloseTo(16 / 9);
});
test.each([0, .9])("keeps speech horizontally inside the frame for a head at %s", (x) => {
  const layout = layoutVisualScene({ width: 1000, height: 700, bubbleHeight: 200, head: { ...head, x } });
  expect(layout.bubbleLeft).toBeGreaterThanOrEqual(12);
  expect(layout.bubbleLeft + layout.bubbleWidth).toBeLessThanOrEqual(988);
});
test("narrow screens and unanchored speech use a complete panel below the image", () => {
  for (const width of [400, 1000]) {
    const layout = layoutVisualScene({ width, height: 700, bubbleHeight: 350, head: width === 400 ? head : undefined });
    expect(layout.anchored).toBe(false);
    expect(layout.bubbleTop).toBeGreaterThan(layout.imageHeight);
    expect(layout.contentHeight).toBeLessThanOrEqual(700);
  }
});
test("exceptionally long speech remains in the outer flow rather than clipping", () => {
  const layout = layoutVisualScene({ width: 400, height: 300, bubbleHeight: 800 });
  expect(layout.contentHeight).toBeGreaterThan(800);
  expect(layout.imageHeight).toBeGreaterThan(0);
});
