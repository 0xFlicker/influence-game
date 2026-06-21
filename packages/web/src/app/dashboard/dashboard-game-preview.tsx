"use client";

import Link from "next/link";
import type { DashboardQueueSummary } from "./dashboard-mission-control";
import type { GameSummary } from "@/lib/api";

interface DashboardGamePreviewProps {
  games: GameSummary[];
  queueSummary: DashboardQueueSummary | null;
  loading: boolean;
  error: string | null;
  onJoin: (game: GameSummary) => void;
}

function gameHref(game: GameSummary): string {
  return `/games/${game.slug ?? game.id}`;
}

function statusLabel(game: GameSummary): string {
  if (game.status === "in_progress") return "Live";
  if (game.status === "waiting") return "Open";
  if (game.status === "suspended") return "Needs inspection";
  if (game.status === "completed") return "Done";
  return "Void";
}

function phaseLabel(phase: string): string {
  return phase.replace(/_/g, " ").toUpperCase();
}

export function DashboardGamePreview({
  games,
  queueSummary,
  loading,
  error,
  onJoin,
}: DashboardGamePreviewProps) {
  return (
    <section className="influence-panel rounded-xl p-5" data-testid="dashboard-game-preview">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="influence-section-title">Games</h2>
          <p className="influence-copy-muted mt-1 text-xs">Live and open matches</p>
        </div>
        <Link href="/games" className="influence-link text-xs">
          View all -&gt;
        </Link>
      </div>

      {loading ? (
        <div className="influence-empty-state rounded-lg p-6 text-center text-sm">Loading games...</div>
      ) : error ? (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : games.length === 0 ? (
        <div className="influence-empty-state rounded-lg p-6 text-center text-sm">
          No live or open games right now.
          <div className="mt-2">
            <Link href="/games" className="influence-link text-xs">
              Browse all games -&gt;
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {games.map((game) => (
            <div key={game.id} className="influence-panel-muted rounded-lg p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-text-primary">Game #{game.gameNumber}</p>
                    <span className="influence-chip px-2 py-0.5 text-xs">{statusLabel(game)}</span>
                    {game.trackType === "free" && (
                      <span className="rounded-full border border-emerald-900/60 bg-emerald-900/40 px-2 py-0.5 text-xs font-medium text-emerald-400">
                        Free
                      </span>
                    )}
                  </div>
                  <p className="influence-copy-muted text-xs">
                    {phaseLabel(game.currentPhase)} / {Math.min(game.alivePlayers, game.playerCount)}/{game.playerCount} seated
                  </p>
                </div>
                {game.status === "waiting" ? (
                  <button
                    type="button"
                    onClick={() => onJoin(game)}
                    className="influence-button-primary shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium"
                  >
                    Join
                  </button>
                ) : (
                  <Link href={gameHref(game)} className="influence-button-secondary shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium">
                    Watch
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-border-active/50 bg-surface-raised/40 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary">{queueSummary?.label ?? "Free games"}</p>
            <p className="influence-copy-muted text-xs">
              {queueSummary?.description ?? "Daily queue, standings, and free-game details live on the focused page."}
            </p>
          </div>
          <Link href={queueSummary?.href ?? "/games/free"} className="influence-link shrink-0 text-xs">
            Open -&gt;
          </Link>
        </div>
      </div>
    </section>
  );
}
