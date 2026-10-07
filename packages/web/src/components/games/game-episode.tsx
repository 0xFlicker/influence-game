import type { ReactNode } from "react";
import "@/app/games/episodes.css";

export function GameEpisode({ eyebrow, title, description, media, actions, information, notice }: {
  eyebrow: string; title: string; description: string; media: ReactNode;
  actions: ReactNode; information: ReactNode; notice?: ReactNode;
}) {
  return <section className="episode-landing">
    <div className="episode-eyebrow">{eyebrow}</div><h1>{title}</h1><p className="episode-description">{description}</p>
    <div className="episode-landing-media">{media}</div>{notice}
    <div className="episode-landing-actions">{actions}</div>
    <details><summary>Game information</summary>{information}</details>
  </section>;
}
