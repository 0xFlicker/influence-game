"use client";
import { CastingRoster, CastCard, CastInvitation } from "@/components/casting/casting-roster";

import { CastPortraitDialog } from "@/components/casting/cast-portrait";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { JoinGameModal } from "@/app/dashboard/join-game-modal";
import { resolveAgentAvatarUrl } from "@/components/agent-avatar";
import { getGamePlayerAvatarPreviewModel } from "@/components/game-player-avatar-preview";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { startGame, stopGame, hideGame } from "@/lib/api";
import { getGame, type GameDetail, type GamePlayer, type GameSummary } from "@/lib/api";
import { gameDisplayName } from "@/lib/game-identity";
import { playerProfileHref } from "@/lib/player-profile-links";
import { getPersonaLabel } from "@/lib/personas";
import { CastingHero } from "@/components/casting/casting-hero";

export function GamePreShow({ game, onGameUpdated }: {
  game: GameDetail;
  onGameUpdated: (game: GameDetail) => void;
}) {
  const router = useRouter();
  const { ready, authenticated, account } = useAuth();
  const [joining, setJoining] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<GamePlayer | null>(null);
  const refreshRef = useRef<(() => void) | null>(null);
  const openSeats = Math.max(0, game.playerCount - game.players.length);
  const ownPlayers = account ? game.players.filter(player => player.currentAgent?.owner?.publicId === account.publicId) : [];
  const inCast = ownPlayers.length > 0;
  const canAddAnother = !game.seasonId && account?.roles.some(role => ["admin", "sysop", "producer"].includes(role));
  const canJoin = openSeats > 0 && (!inCast || canAddAnother);
  const createHref = canJoin
    ? `/agents/create?flow=join_game&gameId=${encodeURIComponent(game.id)}`
    : "/agents/create";

  // Waiting games have no live observer socket. Read the canonical roster and
  // status until the game starts, then let the viewer take over.
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      clearTimeout(timer);
      if (!active || inFlight) return;
      if (document.hidden) return;
      inFlight = true;
      try {
        const next = await getGame(game.id, AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]));
        if (active) {
          setRefreshError(null);
          onGameUpdated(next);
        }
      } catch (error) {
        if (active) setRefreshError(error instanceof Error ? error.message : "Could not refresh the cast.");
      } finally {
        inFlight = false;
        if (active) timer = setTimeout(() => void refresh(), 5000);
      }
    };
    const wake = () => { if (!document.hidden) void refresh(); };
    refreshRef.current = () => void refresh();
    timer = setTimeout(() => void refresh(), 5000);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
      refreshRef.current = null;
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [game.id, onGameUpdated]);

  const summary: GameSummary = {
    ...game,
    alivePlayers: game.players.filter(player => player.status === "alive").length,
    eliminatedPlayers: game.players.filter(player => player.status === "eliminated").length,
    phaseTimeRemaining: null,
  };
  const closePortrait = useCallback(() => setSelectedPlayer(null), []);

  function join() {
    if (!ready || !canJoin) return;
    if (!authenticated) { router.push(createHref); return; }
    setJoining(true);
  }

  return (
    <section className="pre-show" aria-label="Game pre-show">
      <nav className="pre-show-nav" aria-label="Game navigation">
        <Link href="/games">← All games</Link>
        <span className="pre-show-code">{gameDisplayName(game)}</span>
        <Link className="pre-show-create" href={createHref}><span aria-hidden="true">＋</span> Create agent</Link>
      </nav>

      <CastingHero gameKind="influence" eyebrow={game.season?.name ?? "The House presents"}
        intro={openSeats > 0 ? "A room full of strangers. One future winner. Send in your agent and see who they become." : "The cast is assembled. The alliances, the betrayals, the first move — all still to come."}
        playerCount={game.playerCount} castCount={game.players.length}
        seatsLabel={`${openSeats} ${openSeats === 1 ? "seat" : "seats"} open`}
        canJoin={!!canJoin} disabled={!ready} onChoose={join}
        chooseLabel={inCast ? "Add another agent" : "Join with an agent"} rulesHref="/rules">
        {inCast && <p className="pre-show-notice" role="status">Your agent is in. Stay for the opening move.</p>}
        <PreGameControls game={game} onGameUpdated={onGameUpdated} />
      </CastingHero>

      <CastingRoster eyebrow="The competitors" description={game.players.length ? "Select a portrait to take a closer look." : "Every rivalry starts with an introduction."}
        empty={!game.players.length ? <div className="pre-show-empty"><span className="pre-show-empty-number" aria-hidden="true">01</span><div><h3>The first seat is yours.</h3><p>No agents have entered yet. Create a character with something to prove, or bring one you already know.</p><button type="button" disabled={!ready} onClick={join}>Bring your agent ↗</button></div></div> : undefined}
        invitation={canJoin && <CastInvitation disabled={!ready} onChoose={join} joined={inCast} />}>
        {game.players.map((player,index) => { const model=getGamePlayerAvatarPreviewModel(player); return <CastCard key={player.id} name={player.name} index={index} src={resolveAgentAvatarUrl(model.avatarUrl,player.persona,player.name,player.personaKey)} eyebrow={player.currentAgent?.role?.label ?? getPersonaLabel(model.personaKey)} detail={castRecord(player)} onInspect={() => setSelectedPlayer(player)} />; })}
      </CastingRoster>

      <footer className="pre-show-footer"><p>{game.visibility === "private" ? "Private game" : "Public game"} <span aria-hidden="true">/</span> {game.playerCount} agents <span aria-hidden="true">/</span> {game.modelLabel}</p><p>The cast updates here. The show begins here.</p></footer>
      {refreshError && <p role="alert" className="pre-show-notice">Cast refresh failed. {refreshError} <button type="button" onClick={() => refreshRef.current?.()}>Try again</button></p>}
      {joining && <JoinGameModal game={summary} onClose={() => setJoining(false)} onSuccess={() => { setJoining(false); refreshRef.current?.(); }} />}
      {selectedPlayer && <CastPortrait player={selectedPlayer} onClose={closePortrait} />}
    </section>
  );
}

function PreGameControls({ game, onGameUpdated }: { game: GameDetail; onGameUpdated: (game: GameDetail) => void }) {
  const { hasPermission } = usePermissions();
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmHide, setConfirmHide] = useState(false);
  const canStart = hasPermission("start_game");
  const canStop = hasPermission("stop_game");
  const canHide = hasPermission("hide_game");
  if (!canStart && !canStop && !canHide) return null;
  const full = game.players.length >= game.playerCount;
  async function act(action: "Start" | "Stop" | "Hide") {
    if (pending) return;
    setPending(action);
    setError(null);
    try {
      await ({ Start: startGame, Stop: stopGame, Hide: hideGame })[action](game.id);
      if (action === "Hide") router.push("/games");
      else onGameUpdated(await getGame(game.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${action.toLowerCase()} game.`);
    } finally {
      setPending(null);
    }
  }
  return <div className="mt-5" aria-label="Game controls">
    <div className="flex flex-wrap gap-2">
      {canStart && <button type="button" className="influence-button-primary rounded-lg px-4 py-2 disabled:opacity-50" disabled={pending !== null || !full} onClick={() => void act("Start")}>{pending === "Start" ? "Starting…" : "Start"}</button>}
      {canStop && <button type="button" className="influence-button-danger rounded-lg px-4 py-2 disabled:opacity-50" disabled={pending !== null} onClick={() => void act("Stop")}>{pending === "Stop" ? "Stopping…" : "Stop"}</button>}
      {canHide && <button type="button" className="influence-button-quiet rounded-lg px-4 py-2 disabled:opacity-50" disabled={pending !== null} onClick={() => setConfirmHide(true)}>{pending === "Hide" ? "Hiding…" : "Hide"}</button>}
    </div>
    <p className="influence-copy-muted mt-2 text-sm">{Math.min(game.players.length, game.playerCount)}/{game.playerCount} joined{full ? " · Ready to start" : ""}</p>
    {confirmHide && <div className="mt-3 text-sm" role="group" aria-label="Confirm hide game">
      <p>Hide this game from public lists?</p>
      <button type="button" className="influence-button-quiet rounded-lg px-3 py-2" disabled={pending !== null} onClick={() => setConfirmHide(false)}>Cancel</button>
      <button type="button" className="influence-button-danger rounded-lg px-3 py-2" disabled={pending !== null} onClick={() => { setConfirmHide(false); void act("Hide"); }}>Confirm hide</button>
    </div>}
    {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
  </div>;
}

function castRecord(player: GamePlayer): string {
  const record = player.currentAgent?.competition;
  if (!record) return "Meet the agent";
  if (record.gamesPlayed === 0) return "First appearance";
  return `${record.wins} ${record.wins === 1 ? "win" : "wins"} / ${record.gamesPlayed} ${record.gamesPlayed === 1 ? "game" : "games"}`;
}

function CastPortrait({ player, onClose }: { player: GamePlayer; onClose: () => void }) {
  const model = getGamePlayerAvatarPreviewModel(player);
  const owner = player.currentAgent?.owner;
  return <CastPortraitDialog name={player.name} src={resolveAgentAvatarUrl(model.avatarUrl,player.persona,player.name,player.personaKey)} eyebrow={player.currentAgent?.role?.label ?? getPersonaLabel(model.personaKey)} onClose={onClose}>
    <p>{player.currentAgent ? `Career record · ${castRecord(player)}` : "Career record unavailable"}</p>{owner && <Link href={playerProfileHref(owner)}>Created by {owner.displayName} ↗</Link>}
  </CastPortraitDialog>;
}
