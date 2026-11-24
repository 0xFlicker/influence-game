import { HOUSE_VENUE } from "@/lib/product-identity";
import { GameLibraryShell, GameLibrarySkeleton } from "@/app/games/game-library-loading";
import { PagedGamesInitial } from "@/app/games/paged-server";
import { Suspense } from "react";

export const metadata = {
  title: `Games - ${HOUSE_VENUE.name}`,
};

export default function GamesPage() {
  return <GameLibraryShell>
    <Suspense fallback={<GameLibrarySkeleton toolbar />}>
      <PagedGamesInitial />
    </Suspense>
  </GameLibraryShell>;
}
