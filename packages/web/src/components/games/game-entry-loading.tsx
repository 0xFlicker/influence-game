import Link from "next/link";
import { GameSiteEntry } from "./game-site-entry";

export function GameEntrySkeleton({ results = false }: { results?: boolean }) {
  return <section className="space-y-6" role="status" aria-label={results ? "Loading results" : "Loading game"}>
    <div className="influence-panel rounded-xl" aria-hidden="true">
      <div className="grid min-h-64 gap-5 p-6 sm:p-8">
        <div className="motion-safe:animate-pulse space-y-4 self-center">
          <div className="h-4 w-24 rounded bg-white/10" />
          <div className="h-9 w-2/3 max-w-sm rounded bg-white/10" />
          <div className="h-4 w-4/5 max-w-lg rounded bg-white/10" />
          <div className="h-11 w-36 rounded bg-white/10" />
        </div>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" aria-hidden="true">
      {[0, 1, 2, 3].map(index => <div key={index} className="influence-panel h-36 rounded-xl motion-safe:animate-pulse sm:h-44" />)}
    </div>
  </section>;
}

export function GameEntryLoading({ results = false }: { results?: boolean }) {
  return <GameSiteEntry>
    <Link href="/games" className="mb-5 inline-block text-sm text-white/70">← All games</Link>
    <GameEntrySkeleton results={results} />
  </GameSiteEntry>;
}
