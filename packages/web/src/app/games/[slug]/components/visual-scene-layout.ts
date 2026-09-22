/** Fit the image and complete speech inside the available watch frame. */
export function layoutVisualScene({ width, height, bubbleHeight, head }: {
  width: number; height: number; bubbleHeight: number;
  head?: { x: number; y: number; width: number; height: number };
}) {
  const gap = 16;
  const margin = 12;
  const anchored = Boolean(head && width >= 768);
  const bubbleWidth = anchored ? Math.min(width - margin * 2, Math.max(300, Math.min(480, width * .4))) : Math.max(0, width - margin * 2);
  const headY = Math.max(0, Math.min(.95, head?.y ?? 0));
  const headBottom = Math.max(headY, Math.min(1, headY + (head?.height ?? 0)));
  const imageLimit = width * 9 / 16;
  // Tiny screens may need one outer scroll; speech itself is never truncated.
  const minimumImage = Math.min(96, imageLimit);
  const naturalHeight = Math.max(minimumImage, Math.min(imageLimit, height));
  const fitsAbove = bubbleHeight <= headY * naturalHeight - gap - margin;
  const fitsBelow = bubbleHeight <= height - headBottom * naturalHeight - gap - margin;
  const below = anchored && !fitsAbove && fitsBelow;
  const fitHeight = bubbleHeight === 0 ? height : anchored
    ? below ? naturalHeight : (height - bubbleHeight - gap - margin) / (1 - headY)
    : height - bubbleHeight - gap - margin;
  const imageHeight = Math.max(minimumImage, Math.min(imageLimit, height, fitHeight));
  const imageWidth = imageHeight * 16 / 9;
  const imageLeft = (width - imageWidth) / 2;
  const imageTop = anchored && !below && bubbleHeight > 0 ? Math.max(0, bubbleHeight + gap + margin - headY * imageHeight) : 0;
  const headX = imageLeft + ((head?.x ?? .5) + (head?.width ?? 0) / 2) * imageWidth;
  const bubbleLeft = anchored ? Math.max(margin, Math.min(width - bubbleWidth - margin, headX - bubbleWidth / 2)) : margin;
  const bubbleTop = anchored ? below ? headBottom * imageHeight + gap : imageTop + headY * imageHeight - gap - bubbleHeight : imageHeight + gap;
  return { anchored, below, bubbleWidth, bubbleLeft, bubbleTop,
    arrowLeft: Math.max(12, Math.min(bubbleWidth - 20, headX - bubbleLeft - 4)),
    imageWidth, imageHeight, imageLeft, imageTop,
    contentHeight: Math.max(imageTop + imageHeight, bubbleHeight > 0 ? bubbleTop + bubbleHeight + margin : 0),
  };
}
