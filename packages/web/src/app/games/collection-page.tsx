import { Nav } from "@/components/nav";
import { Suspense } from "react";
import type { GameCollection } from "@/lib/game-collections";
import { PagedCollectionInitial } from "./paged-server";
import { GameLibrarySkeleton } from "./game-library-loading";

export function CollectionPage({ collection, title }: { collection: GameCollection; title: string }) {
  return <div className="game-library-page min-h-screen flex flex-col"><Nav />
    <main className="game-library-content">
      <h1 className="text-3xl font-semibold tracking-tight mb-8">{title}</h1>
      <Suspense fallback={<GameLibrarySkeleton grid toolbar />}>
        <PagedCollectionInitial collection={collection} />
      </Suspense>
    </main>
  </div>;
}
