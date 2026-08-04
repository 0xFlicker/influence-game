"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAdminOwnerLearningReview,
  listAdminOwnerLearningReviews,
  type AdminOwnerLearningAcceptance,
  type AdminOwnerLearningReviewDetail,
  type AdminOwnerLearningReviewFilters,
  type AdminOwnerLearningReviewList,
  type AdminOwnerLearningReviewSummary,
} from "@/lib/api";

const EMPTY_FILTERS: AdminOwnerLearningReviewFilters = {};

export function AdminOwnerLearningReviews() {
  const [data, setData] = useState<AdminOwnerLearningReviewList | null>(null);
  const [filters, setFilters] = useState<AdminOwnerLearningReviewFilters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<AdminOwnerLearningReviewFilters>(EMPTY_FILTERS);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, AdminOwnerLearningReviewDetail>>({});
  const [loading, setLoading] = useState(true);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detailRequest = useRef(0);

  const refresh = useCallback(async (nextFilters: AdminOwnerLearningReviewFilters) => {
    setLoading(true);
    setError(null);
    try {
      setData(await listAdminOwnerLearningReviews(nextFilters));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the review ledger.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(filters); }, [filters, refresh]);

  async function toggleReview(reviewId: string) {
    if (expandedId === reviewId) {
      detailRequest.current += 1;
      setExpandedId(null);
      setLoadingDetailId(null);
      return;
    }
    const requestId = ++detailRequest.current;
    setExpandedId(reviewId);
    if (details[reviewId]) {
      setLoadingDetailId(null);
      return;
    }
    setLoadingDetailId(reviewId);
    setError(null);
    try {
      const detail = await getAdminOwnerLearningReview(reviewId);
      if (requestId !== detailRequest.current) return;
      setDetails((current) => ({ ...current, [reviewId]: detail }));
    } catch (cause) {
      if (requestId !== detailRequest.current) return;
      setError(cause instanceof Error ? cause.message : "Could not load review detail.");
      setExpandedId((current) => current === reviewId ? null : current);
    } finally {
      if (requestId === detailRequest.current) setLoadingDetailId(null);
    }
  }

  if (loading && !data) {
    return <div className="influence-empty-state rounded-2xl p-10 text-center text-sm">Loading review ledger…</div>;
  }

  return (
    <section aria-labelledby="owner-learning-ledger-title">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-2xl">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.28em] text-indigo-300/70">Owner Learning Loop</p>
          <h2 id="owner-learning-ledger-title" className="text-2xl font-semibold tracking-tight text-text-primary">Review ledger</h2>
          <p className="influence-copy mt-2 text-sm leading-6">
            Inspect what the reviewer recommended, what it cost, and whether the owner accepted the exact proposal.
          </p>
        </div>
        <p className="max-w-md rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-xs leading-5 text-amber-100/70">
          Later game results are grouped by the revision that actually played. They are correlation, never causal proof of an update.
        </p>
      </div>

      {error && <p role="alert" className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}

      <ReviewFilters
        value={draftFilters}
        busy={loading}
        onChange={setDraftFilters}
        onApply={() => setFilters({ ...draftFilters })}
        onClear={() => { setDraftFilters(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); }}
      />

      {data && (
        <AdminOwnerLearningReviewsContent
          data={data}
          expandedId={expandedId}
          details={details}
          loadingDetailId={loadingDetailId}
          onToggle={(reviewId) => { void toggleReview(reviewId); }}
        />
      )}
    </section>
  );
}

export function AdminOwnerLearningReviewsContent({
  data,
  expandedId,
  details,
  loadingDetailId,
  onToggle,
}: {
  data: AdminOwnerLearningReviewList;
  expandedId: string | null;
  details: Record<string, AdminOwnerLearningReviewDetail>;
  loadingDetailId: string | null;
  onToggle: (reviewId: string) => void;
}) {
  return (
    <div className="mt-6 space-y-5">
      <AnalyticsStrip data={data} />
      {data.reviews.length === 0 ? (
        <div className="influence-empty-state rounded-2xl p-12 text-center">
          <p className="text-sm font-medium text-text-primary">No reviews match this cut.</p>
          <p className="influence-copy-muted mt-2 text-xs">Broaden the filters to inspect another slice.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border-active/70 bg-surface-raised/60 shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
          <div className="hidden grid-cols-[minmax(14rem,1.4fr)_8rem_8rem_9rem_8rem_2rem] gap-4 border-b border-border-active/70 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted lg:grid">
            <span>Owner / agent</span><span>Track</span><span>State</span><span>Cost</span><span>Accepted</span><span />
          </div>
          {data.reviews.map((review) => (
            <ReviewLedgerRow
              key={review.id}
              review={review}
              expanded={expandedId === review.id}
              detail={details[review.id]}
              loading={loadingDetailId === review.id}
              onToggle={() => onToggle(review.id)}
            />
          ))}
        </div>
      )}
      {data.truncated && <p className="text-center text-xs text-text-muted">Showing the newest 250 matching reviews.</p>}
    </div>
  );
}

function ReviewFilters({
  value,
  busy,
  onChange,
  onApply,
  onClear,
}: {
  value: AdminOwnerLearningReviewFilters;
  busy: boolean;
  onChange: (value: AdminOwnerLearningReviewFilters) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const fieldClass = "mt-1.5 w-full rounded-lg border border-border-active bg-black/15 px-3 py-2 text-xs text-text-primary outline-none transition focus:border-indigo-400/60";
  return (
    <form
      className="influence-panel rounded-2xl p-4"
      onSubmit={(event) => { event.preventDefault(); onApply(); }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <FilterLabel label="From"><input type="date" className={fieldClass} value={value.dateFrom ?? ""} onChange={(event) => onChange({ ...value, dateFrom: event.target.value || undefined })} /></FilterLabel>
        <FilterLabel label="To"><input type="date" className={fieldClass} value={value.dateTo ?? ""} onChange={(event) => onChange({ ...value, dateTo: event.target.value || undefined })} /></FilterLabel>
        <FilterLabel label="Track"><select className={fieldClass} value={value.track ?? ""} onChange={(event) => onChange({ ...value, track: optionalTrack(event.target.value) })}><option value="">All tracks</option><option value="evidence_rich">Evidence-rich</option><option value="strategy_health_check">Health check</option></select></FilterLabel>
        <FilterLabel label="Status"><select className={fieldClass} value={value.status ?? ""} onChange={(event) => onChange({ ...value, status: optionalStatus(event.target.value) })}><option value="">All states</option><option value="queued">Queued</option><option value="running">Running</option><option value="ready">Ready</option><option value="no_change">No change</option><option value="failed">Failed</option></select></FilterLabel>
        <FilterLabel label="Resolution"><select className={fieldClass} value={value.resolution ?? ""} onChange={(event) => onChange({ ...value, resolution: optionalResolution(event.target.value) })}><option value="">All outcomes</option><option value="open">Open</option><option value="applied">Applied</option><option value="manual_update">Manual update</option><option value="declined">Declined</option><option value="no_change">No change</option><option value="failed">Failed</option><option value="superseded">Superseded</option></select></FilterLabel>
        <FilterLabel label="Accepted"><select className={fieldClass} value={value.application ?? ""} onChange={(event) => onChange({ ...value, application: optionalAcceptance(event.target.value) })}><option value="">Any</option><option value="accepted">Yes</option><option value="not_accepted">No</option><option value="not_applicable">N/A</option><option value="pending">Pending</option></select></FilterLabel>
        <FilterLabel label="Diagnosis"><input type="search" maxLength={200} placeholder="contains…" className={fieldClass} value={value.diagnosis ?? ""} onChange={(event) => onChange({ ...value, diagnosis: event.target.value || undefined })} /></FilterLabel>
        <FilterLabel label="Model"><input type="search" maxLength={200} placeholder="exact model" className={fieldClass} value={value.model ?? ""} onChange={(event) => onChange({ ...value, model: event.target.value || undefined })} /></FilterLabel>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={onClear} className="influence-button-secondary rounded-lg px-4 py-2 text-xs disabled:opacity-50">Clear</button>
        <button type="submit" disabled={busy} className="influence-button-primary rounded-lg px-4 py-2 text-xs disabled:opacity-50">{busy ? "Filtering…" : "Apply filters"}</button>
      </div>
    </form>
  );
}

function AnalyticsStrip({ data }: { data: AdminOwnerLearningReviewList }) {
  const { analytics } = data;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Metric eyebrow="Reviews" value={analytics.reviewCount.toLocaleString()} detail={`${analytics.eventCounts.review_started ?? 0} purchased starts`} />
      <Metric eyebrow="Completed" value={String((analytics.eventCounts.recommendations_viewed ?? 0) + (analytics.eventCounts.review_resolved ?? 0))} detail="view or resolution signals" />
      <Metric eyebrow="Output" value={analytics.tokens.totalOutput.toLocaleString()} detail={`${analytics.tokens.reasoning.toLocaleString()} reasoning · ${analytics.tokens.visibleOutput.toLocaleString()} visible`} />
      <Metric eyebrow="Recorded cost" value={formatMicrousd(analytics.cost.actualMicrousd + analytics.cost.estimatedMicrousd)} detail={`${formatMicrousd(analytics.cost.actualMicrousd)} actual · ${formatMicrousd(analytics.cost.estimatedMicrousd)} estimated`} />
      <Metric eyebrow="Unpriced" value={analytics.cost.unavailableCallCount.toLocaleString()} detail="calls remain unknown, never $0" warning={analytics.cost.unavailableCallCount > 0} />
    </div>
  );
}

function Metric({ eyebrow, value, detail, warning = false }: { eyebrow: string; value: string; detail: string; warning?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${warning ? "border-amber-300/20 bg-amber-300/[0.05]" : "border-border-active/70 bg-surface-raised/60"}`}>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">{eyebrow}</p>
      <p className="mt-2 font-mono text-xl font-semibold tabular-nums text-text-primary">{value}</p>
      <p className="mt-1 text-[11px] text-text-muted">{detail}</p>
    </div>
  );
}

function ReviewLedgerRow({
  review,
  expanded,
  detail,
  loading,
  onToggle,
}: {
  review: AdminOwnerLearningReviewSummary;
  expanded: boolean;
  detail?: AdminOwnerLearningReviewDetail;
  loading: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="border-b border-border-active/50 last:border-b-0">
      <button
        type="button"
        data-review-id={review.id}
        aria-expanded={expanded}
        onClick={onToggle}
        className="grid w-full gap-4 px-5 py-5 text-left transition hover:bg-white/[0.025] lg:grid-cols-[minmax(14rem,1.4fr)_8rem_8rem_9rem_8rem_2rem] lg:items-center"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-text-primary">{review.agent.name}</span>
            <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[9px] text-text-muted">r{review.reviewedRevision.ordinal}</span>
          </div>
          <p className="mt-1 truncate text-xs text-text-muted">{review.owner.displayName ?? review.owner.handle ?? review.owner.userId}</p>
          <p className="mt-2 line-clamp-1 text-xs leading-5 text-text-secondary lg:hidden">{review.diagnosis ?? "Analysis is still cooking."}</p>
        </div>
        <LedgerCell label="Track"><TrackBadge track={review.track} /></LedgerCell>
        <LedgerCell label="State"><StateBadge value={review.resolution ?? review.status} /></LedgerCell>
        <LedgerCell label="Cost"><CostSummary cost={review.cost} /></LedgerCell>
        <LedgerCell label="Accepted"><AcceptanceBadge value={review.acceptance} /></LedgerCell>
        <span aria-hidden="true" className={`text-lg text-text-muted transition-transform ${expanded ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {expanded && (
        <div className="border-t border-border-active/50 bg-black/[0.08] px-5 py-6">
          {loading && <p role="status" className="text-xs text-text-muted">Loading validated review artifact…</p>}
          {detail && <ReviewDetail detail={detail} />}
        </div>
      )}
    </article>
  );
}

function ReviewDetail({ detail }: { detail: AdminOwnerLearningReviewDetail }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.75fr)]">
        <div className="rounded-2xl border border-indigo-300/15 bg-indigo-300/[0.04] p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-indigo-200/60">Validated diagnosis</p>
          <p className="mt-3 whitespace-pre-wrap text-base leading-7 text-text-primary">{detail.result?.diagnosis ?? "No validated diagnosis yet."}</p>
          {detail.result?.strategyHealthClassification && <p className="mt-3 text-xs text-text-muted">Health classification · {humanize(detail.result.strategyHealthClassification)}</p>}
        </div>
        <div className="rounded-2xl border border-border-active/70 p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Identity & policy</p>
          <dl className="mt-3 space-y-2 text-xs">
            <InlineFact label="Review" value={detail.id} mono />
            <InlineFact label="Profile" value={detail.agent.profileId} mono />
            <InlineFact label="Revision" value={`${detail.reviewedRevision.id} · r${detail.reviewedRevision.ordinal}`} mono />
            <InlineFact label="Model" value={detail.policy.model} mono />
            <InlineFact label="Reviewer" value={detail.policy.reviewer} mono />
            <InlineFact label="Eligibility" value={detail.policy.eligibility} mono />
            <InlineFact label="Provider" value={detail.policy.provider} mono />
            <InlineFact label="Created" value={formatDateTime(detail.lifecycle.createdAt)} />
            <InlineFact label="Completed" value={detail.lifecycle.completedAt ? formatDateTime(detail.lifecycle.completedAt) : "not complete"} />
            <InlineFact label="Budget used" value={`${detail.lifecycle.logicalCallCount} calls · ${detail.lifecycle.diveCount} dives`} />
            {(detail.lifecycle.capacitySubstatus || detail.lifecycle.safeFailureCode) && (
              <InlineFact label="Diagnostic" value={detail.lifecycle.safeFailureCode ?? detail.lifecycle.capacitySubstatus ?? "none"} mono />
            )}
          </dl>
        </div>
      </div>

      <div>
        <SectionHeading eyebrow="Evidence set" title={`${detail.selectedGames.length} selected Daily Free game${detail.selectedGames.length === 1 ? "" : "s"}`} />
        <div className="mt-3 flex flex-wrap gap-2">
          {detail.selectedGames.map((game) => (
            <span key={game.gameId} className="rounded-xl border border-border-active/70 bg-white/[0.02] px-3 py-2 text-xs text-text-secondary">
              <span className="font-mono text-[9px] text-text-muted">#{game.position}</span> {game.slug}
              {game.previouslyAnalyzed && <span className="ml-2 text-indigo-200/60">Previously analyzed</span>}
            </span>
          ))}
        </div>
      </div>

      <div>
        <SectionHeading eyebrow="Recommendation set" title={`${detail.result?.recommendations.length ?? 0} recommendation${detail.result?.recommendations.length === 1 ? "" : "s"}`} />
        <div className="mt-3 grid gap-3 xl:grid-cols-3">
          {(detail.result?.recommendations ?? []).map((recommendation, index) => {
            const acceptance = detail.recommendationAcceptance[index]?.state ?? "not_accepted";
            return (
              <div key={recommendation.id ?? `${detail.id}-${index}`} className="rounded-2xl border border-border-active/70 bg-surface-raised/40 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.17em] text-text-muted">{humanize(recommendation.disposition)} · {recommendation.confidence}</p>
                    <h4 className="mt-2 text-sm font-semibold leading-5 text-text-primary">{recommendation.title}</h4>
                  </div>
                  <RecommendationAcceptance value={acceptance} />
                </div>
                <p className="mt-4 whitespace-pre-wrap text-xs leading-6 text-text-secondary">{recommendation.rationale}</p>
                {recommendation.keepGuidance && <PlainTextBlock label="Keep guidance" text={recommendation.keepGuidance} />}
                {recommendation.proof && (
                  <div className="mt-4 space-y-3 border-t border-border-active/60 pt-4">
                    <ProofFact label="Observed" value={recommendation.proof.observedEvidence} />
                    <ProofFact label="Interpretation" value={recommendation.proof.strategicInterpretation} />
                    <ProofFact label="Guidance" value={recommendation.proof.proposedGuidance} />
                    <p className="font-mono text-[10px] text-text-muted">{humanize(recommendation.proof.kind)}{recommendation.proof.rubricCategory ? ` · ${humanize(recommendation.proof.rubricCategory)}` : ""}</p>
                  </div>
                )}
                {recommendation.evidenceRefs.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Server-minted evidence references">
                    {recommendation.evidenceRefs.map((ref) => (
                      <span key={`${ref.gameId}:${ref.coordinate}`} className="rounded-md border border-cyan-300/15 bg-cyan-300/[0.04] px-2 py-1 font-mono text-[9px] text-cyan-100/60">
                        {humanize(ref.kind)} · {ref.coordinate}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {detail.result?.proposal && (
        <div>
          <SectionHeading eyebrow="Exact proposal" title="Strategy diff" />
          <div className="mt-3 grid overflow-hidden rounded-2xl border border-border-active/70 lg:grid-cols-2">
            <DiffBlock label="Before" text={detail.result.proposal.before} tone="before" />
            <DiffBlock label="After" text={detail.result.proposal.after} tone="after" />
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <ReceiptPanel detail={detail} />
        <GameCorrelation detail={detail} />
      </div>
      <CallLedger detail={detail} />
    </div>
  );
}

function ReceiptPanel({ detail }: { detail: AdminOwnerLearningReviewDetail }) {
  return (
    <div className="rounded-2xl border border-border-active/70 p-5">
      <SectionHeading eyebrow="Owner outcome" title={humanize(detail.disposition)} />
      <div className="mt-4 flex flex-wrap gap-2">
        <AcceptanceBadge value={detail.acceptance} />
        <StateBadge value={detail.lifecycle.resolution ?? detail.lifecycle.status} />
      </div>
      {detail.application ? (
        <dl className="mt-5 space-y-2 text-xs">
          <InlineFact label="Applied" value={formatDateTime(detail.application.appliedAt)} />
          <InlineFact label="Prior revision" value={detail.application.priorRevisionId} mono />
          <InlineFact label="Resulting revision" value={detail.application.resultingRevisionId} mono />
          <InlineFact label="Receipt" value={`${detail.application.mutationReceipt.operation ?? "unknown"} · ${detail.application.mutationReceipt.profileRevision?.outcome ?? "unknown"}`} />
          <InlineFact label="Waiting seats" value={String(detail.application.mutationReceipt.waitingSeats?.reconciled ?? 0)} />
        </dl>
      ) : (
        <p className="mt-4 text-xs leading-5 text-text-muted">No exact-proposal application receipt. Manual updates remain review-driven but do not count as acceptance.</p>
      )}
    </div>
  );
}

function GameCorrelation({ detail }: { detail: AdminOwnerLearningReviewDetail }) {
  return (
    <div className="rounded-2xl border border-border-active/70 p-5">
      <SectionHeading eyebrow="Return to play" title="Daily Free on the executed revision" />
      {detail.subsequentDailyFree ? (
        <>
          <p className="mt-3 text-xs leading-5 text-amber-100/60">{detail.subsequentDailyFree.label}</p>
          <div className="mt-4 space-y-2">
            {detail.subsequentDailyFree.games.length === 0 ? (
              <p className="text-xs text-text-muted">No later Daily Free game has executed this revision yet.</p>
            ) : detail.subsequentDailyFree.games.map((game) => (
              <div key={game.gameId} className="flex items-center justify-between rounded-lg bg-white/[0.025] px-3 py-2 text-xs">
                <span className="text-text-secondary">{game.slug}</span>
                <span className="font-mono text-text-muted">#{game.placement}/{game.lobbySize} · {game.totalPoints} pts</span>
              </div>
            ))}
          </div>
        </>
      ) : <p className="mt-3 text-xs leading-5 text-text-muted">This resolution does not persist a trustworthy resulting revision, so no later-game attribution is shown.</p>}
    </div>
  );
}

function CallLedger({ detail }: { detail: AdminOwnerLearningReviewDetail }) {
  return (
    <div>
      <SectionHeading eyebrow="Immutable accounting" title={`${detail.calls.length} logical call${detail.calls.length === 1 ? "" : "s"}`} />
      <div className="mt-3 overflow-x-auto rounded-2xl border border-border-active/70">
        <table className="min-w-[760px] w-full text-xs">
          <thead className="bg-white/[0.025] font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted">
            <tr><th className="px-4 py-3 text-left">Call</th><th className="px-4 py-3 text-left">Capacity</th><th className="px-4 py-3 text-right">Input / cached</th><th className="px-4 py-3 text-right">Output / reasoning</th><th className="px-4 py-3 text-right">Latency</th><th className="px-4 py-3 text-right">Cost</th></tr>
          </thead>
          <tbody>{detail.calls.map((call) => (
            <tr key={call.ordinal} className="border-t border-border-active/50">
              <td className="px-4 py-3"><span className="text-text-primary">#{call.ordinal}</span><span className="ml-2 text-text-muted">{call.state}</span></td>
              <td className="px-4 py-3 text-text-secondary">
                {call.requestedTier} → {call.effectiveTier ?? (call.terminalHttpStatus == null ? "unknown" : `HTTP ${call.terminalHttpStatus}`)}
                <span className="block text-[10px] text-text-muted">{call.capacityPath ?? "not recorded"} · {call.flex429Count} Flex 429</span>
                {call.providerRequestId && <span className="block font-mono text-[9px] text-text-muted">{call.providerRequestId}</span>}
              </td>
              <td className="px-4 py-3 text-right font-mono text-text-secondary">{formatOptionalInt(call.tokens.input)} / {formatOptionalInt(call.tokens.cachedInput)}</td>
              <td className="px-4 py-3 text-right font-mono text-text-secondary">{formatOptionalInt(call.tokens.totalOutput)} / {formatOptionalInt(call.tokens.reasoning)}</td>
              <td className="px-4 py-3 text-right font-mono text-text-muted">{call.latencyMs == null ? "unknown" : `${call.latencyMs.toLocaleString()} ms`}</td>
              <td className="px-4 py-3 text-right"><span className="font-mono text-text-primary">{call.cost.microusd == null ? "unknown" : formatMicrousd(call.cost.microusd)}</span><span className="block text-[10px] text-text-muted">{call.cost.source}{call.cost.rateCardVersion ? ` · ${call.cost.rateCardVersion}` : ""}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function FilterLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">{label}{children}</label>;
}

function LedgerCell({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><span className="mb-1 block font-mono text-[9px] uppercase tracking-wider text-text-muted lg:hidden">{label}</span>{children}</div>;
}

function TrackBadge({ track }: { track: AdminOwnerLearningReviewSummary["track"] }) {
  return <span className="text-xs text-text-secondary">{track === "strategy_health_check" ? "Health check" : "Evidence-rich"}</span>;
}

function StateBadge({ value }: { value: string }) {
  const warm = ["failed", "superseded", "declined"].includes(value);
  return <span className={`inline-flex rounded-full border px-2 py-1 font-mono text-[9px] uppercase tracking-wider ${warm ? "border-amber-300/20 bg-amber-300/[0.06] text-amber-100/70" : "border-white/10 bg-white/[0.03] text-text-secondary"}`}>{humanize(value)}</span>;
}

function AcceptanceBadge({ value }: { value: AdminOwnerLearningAcceptance }) {
  const style = value === "accepted"
    ? "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-100/80"
    : value === "pending"
      ? "border-indigo-300/20 bg-indigo-300/[0.07] text-indigo-100/70"
      : "border-white/10 bg-white/[0.03] text-text-muted";
  return <span className={`inline-flex rounded-full border px-2 py-1 font-mono text-[9px] uppercase tracking-wider ${style}`}>{value === "accepted" ? "Yes" : value === "not_accepted" ? "No" : value === "not_applicable" ? "N/A" : "Pending"}</span>;
}

function RecommendationAcceptance({ value }: { value: "accepted" | "not_accepted" | "not_applicable" }) {
  return <span className={`shrink-0 rounded-full px-2 py-1 font-mono text-[9px] uppercase tracking-wider ${value === "accepted" ? "bg-emerald-300/10 text-emerald-100/80" : "bg-white/[0.04] text-text-muted"}`}>{humanize(value)}</span>;
}

function CostSummary({ cost }: { cost: AdminOwnerLearningReviewSummary["cost"] }) {
  const recorded = cost.actualMicrousd + cost.estimatedMicrousd;
  return <div><span className="font-mono text-xs text-text-primary">{recorded > 0 ? formatMicrousd(recorded) : cost.unavailableCallCount > 0 ? "unknown" : "$0.00"}</span><span className="mt-1 block text-[10px] text-text-muted">{cost.actualMicrousd > 0 ? "actual" : cost.estimatedMicrousd > 0 ? "estimated" : cost.unavailableCallCount > 0 ? `${cost.unavailableCallCount} unpriced` : "no spend"}</span></div>;
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">{eyebrow}</p><h3 className="mt-1 text-sm font-semibold text-text-primary">{title}</h3></div>;
}

function InlineFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3"><dt className="text-text-muted">{label}</dt><dd className={`break-all text-text-secondary ${mono ? "font-mono text-[10px]" : ""}`}>{value}</dd></div>;
}

function PlainTextBlock({ label, text }: { label: string; text: string }) {
  return <div className="mt-4"><p className="font-mono text-[9px] uppercase tracking-wider text-text-muted">{label}</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-text-secondary">{text}</p></div>;
}

function ProofFact({ label, value }: { label: string; value: string }) {
  return <div><p className="font-mono text-[9px] uppercase tracking-wider text-text-muted">{label}</p><p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-text-secondary">{value}</p></div>;
}

function DiffBlock({ label, text, tone }: { label: string; text: string; tone: "before" | "after" }) {
  return <div className={`p-5 lg:first:border-r lg:first:border-border-active/70 ${tone === "after" ? "bg-emerald-300/[0.035]" : "bg-red-300/[0.025]"}`}><p className={`font-mono text-[10px] uppercase tracking-[0.18em] ${tone === "after" ? "text-emerald-200/60" : "text-red-200/50"}`}>{label}</p><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{text}</p></div>;
}

function optionalTrack(value: string): AdminOwnerLearningReviewFilters["track"] {
  return value === "evidence_rich" || value === "strategy_health_check" ? value : undefined;
}

function optionalStatus(value: string): AdminOwnerLearningReviewFilters["status"] {
  return ["queued", "running", "ready", "no_change", "failed"].includes(value)
    ? value as AdminOwnerLearningReviewFilters["status"]
    : undefined;
}

function optionalResolution(value: string): AdminOwnerLearningReviewFilters["resolution"] {
  return ["open", "applied", "manual_update", "declined", "no_change", "failed", "superseded"].includes(value)
    ? value as AdminOwnerLearningReviewFilters["resolution"]
    : undefined;
}

function optionalAcceptance(value: string): AdminOwnerLearningAcceptance | undefined {
  return ["accepted", "not_accepted", "not_applicable", "pending"].includes(value)
    ? value as AdminOwnerLearningAcceptance
    : undefined;
}

function formatMicrousd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: value < 10_000 ? 4 : 2, maximumFractionDigits: 4 }).format(value / 1_000_000);
}

function formatOptionalInt(value: number | null): string {
  return value == null ? "unknown" : value.toLocaleString();
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}
