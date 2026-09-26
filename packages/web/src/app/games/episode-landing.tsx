"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { getEpisodePreview, getGame, type EpisodePreview, type GameDetail } from "@/lib/api";
import { gameHighlightsHref, gameReplayHref, gameResultsHref } from "@/lib/game-links";
import { consumeEpisodePlayback } from "@/lib/episode-media";
import { gameDisplayName } from "@/lib/game-identity";
import { EpisodeArtwork, EpisodeTrailer, episodeFallbackFrames } from "./episode-preview";
const GameViewer = dynamic(() => import("./[slug]/game-viewer").then(module => module.GameViewer));

export function EpisodeLanding({ slug, initialGame }: { slug: string; initialGame?: GameDetail }) {
  const [game, setGame] = useState(initialGame);
  const [preview, setPreview] = useState<EpisodePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const intent = useRef<boolean | null>(null);
  const [autoplay, setAutoplay] = useState(false);
  useEffect(() => {
    if (intent.current === null) intent.current = consumeEpisodePlayback(slug);
    setAutoplay(intent.current);
    let alive = true;
    void getEpisodePreview(slug).then(v => { if (alive) setPreview(v); }).catch(e => { if (alive) setError(e instanceof Error ? e.message : "Preview unavailable"); });
    void getGame(slug).then(v => { if (alive) setGame(v); }).catch(e => { if (alive) setError(e instanceof Error ? e.message : "Game unavailable"); });
    return () => { alive = false; };
  }, [slug]);
  if (!game) return <div role="status">{error ?? "Opening the House…"}</div>;
  const summary = { ...game, playerCount: game.players.length, episode: preview?.episode ?? game.episode };
  const title = gameDisplayName(summary);
  const frames = preview?.frames.length ? preview.frames : episodeFallbackFrames(summary);
  if (game.status === "waiting") return <GameViewer gameId={slug} initialGame={game} />;
  return <section className="episode-landing">
    <div className="episode-eyebrow">{game.season?.name ?? "Influence"}{summary.episode?.episodeNumber ? ` · Episode ${summary.episode.episodeNumber}` : ""} · {game.status === "in_progress" ? "Live" : game.status}</div>
    <h1>{title}</h1><p className="episode-description">{summary.episode?.description ?? "Watch the House trailer, replay the game unspoiled, or inspect the full results."}</p>
    <div className="episode-landing-media">{preview?.media.status === "ready" && !ended ? <EpisodeTrailer preview={preview} autoplay={autoplay} onEnded={() => setEnded(true)} /> : <EpisodeArtwork title={title} frames={frames} active={ended} />}</div>
    {error && <p role="status" className="mt-3 text-sm text-white/50">Preview unavailable. The game viewing options are still available.</p>}
    <div className="episode-landing-actions"><Link className="influence-button-primary" href={gameReplayHref(slug)}>{game.status === "in_progress" ? "Watch live" : "Watch Replay"}</Link><Link className="influence-button-secondary" href={gameResultsHref(slug)}>See Results</Link>{game.status === "completed" && <Link className="influence-button-secondary" href={gameHighlightsHref(slug)}>House Highlights</Link>}{ended && preview?.media.status === "ready" && <button className="influence-button-quiet px-4" onClick={() => { setAutoplay(true); setEnded(false); }}>Replay trailer</button>}</div>
    <details><summary>Game information</summary><p>Code words: {game.slug} · {game.players.length} Agents · {game.modelLabel} · Round {game.currentRound}/{game.maxRounds} · {game.currentPhase}</p></details>
  </section>;
}
