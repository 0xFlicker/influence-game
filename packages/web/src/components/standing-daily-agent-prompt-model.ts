export const DAILY_AGENT_PROMPT_DELAY_MS = 3000;
export const DAILY_AGENT_RETRY_DELAYS_MS = [2000, 5000] as const;

export type DailyAgentPromptLoadOutcome =
  | "eligible"
  | "ineligible"
  | "retry"
  | "exhausted";

export function transitionDailyAgentPromptHandoff(
  publicId: string | null,
  outcome: DailyAgentPromptLoadOutcome,
): {
  nextPublicId: string | null;
  consumedPublicId: string | null;
  openDelayMs: number | null;
} {
  const retained = outcome === "retry";
  return {
    nextPublicId: retained ? publicId : null,
    consumedPublicId: retained ? null : publicId,
    openDelayMs: outcome === "eligible"
      ? publicId === null
        ? DAILY_AGENT_PROMPT_DELAY_MS
        : 0
      : null,
  };
}

export function dailyAgentPromptBranch(agentCount: number): "create" | "single" | "choose" {
  if (agentCount === 0) return "create";
  if (agentCount === 1) return "single";
  return "choose";
}

export function shouldLoadDailyAgentPrompt(input: {
  signedIn: boolean;
  needsInvite: boolean;
  hasAuthToken: boolean;
  sessionDismissed: boolean;
}): boolean {
  return input.signedIn && !input.needsInvite && input.hasAuthToken && !input.sessionDismissed;
}

export function containedFocusTargetIndex(
  itemCount: number,
  activeIndex: number,
  shiftKey: boolean,
): number | null {
  if (itemCount === 0) return null;
  if (activeIndex < 0) return shiftKey ? itemCount - 1 : 0;
  if (shiftKey && activeIndex === 0) return itemCount - 1;
  if (!shiftKey && activeIndex === itemCount - 1) return 0;
  return null;
}
