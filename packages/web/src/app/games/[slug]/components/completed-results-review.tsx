"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { completedGameModeHref, gameHighlightsHref, gameHref } from "@/lib/game-links";
import {
  getCompletedGameResults,
  getGameAlliances,
  type CompetitionReceipt,
  type CompletedGameResultsResponse,
  type GameDetail,
  type PublicGameAlliancesResponse,
} from "@/lib/api";
import { buildCompletedAllianceArcsModel, type AllianceFactsLoadState } from "./match-watch-alliance-model";
import { buildCompletedResultsReviewModel } from "./completed-results-model";
import { CompletedResultsVoteMatrix } from "./completed-results-vote-matrix";
import { CompletedResultsAgentCard } from "./completed-results-agent-card";
import { CompletedResultsAllianceArcs } from "./completed-results-alliance-arcs";
import { SeasonReceiptSummary } from "./completed-game-entry";

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
  const [allianceFacts, setAllianceFacts] = useState<PublicGameAlliancesResponse | null>(null);
  const [allianceLoadState, setAllianceLoadState] = useState<AllianceFactsLoadState>("idle");
  const [allianceError, setAllianceError] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    startTransition(() => {
      setAllianceLoadState("loading");
      setAllianceError(null);
    });
    getGameAlliances(gameId)
      .then((result) => {
        if (!cancelled) {
          setAllianceFacts(result);
          setAllianceLoadState("ready");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setAllianceFacts(null);
          setAllianceLoadState("error");
          setAllianceError(err instanceof Error ? err.message : "Failed to load alliance arcs.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const currentState = loadState.gameId === gameId ? loadState : { gameId, status: "loading" as const };

  useEffect(() => {
    if (currentState.status !== "ready" || typeof window === "undefined") return;
    const anchor = window.location.hash ? decodeURIComponent(window.location.hash.slice(1)) : "";
    if (!anchor) return;
    const target = document.getElementById(anchor);
    if (!target) return;
    requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
  }, [currentState.status, gameId]);

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
  const allianceArcs = buildCompletedAllianceArcsModel({
    loadState: allianceLoadState,
    facts: allianceFacts,
    error: allianceError,
  }, game.players);
  const { overview, timeline, voteMatrix, agentCards } = model;
  const playerById = new Map(game.players.map((player) => [player.id, player]));
  const gameSlug = game.slug ?? game.id;

  return (
    <section id="results" className="space-y-6" data-testid="completed-results-review">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-white/35">Final Results</div>
          <h2 className="mt-1 text-2xl font-semibold text-white">
            {overview.headline}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={gameHref(gameSlug)}
            className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/[0.1]"
          >
            Trailer
          </Link>
          <Link
            href={gameHighlightsHref(gameSlug)}
            className="rounded-lg border border-red-300/25 bg-red-500/10 px-3 py-2 text-sm text-red-100 transition-colors hover:bg-red-500/15"
          >
            House Highlights
          </Link>
          <Link
            href={completedGameModeHref(gameSlug, "replay")}
            className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/[0.1]"
          >
            Watch Replay
          </Link>
        </div>
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

      <CompletedResultsSeasonSummary
        seasonId={game.seasonId}
        receipts={game.competitionReceipts}
      />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-white/85">What Happened</h3>
        {timeline.length > 0 ? (
          <ol className="grid gap-2 sm:grid-cols-2">
            {timeline.map((item, index) => (
              <li
                key={`${item.playerId}:${index}`}
                id={timeline.findIndex((candidate) => candidate.round === item.round) === index ? `round-${item.round}` : undefined}
                className="rounded-lg border border-white/10 bg-white/[0.04] p-3 scroll-mt-24"
              >
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

      <CompletedResultsAllianceArcs model={allianceArcs} />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-white/85">Vote History</h3>
        <CompletedResultsVoteMatrix columns={voteMatrix.columns} rows={voteMatrix.rows} />
      </section>

      {payload.results.jury.status === "available" && (
        <section id="jury" className="space-y-3 scroll-mt-24">
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

export function CompletedResultsSeasonSummary({
  seasonId,
  receipts = [],
}: {
  seasonId?: string;
  receipts?: CompetitionReceipt[];
}) {
  if (!seasonId && receipts.length === 0) return null;
  const points = receipts.reduce((sum, receipt) => sum + receipt.totalPoints, 0);

  return (
    <section aria-label="Season results">
      {seasonId && (
        <Link
          href={`/games/free?season=${encodeURIComponent(seasonId)}`}
          className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/55 transition-colors hover:border-white/20 hover:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phase/60"
        >
          Rated season game{receipts.length > 0 ? ` · ${points} points awarded` : ""}
        </Link>
      )}
      {receipts.length > 0 && <SeasonReceiptSummary receipts={receipts} />}
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
