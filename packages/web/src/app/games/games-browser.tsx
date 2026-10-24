"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { enabledGameKinds } from "@influence/engine/game-availability";
import { collectionLabel, matchesGameCollection, type GameCollection } from "@/lib/game-collections";
import { listWerewolfGames, fillWerewolfLobby, startWerewolfLobby, stopWerewolf, setWerewolfHidden, type WerewolfGameSummary } from "@/lib/werewolf-api";
import { EpisodeCard } from "./episode-preview";
import {
  fillGame,
  hideGame,
  listGames,
  listSeasons,
  type SeasonIdentity,
  startGame,
  stopGame,
  type GameStatus,
  type GameSummary,
} from "@/lib/api";
import { usePermissions } from "@/hooks/use-permissions";
import { ACTIVE_GAME } from "@/lib/product-identity";
import {
  gameCategoryValue,
  gameDisplayName,
  type GameCategoryValue,
} from "@/lib/game-identity";

function phaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    lobby: "LOBBY",
    discussion: "DISCUSS",
    whisper: "WHISPER",
    vote: "VOTE",
    reveal: "REVEAL",
    power: "POWER",
    jury_vote: "JURY VOTE",
    jury_questions: "JURY Q&A",
    finals_speech: "FINALS",
    done: "DONE",
  };
  return labels[phase] ?? phase.toUpperCase();
}

type StatusFilter = "all" | GameStatus;
type CategoryFilter = "all" | GameCategoryValue;

interface FiltersState {
  status: StatusFilter;
  category: CategoryFilter;
  search: string;
}

interface GameCardProps {
  game: GameSummary | WerewolfGameSummary;
  onJoin?: (game: GameSummary) => void;
  canFill: boolean;
  canStart: boolean;
  canStop: boolean;
  canHide: boolean;
  onRefresh: () => Promise<void>;
}

function GameCard({
  game,
  onJoin,
  canFill,
  canStart,
  canStop,
  canHide,
  onRefresh,
}: GameCardProps) {
  const isJoinable = game.status === "waiting";
  const isLive = game.status === "in_progress";
  const werewolf = "gameKind" in game && game.gameKind === "werewolf";
  const joinedPlayers = Math.min("joinedPlayers" in game ? game.joinedPlayers : game.alivePlayers, game.playerCount);
  const isReadyToStart = joinedPlayers >= game.playerCount;
  const canManage = (isJoinable && (canStart || (canFill && !isReadyToStart)))
    || ((isLive || isJoinable) && canStop) || (!isLive && canHide);

  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [filling, setFilling] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);
  const hideDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!confirmHide) return;
    const dialog = hideDialog.current!;
    dialog.showModal();
    return () => dialog.close();
  }, [confirmHide]);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleFill() {
    setActionError(null);
    setFilling(true);
    try {
      await (werewolf ? fillWerewolfLobby(game.id) : fillGame(game.id));
      await onRefresh();
      setFilling(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to fill game.");
      setFilling(false);
    }
  }

  async function handleStart() {
    setActionError(null);
    setStarting(true);
    try {
      await (werewolf ? startWerewolfLobby(game.id) : startGame(game.id));
      await onRefresh();
      setStarting(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to start game.");
      setStarting(false);
    }
  }

  async function handleStop() {
    setActionError(null);
    setStopping(true);
    try {
      await (werewolf ? stopWerewolf(game.id) : stopGame(game.id));
      await onRefresh();
      setStopping(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to stop game.");
      setStopping(false);
    }
  }

  async function handleHide() {
    setConfirmHide(false);
    setActionError(null);
    setHiding(true);
    try {
      await (werewolf ? setWerewolfHidden(game.id, true) : hideGame(game.id));
      await onRefresh();
      setHiding(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to hide game.");
      setHiding(false);
    }
  }

  return (
    <>
      <EpisodeCard game={game} onJoin={onJoin && "alivePlayers" in game ? () => onJoin(game) : undefined} management={canManage ? <div>
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            {isJoinable && canStart && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleStart();
                }}
                disabled={starting || filling || !isReadyToStart}
                className="influence-button-primary text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
              >
                {starting ? "Starting…" : "Start"}
              </button>
            )}
            {isJoinable && canFill && !isReadyToStart && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleFill();
                }}
                disabled={filling}
                className="influence-button-secondary text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
              >
                {filling ? "Filling…" : "Fill AI"}
              </button>
            )}
            {canStop && (isLive || isJoinable) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleStop();
                }}
                disabled={stopping}
                className="influence-button-danger text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
              >
                {stopping ? "Stopping…" : isLive ? "End" : "Stop"}
              </button>
            )}
            {canHide && !isLive && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmHide(true);
                }}
                disabled={hiding}
                className="influence-button-quiet text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
              >
                {hiding ? "Hiding…" : "Hide"}
              </button>
            )}
          </div>
        {isLive && "currentRound" in game && <span className="influence-copy-muted text-xs">Round {game.currentRound}/{game.maxRounds} · {phaseLabel(game.currentPhase)} · {game.alivePlayers} alive</span>}
        {actionError && <p role="alert" className="text-red-300 text-sm mt-2">{actionError}</p>}
      </div> : undefined} />

      {confirmHide && (
        <dialog ref={hideDialog} aria-label="Hide game" onCancel={() => setConfirmHide(false)} className="m-auto rounded-xl bg-zinc-900 text-white backdrop:bg-black/60">
          <div className="bg-zinc-900 border border-white/10 rounded-xl p-6 max-w-sm w-full mx-4">
            <p className="text-white text-sm mb-4">
              Hide game <strong>{gameDisplayName(game)}</strong> from public lists? It can be restored from Game History.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmHide(false)}
                className="text-sm text-white/50 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleHide()}
                className="text-sm bg-orange-600 hover:bg-orange-500 text-white px-4 py-1.5 rounded-lg transition-colors"
              >
                Hide
              </button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}

interface GamesBrowserProps {
  onJoin?: (game: GameSummary) => void;
  compact?: boolean;
  collection?: GameCollection;
  includeWerewolf?: boolean;
}

export function GamesBrowser({ onJoin, compact = false, collection, includeWerewolf = false }: GamesBrowserProps) {
  const { hasPermission, roles } = usePermissions();
  const [filters, setFilters] = useState<FiltersState>({ status: "all", category: "all", search: "" });
  const [games, setGames] = useState<GameSummary[]>([]);
  const showShelves = !compact && !collection;
  const [seasons, setSeasons] = useState<SeasonIdentity[]>([]);
  const [werewolfGames, setWerewolfGames] = useState<WerewolfGameSummary[]>([]);
  const [selectedKind, setKind] = useState<string>("all");
  const kind = collection?.kind === "game" ? collection.game : selectedKind;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshGames = useCallback(async () => {
    try {
      const [data, wolves, seasonList] = await Promise.all([listGames(), includeWerewolf && enabledGameKinds().includes("werewolf") ? listWerewolfGames() : Promise.resolve([]), showShelves ? listSeasons() : Promise.resolve([])]);
      setGames(data); setWerewolfGames(wolves); setSeasons(seasonList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load games.");
    } finally {
      setLoading(false);
    }
  }, [includeWerewolf, showShelves]);

  useEffect(() => {
    let cancelled = false;

    async function fetchGames() {
      try {
        const [data, wolves, seasonList] = await Promise.all([listGames(), includeWerewolf && enabledGameKinds().includes("werewolf") ? listWerewolfGames() : Promise.resolve([]), showShelves ? listSeasons() : Promise.resolve([])]);
        if (!cancelled) {
          setGames(data); setWerewolfGames(wolves); setSeasons(seasonList);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load games.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchGames();
    const interval = setInterval(() => {
      void fetchGames();
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [includeWerewolf, showShelves]);

  const canFill = hasPermission("fill_game");
  const canStart = hasPermission("start_game") && roles.some(role => ["gamer", "admin", "sysop"].includes(role));
  const canStop = hasPermission("stop_game");
  const canHide = hasPermission("hide_game");

  const STATUS_ORDER: Record<GameStatus, number> = {
    waiting: 0,
    in_progress: 1,
    suspended: 2,
    completed: 3,
    cancelled: 4,
  };

  const searchQuery = filters.search.toLowerCase();
  const scopedGames = games.filter(game => game.visibility === "public" && kind !== "werewolf" && (!collection || matchesGameCollection(game, collection)));
  const filtered = scopedGames
    .filter((g) => {
      if (filters.status !== "all" && g.status !== filters.status) return false;
      if (filters.category !== "all" && gameCategoryValue(g) !== filters.category) return false;
      if (searchQuery) {
        const haystack = `${g.episode?.title ?? ""} ${g.episode?.description ?? ""} ${(g.episode?.cast ?? []).map(p => p.name).join(" ")} ${g.slug} ${g.season?.name ?? ""} ${ACTIVE_GAME.name} ${g.winner ?? ""} ${g.winnerPersona ?? ""} ${g.modelLabel} ${g.trackType ?? ""}`.toLowerCase();
        if (!haystack.includes(searchQuery)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (statusDiff !== 0) return statusDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const filteredWerewolf = werewolfGames.filter(game => kind !== "influence"
    && (filters.status === "all" || game.status === filters.status)
    && (filters.category === "all" || filters.category === "custom")
    && (!collection || collection.kind === "public" || (collection.kind === "game" && collection.game === "werewolf"))
    && `werewolf ${game.slug} ${game.modelLabel} ${game.episode?.title ?? ""} ${game.episode?.description ?? ""} ${(game.episode?.cast ?? []).map(player => player.name).join(" ")}`.toLowerCase().includes(searchQuery))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const activeSeason = seasons.find(season => season.status === "active");
  const openGames = showShelves ? [
    ...filtered.filter(game => game.status === "waiting").map(game => ({ kind: "influence" as const, game })),
    ...filteredWerewolf.filter(game => game.status === "waiting").map(game => ({ kind: "werewolf" as const, game })),
  ].sort((a, b) => Date.parse(b.game.createdAt) - Date.parse(a.game.createdAt)) : [];
  const seasonGames = showShelves && activeSeason
    ? filtered.filter(game => game.status !== "waiting" && game.season?.id === activeSeason.id)
    : [];
  const libraryGames = showShelves ? filtered.filter(game => game.status !== "waiting" && (!activeSeason || game.season?.id !== activeSeason.id)) : filtered;
  const libraryWerewolf = showShelves ? filteredWerewolf.filter(game => game.status !== "waiting") : filteredWerewolf;

  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "waiting", label: "Open" },
    { value: "in_progress", label: "Live" },
    { value: "suspended", label: "Failed" },
    { value: "completed", label: "Done" },
  ];

  const seasonOptions = Array.from(
    new Map(scopedGames.flatMap((game) => game.season ? [[game.season.id, game.season]] : [])).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));
  const categoryOptions: Array<{ value: CategoryFilter; label: string }> = [
    { value: "all", label: "All games" },
    ...seasonOptions.map((season) => ({
      value: `season:${season.id}` as const,
      label: season.name,
    })),
    ...(scopedGames.some((game) => !game.season && game.trackType === "free")
      ? [{ value: "free" as const, label: "Free" }]
      : []),
    ...(((kind !== "influence" && werewolfGames.length > 0) || scopedGames.some((game) => !game.season && (game.trackType ?? "custom") === "custom"))
      ? [{ value: "custom" as const, label: "Custom" }]
      : []),
  ];

  if (loading) {
    return (
      <div className="episode-grid" role="status" aria-label="Loading games"><div className="episode-skeleton" /><div className="episode-skeleton" /><span className="sr-only">Loading games…</span></div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl p-8 text-center text-red-400/70 text-sm border border-red-400/30 bg-red-400/10">
        <p>{error}</p><button className="mt-3 underline" onClick={() => void refreshGames()}>Try again</button>
      </div>
    );
  }

  return (
    <div>
      {!compact && <div className="episode-library-toolbar">
        <input aria-label="Search games" value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} placeholder="Search titles, Agents, or code words…" />
        {includeWerewolf && collection?.kind !== "game" && <select aria-label="Game type" value={kind} onChange={event => setKind(event.target.value)}><option value="all">All types</option>{enabledGameKinds().map(game => <option key={game} value={game}>{game === "werewolf" ? "Werewolf" : "Influence"}</option>)}</select>}
        <select aria-label="Game status" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value as StatusFilter }))}>{statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select aria-label="Game category" value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value as CategoryFilter }))}>{categoryOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        {collection && <Link href="/games">All shelves</Link>}
      </div>}
      {filtered.length === 0 && filteredWerewolf.length === 0 ? (
        <div className="influence-empty-state rounded-xl p-12 text-center text-sm">
          {games.length === 0 && werewolfGames.length === 0 ? "No games yet." : "No games match the current filters."}
        </div>
      ) : (
        <div className={compact ? "episode-compact" : ""}>
          <div className={openGames.length > 0 && seasonGames.length > 0 && activeSeason ? "episode-featured-shelves" : undefined}>
          {openGames.length > 0 && <EpisodeShelf name="Open" grid={false}>
            {openGames.map(item => <GameCard key={item.game.id} game={item.game} onJoin={onJoin} canFill={canFill} canStart={canStart} canStop={canStop} canHide={canHide} onRefresh={refreshGames} />)}
          </EpisodeShelf>}
          {seasonGames.length > 0 && activeSeason && <EpisodeShelf name="Active season" grid={false} href={`/games/season/${encodeURIComponent(activeSeason.slug)}`}>
            {seasonGames.map(game => <GameCard key={game.id} game={game} onJoin={onJoin} canFill={canFill} canStart={canStart} canStop={canStop} canHide={canHide} onRefresh={refreshGames} />)}
          </EpisodeShelf>}
          </div>
          {libraryWerewolf.length > 0 && <EpisodeShelf name="Werewolf" grid={compact || !!filters.search || filters.status !== "all" || kind === "werewolf"} href="/games/type/werewolf">
            {libraryWerewolf.map(game => <GameCard key={game.id} game={game} canFill={canFill} canStart={canStart} canStop={canStop} canHide={canHide} onRefresh={refreshGames} />)}
          </EpisodeShelf>}
          {libraryGames.length > 0 && <EpisodeShelf name={showShelves ? "Influence" : collection ? collectionLabel(collection, games) : "Games"} grid={!showShelves} href={showShelves ? "/games/type/influence" : undefined}>
            {libraryGames.map(game => <GameCard key={game.id} game={game} onJoin={onJoin} canFill={canFill} canStart={canStart} canStop={canStop} canHide={canHide} onRefresh={refreshGames} />)}
          </EpisodeShelf>}
        </div>
      )}
    </div>
  );
}

function EpisodeShelf({ name, grid, href, children }: { name: string; grid: boolean; href?: string; children: React.ReactNode }) {
  const rail = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const scroll = (direction: number) => rail.current?.scrollBy({
    left: direction * rail.current.clientWidth,
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
  });
  useEffect(() => {
    const element = rail.current;
    if (!element || grid) return;
    const update = () => setEdges({ left: element.scrollLeft > 2, right: element.scrollLeft + element.clientWidth < element.scrollWidth - 2 });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    update();
    return () => { observer.disconnect(); element.removeEventListener("scroll", update); };
  }, [grid, children]);
  return <section className="episode-shelf" aria-label={name}><div className="episode-shelf-heading"><h2>{name}</h2>{!grid && <div className="flex gap-2">{href && <Link href={href} className="rounded border border-white/20 px-3 py-2 text-sm">View all</Link>}<button disabled={!edges.left} aria-label={`Previous ${name} games`} onClick={() => scroll(-1)}>←</button><button disabled={!edges.right} aria-label={`Next ${name} games`} onClick={() => scroll(1)}>→</button></div>}</div><div ref={rail} className={grid ? "episode-grid" : `episode-rail ${edges.left ? "has-before" : ""} ${edges.right ? "has-after" : ""}`}>{children}</div></section>;
}
