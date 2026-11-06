import { serverApiFetch } from "@/lib/server-api";
import type { SeasonIdentity } from "@/lib/api";
import type { GameCollection } from "@/lib/game-collections";
import { decodePagedGamesPage, type PagedGamesPage } from "@/lib/paged-games";
import { HybridGamesBrowser } from "./hybrid-games-browser";

const options = (): RequestInit => ({ cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(1500) });
const getSeasons = () => serverApiFetch<{ seasons: SeasonIdentity[] }>("/api/seasons", options()).then(result => result.seasons).catch(() => undefined);
const getPage = (query: URLSearchParams) => serverApiFetch<unknown>(`/api/public-games/page?${query}`, options()).then(decodePagedGamesPage).catch(() => undefined);

/** Server-render the first page without forwarding user credentials. */
export async function PagedGamesInitial() {
  const [initialPage, seasons] = await Promise.all([getPage(new URLSearchParams({ status: "waiting", limit: "8" })), getSeasons()]);
  return <HybridGamesBrowser initialSeasons={seasons} initialPage={initialPage} />;
}

export async function PagedCollectionInitial({ collection }: { collection: GameCollection }) {
  const seasonsPromise = getSeasons();
  const pageFor = (season?: SeasonIdentity): Promise<PagedGamesPage | undefined> => {
    if (collection.kind === "season" && !season) return Promise.resolve(undefined);
    const query = new URLSearchParams({ kind: collection.kind === "game" ? collection.game : "influence", collection: collection.kind === "season" ? "season" : collection.kind === "public" ? "public" : "all", status: "all", category: "all" });
    if (season) query.set("season", season.id);
    return getPage(query);
  };
  const initialPagePromise = collection.kind === "season" ? seasonsPromise.then(seasons => pageFor(seasons?.find(item => item.slug === collection.slug))) : pageFor();
  const [initialPage, seasons] = await Promise.all([initialPagePromise, seasonsPromise]);
  return <HybridGamesBrowser collection={collection} initialSeasons={seasons} initialPage={initialPage} />;
}
