"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getAgent,
  getAuthToken,
  getOwnerLearningReview,
  updateAgent,
  type AgentProfileWriteParams,
  type OwnerLearningReview,
  type SavedAgent,
} from "@/lib/api";
import { AgentForm, type StrategyComparison } from "./agent-form";
import { reviewPath } from "./[id]/review/owner-learning-model";

interface AgentEditContentProps {
  agentId: string;
  sourceReviewId?: string;
}

function normalized(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function AgentEditContent({ agentId, sourceReviewId }: AgentEditContentProps) {
  const router = useRouter();
  const [agent, setAgent] = useState<SavedAgent | null>(null);
  const [review, setReview] = useState<OwnerLearningReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchEditor = useCallback((showLoading = true) => {
    if (!getAuthToken()) return;
    if (showLoading) {
      setLoading(true);
      setFetchError(null);
    }
    const reviewRequest = sourceReviewId
      ? getOwnerLearningReview(sourceReviewId, agentId)
      : Promise.resolve(null);
    Promise.all([getAgent(agentId), reviewRequest])
      .then(([nextAgent, nextReview]) => {
        setAgent(nextAgent);
        setReview(nextReview);
      })
      .catch((error) => {
        console.warn("[AgentEditContent] Failed to load editor:", error);
        setFetchError(sourceReviewId
          ? "The Agent or linked strategy review could not be loaded."
          : "The Agent could not be loaded.");
      })
      .finally(() => setLoading(false));
  }, [agentId, sourceReviewId]);

  useEffect(() => {
    const handleSessionReady = () => fetchEditor();
    queueMicrotask(() => fetchEditor(false));
    window.addEventListener("auth:session-ready", handleSessionReady);
    return () => window.removeEventListener("auth:session-ready", handleSessionReady);
  }, [fetchEditor]);

  async function handleUpdate(params: AgentProfileWriteParams) {
    if (!agent) throw new Error("The Agent is no longer loaded.");
    await updateAgent(agentId, {
      ...params,
      ...(agent.profileRevisionId ? { expectedRevisionId: agent.profileRevisionId } : {}),
      ...(sourceReviewId ? { sourceReviewId } : {}),
    });
    router.replace(sourceReviewId ? reviewPath(agentId, sourceReviewId) : "/dashboard/agents");
  }

  const proposal = review?.result?.proposal;
  const reviewInvalid = Boolean(sourceReviewId && (
    !review
    || review.agentProfileId !== agentId
    || review.resolution
    || !proposal
    || normalized(agent?.strategyStyle) !== normalized(proposal.before)
  ));
  const strategyComparison: StrategyComparison | undefined = agent
    ? proposal && !reviewInvalid
      ? {
          baseline: proposal.before,
          initialWorking: proposal.after,
          baselineLabel: "Review baseline",
          requireChange: true,
        }
      : !sourceReviewId
        ? {
            baseline: agent.strategyStyle ?? "",
            initialWorking: agent.strategyStyle ?? "",
            baselineLabel: "Saved Strategy",
          }
        : undefined
    : undefined;
  const cancelPath = sourceReviewId ? reviewPath(agentId, sourceReviewId) : "/dashboard/agents";

  return (
    <div>
      <header className="mb-7 sm:mb-9">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-white/40">
          <Link href="/dashboard" className="transition-colors hover:text-text-primary">Dashboard</Link>
          <span aria-hidden="true">/</span>
          <Link href="/dashboard/agents" className="transition-colors hover:text-text-primary">Agents</Link>
        </nav>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
          {sourceReviewId ? "Edit suggested Strategy" : "Edit Agent"}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">
          {sourceReviewId
            ? "The review suggestion is loaded as your working Strategy. Edit it while the live diff stays visible."
            : "Tune this Agent while comparing Strategy changes with the saved version."}
        </p>
      </header>

      {loading ? (
        <div className="influence-panel animate-pulse rounded-2xl p-8 text-sm text-white/40">Loading Agent editor…</div>
      ) : fetchError ? (
        <section className="rounded-2xl border border-red-400/30 bg-red-400/10 p-6">
          <p className="text-sm text-red-300">{fetchError}</p>
          <div className="mt-4 flex gap-3">
            <button onClick={() => fetchEditor()} className="influence-button-secondary min-h-11 rounded-lg px-4 text-sm">Retry</button>
            <Link href={cancelPath} className="influence-button-secondary inline-flex min-h-11 items-center rounded-lg px-4 text-sm">Return</Link>
          </div>
        </section>
      ) : agent && reviewInvalid ? (
        <section className="influence-panel rounded-2xl p-6 sm:p-8">
          <p className="influence-section-title">Review changed</p>
          <h2 className="mt-3 text-xl font-semibold text-text-primary">This suggestion no longer matches the saved Strategy.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">
            The review may have been resolved or the Agent changed after it was created. Nothing has been overwritten.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href={cancelPath} className="influence-button-primary inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold">Return to review</Link>
            <Link href={`/dashboard/agents/${encodeURIComponent(agentId)}/edit`} className="influence-button-secondary inline-flex min-h-11 items-center rounded-lg px-4 text-sm">Continue as normal edit</Link>
          </div>
        </section>
      ) : agent && strategyComparison ? (
        <AgentForm
          initial={agent}
          strategyComparison={strategyComparison}
          draftScope={sourceReviewId ? `review:${agentId}:${sourceReviewId}` : `edit:${agentId}`}
          onSubmit={handleUpdate}
          onCancel={() => router.replace(cancelPath)}
          submitLabel={sourceReviewId ? "Save strategy update" : "Save changes"}
        />
      ) : (
        <div className="influence-panel rounded-2xl p-8 text-center text-sm text-white/45">Agent not found.</div>
      )}
    </div>
  );
}
