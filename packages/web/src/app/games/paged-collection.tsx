"use client";

import { useEffect, useRef } from "react";
import { usePagedGames } from "@/hooks/use-paged-games";
import { usePermissions } from "@/hooks/use-permissions";
import type { GameStatus, SeasonIdentity } from "@/lib/api";
import type { PagedGamesPage } from "@/lib/paged-games";
import { collectionLabel, gameCollectionQuery, type GameCollection } from "@/lib/game-collections";
import type { HouseGameKind } from "@influence/engine/game-availability";
import { EpisodeShelf, GameCard } from "./games-browser";
import { GameLibrarySkeleton } from "./game-library-loading";

export function PagedCollection({ collection, seasons, status, category, kind, initialPage }: { collection: GameCollection; seasons: SeasonIdentity[]; status: "all" | GameStatus; category: string; kind: "all" | HouseGameKind; initialPage?: PagedGamesPage }) {
  const season = collection.kind === "season" ? seasons.find(item => item.slug === collection.slug) : undefined;
  if (collection.kind === "season" && !season) return <p role="alert">This season is unavailable.</p>;
  const query = gameCollectionQuery(collection, season, status, category, kind).toString();
  return <PagedCollectionResults query={query} name={collectionLabel(collection, season?.name)} initialPage={initialPage} />;
}

function PagedCollectionResults({ query, name, initialPage }: { query: string; name: string; initialPage?: PagedGamesPage }) {
  const { hasPermission, roles } = usePermissions();
  const library = usePagedGames(query, initialPage);
  return <div>
    {library.loading && !library.items.length && <GameLibrarySkeleton grid />}
    {library.error && <p role="alert">{library.error} <button onClick={() => void library.retry()}>Try again</button></p>}
    {library.items.length > 0 && <EpisodeShelf name={name} grid>{library.items.map(item => <GameCard key={item.game.id} game={item.game} canFill={hasPermission("fill_game")} canStart={hasPermission("start_game") && roles.some(role => ["gamer", "admin", "sysop"].includes(role))} canStop={hasPermission("stop_game")} canHide={hasPermission("hide_game")} onRefresh={library.refresh} />)}</EpisodeShelf>}
    {!library.loading && !library.error && !library.items.length && !library.nextCursor && <p className="influence-empty-state">No games match the current filters.</p>}
    {library.nextCursor && !library.error && (library.loading
      ? <span className="sr-only" role="status">Loading games</span>
      : <CollectionEnd onReachEnd={library.loadMore} />)}
  </div>;
}

function CollectionEnd({ onReachEnd }: { onReachEnd: () => Promise<void> }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = end.current;
    if (!target) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void onReachEnd();
    }, { rootMargin: "0px 0px 160px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [onReachEnd]);
  return <div ref={end} className="h-px" aria-hidden="true" />;
}
