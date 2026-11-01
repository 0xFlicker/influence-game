import type { SyntheticEvent } from "react";

// Per DOM image, not a permanent URL blacklist. Remounting may try again.
const attempted = new WeakMap<HTMLImageElement, string>();

/** img.onerror has no HTTP status. Only a verified 404 permits replacement. */
export async function characterImageError(event: SyntheticEvent<HTMLImageElement>, missing: () => void): Promise<void> {
  const image = event.currentTarget;
  const source = image.src;
  if (attempted.get(image) === source) return;
  attempted.set(image, source);
  let absent = false;
  try {
    const response = await fetch(source, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(10_000) });
    absent = response.status === 404;
  } catch {
    // A failed status probe is not evidence that an image is missing.
    absent = false;
  }
  if (!image.isConnected || image.src !== source) return;
  if (absent) { missing(); return; }
  // One retry of the same image. Never replace it after a network/decode failure.
  setTimeout(() => { if (image.isConnected && image.src === source) image.src = source; }, 1_000);
}
