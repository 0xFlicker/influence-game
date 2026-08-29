"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  applyOwnerLearningReview,
  dismissOwnerLearningPrompt,
  getAgent,
  getAuthToken,
  getOwnerLearningEligibleInputs,
  getOwnerLearningReview,
  getOwnerLearningReviewStatus,
  preflightOwnerLearningReview,
  recordOwnerLearningMcpOfferViewed,
  recordOwnerLearningRecommendationsViewed,
  resolveOwnerLearningReview,
  retryOwnerLearningReview,
  startOwnerLearningReview,
  type OwnerLearningEligibleInputs,
  type OwnerLearningPreflight,
  type OwnerLearningReview,
  type OwnerLearningReviewStatus,
  type SavedAgent,
} from "@/lib/api";
import { OwnerLearningEntryView } from "./owner-learning-entry";
import { OwnerLearningReviewView } from "./owner-learning-review";
import { formatAvailabilityTimestamp, isReviewPolling, reviewPath } from "./owner-learning-model";

export function OwnerLearningEntryWorkspace({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [eligible, setEligible] = useState<OwnerLearningEligibleInputs | null>(null);
  const [agent, setAgent] = useState<SavedAgent | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState(agentId);
  const [selectedGameIds, setSelectedGameIds] = useState<string[]>([]);
  const [preflight, setPreflight] = useState<OwnerLearningPreflight | null>(null);
  const [loading, setLoading] = useState(true);
  const [preflightPending, setPreflightPending] = useState(false);
  const [preflightFailed, setPreflightFailed] = useState(false);
  const [startPending, setStartPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const preflightRequest = useRef(0);
  const startIdentity = useRef<{ selection: string; key: string } | null>(null);

  const loadEligible = useCallback(async () => {
    if (!getAuthToken()) return;
    try {
      const next = await getOwnerLearningEligibleInputs();
      if (next.openReview) {
        router.replace(reviewPath(next.openReview.agentProfileId, next.openReview.id));
        return;
      }
      const profile = next.profiles.find((entry) => entry.agentProfileId === agentId)
        ?? next.profiles.find((entry) => entry.agentProfileId === next.recommendedAgentProfileId)
        ?? next.profiles[0]
        ?? null;
      setEligible(next);
      if (profile) {
        setSelectedProfileId(profile.agentProfileId);
        setSelectedGameIds(profile.recommendedGameIds);
      }
      setPreflightFailed(false);
      setNotice(null);
    } catch (error) {
      setNotice(apiMessage(error, "Could not load eligible review inputs."));
    } finally {
      setLoading(false);
    }
  }, [agentId, router]);

  useEffect(() => {
    void loadEligible();
    const onSession = () => void loadEligible();
    window.addEventListener("auth:session-ready", onSession);
    return () => window.removeEventListener("auth:session-ready", onSession);
  }, [loadEligible]);

  useEffect(() => {
    if (!selectedProfileId) return;
    getAgent(selectedProfileId).then(setAgent).catch(() => setAgent(null));
  }, [selectedProfileId]);

  useEffect(() => {
    if (!eligible || selectedGameIds.length === 0) {
      setPreflight(null);
      setPreflightFailed(false);
      return;
    }
    const requestId = ++preflightRequest.current;
    setPreflightPending(true);
    setPreflightFailed(false);
    preflightOwnerLearningReview({ agentProfileId: selectedProfileId, gameIds: selectedGameIds })
      .then((next) => {
        if (requestId !== preflightRequest.current) return;
        setPreflight(next);
        setPreflightFailed(false);
        setNotice(null);
      })
      .catch((error) => {
        if (requestId !== preflightRequest.current) return;
        setPreflight(null);
        setPreflightFailed(true);
        setNotice(apiMessage(error, "The selected facts could not be loaded."));
      })
      .finally(() => {
        if (requestId === preflightRequest.current) setPreflightPending(false);
      });
  }, [eligible, selectedGameIds, selectedProfileId]);

  function changeProfile(profileId: string) {
    const profile = eligible?.profiles.find((entry) => entry.agentProfileId === profileId);
    if (!profile) return;
    setSelectedProfileId(profile.agentProfileId);
    setSelectedGameIds(profile.recommendedGameIds);
    setPreflight(null);
    setPreflightFailed(false);
    setNotice(null);
    startIdentity.current = null;
  }

  function toggleGame(gameId: string) {
    setSelectedGameIds((current) => {
      if (current.includes(gameId)) {
        return current.length === 1 ? current : current.filter((entry) => entry !== gameId);
      }
      return current.length >= 3 ? current : [...current, gameId];
    });
    setPreflightFailed(false);
    setNotice(null);
    startIdentity.current = null;
  }

  async function startReview() {
    if (!eligible || !preflight || startPending) return;
    const selection = `${selectedProfileId}:${selectedGameIds.join(",")}`;
    if (!startIdentity.current || startIdentity.current.selection !== selection) {
      startIdentity.current = {
        selection,
        key: `web-review-${globalThis.crypto.randomUUID()}`,
      };
    }
    setStartPending(true);
    setNotice(null);
    try {
      const result = await startOwnerLearningReview({
        agentProfileId: selectedProfileId,
        gameIds: selectedGameIds,
        idempotencyKey: startIdentity.current.key,
      });
      if (result.reviewId) {
        let targetAgentId = selectedProfileId;
        if (result.status === "existing_open_review") {
          const refreshed = await getOwnerLearningEligibleInputs();
          setEligible(refreshed);
          targetAgentId = refreshed.openReview?.agentProfileId ?? selectedProfileId;
        }
        router.replace(reviewPath(targetAgentId, result.reviewId));
        return;
      }
      if (result.preflight) setPreflight(result.preflight);
      setNotice(startResultMessage(result.status, result.nextEligibleAt));
      await loadEligible();
    } catch (error) {
      try {
        const refreshed = await getOwnerLearningEligibleInputs();
        setEligible(refreshed);
        if (refreshed.openReview) {
          router.replace(reviewPath(refreshed.openReview.agentProfileId, refreshed.openReview.id));
          return;
        }
      } catch {
        // The original request error remains the useful recovery message.
      }
      setNotice(apiMessage(error, "The review start could not be confirmed. Try again to reconcile the same purchase."));
    } finally {
      setStartPending(false);
    }
  }

  async function dismissPrompt() {
    try {
      await dismissOwnerLearningPrompt();
      await loadEligible();
    } catch (error) {
      setNotice(apiMessage(error, "The prompt could not be dismissed."));
    }
  }

  if (loading || !eligible) {
    return <div className="olm-loading" role="status">Loading recorded game facts…</div>;
  }

  return (
    <OwnerLearningEntryView
      eligible={eligible}
      agent={agent}
      selectedProfileId={selectedProfileId}
      selectedGameIds={selectedGameIds}
      preflight={preflight}
      preflightPending={preflightPending}
      preflightFailed={preflightFailed}
      startPending={startPending}
      notice={notice}
      onChangeProfile={changeProfile}
      onToggleGame={toggleGame}
      onStart={() => void startReview()}
      onDismiss={eligible.prompt.threshold && !eligible.prompt.suppressedByDismissal
        ? () => void dismissPrompt()
        : undefined}
    />
  );
}

export function OwnerLearningReviewWorkspace({
  agentId,
  reviewId,
}: {
  agentId: string;
  reviewId: string;
}) {
  const [review, setReview] = useState<OwnerLearningReview | null>(null);
  const [agent, setAgent] = useState<SavedAgent | null>(null);
  const [mcpConnectionState, setMcpConnectionState] = useState<"connected" | "not_connected">("not_connected");
  const [activeGameId, setActiveGameId] = useState("");
  const [pendingAction, setPendingAction] = useState<"retry" | "apply" | "resolve" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const viewedReviewId = useRef<string | null>(null);
  const offeredReviewId = useRef<string | null>(null);
  const previousState = useRef<string | null>(null);
  const terminalFocus = useRef<HTMLDivElement | null>(null);
  const polling = review ? isReviewPolling(review) : false;

  const loadReview = useCallback(async (announceErrors = true) => {
    if (!getAuthToken()) return null;
    try {
      const next = await getOwnerLearningReview(reviewId, agentId);
      setReview(next);
      setActiveGameId((current) => current || next.selectedGameIds[0] || "");
      setError(null);
      return next;
    } catch (nextError) {
      if (announceErrors) setError(apiMessage(nextError, "Review unavailable."));
      return null;
    } finally {
      setLoading(false);
    }
  }, [agentId, reviewId]);

  const pollReview = useCallback(async (): Promise<boolean> => {
    if (!getAuthToken()) return false;
    try {
      const status = await getOwnerLearningReviewStatus(reviewId, agentId);
      if (isReviewStatusTerminal(status)) {
        try {
          const next = await getOwnerLearningReview(reviewId, agentId);
          setReview(next);
          setActiveGameId((current) => current || next.selectedGameIds[0] || "");
          setError(null);
          return false;
        } catch (nextError) {
          if (isRetryableOwnerLearningPollError(nextError)) return true;
          setError(apiMessage(nextError, "Review unavailable."));
          return false;
        }
      }
      setReview((current) => {
        if (!current || reviewStatusSignature(current) === reviewStatusSignature(status)) return current;
        return { ...current, ...status };
      });
      setError(null);
      return true;
    } catch (pollError) {
      if (isRetryableOwnerLearningPollError(pollError)) return true;
      setError(apiMessage(pollError, "Review unavailable."));
      return false;
    }
  }, [agentId, reviewId]);

  useEffect(() => {
    if (!getAuthToken()) return;
    void loadReview();
    getAgent(agentId).then(setAgent).catch(() => setAgent(null));
    getOwnerLearningEligibleInputs()
      .then((eligible) => setMcpConnectionState(eligible.mcp.connectionState))
      .catch(() => undefined);
    const onSession = () => void loadReview();
    window.addEventListener("auth:session-ready", onSession);
    return () => window.removeEventListener("auth:session-ready", onSession);
  }, [agentId, loadReview]);

  useEffect(() => {
    if (!polling) return;
    const delays = [2_000, 3_000, 5_000, 8_000, 10_000];
    let cancelled = false;
    let attempt = 0;
    let timer = 0;
    const poll = async () => {
      const continuePolling = await pollReview();
      if (cancelled || !continuePolling) return;
      timer = window.setTimeout(() => void poll(), delays[Math.min(attempt++, delays.length - 1)]);
    };
    timer = window.setTimeout(() => void poll(), delays[0]);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pollReview, polling]);

  useEffect(() => {
    if (!review) return;
    const state = `${review.analysisStatus}:${review.stage}:${review.resolution ?? "open"}`;
    const becameTerminal = previousState.current != null
      && state !== previousState.current
      && (review.resolution != null || ["ready", "no_change", "failed"].includes(review.analysisStatus));
    previousState.current = state;
    if (becameTerminal) terminalFocus.current?.focus({ preventScroll: true });
  }, [review]);

  useEffect(() => {
    if (!review || review.analysisStatus !== "ready" || viewedReviewId.current === review.id) return;
    viewedReviewId.current = review.id;
    void recordOwnerLearningRecommendationsViewed(review.id).catch(() => undefined);
  }, [review]);

  useEffect(() => {
    if (
      !review
      || offeredReviewId.current === review.id
      || !["queued", "retry_queued", "running", "ready"].includes(review.analysisStatus)
      || review.resolution != null
    ) return;
    offeredReviewId.current = review.id;
    void recordOwnerLearningMcpOfferViewed(review.id).catch(() => undefined);
  }, [review]);

  async function mutate(
    action: "retry" | "apply" | "resolve",
    request: () => Promise<unknown>,
  ) {
    if (pendingAction) return;
    setPendingAction(action);
    setNotice(null);
    try {
      await request();
      await loadReview();
    } catch (mutationError) {
      const reconciled = await loadReview(false);
      if (!reconciled) setNotice(apiMessage(mutationError, "The action could not be confirmed."));
      else setNotice("The review was refreshed from its persisted state.");
    } finally {
      setPendingAction(null);
    }
  }

  if (loading) return <div className="olm-loading" role="status">Opening the saved review…</div>;
  if (error || !review) {
    return (
      <section className="olm-empty">
        <p className="olm-kicker">Owner review</p>
        <h1>Review unavailable.</h1>
        <p>{error ?? "This review could not be found for the selected agent."}</p>
        <a href={`/dashboard/agents/${encodeURIComponent(agentId)}`} className="olm-button olm-button-secondary">Back to agent</a>
      </section>
    );
  }

  return (
    <div ref={terminalFocus} tabIndex={-1} className="olm-focus-shell">
      <span className="sr-only" aria-live="polite">{reviewStatusAnnouncement(review)}</span>
      <OwnerLearningReviewView
        review={review}
        agent={agent}
        activeGameId={activeGameId}
        pendingAction={pendingAction}
        notice={notice}
        mcpConnectionState={mcpConnectionState}
        onSelectGame={setActiveGameId}
        onRetry={() => void mutate("retry", () => retryOwnerLearningReview(review.id))}
        onApply={() => {
          const fingerprint = review.proposalFingerprint;
          if (!fingerprint) return;
          void mutate("apply", () => applyOwnerLearningReview(review.id, fingerprint));
        }}
        onResolve={(resolution) => void mutate("resolve", () => resolveOwnerLearningReview(review.id, resolution))}
      />
    </div>
  );
}

function reviewStatusSignature(review: OwnerLearningReviewStatus): string {
  return [
    review.analysisStatus,
    review.stage,
    review.capacitySubstatus ?? "",
    review.resolution ?? "",
    review.proposalFingerprint ?? "",
    review.safeFailureCode ?? "",
    review.retryable ? "1" : "0",
    review.logicalCallCount,
    review.diveCount,
    review.applyDisposition,
    review.resolvedAt ?? "",
  ].join(":");
}

function isReviewStatusTerminal(review: OwnerLearningReviewStatus): boolean {
  return review.resolution != null || ["ready", "no_change", "failed"].includes(review.analysisStatus);
}

function startResultMessage(status: string, nextEligibleAt: string | null): string {
  if (status === "awaiting_evidence") return "The selected early exits need more game evidence. No review was purchased.";
  if (status === "generation_unavailable") return "Strategic review is temporarily unavailable. No review was purchased.";
  if (status === "no_credit") return "Another completed Daily Free game is required for the next credit.";
  if (status === "rolling_limited") {
    return nextEligibleAt
      ? `The next review can start ${formatAvailabilityTimestamp(nextEligibleAt)}.`
      : "No review credit is currently available.";
  }
  return "The review state changed. The latest persisted state is shown.";
}

function apiMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code === "unavailable") return "Review unavailable.";
    return error.message || fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function isRetryableOwnerLearningPollError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.status === 401 || error.status === 403 || error.status === 404) return false;
  return error.retryable === true || error.status === 408 || error.status === 429 || error.status >= 500;
}

function reviewStatusAnnouncement(review: OwnerLearningReview): string {
  if (review.resolution) return `Review resolved: ${review.resolution.replaceAll("_", " ")}.`;
  if (review.analysisStatus === "ready") return "Review analysis is ready.";
  if (review.analysisStatus === "no_change") return "Review complete. No strategy change is recommended.";
  if (review.analysisStatus === "failed") return "Review analysis was interrupted.";
  return `Review stage: ${review.stage.replaceAll("_", " ")}.`;
}
