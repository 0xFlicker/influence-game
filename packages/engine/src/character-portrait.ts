/** Normalized source coordinates; a square in pixels need not have equal normalized sides. */
export interface PortraitCrop { sourceUrl: string; x: number; y: number; width: number; height: number }
export function portraitCropFromHead(sourceUrl: string, size: { width: number; height: number }, head: { x: number; y: number; width: number; height: number }): PortraitCrop {
  const side = Math.min(size.width, size.height, Math.max(head.width * size.width * 2.2, head.height * size.height * 1.8));
  return squarePortraitCrop(sourceUrl, size, (head.x + head.width / 2) * size.width - side / 2,
    (head.y + head.height * 0.8) * size.height - side / 2, side);
}
export function squarePortraitCrop(sourceUrl: string, size: { width: number; height: number }, left: number, top: number, pixels: number): PortraitCrop {
  const side = Math.max(1, Math.min(pixels, size.width, size.height));
  return { sourceUrl, x: Math.max(0, Math.min(left, size.width - side)) / size.width,
    y: Math.max(0, Math.min(top, size.height - side)) / size.height, width: side / size.width, height: side / size.height };
}
export function portraitCropPixels(crop: PortraitCrop, size: { width: number; height: number }) {
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite)
    || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0
    || crop.x + crop.width > 1.000001 || crop.y + crop.height > 1.000001
    || Math.abs(crop.width * size.width - crop.height * size.height) > 1.5) throw new Error("Choose a square crop inside the source image");
  const left = Math.round(crop.x * size.width), top = Math.round(crop.y * size.height);
  const side = Math.min(Math.round(crop.width * size.width), size.width - left, size.height - top);
  if (side < 1) throw new Error("The portrait crop is too small");
  return { left, top, width: side, height: side };
}
