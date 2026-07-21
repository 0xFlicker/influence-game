export const PRIVY_PROOF_TIMEOUT_MS = 3_000;

/**
 * Reads an active Privy token without allowing a stalled provider request to
 * block the interactive sign-in fallback indefinitely.
 */
export async function currentPrivyProof(
  getAccessToken: () => Promise<string | null>,
  timeoutMs = PRIVY_PROOF_TIMEOUT_MS,
): Promise<string | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(getAccessToken),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
