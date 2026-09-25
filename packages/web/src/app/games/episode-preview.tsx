"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AgentAvatar } from "@/components/agent-avatar";
import { getEpisodePreview, resolveApiUrl, type EpisodeFrame, type EpisodePreview, type GameSummary } from "@/lib/api";
import { gameHref, gameReplayHref, gameResultsHref } from "@/lib/game-links";
import { gameDisplayName } from "@/lib/game-identity";
import { episodeSoundEnabled, playEpisodeVideo, rememberEpisodeSound, requestEpisodePlayback } from "@/lib/episode-media";
import "./episodes.css";

export function episodeFallbackFrames(game: Pick<GameSummary, "episode">): EpisodeFrame[] {
  const frames: EpisodeFrame[] = [];
  if (game.episode?.coverUrl) frames.push({ id: "cover", kind: "scene", label: "Inside the House", imageUrl: game.episode.coverUrl });
  const cast = game.episode?.cast ?? [];
  for (let i = 0; i < cast.length; i += 4) frames.push({ id: `cast:${i}`, kind: "cast", label: "Meet the cast", players: cast.slice(i, i + 4) });
  frames.push({ id: "house", kind: "house", label: "The House presents", text: game.episode?.description ?? "A new room. A new game of Influence." });
  return frames;
}
export function EpisodeArtwork({ frames, active, title }: { frames: EpisodeFrame[]; active: boolean; title: string }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active || frames.length < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      clearInterval(timer);
      if (!document.hidden) timer = setInterval(() => setIndex(i => (i + 1) % frames.length), 4200);
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [active, frames.length]);
  return <div className={`episode-artwork ${active ? "is-playing" : ""}`} aria-label={`${title} preview`}>
    {frames.map((frame, i) => <div key={frame.id} className={`episode-frame ${i === index % frames.length ? "is-visible" : ""}`} aria-hidden={i !== index % frames.length}>
      <Image src={frame.imageUrl ? resolveApiUrl(frame.imageUrl) : "/house-highlights/generated/alliance-formation.jpg"} alt="" fill sizes="(max-width: 1023px) 100vw, 700px" className="episode-scene" unoptimized />
      <div className="episode-vignette" />
      {frame.kind === "cast" && <div className="episode-cast">{frame.players?.map(p => <div key={p.id}><AgentAvatar name={p.name} persona={p.personaKey ?? ""} personaKey={p.personaKey} avatarUrl={p.avatarUrl} size="32" /><span>{p.name}</span></div>)}</div>}
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
      <source src={media.video.url} type={media.video.contentType} /><track kind="captions" src={media.captions.url} srcLang={media.captions.language} label={media.captions.label} default />
    </video>
    <div className="episode-video-controls"><button type="button" onClick={() => { const p = video.current; if (!p) return; const enabled = p.muted; rememberEpisodeSound(enabled); p.muted = !enabled; setMuted(p.muted); }}>{muted ? "Sound on" : "Sound off"}</button>
    {blocked && <button type="button" onClick={() => { if (video.current) void playEpisodeVideo(video.current).then(ok => setBlocked(!ok)); }}>Play trailer</button>}
    {onEnded && <button type="button" onClick={() => { video.current?.pause(); onEnded(); }}>Skip trailer</button>}</div>
  </div>;
}

export function EpisodeCard({ game, actions }: { game: GameSummary; actions: ReactNode }) {
  const [active, setActive] = useState(false);
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
    const listener = (e: Event) => { if ((e as CustomEvent).detail !== game.id) setActive(false); };
    window.addEventListener("episode:preview", listener);
    const visibility = () => { if (document.hidden) setActive(false); };
    document.addEventListener("visibilitychange", visibility);
    const observer = new IntersectionObserver(([entry]) => { if (!entry?.isIntersecting) setActive(false); });
    if (card.current) observer.observe(card.current);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("episode:preview", listener); };
  }, [game.id]);
  useEffect(() => {
    if (!expanded) return;
    const d = dialog.current!; const prior = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    d.showModal();
    return () => { d.close(); document.body.style.overflow = overflow; prior?.focus(); };
  }, [expanded]);
  const frames = preview?.frames.length ? preview.frames : episodeFallbackFrames(game);
  const label = game.status === "in_progress" ? "Live" : game.status === "waiting" ? "Open seats" : game.status === "completed" ? "Completed" : game.visualPaused ? "Paused" : game.status === "cancelled" ? "Cancelled" : "Failed";
  const subtitle = game.season ? `${game.season.name}${game.episode?.episodeNumber ? ` · Episode ${game.episode.episodeNumber}` : ""}` : game.visibility === "private" ? "Your private game" : "Public game";
  const links = <><Link className="influence-button-primary" href={gameReplayHref(game.slug)}>{game.status === "in_progress" ? "Watch live" : "Watch Replay"} ↗</Link><Link className="influence-button-secondary" href={gameResultsHref(game.slug)}>Details</Link></>;
  return <>
    <article ref={card} className="episode-card" data-testid="episode-card" onMouseEnter={() => { if (matchMedia("(hover: hover) and (pointer: fine)").matches) { window.dispatchEvent(new CustomEvent("episode:preview", { detail: game.id })); setActive(true); load(); } }} onMouseLeave={() => setActive(false)}>
      <Link className="episode-card-link" aria-label={`Open ${title}`} href={gameHref(game.slug)} onClick={e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (matchMedia("(hover: none), (pointer: coarse)").matches) { e.preventDefault(); load(); setEnded(false); setExpanded(true); }
        else requestEpisodePlayback(game.slug);
      }}>
        <EpisodeArtwork frames={frames} active={active} title={title} />
        <span className={`episode-status episode-status-${game.status}`}>{label}</span>
        <div className="episode-copy"><div className="episode-eyebrow">{subtitle}</div><h2>{title}</h2><p>{game.episode?.description ?? "Meet the cast. Step inside the House."}</p><span className="episode-meta">{game.playerCount} Agents · {game.modelLabel}</span></div>
      </Link>
      <div className="episode-desktop-actions">{game.status !== "waiting" ? links : <Link className="influence-button-primary" href={gameHref(game.slug)}>Join game</Link>}{actions}</div>
    </article>
    {expanded && <dialog ref={dialog} className="episode-modal" aria-label={title} onCancel={() => setExpanded(false)} onClose={() => setExpanded(false)}>
      <header><span className="episode-eyebrow">{subtitle}</span><button autoFocus type="button" onClick={() => setExpanded(false)}>Close ×</button></header>
      <div className="episode-modal-media">{preview?.media.status === "ready" && !ended ? <EpisodeTrailer preview={preview} autoplay onEnded={() => setEnded(true)} /> : <EpisodeArtwork frames={frames} active title={title} />}</div>
      <div className="episode-copy"><h2>{title}</h2><p>{game.episode?.description}</p>{error && <p role="status">{error}</p>}
      <div className="episode-modal-actions"><Link className="influence-button-secondary" href={gameHref(game.slug)}>Open game</Link>{game.status !== "waiting" && links}{actions}
      {ended && preview?.media.status === "ready" && <button onClick={() => setEnded(false)}>Replay trailer</button>}</div></div>
    </dialog>}
  </>;
}
