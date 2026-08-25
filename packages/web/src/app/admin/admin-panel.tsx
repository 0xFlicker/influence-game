"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAccount } from "wagmi";
import { fillGame, hideGame, listAdminGames, startGame, stopGame, unhideGame, type AdminGameSummary, type GameSummary } from "@/lib/api";
import { usePermissions } from "@/hooks/use-permissions";
import { TruncatedAddress } from "@/components/truncated-address";
import { AdminCostPanel, AdminCostPill } from "./admin-cost-view";
import { AdminHighlightsDiagnosticsPanel, AdminHighlightsPill } from "./admin-highlights-diagnostics";
import { AdminPostgameMediaPanel, AdminPostgameMediaPill } from "./admin-postgame-media";
import { AdminDeploymentAdmission } from "./admin-deployment-admission";
import {
  AdminProviderFailuresPanel,
  AdminProviderFailuresPill,
} from "./admin-provider-failures-view";
import {
  AdminGameFilterBar,
  DEFAULT_ADMIN_GAME_FILTERS,
  filterAdminGames,
  hasNarrowedAdminGameFilters,
  type AdminGameFilters,
} from "./admin-game-filters";
import {
  RetrySettlementDialog,
  settlementRetryIsAvailable,
} from "./admin-game-settlement";

function phaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    lobby: "LOBBY",
    discussion: "DISCUSS",
    whisper: "WHISPER",
    vote: "VOTE",
    reveal: "REVEAL",
    power: "POWER",
    jury_vote: "JURY VOTE",
    jury_questions: "JURY Q&A",
    finals_speech: "FINALS",
    done: "DONE",
  };
  return labels[phase] ?? phase.toUpperCase();
}

function progressPct(game: GameSummary): number {
  if (game.maxRounds === 0) return 0;
  return Math.round((game.currentRound / game.maxRounds) * 100);
}

export function canVoidSuspendedGame(status: GameSummary["status"], canStop: boolean): boolean {
  return canStop && status === "suspended";
}

// ---------------------------------------------------------------------------
// Game card (in_progress)
// ---------------------------------------------------------------------------

function GameCard({
  game,
  onRefresh,
  canStop,
  canHide,
  onOpenCosts,
  onOpenProviderFailures,
}: {
  game: AdminGameSummary;
  onRefresh: () => void | Promise<void>;
  canStop: boolean;
  canHide: boolean;
  onOpenCosts: () => void;
  onOpenProviderFailures: () => void;
}) {
  const router = useRouter();
  const pct = progressPct(game);
  const [stopping, setStopping] = useState(false);
  const [togglingVisibility, setTogglingVisibility] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleStop() {
    setActionError(null);
    setStopping(true);
    try {
      await stopGame(game.id);
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setStopping(false);
    }
  }

  async function handleToggleVisibility() {
    setConfirmHide(false);
    setActionError(null);
    setTogglingVisibility(true);
    try {
      if (game.hidden) await unhideGame(game.id);
      else await hideGame(game.id);
      await onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingVisibility(false);
    }
  }

  return (
    <div
      onClick={() => router.push(`/games/${game.slug}`)}
      className="border border-white/10 rounded-xl p-5 flex items-start justify-between gap-4 cursor-pointer hover:border-white/20 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-white font-semibold">{game.slug}</span>
          {game.hidden && (
            <span className="rounded bg-orange-900/40 px-1.5 py-0.5 text-[10px] text-orange-400">hidden</span>
          )}
          <span className="text-white/50 text-sm">
            {game.playerCount}-player · Round {game.currentRound}/{game.maxRounds} ·{" "}
            {game.modelLabel}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/60 font-mono">
            {phaseLabel(game.currentPhase)}
          </span>
        </div>
        <div className="h-1.5 bg-white/10 rounded-full mb-2 overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center gap-4 text-xs text-white/40">
          <span>👥 {game.alivePlayers} alive</span>
          <span>💀 {game.eliminatedPlayers} elim</span>
          {game.phaseTimeRemaining != null && (
            <span>⏱ {Math.round(game.phaseTimeRemaining / 1000)}s remain</span>
          )}
          {game.finalists && <span>Finalists: {game.finalists.join(", ")}</span>}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <AdminCostPill
          summary={game.cost}
          onClick={onOpenCosts}
          ariaLabel={`Open cost details for game ${game.slug}`}
        />
        <AdminProviderFailuresPill
          summary={game.providerFailures}
          onClick={onOpenProviderFailures}
          ariaLabel={`Open provider failures for game ${game.slug}`}
        />
        {canStop && (
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); handleStop(); }}
              disabled={stopping}
              className="text-xs border border-red-900/50 hover:border-red-700 text-red-400/70 hover:text-red-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {stopping ? "…" : "⏹ Stop"}
            </button>
          </div>
        )}
        {canHide && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (game.hidden) handleToggleVisibility();
              else setConfirmHide(true);
            }}
            disabled={togglingVisibility}
            className="text-xs text-white/30 transition-colors hover:text-orange-300 disabled:opacity-50"
          >
            {togglingVisibility ? "…" : game.hidden ? "Unhide" : "Hide"}
          </button>
        )}
        {actionError && (
          <p className="text-xs text-red-400/80">{actionError}</p>
        )}
      </div>
      {confirmHide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={(event) => event.stopPropagation()}>
          <div className="mx-4 w-full max-w-sm rounded-xl border border-white/10 bg-zinc-900 p-6">
            <p className="mb-4 text-sm text-white">
              Hide game <strong>{game.slug}</strong> from public lists? It remains available through the Hidden filter.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmHide(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-white/50 transition-colors hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleToggleVisibility}
                className="rounded-lg bg-orange-600 px-4 py-1.5 text-sm text-white transition-colors hover:bg-orange-500"
              >
                Hide
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Waiting game card
// ---------------------------------------------------------------------------

function WaitingGameCard({ game, onRefresh, canStart, canFill, canStop, canHide }: { game: AdminGameSummary; onRefresh: () => void; canStart: boolean; canFill: boolean; canStop: boolean; canHide: boolean }) {
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [filling, setFilling] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleFill() {
    setActionError(null);
    setFilling(true);
    try {
      await fillGame(game.id);
      setFilling(false);
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setFilling(false);
    }
  }

  async function handleStart() {
    setActionError(null);
    setStarting(true);
    try {
      await startGame(game.id);
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setStarting(false);
    }
  }

  async function handleStop() {
    setActionError(null);
    setStopping(true);
    try {
      await stopGame(game.id);
      onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setStopping(false);
    }
  }

  async function handleToggleVisibility() {
    setConfirmHide(false);
    setActionError(null);
    setHiding(true);
    try {
      if (game.hidden) await unhideGame(game.id);
      else await hideGame(game.id);
      await onRefresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setHiding(false);
    }
  }

  const router = useRouter();

  return (
    <div
      onClick={() => router.push(`/games/${game.slug}`)}
      className="flex cursor-pointer flex-col gap-4 rounded-xl border border-white/10 p-5 transition-colors hover:border-white/20 lg:flex-row lg:items-center lg:justify-between"
    >
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-white font-semibold">{game.slug}</span>
          {game.hidden && (
            <span className="rounded bg-orange-900/40 px-1.5 py-0.5 text-[10px] text-orange-400">hidden</span>
          )}
          <span className="text-white/50 text-sm">
            {game.playerCount}-player · Not started · {game.modelLabel}
          </span>
          {filling && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-900/40 text-indigo-400 animate-pulse">
              Filling seats…
            </span>
          )}
        </div>
        <p className="text-xs text-white/30">Waiting to start</p>
      </div>
      <div className="flex flex-shrink-0 flex-col items-start gap-1 lg:items-end">
        {actionError && (
          <p className="text-xs text-red-400/80">{actionError}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {canFill && !filling && (
            <button
              onClick={(e) => { e.stopPropagation(); handleFill(); }}
              className="text-xs border border-indigo-900/50 hover:border-indigo-700 text-indigo-400/70 hover:text-indigo-400 px-3 py-1.5 rounded-lg transition-colors"
            >
              Fill AI
            </button>
          )}
          {canStart && (
            <button
              onClick={(e) => { e.stopPropagation(); handleStart(); }}
              disabled={starting || filling}
              className="text-xs border border-green-900/50 hover:border-green-700 text-green-400/70 hover:text-green-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {starting ? "…" : "▶ Start"}
            </button>
          )}
          {canStop && (
            <button
              onClick={(e) => { e.stopPropagation(); handleStop(); }}
              disabled={stopping}
              className="text-xs border border-white/10 hover:border-red-700 text-white/30 hover:text-red-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {stopping ? "…" : "🗑"}
            </button>
          )}
          {canHide && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (game.hidden) handleToggleVisibility();
                else setConfirmHide(true);
              }}
              disabled={hiding}
              title={game.hidden ? "Restore to public lists" : "Hide from public lists"}
              className="text-xs border border-white/10 hover:border-orange-700 text-white/30 hover:text-orange-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {hiding ? "…" : game.hidden ? "Unhide" : "Hide"}
            </button>
          )}
        </div>
      </div>
      {confirmHide && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-white/10 rounded-xl p-6 max-w-sm w-full mx-4">
            <p className="text-white text-sm mb-4">
              Hide game <strong>{game.slug}</strong> from public lists? It remains available through the Hidden filter.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmHide(false)}
                className="text-sm text-white/50 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleToggleVisibility}
                className="text-sm bg-orange-600 hover:bg-orange-500 text-white px-4 py-1.5 rounded-lg transition-colors"
              >
                Hide
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent game row
// ---------------------------------------------------------------------------

function StatusBadge({ status, errorInfo }: { status: GameSummary["status"]; errorInfo?: string }) {
  const styles: Record<GameSummary["status"], string> = {
    waiting: "bg-yellow-900/40 text-yellow-400",
    in_progress: "bg-blue-900/40 text-blue-400",
    completed: "bg-green-900/40 text-green-400",
    cancelled: "bg-red-900/40 text-red-400",
    suspended: "bg-amber-900/40 text-amber-300",
  };
  const labels: Record<GameSummary["status"], string> = {
    waiting: "waiting",
    in_progress: "live",
    completed: "done",
    cancelled: "void",
    suspended: "failed",
  };
  const label = status === "suspended" && (
    errorInfo === "Finalizing results." || errorInfo === "Results under review."
  )
    ? errorInfo.replace(/\.$/, "")
    : labels[status];
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full ${styles[status]}`}
      title={(status === "cancelled" || status === "suspended") && errorInfo ? `Error: ${errorInfo}` : undefined}
    >
      {label}
      {(status === "cancelled" || status === "suspended") && errorInfo ? " ⚠" : ""}
    </span>
  );
}

function RecentGameRow({
  game,
  canHide,
  canStop,
  canRetrySettlement,
  onRefresh,
  onOpenCosts,
  onOpenHighlights,
  onOpenMedia,
  onOpenProviderFailures,
  onOpenRetry,
}: {
  game: AdminGameSummary;
  canHide: boolean;
  canStop: boolean;
  canRetrySettlement: boolean;
  onRefresh: () => void;
  onOpenCosts: () => void;
  onOpenHighlights: () => void;
  onOpenMedia: () => void;
  onOpenProviderFailures: () => void;
  onOpenRetry: () => void;
}) {
  const router = useRouter();
  const [hiding, setHiding] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const date = new Date(game.completedAt ?? game.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  async function handleToggleVisibility() {
    setConfirmHide(false);
    setHiding(true);
    try {
      if (game.hidden) await unhideGame(game.id);
      else await hideGame(game.id);
      await onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setHiding(false);
    }
  }

  async function handleVoid() {
    setConfirmVoid(false);
    setActionError(null);
    setVoiding(true);
    try {
      await stopGame(game.id);
      await onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setVoiding(false);
    }
  }

  return (
    <tr
      onClick={() => router.push(`/games/${game.slug}`)}
      className={`block cursor-pointer border-t border-white/5 transition-colors hover:bg-white/[0.02] md:table-row ${game.hidden ? "opacity-50" : ""}`}
    >
      <td className="block w-full px-4 pt-4 align-top md:table-cell md:w-56 md:py-4">
        <p className="font-mono text-sm font-medium text-white/80">{game.slug}</p>
        {game.hidden && (
          <span className="mt-1 inline-flex rounded bg-orange-900/40 px-1.5 py-0.5 text-[10px] text-orange-400">hidden</span>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-white/35">
          <span>{game.playerCount} players</span>
          <span>{game.currentRound > 0 ? `${game.currentRound} rounds` : "Rounds unavailable"}</span>
          <span>{date}</span>
        </div>
        <p className="mt-1 line-clamp-1 text-xs text-white/30" title={game.modelLabel}>{game.modelLabel}</p>
      </td>
      <td className="block w-full px-4 py-3 align-top text-sm text-white md:table-cell md:py-4">
        {game.winner ? (
          <div className="max-w-xl">
            <p className="font-semibold">{game.winner}</p>
            {game.winnerPersona && (
              <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-white/40" title={game.winnerPersona}>
                {game.winnerPersona}
              </p>
            )}
          </div>
        ) : (
          <span className="text-white/30 italic">—</span>
        )}
      </td>
      <td className="block w-full px-4 pb-4 align-top md:table-cell md:w-80 md:py-4">
        <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
          <StatusBadge status={game.status} errorInfo={game.errorInfo} />
          <AdminCostPill
            summary={game.cost}
            onClick={onOpenCosts}
            ariaLabel={`Open cost details for game ${game.slug}`}
          />
          <AdminHighlightsPill game={game} onClick={onOpenHighlights} />
          <AdminPostgameMediaPill game={game} onClick={onOpenMedia} />
          <AdminProviderFailuresPill
            summary={game.providerFailures}
            onClick={onOpenProviderFailures}
            ariaLabel={`Open provider failures for game ${game.slug}`}
          />
          {settlementRetryIsAvailable(game, canRetrySettlement) && (
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onOpenRetry(); }}
              className="min-h-8 rounded-md border border-amber-700/40 px-2.5 py-1 text-xs text-amber-200 transition-colors hover:border-amber-400/60 hover:bg-amber-950/40 focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              Retry settlement
            </button>
          )}
          {canVoidSuspendedGame(game.status, canStop) && (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmVoid(true); }}
              disabled={voiding}
              className="min-h-8 rounded-md border border-amber-700/40 px-2.5 py-1 text-xs text-amber-200 transition-colors hover:border-amber-400/60 hover:bg-amber-950/40 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
            >
              {voiding ? "Voiding..." : "Void"}
            </button>
          )}
          {canHide && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (game.hidden) handleToggleVisibility();
                else setConfirmHide(true);
              }}
              disabled={hiding}
              title={game.hidden ? "Restore to public lists" : "Hide from public lists"}
              className="min-h-8 rounded-md border border-white/10 px-2.5 py-1 text-xs text-white/45 transition-colors hover:border-orange-500/50 hover:text-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-50"
            >
              {hiding ? "…" : game.hidden ? "Unhide" : "Hide"}
            </button>
          )}
        </div>
        {actionError && <p className="mt-1 text-xs text-red-400/80">{actionError}</p>}
        {confirmVoid && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={(e) => e.stopPropagation()}>
            <div className="bg-zinc-900 border border-amber-500/30 rounded-xl p-6 max-w-sm w-full mx-4">
              <p className="text-white text-sm mb-4">
                Void failed game <strong>{game.slug}</strong>? This ends it permanently and releases its players for future queues.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirmVoid(false)}
                  className="text-sm text-white/50 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  Keep suspended
                </button>
                <button
                  onClick={handleVoid}
                  className="text-sm bg-amber-600 hover:bg-amber-500 text-black px-4 py-1.5 rounded-lg font-medium transition-colors"
                >
                  Void game
                </button>
              </div>
            </div>
          </div>
        )}
        {confirmHide && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={(e) => e.stopPropagation()}>
            <div className="bg-zinc-900 border border-white/10 rounded-xl p-6 max-w-sm w-full mx-4">
              <p className="text-white text-sm mb-4">
                Hide game <strong>{game.slug}</strong> from public lists? It remains available through the Hidden filter.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirmHide(false)}
                  className="text-sm text-white/50 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleToggleVisibility}
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

// ---------------------------------------------------------------------------
// Main dashboard component
// ---------------------------------------------------------------------------

export function AdminPanel() {
  const { address } = useAccount();
  const { hasPermission } = usePermissions();

  const canCreateGame = hasPermission("create_game");
  const canStartGame = hasPermission("start_game");
  const canStopGame = hasPermission("stop_game");
  const canFillGame = hasPermission("fill_game");
  const canHideGame = hasPermission("hide_game");
  const canManagePostgameMedia = hasPermission("manage_postgame_media");
  const canRetrySettlement = hasPermission("retry_game_settlement");

  const [games, setGames] = useState<AdminGameSummary[]>([]);
  const [filters, setFilters] = useState<AdminGameFilters>(DEFAULT_ADMIN_GAME_FILTERS);
  const [recentLimit, setRecentLimit] = useState(5);
  const [costGame, setCostGame] = useState<AdminGameSummary | null>(null);
  const [highlightsGame, setHighlightsGame] = useState<AdminGameSummary | null>(null);
  const [mediaGame, setMediaGame] = useState<AdminGameSummary | null>(null);
  const [providerFailuresGame, setProviderFailuresGame] = useState<AdminGameSummary | null>(null);
  const [retryGame, setRetryGame] = useState<AdminGameSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchRequestIdRef = useRef(0);

  const fetchGames = useCallback(async () => {
    const fetchRequestId = fetchRequestIdRef.current + 1;
    fetchRequestIdRef.current = fetchRequestId;
    setError(null);
    try {
      const all = await listAdminGames();
      if (fetchRequestIdRef.current !== fetchRequestId) return;
      setGames(all);
    } catch (err) {
      if (fetchRequestIdRef.current !== fetchRequestId) return;
      setError(err instanceof Error ? err.message : "Failed to load games.");
    } finally {
      if (fetchRequestIdRef.current === fetchRequestId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGames();
    // Poll every 10s while active games exist
    const interval = setInterval(fetchGames, 10000);
    return () => clearInterval(interval);
  }, [fetchGames]);

  const filteredGames = filterAdminGames(games, filters);
  const byMostRecent = (left: AdminGameSummary, right: AdminGameSummary) =>
    new Date(right.completedAt ?? right.createdAt).getTime()
      - new Date(left.completedAt ?? left.createdAt).getTime();
  const activeGames = filteredGames.filter((game) => game.status === "in_progress");
  const suspendedGames = filteredGames.filter((game) => game.status === "suspended").sort(byMostRecent);
  const waitingGames = filteredGames.filter((game) => game.status === "waiting");
  const recentGames = filteredGames
    .filter((game) => game.status === "completed" || game.status === "cancelled")
    .sort(byMostRecent);
  const narrowed = hasNarrowedAdminGameFilters(filters);
  const displayedRecentGames = narrowed ? recentGames : recentGames.slice(0, recentLimit);
  const hiddenCount = games.filter((game) => game.hidden).length;
  const statusAllows = (...statuses: AdminGameSummary["status"][]) =>
    filters.status === "all" || statuses.includes(filters.status);
  const showSection = (statuses: AdminGameSummary["status"][], count: number) =>
    statusAllows(...statuses) && (!narrowed || count > 0);

  function updateFilters(next: AdminGameFilters) {
    setFilters(next);
    setRecentLimit(5);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Influence Admin</h1>
          <p className="text-white/40 text-sm mt-1">Game operations dashboard</p>
        </div>
        <div className="flex items-center gap-4">
          {address && (
            <span className="text-xs text-white/30 font-mono">👛 <TruncatedAddress address={address} maxWidth="10ch" /></span>
          )}
          {canCreateGame && (
            <Link
              href="/admin/games/new"
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
            >
              + New Game
            </Link>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 border border-red-900/40 bg-red-900/20 rounded-xl p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      <AdminGameFilterBar filters={filters} hiddenCount={hiddenCount} onChange={updateFilters} />
      <AdminDeploymentAdmission />

      {!loading && games.length > 0 && filteredGames.length === 0 && (
        <div className="mb-8 rounded-xl border border-white/10 p-8 text-center text-sm text-white/30">
          No games match the current filters.
        </div>
      )}

      {/* Active games */}
      {showSection(["in_progress"], activeGames.length) && <section className="mb-8">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
          Active Games ({activeGames.length})
        </h2>
        {loading ? (
          <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
            Loading…
          </div>
        ) : activeGames.length === 0 ? (
          <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
            No active games.
          </div>
        ) : (
          <div className="space-y-3">
            {activeGames.map((g) => (
              <GameCard
                key={g.id}
                game={g}
                onRefresh={fetchGames}
                canStop={canStopGame}
                canHide={canHideGame}
                onOpenCosts={() => setCostGame(g)}
                onOpenProviderFailures={() => setProviderFailuresGame(g)}
              />
            ))}
          </div>
        )}
      </section>}

      {/* Failed games */}
      {showSection(["suspended"], suspendedGames.length) && suspendedGames.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs font-semibold text-amber-300/80 uppercase tracking-wider mb-3">
            Failed Games ({suspendedGames.length})
          </h2>
          <div className="rounded-xl border border-amber-900/40">
            <table className="block w-full md:table md:table-fixed">
              <thead className="hidden md:table-header-group">
                <tr className="border-b border-amber-900/30">
                  {["Game", "Winner", "Operations"].map(
                    (h) => (
                      <th
                        key={h}
                        className={`${h === "Operations" ? "w-80 text-right" : h === "Game" ? "w-56 text-left" : "text-left"} px-4 py-3 text-xs font-medium uppercase tracking-wider text-amber-200/40`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="block md:table-row-group">
                {suspendedGames.map((g) => (
                  <RecentGameRow
                    key={g.id}
                    game={g}
                    onRefresh={fetchGames}
                    canHide={canHideGame}
                    canStop={canStopGame}
                    canRetrySettlement={canRetrySettlement}
                    onOpenCosts={() => setCostGame(g)}
                    onOpenHighlights={() => setHighlightsGame(g)}
                    onOpenMedia={() => setMediaGame(g)}
                    onOpenProviderFailures={() => setProviderFailuresGame(g)}
                    onOpenRetry={() => setRetryGame(g)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Waiting to start */}
      {showSection(["waiting"], waitingGames.length) && <section className="mb-8">
        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
          Waiting to Start ({waitingGames.length})
        </h2>
        {loading ? (
          <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
            Loading…
          </div>
        ) : waitingGames.length === 0 ? (
          <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
            No games waiting.{" "}
            {canCreateGame && (
              <Link
                href="/admin/games/new"
                className="text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                Create one →
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {waitingGames.map((g) => (
              <WaitingGameCard key={g.id} game={g} onRefresh={fetchGames} canStart={canStartGame} canFill={canFillGame} canStop={canStopGame} canHide={canHideGame} />
            ))}
          </div>
        )}
      </section>}

      {/* Recent games */}
      {showSection(["completed", "cancelled"], recentGames.length) && <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider">
            Recent Games ({recentGames.length})
          </h2>
        </div>
        {loading ? (
          <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
            Loading…
          </div>
        ) : recentGames.length === 0 ? (
          <div className="border border-white/10 rounded-xl p-8 text-center text-white/20 text-sm">
            No completed games yet.
          </div>
        ) : (
          <div className="rounded-xl border border-white/10">
            <table className="block w-full md:table md:table-fixed">
              <thead className="hidden md:table-header-group">
                <tr className="border-b border-white/10">
                  {["Game", "Winner", "Operations"].map(
                    (h) => (
                      <th
                        key={h}
                        className={`${h === "Operations" ? "w-80 text-right" : h === "Game" ? "w-56 text-left" : "text-left"} px-4 py-3 text-xs font-medium text-white/30`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="block md:table-row-group">
                {displayedRecentGames.map((g) => (
                  <RecentGameRow
                    key={g.id}
                    game={g}
                    canHide={canHideGame}
                    canStop={canStopGame}
                    canRetrySettlement={canRetrySettlement}
                    onRefresh={fetchGames}
                    onOpenCosts={() => setCostGame(g)}
                    onOpenHighlights={() => setHighlightsGame(g)}
                    onOpenMedia={() => setMediaGame(g)}
                    onOpenProviderFailures={() => setProviderFailuresGame(g)}
                    onOpenRetry={() => setRetryGame(g)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!narrowed && displayedRecentGames.length < recentGames.length && (
          <button
            type="button"
            onClick={() => setRecentLimit((current) => current + 10)}
            className="mt-3 w-full rounded-lg border border-white/10 px-4 py-2 text-sm text-white/45 transition-colors hover:border-white/20 hover:text-white/70 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            Show more ({recentGames.length - displayedRecentGames.length} remaining)
          </button>
        )}
      </section>}
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
      {providerFailuresGame && (
        <AdminProviderFailuresPanel
          key={providerFailuresGame.id}
          game={providerFailuresGame}
          onClose={() => setProviderFailuresGame(null)}
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
