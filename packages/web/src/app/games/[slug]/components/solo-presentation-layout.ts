import type { SceneFrame } from "./visual-scene-layout";

/** Only the single-person, upright full-body references use this legacy fallback.
 * It is a conservative head region, not localization evidence for room images.
 */
export const FULL_BODY_HEAD_REGION_BOTTOM = 0.22;

export function layoutSoloPresentation(width: number, height: number, imageWidth: number, imageHeight: number,
  fullBody: boolean, controlsInset: number, speechHeight: number) {
  const margin = 12;
  const ratio = imageWidth > 0 && imageHeight > 0 ? imageWidth / imageHeight : 2 / 3;
  // Fill the player vertically. Wide frames get black side bars; narrow frames
  // trim only the sides, keeping the full height of the standing character.
  const h = fullBody ? height : Math.min(256, height * 0.22, width - margin * 2);
  const w = fullBody ? h * ratio : Math.min(256, width - margin * 2, h);
  const image: SceneFrame = { width: Math.max(0, w), height: Math.max(0, h), left: (width - w) / 2, top: fullBody ? 0 : margin };
  const bubbleWidth = Math.max(0, Math.min(480, width - margin * 2));
  const top = image.top + image.height * (fullBody ? FULL_BODY_HEAD_REGION_BOTTOM : 1) + 16;
  const available = Math.max(0, height - controlsInset - margin - top);
  return { image, bubble: { left: (width - bubbleWidth) / 2, top, width: bubbleWidth,
    height: Math.min(speechHeight, 320, available) } };
}
