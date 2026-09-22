import { expect, test } from "bun:test";
import { FULL_BODY_HEAD_REGION_BOTTOM, layoutSoloPresentation } from "../app/games/[slug]/components/solo-presentation-layout";

test("standing character fills the player height with side letterboxing on wide screens", () => {
  const { image, bubble } = layoutSoloPresentation(1280, 800, 1024, 1536, true, 140, 220);
  expect(image.height).toBe(800);
  expect(image.top).toBe(0);
  expect(image.width).toBeCloseTo(800 * 2 / 3);
  expect(image.left).toBeCloseTo((1280 - image.width) / 2);
  expect(bubble.top).toBe(800 * FULL_BODY_HEAD_REGION_BOTTOM + 16);
  expect(bubble.left + bubble.width / 2).toBe(640);
});

test.each([{ width: 390, height: 844 }, { width: 844, height: 390 }])("rotation preserves image height and keeps speech below the head and above controls: %j", ({ width, height }) => {
  const { image, bubble } = layoutSoloPresentation(width, height, 1024, 1536, true, 140, 1400);
  expect(image.height).toBe(height);
  expect(image.top).toBe(0);
  expect(bubble.top).toBeGreaterThan(height * FULL_BODY_HEAD_REGION_BOTTOM);
  expect(bubble.top + bubble.height).toBeLessThanOrEqual(height - 140);
  expect(bubble.left).toBeGreaterThanOrEqual(12);
  expect(bubble.left + bubble.width).toBeLessThanOrEqual(width - 12);
  if (width < image.width) expect(image.left).toBeLessThan(0);
});

test("static portrait fallback puts speech below the actual portrait instead of guessing a head", () => {
  const { image, bubble } = layoutSoloPresentation(844, 390, 512, 512, false, 140, 220);
  expect(bubble.top).toBe(image.top + image.height + 16);
  expect(bubble.height).toBeGreaterThan(110);
});
