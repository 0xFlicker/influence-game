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
import {
  agentPreparationHref,
  type AgentEntryIntent,
} from "@/lib/agent-entry";
import styles from "./agent-workspace.module.css";
import { AgentForm, type StrategyComparison } from "./agent-form";
import { AgentIssueNotice, useAgentIssue } from "./agent-issue";
import { managementReturnPath } from "./agent-management-navigation";
import { reviewPath } from "./[id]/review/owner-learning-model";

interface AgentEditContentProps {
  returnTo?: string;
  agentId: string;
  imageRequest?: string;
  sourceReviewId?: string;
  profileRequest?: boolean;
  intent?: AgentEntryIntent;
}

function normalized(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function AgentEditContent({
  returnTo,
  imageRequest,
  agentId,
  sourceReviewId,
  profileRequest = false,
  intent,
}: AgentEditContentProps) {
  const router = useRouter();
  const collectionPath = managementReturnPath(returnTo);
  const [guided, setGuided] = useState(profileRequest);
  const [agent, setAgent] = useState<SavedAgent | null>(null);
  const [review, setReview] = useState<OwnerLearningReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useAgentIssue("load");

  const fetchEditor = useCallback(
    (showLoading = true) => {
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
          setAgent({
            ...nextAgent,
            voiceId: nextAgent.ownerContent?.voiceId ?? nextAgent.voiceId,
            ...nextAgent.ownerContent?.submitted?.content,
          });
          setReview(nextReview);
        })
        .catch((error) => {
          console.warn("[AgentEditContent] Failed to load editor:", error);
          setFetchError(error);
        })
        .finally(() => setLoading(false));
    },
    [agentId, sourceReviewId, setFetchError],
  );

  useEffect(() => {
    const handleSessionReady = () => fetchEditor();
    queueMicrotask(() => fetchEditor(false));
    window.addEventListener("auth:session-ready", handleSessionReady);
    return () =>
      window.removeEventListener("auth:session-ready", handleSessionReady);
  }, [fetchEditor]);

  async function handleUpdate(params: AgentProfileWriteParams) {
    if (!agent) throw new Error("The Agent is no longer loaded.");
    const saved = await updateAgent(agentId, {
      ...params,
      ...(intent && intent.flow !== "update" ? { entryIntent: intent } : {}),
      ...(agent.profileRevisionId
        ? { expectedRevisionId: agent.profileRevisionId }
        : {}),
      ...(sourceReviewId ? { sourceReviewId } : {}),
    });

    router.replace(
      intent ? agentPreparationHref(agentId, intent)
        : sourceReviewId && saved.receipt?.publication === "published"
          ? reviewPath(agentId, sourceReviewId)
          : collectionPath,
    );
    return saved;
  }

  const proposal = review?.result?.proposal;
  const reviewInvalid = Boolean(
    sourceReviewId &&
      (!review ||
        review.agentProfileId !== agentId ||
        review.resolution ||
        !proposal ||
        review.applyDisposition !== "available" ||
        normalized(agent?.[proposal.field]) !== normalized(proposal.before)),
  );
  const strategyComparison: StrategyComparison | undefined = agent
    ? proposal && !reviewInvalid
      ? {
          field: proposal.field,
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
  const cancelPath = sourceReviewId
    ? reviewPath(agentId, sourceReviewId)
    : intent
      ? agentPreparationHref(agentId, intent)
      : collectionPath;

  return (
    <div>
      <header className="mx-auto w-full max-w-[1440px] px-5 py-3">
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-2 text-sm text-white/40"
        >
          <Link
            href="/dashboard"
            className="transition-colors hover:text-text-primary"
          >
            Dashboard
          </Link>
          <span aria-hidden="true">/</span>
          <Link
            href={collectionPath}
            className="transition-colors hover:text-text-primary"
          >
            Agents
          </Link>
        </nav>
        {sourceReviewId && (
          <p className="mt-2 text-sm text-white/60">
            Edit the suggested strategy, then review the complete submission.
          </p>
        )}
      </header>

      {loading ? (
        <div className={styles.editorSkeleton}>Loading Agent editor…</div>
      ) : fetchError ? (
        <section className="rounded-2xl border border-red-400/30 bg-red-400/10 p-6">
          <AgentIssueNotice
            issue={fetchError}
            onAction={() => fetchEditor()}
            agentId={agentId}
          />
          <div className="mt-4 flex gap-3">
            <Link
              href={cancelPath}
              className="influence-button-secondary inline-flex min-h-11 items-center rounded-lg px-4 text-sm"
            >
              Return
            </Link>
          </div>
        </section>
      ) : agent?.ownerContent?.availability === "archived" ? (
        <section className="influence-panel rounded-2xl p-6" role="status">
          <h2 className="text-xl font-semibold">Archived character</h2>
          <p className="mt-2 text-sm text-white/60">
            An admin can restore this character. Its saved content and game
            history are retained.
          </p>
          <Link
            href="/dashboard/agents"
            className="influence-link mt-4 inline-block"
          >
            Return to agents
          </Link>
        </section>
      ) : agent && reviewInvalid ? (
        <section className="influence-panel rounded-2xl p-6 sm:p-8">
          <p className="influence-section-title">Review changed</p>
          <h2 className="mt-3 text-xl font-semibold text-text-primary">
            This suggestion no longer matches the saved Strategy.
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">
            The review may have been resolved or the Agent changed after it was
            created. Nothing has been overwritten.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href={cancelPath}
              className="influence-button-primary inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold"
            >
              Return to review
            </Link>
            <Link
              href={`/dashboard/agents/${encodeURIComponent(agentId)}/edit`}
              className="influence-button-secondary inline-flex min-h-11 items-center rounded-lg px-4 text-sm"
            >
              Continue as normal edit
            </Link>
          </div>
        </section>
      ) : agent && strategyComparison ? (
        <div>
          <AgentForm
            key={agent.latestContentRevisionId}
            initial={agent}
            imageRequest={imageRequest}
            guided={guided}
            onAssistant={() => setGuided(true)}
            onAdvanced={() => setGuided(false)}
            profileRequest={profileRequest}
            strategyComparison={strategyComparison}
            showLiveChanges
            draftScope={
              sourceReviewId
                ? `review:${agentId}:${sourceReviewId}`
                : `edit:${agentId}`
            }
            onSubmit={handleUpdate}
            onCancel={() => router.replace(cancelPath)}
            submitLabel={intent?.flow === "join_game" ? "Save & join"
              : intent?.flow === "daily_free" ? "Save & enter" : undefined}
          />
        </div>
      ) : (
        <div className="influence-panel rounded-2xl p-8 text-center text-sm text-white/45">
          Agent not found.
        </div>
      )}
    </div>
  );
}
