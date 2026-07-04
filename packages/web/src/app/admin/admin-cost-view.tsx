"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePermissions } from "@/hooks/use-permissions";
import {
  backfillAdminGameCosts,
  getAdminGameCosts,
  type AdminGameCostDetail,
  type AdminGameCostSummary,
  type AdminGameSummary,
} from "@/lib/api";

function formatMicrousd(value?: number | null): string {
  if (!value) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 100_000 ? 4 : 2,
    maximumFractionDigits: value < 100_000 ? 4 : 2,
  }).format(value / 1_000_000);
}

function primaryCost(summary?: AdminGameCostSummary | null): { label: string; tone: string; title: string } {
  if (!summary || summary.callCount === 0) {
    return {
      label: "No calls",
      tone: "border-white/10 bg-white/[0.03] text-white/35",
      title: "No provider calls have been captured for this game.",
    };
  }
  if (summary.actualCostMicrousd > 0) {
    return {
      label: formatMicrousd(summary.actualCostMicrousd),
      tone: "border-emerald-700/50 bg-emerald-950/30 text-emerald-200",
      title: "Actual or reconciled provider cost is available.",
    };
  }
  if (summary.estimatedCostMicrousd > 0) {
    return {
      label: `~${formatMicrousd(summary.estimatedCostMicrousd)}`,
      tone: "border-sky-700/50 bg-sky-950/30 text-sky-200",
      title: "Estimated cost from a stored rate card.",
    };
  }
  return {
    label: "Cost unavailable",
    tone: "border-amber-700/50 bg-amber-950/30 text-amber-200",
    title: `${summary.unpricedCallCount} captured call${summary.unpricedCallCount === 1 ? "" : "s"} lack priced cost data.`,
  };
}

export function AdminCostPill({
  summary,
  onClick,
  ariaLabel,
}: {
  summary?: AdminGameCostSummary | null;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const cost = primaryCost(summary);
  const callText = summary && summary.callCount > 0
    ? `${summary.callCount} call${summary.callCount === 1 ? "" : "s"}`
    : "no captured calls";

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      title={`${cost.title} ${callText}.`}
      className={`min-h-8 rounded-md border px-2.5 py-1 text-left text-xs font-medium transition-colors hover:border-white/30 focus:outline-none focus:ring-2 focus:ring-sky-500 ${cost.tone}`}
    >
      <span className="block leading-tight">{cost.label}</span>
      <span className="block text-[10px] font-normal opacity-70">{callText}</span>
    </button>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <p className="text-[10px] uppercase tracking-wide text-white/35">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-white/40">{sub}</p>}
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows?: Record<string, { callCount: number; actualCostMicrousd: number; estimatedCostMicrousd: number; totalTokens: number }>;
}) {
  const sortedRows = Object.entries(rows ?? {})
    .sort(([, a], [, b]) => (
      (b.actualCostMicrousd + b.estimatedCostMicrousd) -
      (a.actualCostMicrousd + a.estimatedCostMicrousd)
    ))
    .slice(0, 8);

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">{title}</h3>
      {sortedRows.length === 0 ? (
        <div className="rounded-md border border-white/10 p-3 text-sm text-white/35">No breakdown yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-white/10">
          <table className="min-w-full text-sm">
            <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-white/35">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-right font-medium">Calls</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
                <th className="px-3 py-2 text-right font-medium">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(([name, row]) => (
                <tr key={name} className="border-t border-white/5">
                  <td className="max-w-[14rem] truncate px-3 py-2 text-white/70">{name}</td>
                  <td className="px-3 py-2 text-right text-white/50">{row.callCount}</td>
                  <td className="px-3 py-2 text-right text-white/70">
                    {formatMicrousd(row.actualCostMicrousd || row.estimatedCostMicrousd)}
                  </td>
                  <td className="px-3 py-2 text-right text-white/50">{row.totalTokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CostWarnings({ detail }: { detail: AdminGameCostDetail }) {
  const warnings = [
    detail.unpricedCallCount > 0 ? `${detail.unpricedCallCount} unpriced call${detail.unpricedCallCount === 1 ? "" : "s"}` : null,
    detail.failedCallCount > 0 ? `${detail.failedCallCount} failed call${detail.failedCallCount === 1 ? "" : "s"}` : null,
    detail.retryFailureSpend.retryCallCount > 0 ? `${detail.retryFailureSpend.retryCallCount} retry call${detail.retryFailureSpend.retryCallCount === 1 ? "" : "s"}` : null,
    detail.backfill.traceBackfilledEntries + detail.backfill.terminalBackfilledEntries > 0 ? "Includes backfilled rows" : null,
  ].filter((item): item is string => Boolean(item));

  if (warnings.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-800/40 bg-amber-950/20 p-3 text-sm text-amber-100/80">
      {warnings.join(" · ")}
    </div>
  );
}

export function AdminCostPanel({
  game,
  onClose,
  onBackfilled,
}: {
  game: AdminGameSummary;
  onClose: () => void;
  onBackfilled?: () => void | Promise<void>;
}) {
  const [detail, setDetail] = useState<AdminGameCostDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const backfillRequestIdRef = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const { hasAnyPermission } = usePermissions();
  const canBackfill = hasAnyPermission("manage_cost_accounting", "manage_roles");

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null || element === closeRef.current);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    return () => {
      backfillRequestIdRef.current += 1;
    };
  }, []);

  const requestCosts = useCallback((requestId: number) => {
    getAdminGameCosts(game.slug ?? game.id)
      .then((next) => {
        if (requestIdRef.current !== requestId) return;
        setDetail(next);
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return;
        setError(err instanceof Error ? err.message : "Failed to load cost details.");
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
  }, [game.id, game.slug]);

  const loadCosts = useCallback(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setDetail(null);
    setError(null);
    setBackfillError(null);
    setLoading(true);
    requestCosts(requestId);
  }, [requestCosts]);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    requestCosts(requestId);
    return () => {
      requestIdRef.current += 1;
    };
  }, [requestCosts]);

  const runBackfill = useCallback(() => {
    const gameKey = game.slug ?? game.id;
    const backfillRequestId = backfillRequestIdRef.current + 1;
    backfillRequestIdRef.current = backfillRequestId;
    setBackfillLoading(true);
    setBackfillMessage(null);
    setBackfillError(null);
    backfillAdminGameCosts(gameKey)
      .then((result) => {
        if (backfillRequestIdRef.current !== backfillRequestId) return;
        setBackfillMessage(`Backfill complete: ${result.inserted} inserted, ${result.skipped} skipped.`);
        loadCosts();
        void onBackfilled?.();
      })
      .catch((err) => {
        if (backfillRequestIdRef.current !== backfillRequestId) return;
        setBackfillMessage(null);
        setBackfillError(err instanceof Error ? err.message : "Failed to backfill costs.");
      })
      .finally(() => {
        if (backfillRequestIdRef.current === backfillRequestId) setBackfillLoading(false);
      });
  }, [game.id, game.slug, loadCosts, onBackfilled]);

  const providerRows = useMemo(() => detail?.breakdowns.provider, [detail]);
  const modelRows = useMemo(() => detail?.breakdowns.model, [detail]);
  const actionRows = useMemo(() => detail?.breakdowns.action, [detail]);
  const actorRows = useMemo(() => detail?.breakdowns.actor, [detail]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-cost-panel-title"
        className="h-full w-full max-w-3xl overflow-y-auto border-l border-white/10 bg-neutral-950 p-5 shadow-2xl"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-white/35">Cost detail</p>
            <h2 id="admin-cost-panel-title" className="mt-1 text-xl font-semibold text-white">
              Game #{game.gameNumber}
            </h2>
            <p className="mt-1 text-sm text-white/40">{game.slug ?? game.id}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 px-3 py-2 text-sm text-white/60 transition-colors hover:border-white/25 hover:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            Close
          </button>
        </div>

        {loading ? (
          <div className="rounded-md border border-white/10 p-8 text-center text-sm text-white/40">
            Loading cost details…
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-900/40 bg-red-950/20 p-4 text-sm text-red-200">
            <p>{error}</p>
            <button
              type="button"
              onClick={loadCosts}
              className="mt-3 rounded-md border border-red-700/60 px-3 py-1.5 text-xs text-red-100 hover:border-red-400"
            >
              Retry
            </button>
          </div>
        ) : detail ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Actual" value={formatMicrousd(detail.actualCostMicrousd)} sub={detail.state === "actual" ? "actual/reconciled" : "not available"} />
              <Metric label="Estimated" value={formatMicrousd(detail.estimatedCostMicrousd)} sub={detail.pricing.rateCardVersions.join(", ") || "no rate card"} />
              <Metric label="Calls" value={detail.callCount.toLocaleString()} sub={`${detail.totalTokens.toLocaleString()} tokens`} />
              <Metric label="Unavailable" value={detail.unpricedCallCount.toLocaleString()} sub="unpriced calls" />
            </div>

            <CostWarnings detail={detail} />

            {detail.callCount === 0 ? (
              <div className="rounded-md border border-white/10 p-5 text-sm text-white/40">
                No provider calls have been captured for this game yet.
              </div>
            ) : (
              <div className="grid gap-5 xl:grid-cols-2">
                <BreakdownTable title="Provider" rows={providerRows} />
                <BreakdownTable title="Model" rows={modelRows} />
                <BreakdownTable title="Action" rows={actionRows} />
                <BreakdownTable title="Player / House" rows={actorRows} />
              </div>
            )}

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">Owner Epochs</h3>
              {detail.ownerEpochBreakdowns.length === 0 ? (
                <div className="rounded-md border border-white/10 p-3 text-sm text-white/35">
                  No owner-epoch breakdown is available.
                </div>
              ) : (
                <div className="space-y-2">
                  {detail.ownerEpochBreakdowns.map((epoch) => (
                    <div key={epoch.ownerEpoch} className="rounded-md border border-white/10 p-3 text-sm text-white/60">
                      <span className="font-mono text-xs text-white/35">{epoch.ownerEpoch}</span>
                      <span className="ml-3 text-white/70">{formatMicrousd(epoch.summary.actualCostMicrousd || epoch.summary.estimatedCostMicrousd)}</span>
                      <span className="ml-3 text-white/40">{epoch.summary.callCount} calls</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">Expensive Calls</h3>
              {detail.expensiveCalls.length === 0 ? (
                <div className="rounded-md border border-white/10 p-3 text-sm text-white/35">No expensive calls yet.</div>
              ) : (
                <div className="space-y-2">
                  {detail.expensiveCalls.map((call, index) => (
                    <div key={`${call.actorName ?? "call"}-${index}`} className="rounded-md border border-white/10 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-white/70">{call.actorName ?? call.actorRole ?? "Unknown actor"} · {call.action ?? "unknown action"}</span>
                        <span className="text-white">{formatMicrousd(call.actualCostMicrousd || call.estimatedCostMicrousd)}</span>
                      </div>
                      <p className="mt-1 text-xs text-white/35">
                        {call.provider ?? "unknown provider"} / {call.modelName ?? "unknown model"} · {call.costSource} · {call.totalTokens.toLocaleString()} tokens
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-md border border-white/10 p-3 text-sm text-white/45">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  Trace rows: {detail.backfill.traceBackfilledEntries}; terminal aggregate rows: {detail.backfill.terminalBackfilledEntries}.
                </span>
                {canBackfill && (
                  <button
                    type="button"
                    onClick={runBackfill}
                    disabled={backfillLoading || loading}
                    className="rounded-md border border-sky-700/60 px-3 py-1.5 text-xs font-medium text-sky-100 transition-colors hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {backfillLoading ? "Backfilling..." : "Backfill costs"}
                  </button>
                )}
              </div>
              {backfillMessage && <p className="mt-2 text-xs text-emerald-200">{backfillMessage}</p>}
              {backfillError && <p className="mt-2 text-xs text-red-200">{backfillError}</p>}
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
