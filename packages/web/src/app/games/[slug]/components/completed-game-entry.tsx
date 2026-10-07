"use client";

import Link from "next/link";
import {
  type GameCompetitionReceipt,
  type PublicPostgameMediaResponse,
} from "@/lib/api";
import { completedGameModeHref, gameHighlightsHref } from "@/lib/game-links";
import { PlayerProfileLink } from "@/components/player-profile-link";
import { PostgameTrailer } from "./postgame-trailer";
export { postgameMediaStateCopy } from "./postgame-trailer";

interface CompletedGameEntryProps {
  gameId: string;
  hasReplay: boolean;
  initialMedia?: PublicPostgameMediaResponse;
}

export function CompletedGameEntry({
  gameId,
  hasReplay,
  initialMedia,
}: CompletedGameEntryProps) {
  return (
    <section className="mx-auto flex min-h-[56vh] w-full max-w-3xl flex-col justify-center px-4 py-8 text-center">
      <div className="text-xs tracking-[0.18em] text-white/35">
        Completed game {gameId}
      </div>
      <h2 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
        Start here
      </h2>
      <p className="mt-3 max-w-lg text-sm text-white/50">
        Watch the House trailer, replay the game unspoiled, or inspect the full results.
      </p>
      <div className="mt-6 text-left">
        <PostgameTrailer key={gameId} gameId={gameId} initialMedia={initialMedia} />
      </div>

      <div className="mt-5 grid w-full gap-3 text-left sm:grid-cols-3">
        <Link
          href={gameHighlightsHref(gameId)}
          className="rounded-lg border border-red-300/25 bg-red-950/25 px-5 py-4 text-left transition-colors hover:bg-red-900/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-200/80"
        >
          <div className="text-sm font-semibold text-red-100">House Highlights</div>
          <div className="mt-1 text-xs text-red-100/55">Open the spoiler-forward cut.</div>
        </Link>

        {hasReplay ? (
          <Link
            href={completedGameModeHref(gameId, "replay")}
            className="rounded-lg border border-white/15 bg-white/[0.06] px-5 py-4 text-left transition-colors hover:bg-white/[0.1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phase/60"
          >
            <div className="text-sm font-semibold text-white">Watch Replay</div>
            <div className="mt-1 text-xs text-white/45">Start from the beginning without spoilers.</div>
          </Link>
        ) : (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-5 py-4 text-left opacity-60">
            <div className="text-sm font-semibold text-white">Replay unavailable</div>
            <div className="mt-1 text-xs text-white/35">No public replay transcript was found.</div>
          </div>
        )}

        <Link
          href={completedGameModeHref(gameId, "results")}
          className="rounded-lg border border-cyan-400/30 bg-cyan-950/25 px-5 py-4 text-left transition-colors hover:bg-cyan-900/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200/80"
        >
          <div className="text-sm font-semibold text-cyan-100">See Results</div>
          <div className="mt-1 text-xs text-cyan-100/55">Open the full postgame review.</div>
        </Link>
      </div>
    </section>
  );
}

export function SeasonReceiptSummary({ receipts }: { receipts: GameCompetitionReceipt[] }) {
  const rankedReceipts = [...receipts].sort((left, right) =>
    right.totalPoints - left.totalPoints
    || (left.placement ?? Number.MAX_SAFE_INTEGER) - (right.placement ?? Number.MAX_SAFE_INTEGER)
    || left.agentName.localeCompare(right.agentName),
  );

  return (
    <section aria-labelledby="season-receipts-title" className="influence-panel mt-5 w-full overflow-hidden rounded-xl text-left">
      <div className="border-b border-border-active/60 px-4 py-3">
        <h3 id="season-receipts-title" className="text-sm font-medium text-text-primary">Championship point receipts</h3>
        <p className="influence-copy-muted mt-1 text-xs">Points earned this game and current season totals.</p>
      </div>
      <div className="divide-y divide-border-active/50">
        {rankedReceipts.map((receipt) => (
          <article key={`${receipt.gameId}:${receipt.agentId}`} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_repeat(3,auto)] sm:items-center sm:gap-5">
            <div>
              <div className="text-sm font-medium text-text-primary">{receipt.agentName}</div>
              <div className="influence-copy-muted text-xs">
                {receipt.placement === null ? "Not eligible" : `Place ${receipt.placement} of ${receipt.lobbySize}`}
              </div>
              <div className="influence-copy-muted mt-1 text-xs">
                Architect:{" "}
                <PlayerProfileLink
                  player={receipt.owner}
                  className="hover:text-phase hover:underline"
                >
                  {receipt.ownerName ?? "Anonymous architect"}
                </PlayerProfileLink>
              </div>
            </div>
            <ReceiptFact
              label="Points earned"
              value={`+${receipt.totalPoints}`}
              detail={receipt.fieldBonus > 0 ? `Includes +${receipt.fieldBonus} strong-field bonus` : undefined}
              strong
            />
            <ReceiptFact label="Season total" value={String(receipt.seasonTotalPoints)} strong />
            <ReceiptFact
              label="Account ELO"
              value={receipt.accountRatingDelta === null
                ? "—"
                : `${receipt.accountRatingDelta >= 0 ? "+" : ""}${receipt.accountRatingDelta}`}
            />
          </article>
        ))}
      </div>
    </section>
  );
}

function ReceiptFact({
  label,
  value,
  detail,
  strong = false,
}: {
  label: string;
  value: string;
  detail?: string;
  strong?: boolean;
}) {
  return (
    <div className="min-w-14">
      <div className="influence-copy-muted text-[10px] uppercase tracking-wider">{label}</div>
      <div className={`mt-0.5 font-mono text-sm ${strong ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{value}</div>
      {detail && <div className="influence-copy-muted mt-0.5 max-w-40 text-[10px] leading-tight">{detail}</div>}
    </div>
  );
}
