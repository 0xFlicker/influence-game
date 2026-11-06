"use client";

import { usePagedGames } from "@/hooks/use-paged-games";
import { usePermissions } from "@/hooks/use-permissions";
import type { GameStatus, SeasonIdentity } from "@/lib/api";
import type { PagedGamesPage } from "@/lib/paged-games";
import type { GameCollection } from "@/lib/game-collections";
import { EpisodeShelf, GameCard } from "./games-browser";

export function PagedCollection({ collection, seasons, status, category, initialPage }: { collection: GameCollection; seasons: SeasonIdentity[]; status: "all" | GameStatus; category: string; initialPage?: PagedGamesPage }) {
  const season = collection.kind === "season" ? seasons.find(item => item.slug === collection.slug) : undefined;
  if (collection.kind === "season" && !season) return <p role="alert">This season is unavailable.</p>;
  return <PagedCollectionResults collection={collection} season={season} status={status} category={category} initialPage={initialPage} />;
}

function PagedCollectionResults({ collection, season, status, category, initialPage }: { collection: GameCollection; season?: SeasonIdentity; status: "all" | GameStatus; category: string; initialPage?: PagedGamesPage }) {
  const { hasPermission, roles } = usePermissions();
  const params = new URLSearchParams({
    kind: collection.kind === "game" ? collection.game : "influence",
    collection: collection.kind === "season" ? "season" : collection.kind === "public" ? "public" : "all",
    status, category,
  });
  if (season) params.set("season", season.id);
  const library = usePagedGames(params.toString(), initialPage);
  const name = collection.kind === "game" ? (collection.game === "werewolf" ? "Werewolf" : "Influence") : collection.kind === "season" ? season?.name ?? "Season games" : "Public games";
  return <div>
    <p className="influence-copy-muted text-sm">Games can change while you browse. <button disabled={library.loading} onClick={() => void library.refresh()}>Refresh games</button></p>
    {library.loading && <p role="status">Loading games…</p>}
    {library.error && <p role="alert">{library.error} <button onClick={() => void library.retry()}>Try again</button></p>}
    {library.items.length > 0 && <EpisodeShelf name={name} grid>{library.items.map(item => <GameCard key={item.game.id} game={item.game} canFill={hasPermission("fill_game")} canStart={hasPermission("start_game") && roles.some(role => ["gamer", "admin", "sysop"].includes(role))} canStop={hasPermission("stop_game")} canHide={hasPermission("hide_game")} onRefresh={library.refresh} />)}</EpisodeShelf>}
    {!library.loading && !library.error && !library.items.length && !library.nextCursor && <p className="influence-empty-state">No games match the current filters.</p>}
    {library.nextCursor && !library.error && <button disabled={library.loading} onClick={() => void library.loadMore()}>Load more games</button>}
  </div>;
}
