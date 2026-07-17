"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useE2EAuth, useInvite } from "@/app/providers";
import { AgentForm } from "@/app/dashboard/agents/agent-form";
import {
  createAgent,
  getAuthToken,
  getFreeQueueStatus,
  joinFreeQueue,
  listAgents,
  maybeLaterFreeQueue,
  type CreateAgentParams,
  type SavedAgent,
} from "@/lib/api";
import {
  containedFocusTargetIndex,
  DAILY_AGENT_PROMPT_DELAY_MS,
  DAILY_AGENT_RETRY_DELAYS_MS,
  dailyAgentPromptBranch,
  shouldLoadDailyAgentPrompt,
  transitionDailyAgentPromptHandoff,
  type DailyAgentPromptLoadOutcome,
} from "./standing-daily-agent-prompt-model";

const FOCUSABLE_SELECTOR = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export function StandingDailyAgentPrompt({
  immediateHandoffPublicId = null,
  onImmediateHandoffConsumed,
}: {
  immediateHandoffPublicId?: string | null;
  onImmediateHandoffConsumed?: (publicId: string) => void;
}) {
  const { authenticated, ready } = usePrivy();
  const e2e = useE2EAuth();
  const { needsInvite } = useInvite();
  const [agents, setAgents] = useState<SavedAgent[] | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionDismissed, setSessionDismissed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const requestGeneration = useRef(0);
  const immediateHandoffRef = useRef(immediateHandoffPublicId);
  const handoffConsumedCallbackRef = useRef(onImmediateHandoffConsumed);

  const signedIn = (ready && authenticated) || (e2e.ready && e2e.authenticated);

  useEffect(() => {
    handoffConsumedCallbackRef.current = onImmediateHandoffConsumed;
  }, [onImmediateHandoffConsumed]);

  const transitionImmediateHandoff = useCallback((
    outcome: DailyAgentPromptLoadOutcome,
  ) => {
    const transition = transitionDailyAgentPromptHandoff(
      immediateHandoffRef.current,
      outcome,
    );
    immediateHandoffRef.current = transition.nextPublicId;
    if (transition.consumedPublicId !== null) {
      handoffConsumedCallbackRef.current?.(transition.consumedPublicId);
    }
    return transition;
  }, []);

  const load = useCallback(async () => {
    if (!shouldLoadDailyAgentPrompt({
      signedIn,
      needsInvite,
      hasAuthToken: Boolean(getAuthToken()),
      sessionDismissed,
    })) {
      requestGeneration.current += 1;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      setOpen(false);
      setAgents(null);
      setCreating(false);
      setSelectedId("");
      setPending(false);
      setError(null);
      if (!signedIn) setSessionDismissed(false);
      return;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    const generation = ++requestGeneration.current;
    try {
      const status = await getFreeQueueStatus();
      if (generation !== requestGeneration.current) return;
      if (!status.promptEligible) {
        retryAttemptRef.current = 0;
        setOpen(false);
        transitionImmediateHandoff("ineligible");
        return;
      }
      const ownedAgents = await listAgents();
      if (generation !== requestGeneration.current) return;
      retryAttemptRef.current = 0;
      const handoff = transitionImmediateHandoff("eligible");
      setAgents(ownedAgents);
      const openDelay = handoff.openDelayMs ?? DAILY_AGENT_PROMPT_DELAY_MS;
      if (openDelay === 0) {
        setOpen(true);
      } else {
        timerRef.current = window.setTimeout(() => {
          if (generation === requestGeneration.current) setOpen(true);
        }, openDelay);
      }
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      const retryDelay = DAILY_AGENT_RETRY_DELAYS_MS[retryAttemptRef.current];
      if (retryDelay !== undefined) {
        transitionImmediateHandoff("retry");
        retryAttemptRef.current += 1;
        retryTimerRef.current = window.setTimeout(() => { void load(); }, retryDelay);
      } else {
        transitionImmediateHandoff("exhausted");
        console.warn("[StandingDailyAgentPrompt] Failed to load acquisition state:", error);
      }
    }
  }, [needsInvite, sessionDismissed, signedIn, transitionImmediateHandoff]);

  useEffect(() => {
    void load();
    window.addEventListener("auth:session-ready", load);
    window.addEventListener("free-queue:changed", load);
    return () => {
      window.removeEventListener("auth:session-ready", load);
      window.removeEventListener("free-queue:changed", load);
      requestGeneration.current += 1;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    };
  }, [load]);

  const dismissForSession = useCallback(() => {
    setOpen(false);
    setSessionDismissed(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const activeDialog: HTMLElement = dialog;
    const activeElement = document.activeElement as HTMLElement | null;
    if (!activeElement || !activeDialog.contains(activeElement)) {
      previousFocus.current = activeElement;
    }
    getFocusableElements(activeDialog)[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        dismissForSession();
        return;
      }
      if (event.key !== "Tab") return;
      const items = getFocusableElements(activeDialog);
      if (items.length === 0) return;
      const activeIndex = items.indexOf(document.activeElement as HTMLElement);
      const targetIndex = containedFocusTargetIndex(items.length, activeIndex, event.shiftKey);
      if (targetIndex !== null) {
        event.preventDefault();
        items[targetIndex]!.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus.current?.focus();
    };
  }, [dismissForSession, open]);

  useEffect(() => {
    if (!open) return;
    const focusTask = window.setTimeout(() => {
      const dialog = dialogRef.current;
      if (dialog && !dialog.contains(document.activeElement)) {
        getFocusableElements(dialog)[0]?.focus();
      }
    }, 0);
    return () => window.clearTimeout(focusTask);
  }, [creating, open]);

  async function enter(agentId: string) {
    if (!agentId || pending) return;
    setPending(true);
    setError(null);
    try {
      await joinFreeQueue(agentId);
      setOpen(false);
      window.dispatchEvent(new Event("free-queue:changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enter. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function createAndEnter(params: CreateAgentParams) {
    const agent = await createAgent(params);
    setAgents((current) => [...(current ?? []), agent]);
    setSelectedId(agent.id);
    setCreating(false);
    await enter(agent.id);
  }

  async function maybeLater() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await maybeLaterFreeQueue();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (!open || agents === null) return null;
  const promptBranch = dailyAgentPromptBranch(agents.length);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismissForSession();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-agent-title"
        className="influence-panel max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl p-6 shadow-2xl"
      >
        <h2 id="daily-agent-title" className="text-xl font-bold text-text-primary">
          Play for Free
        </h2>

        {creating ? (
          <div className="mt-5">
            <AgentForm
              onSubmit={createAndEnter}
              onCancel={() => setCreating(false)}
              submitLabel="Create and enter"
            />
          </div>
        ) : (
          <>
            <p className="influence-copy mt-2 text-sm">Create an agent for the daily free queue.</p>
            <div className="mt-5 space-y-3">
              {promptBranch === "create" && (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="influence-button-primary w-full rounded-lg px-4 py-3 text-sm font-semibold"
                >
                  Create an agent
                </button>
              )}
              {promptBranch === "single" && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void enter(agents[0]!.id)}
                  className="influence-button-primary w-full rounded-lg px-4 py-3 text-sm font-semibold"
                >
                  {pending ? "Entering…" : `Enter ${agents[0]!.name}`}
                </button>
              )}
              {promptBranch === "choose" && (
                <>
                  <label htmlFor="daily-agent-choice" className="influence-section-title block">
                    Choose an agent
                  </label>
                  <select
                    id="daily-agent-choice"
                    value={selectedId}
                    onChange={(event) => setSelectedId(event.target.value)}
                    className="influence-field w-full rounded-lg px-3 py-2.5 text-sm"
                  >
                    <option value="">Select an agent</option>
                    {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                  </select>
                  <button
                    type="button"
                    disabled={!selectedId || pending}
                    onClick={() => void enter(selectedId)}
                    className="influence-button-primary w-full rounded-lg px-4 py-3 text-sm font-semibold"
                  >
                    {pending ? "Entering…" : "Enter agent"}
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={() => void maybeLater()}
                className="influence-button-secondary w-full rounded-lg px-4 py-2.5 text-sm"
              >
                Maybe later
              </button>
            </div>
          </>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
