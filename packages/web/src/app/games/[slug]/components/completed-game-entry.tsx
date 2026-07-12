"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getPostgameMedia,
  type CompetitionReceipt,
  type PublicPostgameMediaResponse,
} from "@/lib/api";
import { completedGameModeHref, gameHighlightsHref } from "@/lib/game-links";
import { PostgameMediaPlayer } from "./postgame-media-player";

interface CompletedGameEntryProps {
  gameId: string;
  gameNumber?: number;
  hasReplay: boolean;
  initialMedia?: PublicPostgameMediaResponse;
}

export function postgameMediaStateCopy(
  status: Exclude<PublicPostgameMediaResponse["status"], "ready">,
): { title: string; description: string } {
  switch (status) {
    case "queued":
    case "rendering":
      return {
        title: "Trailer in preparation",
        description: "The House is preparing this completed game's trailer.",
      };
    case "failed":
      return {
        title: "Trailer unavailable",
        description: "This completed game's trailer is not available right now.",
      };
    case "not_requested":
    case "waiting_inputs":
    case "waiting_music":
      return {
        title: "Trailer not available yet",
        description: "The House has not published a trailer for this completed game.",
      };
  }
}

export function CompletedGameEntry({
  gameId,
  gameNumber,
  hasReplay,
  initialMedia,
}: CompletedGameEntryProps) {
  const [media, setMedia] = useState<PublicPostgameMediaResponse | undefined>(initialMedia);
  const [mediaLoading, setMediaLoading] = useState(initialMedia === undefined);

  useEffect(() => {
    if (initialMedia !== undefined) return;

    let cancelled = false;
    getPostgameMedia(gameId)
      .then((response) => {
        if (!cancelled) setMedia(response);
      })
      .catch(() => {
        // The completed-game entry remains usable when the optional media read fails.
      })
      .finally(() => {
        if (!cancelled) setMediaLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [gameId, initialMedia]);

  return (
    <section className="mx-auto flex min-h-[56vh] w-full max-w-3xl flex-col justify-center px-4 py-8 text-center">
      <div className="text-xs uppercase tracking-[0.18em] text-white/35">
        Completed game{gameNumber ? ` #${gameNumber}` : ""}
      </div>
      <h2 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
        Start here
      </h2>
      <p className="mt-3 max-w-lg text-sm text-white/50">
        Watch the House trailer, replay the game unspoiled, or inspect the full results.
      </p>
      <div className="mt-6 text-left">
        {media?.status === "ready" ? (
          <PostgameMediaPlayer gameId={gameId} media={media} />
        ) : media ? (
          <PostgameMediaState status={media.status} />
        ) : (
          <PostgameMediaUnavailable loading={mediaLoading} />
        )}
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

export function SeasonReceiptSummary({ receipts }: { receipts: CompetitionReceipt[] }) {
  return (
    <section aria-labelledby="season-receipts-title" className="influence-panel mt-5 w-full overflow-hidden rounded-xl text-left">
      <div className="border-b border-border-active/60 px-4 py-3">
        <h3 id="season-receipts-title" className="text-sm font-medium text-text-primary">Championship point receipts</h3>
        <p className="influence-copy-muted mt-1 text-xs">Public placement points and bounded strong-field bonuses.</p>
      </div>
      <div className="divide-y divide-border-active/50">
        {receipts.map((receipt) => (
          <article key={`${receipt.gameId}:${receipt.agentId}`} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_repeat(4,auto)] sm:items-center sm:gap-5">
            <div>
              <div className="text-sm font-medium text-text-primary">{receipt.agentName}</div>
              <div className="influence-copy-muted text-xs">
                {receipt.placement === null ? "Not eligible" : `Place ${receipt.placement} of ${receipt.lobbySize}`}
              </div>
            </div>
            <ReceiptFact label="Base" value={String(receipt.basePoints)} />
            <ReceiptFact label="Field" value={`+${receipt.fieldBonus}`} />
            <ReceiptFact label="Total" value={String(receipt.totalPoints)} strong />
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

function ReceiptFact({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-14">
      <div className="influence-copy-muted text-[10px] uppercase tracking-wider">{label}</div>
      <div className={`mt-0.5 font-mono text-sm ${strong ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{value}</div>
    </div>
  );
}

function PostgameMediaState({
  status,
}: {
  status: Exclude<PublicPostgameMediaResponse["status"], "ready">;
}) {
  const copy = postgameMediaStateCopy(status);
  return (
    <section
      className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-4 sm:px-5"
      aria-labelledby="postgame-media-state-title"
      data-testid={`postgame-media-state-${status}`}
    >
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/35">House Highlights trailer</div>
      <h3 id="postgame-media-state-title" className="mt-1 text-base font-semibold text-white">{copy.title}</h3>
      <p className="mt-1 text-sm leading-6 text-white/55">{copy.description}</p>
    </section>
  );
}

function PostgameMediaUnavailable({ loading }: { loading: boolean }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-4 sm:px-5" aria-live="polite">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/35">House Highlights trailer</div>
      <h3 className="mt-1 text-base font-semibold text-white">
        {loading ? "Checking trailer availability" : "Trailer availability unavailable"}
      </h3>
      <p className="mt-1 text-sm leading-6 text-white/55">
        Browse the completed game while the trailer status is unavailable.
      </p>
    </section>
  );
}
