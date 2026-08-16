"use client";

import { useCallback, useEffect, useState } from "react";
import { usePermissions } from "@/hooks/use-permissions";
import {
  ApiError,
  getAdminDeploymentAdmission,
  resumeAdminDeploymentAdmission,
  type AdminDeploymentAdmissionStatus,
} from "@/lib/api";

type ResumeNotice = "revoked" | "already_resumed" | "too_late" | "stale" | null;

export function AdminDeploymentAdmission() {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("manage_deployment_admission");
  const [status, setStatus] = useState<AdminDeploymentAdmissionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [resuming, setResuming] = useState(false);
  const [notice, setNotice] = useState<ResumeNotice>(null);

  const refresh = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError(null);
    try {
      setStatus(await getAdminDeploymentAdmission());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load release admission.");
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!canManage) return null;

  async function handleResume() {
    const lease = status?.lease;
    const auditReason = reason.trim();
    if (!lease || !auditReason || resuming) return;
    setResuming(true);
    setError(null);
    setNotice(null);
    try {
      const result = await resumeAdminDeploymentAdmission(lease.id, lease.revision, auditReason);
      setNotice(result.outcome);
      setConfirming(false);
      setReason("");
      setStatus((current) => current
        ? { ...current, admissionBlocked: false, lease: null }
        : current);
      await refresh();
    } catch (resumeError) {
      if (resumeError instanceof ApiError && resumeError.code === "resume_too_late") {
        setNotice("too_late");
        setConfirming(false);
        await refresh();
      } else if (
        resumeError instanceof ApiError
        && (resumeError.code === "stale_lease" || resumeError.code === "lease_revision_changed")
      ) {
        setNotice("stale");
        setConfirming(false);
        await refresh();
      } else {
        setError(resumeError instanceof Error ? resumeError.message : "Resume failed.");
      }
    } finally {
      setResuming(false);
    }
  }

  if (loading && !status) {
    return (
      <section className="mb-8 rounded-xl border border-white/10 px-5 py-4 text-sm text-white/35" aria-live="polite">
        Loading release admission…
      </section>
    );
  }

  if (!status) {
    return (
      <section className="mb-8 rounded-xl border border-red-900/40 bg-red-950/20 px-5 py-4" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-red-300">{error ?? "Release admission is unavailable."}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-lg border border-red-700/50 px-3 py-1.5 text-xs font-medium text-red-200 transition-colors hover:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  const lease = status.lease;
  const postSwitch = lease && !lease.canResume;

  return (
    <section
      className={`mb-8 rounded-xl border px-5 py-4 ${lease ? "border-amber-700/35 bg-amber-950/15" : "border-emerald-900/35 bg-emerald-950/10"}`}
      aria-labelledby="release-admission-title"
      aria-live="polite"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${lease ? "bg-amber-400" : "bg-emerald-400"}`} aria-hidden="true" />
            <h2 id="release-admission-title" className="text-sm font-semibold text-white">
              {postSwitch
                ? "Release switch in progress"
                : lease
                  ? "Release admission paused"
                  : "Release admission open"}
            </h2>
            {lease && (
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-white/50">
                {lease.phase}
              </span>
            )}
          </div>

          {lease ? (
            <div className="mt-2 space-y-1 text-xs text-white/45">
              <p>
                <span className="text-white/65">Run {lease.workflowRunId} · attempt {lease.workflowRunAttempt}</span>
                {" · candidate "}
                <span className="font-mono" title={lease.candidateSha}>{lease.candidateSha.slice(0, 10)}</span>
              </p>
              <p>
                {status.activeGameCount} active {status.activeGameCount === 1 ? "game" : "games"}
                {" · absolute deadline "}
                <time dateTime={lease.absoluteDeadlineAt}>{formatAdmissionTime(lease.absoluteDeadlineAt)}</time>
              </p>
              {postSwitch && <p className="text-amber-200/70">Resume is unavailable after switching begins.</p>}
            </div>
          ) : (
            <p className="mt-2 text-xs text-white/40">New game starts are accepting normal traffic.</p>
          )}

          {notice === "revoked" && <p className="mt-2 text-xs font-medium text-emerald-300">New game starts resumed.</p>}
          {notice === "already_resumed" && <p className="mt-2 text-xs font-medium text-emerald-300">Admission was already resumed.</p>}
          {notice === "too_late" && <p className="mt-2 text-xs font-medium text-amber-200">Switching already began; admission remains closed.</p>}
          {notice === "stale" && <p className="mt-2 text-xs font-medium text-amber-200">The release changed. Status was refreshed without altering it.</p>}
          {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
        </div>

        {lease?.canResume && !confirming && (
          <button
            type="button"
            onClick={() => { setConfirming(true); setNotice(null); setError(null); }}
            disabled={resuming || loading}
            className="min-h-9 flex-shrink-0 rounded-lg border border-amber-600/50 px-3.5 py-2 text-xs font-medium text-amber-100 transition-colors hover:border-amber-400 hover:bg-amber-950/50 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Resume new game starts
          </button>
        )}
      </div>

      {lease?.canResume && confirming && (
        <div className="mt-4 border-t border-amber-800/30 pt-4">
          <p className="text-sm font-medium text-white">Confirm Resume</p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-white/45">
            This revokes only the observed release lease. It does not stop active games or continue the canceled deployment.
          </p>
          <label className="mt-3 block max-w-xl text-xs font-medium text-white/60" htmlFor="deployment-resume-reason">
            Reason for Resume
          </label>
          <input
            id="deployment-resume-reason"
            value={reason}
            onInput={(event) => setReason(event.currentTarget.value)}
            maxLength={240}
            disabled={resuming}
            className="mt-1 w-full max-w-xl rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-white/20 focus:border-amber-500/70 focus:ring-2 focus:ring-amber-500/30 disabled:opacity-50"
            placeholder="Why is the release lease being revoked?"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleResume()}
              disabled={!reason.trim() || resuming}
              className="rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-black transition-colors hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {resuming ? "Resuming…" : "Confirm Resume"}
            </button>
            <button
              type="button"
              onClick={() => { setConfirming(false); setReason(""); }}
              disabled={resuming}
              className="rounded-lg px-3.5 py-2 text-xs text-white/50 transition-colors hover:bg-white/[0.04] hover:text-white/80 focus:outline-none focus:ring-2 focus:ring-white/30 disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function formatAdmissionTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "unavailable" : parsed.toLocaleString();
}
