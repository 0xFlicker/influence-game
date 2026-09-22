import { describe, expect, test } from "bun:test";
import { portraitCropFromHead, portraitCropPixels, squarePortraitCrop } from "../character-portrait";

describe("source-coordinate portrait crops", () => {
  test.each([{ width: 1024, height: 1536 }, { width: 1536, height: 1024 }, { width: 512, height: 512 }])("keeps an observed head crop square and inside %p", (size) => {
    const crop = portraitCropFromHead("/body.webp", size, { x: 0.85, y: 0, width: 0.15, height: 0.2 });
    const pixels = portraitCropPixels(crop, size);
    expect(pixels.width).toBe(pixels.height);
    expect(pixels.left + pixels.width).toBeLessThanOrEqual(size.width);
    expect(pixels.top + pixels.height).toBeLessThanOrEqual(size.height);
    expect(crop.x).toBeGreaterThanOrEqual(0);
  });
  test("normalized height reflects the original portrait aspect ratio", () => {
    const crop = squarePortraitCrop("/body.webp", { width: 1000, height: 1500 }, 100, 200, 300);
    expect(crop).toEqual({ sourceUrl: "/body.webp", x: 0.1, y: 200 / 1500, width: 0.3, height: 0.2 });
    expect(portraitCropPixels(crop, { width: 1000, height: 1500 })).toEqual({ left: 100, top: 200, width: 300, height: 300 });
  });
  test.each([{ x: -0.1 }, { width: 0 }, { height: NaN }, { x: 0.9 }, { height: 0.9 }])("rejects invalid exported geometry %p", (change) => {
    expect(() => portraitCropPixels({ sourceUrl: "/body.webp", x: 0, y: 0, width: 0.5, height: 0.5, ...change }, { width: 512, height: 512 })).toThrow();
  });
});
