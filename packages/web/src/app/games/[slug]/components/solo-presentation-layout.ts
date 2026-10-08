import { validHeadRectangle, type HeadRectangle } from "@influence/engine/character-portrait";
import type { SceneFrame } from "./visual-scene-layout";

export function layoutSoloPresentation(width: number, height: number, imageWidth: number, imageHeight: number,
  fullBody: boolean, controlsInset: number, speechHeight: number, head?: HeadRectangle, showSpeech = true) {
  const margin = 12;
  if (!fullBody) {
    const available = Math.max(0, height - controlsInset);
    // A short embedded player needs the speech beside its portrait: stacking
    // would leave less than one readable line after the header and ledger.
    const beside = width >= 760 || (width >= 480 && available < 320);
    const bubbleWidth = Math.max(0, Math.min(480, beside ? width * .43 : width - margin * 2));
    const bubbleHeight = Math.max(0, Math.min(speechHeight, 320, beside ? available - 24 : available * .44));
    const diameter = Math.max(0, Math.min(440, width * (beside ? .32 : .68), beside ? available * .8 : available - bubbleHeight - 56));
    const groupWidth = diameter + 40 + bubbleWidth;
    const image = { width: diameter, height: diameter, left: beside ? (width - groupWidth) / 2 : (width - diameter) / 2,
      top: beside ? (available - diameter) / 2 : Math.max(margin, (available - diameter - bubbleHeight - 24) / 2) };
    const bubble = { left: beside ? image.left + diameter + 40 : (width - bubbleWidth) / 2,
      top: beside ? Math.max(margin, (available - bubbleHeight) / 2) : image.top + diameter + 24,
      width: bubbleWidth, height: bubbleHeight };
    return { image, bubble, above: false, beside, tailLeft: bubbleWidth / 2 };
  }
  const ratio = imageWidth > 0 && imageHeight > 0 ? imageWidth / imageHeight : 2 / 3;
  const available = Math.max(0, height - controlsInset);
  const gap = 20;
  const beside = width >= 760 || (width >= 480 && available < 320);
  const textWidth = Math.max(0, beside ? Math.min(480, width * .46) : width - margin * 2);
  const bubbleHeight = showSpeech ? Math.max(0, Math.min(speechHeight, available * (beside ? .8 : .36))) : 0;
  // In portrait, speech owns the lower area. The ledger is outside both regions.
  const upperHeight = Math.max(0, available - margin * 2 - bubbleHeight - (showSpeech ? gap : 0));
  const artWidth = Math.max(0, beside ? width - margin * 2 - (textWidth + gap) * (showSpeech ? 1 : 0) : width - margin * 2);
  const artHeight = beside ? Math.max(0, available - margin * 2) : upperHeight;
  const h = Math.min(artHeight, artWidth / ratio), w = h * ratio;
  // Center the actual contained portrait and its text as one group. The art
  // column can be much wider than the image on ultrawide screens.
  const textColumns = showSpeech ? 1 : 0;
  const groupLeft = (width - w - textColumns * (textWidth + gap)) / 2;
  const image: SceneFrame = {left: beside ? groupLeft : margin + (artWidth - w) / 2, top: margin + (artHeight - h) / 2, width:w, height:h};
  const bubble = {left: beside ? image.left + w + gap : margin,
    top: beside ? (available - bubbleHeight) / 2 : available - margin - bubbleHeight, width:textWidth, height:bubbleHeight};
  const measured = validHeadRectangle(head) ? head : null;
  const headX = image.left + image.width * (measured ? measured.x + measured.width / 2 : .5);
  return {image, bubble, above:false, beside, tailLeft: Math.max(16, Math.min(textWidth - 16, headX - bubble.left))};
}
