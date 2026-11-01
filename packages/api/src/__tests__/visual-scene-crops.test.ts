import { expect, test } from "bun:test";
import sharp from "sharp";
import { cropVisualScene, splitVisualBackground } from "../services/visual-scene-crops";
import { assertVisualShot, type VisualPlayerAnchor } from "@influence/engine/visual-mode";

test("close shots partition unique source pixels and transform verified heads", async () => {
  const width = 900, height = 400;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[(y * width + x) * 3 + Math.floor(x / 300)] = 255;
  const image = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const anchors: VisualPlayerAnchor[] = Array.from({ length: 12 }, (_, i) => ({ playerId: `p${i}`, label: i + 1, confidence: "clear", head: { x: (i + .2) / 12, y: .2, width: .04, height: .1 } }));
  const crops = await cropVisualScene(image, anchors);
  expect(crops).toHaveLength(3);
  expect(new Set(crops.map(c => c.image.toString("base64"))).size).toBe(3);
  expect(crops.reduce((n, c) => n + c.width, 0)).toBe(width);
  expect(crops.flatMap(c => c.anchors.map(a => a.playerId)).sort()).toEqual(anchors.map(a => a.playerId).sort());
  for (const crop of crops) {
    const ids = crop.anchors.map(a => a.playerId);
    assertVisualShot({ participantIds: ids, visibleParticipantIds: ids, anchors: crop.anchors, pointers: [] }, anchors.map(a => a.playerId));
    const actual = await sharp(crop.image).raw().toBuffer();
    const expected = await sharp(image).extract({ left: crop.left, top: 0, width: crop.width, height }).raw().toBuffer();
    expect(actual.equals(expected)).toBe(true);
    for (const a of crop.anchors) expect((a.head.x * crop.width + crop.left) / width).toBeCloseTo(anchors.find(original => original.playerId === a.playerId)!.head.x, 10);
  }
});

test("overlapping heads never get sliced or assigned fabricated positions", async () => {
  const image = await sharp({ create: { width: 900, height: 400, channels: 3, background: "white" } }).png().toBuffer();
  const anchors: VisualPlayerAnchor[] = Array.from({ length: 6 }, (_, i) => ({ playerId: `p${i}`, label: i + 1, confidence: "clear", head: { x: .3, y: i / 6, width: .2, height: .05 } }));
  expect(await cropVisualScene(image, anchors)).toEqual([]);
});

test("room references are non-overlapping unique crops of the wide background", async () => {
  const pixels = Buffer.alloc(3072 * 1536 * 3);
  for (let y = 0; y < 1536; y++) for (let x = 0; x < 3072; x++) pixels[(y * 3072 + x) * 3 + Math.floor(x / 1024)] = 255;
  const background = await sharp(pixels, { raw: { width: 3072, height: 1536, channels: 3 } }).png().toBuffer();
  const crops = await splitVisualBackground(background, 3);
  expect(crops.map(c => [c.left, c.width])).toEqual([[0, 1024], [1024, 1024], [2048, 1024]]);
  expect(new Set(crops.map(c => c.image.toString("base64"))).size).toBe(3);
  for (const crop of crops) {
    const expected = await sharp(background).extract({ left: crop.left, top: 0, width: crop.width, height: crop.height }).raw().toBuffer();
    expect((await sharp(crop.image).raw().toBuffer()).equals(expected)).toBe(true);
  }
});
