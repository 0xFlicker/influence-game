/** Timeline geometry only. Player remains the sole playback clock. */
export function boundedFrame(frame: number, duration: number): number {
  return Math.max(0, Math.min(Math.max(0, duration - 1), Math.round(Number.isFinite(frame) ? frame : 0)));
}
export function framePixel(frame: number, duration: number, contentWidth: number): number {
  return duration > 0 ? boundedFrame(frame, duration) / duration * contentWidth : 0;
}
export function pixelFrame(pixel: number, duration: number, contentWidth: number): number {
  return contentWidth > 0 ? boundedFrame(pixel / contentWidth * duration, duration) : 0;
}
export function boundedScroll(left: number, contentWidth: number, viewportWidth: number): number {
  return Math.max(0, Math.min(Math.max(0, contentWidth - viewportWidth), left));
}
export function centeredScroll(frame: number, duration: number, contentWidth: number, viewportWidth: number): number {
  return boundedScroll(framePixel(frame, duration, contentWidth) - viewportWidth / 2, contentWidth, viewportWidth);
}
export function visibleScroll(frame: number, duration: number, contentWidth: number, viewportWidth: number, left: number): number {
  const pixel = framePixel(frame, duration, contentWidth), padding = Math.min(24, viewportWidth * .1);
  return pixel < left + padding || pixel > left + viewportWidth - padding ? centeredScroll(frame, duration, contentWidth, viewportWidth) : left;
}
/** Page playback forward; leave roughly 80% of the visible window ahead. */
export function playbackScroll(frame: number, duration: number, contentWidth: number, viewportWidth: number, left: number): number {
  const pixel = framePixel(frame, duration, contentWidth);
  if (pixel >= left + viewportWidth * .9) return boundedScroll(pixel - viewportWidth * .2, contentWidth, viewportWidth);
  if (pixel < left) return boundedScroll(pixel - viewportWidth * .2, contentWidth, viewportWidth);
  return left;
}
/** Signed CSS pixels/sec, only while a pointer drag is active. */
export function edgeScrollSpeed(clientX: number, left: number, width: number): number {
  const edge = Math.min(48, width / 4), x = clientX - left;
  if (edge <= 0) return 0;
  if (x < edge) return -Math.min(1, (edge - x) / edge) * 600;
  if (x > width - edge) return Math.min(1, (x - width + edge) / edge) * 600;
  return 0;
}
export function maximumZoom(duration: number, fps: number): number {return Math.max(8, Math.min(4096, duration / Math.max(1, fps * 2)));}
export function wheelPixels(delta: number, mode: number, viewportWidth: number): number {return delta * (mode === 1 ? 16 : mode === 2 ? viewportWidth : 1);}
