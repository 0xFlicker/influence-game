"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ApiError,
  retryGameSettlement,
  type AdminGameSummary,
} from "@/lib/api";
import { gameDisplayName } from "@/lib/game-identity";

export function settlementRetrySuccessMessage(
  result: Awaited<ReturnType<typeof retryGameSettlement>>,
): string {
  const followUpsConfirmed = result.watchRefreshed && result.mediaReconciliation !== null;
  const followUpMessage = followUpsConfirmed
    ? " Watch and media state were reconciled."
    : " The sealed result is complete, but one or more follow-up views still need inspection.";
  return result.outcome === "already_completed"
    ? `Settlement was already completed.${followUpMessage}`
    : `Settlement completed from the sealed result.${followUpMessage}`;
}

export function settlementRetryIsAvailable(
  game: AdminGameSummary,
  hasPermission: boolean,
): boolean {
  return hasPermission && game.completionSettlement.retryEligible;
}

export function settlementRetryErrorMessage(error: unknown): string {
  return error instanceof ApiError && error.code === "repair_blocked"
    ? "Retry is blocked because this settlement requires evidence repair."
    : error instanceof ApiError && error.code === "invalid_state"
      ? "This settlement is no longer ready for retry. Refresh and inspect its current state."
      : error instanceof Error
        ? error.message
        : "Settlement retry failed.";
}

export function settlementRetryIsTerminalConflict(error: unknown): boolean {
  return error instanceof ApiError
    && (error.code === "invalid_state" || error.code === "repair_blocked");
}

export function RetrySettlementDialog({
  game,
  onClose,
  onSettled,
}: {
  game: AdminGameSummary;
  onClose: () => void;
  onSettled: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [retryBlocked, setRetryBlocked] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setStatus(null);
    try {
      const result = await retryGameSettlement(game.slug, reason);
      setStatus({ tone: "success", message: settlementRetrySuccessMessage(result) });
      onSettled();
    } catch (error) {
      setStatus({ tone: "error", message: settlementRetryErrorMessage(error) });
      if (settlementRetryIsTerminalConflict(error)) {
        setRetryBlocked(true);
        onSettled();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="retry-settlement-title"
      onCancel={(event) => {
        if (submitting) event.preventDefault();
        else onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
      className="w-full max-w-lg rounded-xl border border-white/10 bg-zinc-950 p-0 text-white shadow-2xl backdrop:bg-black/70"
    >
      <form onSubmit={handleSubmit} className="p-6">
        <h2 id="retry-settlement-title" className="text-lg font-semibold">Retry completion settlement</h2>
        <p className="mt-2 text-sm text-white/55">
          This settles the sealed result for <strong className="text-white/80">{gameDisplayName(game)}</strong>. It does not replay gameplay.
        </p>
        <label htmlFor="retry-settlement-reason" className="mt-5 block text-sm font-medium text-white/75">
          Operator reason
        </label>
        <input
          id="retry-settlement-reason"
          autoFocus
          required
          maxLength={240}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={submitting || retryBlocked || status?.tone === "success"}
          placeholder="Why is this retry safe now?"
          className="mt-2 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/25 focus:border-amber-400 focus:outline-none disabled:opacity-50"
        />
        <p className="mt-2 text-xs text-white/35">
          Confirming sends the exact phrase RETRY_SETTLEMENT with this reason.
        </p>
        <div aria-live="polite" className={`mt-4 min-h-5 text-sm ${status?.tone === "error" ? "text-red-300" : "text-green-300"}`}>
          {status?.message}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-3 py-2 text-sm text-white/55 transition-colors hover:text-white disabled:opacity-40"
          >
            {status?.tone === "success" || retryBlocked ? "Close" : "Cancel"}
          </button>
          {status?.tone !== "success" && !retryBlocked && (
            <button
              type="submit"
              disabled={submitting || reason.trim().length === 0}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Retrying…" : "Retry sealed settlement"}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
