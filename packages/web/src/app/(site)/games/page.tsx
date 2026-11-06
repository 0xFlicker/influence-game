import { Nav } from "@/components/nav";
import { HOUSE_VENUE } from "@/lib/product-identity";
import { GamesBrowser } from "@/app/games/games-browser";
import Link from "next/link";
import { Suspense } from "react";
import { getServerRecentGames } from "@/lib/server-api";
import type { GameSummary } from "@/lib/api";

export const metadata = {
  title: `Games - ${HOUSE_VENUE.name}`,
};

export default function GamesPage() {
  return (
    <div className="game-library-page min-h-screen flex flex-col">
      <Nav />

      <main className="game-library-content">
        <h1 className="text-3xl font-semibold tracking-tight mb-2">
          Every room has a story.
        </h1>
        <p className="influence-copy mb-8">
          Find a House game to enter. Find an episode to get lost in.
        </p>

        <Link href="/games/new" className="mb-6 inline-block rounded-lg border border-white/20 px-4 py-2 text-sm">Create game →</Link>
        <Suspense fallback={<div className="episode-grid" role="status" aria-label="Loading games"><div className="episode-skeleton" /><div className="episode-skeleton" /></div>}>
          <InitialGamesBrowser />
        </Suspense>
      </main>
    </div>
  );
}

async function InitialGamesBrowser() {
  let initialGames: GameSummary[] = [];
  try {
    // This is a public-only read. Never forward the viewer's cookies or credentials.
    initialGames = await getServerRecentGames();
  } catch {
    // The client browser remains usable if the initial shelf is unavailable.
  }
  return <GamesBrowser includeWerewolf initialGames={initialGames} />;
}
