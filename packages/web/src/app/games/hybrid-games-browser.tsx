"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { enabledGameKinds } from "@influence/engine/game-availability";
import { listSeasons, type SeasonIdentity } from "@/lib/api";
import type { GameCollection } from "@/lib/game-collections";
import type { PagedGamesPage } from "@/lib/paged-games";
import { GamesBrowser, type CategoryFilter, type FiltersState, type StatusFilter } from "./games-browser";
import { PagedOverview } from "./paged-overview";
import { PagedCollection } from "./paged-collection";

type GameKind = "all" | "influence" | "werewolf";

/** Browse with bounded pages; use the existing complete-list search only while searching. */
export function HybridGamesBrowser({ collection, initialSeasons, initialPage }: { collection?: GameCollection; initialSeasons?: SeasonIdentity[]; initialPage?: PagedGamesPage }) {
  const [filters, setFilters] = useState<FiltersState>({ status: "all", category: "all", search: "" });
  const [kind, setKind] = useState<GameKind>("all");
  const [hasInteracted, setHasInteracted] = useState(false);
  const [seasons, setSeasons] = useState(initialSeasons);
  const [seasonError, setSeasonError] = useState(false), [seasonAttempt, setSeasonAttempt] = useState(0);
  useEffect(() => {
    if (seasons !== undefined) return;
    const controller = new AbortController();
    void listSeasons(controller.signal).then(result => { setSeasonError(false); setSeasons(result); }).catch(() => { if (!controller.signal.aborted) setSeasonError(true); });
    return () => controller.abort();
  }, [seasons, seasonAttempt]);
  const enabled = enabledGameKinds();
  const showWerewolf = !collection || (collection.kind === "game" && collection.game === "werewolf");
  const selectedKind = collection?.kind === "game" ? collection.game : kind;
  const seed = hasInteracted ? undefined : initialPage;
  return <div>
    <div className="episode-library-toolbar">
      <input aria-label="Search games" value={filters.search} placeholder="Search titles, Agents, or code words…" onChange={event => { const search = event.target.value; if (search) setHasInteracted(true); setFilters(current => ({ ...current, search })); }} />
      {!collection && <select aria-label="Game type" value={kind} onChange={event => { setHasInteracted(true); setKind(event.target.value as GameKind); }}><option value="all">All types</option>{enabled.map(game => <option key={game} value={game}>{game === "werewolf" ? "Werewolf" : "Influence"}</option>)}</select>}
      <select aria-label="Game status" value={filters.status} onChange={event => { setHasInteracted(true); setFilters(current => ({ ...current, status: event.target.value as StatusFilter })); }}><option value="all">All</option><option value="waiting">Open</option><option value="in_progress">Live</option><option value="suspended">Failed</option><option value="completed">Done</option></select>
      <select aria-label="Game category" value={filters.category} onChange={event => { setHasInteracted(true); setFilters(current => ({ ...current, category: event.target.value as CategoryFilter })); }}><option value="all">All games</option>{(seasons ?? []).map(season => <option key={season.id} value={`season:${season.id}`}>{season.name}</option>)}<option value="free">Free</option><option value="custom">Custom</option></select>
      {collection && <Link href="/games">All shelves</Link>}
    </div>
    {seasonError && <p role="alert">Could not load seasons. <button onClick={() => { setSeasonError(false); setSeasonAttempt(value => value + 1); }}>Try again</button></p>}
    {filters.search ? <GamesBrowser collection={collection} includeWerewolf={showWerewolf} externalFilters={filters} externalKind={selectedKind} hideToolbar uncappedWerewolfSearch />
      : collection?.kind === "season" && seasons === undefined ? <p role="status">Loading season games…</p>
      : collection ? <PagedCollection collection={collection} seasons={seasons ?? []} status={filters.status} category={filters.category} initialPage={seed} />
      : <PagedOverview seasons={seasons ?? []} initialOpen={seed} filters={{ kind, status: filters.status, category: filters.category }} />}
  </div>;
}
