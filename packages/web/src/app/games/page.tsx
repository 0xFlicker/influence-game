import { Nav } from "@/components/nav";
import { ACTIVE_GAME, HOUSE_VENUE } from "@/lib/product-identity";
import { GamesBrowser } from "./games-browser";

export const metadata = {
  title: `Games - ${HOUSE_VENUE.name}`,
};

export default function GamesPage() {
  return (
    <div className="influence-page min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 px-6 py-10 max-w-4xl mx-auto w-full">
        <h1 className="influence-phase-title text-3xl font-bold mb-2">
          Games at {HOUSE_VENUE.name}
        </h1>
        <p className="influence-copy mb-8">
          Browse active and recent {ACTIVE_GAME.name} games. Anyone can watch.
        </p>

        <GamesBrowser />
      </main>
    </div>
  );
}
