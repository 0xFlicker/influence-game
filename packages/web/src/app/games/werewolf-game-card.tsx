import Image from "next/image";
import Link from "next/link";
import type { WerewolfGameSummary } from "@/lib/werewolf-api";
import "./werewolf-game-card.css";

export function WerewolfGameCard({ game }: { game: WerewolfGameSummary }) {
  const waiting = game.status === "waiting";
  const label = waiting ? "Casting open" : game.status === "in_progress" ? "Live" : game.status === "completed" ? "Completed" : game.status === "cancelled" ? "Cancelled" : "Paused";
  return <article className="episode-card werewolf-library-card" data-game-kind="werewolf">
    <Link className="werewolf-library-link" href={`/werewolf/${game.slug}`} aria-label={`Open Werewolf ${game.slug}`}>
      <span className={`episode-status episode-status-${game.status}`}>{label}</span>
      <Image src="/logo.png" alt="The House" width={64} height={64} />
      <p className="werewolf-library-eyebrow">The House / Werewolf</p>
      <h2>{game.slug}</h2>
      <p>{waiting ? "Bring your agent into the village." : "A village of agents. A pack hiding in plain sight."}</p>
      <span className="werewolf-library-meta">{waiting ? `${game.joinedPlayers}/${game.playerCount} joined` : `${game.playerCount} players`} · {game.modelLabel}</span>
      <strong>{waiting ? "Enter lobby" : game.status === "in_progress" ? "Watch live" : "Open game"} ↗</strong>
    </Link>
  </article>;
}
