import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { GameLogo } from "../game-logo";
import type { BrandedGame } from "@/lib/game-brand";

interface GameCardProps extends Omit<ComponentProps<"article">, "title" | "children"> {
  title: string;
  href: string;
  status: string;
  statusLabel: string;
  gameKind: BrandedGame;
  description: string;
  meta: ReactNode;
  artwork: ReactNode;
  actions: ReactNode;
  management?: ReactNode;
  onOpen?: ComponentProps<typeof Link>["onClick"];
}

export function GameCard({ title, href, status, statusLabel, gameKind, description, meta, artwork, actions, management, onOpen, ...article }: GameCardProps) {
  return <article {...article} className={`episode-card ${article.className ?? ""}`}>
    <Link className="episode-card-link" href={href} onClick={onOpen}>
      <div className="episode-card-media">
        {artwork}
        <span className={`episode-status episode-status-${status}`}>{statusLabel}</span>
        <GameLogo game={gameKind} className="episode-card-logo" />
      </div>
      <div className="episode-copy">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </Link>
    <div className="episode-card-footer">
      <div className="episode-desktop-actions">{actions}</div>
      <div className="episode-meta">{meta}</div>
    </div>
    {management && <div className="episode-management">{management}</div>}
  </article>;
}
