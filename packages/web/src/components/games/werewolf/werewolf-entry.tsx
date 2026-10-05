"use client";

import { CastingRoster, CastCard, CastInvitation } from "@/components/casting/casting-roster";
import { CastPortraitDialog } from "@/components/casting/cast-portrait";
import Link from "next/link";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WerewolfAudience } from "@influence/engine/werewolf/observation";
import { GameSiteEntry } from "../game-site-entry";
import { GameEpisode } from "../game-episode";
import { PostgameTrailer } from "@/app/games/[slug]/components/postgame-trailer";
import { EpisodeArtwork } from "@/app/games/episode-preview";
import { gameReplayHref, gameResultsHref, gameHighlightsHref } from "@/lib/game-links";
import { CastingHero } from "@/components/casting/casting-hero";
import { AgentSelector } from "@/components/casting/agent-selector";
import { resolveAgentAvatarUrl } from "@/components/agent-avatar";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { getPersonaLabel } from "@/lib/personas";
import { getWerewolfLobby, joinWerewolfLobby, leaveWerewolfLobby, startWerewolfLobby, stopWerewolf, type WerewolfLobbyData } from "@/lib/werewolf-api";
import { WerewolfViewer } from "./werewolf-viewer";

export function WerewolfEntry({ slug, audience, replay = false, startCursor }: { slug: string; audience?: WerewolfAudience; replay?: boolean; startCursor?: number }) {
  const query = useQuery({ queryKey: ["werewolf-lobby", slug], queryFn: ({ signal }) => getWerewolfLobby(slug, signal),
    refetchInterval: state => state.state.data?.status === "waiting" ? 5_000 : false, retry: false });
  const game = query.data;
  if (!game) return <main className="mx-auto max-w-6xl p-8"><Link href="/games">← All games</Link>{query.error ? <p role="alert" className="mt-6">{query.error.message} <button onClick={() => void query.refetch()}>Try again</button></p> : <p role="status" className="mt-6">Opening the village…</p>}</main>;
  if (game.status === "waiting") { const waiting = <><WerewolfWaitingGame game={game} refresh={async () => { const result = await query.refetch(); if (result.error) throw result.error; }} />{query.error && <p role="alert">Cast refresh failed. {query.error.message}</p>}</>; return replay && audience ? <GameSiteEntry>{waiting}</GameSiteEntry> : waiting; }
  if (game.status === "cancelled" && !game.started) return <main className="mx-auto max-w-3xl p-8"><Link href="/games">← All games</Link><h1 className="mt-8 text-3xl">This game was stopped.</h1></main>;
  if (replay && audience) return <WerewolfViewer key={`${slug}:${audience}:${startCursor ?? 1}`} slug={slug} audience={audience} startCursor={startCursor} />;
  if (!replay) return <GameEpisode eyebrow={`The House / Werewolf · ${game.status === "in_progress" ? "Live" : game.status}`} title={game.slug}
    description="A village of agents. A pack hiding in plain sight. Choose how much of the story you want to know."
    media={game.status === "completed" ? <PostgameTrailer key={game.slug} gameId={game.slug} /> : <EpisodeArtwork title={game.slug} active={false} frames={game.players.length ? [{ id: "cast", kind: "cast", label: "Meet the village", players: game.players.map(p => ({id:p.id,name:p.name,avatarUrl:p.avatarUrl,personaKey:p.personaKey})) }] : [{id:"house",kind:"house",label:"The House presents",text:"Who will you trust?"}]} />}
    actions={<><Link className="influence-button-primary" href={gameReplayHref(game.slug, undefined, "mystery")}>Watch Mystery</Link><Link className="influence-button-secondary" href={gameReplayHref(game.slug, undefined, "omniscient")}>Watch Omniscient</Link>{game.status === "completed" && <Link className="influence-button-secondary" href={gameResultsHref(game.slug)}>View results · Spoilers</Link>}{game.status === "completed" && <Link className="influence-button-secondary" href={gameHighlightsHref(game.slug)}>House Cuts</Link>}</>}
    information={<p>{game.playerCount} players · {game.modelLabel}</p>} />;
  return <section className="mx-auto flex min-h-[80dvh] max-w-3xl flex-col justify-center px-6 py-12">
    <Link href="/games" className="mb-10 text-sm text-white/60">← All games</Link>
    <p className="text-xs uppercase tracking-[.2em] text-white/50">The House · Werewolf</p>
    <h1 className="mt-3 text-4xl font-semibold">How will you watch?</h1>
    <p className="mt-4 text-white/65">{slug} · Your viewing mode stays fixed for this replay.</p>
    <div className="mt-8 grid gap-4 sm:grid-cols-2">
      <Link href={gameReplayHref(game.slug, undefined, "mystery")} className="rounded-xl border border-white/20 bg-white/[.03] p-6 hover:bg-white/[.08]"><h2 className="text-xl">Watch Mystery</h2><p className="mt-3 leading-6 text-white/65">Follow the public conversation. Discover roles at the ending.</p></Link>
      <Link href={gameReplayHref(game.slug, undefined, "omniscient")} className="rounded-xl border border-white/20 bg-white/[.03] p-6 hover:bg-white/[.08]"><h2 className="text-xl">Watch Omniscient</h2><p className="mt-3 leading-6 text-white/65">Know the roles, hear the pack and optionally watch players think.</p></Link>
    </div>
  </section>;
}

function WerewolfWaitingGame({ game, refresh }: { game: WerewolfLobbyData; refresh: () => Promise<void> }) {
  const auth = useAuth();
  const { hasPermission } = usePermissions();
  const [choosing, setChoosing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [portrait, setPortrait] = useState<WerewolfLobbyData["players"][number] | null>(null);
  const pending = useRef(false);
  const operator = auth.account?.roles.some(role => ["admin", "sysop", "producer"].includes(role)) ?? false;
  const inCast = game.players.some(player => player.ownerPublicId === auth.account?.publicId);
  const openSeats = Math.max(0, game.playerCount - game.players.length);
  const canJoin = openSeats > 0 && (!inCast || operator);
  const createHref = `/agents/create?flow=join_game&gameId=${encodeURIComponent(game.id)}`;
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
    <CastingRoster eyebrow="The village" description="Select a portrait to take a closer look. Roles are assigned when the game starts."
      empty={!game.players.length ? <div className="pre-show-empty"><span className="pre-show-empty-number" aria-hidden="true">01</span><div><h3>The first seat is yours.</h3><p>Bring a character you know. Their Werewolf strategy guides this game.</p><button disabled={!auth.ready || busy} onClick={choose}>Bring your agent ↗</button></div></div> : undefined}
      invitation={canJoin && <CastInvitation disabled={busy || !auth.ready} onChoose={choose} joined={inCast} />}>
      {game.players.map((player,index) => <CastCard key={player.id} name={player.name} index={index} src={resolveAgentAvatarUrl(player.avatarUrl,player.personaKey ?? "",player.name,player.personaKey)} eyebrow={getPersonaLabel(player.personaKey)} detail={player.available ? "In the village" : "Remove before starting"} onInspect={() => setPortrait(player)}
        action={(operator || player.ownerPublicId === auth.account?.publicId) && <button className="werewolf-cast-remove" disabled={busy} aria-label={`Remove ${player.name} from cast`} onClick={() => void act(() => leaveWerewolfLobby(game.id,player.id))}>×</button>} />)}
    </CastingRoster>
    {portrait && <CastPortraitDialog name={portrait.name} src={resolveAgentAvatarUrl(portrait.avatarUrl,portrait.personaKey ?? "",portrait.name,portrait.personaKey)} eyebrow={getPersonaLabel(portrait.personaKey)} onClose={() => setPortrait(null)} />}

    <footer className="pre-show-footer"><p>{game.visibility === "unlisted" ? "Unlisted game" : "Public game"} <span>/</span> {game.playerCount} agents <span>/</span> {game.modelLabel}</p><p>Share this page to invite the rest of the village.</p></footer>
    {choosing && canJoin && <AgentSelector gameKind="werewolf" description={`Join ${game.slug} · ${game.players.length}/${game.playerCount} agents`} createHref={createHref}
      excludedIds={game.players.map(player => player.agentProfileId)} onClose={() => setChoosing(false)} submitLabel="Join game" pendingLabel="Joining…"
      onSelect={async agent => { await joinWerewolfLobby(game.id, agent.id); await refresh(); setChoosing(false); }} />}
  </section>;
}
