import type { ReactNode } from "react";
import type { GameSummary } from "@/lib/api";
import { EpisodeCard } from "./episode-preview";

export function InitialShelf({ games, children }: { games: GameSummary[]; children: ReactNode }) {
  return <section aria-label="Recently added Influence games" className="episode-shelf">
    <div className="episode-shelf-heading"><h2>Recently added Influence games</h2></div>
    {children}
    <div className="episode-rail">{games.map(game => <EpisodeCard key={game.id} game={game} />)}</div>
  </section>;
}
