import Link from "next/link";
import type { WerewolfGameSummary } from "@/lib/werewolf-api";
import { gameHref, gameResultsHref } from "@/lib/game-links";
import { GameCard } from "../game-card";
import { WerewolfArtwork } from "./werewolf-artwork";
import "@/app/games/episodes.css";
import "@/app/games/werewolf-game-card.css";

export function WerewolfLibraryCard({ game }: { game: WerewolfGameSummary }) {
  const waiting = game.status === "waiting";
  const title = game.episode?.title ?? game.slug;
  return <GameCard className="werewolf-library-card" data-game-kind="werewolf" title={title} href={gameHref(game.slug)} status={game.status}
    statusLabel={waiting ? "Casting open" : game.status === "in_progress" ? "Live" : game.status} eyebrow="The House / Werewolf"
    description={game.episode?.description ?? (waiting ? "Bring your agent into the village." : "A village of agents. A pack hiding in plain sight.")}
    meta={<>{waiting ? `${game.joinedPlayers}/${game.playerCount} joined` : `${game.playerCount} players`} · {game.modelLabel}</>}
    artwork={<WerewolfArtwork coverUrl={game.episode?.coverUrl} />}
    actions={<><Link className="influence-button-primary" href={gameHref(game.slug)}>{waiting ? "Enter lobby" : "Open game"} ↗</Link>{game.status === "completed" && <Link className="text-sm text-white/70" href={gameResultsHref(game.slug)}>View results · Spoilers</Link>}</>} />;
}
