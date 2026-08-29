"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAdminOwnerLearningFailureContent,
  getAdminOwnerLearningReview,
  listAdminOwnerLearningReviews,
  type AdminOwnerLearningAcceptance,
  type AdminOwnerLearningFailureContent,
  type AdminOwnerLearningFailureDiagnostic,
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
  const listRequest = useRef(0);
  const detailRequest = useRef(0);

  const refresh = useCallback(async (nextFilters: AdminOwnerLearningReviewFilters) => {
    const requestId = ++listRequest.current;
    setLoading(true);
    setError(null);
    try {
      const next = await listAdminOwnerLearningReviews(nextFilters);
      if (requestId !== listRequest.current) return;
      setData(next);
    } catch (cause) {
      if (requestId !== listRequest.current) return;
      setError(cause instanceof Error ? cause.message : "Could not load the review ledger.");
    } finally {
      if (requestId === listRequest.current) setLoading(false);
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
            Monitor review lifecycle, provider errors, usage receipts, cost, and user action.
          </p>
        </div>
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
            <span>Owner / agent</span><span>Track</span><span>State</span><span>Cost</span><span>Action</span><span />
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <FilterLabel label="From"><input type="date" className={fieldClass} value={value.dateFrom ?? ""} onChange={(event) => onChange({ ...value, dateFrom: event.target.value || undefined })} /></FilterLabel>
        <FilterLabel label="To"><input type="date" className={fieldClass} value={value.dateTo ?? ""} onChange={(event) => onChange({ ...value, dateTo: event.target.value || undefined })} /></FilterLabel>
        <FilterLabel label="Track"><select className={fieldClass} value={value.track ?? ""} onChange={(event) => onChange({ ...value, track: optionalTrack(event.target.value) })}><option value="">All tracks</option><option value="evidence_rich">Evidence-rich</option><option value="strategy_health_check">Health check</option></select></FilterLabel>
        <FilterLabel label="Status"><select className={fieldClass} value={value.status ?? ""} onChange={(event) => onChange({ ...value, status: optionalStatus(event.target.value) })}><option value="">All states</option><option value="queued">Queued</option><option value="retry_queued">Recovery queued</option><option value="running">Running</option><option value="ready">Ready</option><option value="no_change">No change</option><option value="failed">Failed</option></select></FilterLabel>
        <FilterLabel label="Resolution"><select className={fieldClass} value={value.resolution ?? ""} onChange={(event) => onChange({ ...value, resolution: optionalResolution(event.target.value) })}><option value="">All outcomes</option><option value="open">Open</option><option value="applied">Applied</option><option value="manual_update">Manual update</option><option value="declined">Declined</option><option value="no_change">No change</option><option value="failed">Failed</option><option value="superseded">Superseded</option></select></FilterLabel>
        <FilterLabel label="Action"><select className={fieldClass} value={value.application ?? ""} onChange={(event) => onChange({ ...value, application: optionalAcceptance(event.target.value) })}><option value="">Any</option><option value="accepted">Applied</option><option value="not_accepted">Other / none</option><option value="not_applicable">No change</option><option value="pending">Pending</option></select></FilterLabel>
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
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric eyebrow="Reviews" value={analytics.reviewCount.toLocaleString()} detail={`${analytics.eventCounts.review_started ?? 0} purchased starts`} />
      <Metric eyebrow="User activity" value={String((analytics.eventCounts.recommendations_viewed ?? 0) + (analytics.eventCounts.review_resolved ?? 0))} detail="views + resolutions" />
      <Metric eyebrow="Tokens" value={analytics.tokens.totalOutput.toLocaleString()} detail={`${analytics.tokens.reasoning.toLocaleString()} reasoning · ${analytics.tokens.visibleOutput.toLocaleString()} visible`} />
      <Metric eyebrow="Recorded cost" value={formatRecordedCost(analytics.cost)} detail={formatRecordedCostDetail(analytics.cost)} />
    </div>
  );
}

function Metric({ eyebrow, value, detail }: { eyebrow: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-border-active/70 bg-surface-raised/60 p-4">
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
          {review.failure && <p className="mt-1 truncate font-mono text-[9px] text-amber-100/70">{review.failure.safeFailureCode} · {review.failure.phase ?? "legacy"} · {review.failure.evidence.state}</p>}
          <p className="mt-2 line-clamp-1 text-xs leading-5 text-text-secondary lg:hidden">{humanize(review.resolution ?? review.status)}</p>
        </div>
        <LedgerCell label="Track"><TrackBadge track={review.track} /></LedgerCell>
        <LedgerCell label="State"><StateBadge value={review.resolution ?? review.status} /></LedgerCell>
        <LedgerCell label="Cost"><CostSummary cost={review.cost} /></LedgerCell>
        <LedgerCell label="Action"><ActionBadge value={review.disposition} /></LedgerCell>
        <span aria-hidden="true" className={`text-lg text-text-muted transition-transform ${expanded ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {expanded && (
        <div className="border-t border-border-active/50 bg-black/[0.08] px-5 py-6">
          {loading && <p role="status" className="text-xs text-text-muted">Loading review diagnostics…</p>}
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
        <ReceiptPanel detail={detail} />
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
            <InlineFact label="Execution phase" value={detail.lifecycle.executionPhase ?? "not active"} mono />
            <InlineFact label="Owner recovery" value={`${detail.lifecycle.ownerRetryCount}/1 used · ${detail.lifecycle.ownerRetriesRemaining} remaining`} />
            {(detail.lifecycle.capacitySubstatus || detail.lifecycle.safeFailureCode) && (
              <InlineFact label="Diagnostic" value={detail.lifecycle.safeFailureCode ?? detail.lifecycle.capacitySubstatus ?? "none"} mono />
            )}
          </dl>
        </div>
      </div>
      {detail.diagnostics.length > 0 && <FailureDiagnostics detail={detail} />}
      <CallLedger detail={detail} />
    </div>
  );
}

function ReceiptPanel({ detail }: { detail: AdminOwnerLearningReviewDetail }) {
  return (
    <div className="rounded-2xl border border-border-active/70 p-5">
      <SectionHeading eyebrow="User action" title={userActionLabel(detail)} />
      <div className="mt-4 flex flex-wrap gap-2">
        <ActionBadge value={detail.disposition} />
        <StateBadge value={detail.lifecycle.resolution ?? detail.lifecycle.status} />
      </div>
      {detail.application ? (
        <dl className="mt-5 space-y-2 text-xs">
          <InlineFact label="Applied" value={formatDateTime(detail.application.appliedAt)} />
        </dl>
      ) : null}
    </div>
  );
}

function FailureDiagnostics({ detail }: { detail: AdminOwnerLearningReviewDetail }) {
  return (
    <div>
      <SectionHeading
        eyebrow="Failure diagnostics"
        title={`${detail.diagnostics.length} append-only diagnostic${detail.diagnostics.length === 1 ? "" : "s"}`}
      />
      <div className="mt-3 space-y-3">
        {detail.diagnostics.map((diagnostic) => (
          <FailureDiagnosticCard key={diagnostic.id} reviewId={detail.id} diagnostic={diagnostic} />
        ))}
      </div>
    </div>
  );
}

function FailureDiagnosticCard({
  reviewId,
  diagnostic,
}: {
  reviewId: string;
  diagnostic: AdminOwnerLearningFailureDiagnostic;
}) {
  const [preview, setPreview] = useState<AdminOwnerLearningFailureContent | null>(null);
  const [busy, setBusy] = useState<"preview" | "copy" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview() {
    setBusy("preview");
    setError(null);
    try {
      setPreview(await getAdminOwnerLearningFailureContent(reviewId, diagnostic.id, { maxBytes: 64 * 1024 }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load diagnostic evidence.");
    } finally {
      setBusy(null);
    }
  }

  async function copyComplete() {
    setBusy("copy");
    setError(null);
    try {
      const bytes = await loadCompleteFailureEvidenceBytes(reviewId, diagnostic.id);
      await navigator.clipboard.writeText(new TextDecoder().decode(bytes));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not copy diagnostic evidence.");
    } finally {
      setBusy(null);
    }
  }

  async function downloadComplete() {
    setBusy("download");
    setError(null);
    try {
      const content = await loadCompleteFailureEvidenceBytes(reviewId, diagnostic.id);
      const downloadBuffer = new ArrayBuffer(content.byteLength);
      new Uint8Array(downloadBuffer).set(content);
      const url = URL.createObjectURL(new Blob([downloadBuffer], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `owner-review-${reviewId}-${diagnostic.id}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not download diagnostic evidence.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.035] p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.65fr)]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StateBadge value={diagnostic.safeFailureCode} />
            <span className="font-mono text-[10px] text-text-muted">{diagnostic.phase ?? "legacy phase unavailable"}</span>
            <span className="font-mono text-[10px] text-text-muted">evidence: {diagnostic.evidence.state}</span>
          </div>
          <p className="mt-3 text-sm text-text-primary">{diagnostic.message}</p>
          {diagnostic.firstApplicationStackFrame && (
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-black/20 p-3 font-mono text-[10px] text-text-secondary">{diagnostic.firstApplicationStackFrame}</pre>
          )}
        </div>
        <dl className="space-y-2 text-xs">
          <InlineFact label="Diagnostic" value={diagnostic.id} mono />
          <InlineFact label="Fingerprint" value={diagnostic.fingerprint} mono />
          <InlineFact label="Error" value={[diagnostic.errorClass, diagnostic.errorCode].filter(Boolean).join(" · ")} mono />
          <InlineFact label="Attempt" value={diagnostic.callOrdinal == null ? "not reserved" : `${diagnostic.callOrdinal}.${diagnostic.attemptOrdinal}`} mono />
          <InlineFact label="Provider request" value={diagnostic.providerRequestId ?? "not observed"} mono />
          <InlineFact label="Provider response" value={diagnostic.providerResponseId ?? "not observed"} mono />
          <InlineFact label="Manifest" value={diagnostic.evidence.manifestId} mono />
        </dl>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => { void loadPreview(); }} disabled={busy != null} className="influence-button-secondary rounded-lg px-3 py-2 text-xs disabled:opacity-50">
          {busy === "preview" ? "Loading…" : "Preview evidence"}
        </button>
        <button type="button" onClick={() => { void copyComplete(); }} disabled={busy != null || diagnostic.evidence.state !== "stored"} className="influence-button-secondary rounded-lg px-3 py-2 text-xs disabled:opacity-50">
          {busy === "copy" ? "Copying…" : "Copy complete evidence"}
        </button>
        <button type="button" onClick={() => { void downloadComplete(); }} disabled={busy != null || diagnostic.evidence.state !== "stored"} className="influence-button-secondary rounded-lg px-3 py-2 text-xs disabled:opacity-50">
          {busy === "download" ? "Downloading…" : "Download complete evidence"}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-red-200">{error}</p>}
      {preview && "content" in preview && (
        <div className="mt-4">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-text-muted">
            Escaped text preview · {preview.returnedByteLength.toLocaleString()} of {preview.totalByteLength.toLocaleString()} bytes · {preview.hashScope} {preview.sha256}
          </p>
          <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-all rounded-xl border border-white/10 bg-black/30 p-4 font-mono text-[10px] leading-5 text-text-secondary">{preview.content}</pre>
        </div>
      )}
      {preview && !("content" in preview) && (
        <p className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-text-secondary">
          {preview.state}: {preview.error}
        </p>
      )}
    </article>
  );
}

export async function loadCompleteFailureEvidenceBytes(
  reviewId: string,
  diagnosticId: string,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let offsetBytes = 0;
  let expectedByteLength: number | null = null;
  let expectedSha256: string | null = null;
  for (;;) {
    const chunk = await getAdminOwnerLearningFailureContent(reviewId, diagnosticId, {
      offsetBytes,
      maxBytes: 1024 * 1024,
    });
    if (!("content" in chunk)) throw new Error(chunk.error);
    if (chunk.offsetBytes !== offsetBytes) {
      throw new Error("Diagnostic evidence range did not start at the requested byte");
    }
    expectedByteLength ??= chunk.manifest.byteLength;
    expectedSha256 ??= chunk.manifest.sha256;
    if (
      chunk.totalByteLength !== expectedByteLength
      || chunk.manifest.byteLength !== expectedByteLength
      || chunk.manifest.sha256 !== expectedSha256
    ) {
      throw new Error("Diagnostic evidence manifest changed during the download");
    }
    const bytes = decodeBase64Bytes(chunk.contentBase64);
    if (bytes.byteLength !== chunk.returnedByteLength) {
      throw new Error("Diagnostic evidence byte length did not match the response metadata");
    }
    if (bytes.byteLength === 0) {
      throw new Error("Diagnostic evidence returned an empty chunk before the object was complete");
    }
    chunks.push(bytes);
    totalBytes += bytes.byteLength;
    if (!chunk.truncated) {
      const complete = new Uint8Array(totalBytes);
      let cursor = 0;
      for (const part of chunks) {
        complete.set(part, cursor);
        cursor += part.byteLength;
      }
      if (complete.byteLength !== expectedByteLength) {
        throw new Error("Diagnostic evidence total byte length did not match the manifest");
      }
      if (await sha256EvidenceBytes(complete) !== expectedSha256) {
        throw new Error("Diagnostic evidence hash did not match the manifest");
      }
      return complete;
    }
    if (
      chunk.nextOffsetBytes == null
      || chunk.nextOffsetBytes !== offsetBytes + bytes.byteLength
      || chunk.nextOffsetBytes <= offsetBytes
    ) {
      throw new Error("Diagnostic evidence range did not advance");
    }
    offsetBytes = chunk.nextOffsetBytes;
  }
}

async function sha256EvidenceBytes(value: Uint8Array): Promise<string> {
  const input = new Uint8Array(value.byteLength);
  input.set(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input.buffer));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function decodeBase64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function CallLedger({ detail }: { detail: AdminOwnerLearningReviewDetail }) {
  return (
    <div>
      <SectionHeading eyebrow="Immutable accounting" title={`${detail.calls.length} invocation attempt${detail.calls.length === 1 ? "" : "s"}`} />
      <div className="mt-3 overflow-x-auto rounded-2xl border border-border-active/70">
        <table className="min-w-[760px] w-full text-xs">
          <thead className="bg-white/[0.025] font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted">
            <tr><th className="px-4 py-3 text-left">Call</th><th className="px-4 py-3 text-left">Capacity</th><th className="px-4 py-3 text-right">Input / cached</th><th className="px-4 py-3 text-right">Output / reasoning</th><th className="px-4 py-3 text-right">Latency</th><th className="px-4 py-3 text-right">Cost</th></tr>
          </thead>
          <tbody>{detail.calls.map((call) => (
            <tr key={call.id} className="border-t border-border-active/50">
              <td className="px-4 py-3">
                <span className="text-text-primary">#{call.ordinal} · attempt {call.attemptOrdinal}</span>
                <span className="ml-2 text-text-muted">{call.state}</span>
                {call.executionKind === "local_recovery" && (
                  <span className="block text-[10px] text-emerald-100/70">local recovery · no provider charge</span>
                )}
                {call.retryOfAttemptId && <span className="block font-mono text-[9px] text-text-muted">retry of {call.retryOfAttemptId}</span>}
                <span className="block font-mono text-[9px] text-text-muted">{call.providerTurnProtocol}</span>
              </td>
              <td className="px-4 py-3 text-text-secondary">
                {call.requestedTier} → {call.effectiveTier ?? (call.terminalHttpStatus == null ? "unknown" : `HTTP ${call.terminalHttpStatus}`)}
                <span className="block text-[10px] text-text-muted">{call.capacityPath ?? "not recorded"} · {call.flex429Count} Flex 429</span>
                {call.providerRequestId && <span className="block font-mono text-[9px] text-text-muted">{call.providerRequestId}</span>}
                {call.providerResponseId && <span className="block font-mono text-[9px] text-text-muted">response {call.providerResponseId}</span>}
                {(call.requestEvidence.sha256 || call.responseEvidence.sha256) && (
                  <span className="block font-mono text-[9px] text-text-muted">
                    request {call.requestEvidence.byteLength?.toLocaleString() ?? "?"} B · response {call.responseEvidence.byteLength?.toLocaleString() ?? "pending"}{call.responseEvidence.byteLength == null ? "" : " B"}
                  </span>
                )}
                {call.safeFailureCode && <span className="block text-[10px] text-amber-100/70">Diagnostic: {humanize(call.safeFailureCode)}</span>}
                {call.failureDiagnosticId && <span className="block font-mono text-[9px] text-text-muted">{call.evidenceState} · {call.failureDiagnosticId}</span>}
              </td>
              <td className="px-4 py-3 text-right font-mono text-text-secondary">{formatOptionalInt(call.tokens.input)} / {formatOptionalInt(call.tokens.cachedInput)}</td>
              <td className="px-4 py-3 text-right font-mono text-text-secondary">{formatOptionalInt(call.tokens.totalOutput)} / {formatOptionalInt(call.tokens.reasoning)}</td>
              <td className="px-4 py-3 text-right font-mono text-text-muted">{call.latencyMs == null ? "unknown" : `${call.latencyMs.toLocaleString()} ms`}</td>
              <td className="px-4 py-3 text-right"><span className="font-mono text-text-primary">{call.executionKind === "local_recovery" ? "$0.00" : call.cost.microusd == null ? "N/A" : formatMicrousd(call.cost.microusd)}</span><span className="block text-[10px] text-text-muted">{call.executionKind === "local_recovery" ? "no provider charge" : call.cost.source === "unavailable" ? "no usage receipt" : call.cost.source}{call.cost.rateCardVersion ? ` · ${call.cost.rateCardVersion}` : ""}</span></td>
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

function ActionBadge({ value }: { value: AdminOwnerLearningReviewSummary["disposition"] }) {
  const label = value === "applied"
    ? "Applied"
    : value === "manual_update"
      ? "Manual edit"
      : value === "awaiting_owner"
        ? "Pending user"
        : value === "not_ready"
          ? "No action"
          : humanize(value);
  const style = value === "applied"
    ? "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-100/80"
    : value === "manual_update"
      ? "border-indigo-300/20 bg-indigo-300/[0.07] text-indigo-100/70"
      : "border-white/10 bg-white/[0.03] text-text-muted";
  return <span className={`inline-flex rounded-full border px-2 py-1 font-mono text-[9px] uppercase tracking-wider ${style}`}>{label}</span>;
}

function CostSummary({ cost }: { cost: AdminOwnerLearningReviewSummary["cost"] }) {
  const recorded = cost.actualMicrousd + cost.estimatedMicrousd;
  return <div><span className="font-mono text-xs text-text-primary">{recorded > 0 ? formatMicrousd(recorded) : cost.unavailableCallCount > 0 ? "N/A" : "$0.00"}</span><span className="mt-1 block text-[10px] text-text-muted">{cost.actualMicrousd > 0 ? "actual" : cost.estimatedMicrousd > 0 ? "estimated" : cost.unavailableCallCount > 0 ? `${cost.unavailableCallCount} without usage receipt` : "no spend"}</span></div>;
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">{eyebrow}</p><h3 className="mt-1 text-sm font-semibold text-text-primary">{title}</h3></div>;
}

function InlineFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3"><dt className="text-text-muted">{label}</dt><dd className={`break-all text-text-secondary ${mono ? "font-mono text-[10px]" : ""}`}>{value}</dd></div>;
}

function optionalTrack(value: string): AdminOwnerLearningReviewFilters["track"] {
  return value === "evidence_rich" || value === "strategy_health_check" ? value : undefined;
}

function optionalStatus(value: string): AdminOwnerLearningReviewFilters["status"] {
  return ["queued", "retry_queued", "running", "ready", "no_change", "failed"].includes(value)
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

function formatRecordedCost(cost: AdminOwnerLearningReviewList["analytics"]["cost"]): string {
  const recorded = cost.actualMicrousd + cost.estimatedMicrousd;
  return recorded > 0 ? formatMicrousd(recorded) : cost.unavailableCallCount > 0 ? "N/A" : formatMicrousd(0);
}

function formatRecordedCostDetail(cost: AdminOwnerLearningReviewList["analytics"]["cost"]): string {
  const parts = [
    cost.actualMicrousd > 0 ? `${formatMicrousd(cost.actualMicrousd)} actual` : null,
    cost.estimatedMicrousd > 0 ? `${formatMicrousd(cost.estimatedMicrousd)} estimated` : null,
    cost.unavailableCallCount > 0
      ? `${cost.unavailableCallCount} call${cost.unavailableCallCount === 1 ? "" : "s"} without usage receipt`
      : null,
  ].filter((part): part is string => part != null);
  return parts.length > 0 ? parts.join(" · ") : "No provider spend recorded";
}

function userActionLabel(detail: AdminOwnerLearningReviewDetail): string {
  if (detail.application) return "User applied the reviewed change";
  switch (detail.lifecycle.resolution) {
    case "manual_update": return "User manually edited";
    case "declined": return "User declined";
    case "no_change": return "User chose no change";
    case "superseded": return "Superseded";
    default: return "No user action recorded";
  }
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
