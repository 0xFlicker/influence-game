/** Deterministic draws from a SHA-256 digest; callers hash the full semantic seed. */
export function seededRandom(seed: string): () => number {
  const digest = seed.startsWith("sha256:") ? seed.slice("sha256:".length) : seed;
  let state = Number.parseInt(digest.slice(0, 8), 16) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
