/** Authored samples, not wall-clock animation: pause, speed and rewind share the director. */
export const WOLF_TRANSFORM_MS = 3600;
export const WOLF_STAGGER_MS = 240;
export const NIGHT_CLAW_MS = 900;
const switches = [
  {at: 0, wolf: false}, {at: 640, wolf: true},
  {at: 800, wolf: false}, {at: 1280, wolf: true},
  {at: 1600, wolf: false}, {at: 1840, wolf: true},
  {at: 2400, wolf: false}, {at: 2560, wolf: true},
] as const;
export function wolfTransformationFrame(elapsedMs: number, index: number, reduced: boolean) {
  const time = Math.max(0, elapsedMs - index * WOLF_STAGGER_MS);
  if (reduced) return {wolf: time >= 600, wolfOpacity: Math.min(1, time / 600), scale: 1, y: 0, rotate: 0};
  const change = switches.findLast(frame => time >= frame.at)!;
  const since = time - change.at;
  // A damped spring at each discrete switch; first pose and final hold stay still.
  const bounce = change.at === 0 || time >= WOLF_TRANSFORM_MS ? 0 : Math.exp(-since / 150) * Math.sin(since / 55);
  return {wolf: change.wolf, wolfOpacity: change.wolf ? 1 : 0, scale: 1 + .16 * bounce, y: bounce ? -14 * bounce : 0, rotate: bounce ? (index % 2 ? -1 : 1) * 3 * bounce : 0};
}
export function nightClawFrame(elapsedMs: number, reduced: boolean) {
  const time = Math.max(0, elapsedMs);
  return {settled: reduced || time >= NIGHT_CLAW_MS,
    opacity: reduced ? .7 : time < 600 ? 1 : Math.max(0, 1 - (time - 600) / 300),
    strokes: [0, 1, 2].map(index => reduced ? 1 : Math.max(0, Math.min(1, (time - index * 100) / 280)))};
}
