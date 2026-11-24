"use client";

import { Suspense, use, useState } from "react";
import { usePermissions } from "@/hooks/use-permissions";
import { usePagedGames } from "@/hooks/use-paged-games";
import type { PagedGamesPage } from "@/lib/paged-games";
import type { SeasonIdentity } from "@/lib/api";
import { EpisodeShelf, GameCard } from "./games-browser";
import { GameLibrarySkeleton } from "./game-library-loading";
import { overviewShelves, type OverviewFilters, type OverviewPages } from "./paged-overview-queries";

export function PagedOverview({ seasons, initialPages, filters }: { seasons: SeasonIdentity[]; initialPages?: OverviewPages; filters: OverviewFilters }) {
  const [generation, setGeneration] = useState(0);
  const refresh = () => setGeneration(value => value + 1);
  return <div>
    <p className="influence-copy-muted text-sm">Games can change while you browse. <button onClick={refresh}>Refresh games</button></p>
    {overviewShelves(seasons, filters).map(shelf =>
      <Suspense key={`${shelf.name}:${generation}`} fallback={<GameLibrarySkeleton shelf={shelf.name} />}>
        <OverviewShelf {...shelf} firstPage={generation === 0 ? initialPages?.[shelf.query] : undefined} onRefresh={refresh} />
      </Suspense>)}
  </div>;
}

function OverviewShelf({ name, href, query, onRefresh, firstPage }: { name: string; href?: string; query: string; onRefresh: () => void; firstPage?: Promise<PagedGamesPage | undefined> }) {
  const initialPage = firstPage ? use(firstPage) : undefined;
  const library = usePagedGames(query, initialPage);
  const { hasPermission, roles } = usePermissions();
  if (!library.items.length && !library.loading && !library.error && !library.nextCursor) return null;
  const refresh = async () => { onRefresh(); };
  return <section aria-label={`${name} shelf`}>
    {library.loading && !library.items.length && <GameLibrarySkeleton shelf={name} />}
    {library.error && <p role="alert">{library.error} <button onClick={() => void library.retry()}>Try again</button></p>}
    {library.items.length > 0 && <EpisodeShelf name={name} grid={false} href={href}>{library.items.map(item => <GameCard key={item.game.id} game={item.game} canFill={hasPermission("fill_game")} canStart={hasPermission("start_game") && roles.some(role => ["gamer", "admin", "sysop"].includes(role))} canStop={hasPermission("stop_game")} canHide={hasPermission("hide_game")} onRefresh={refresh} />)}</EpisodeShelf>}
    {library.nextCursor && !library.error && <button disabled={library.loading} onClick={() => void library.loadMore()}>Load more {name} games</button>}
  </section>;
}
