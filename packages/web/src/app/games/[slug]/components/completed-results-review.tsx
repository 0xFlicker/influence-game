"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getCompletedGameResults,
  type CompletedGameResultsResponse,
  type GameDetail,
} from "@/lib/api";
import { buildCompletedResultsReviewModel } from "./completed-results-model";
import { CompletedResultsVoteMatrix } from "./completed-results-vote-matrix";
import { CompletedResultsAgentCard } from "./completed-results-agent-card";

type ResultsLoadState =
  | { gameId: string; status: "loading" }
  | { gameId: string; status: "ready"; payload: CompletedGameResultsResponse }
  | { gameId: string; status: "error"; error: string };

export function CompletedResultsReview({
  gameId,
  game,
}: {
  gameId: string;
  game: GameDetail;
}) {
  const [loadState, setLoadState] = useState<ResultsLoadState>({
    gameId,
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    getCompletedGameResults(gameId)
      .then((result) => {
        if (!cancelled) setLoadState({ gameId, status: "ready", payload: result });
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadState({
            gameId,
            status: "error",
            error: err instanceof Error ? err.message : "Failed to load results.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const currentState = loadState.gameId === gameId ? loadState : { gameId, status: "loading" as const };

  if (currentState.status === "error") {
    return (
      <div className="rounded-lg border border-red-900/40 bg-red-950/20 p-6 text-sm text-red-200/70">
        {currentState.error}
      </div>
    );
  }

  if (currentState.status === "loading") {
    return (
      <div className="influence-glass rounded-panel p-8 text-sm text-white/60">
        Loading results...
      </div>
    );
  }

  const { payload } = currentState;
  const model = buildCompletedResultsReviewModel(payload.results);
  const { overview, timeline, voteMatrix, agentCards } = model;
  const playerById = new Map(game.players.map((player) => [player.id, player]));

  return (
    <section className="space-y-6" data-testid="completed-results-review">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-white/35">Final Results</div>
          <h2 className="mt-1 text-2xl font-semibold text-white">
            {overview.headline}
          </h2>
        </div>
        <Link
          href={`/games/${game.slug ?? game.id}?mode=replay`}
          className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/[0.1]"
        >
          Watch Replay
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <OverviewStat label="Won By" value={overview.winnerResolution} />
        {overview.finalVoteLabel ? (
          <OverviewStat label="Final Vote" value={overview.finalVoteLabel} />
        ) : null}
        <OverviewStat label="Rounds" value={String(overview.roundsPlayed)} />
        <OverviewStat label="Players" value={String(overview.playerCount || game.players.length)} />
        {overview.detailLabel ? (
          <OverviewStat label="Details" value={overview.detailLabel} muted={overview.degraded} />
        ) : null}
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-white/85">What Happened</h3>
        {timeline.length > 0 ? (
          <ol className="grid gap-2 sm:grid-cols-2">
            {timeline.map((item, index) => (
              <li key={`${item.playerId}:${index}`} className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                <div className="text-xs text-white/35">Round {item.round} · {item.source}</div>
                <div className="mt-1 text-sm text-white/80">{item.playerName} was eliminated</div>
                <div className="mt-1 text-xs text-white/40">{item.method}</div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-white/45">
            Elimination details are unavailable for this game.
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-white/85">Vote History</h3>
        <CompletedResultsVoteMatrix columns={voteMatrix.columns} rows={voteMatrix.rows} />
      </section>

      {payload.results.jury.status === "available" && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-white/85">Jury Vote</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {payload.results.jury.voteCounts.map((entry) => (
              <div key={entry.finalist.id} className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                <div className="text-sm font-medium text-white/80">{entry.finalist.name}</div>
                <div className="mt-1 text-xs text-white/45">{entry.votes} votes</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-white/85">Agents</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {agentCards.map((card) => (
            <CompletedResultsAgentCard
              key={card.player.id}
              card={card}
              player={playerById.get(card.player.id)}
            />
          ))}
        </div>
      </section>
    </section>
  );
}

function OverviewStat({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-white/30">{label}</div>
      <div className={`mt-1 truncate text-sm font-medium ${muted ? "text-amber-100/75" : "text-white/80"}`}>
        {value}
      </div>
    </div>
  );
}
