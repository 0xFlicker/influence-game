import { Nav } from "@/components/nav";
import type { GameCollection } from "@/lib/game-collections";
import { GamesBrowser } from "./games-browser";

export function CollectionPage({ collection, title }: { collection: GameCollection; title: string }) {
  return <div className="influence-page min-h-screen flex flex-col"><Nav />
    <main className="flex-1 px-6 py-10 max-w-[1480px] mx-auto w-full">
      <h1 className="influence-phase-title text-3xl font-bold mb-8">{title}</h1>
      <GamesBrowser collection={collection} />
    </main>
  </div>;
}
