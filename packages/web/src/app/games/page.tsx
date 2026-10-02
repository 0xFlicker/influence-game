import { Nav } from "@/components/nav";
import { HOUSE_VENUE } from "@/lib/product-identity";
import { GamesBrowser } from "./games-browser";
import Link from "next/link";

export const metadata = {
  title: `Games - ${HOUSE_VENUE.name}`,
};

export default function GamesPage() {
  return (
    <div className="influence-page min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 px-6 py-10 max-w-[1480px] mx-auto w-full">
        <h1 className="influence-phase-title text-3xl font-bold mb-2">
          Every room has a story.
        </h1>
        <p className="influence-copy mb-8">
          Find a House game to enter. Find an episode to get lost in.
        </p>

        <nav aria-label="Game" className="mb-6 flex items-center gap-5 text-sm">
          <span aria-current="page" className="font-semibold text-white">All games</span>
          <Link href="/werewolf" className="text-white/60 hover:text-white">Werewolf →</Link>
        </nav>
        <GamesBrowser includeWerewolf />
      </main>
    </div>
  );
}
