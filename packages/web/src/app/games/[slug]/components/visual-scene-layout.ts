export interface SceneFrame { width: number; height: number; left: number; top: number }
export interface HeadRect { x: number; y: number; width: number; height: number }
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Saved normalized head coordinates are valid only for this loaded image. */
export function frameVisualScene(width: number, height: number, imageWidth: number, imageHeight: number, head?: HeadRect): SceneFrame {
  if (width <= 0 || height <= 0 || imageWidth <= 0 || imageHeight <= 0) return { width: 0, height: 0, left: 0, top: 0 };
  const crop = Boolean(head) && width / height < imageWidth / imageHeight;
  const scale = (crop ? Math.max : Math.min)(width / imageWidth, height / imageHeight);
  const w = imageWidth * scale, h = imageHeight * scale;
  return { width: w, height: h,
    left: crop && head ? clamp(width / 2 - (head.x + head.width / 2) * w, width - w, 0) : (width - w) / 2,
    top: crop && head ? clamp(height * .45 - (head.y + head.height / 2) * h, height - h, 0) : (height - h) / 2 };
}

export function panScene(from: SceneFrame, to: SceneFrame, elapsedMs: number): SceneFrame {
  const t = clamp(elapsedMs / 450, 0, 1);
  const eased = t * t * (3 - 2 * t);
  return { width: to.width, height: to.height, left: from.left + (to.left - from.left) * eased, top: from.top + (to.top - from.top) * eased };
}

/** Prefer above, then below. Page capacity leaves the complete head unobscured. */
export function placeSceneBubble(width: number, height: number, image: SceneFrame, head?: HeadRect, speechHeight = 220) {
  const margin = 12, gap = 16;
  const bubbleWidth = Math.max(0, Math.min(480, width - margin * 2));
  const x = head ? image.left + (head.x + head.width / 2) * image.width : width / 2;
  const top = head ? image.top + head.y * image.height : 0;
  const bottom = head ? top + head.height * image.height : 0;
  const aboveSpace = Math.max(0, top - gap - margin);
  const belowSpace = Math.max(0, height - bottom - gap - margin);
  const preferredHeight = Math.min(speechHeight, 220, height * .45);
  const below = !head || (aboveSpace < preferredHeight && belowSpace > aboveSpace);
  const available = head ? (below ? belowSpace : aboveSpace) : height - margin * 2;
  const bubbleHeight = Math.max(0, Math.min(preferredHeight, available));
  const left = clamp(x - bubbleWidth / 2, margin, width - bubbleWidth - margin);
  return { width: bubbleWidth, height: bubbleHeight, left,
    top: head ? below ? bottom + gap : top - gap - bubbleHeight : margin,
    below, arrowLeft: clamp(x - left - 4, 12, bubbleWidth - 20) };
}
