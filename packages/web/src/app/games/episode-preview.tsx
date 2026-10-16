"use client";

import { GameCard } from "@/components/games/game-card";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CastPreview } from "@/components/games/cast-preview";
import { getEpisodePreview, resolveApiUrl, type EpisodeFrame, type EpisodePreview, type GameSummary } from "@/lib/api";
import type { WerewolfGameSummary } from "@/lib/werewolf-api";
import { WEREWOLF_CARD_ART } from "@/lib/game-art";
import { gameHref, gameReplayHref, gameResultsHref } from "@/lib/game-links";
import { gameDisplayName } from "@/lib/game-identity";
import { episodeSoundEnabled, playEpisodeVideo, rememberEpisodeSound, requestEpisodePlayback } from "@/lib/episode-media";
import "./episodes.css";

type LibraryGame = GameSummary | WerewolfGameSummary;
const INFLUENCE_CARD_ART = "/house-highlights/generated/alliance-formation.jpg";

/** Cast pages are ordinary slideshow frames, including large public alliance groups. */
export function castSlideshowFrames(frames: EpisodeFrame[]): EpisodeFrame[] {
  return frames.flatMap(frame => {
    if (frame.kind !== "cast" || !frame.players || frame.players.length <= 4) return [frame];
    const pages: EpisodeFrame[] = [];
    for (let i = 0; i < frame.players.length; i += 4) pages.push({ ...frame, id: `${frame.id}:page:${i}`, players: frame.players.slice(i, i + 4) });
    return pages;
  });
}

export function episodeFallbackFrames(game: { episode?: Pick<NonNullable<GameSummary["episode"]>, "cast" | "coverUrl"> }): EpisodeFrame[] {
  const imageUrl = game.episode?.coverUrl ?? undefined;
  const cast = game.episode?.cast ?? [];
  const frames: EpisodeFrame[] = [];
  for (let i = 0; i < cast.length; i += 4) frames.push({ id: `cast:${i}`, kind: "cast", label: "Meet the cast", players: cast.slice(i, i + 4), imageUrl });
  if (!frames.length) frames.push({ id: "cover", kind: "scene", label: "The House presents", imageUrl });
  return frames;
}

export function EpisodeArtwork({ frames, active, title, backgroundUrl = INFLUENCE_CARD_ART }: { frames: EpisodeFrame[]; active: boolean; title: string; backgroundUrl?: string }) {
  const [frameId, setFrameId] = useState(() => frames.find(frame => frame.id.startsWith("cast:"))?.id ?? frames[0]?.id);
  const index = Math.max(0, frames.findIndex(frame => frame.id === frameId));
  useEffect(() => {
    if (!active || frames.length < 2) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      clearInterval(timer);
      if (!document.hidden && !motion.matches) timer = setInterval(() => {
        if (!document.hidden && !motion.matches) setFrameId(id => frames[(frames.findIndex(frame => frame.id === id) + 1) % frames.length]?.id);
      }, 4200);
    };
    update();
    document.addEventListener("visibilitychange", update);
    motion.addEventListener("change", update);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); motion.removeEventListener("change", update); };
  }, [active, frames]);
  return <div className={`episode-artwork ${active ? "is-playing" : ""}`} aria-label={`${title} preview`}>
    {frames.map((frame, i) => <div key={frame.id} data-frame-id={frame.id} className={`episode-frame ${i === index ? "is-visible" : ""}`} aria-hidden={i !== index} inert={i !== index}>
      <Image src={frame.imageUrl ? resolveApiUrl(frame.imageUrl) : backgroundUrl} alt="" fill sizes="(max-width: 1023px) 100vw, 700px" className="episode-scene" unoptimized />
      <div className="episode-vignette" />
      {frame.kind === "cast" && <CastPreview cast={frame.players ?? []} />}
      {frame.kind === "house" && <div className="episode-house"><span>A WORD FROM THE HOUSE</span><p>{frame.text}</p></div>}
      <span className="episode-frame-label">{frame.label}</span>
    </div>)}
  </div>;
}
export function EpisodeTrailer({ preview, autoplay, onEnded }: { preview: EpisodePreview; autoplay: boolean; onEnded?: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);
  const [muted, setMuted] = useState(true);
  const media = preview.media;
  useEffect(() => {
    const player = video.current;
    if (!player) return;
    let alive = true;
    player.muted = !episodeSoundEnabled(); setMuted(player.muted);
    if (autoplay) void playEpisodeVideo(player).then(ok => { if (alive) { setBlocked(!ok); setMuted(player.muted); } });
    const pause = () => { if (document.hidden) player.pause(); };
    document.addEventListener("visibilitychange", pause);
    return () => { alive = false; player.pause(); document.removeEventListener("visibilitychange", pause); };
  }, [autoplay]);
  if (media.status !== "ready") return null;
  return <div className="episode-video">
    <video ref={video} playsInline controls muted={muted} preload="metadata" poster={media.poster.url} aria-label={`${preview.episode.title} trailer`} onEnded={onEnded} onError={onEnded} onVolumeChange={e => { setMuted(e.currentTarget.muted); if (document.activeElement === e.currentTarget) rememberEpisodeSound(!e.currentTarget.muted); }}>
      <source src={media.video.url} type={media.video.contentType} /><track kind="captions" src={media.captions.url} srcLang={media.captions.language} label={media.captions.label} />
    </video>
    <div className="episode-video-controls"><button type="button" onClick={() => { const p = video.current; if (!p) return; const enabled = p.muted; rememberEpisodeSound(enabled); p.muted = !enabled; setMuted(p.muted); }}>{muted ? "Sound on" : "Sound off"}</button>
    {blocked && <button type="button" onClick={() => { if (video.current) void playEpisodeVideo(video.current).then(ok => setBlocked(!ok)); }}>Play trailer</button>}
    {onEnded && <button type="button" onClick={() => { video.current?.pause(); onEnded(); }}>Skip trailer</button>}</div>
  </div>;
}

export function EpisodeCard({ game, management, onJoin }: { game: LibraryGame; management?: ReactNode; onJoin?: () => void }) {
  const [active, setActive] = useState(false);
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<EpisodePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const request = useRef<Promise<void> | null>(null);
  const card = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = gameDisplayName(game);
  const load = () => {
    if (preview || request.current) return;
    request.current = getEpisodePreview(game.id).then(p => { setPreview(p); setError(null); }).catch(() => setError("Trailer unavailable. You can still open the game.")).finally(() => { request.current = null; });
  };
  useEffect(() => {
    let visible = false;
    const update = () => setActive(visible && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => { visible = !!entry?.isIntersecting; update(); });
    if (card.current) observer.observe(card.current);
    document.addEventListener("visibilitychange", update);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, [game.id]);
  useEffect(() => {
    if (!expanded) return;
    const d = dialog.current!; const prior = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    d.showModal();
    return () => { d.close(); document.body.style.overflow = overflow; prior?.focus(); };
  }, [expanded]);
  const werewolf = "gameKind" in game && game.gameKind === "werewolf";
  const waiting = game.status === "waiting";
  const live = game.status === "in_progress";
  const season = "season" in game ? game.season : undefined;
  const joined = "joinedPlayers" in game ? game.joinedPlayers : game.alivePlayers;
  const backgroundUrl = game.episode?.coverUrl ? resolveApiUrl(game.episode.coverUrl) : werewolf ? WEREWOLF_CARD_ART : INFLUENCE_CARD_ART;
  const frames = useMemo(() => preview?.frames.length ? castSlideshowFrames(preview.frames) : episodeFallbackFrames(game), [game, preview]);
  const label = waiting ? "Casting open" : live ? "Live" : game.status === "completed" ? "Completed" : "visualPaused" in game && game.visualPaused ? "Paused" : game.status === "cancelled" ? "Cancelled" : "Failed";
  const subtitle = `The House / ${werewolf ? "Werewolf" : "Influence"}`;
  const replayHref = gameReplayHref(game.slug, undefined, werewolf ? "mystery" : undefined);
  const links = <><Link className="influence-button-primary" href={replayHref}>{live ? "Watch live" : "Watch replay"} ↗</Link><Link className="influence-button-secondary" href={gameResultsHref(game.slug)}>Details</Link></>;
  const actions = <>
    {waiting ? onJoin ? <button type="button" className="influence-button-primary" onClick={onJoin}>Join game</button> : <Link className="influence-button-primary" href={gameHref(game.slug)}>Join game</Link>
      : live || game.status === "completed" ? links : <Link className="influence-button-primary" href={gameHref(game.slug)}>Open game</Link>}
    {management && <details className="episode-management"><summary>Manage game</summary><div className="episode-management-content">{management}</div></details>}
  </>;
  return <>
    <GameCard ref={card} data-testid="episode-card" data-game-kind={werewolf ? "werewolf" : "influence"} title={title} href={gameHref(game.slug)} status={game.status} statusLabel={label} eyebrow={subtitle}
      description={game.episode?.description ?? (werewolf ? "A village of agents. A pack hiding in plain sight." : "Meet the cast. Step inside the House.")}
      meta={<>{waiting ? `${Math.min(joined, game.playerCount)}/${game.playerCount} joined` : `${game.playerCount} Agents`} · {game.modelLabel}
        {season && <span className="episode-season">{season.name}{game.episode?.episodeNumber ? ` · Episode ${game.episode.episodeNumber}` : ""}</span>}</>}
      artwork={<EpisodeArtwork frames={frames} active={active && !focused && !expanded} title={title} backgroundUrl={backgroundUrl} />}
      actions={actions}
      onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
      onMouseEnter={() => { if (!waiting && matchMedia("(hover: hover) and (pointer: fine)").matches) load(); }}
      onOpen={e => {if(waiting || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)return;if(matchMedia("(hover: none), (pointer: coarse)").matches){e.preventDefault();load();setEnded(false);setExpanded(true);}else if(!werewolf) requestEpisodePlayback(game.slug);}} />
    {expanded && <dialog ref={dialog} className="episode-modal" aria-label={title} onCancel={() => setExpanded(false)} onClose={() => setExpanded(false)}>
      <header><span className="episode-eyebrow">{subtitle}</span><button autoFocus type="button" onClick={() => setExpanded(false)}>Close ×</button></header>
      <div className="episode-modal-media">{preview?.media.status === "ready" && !ended ? <EpisodeTrailer preview={preview} autoplay onEnded={() => setEnded(true)} /> : <EpisodeArtwork frames={frames} active title={title} backgroundUrl={backgroundUrl} />}</div>
      <div className="episode-copy"><h2>{title}</h2><p>{game.episode?.description}</p>{error && <p role="status">{error}</p>}
      <div className="episode-modal-actions"><Link className="influence-button-secondary" href={gameHref(game.slug)}>Open game</Link>{actions}
      {ended && preview?.media.status === "ready" && <button onClick={() => setEnded(false)}>Replay trailer</button>}</div></div>
    </dialog>}
  </>;
}
