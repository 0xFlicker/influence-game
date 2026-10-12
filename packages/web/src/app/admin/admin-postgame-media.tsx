"use client";

import {
  type AdminGameSummary,
  type AdminPostgameMediaAction,
  type AdminPostgameMediaArtifactMetadata,
  type AdminPostgameMediaResponse,
} from "@/lib/api";
import { accessDenied, useAdminRead, useAdminSession, useAdminValue, type Operation } from "./admin-session";

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

type MediaBaseline = { status: string; renderVersion: number; attemptNumber: number; updatedAt: string | null };
type MediaNotice = { kind: "success" | "error"; text: string };
function mediaBaseline(detail: AdminPostgameMediaResponse): MediaBaseline {
  return detail.status === "not_requested" ? { status: detail.status, renderVersion: 0, attemptNumber: 0, updatedAt: null }
    : { status: detail.status, renderVersion: detail.renderVersion, attemptNumber: detail.attemptNumber, updatedAt: detail.timestamps.updatedAt };
}

/** Both episode and trailer tools use this session-owned request. These endpoints
 * have no request receipt: an uncertain response needs an explicit GET before retry. */
export function usePostgameMediaOperation(gameId: string) {
  const session = useAdminSession(), resource = `/api/admin/games/${encodeURIComponent(gameId)}/postgame/media`;
  const key = `operation:${resource}`, baselineKey = `ui:${resource}:baseline`;
  const query = useAdminRead<AdminPostgameMediaResponse>(resource);
  const [operation] = useAdminValue<Operation | undefined>(key, undefined);
  const [reason, setReason] = useAdminValue(`draft:${resource}:reason`, "");
  const [confirming, setConfirming] = useAdminValue(`ui:${resource}:confirmation`, false);
  const [notice, setNotice] = useAdminValue<MediaNotice | null>(`ui:${resource}:notice`, null);
  const action = query.data ? postgameMediaActionFor(query.data) : null;
  const actionLabel = query.data?.status === "failed" ? "Retry" : action === "rerender" ? "Rerender" : "Backfill";
  const pending = operation?.phase === "submitting", unknown = operation?.phase === "unknown";
  async function submit(inputReason: string = reason) {
    if (!query.data || !action || !inputReason.trim() || pending || unknown || query.denied) return;
    if (postgameMediaRequiresConfirmation(query.data) && !confirming) { setConfirming(true); return; }
    setNotice(null); session.set(baselineKey, mediaBaseline(query.data));
    try {
      const result = await session.execute<{ outcome: string }>(key, `${resource}/${action}`,
        { reason: inputReason.trim(), confirmation: action.toUpperCase() }, false, { accessResource: resource });
      if (!result) return;
      setNotice({ kind: "success", text: `${actionLabel} requested (${result.outcome}).` });
      setReason(""); setConfirming(false); await query.refresh();
    } catch (error) {
      if (!accessDenied(error)) setNotice({ kind: "error", text: error instanceof Error ? error.message : "Trailer request failed." });
    }
  }
  async function checkSaved() {
    const current = session.get<Operation>(key);
    if (current?.phase !== "unknown") return;
    const next = await query.refresh();
    if (next.error || !next.data || session.get(key) !== current) return;
    const baseline = session.get<MediaBaseline>(baselineKey);
    if (!baseline) { setNotice({ kind: "error", text: "The prior trailer state is unavailable. Inspect the current render before retrying." }); return; }
    const changed = JSON.stringify(mediaBaseline(next.data)) !== JSON.stringify(baseline);
    session.set<Operation>(key, { ...current, phase: changed ? "accepted" : "rejected",
      ...(changed ? { result: { observed: true }, error: undefined } : { error: "No new trailer request is visible. Review the current state before retrying." }) });
    setConfirming(false);
    setNotice({ kind: changed ? "success" : "error", text: changed
      ? "Trailer state changed since the request. Review its current status; no second request was sent."
      : "No new trailer request is visible. Review the current state before retrying." });
    if (changed) setReason("");
  }
  return { ...query, operation, reason, setReason, confirming, setConfirming, notice, action, actionLabel, pending, unknown, submit, checkSaved };
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
}: {
  game: Pick<AdminGameSummary, "id" | "slug">;
  canManage: boolean;
}) {
  const media = usePostgameMediaOperation(game.id);
  const { data: detail, error, reason, setReason, pending: submitting, confirming, setConfirming, action, actionLabel, notice } = media;
  return (
      <section
        aria-label="Trailer media"
        data-testid="admin-postgame-media-panel"
      >
        <p className="text-xs tracking-wide text-white/35">{game.slug}</p>

        {!detail && !error ? <p className="mt-8 text-sm text-white/40">Loading media state...</p> : null}
        {error ? <p className="mt-5 rounded-md border border-red-800/40 bg-red-950/30 p-3 text-sm text-red-200" role="alert">{error}</p> : null}
        {notice ? <p className="mt-5 rounded-md border border-white/20 p-3 text-sm" role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p> : null}
        {media.unknown && <p role="alert" className="mt-5 text-sm text-amber-200">The request outcome is unknown. Check saved trailer state before retrying. <button onClick={() => void media.checkSaved()} disabled={media.isFetching}>Check saved trailer state</button></p>}
        {!media.unknown && <button className="mt-3 text-sm text-white/60" disabled={media.isFetching || submitting} onClick={() => void media.refresh()}>Refresh trailer state</button>}

        {detail ? <AdminPostgameMediaDiagnostics detail={detail} /> : null}

        {canManage && action ? (
          <section className="mt-6 border-t border-white/10 pt-5">
            <h3 className="text-sm font-semibold text-white">{`${actionLabel} trailer`}</h3>
            <label className="mt-3 block text-xs text-white/50" htmlFor="postgame-media-reason">Reason</label>
            <textarea
              id="postgame-media-reason"
              value={reason}
              disabled={submitting || media.unknown}
              onInput={(event) => {
                setReason(event.currentTarget.value);
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
              onClick={() => void media.submit()}
              disabled={submitting || media.unknown || reason.trim().length === 0}
              className="mt-3 min-h-10 rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? "Requesting..." : confirming ? `Confirm ${actionLabel.toLowerCase()}` : `${actionLabel} trailer`}
            </button>
          </section>
        ) : detail && ACTIVE_STATUSES.has(detail.status) ? (
          <p className="mt-6 rounded-md border border-white/10 bg-white/[0.03] p-3 text-sm text-white/50">A render attempt is already active. Duplicate requests are disabled.</p>
        ) : null}
      </section>
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
