/** Normalized source coordinates; a square in pixels need not have equal normalized sides. */
export interface PortraitCrop { sourceUrl: string; x: number; y: number; width: number; height: number }
export interface HeadRectangle { x: number; y: number; width: number; height: number }
/** Coordinates refer to the EXIF-normalized original, never the exported portrait. */
export interface CharacterHeadPosition {
  sourceUrl: string;
  sourceHash: string;
  sourceWidth: number;
  sourceHeight: number;
  rect: HeadRectangle;
  /** Assigned by the submission service, never trusted from a client. */
  confirmation?: { userId: string; at: string };
}
export function validHeadRectangle(value: unknown): value is HeadRectangle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as HeadRectangle;
  return Object.keys(r).sort().join(",") === "height,width,x,y"
    && [r.x, r.y, r.width, r.height].every(v => typeof v === "number" && Number.isFinite(v))
    && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0
    && r.x + r.width <= 1 && r.y + r.height <= 1;
}
export function parseCharacterHeadPosition(value: unknown): CharacterHeadPosition {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Confirm a head box inside the full-body image.");
  const h = value as CharacterHeadPosition;
  if (Object.keys(h).some(k => !["sourceUrl", "sourceHash", "sourceWidth", "sourceHeight", "rect", "confirmation"].includes(k))
    || typeof h.sourceUrl !== "string" || !h.sourceUrl || h.sourceUrl.length > 2048
    || typeof h.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(h.sourceHash)
    || !Number.isSafeInteger(h.sourceWidth) || h.sourceWidth <= 0
    || !Number.isSafeInteger(h.sourceHeight) || h.sourceHeight <= 0 || !validHeadRectangle(h.rect)) throw new Error("Invalid head position or source image identity.");
  return { sourceUrl: h.sourceUrl, sourceHash: h.sourceHash, sourceWidth: h.sourceWidth, sourceHeight: h.sourceHeight, rect: { x: h.rect.x, y: h.rect.y, width: h.rect.width, height: h.rect.height } };
}
/** No second localization: derive portrait coordinates only when the entire head is in the crop. */
export function portraitHeadRectangle(head: CharacterHeadPosition, crop: PortraitCrop): HeadRectangle | null {
  const r = head.rect;
  if (head.sourceUrl !== crop.sourceUrl || r.x < crop.x || r.y < crop.y
    || r.x + r.width > crop.x + crop.width || r.y + r.height > crop.y + crop.height) return null;
  return { x: (r.x - crop.x) / crop.width, y: (r.y - crop.y) / crop.height, width: r.width / crop.width, height: r.height / crop.height };
}
export function portraitCropFromHead(sourceUrl: string, size: { width: number; height: number }, head: { x: number; y: number; width: number; height: number }): PortraitCrop {
  const side = Math.min(size.width, size.height, Math.max(head.width * size.width * 1.8, head.height * size.height * 1.5));
  return squarePortraitCrop(sourceUrl, size, (head.x + head.width / 2) * size.width - side / 2,
    (head.y + head.height * 0.65) * size.height - side / 2, side);
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
