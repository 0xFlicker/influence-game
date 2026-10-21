import { Nav } from "@/components/nav";
import type { GameCollection } from "@/lib/game-collections";
import { GamesBrowser } from "./games-browser";

export function CollectionPage({ collection, title }: { collection: GameCollection; title: string }) {
  return <div className="game-library-page min-h-screen flex flex-col"><Nav />
    <main className="game-library-content">
      <h1 className="text-3xl font-semibold tracking-tight mb-8">{title}</h1>
      <GamesBrowser collection={collection} includeWerewolf={collection.kind === "game" && collection.game === "werewolf"} />
    </main>
  </div>;
}
