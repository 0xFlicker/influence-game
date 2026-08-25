"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  getAdminProviderFailureContent,
  getAdminProviderFailures,
  type AdminGameSummary,
  type AdminProviderFailureAttempt,
  type AdminProviderFailureContent,
  type AdminProviderFailureDetail,
  type AdminProviderFailureBudget,
  type AdminProviderFailureSummary,
  type AdminProviderFailureSummaryUnavailable,
} from "@/lib/api";
import { gameDisplayName } from "@/lib/game-identity";

const RAW_CHUNK_BYTES = 64 * 1024;

type RawReadState =
  | { state: "idle" }
  | { state: "loading"; content: string; loadedBytes: number }
  | { state: "ready"; content: string; result: AdminProviderFailureContent }
  | {
    state: "error";
    content: string;
    loadedBytes: number;
    error: string;
    retryable: boolean;
    status?: string;
  };

export function AdminProviderFailuresPill({
  summary,
  onClick,
  ariaLabel,
}: {
  summary?: AdminProviderFailureSummary | AdminProviderFailureSummaryUnavailable;
  onClick: () => void;
  ariaLabel: string;
}) {
  if (!summary) return null;
  if (summary.state === "empty") return <span className="text-white/20">—</span>;
  const unavailable = summary.state === "unavailable";
  const tone = unavailable
    ? "border-amber-700/50 bg-amber-950/30 text-amber-200"
    : summary.terminalCount > 0
      ? "border-red-700/50 bg-red-950/30 text-red-200"
      : summary.degradedCount > 0
        ? "border-amber-700/50 bg-amber-950/30 text-amber-200"
        : "border-sky-700/50 bg-sky-950/30 text-sky-200";
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`min-h-8 rounded-md border px-2.5 py-1 text-left text-xs font-medium transition-colors hover:border-white/30 focus:outline-none focus:ring-2 focus:ring-sky-500 ${tone}`}
    >
      <span className="block leading-tight">{unavailable ? "Unavailable" : `${summary.failureCount} failure${summary.failureCount === 1 ? "" : "s"}`}</span>
      <span className="block text-[10px] font-normal opacity-75">
        {unavailable ? "Retry details" : summary.state}
      </span>
    </button>
  );
}

export function AdminProviderFailuresPanel({
  game,
  onClose,
}: {
  game: AdminGameSummary;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<AdminProviderFailureDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [rawReads, setRawReads] = useState<Record<string, RawReadState>>({});
  const closeRef = useRef<HTMLButtonElement>(null);
  const requestIdRef = useRef(0);

  const loadDetail = useCallback((cursor?: string) => {
    const loadingPage = cursor !== undefined;
    const requestId = ++requestIdRef.current;
    if (loadingPage) {
      setLoadingMore(true);
      setPageError(null);
    } else {
      setLoading(true);
      setError(null);
    }
    getAdminProviderFailures(game.id, { cursor })
      .then((response) => {
        if (requestIdRef.current !== requestId) return;
        setDetail((current) => loadingPage && current
          ? {
              ...response,
              failures: [...response.failures, ...current.failures],
            }
          : response);
      })
      .catch((cause) => {
        if (requestIdRef.current === requestId) {
          const message = cause instanceof Error
            ? cause.message
            : "Provider failure evidence is unavailable.";
          if (loadingPage) setPageError(message);
          else setError(message);
        }
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return;
        if (loadingPage) setLoadingMore(false);
        else setLoading(false);
      });
  }, [game.id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof window.HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function loadRaw(attempt: AdminProviderFailureAttempt, offsetBytes = 0) {
    const manifestId = attempt.evidence.manifestId;
    if (!manifestId) return;
    const previous = rawReads[attempt.id];
    const previousContent = previous && "content" in previous ? previous.content : "";
    const loadedBytes = previous && "loadedBytes" in previous
      ? previous.loadedBytes
      : previous?.state === "ready"
        ? previous.result.offsetBytes + previous.result.returnedByteLength
        : 0;
    setRawReads((current) => ({
      ...current,
      [attempt.id]: { state: "loading", content: previousContent, loadedBytes },
    }));
    try {
      const result = await getAdminProviderFailureContent(game.id, manifestId, {
        offsetBytes,
        maxBytes: RAW_CHUNK_BYTES,
      });
      setRawReads((current) => ({
        ...current,
        [attempt.id]: {
          state: "ready",
          content: `${previousContent}${result.content}`,
          result,
        },
      }));
    } catch (cause) {
      setRawReads((current) => ({
        ...current,
        [attempt.id]: {
          state: "error",
          content: previousContent,
          loadedBytes,
          error: cause instanceof Error ? cause.message : "Raw provider evidence is unavailable.",
          retryable: cause instanceof ApiError && cause.retryable === true,
          ...(cause instanceof ApiError && cause.code ? { status: cause.code } : {}),
        },
      }));
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-failures-title"
        aria-describedby="provider-failures-description"
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-white/10 bg-zinc-950 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
          <div>
            <h2 id="provider-failures-title" className="text-lg font-semibold text-white">Provider failures</h2>
            <p id="provider-failures-description" className="mt-1 text-sm text-white/45">
              {gameDisplayName(game)} · private operator diagnostics
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-white/55 hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            Close
          </button>
        </header>

        <div className="overflow-y-auto p-5">
          <div role="status" aria-live="polite" className="sr-only">
            {loading
              ? "Loading provider failures"
              : error
                ? "Provider failures unavailable"
                : detail?.failures.length === 0
                  ? "No provider failures"
                  : `${detail?.failures.length ?? 0} provider failure records loaded${detail?.page.hasMore ? "; older records are available" : ""}`}
          </div>
          {loading ? (
            <PanelState title="Loading evidence…" />
          ) : error ? (
            <PanelState title="Evidence unavailable" detail={error} actionLabel="Retry" onAction={loadDetail} tone="error" />
          ) : !detail ? (
            <PanelState title="Evidence unavailable" detail="The provider evidence response was empty." tone="error" />
          ) : (
            <div className="space-y-5">
              <ProviderBudgets budgets={detail.budgets} />
              <FailureSummary summary={detail.summary} />
              {detail.failures.length === 0 ? (
                <PanelState title="No provider failures" detail="This game has no recorded provider failure evidence." />
              ) : <>
                {detail.page.hasMore && detail.page.nextCursor && (
                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm text-white/55">
                    <p>Showing the latest {detail.failures.length.toLocaleString()} records in chronological order. Older evidence is available.</p>
                    <button
                      type="button"
                      disabled={loadingMore}
                      onClick={() => loadDetail(detail.page.nextCursor ?? undefined)}
                      className="mt-2 rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/75 hover:bg-white/5 disabled:cursor-wait disabled:opacity-50"
                    >
                      {loadingMore ? "Loading older evidence…" : "Load older evidence"}
                    </button>
                    {pageError && <p role="alert" className="mt-2 text-xs text-red-300">{pageError}</p>}
                  </div>
                )}
                <ol className="space-y-3" aria-label="Chronological provider failure evidence">
                  {detail.failures.map((failure) => (
                    <li key={failure.id} className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">
                          {failure.kind === "rate_limit"
                            ? `${failure.count} rate-limit response${failure.count === 1 ? "" : "s"}`
                            : `${failure.providerProfileId} · ${failure.modelName} · ${failure.transport}`}
                        </p>
                        <p className="mt-1 text-xs text-white/45">
                          {failure.actorName} · {failure.action}
                          {failure.phase ? ` · ${failure.phase}` : ""}
                          {failure.round !== null ? ` · round ${failure.round}` : ""}
                        </p>
                      </div>
                      <FailureStateBadge state={failure.state} />
                    </div>
                    <p className="mt-3 text-xs text-white/40">
                      <time dateTime={failure.occurredAt}>{new Date(failure.occurredAt).toLocaleString()}</time>
                    </p>
                    {failure.kind === "rate_limit" ? (
                      <p className="mt-3 text-sm text-white/65">
                        {failure.outcome === "recovered"
                          ? "The logical call recovered after the aggregated rate limits."
                          : failure.outcome === "exhausted"
                            ? `Retries were exhausted${failure.terminalReason ? `: ${failure.terminalReason}` : "."}`
                            : "The logical call transitioned to another attempt; final recovery is not recorded yet."}
                      </p>
                    ) : (
                      <AttemptEvidence
                        attempt={failure}
                        raw={rawReads[failure.id] ?? { state: "idle" }}
                        onLoad={(offset) => loadRaw(failure, offset)}
                      />
                    )}
                    </li>
                  ))}
                </ol>
              </>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ProviderBudgets({ budgets }: { budgets: AdminProviderFailureBudget[] }) {
  if (budgets.length === 0) return null;
  return (
    <section aria-labelledby="provider-budget-title">
      <h3 id="provider-budget-title" className="text-sm font-semibold text-white">Provider call budgets</h3>
      <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {budgets.map((budget) => (
          <div key={budget.catalogId} className="rounded-md border border-white/10 bg-white/[0.02] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">{budget.modelName}</p>
                <p className="text-[10px] uppercase tracking-wide text-white/35">{budget.role}</p>
              </div>
              <span className={budget.state === "exhausted" ? "text-xs text-red-300" : "text-xs text-white/50"}>
                {budget.maxCallsPerGame === null
                  ? `${budget.usedCalls} used · unbounded`
                  : `${budget.usedCalls}/${budget.maxCallsPerGame} used`}
              </span>
            </div>
            <p className="mt-2 text-xs text-white/50">
              {budget.remainingCalls === null
                ? "Primary calls are not capped per game."
                : `${budget.remainingCalls} fallback call${budget.remainingCalls === 1 ? "" : "s"} remaining.`}
            </p>
            <p className="mt-1 text-xs text-white/40">{providerCostLabel(budget)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function providerCostLabel(budget: AdminProviderFailureBudget): string {
  if (budget.cost.state === "no_calls") return "Cost: no calls";
  const knownMicrousd = budget.cost.actualCostMicrousd + budget.cost.estimatedCostMicrousd;
  const known = `$${(knownMicrousd / 1_000_000).toFixed(6)}`;
  if (budget.cost.state === "unavailable") {
    return budget.cost.unpricedCallCount === budget.cost.callCount
      ? `Cost unavailable for ${budget.cost.callCount} call${budget.cost.callCount === 1 ? "" : "s"}`
      : `${known} known; ${budget.cost.unpricedCallCount} call${budget.cost.unpricedCallCount === 1 ? "" : "s"} unpriced`;
  }
  return `${budget.cost.state === "actual" ? "Actual" : "Estimated"} cost: ${known}`;
}

function FailureSummary({ summary }: { summary: AdminProviderFailureSummary }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <SummaryMetric label="Exact failures" value={summary.exactFailureCount} />
      <SummaryMetric label="Rate limits" value={summary.rateLimitCount} />
      <SummaryMetric label="Recovered" value={summary.recoveredCount} />
      <SummaryMetric label="Terminal" value={summary.terminalCount} />
      <SummaryMetric label="Degraded" value={summary.degradedCount} />
      <SummaryMetric label="Transitioned" value={summary.transitionedCount} />
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
      <p className="text-[10px] uppercase tracking-wide text-white/35">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function AttemptEvidence({
  attempt,
  raw,
  onLoad,
}: {
  attempt: AdminProviderFailureAttempt;
  raw: RawReadState;
  onLoad: (offsetBytes?: number) => void;
}) {
  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm text-white/65">
        {attempt.outcomeKind}{attempt.outcomeMessage ? `: ${attempt.outcomeMessage}` : ""}
      </p>
      {attempt.providerRequestId && (
        <p className="font-mono text-xs text-white/40">Provider request ID: {attempt.providerRequestId}</p>
      )}
      {attempt.evidence.state === "available" ? (
        <details className="rounded-md border border-white/10 bg-black/20 p-3">
          <summary className="cursor-pointer text-sm text-sky-200">Exact request and response evidence</summary>
          <div className="mt-3">
            {raw.state === "idle" && (
              <button type="button" onClick={() => onLoad(0)} className="rounded-md border border-sky-700/50 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-950/30">
                Load private evidence
              </button>
            )}
            {raw.state === "loading" && <p role="status" className="text-xs text-white/45">Loading bounded evidence…</p>}
            {(raw.state === "ready" || raw.state === "error") && raw.content && (
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-white/10 bg-black p-3 text-xs leading-5 text-white/70">{raw.content}</pre>
            )}
            {raw.state === "ready" && (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-white/40">
                <span>
                  Loaded {BufferlessByteLabel(raw.content)}
                  {raw.result.totalByteLength !== undefined ? ` of ${raw.result.totalByteLength.toLocaleString()} bytes` : ""}
                </span>
                {raw.result.truncated && raw.result.nextOffsetBytes !== undefined && (
                  <button type="button" onClick={() => onLoad(raw.result.nextOffsetBytes)} className="rounded-md border border-white/15 px-2.5 py-1 text-white/70 hover:bg-white/5">
                    Load more
                  </button>
                )}
              </div>
            )}
            {raw.state === "error" && (
              <div role="alert" className="mt-2 text-xs text-red-300">
                {raw.content ? "Continuation failed; the bytes above remain partial. " : "Evidence is unavailable. "}
                {raw.error}{raw.status ? ` (${raw.status})` : ""}
                {raw.retryable ? (
                  <button type="button" onClick={() => onLoad(raw.loadedBytes)} className="ml-2 underline">Retry</button>
                ) : (
                  <span className="ml-2 text-white/45">This evidence is permanently unavailable.</span>
                )}
              </div>
            )}
          </div>
        </details>
      ) : (
        <p className="rounded-md border border-amber-800/30 bg-amber-950/20 p-3 text-xs text-amber-200/80">
          {attempt.evidence.state === "degraded" ? "Diagnostics degraded" : "Exact evidence unavailable"}
          {attempt.evidence.error ? `: ${attempt.evidence.error}` : "."}
        </p>
      )}
    </div>
  );
}

function FailureStateBadge({ state }: { state: AdminProviderFailureAttempt["state"] }) {
  const tone = state === "terminal" ? "border-red-700/50 bg-red-950/40 text-red-200"
    : state === "degraded" ? "border-amber-700/50 bg-amber-950/40 text-amber-200"
      : state === "recovered" ? "border-emerald-700/50 bg-emerald-950/30 text-emerald-200"
        : "border-sky-700/50 bg-sky-950/30 text-sky-200";
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] capitalize ${tone}`}>{state}</span>;
}

function PanelState({
  title,
  detail,
  actionLabel,
  onAction,
  tone = "normal",
}: {
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "normal" | "error";
}) {
  return (
    <div className={`rounded-lg border p-8 text-center ${tone === "error" ? "border-red-900/40 text-red-200" : "border-white/10 text-white/55"}`}>
      <p className="font-medium">{title}</p>
      {detail && <p className="mt-2 text-sm opacity-70">{detail}</p>}
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="mt-4 rounded-md border border-white/15 px-3 py-1.5 text-sm hover:bg-white/5">
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function BufferlessByteLabel(content: string): string {
  return `${new TextEncoder().encode(content).byteLength.toLocaleString()} bytes`;
}
