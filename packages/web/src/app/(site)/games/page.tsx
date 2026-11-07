import { Nav } from "@/components/nav";
import { HOUSE_VENUE } from "@/lib/product-identity";
import { PagedGamesInitial } from "@/app/games/paged-server";
import { Suspense } from "react";

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

        <Suspense fallback={<div className="episode-grid" role="status" aria-label="Loading games"><div className="episode-skeleton" /><div className="episode-skeleton" /></div>}>
          <PagedGamesInitial />
        </Suspense>
      </main>
    </div>
  );
}
