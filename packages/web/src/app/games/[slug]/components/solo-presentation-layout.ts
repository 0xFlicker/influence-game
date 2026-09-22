import { validHeadRectangle, type HeadRectangle } from "@influence/engine/character-portrait";
import type { SceneFrame } from "./visual-scene-layout";

/** Only the single-person, upright full-body references use this legacy fallback.
 * It is a conservative head region, not localization evidence for room images.
 */
export const FULL_BODY_HEAD_REGION_BOTTOM = 0.22;

export function layoutSoloPresentation(width: number, height: number, imageWidth: number, imageHeight: number,
  fullBody: boolean, controlsInset: number, speechHeight: number, head?: HeadRectangle) {
  const margin = 12;
  const ratio = imageWidth > 0 && imageHeight > 0 ? imageWidth / imageHeight : 2 / 3;
  // Fill the player vertically. Wide frames get black side bars; narrow frames
  // trim only the sides, keeping the full height of the standing character.
  const h = fullBody ? height : Math.min(256, height * 0.22, width - margin * 2);
  const w = fullBody ? h * ratio : Math.min(256, width - margin * 2, h);
  const image: SceneFrame = { width: Math.max(0, w), height: Math.max(0, h), left: (width - w) / 2, top: fullBody ? 0 : margin };
  const bubbleWidth = Math.max(0, Math.min(480, width - margin * 2));
  const measured = fullBody && validHeadRectangle(head) ? head : null;
  // Keep a known head on-screen when the portrait-shaped image is wider than the frame.
  if (measured && image.width > width) image.left = Math.max(width - image.width, Math.min(0, width / 2 - image.width * (measured.x + measured.width / 2)));
  const headX = measured ? image.left + image.width * (measured.x + measured.width / 2) : width / 2;
  const below = image.top + image.height * (fullBody ? measured ? measured.y + measured.height : FULL_BODY_HEAD_REGION_BOTTOM : 1) + 16;
  const upperRoom = measured ? Math.max(0, Math.min(height - controlsInset - margin, image.top + image.height * measured.y - 16) - margin) : 0;
  const lowerRoom = Math.max(0, height - controlsInset - margin - below);
  const above = Boolean(measured && lowerRoom < Math.min(speechHeight, 160) && upperRoom > lowerRoom);
  const bubbleHeight = Math.min(speechHeight, 320, above ? upperRoom : lowerRoom);
  const top = above ? margin + upperRoom - bubbleHeight : below;
  const left = Math.max(margin, Math.min(width - margin - bubbleWidth, headX - bubbleWidth / 2));
  return { image, above, tailLeft: Math.max(16, Math.min(bubbleWidth - 16, headX - left)), bubble: { left, top, width: bubbleWidth,
    height: bubbleHeight } };
}
