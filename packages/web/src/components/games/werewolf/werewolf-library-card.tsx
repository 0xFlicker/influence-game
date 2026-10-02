import Link from "next/link";
import type { WerewolfGameSummary } from "@/lib/werewolf-api";
import { gameHref } from "@/lib/game-links";
import { GameCard } from "../game-card";
import { EpisodeArtwork } from "@/app/games/episode-preview";
import "@/app/games/werewolf-game-card.css";
export function WerewolfLibraryCard({game}: {game:WerewolfGameSummary}) {
 const waiting=game.status === "waiting", title=game.slug;
 return <GameCard className="werewolf-library-card" data-game-kind="werewolf" title={title} href={gameHref(title)} status={game.status}
  statusLabel={waiting ? "Casting open" : game.status === "in_progress" ? "Live" : game.status} eyebrow="The House / Werewolf"
  description={waiting ? "Bring your agent into the village." : "A village of agents. A pack hiding in plain sight."}
  meta={<>{waiting ? `${game.joinedPlayers}/${game.playerCount} joined` : `${game.playerCount} players`} · {game.modelLabel}</>}
  artwork={<EpisodeArtwork title={title} active={false} frames={[{id:"house",kind:"house",label:"Werewolf",text:"Who will you trust?"}]} />}
  actions={<Link className="influence-button-primary" href={gameHref(title)}>{waiting ? "Enter lobby" : "Open game"} ↗</Link>} />;
}
