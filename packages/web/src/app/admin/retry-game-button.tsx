"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/api";

/** Same old game ID on every delivery: a lost response cannot create a second replacement. */
export function RetryGameButton({ gameId, disabled = false, onRetried }: {
  gameId: string; disabled?: boolean; onRetried: (gameId: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <span className="inline-flex max-w-full flex-col gap-1">
    <button type="button" disabled={disabled || busy} className="min-h-8 rounded-md border border-amber-700/40 px-2.5 py-1 text-xs text-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
      title="Hide this failed attempt and start a replacement with the same competitive setup. History is retained."
      onClick={async event => {
        event.stopPropagation(); setBusy(true); setError(null);
        try { const result = await apiFetch<{ gameId: string }>(`/api/admin/games/${encodeURIComponent(gameId)}/retry`, { method: "POST" }); await onRetried(result.gameId); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Retry failed. Try again to recover the same replacement."); }
        finally { setBusy(false); }
      }}>{busy ? "Retrying…" : "Retry game"}</button>
    {error ? <span role="alert" className="max-w-sm whitespace-normal text-xs text-red-300">{error}</span> : null}
  </span>;
}
