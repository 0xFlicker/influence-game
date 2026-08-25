"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAdminProviderHealth,
  probeAdminProviderHealth,
  type AdminProviderHealthResponse,
  type AdminProviderHealthStatus,
} from "@/lib/api";
import { usePermissions } from "@/hooks/use-permissions";

export function AdminProviderHealth() {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("manage_provider_health");
  const [result, setResult] = useState<AdminProviderHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [probing, setProbing] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const requestId = useRef(0);
  const sectionRef = useRef<HTMLElement>(null);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setError(null);
    try {
      const next = await getAdminProviderHealth();
      if (requestId.current === id) setResult(next);
    } catch (cause) {
      if (requestId.current === id) {
        setError(cause instanceof Error ? cause.message : "Provider health is unavailable.");
      }
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function probe(status: AdminProviderHealthStatus) {
    setProbing(status.scopeKey);
    setError(null);
    setAnnouncement(`Testing ${healthLabel(status)}.`);
    try {
      const response = await probeAdminProviderHealth(status.scopeKey);
      setAnnouncement(response.status.state === "closed"
        ? `${healthLabel(status)} restored. Eligible Daily admission may resume.`
        : `${healthLabel(status)} remains open after the provider test.`);
      await refresh();
      sectionRef.current?.focus();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Provider test failed.";
      setError(message);
      setAnnouncement(`${healthLabel(status)} test failed. The circuit remains unchanged.`);
    } finally {
      setProbing(null);
    }
  }

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      className="mb-8 rounded-xl border border-white/10 bg-white/[0.02] p-5 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
      aria-labelledby="provider-health-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="provider-health-title" className="text-xs font-semibold uppercase tracking-wider text-white/50">
            Provider Health
          </h2>
          <p className="mt-1 text-sm text-white/40">
            Provider circuits and recovery.
          </p>
        </div>
        {result?.dailyAdmissionPaused && (
          <span className="rounded-full border border-amber-700/50 bg-amber-900/20 px-3 py-1 text-xs text-amber-200">
            Daily starts paused
          </span>
        )}
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
      {loading ? (
        <StateMessage>Loading provider health…</StateMessage>
      ) : error && !result ? (
        <StateMessage tone="error">
          {error}{" "}
          <button type="button" onClick={() => void refresh()} className="underline">Retry</button>
        </StateMessage>
      ) : result?.providers.length === 0 ? (
        <StateMessage>No provider circuits have recorded health state yet.</StateMessage>
      ) : (
        <div className="mt-4 space-y-3">
          {error && <StateMessage tone="error">{error}</StateMessage>}
          {result?.providers.map((status) => (
            <article key={status.scopeKey} className="rounded-lg border border-white/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-white">{healthLabel(status)}</span>
                    <HealthBadge state={status.state} />
                  </div>
                  <p className="mt-1 text-xs text-white/40">
                    {status.reason ? `Reason: ${status.reason.replaceAll("_", " ")}` : "No active failure"}
                    {status.consecutiveFailureCount > 0
                      ? ` · ${status.consecutiveFailureCount} consecutive systemic failure${status.consecutiveFailureCount === 1 ? "" : "s"}`
                      : ""}
                  </p>
                  <p className="mt-1 text-xs text-white/30">
                    Updated {formatTimestamp(status.updatedAt)}
                    {status.cooldownUntil ? ` · cooldown until ${formatTimestamp(status.cooldownUntil)}` : ""}
                    {status.lastProbeEvidenceId
                      ? ` · latest probe evidence ${status.lastProbeEvidenceId}`
                      : status.lastAttemptId
                        ? ` · evidence attempt ${status.lastAttemptId}`
                        : ""}
                  </p>
                </div>
                {status.state !== "closed" && canManage && (
                  <button
                    type="button"
                    disabled={status.state === "probing" || probing !== null}
                    onClick={() => void probe(status)}
                    className="rounded-lg border border-indigo-500/50 px-3 py-2 text-xs font-medium text-indigo-200 transition-colors hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {probing === status.scopeKey || status.state === "probing"
                      ? "Testing provider…"
                      : "Test provider and resume"}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function HealthBadge({ state }: { state: AdminProviderHealthStatus["state"] }) {
  const style = state === "closed"
    ? "border-emerald-700/50 bg-emerald-900/20 text-emerald-200"
    : state === "probing"
      ? "border-indigo-700/50 bg-indigo-900/20 text-indigo-200"
      : "border-red-700/50 bg-red-900/20 text-red-200";
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${style}`}>{state}</span>;
}

function StateMessage({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`mt-4 text-sm ${tone === "error" ? "text-red-300" : "text-white/35"}`}>
      {children}
    </p>
  );
}

function healthLabel(status: AdminProviderHealthStatus): string {
  return status.catalogId ?? status.providerProfileId;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
