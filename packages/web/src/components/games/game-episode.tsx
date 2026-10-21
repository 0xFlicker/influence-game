import type { ReactNode } from "react";
import { GameLogo } from "../game-logo";
import type { BrandedGame } from "@/lib/game-brand";
import "@/app/games/episodes.css";

export function GameEpisode({ gameKind, eyebrow, title, description, media, actions, information, notice }: {
  gameKind: BrandedGame; eyebrow: string; title: string; description: string; media: ReactNode;
  actions: ReactNode; information: ReactNode; notice?: ReactNode;
}) {
  return <section className="episode-landing">
    <GameLogo game={gameKind} className="episode-game-logo" />
    <div className="episode-eyebrow">{eyebrow}</div><h1>{title}</h1><p className="episode-description">{description}</p>
    <div className="episode-landing-media">{media}</div>{notice}
    <div className="episode-landing-actions">{actions}</div>
    <details><summary>Game information</summary>{information}</details>
  </section>;
}
