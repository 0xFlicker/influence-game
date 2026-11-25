import { serverApiFetch } from "@/lib/server-api";
import type { SeasonIdentity } from "@/lib/api";
import { gameCollectionQuery, type GameCollection } from "@/lib/game-collections";
import { decodePagedGamesPage, type PagedGamesPage } from "@/lib/paged-games";
import { HybridGamesBrowser } from "./hybrid-games-browser";
import { initialOverviewFilters, overviewShelves, type OverviewPages } from "./paged-overview-queries";

const options = (): RequestInit => ({ cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(1500) });
const getSeasons = () => serverApiFetch<{ seasons: SeasonIdentity[] }>("/api/seasons", options()).then(result => result.seasons).catch(() => undefined);
const getPage = (query: URLSearchParams) => serverApiFetch<unknown>(`/api/public-games/page?${query}`, options()).then(decodePagedGamesPage).catch(() => undefined);

/** Start the first pages on the server and stream each shelf independently. */
export async function PagedGamesInitial() {
  const seasonsPromise = getSeasons();
  const pages: OverviewPages = {};
  for (const { name, query } of overviewShelves([], initialOverviewFilters)) {
    if (name === "Open" || name === "Werewolf") pages[query] = getPage(new URLSearchParams(query));
  }
  const seasons = await seasonsPromise;
  for (const { query } of overviewShelves(seasons ?? [], initialOverviewFilters)) {
    pages[query] ??= getPage(new URLSearchParams(query));
  }
  return <HybridGamesBrowser initialSeasons={seasons} initialOverview={pages} />;
}

export async function PagedCollectionInitial({ collection }: { collection: GameCollection }) {
  const seasonsPromise = getSeasons();
  const pageFor = (season?: SeasonIdentity): Promise<PagedGamesPage | undefined> => {
    if (collection.kind === "season" && !season) return Promise.resolve(undefined);
    return getPage(gameCollectionQuery(collection, season));
  };
  const initialPagePromise = collection.kind === "season" ? seasonsPromise.then(seasons => pageFor(seasons?.find(item => item.slug === collection.slug))) : pageFor();
  const [initialPage, seasons] = await Promise.all([initialPagePromise, seasonsPromise]);
  return <HybridGamesBrowser collection={collection} initialSeasons={seasons} initialPage={initialPage} />;
}
