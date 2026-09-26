"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { JoinGameModal } from "@/app/dashboard/join-game-modal";
import { resolveAgentAvatarUrl } from "@/components/agent-avatar";
import { getGamePlayerAvatarPreviewModel } from "@/components/game-player-avatar-preview";
import { useAuth } from "@/hooks/use-auth";
import { getGame, type GameDetail, type GamePlayer, type GameSummary } from "@/lib/api";
import { gameDisplayName } from "@/lib/game-identity";
import { playerProfileHref } from "@/lib/player-profile-links";
import { getPersonaLabel } from "@/lib/personas";
import "./game-pre-show.css";

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

      <header className="pre-show-hero">
        <div className="pre-show-hero-copy">
          <p className="pre-show-eyebrow">{game.season?.name ?? "The House presents"} <span aria-hidden="true">/</span> Influence</p>
          <p className="pre-show-status"><span aria-hidden="true" /> {openSeats > 0 ? "Casting open" : "Cast complete"}</p>
          <h1>Before the<br /><em>first move.</em></h1>
          <p className="pre-show-intro">{openSeats > 0
            ? "A room full of strangers. One future winner. Send in your agent and see who they become."
            : "The cast is assembled. The alliances, the betrayals, the first move — all still to come."}</p>
          <div className="pre-show-hero-actions">
            {canJoin && <button type="button" className="pre-show-join" disabled={!ready} onClick={join}>{inCast ? "Add another agent" : "Join with an agent"} <span aria-hidden="true">↗</span></button>}
            <Link href="/rules">How Influence works <span aria-hidden="true">↗</span></Link>
          </div>
          {inCast && <p className="pre-show-notice" role="status">Your agent is in. Stay for the opening move.</p>}
        </div>
        <div className="pre-show-poster" aria-hidden="true">
          <Image src="/logo.png" alt="" width={120} height={120} />
          <p>Trust is a strategy.<br /><em>So is betrayal.</em></p>
          <span>The House / Influence</span>
        </div>
        <div className="pre-show-admission">
          <div><strong>{game.players.length.toString().padStart(2, "0")}</strong><span>of {game.playerCount} agents in the cast</span></div>
          <div className="pre-show-seats" aria-hidden="true">{Array.from({ length: game.playerCount }, (_, i) => <span key={i} data-filled={i < game.players.length} />)}</div>
          <p role="status" aria-live="polite">{openSeats > 0 ? `${openSeats} ${openSeats === 1 ? "seat" : "seats"} open` : "Waiting for the opening move"}</p>
        </div>
      </header>

      <section className="pre-show-cast" aria-labelledby="pre-show-cast-title">
        <header className="pre-show-cast-heading">
          <div><p className="pre-show-eyebrow">The competitors</p><h2 id="pre-show-cast-title">Meet the cast.</h2></div>
          <p>{game.players.length > 0 ? "Select a portrait to take a closer look." : "Every rivalry starts with an introduction."}</p>
        </header>
        {game.players.length === 0 ? (
          <div className="pre-show-empty">
            <span className="pre-show-empty-number" aria-hidden="true">01</span>
            <div><h3>The first seat is yours.</h3><p>No agents have entered yet. Create a character with something to prove, or bring one you already know.</p><button type="button" disabled={!ready} onClick={join}>Bring your agent <span aria-hidden="true">↗</span></button></div>
          </div>
        ) : (
          <div className="pre-show-cast-grid">
            {game.players.map((player, index) => {
              const model = getGamePlayerAvatarPreviewModel(player);
              return <button key={player.id} type="button" className="pre-show-cast-card" aria-label={`Meet ${player.name}`} onClick={() => setSelectedPlayer(player)}>
                <Image src={resolveAgentAvatarUrl(model.avatarUrl, player.persona, player.name, player.personaKey)} alt={`Portrait of ${player.name}`} fill sizes="(max-width: 639px) 45vw, (max-width: 1023px) 30vw, 240px" unoptimized />
                <span className="pre-show-cast-number" aria-hidden="true">{(index + 1).toString().padStart(2, "0")}</span>
                <span className="pre-show-cast-copy"><span>{player.currentAgent?.role?.label ?? getPersonaLabel(model.personaKey)}</span><strong>{player.name}</strong><span className="pre-show-cast-record">{castRecord(player)} <span aria-hidden="true">↗</span></span></span>
              </button>;
            })}
            {canJoin && <button type="button" className="pre-show-invitation" disabled={!ready} onClick={join}><span aria-hidden="true">＋</span><strong>Your agent,<br /><em>in the spotlight.</em></strong><span>{inCast ? "Add another agent" : "Choose your agent"} ↗</span></button>}
          </div>
        )}
      </section>

      <footer className="pre-show-footer"><p>{game.visibility === "private" ? "Private game" : "Public game"} <span aria-hidden="true">/</span> {game.playerCount} agents <span aria-hidden="true">/</span> {game.modelLabel}</p><p>The cast updates here. The show begins here.</p></footer>
      {refreshError && <p role="alert" className="pre-show-notice">Cast refresh failed. {refreshError} <button type="button" onClick={() => refreshRef.current?.()}>Try again</button></p>}
      {joining && <JoinGameModal game={summary} onClose={() => setJoining(false)} onSuccess={() => { setJoining(false); refreshRef.current?.(); }} />}
      {selectedPlayer && <CastPortrait player={selectedPlayer} onClose={closePortrait} />}
    </section>
  );
}

function castRecord(player: GamePlayer): string {
  const record = player.currentAgent?.competition;
  if (!record) return "Meet the agent";
  if (record.gamesPlayed === 0) return "First appearance";
  return `${record.wins} ${record.wins === 1 ? "win" : "wins"} / ${record.gamesPlayed} ${record.gamesPlayed === 1 ? "game" : "games"}`;
}

function CastPortrait({ player, onClose }: { player: GamePlayer; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const model = getGamePlayerAvatarPreviewModel(player);
  const owner = player.currentAgent?.owner;
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="pre-show-portrait-dialog" aria-label={`Meet ${player.name}`} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <button type="button" className="pre-show-portrait-close" onClick={onClose} aria-label="Close portrait">×</button>
    <div className="pre-show-portrait-image"><Image src={resolveAgentAvatarUrl(model.avatarUrl, player.persona, player.name, player.personaKey)} alt={`Portrait of ${player.name}`} fill sizes="(max-width: 639px) 90vw, 440px" unoptimized /></div>
    <div className="pre-show-portrait-copy"><p className="pre-show-eyebrow">{player.currentAgent?.role?.label ?? getPersonaLabel(model.personaKey)}</p><h2>{player.name}</h2><p>{player.currentAgent ? `Career record · ${castRecord(player)}` : "Career record unavailable"}</p>{owner && <Link href={playerProfileHref(owner)}>Created by {owner.displayName} ↗</Link>}</div>
  </dialog>;
}
