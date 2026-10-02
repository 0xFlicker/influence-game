"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WerewolfAudience } from "@influence/engine/werewolf/observation";
import { Nav } from "@/components/nav";
import { CastingHero } from "@/components/casting/casting-hero";
import { AgentSelector } from "@/components/casting/agent-selector";
import { resolveAgentAvatarUrl } from "@/components/agent-avatar";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { getPersonaLabel } from "@/lib/personas";
import { getWerewolfLobby, joinWerewolfLobby, leaveWerewolfLobby, startWerewolfLobby, stopWerewolf, type WerewolfLobbyData } from "@/lib/werewolf-api";
import { WerewolfViewer } from "./werewolf-viewer";

export function WerewolfEntry({ slug, audience }: { slug: string; audience?: WerewolfAudience }) {
  const query = useQuery({ queryKey: ["werewolf-lobby", slug], queryFn: ({ signal }) => getWerewolfLobby(slug, signal),
    refetchInterval: state => state.state.data?.status === "waiting" ? 5_000 : false, retry: false });
  const game = query.data;
  if (!game) return <main className="mx-auto max-w-6xl p-8"><Link href="/games">← All games</Link>{query.error ? <p role="alert" className="mt-6">{query.error.message} <button onClick={() => void query.refetch()}>Try again</button></p> : <p role="status" className="mt-6">Opening the village…</p>}</main>;
  if (game.status === "waiting") return <div className="influence-page min-h-screen"><Nav /><main className="mx-auto max-w-6xl px-6 py-10"><WerewolfWaitingGame game={game} refresh={async () => { const result = await query.refetch(); if (result.error) throw result.error; }} />{query.error && <p role="alert">Cast refresh failed. {query.error.message}</p>}</main></div>;
  if (game.status === "cancelled" && !game.started) return <main className="mx-auto max-w-3xl p-8"><Link href="/games">← All games</Link><h1 className="mt-8 text-3xl">This game was stopped.</h1></main>;
  if (audience) return <WerewolfViewer key={`${slug}:${audience}`} slug={slug} audience={audience} />;
  return <main className="mx-auto flex min-h-[80dvh] max-w-3xl flex-col justify-center px-6 py-12">
    <Link href="/games" className="mb-10 text-sm text-white/60">← All games</Link>
    <p className="text-xs uppercase tracking-[.2em] text-white/50">The House · Werewolf</p>
    <h1 className="mt-3 text-4xl font-semibold">How will you watch?</h1>
    <p className="mt-4 text-white/65">{slug} · Your viewing mode stays fixed for this replay.</p>
    <div className="mt-8 grid gap-4 sm:grid-cols-2">
      <Link href="?audience=mystery" className="rounded-xl border border-white/20 bg-white/[.03] p-6 hover:bg-white/[.08]"><h2 className="text-xl">Watch Mystery</h2><p className="mt-3 leading-6 text-white/65">Follow the public conversation. Discover roles at the ending.</p></Link>
      <Link href="?audience=omniscient" className="rounded-xl border border-white/20 bg-white/[.03] p-6 hover:bg-white/[.08]"><h2 className="text-xl">Watch Omniscient</h2><p className="mt-3 leading-6 text-white/65">Know the roles, hear the pack and optionally watch players think.</p></Link>
    </div>
  </main>;
}

function WerewolfWaitingGame({ game, refresh }: { game: WerewolfLobbyData; refresh: () => Promise<void> }) {
  const auth = useAuth();
  const { hasPermission } = usePermissions();
  const [choosing, setChoosing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const operator = auth.account?.roles.some(role => ["admin", "sysop", "producer"].includes(role)) ?? false;
  const inCast = game.players.some(player => player.ownerPublicId === auth.account?.publicId);
  const openSeats = Math.max(0, game.playerCount - game.players.length);
  const canJoin = openSeats > 0 && (!inCast || operator);
  const createHref = `/agents/create?flow=join_werewolf&gameId=${encodeURIComponent(game.id)}`;
  function choose() { if (!auth.authenticated) auth.openSignIn(); else setChoosing(true); }
  async function act(action: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try { await action(); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the game."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className="pre-show" aria-label="Werewolf casting">
    <nav className="pre-show-nav" aria-label="Game navigation"><Link href="/games">← All games</Link><span className="pre-show-code">{game.slug}</span><Link className="pre-show-create" href={createHref}>＋ Create agent</Link></nav>
    <CastingHero gameKind="werewolf" intro="A village full of familiar faces. A pack hiding among them. Bring your agent and see who survives the night."
      playerCount={game.playerCount} castCount={game.players.length} seatsLabel={`${openSeats} ${openSeats === 1 ? "seat" : "seats"} open`}
      canJoin={canJoin} disabled={busy || !auth.ready} onChoose={choose} chooseLabel={inCast ? "Add another agent" : "Join with an agent"} rulesHref="/rules?game=werewolf">
      {inCast && <p className="pre-show-notice">Your agent is in. This cast is saved.</p>}
      {hasPermission("start_game") && <div className="mt-5"><button disabled={busy} className="pre-show-join" onClick={() => void act(() => startWerewolfLobby(game.id))}>{busy ? "Updating…" : "Start Werewolf"}</button><p className="pre-show-notice">{openSeats ? `Starting adds ${openSeats} House agents to fill the village.` : "The village is ready."} Roles and strategies freeze at the start.</p></div>}
      {hasPermission("stop_game") && <button className="mt-4 text-sm text-red-300" disabled={busy} onClick={() => void act(() => stopWerewolf(game.id))}>Cancel game</button>}
      {error && <p role="alert" className="pre-show-notice">{error}</p>}
    </CastingHero>
    <section className="pre-show-cast" aria-labelledby="werewolf-cast-title"><header className="pre-show-cast-heading"><div><p className="pre-show-eyebrow">The village</p><h2 id="werewolf-cast-title">Meet the cast.</h2></div><p>The cast updates here. Roles are assigned when the game starts.</p></header>
      {game.players.length === 0 ? <div className="pre-show-empty"><span className="pre-show-empty-number" aria-hidden="true">01</span><div><h3>The first seat is yours.</h3><p>Bring a character you know. Their Werewolf strategy guides this game.</p><button disabled={!auth.ready || busy} onClick={choose}>Bring your agent ↗</button></div></div>
        : <div className="pre-show-cast-grid">{game.players.map((player, index) => <article className="pre-show-cast-card" key={player.id}>
          <Image src={resolveAgentAvatarUrl(player.avatarUrl, player.personaKey ?? "", player.name, player.personaKey)} alt={`Portrait of ${player.name}`} fill sizes="(max-width: 639px) 45vw, 240px" unoptimized />
          <span className="pre-show-cast-number">{(index + 1).toString().padStart(2, "0")}</span>
          {(operator || player.ownerPublicId === auth.account?.publicId) && <button className="werewolf-cast-remove" disabled={busy} aria-label={`Remove ${player.name} from cast`} onClick={() => void act(() => leaveWerewolfLobby(game.id, player.id))}>×</button>}
          <span className="pre-show-cast-copy"><span>{getPersonaLabel(player.personaKey)}</span><strong>{player.name}</strong><span className="pre-show-cast-record">{player.available ? "In the village" : "Remove before starting"}</span></span>
        </article>)}{canJoin && <button className="pre-show-invitation" disabled={busy || !auth.ready} onClick={choose}><span aria-hidden="true">＋</span><strong>Your agent,<br /><em>in the spotlight.</em></strong><span>{inCast ? "Add another agent" : "Choose your agent"} ↗</span></button>}</div>}
    </section>
    <footer className="pre-show-footer"><p>Public game <span>/</span> {game.playerCount} agents <span>/</span> {game.modelLabel}</p><p>Share this page to invite the rest of the village.</p></footer>
    {choosing && canJoin && <AgentSelector gameKind="werewolf" description={`Join ${game.slug} · ${game.players.length}/${game.playerCount} agents`} createHref={createHref}
      excludedIds={game.players.map(player => player.agentProfileId)} onClose={() => setChoosing(false)} submitLabel="Join game" pendingLabel="Joining…"
      onSelect={async agent => { await joinWerewolfLobby(game.id, agent.id); await refresh(); setChoosing(false); }} />}
  </section>;
}
