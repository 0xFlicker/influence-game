"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { collectionLabel, gameCollectionHref, matchesGameCollection, type GameCollection } from "@/lib/game-collections";
import { EpisodeCard } from "./episode-preview";
import {
  fillGame,
  hideGame,
  listGames,
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
  game: GameSummary;
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
  const joinedPlayers = Math.min(game.alivePlayers, game.playerCount);
  const isReadyToStart = joinedPlayers >= game.playerCount;
  const slotsInfo = isJoinable ? `${joinedPlayers}/${game.playerCount} joined` : undefined;

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
      await fillGame(game.id);
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
      await startGame(game.id);
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
      await stopGame(game.id);
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
      await hideGame(game.id);
      await onRefresh();
      setHiding(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to hide game.");
      setHiding(false);
    }
  }

  return (
    <>
      <EpisodeCard game={game} actions={<div>
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
            {isJoinable && onJoin && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onJoin(game);
                }}
                className="influence-button-primary text-xs px-3 py-1.5 rounded-lg font-medium"
              >
                Join
              </button>
            )}
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
        {isLive && <span className="influence-copy-muted text-xs">Round {game.currentRound}/{game.maxRounds} · {phaseLabel(game.currentPhase)} · {game.alivePlayers} alive</span>}
        {isJoinable && <span className="influence-copy-muted text-xs">{slotsInfo}{isReadyToStart ? " · Ready to start" : ""}</span>}
        {actionError && <p role="alert" className="text-red-300 text-sm mt-2">{actionError}</p>}
      </div>} />

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
}

export function GamesBrowser({ onJoin, compact = false, collection }: GamesBrowserProps) {
  const { hasPermission } = usePermissions();
  const [filters, setFilters] = useState<FiltersState>({ status: "all", category: "all", search: "" });
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshGames = useCallback(async () => {
    try {
      const data = await listGames();
      setGames(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load games.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchGames() {
      try {
        const data = await listGames();
        if (!cancelled) {
          setGames(data);
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
  }, []);

  const canCreate = hasPermission("create_game");
  const canFill = hasPermission("fill_game");
  const canStart = hasPermission("start_game");
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
  const scopedGames = games.filter(game => !collection || matchesGameCollection(game, collection));
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

  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "waiting", label: "Open" },
    { value: "in_progress", label: "Live" },
    { value: "suspended", label: "Failed" },
    { value: "completed", label: "Done" },
  ];

  const seasonOptions = Array.from(
    new Map(games.flatMap((game) => game.season ? [[game.season.id, game.season]] : [])).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));
  const categoryOptions: Array<{ value: CategoryFilter; label: string }> = [
    { value: "all", label: "All games" },
    ...seasonOptions.map((season) => ({
      value: `season:${season.id}` as const,
      label: season.name,
    })),
    ...(games.some((game) => !game.season && game.trackType === "free")
      ? [{ value: "free" as const, label: "Free" }]
      : []),
    ...(games.some((game) => !game.season && (game.trackType ?? "custom") === "custom")
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
        <select aria-label="Game status" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value as StatusFilter }))}>{statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select aria-label="Game category" value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value as CategoryFilter }))}>{categoryOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        {canCreate && <Link href="/games/new" className="influence-button-primary rounded-lg px-4 py-3 text-sm">+ New Game</Link>}
        {collection && <Link href="/games">All shelves</Link>}
      </div>}
      {filtered.length === 0 ? (
        <div className="influence-empty-state rounded-xl p-12 text-center text-sm">
          {games.length === 0 ? "No games yet." : "No games match the current filters."}
        </div>
      ) : (
        <div className={compact ? "episode-compact" : ""}>
          {(compact || filters.search || filters.status !== "all" || filters.category !== "all" || collection ? [[collection ? collectionLabel(collection, games) : "Games", filtered] as const] : Array.from(filtered.reduce((map, game) => { const name = shelfName(game); map.set(name, [...(map.get(name) ?? []), game]); return map; }, new Map<string, GameSummary[]>())).sort(([a], [b]) => shelfRank(a) - shelfRank(b))).map(([name, items]) => <EpisodeShelf key={name} name={name} grid={compact || Boolean(filters.search) || filters.status !== "all" || filters.category !== "all" || !!collection} href={items[0] ? gameCollectionHref(items[0]) : "/games"}>
            {items.map(game => <GameCard key={game.id} game={game} onJoin={onJoin} canFill={canFill} canStart={canStart} canStop={canStop} canHide={canHide} onRefresh={refreshGames} />)}
          </EpisodeShelf>)}
        </div>
      )}
    </div>
  );
}

function shelfRank(name: string) { return name === "Your private games" ? 2 : name === "Public games" ? 1 : 0; }
function shelfName(game: GameSummary) { return game.visibility === "private" ? "Your private games" : game.season?.name ?? "Public games"; }
function EpisodeShelf({ name, grid, href, children }: { name: string; grid: boolean; href: string; children: React.ReactNode }) {
  const rail = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
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
  return <section className="episode-shelf" aria-label={name}><div className="episode-shelf-heading"><h2>{name}</h2>{!grid && <div className="flex gap-2"><Link href={href} className="rounded border border-white/20 px-3 py-2 text-sm">View all</Link><button disabled={!edges.left} aria-label={`Previous ${name} games`} onClick={() => rail.current?.scrollBy({ left: -rail.current.clientWidth, behavior: "smooth" })}>←</button><button disabled={!edges.right} aria-label={`Next ${name} games`} onClick={() => rail.current?.scrollBy({ left: rail.current.clientWidth, behavior: "smooth" })}>→</button></div>}</div><div ref={rail} className={grid ? "episode-grid" : `episode-rail ${edges.left ? "has-before" : ""} ${edges.right ? "has-after" : ""}`}>{children}</div></section>;
}
