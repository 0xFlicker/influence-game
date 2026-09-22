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

test("confirmed edge head controls framing and speech on a narrow screen", () => {
  const head = { x: .8, y: .12, width: .15, height: .12 };
  const { image, bubble, tailLeft } = layoutSoloPresentation(390, 844, 1024, 1536, true, 140, 220, head);
  const headX = image.left + image.width * (head.x + head.width / 2);
  expect(headX).toBeGreaterThan(0);
  expect(headX).toBeLessThan(390);
  expect(bubble.top).toBeCloseTo(844 * .24 + 16);
  expect(bubble.left + tailLeft).toBeCloseTo(headX);
});

test.each([.65, .85])("low confirmed heads put speech above the face and controls: %s", y => {
  const head = { x: .4, y, width: .15, height: .12 };
  const { image, bubble, above } = layoutSoloPresentation(844, 390, 1024, 1536, true, 140, 220, head);
  expect(above).toBe(true);
  expect(bubble.top + bubble.height).toBeLessThan(image.height * head.y);
  expect(bubble.top + bubble.height).toBeLessThan(390 - 140);
});
