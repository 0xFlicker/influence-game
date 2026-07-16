"use client";

import { useState, useEffect, useCallback, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  formatGameModelLabel,
  hideGame,
  listAdminGames,
  retryGameSettlement,
  unhideGame,
  type AdminGameSummary,
  type GameStatus,
} from "@/lib/api";
import { usePermissions } from "@/hooks/use-permissions";
import { gameDisplayName, gameHref } from "@/lib/game-identity";
import { AdminCostPanel, AdminCostPill } from "../admin-cost-view";
import { AdminHighlightsDiagnosticsPanel, AdminHighlightsPill } from "../admin-highlights-diagnostics";
import { AdminPostgameMediaPanel, AdminPostgameMediaPill } from "../admin-postgame-media";

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

type StatusFilter = GameStatus | "all";
type PlayerFilter = "all" | "4" | "6" | "8" | "10" | "12";
type VisibilityFilter = "all" | "visible" | "hidden";
type SettlementFilter = "all" | "pending" | "repair_required";

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

function StatusBadge({ game }: { game: AdminGameSummary }) {
  const styles: Record<AdminGameSummary["status"], string> = {
    waiting: "bg-yellow-900/40 text-yellow-400",
    in_progress: "bg-blue-900/40 text-blue-400",
    completed: "bg-green-900/40 text-green-400",
    cancelled: "bg-red-900/40 text-red-400",
    suspended: "bg-amber-900/40 text-amber-300",
  };
  const labels: Record<AdminGameSummary["status"], string> = {
    waiting: "waiting",
    in_progress: "live",
    completed: "✓ done",
    cancelled: "✗ void",
    suspended: "failed",
  };
  const settlementState = game.completionSettlement.state;
  const suspendedLabel = settlementState === "pending"
    ? "Finalizing results"
    : settlementState === "repair_required"
      ? "Results under review"
      : labels.suspended;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${styles[game.status]}`}>
      {game.status === "suspended" ? suspendedLabel : labels[game.status]}
    </span>
  );
}

function SettlementBadge({ game }: { game: AdminGameSummary }) {
  const settlement = game.completionSettlement;
  if (settlement.state === "not_applicable") return <span className="text-white/20">—</span>;
  const details = settlement.state === "pending"
    ? settlement.retryEligible ? "Pending · retry ready" : "Pending · finalizing"
    : settlement.state === "repair_required"
      ? "Repair required"
      : "Completed";
  const tone = settlement.state === "repair_required"
    ? "bg-red-950/60 text-red-300 border-red-700/40"
    : settlement.state === "pending"
      ? "bg-amber-950/60 text-amber-200 border-amber-700/40"
      : "bg-green-950/40 text-green-300 border-green-700/30";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>
      {details}
    </span>
  );
}

function GameRow({
  game,
  canHide,
  canRetrySettlement,
  onToggleVisibility,
  onOpenCosts,
  onOpenHighlights,
  onOpenMedia,
  onOpenRetry,
}: {
  game: AdminGameSummary;
  canHide: boolean;
  canRetrySettlement: boolean;
  onToggleVisibility: () => void;
  onOpenCosts: () => void;
  onOpenHighlights: () => void;
  onOpenMedia: () => void;
  onOpenRetry: () => void;
}) {
  const router = useRouter();
  const [toggling, setToggling] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);
  const date = new Date(game.completedAt ?? game.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  async function handleToggle() {
    setConfirmHide(false);
    setToggling(true);
    try {
      if (game.hidden) {
        await unhideGame(game.id);
      } else {
        await hideGame(game.id);
      }
      onToggleVisibility();
    } catch {
      setToggling(false);
    }
  }

  return (
    <tr
      onClick={() => router.push(gameHref(game))}
      className={`border-t border-white/5 hover:bg-white/[0.02] transition-colors group cursor-pointer ${game.hidden ? "opacity-40" : ""} ${game.completionSettlement.state === "repair_required" ? "bg-red-950/10" : game.completionSettlement.state === "pending" ? "bg-amber-950/10" : ""}`}
    >
      <td className="py-3 px-4 text-white/50 text-sm">
        {gameDisplayName(game)}
        {game.hidden && (
          <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-400">
            hidden
          </span>
        )}
      </td>
      <td className="py-3 px-4 text-white text-sm">
        {game.winner ? (
          <span>
            {game.winner}{" "}
            <span className="text-white/40 text-xs">({game.winnerPersona})</span>
          </span>
        ) : (
          <span className="text-white/25 italic">—</span>
        )}
      </td>
      <td className="py-3 px-4 text-white/50 text-sm">{game.playerCount}p</td>
      <td className="py-3 px-4 text-white/50 text-sm">
        {game.currentRound > 0 ? game.currentRound : "—"}
      </td>
      <td className="py-3 px-4 text-white/50 text-sm">{formatGameModelLabel(game.modelSelection, game.modelTier, game.modelLabel)}</td>
      <td className="py-3 px-4 text-white/40 text-xs">{date}</td>
      <td className="py-3 px-4">
        <StatusBadge game={game} />
      </td>
      <td className="py-3 px-4">
        <SettlementBadge game={game} />
      </td>
      <td className="py-3 px-4">
        <AdminCostPill
          summary={game.cost}
          onClick={onOpenCosts}
          ariaLabel={`Open cost details for game ${gameDisplayName(game)}`}
        />
      </td>
      <td className="py-3 px-4">
        <AdminHighlightsPill game={game} onClick={onOpenHighlights} />
      </td>
      <td className="py-3 px-4">
        <AdminPostgameMediaPill game={game} onClick={onOpenMedia} />
      </td>
      <td className="py-3 px-4">
        {settlementRetryIsAvailable(game, canRetrySettlement) && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenRetry();
            }}
            className="mr-3 rounded-md border border-amber-600/40 px-2 py-1 text-xs text-amber-200 transition-colors hover:bg-amber-900/30 focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            Retry settlement
          </button>
        )}
        {canHide && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (game.hidden) {
                handleToggle();
              } else {
                setConfirmHide(true);
              }
            }}
            disabled={toggling}
            title={game.hidden ? "Restore to public lists" : "Hide from public lists"}
            className={`text-xs opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50 ${
              game.hidden
                ? "text-white/20 hover:text-green-400"
                : "text-white/20 hover:text-orange-400"
            }`}
          >
            {toggling ? "…" : game.hidden ? "Unhide" : "Hide"}
          </button>
        )}
        {confirmHide && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={(e) => e.stopPropagation()}>
            <div className="bg-zinc-900 border border-white/10 rounded-xl p-6 max-w-sm w-full mx-4">
              <p className="text-white text-sm mb-4">
                Hide game <strong>{gameDisplayName(game)}</strong> from public lists?
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirmHide(false)}
                  className="text-sm text-white/50 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleToggle}
                  className="text-sm bg-orange-600 hover:bg-orange-500 text-white px-4 py-1.5 rounded-lg transition-colors"
                >
                  Hide
                </button>
              </div>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}

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
      setStatus({
        tone: "success",
        message: settlementRetrySuccessMessage(result),
      });
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

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white/70 text-sm focus:outline-none focus:border-indigo-500"
      aria-label={label}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-neutral-900">
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Main browser component
// ---------------------------------------------------------------------------

export function GameHistoryBrowser() {
  const { hasPermission } = usePermissions();
  const canHideGame = hasPermission("hide_game");
  const canManagePostgameMedia = hasPermission("manage_postgame_media");
  const canRetrySettlement = hasPermission("retry_game_settlement");

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [playerFilter, setPlayerFilter] = useState<PlayerFilter>("all");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all");
  const [settlementFilter, setSettlementFilter] = useState<SettlementFilter>("all");
  const [search, setSearch] = useState("");

  const [games, setGames] = useState<AdminGameSummary[]>([]);
  const [costGame, setCostGame] = useState<AdminGameSummary | null>(null);
  const [highlightsGame, setHighlightsGame] = useState<AdminGameSummary | null>(null);
  const [mediaGame, setMediaGame] = useState<AdminGameSummary | null>(null);
  const [retryGame, setRetryGame] = useState<AdminGameSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchRequestIdRef = useRef(0);

  const fetchGames = useCallback(() => {
    const fetchRequestId = fetchRequestIdRef.current + 1;
    fetchRequestIdRef.current = fetchRequestId;
    listAdminGames()
      .then((data) => {
        if (fetchRequestIdRef.current !== fetchRequestId) return;
        setGames(data);
        setError(null);
      })
      .catch((err) => {
        if (fetchRequestIdRef.current !== fetchRequestId) return;
        setError(err instanceof Error ? err.message : "Failed to load games.");
      })
      .finally(() => {
        if (fetchRequestIdRef.current === fetchRequestId) setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  const filtered = games.filter((g) => {
    if (statusFilter !== "all" && g.status !== statusFilter) return false;
    if (playerFilter !== "all" && g.playerCount !== parseInt(playerFilter)) return false;
    if (visibilityFilter === "visible" && g.hidden) return false;
    if (visibilityFilter === "hidden" && !g.hidden) return false;
    if (settlementFilter !== "all" && g.completionSettlement.state !== settlementFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const modelLabel = formatGameModelLabel(g.modelSelection, g.modelTier, g.modelLabel).toLowerCase();
      if (
        !g.winner?.toLowerCase().includes(q) &&
        !modelLabel.includes(q) &&
        !g.slug.toLowerCase().includes(q) &&
        !g.season?.name.toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  const hiddenCount = games.filter((g) => g.hidden).length;

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "All statuses" },
            { value: "completed", label: "Done" },
            { value: "in_progress", label: "Live" },
            { value: "waiting", label: "Waiting" },
            { value: "suspended", label: "Suspended" },
            { value: "cancelled", label: "Void" },
          ]}
        />
        <FilterSelect
          label="Player count"
          value={playerFilter}
          onChange={setPlayerFilter}
          options={[
            { value: "all", label: "All player counts" },
            { value: "4", label: "4 players" },
            { value: "6", label: "6 players" },
            { value: "8", label: "8 players" },
            { value: "10", label: "10 players" },
            { value: "12", label: "12 players" },
          ]}
        />
        {hiddenCount > 0 && (
          <FilterSelect
            label="Visibility"
            value={visibilityFilter}
            onChange={setVisibilityFilter}
            options={[
              { value: "all", label: `All (${hiddenCount} hidden)` },
              { value: "visible", label: "Visible only" },
              { value: "hidden", label: "Hidden only" },
            ]}
          />
        )}
        <FilterSelect
          label="Completion settlement"
          value={settlementFilter}
          onChange={setSettlementFilter}
          options={[
            { value: "all", label: "All settlements" },
            { value: "pending", label: "Finalizing results" },
            { value: "repair_required", label: "Results under review" },
          ]}
        />
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm placeholder-white/30 focus:outline-none focus:border-indigo-500 min-w-40"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="border border-white/10 rounded-xl p-16 text-center text-white/20 text-sm">
          Loading…
        </div>
      ) : error ? (
        <div className="border border-red-900/30 rounded-xl p-8 text-center text-red-400/70 text-sm">
          {error}
        </div>
      ) : games.length === 0 ? (
        <div className="border border-white/10 rounded-xl p-16 text-center text-white/20 text-sm">
          No games yet. Create the first one →{" "}
          <a href="/admin/games/new" className="text-indigo-400 hover:text-indigo-300">
            New game
          </a>
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-white/10 rounded-xl p-12 text-center text-white/20 text-sm">
          No games match the current filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-[72rem] w-full">
            <thead>
              <tr className="border-b border-white/10">
                {["Slug", "Winner", "Players", "Rounds", "Model", "Date", "Status", "Settlement", "Cost", "Highlights", "Trailer", ""].map((h) => (
                  <th
                    key={h}
                    className="text-left py-3 px-4 text-xs text-white/30 font-medium"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <GameRow
                  key={g.id}
                  game={g}
                  canHide={canHideGame}
                  canRetrySettlement={canRetrySettlement}
                  onToggleVisibility={fetchGames}
                  onOpenCosts={() => setCostGame(g)}
                  onOpenHighlights={() => setHighlightsGame(g)}
                  onOpenMedia={() => setMediaGame(g)}
                  onOpenRetry={() => setRetryGame(g)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {games.length > 0 && (
        <p className="text-xs text-white/20 mt-3 text-right">
          {filtered.length} of {games.length} game{games.length !== 1 ? "s" : ""}
        </p>
      )}

      {costGame && (
        <AdminCostPanel key={costGame.id} game={costGame} onClose={() => setCostGame(null)} onBackfilled={fetchGames} />
      )}
      {highlightsGame && (
        <AdminHighlightsDiagnosticsPanel key={highlightsGame.id} game={highlightsGame} onClose={() => setHighlightsGame(null)} />
      )}
      {mediaGame && (
        <AdminPostgameMediaPanel
          key={mediaGame.id}
          game={mediaGame}
          canManage={canManagePostgameMedia}
          onClose={() => setMediaGame(null)}
        />
      )}
      {retryGame && (
        <RetrySettlementDialog
          key={retryGame.id}
          game={retryGame}
          onClose={() => setRetryGame(null)}
          onSettled={fetchGames}
        />
      )}
    </div>
  );
}
