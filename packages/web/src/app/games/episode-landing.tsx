"use client";
import { GameEpisode } from "@/components/games/game-episode";
import { GameSiteEntry } from "@/components/games/game-site-entry";
import { GameEntryError, GameEntryLoading } from "@/components/games/game-entry-loading";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { getEpisodePreview, getGame, type EpisodePreview, type GameDetail } from "@/lib/api";
import { gameHighlightsHref, gameReplayHref, gameResultsHref } from "@/lib/game-links";
import { consumeEpisodePlayback } from "@/lib/episode-media";
import { gameDisplayName } from "@/lib/game-identity";
import { useAuth } from "@/hooks/use-auth";
import { EpisodeArtwork, EpisodeTrailer, episodeFallbackFrames } from "./episode-preview";
import { GamePreShow, gamePreShowJoinState } from "./[slug]/components/game-pre-show";
const GameViewer = dynamic(() => import("./[slug]/game-viewer").then(module => module.GameViewer), { loading: () => <GameEntryLoading /> });

function InfluenceLobby({ initialGame }: { initialGame: GameDetail }) {
  const [game, setGame] = useState(initialGame);
  const { account } = useAuth();
  useEffect(() => { setGame(initialGame); }, [initialGame]);
  if (game.status !== "waiting") return <GameViewer gameId={game.slug} initialGame={game} />;
  return <GameSiteEntry createAgentHref={gamePreShowJoinState(game, account).createHref}>
    <GamePreShow game={game} onGameUpdated={setGame} />
  </GameSiteEntry>;
}

export function EpisodeLanding({ slug, initialGame }: { slug: string; initialGame?: GameDetail }) {
  const [game, setGame] = useState(initialGame);
  const [preview, setPreview] = useState<EpisodePreview | null>(null);
  const [gameError, setGameError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [previewError, setPreviewError] = useState(false);
  const [ended, setEnded] = useState(false);
  const intent = useRef<boolean | null>(null);
  const [autoplay, setAutoplay] = useState(false);
  useEffect(() => {
    if (intent.current === null) intent.current = consumeEpisodePlayback(slug);
    setAutoplay(intent.current);
    if (initialGame?.status === "waiting") {
      setGame(initialGame);
      return;
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]);
    void getGame(slug, signal).then(value => {
      if (!controller.signal.aborted) setGame(value);
    }, () => {
      if (!controller.signal.aborted) setGameError(true);
    });
    return () => controller.abort();
  }, [slug, initialGame, attempt]);
  const showEpisode = !!game && game.status !== "waiting";
  useEffect(() => {
    if (!showEpisode) return;
    let active = true;
    void getEpisodePreview(slug).then(value => { if (active) setPreview(value); }, () => { if (active) setPreviewError(true); });
    return () => { active = false; };
  }, [slug, showEpisode]);
  if (!game) return gameError ? <GameEntryError onRetry={() => {
    setGameError(false);
    setAttempt(value => value + 1);
  }} /> : <GameEntryLoading />;
  if (game.status === "waiting") return <InfluenceLobby initialGame={game} />;
  const summary = { ...game, playerCount: game.players.length, episode: preview?.episode ?? game.episode };
  const title = gameDisplayName(summary);
  const frames = preview?.frames.length ? preview.frames : episodeFallbackFrames(summary);
  return <GameSiteEntry><GameEpisode gameKind="influence"
    eyebrow={`${game.season?.name ?? "Influence"}${summary.episode?.episodeNumber ? ` · Episode ${summary.episode.episodeNumber}` : ""} · ${game.status === "in_progress" ? "Live" : game.status}`}
    title={title} description={summary.episode?.description ?? "Watch the House trailer, replay the game unspoiled, or inspect the full results."}
    media={preview?.media.status === "ready" && !ended ? <EpisodeTrailer preview={preview} autoplay={autoplay} onEnded={() => setEnded(true)} /> : <EpisodeArtwork title={title} frames={frames} />}
    notice={(previewError || gameError) && <p role="status" className="mt-3 text-sm text-white/50">Preview unavailable. The game viewing options are still available.</p>}
    actions={<><Link className="influence-button-primary" href={gameReplayHref(slug)}>{game.status === "in_progress" ? "Watch live" : "Watch Replay"}</Link><Link className="influence-button-secondary" href={gameResultsHref(slug)}>See Results</Link>{game.status === "completed" && <Link className="influence-button-secondary" href={gameHighlightsHref(slug)}>House Highlights</Link>}{ended && preview?.media.status === "ready" && <button className="influence-button-quiet px-4" onClick={() => { setAutoplay(true); setEnded(false); }}>Replay trailer</button>}</>}
    information={<p>Code words: {game.slug} · {game.players.length} Agents · {game.modelLabel} · Round {game.currentRound}/{game.maxRounds} · {game.currentPhase}</p>}
  /></GameSiteEntry>;
}
