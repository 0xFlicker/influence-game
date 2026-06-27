import Link from "next/link";

interface CompletedGameEntryProps {
  gameId: string;
  gameNumber?: number;
  hasReplay: boolean;
}

export function CompletedGameEntry({
  gameId,
  gameNumber,
  hasReplay,
}: CompletedGameEntryProps) {
  return (
    <section className="min-h-[56vh] flex flex-col items-center justify-center text-center px-4">
      <div className="mb-4 text-xs uppercase tracking-[0.18em] text-white/35">
        Completed game{gameNumber ? ` #${gameNumber}` : ""}
      </div>
      <h2 className="text-2xl sm:text-3xl font-semibold text-white">
        Choose how to enter
      </h2>
      <p className="mt-3 max-w-lg text-sm text-white/50">
        Watch the replay unspoiled, or open the results review when you are ready to see the outcome.
      </p>

      <div className="mt-8 grid w-full max-w-xl gap-3 sm:grid-cols-2">
        {hasReplay ? (
          <Link
            href={`/games/${gameId}?mode=replay`}
            className="rounded-lg border border-white/15 bg-white/[0.06] px-5 py-4 text-left transition-colors hover:bg-white/[0.1]"
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
          href={`/games/${gameId}?mode=results`}
          className="rounded-lg border border-cyan-400/30 bg-cyan-950/25 px-5 py-4 text-left transition-colors hover:bg-cyan-900/30"
        >
          <div className="text-sm font-semibold text-cyan-100">See Results</div>
          <div className="mt-1 text-xs text-cyan-100/55">Open the full postgame review.</div>
        </Link>
      </div>
    </section>
  );
}
