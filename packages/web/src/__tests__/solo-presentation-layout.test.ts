import { expect, test } from "bun:test";
import { layoutSoloPresentation } from "../app/games/[slug]/components/solo-presentation-layout";
import type {SceneFrame} from "../app/games/[slug]/components/visual-scene-layout";
const overlaps = (a: SceneFrame, b: SceneFrame) => a.left < b.left+b.width && b.left < a.left+a.width && a.top < b.top+b.height && b.top < a.top+a.height;
for (const [width,height] of [[1280,800],[390,844],[844,390],[590,280]]) {
  for (const thinking of [false,true]) {
    test(`full-body art, bubbles and ledger have separate space: ${width}x${height}, thinking=${thinking}`, () => {
      const layout = layoutSoloPresentation(width!,height!,1024,1536,true,110,308,{x:.4,y:.85,width:.15,height:.12},thinking);
      const boxes = [layout.image,layout.bubble,...(layout.thought ? [layout.thought] : [])];
      for (const box of boxes) {
        expect(box.width).toBeGreaterThan(0); expect(box.height).toBeGreaterThan(0);
        expect(box.left).toBeGreaterThanOrEqual(0); expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.left+box.width).toBeLessThanOrEqual(width!);
        expect(box.top+box.height).toBeLessThanOrEqual(height!-110);
      }
      for (let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) expect(overlaps(boxes[i]!,boxes[j]!)).toBe(false);
      expect(layout.image.width/layout.image.height).toBeCloseTo(2/3);
    });
  }
}
test("silent ballots keep their whole character above the ledger", () => {
  const {image} = layoutSoloPresentation(390,640,1024,1536,true,180,308,undefined,false,false);
  expect(image.top+image.height).toBeLessThanOrEqual(460);
  expect(image.left+image.width/2).toBeCloseTo(195);
});

test("landscape portrait fallback centers a substantial portrait next to readable speech", () => {
  const { image, bubble, beside } = layoutSoloPresentation(844, 390, 512, 512, false, 140, 220);
  expect(beside).toBe(true);
  expect(image.height).toBeGreaterThan(150);
  expect(bubble.left).toBeGreaterThan(image.left + image.width);
  expect(bubble.top + bubble.height).toBeLessThanOrEqual(250);
  expect(bubble.height).toBeGreaterThan(110);
});

test("a short embedded vote stage keeps a whole speech line above its ledger", () => {
  const { image, bubble, beside } = layoutSoloPresentation(590, 280, 512, 512, false, 110, 120);
  expect(beside).toBe(true);
  expect(image.height).toBeGreaterThan(100);
  expect(bubble.left).toBeGreaterThan(image.left + image.width);
  // Padding, the single-line caption, and the page indicator reserve 84px.
  expect(bubble.height - 84).toBeGreaterThanOrEqual(29);
  expect(bubble.top + bubble.height).toBeLessThanOrEqual(280 - 110);
  expect(bubble.left + bubble.width).toBeLessThanOrEqual(590 - 12);
});

test("mobile portraits and their paged speech are centered above fullscreen controls", () => {
  const { image, bubble, beside } = layoutSoloPresentation(390, 844, 512, 512, false, 140, 1400);
  expect(beside).toBe(false);
  expect(image.height).toBeGreaterThan(250);
  expect(image.top).toBeGreaterThan(12);
  expect(bubble.top).toBeGreaterThan(image.top + image.height);
  expect(bubble.top + bubble.height).toBeLessThanOrEqual(704);
});
