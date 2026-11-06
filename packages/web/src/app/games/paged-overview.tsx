"use client";

import { useState } from "react";
import { enabledGameKinds } from "@influence/engine/game-availability";
import { usePermissions } from "@/hooks/use-permissions";
import { usePagedGames } from "@/hooks/use-paged-games";
import type { PagedGamesPage } from "@/lib/paged-games";
import type { GameStatus, SeasonIdentity } from "@/lib/api";
import { EpisodeShelf, GameCard } from "./games-browser";

type Filters = { kind: "all" | "influence" | "werewolf"; status: "all" | GameStatus; category: string };

export function PagedOverview({ seasons, initialOpen, filters }: { seasons: SeasonIdentity[]; initialOpen?: PagedGamesPage; filters: Filters }) {
  const [generation, setGeneration] = useState(0);
  const activeSeason = seasons.find(season => season.status === "active");
  const refresh = () => setGeneration(value => value + 1);
  const common = { status: filters.status === "all" ? "nonwaiting" : filters.status, category: filters.category, limit: "8" };
  const enabled = enabledGameKinds();
  const canSeeInfluence = enabled.includes("influence") && filters.kind !== "werewolf";
  const canSeeWerewolf = enabled.includes("werewolf") && filters.kind !== "influence";
  return <div>
    <p className="influence-copy-muted text-sm">Games can change while you browse. <button onClick={refresh}>Refresh games</button></p>
    {(filters.status === "all" || filters.status === "waiting") && <OverviewShelf key={`open:${generation}`} name="Open" initialPage={generation === 0 && filters.kind === "all" && filters.status === "all" && filters.category === "all" ? initialOpen : undefined} query={{ ...common, kind: filters.kind, status: "waiting", collection: "all" }} onRefresh={refresh} />}
    {filters.status !== "waiting" && canSeeInfluence && activeSeason && <OverviewShelf key={`season:${generation}`} name="Active season" href={`/games/season/${encodeURIComponent(activeSeason.slug)}`} query={{ ...common, kind: "influence", collection: "season", season: activeSeason.id }} onRefresh={refresh} />}
    {filters.status !== "waiting" && canSeeWerewolf && <OverviewShelf key={`werewolf:${generation}`} name="Werewolf" href="/games/type/werewolf" query={{ ...common, kind: "werewolf", collection: "all" }} onRefresh={refresh} />}
    {filters.status !== "waiting" && canSeeInfluence && <OverviewShelf key={`influence:${generation}`} name="Influence" href="/games/type/influence" query={{ ...common, kind: "influence", collection: "all", ...(activeSeason ? { excludeSeason: activeSeason.id } : {}) }} onRefresh={refresh} />}
  </div>;
}

function OverviewShelf({ name, href, query, onRefresh, initialPage }: { name: string; href?: string; query: Record<string, string>; onRefresh: () => void; initialPage?: PagedGamesPage }) {
  const library = usePagedGames(new URLSearchParams(query).toString(), initialPage);
  const { hasPermission, roles } = usePermissions();
  if (!library.items.length && !library.loading && !library.error && !library.nextCursor) return null;
  const refresh = async () => { onRefresh(); };
  return <section aria-label={`${name} shelf`}>
    {library.loading && <p role="status">Loading {name} games…</p>}
    {library.error && <p role="alert">{library.error} <button onClick={() => void library.retry()}>Try again</button></p>}
    {library.items.length > 0 && <EpisodeShelf name={name} grid={false} href={href}>{library.items.map(item => <GameCard key={item.game.id} game={item.game} canFill={hasPermission("fill_game")} canStart={hasPermission("start_game") && roles.some(role => ["gamer", "admin", "sysop"].includes(role))} canStop={hasPermission("stop_game")} canHide={hasPermission("hide_game")} onRefresh={refresh} />)}</EpisodeShelf>}
    {library.nextCursor && !library.error && <button disabled={library.loading} onClick={() => void library.loadMore()}>Load more {name} games</button>}
  </section>;
}
