import sharp from "sharp";
import type { VisualPlayerAnchor } from "@influence/engine/visual-mode";

/** Crop one wide room into non-overlapping regions before placing any contestants. */
export async function splitVisualBackground(image: Buffer, count: number) {
  if (!Number.isInteger(count) || count < 2 || count > 4) throw new Error("Expected two to four room regions");
  const width = 3072, height = 1536;
  const panorama = await sharp(image).resize(width, height, { fit: "cover" }).png().toBuffer();
  return Promise.all(Array.from({ length: count }, async (_, index) => {
    const left = index * width / count, cropWidth = width / count;
    return { image: await sharp(panorama).extract({ left, top: 0, width: cropWidth, height }).png().toBuffer(), left, width: cropWidth, height };
  }));
}

/** Partition the actual panorama pixels at gaps between observed heads, never intended seats. */
export async function cropVisualScene(image: Buffer, anchors: readonly VisualPlayerAnchor[]) {
  const { width, height } = await sharp(image).metadata();
  if (!width || !height) throw new Error("Scene dimensions are unavailable");
  if (anchors.length <= 4) return [];
  const ordered = [...anchors].sort((a, b) => a.head.x - b.head.x);
  const gaps: number[] = [];
  let right = 0;
  for (const [index, anchor] of ordered.entries()) {
    const left = Math.floor(anchor.head.x * width);
    if (index && left - right >= 2) gaps.push(Math.floor((left + right) / 2));
    right = Math.max(right, Math.ceil((anchor.head.x + anchor.head.width) * width));
  }
  const count = Math.ceil(anchors.length / 4);
  const boundaries = new Set<number>([0, width]);
  for (let index = 1; index < count; index++) {
    const target = index * width / count;
    const nearest = gaps.toSorted((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
    if (nearest !== undefined) boundaries.add(nearest);
  }
  const edges = [...boundaries].sort((a, b) => a - b);
  if (edges.length === 2) return []; // Overlapping heads cannot safely define separate vertical shots.
  return Promise.all(edges.slice(0, -1).map(async (left, index) => {
    const cropWidth = edges[index + 1]! - left;
    const visible = ordered.filter(a => a.head.x * width >= left && (a.head.x + a.head.width) * width <= left + cropWidth);
    return {
      image: await sharp(image).extract({ left, top: 0, width: cropWidth, height }).png().toBuffer(),
      anchors: visible.map((a, i) => ({ ...a, label: i + 1, head: { ...a.head, x: (a.head.x * width - left) / cropWidth, width: a.head.width * width / cropWidth } })),
      left, width: cropWidth, height,
    };
  }));
}
