/** Bound anonymous image decode and render work; no requests wait in memory. */
export class PublicArtworkOverloadedError extends Error {
  constructor() { super("Public artwork renderer is at capacity"); }
}

let active = 0;
const maximum = 4;

export async function withPublicArtworkCapacity<T>(work: () => Promise<T>): Promise<T> {
  if (active >= maximum) throw new PublicArtworkOverloadedError();
  active++;
  try { return await work(); }
  finally { active--; }
}
