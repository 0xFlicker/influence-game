type VerificationPrompt = (nextAvailableAt?: string, notice?: string) => Promise<string>;
let prompt: VerificationPrompt | null = null;
let pending = 0;
const listeners = new Set<() => void>();
export const signupProofPending = () => pending > 0;
export const subscribeSignupProof = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
function changePending(delta: number) {
  pending += delta;
  for (const listener of listeners) listener();
}
let campaign: Promise<unknown> | null = null;

export function installSignupPrompt(handler: VerificationPrompt) {
  prompt = handler;
  return () => { if (prompt === handler) prompt = null; };
}

export function askForSignupVerification(nextAvailableAt?: string, notice?: string) {
  if (!prompt) return Promise.reject(new Error("Human verification is unavailable. Reload and try again."));
  changePending(1);
  return prompt(nextAvailableAt, notice).finally(() => changePending(-1));
}

export function registerCampaignRedemption(result: Promise<unknown>) {
  campaign = result;
  const clear = () => { if (campaign === result) campaign = null; };
  void result.then(clear, clear);
}

export async function waitForCampaignRedemption() {
  try { await campaign; } catch { /* The ordinary signup bucket is still available. */ }
}
