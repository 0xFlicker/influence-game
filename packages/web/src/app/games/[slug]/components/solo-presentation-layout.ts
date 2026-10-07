import { validHeadRectangle, type HeadRectangle } from "@influence/engine/character-portrait";
import type { SceneFrame } from "./visual-scene-layout";

export function layoutSoloPresentation(width: number, height: number, imageWidth: number, imageHeight: number,
  fullBody: boolean, controlsInset: number, speechHeight: number, head?: HeadRectangle, thinking = false, showSpeech = true) {
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
    return { image, bubble, thought: null, above: false, beside, tailLeft: bubbleWidth / 2 };
  }
  const ratio = imageWidth > 0 && imageHeight > 0 ? imageWidth / imageHeight : 2 / 3;
  const available = Math.max(0, height - controlsInset);
  const gap = 20;
  const beside = width >= 760 || (width >= 480 && available < 320);
  const textWidth = Math.max(0, beside ? Math.min(480, width * (thinking ? .3 : .46)) : width - margin * 2);
  const bubbleHeight = showSpeech ? Math.max(0, Math.min(speechHeight, available * (beside ? .8 : .36))) : 0;
  // In portrait, the upper area pairs a smaller character with thinking. Speech
  // owns the full-width lower area. The ledger is outside both regions.
  const upperHeight = Math.max(0, available - margin * 2 - bubbleHeight - (showSpeech ? gap : 0));
  const artWidth = Math.max(0, beside ? width - margin * 2 - textWidth * (thinking ? 2 : showSpeech ? 1 : 0) - gap * (thinking ? 2 : showSpeech ? 1 : 0) : thinking ? width * .34 : width - margin * 2);
  const artHeight = beside ? Math.max(0, available - margin * 2) : upperHeight;
  const h = Math.min(artHeight, artWidth / ratio), w = h * ratio;
  const artLeft = beside && thinking ? margin + textWidth + gap : margin;
  const image: SceneFrame = {left: artLeft + (artWidth - w) / 2, top: margin + (artHeight - h) / 2, width:w, height:h};
  const bubble = {left: beside ? width - margin - textWidth : margin,
    top: beside ? (available - bubbleHeight) / 2 : available - margin - bubbleHeight, width:textWidth, height:bubbleHeight};
  const thought = thinking ? {left:beside ? margin : margin + artWidth + gap, top:margin,
    width:beside ? textWidth : Math.max(0,width - margin * 2 - artWidth - gap), height:Math.min(220,beside ? available * .65 : upperHeight)} : null;
  const measured = validHeadRectangle(head) ? head : null;
  const headX = image.left + image.width * (measured ? measured.x + measured.width / 2 : .5);
  return {image, bubble, thought, above:false, beside, tailLeft: Math.max(16, Math.min(textWidth - 16, headX - bubble.left))};
}
