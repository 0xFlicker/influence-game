"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAdminPostgameMedia,
  requestAdminPostgameMedia,
  type AdminGameSummary,
  type AdminPostgameMediaAction,
  type AdminPostgameMediaArtifactMetadata,
  type AdminPostgameMediaResponse,
} from "@/lib/api";

const ACTIVE_STATUSES = new Set(["queued", "claimed", "rendering", "composing", "uploading"]);

export function postgameMediaActionFor(
  detail: AdminPostgameMediaResponse,
): AdminPostgameMediaAction | null {
  if (detail.status === "not_requested") return "backfill";
  if (ACTIVE_STATUSES.has(detail.status)) return null;
  if (detail.status === "ready" || detail.currentReady) return "rerender";
  return "backfill";
}

export function postgameMediaRequiresConfirmation(detail: AdminPostgameMediaResponse): boolean {
  return detail.status === "ready" || Boolean(detail.status !== "not_requested" && detail.currentReady);
}

export function AdminPostgameMediaPill({
  game,
  onClick,
}: {
  game: AdminGameSummary;
  onClick: () => void;
}) {
  if (game.status !== "completed") return <span className="text-xs text-white/20">-</span>;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={`Open trailer media diagnostics for game ${game.slug}`}
      className="min-h-8 rounded-md border border-amber-700/40 bg-amber-950/30 px-2.5 py-1 text-left text-xs font-medium text-amber-100 transition-colors hover:border-amber-300/50 focus:outline-none focus:ring-2 focus:ring-amber-500"
    >
      <span className="block leading-tight">Trailer</span>
      <span className="block text-[10px] font-normal text-amber-100/55">media</span>
    </button>
  );
}

export function AdminPostgameMediaPanel({
  game,
  canManage,
  onClose,
}: {
  game: AdminGameSummary;
  canManage: boolean;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<AdminPostgameMediaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const gameKey = game.slug;

  const load = useCallback(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    getAdminPostgameMedia(gameKey)
      .then((next) => {
        if (requestIdRef.current === requestId) setDetail(next);
      })
      .catch((loadError) => {
        if (requestIdRef.current === requestId) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load trailer media diagnostics.");
        }
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
  }, [gameKey]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    load();
    return () => {
      requestIdRef.current += 1;
      previousFocus?.focus();
    };
  }, [load]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const action = useMemo(() => detail ? postgameMediaActionFor(detail) : null, [detail]);
  const requiresReadyConfirmation = detail ? postgameMediaRequiresConfirmation(detail) : false;

  async function submitAction(): Promise<void> {
    if (!action || !reason.trim()) return;
    if (requiresReadyConfirmation && !confirming) {
      setConfirming(true);
      return;
    }

    setSubmitting(true);
    setError(null);
    setFeedback(null);
    try {
      const result = await requestAdminPostgameMedia(gameKey, action, reason.trim());
      setFeedback(`${action === "rerender" ? "Rerender" : "Backfill"} requested (${result.outcome}).`);
      setReason("");
      setConfirming(false);
      load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Failed to request ${action}.`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-neutral-950 p-5 shadow-2xl sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="postgame-media-panel-title"
        data-testid="admin-postgame-media-panel"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs tracking-wide text-white/35">{game.slug}</p>
            <h2 id="postgame-media-panel-title" className="mt-1 text-xl font-semibold text-white">Trailer media</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close trailer media diagnostics"
            className="h-10 w-10 rounded-md border border-white/10 text-xl text-white/60 hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            x
          </button>
        </div>

        {loading && !detail ? <p className="mt-8 text-sm text-white/40">Loading media state...</p> : null}
        {error ? <p className="mt-5 rounded-md border border-red-800/40 bg-red-950/30 p-3 text-sm text-red-200" role="alert">{error}</p> : null}
        {feedback ? <p className="mt-5 rounded-md border border-emerald-800/40 bg-emerald-950/30 p-3 text-sm text-emerald-200" role="status">{feedback}</p> : null}

        {detail ? <AdminPostgameMediaDiagnostics detail={detail} /> : null}

        {canManage && action ? (
          <section className="mt-6 border-t border-white/10 pt-5">
            <h3 className="text-sm font-semibold text-white">{action === "rerender" ? "Request rerender" : "Request backfill"}</h3>
            <label className="mt-3 block text-xs text-white/50" htmlFor="postgame-media-reason">Reason</label>
            <textarea
              id="postgame-media-reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setConfirming(false);
              }}
              rows={3}
              className="mt-1 w-full resize-y rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
              placeholder="Why should this trailer be rendered again?"
            />
            {confirming ? (
              <p className="mt-3 rounded-md border border-amber-700/40 bg-amber-950/30 p-3 text-sm text-amber-100">
                A ready trailer is already public. Submit again to publish a new immutable version after rendering succeeds.
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void submitAction()}
              disabled={submitting || reason.trim().length === 0}
              className="mt-3 min-h-10 rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? "Requesting..." : confirming ? `Confirm ${action}` : action === "rerender" ? "Rerender trailer" : "Backfill trailer"}
            </button>
          </section>
        ) : detail && ACTIVE_STATUSES.has(detail.status) ? (
          <p className="mt-6 rounded-md border border-white/10 bg-white/[0.03] p-3 text-sm text-white/50">A render attempt is already active. Duplicate requests are disabled.</p>
        ) : null}
      </aside>
    </div>
  );
}

export function AdminPostgameMediaDiagnostics({ detail }: { detail: AdminPostgameMediaResponse }) {
  if (detail.status === "not_requested") {
    return <p className="mt-6 rounded-md border border-white/10 bg-white/[0.03] p-4 text-sm text-white/55">No production trailer has been requested.</p>;
  }

  const artifacts = detail.artifactMetadata ?? detail.currentReady?.artifactMetadata;
  const cueSheet = cueSheetSummary(detail.cueMetadata);
  const duration = detail.currentReady?.durationSeconds ?? cueSheet?.totalDurationSeconds;

  return (
    <div className="mt-6 space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Status" value={formatStatus(detail.status)} />
        <Metric label="Attempt" value={String(detail.attemptNumber)} />
        <Metric label="Render" value={`v${detail.renderVersion}`} />
        <Metric label="Duration" value={duration == null ? "-" : formatDuration(duration)} />
      </div>

      {detail.provenance ? (
        <section className="rounded-md border border-white/10 bg-white/[0.03] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-white/35">Composition</h3>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <Datum label="Music" value={detail.provenance.musicAssetId} />
            <Datum label="Renderer" value={detail.provenance.rendererVersion} />
            <Datum label="Timing" value={detail.provenance.timingContractVersion} />
            <Datum label="Manifest" value={`v${detail.provenance.renderInputSnapshotVersion}`} />
            {detail.artifactVersion ? <Datum label="Artifact version" value={detail.artifactVersion} /> : null}
            {detail.lease ? <Datum label="Lease" value={detail.lease.active ? `active until ${detail.lease.expiresAt ?? "unknown"}` : "inactive"} /> : null}
          </dl>
        </section>
      ) : null}

      {cueSheet ? <CueSummary cueSheet={cueSheet} /> : null}

      {detail.failure ? (
        <section className="rounded-md border border-red-800/40 bg-red-950/25 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-red-200/60">Failure</h3>
          <p className="mt-2 text-sm font-medium text-red-100">{detail.failure.category ?? "render failure"}</p>
          {detail.failure.message ? <p className="mt-1 text-sm text-red-100/70">{detail.failure.message}</p> : null}
        </section>
      ) : null}

      {detail.status === "waiting_music" ? (
        <section className="rounded-md border border-amber-700/40 bg-amber-950/25 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-200/60">Waiting for music</h3>
          <p className="mt-2 text-sm text-amber-100/75">
            {stringValue(detail.diagnostics?.message) ?? "The prepared score for this trailer variant is unavailable."}
          </p>
          {stringValue(detail.diagnostics?.requestedHouseCuts) && stringValue(detail.diagnostics?.requestedPlayers) ? (
            <p className="mt-1 text-xs text-amber-100/50">
              Requested variant: {stringValue(detail.diagnostics?.requestedHouseCuts)} House Cuts / {stringValue(detail.diagnostics?.requestedPlayers)} players
            </p>
          ) : null}
        </section>
      ) : null}

      {artifacts ? <ArtifactSummary artifacts={artifacts} /> : null}
    </div>
  );
}

interface CueSheetSummary {
  totalDurationSeconds?: number;
  segments: Array<{ id: string; kind: string; startSeconds: number; endSeconds: number }>;
}

function CueSummary({ cueSheet }: { cueSheet: CueSheetSummary }) {
  return (
    <section className="rounded-md border border-white/10 bg-white/[0.03] p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-white/35">Cue markers</h3>
      <div className="mt-3 grid gap-1.5">
        {cueSheet.segments.map((segment) => (
          <div key={segment.id} className="grid grid-cols-[1fr_auto] gap-3 text-xs">
            <span className="truncate text-white/60" title={segment.id}>{formatStatus(segment.kind)}</span>
            <span className="font-mono text-white/35">{segment.startSeconds.toFixed(1)}s - {segment.endSeconds.toFixed(1)}s</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ArtifactSummary({ artifacts }: { artifacts: AdminPostgameMediaArtifactMetadata }) {
  const rows = [
    ["Video", artifacts.video],
    ["Poster", artifacts.poster],
    ["Captions", artifacts.captions],
    ["Metadata", artifacts.manifest],
  ] as const;

  return (
    <section className="rounded-md border border-white/10 bg-white/[0.03] p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-white/35">Published artifacts</h3>
      <p className="mt-1 text-xs text-white/35">{artifacts.storage.provider} / {artifacts.storage.bucket}</p>
      <div className="mt-3 divide-y divide-white/5">
        {rows.map(([label, artifact]) => (
          <div key={label} className="grid gap-1 py-2 text-sm sm:grid-cols-[6rem_1fr_auto] sm:items-center">
            <span className="text-white/45">{label}</span>
            <code className="truncate text-xs text-white/65" title={artifact.objectKey}>{artifact.objectKey}</code>
            <span className="text-xs text-white/35">{formatBytes(artifact.byteLength)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-white/10 bg-white/[0.03] p-3"><p className="text-[10px] uppercase tracking-wide text-white/35">{label}</p><p className="mt-1 text-base font-semibold text-white">{value}</p></div>;
}

function Datum({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-white/35">{label}</dt><dd className="mt-0.5 break-all text-white/70">{value}</dd></div>;
}

function formatStatus(status: string): string {
  return status.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function cueSheetSummary(metadata: Record<string, unknown> | undefined): CueSheetSummary | null {
  const cueSheet = recordValue(metadata?.cueSheet);
  if (!cueSheet || !Array.isArray(cueSheet.segments)) return null;
  const segments = cueSheet.segments.flatMap((value) => {
    const segment = recordValue(value);
    if (!segment) return [];
    const id = typeof segment.id === "string" ? segment.id : null;
    const kind = typeof segment.kind === "string" ? segment.kind : null;
    const startSeconds = typeof segment.startSeconds === "number" ? segment.startSeconds : null;
    const endSeconds = typeof segment.endSeconds === "number" ? segment.endSeconds : null;
    return id && kind && startSeconds !== null && endSeconds !== null
      ? [{ id, kind, startSeconds, endSeconds }]
      : [];
  });
  if (segments.length === 0) return null;
  return {
    ...(typeof cueSheet.totalDurationSeconds === "number" ? { totalDurationSeconds: cueSheet.totalDurationSeconds } : {}),
    segments,
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
