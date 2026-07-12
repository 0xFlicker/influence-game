"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getAgentAvatarGenerations,
  getAuthToken,
  listAgents,
  requestAgentAvatarGeneration,
  type AvatarCompletion,
} from "@/lib/api";
import { isAvatarCompletionPending } from "@/app/dashboard/agents/avatar-completion";

interface AvatarGenerationNotice {
  agentId: string;
  agentName: string;
  completion: AvatarCompletion;
}

const POLL_DELAY_MS = 2_500;
const MAX_CONSECUTIVE_POLL_FAILURES = 3;

export function AvatarGenerationActivity() {
  const [notices, setNotices] = useState<Record<string, AvatarGenerationNotice>>({});
  const pollFailures = useRef(0);
  const hydrationGeneration = useRef(0);

  useEffect(() => {
    function handleGeneration(event: Event) {
      const detail = (event as CustomEvent<AvatarGenerationNotice>).detail;
      if (!detail?.agentId || !detail.completion) return;
      setNotices((current) => ({ ...current, [detail.agentId]: detail }));
    }
    window.addEventListener("agent-avatar:generation", handleGeneration);
    return () => window.removeEventListener("agent-avatar:generation", handleGeneration);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      if (!getAuthToken()) return;
      const generation = ++hydrationGeneration.current;
      try {
        const agents = await listAgents();
        if (cancelled || generation !== hydrationGeneration.current) return;
        setNotices((current) => {
          const next = { ...current };
          for (const agent of agents) {
            if (agent.avatarCompletion && isAvatarCompletionPending(agent.avatarCompletion)) {
              next[agent.id] = {
                agentId: agent.id,
                agentName: agent.name,
                completion: agent.avatarCompletion,
              };
            }
          }
          return next;
        });
        const queuedAgents = agents.filter((agent) => agent.avatarCompletion?.status === "accepted");
        await Promise.all(queuedAgents.map(async (agent) => {
          try {
            const result = await requestAgentAvatarGeneration(agent.id);
            if (!cancelled && generation === hydrationGeneration.current) {
              setNotices((current) => current[agent.id]
                ? {
                    ...current,
                    [agent.id]: { ...current[agent.id], completion: result.avatarCompletion },
                  }
                : current);
            }
          } catch (error) {
            console.warn(`[AvatarGenerationActivity] Failed to resume portrait for ${agent.id}:`, error);
          }
        }));
      } catch (error) {
        console.warn("[AvatarGenerationActivity] Failed to restore portrait status:", error);
      }
    };

    const handleSessionReady = () => {
      hydrationGeneration.current += 1;
      pollFailures.current = 0;
      setNotices({});
      void hydrate();
    };
    const handleSessionCleared = () => {
      hydrationGeneration.current += 1;
      pollFailures.current = 0;
      setNotices({});
    };

    void hydrate();
    window.addEventListener("auth:session-ready", handleSessionReady);
    window.addEventListener("auth:expired", handleSessionCleared);
    window.addEventListener("auth:session-cleared", handleSessionCleared);
    return () => {
      cancelled = true;
      hydrationGeneration.current += 1;
      window.removeEventListener("auth:session-ready", handleSessionReady);
      window.removeEventListener("auth:expired", handleSessionCleared);
      window.removeEventListener("auth:session-cleared", handleSessionCleared);
    };
  }, []);

  const activeKey = useMemo(() => Object.values(notices)
    .filter((notice) => isAvatarCompletionPending(notice.completion))
    .map((notice) => notice.agentId)
    .sort()
    .join(","), [notices]);

  useEffect(() => {
    if (!activeKey) return;
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const result = await getAgentAvatarGenerations(activeKey.split(","));
        if (cancelled) return;
        pollFailures.current = 0;
        setNotices((current) => {
          const next = { ...current };
          for (const [agentId, completion] of Object.entries(result.avatarCompletions)) {
            if (next[agentId]) next[agentId] = { ...next[agentId], completion };
          }
          return next;
        });
      } catch (error) {
        if (cancelled) return;
        pollFailures.current += 1;
        console.warn("[AvatarGenerationActivity] Failed to read portrait status:", error);
        if (pollFailures.current >= MAX_CONSECUTIVE_POLL_FAILURES) {
          setNotices((current) => Object.fromEntries(Object.entries(current).map(([agentId, notice]) => [
            agentId,
            isAvatarCompletionPending(notice.completion)
              ? {
                  ...notice,
                  completion: {
                    status: "failed" as const,
                    reason: "Portrait status could not be refreshed.",
                    retryable: true,
                  },
                }
              : notice,
          ])));
          return;
        }
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), POLL_DELAY_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeKey]);

  const orderedNotices = Object.values(notices);
  if (orderedNotices.length === 0) return null;

  return (
    <aside
      aria-label="Portrait generation activity"
      className="fixed bottom-4 right-4 z-[110] grid w-[min(22rem,calc(100vw-2rem))] gap-2"
    >
      {orderedNotices.map((notice) => {
        const pending = isAvatarCompletionPending(notice.completion);
        return (
          <div
            key={notice.agentId}
            role="status"
            aria-live="polite"
            className="influence-modal rounded-xl border border-white/10 p-4 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              {pending ? (
                <span className="mt-0.5 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-accent/30 border-t-accent" aria-hidden="true" />
              ) : (
                <span className="text-accent" aria-hidden="true">{notice.completion.status === "completed" ? "✓" : "!"}</span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-primary">
                  {pending ? "Generating portrait" : notice.completion.status === "completed" ? "Portrait ready" : "Portrait not generated"}
                </p>
                <p className="mt-0.5 text-xs influence-copy-muted">
                  {notice.agentName}: {avatarActivityMessage(notice.completion)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNotices((current) => {
                  const next = { ...current };
                  delete next[notice.agentId];
                  return next;
                })}
                className="influence-copy-muted hover:text-text-primary text-lg leading-none"
                aria-label={`Dismiss portrait status for ${notice.agentName}`}
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
    </aside>
  );
}

function avatarActivityMessage(completion: AvatarCompletion): string {
  if (isAvatarCompletionPending(completion)) return "Image generation is in progress. You can keep using Influence.";
  if (completion.status === "completed") return "Your generated portrait has been added.";
  return completion.reason ?? "Image generation could not be completed.";
}
