/** Allow local generation and server-side queueing to take substantially longer than hosted calls. */
export const DEFAULT_LM_STUDIO_TIMEOUT_MS = 60 * 60 * 1000;

export function lmStudioTimeoutMs(env: Record<string, string | undefined>): number {
  const value = env.INFLUENCE_LM_STUDIO_TIMEOUT_MS;
  if (value === undefined) return DEFAULT_LM_STUDIO_TIMEOUT_MS;
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) {
    throw new Error("INFLUENCE_LM_STUDIO_TIMEOUT_MS must be a positive integer up to 2147483647");
  }
  return timeout;
}
