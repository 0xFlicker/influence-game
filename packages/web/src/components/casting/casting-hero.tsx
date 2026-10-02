import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import "./casting.css";

export function CastingHero({ gameKind, eyebrow = "The House presents", intro, playerCount, castCount, seatsLabel,
  canJoin, disabled, onChoose, chooseLabel, rulesHref, heading = "h1", children }: {
  gameKind: "influence" | "werewolf";
  eyebrow?: string;
  intro: string;
  playerCount: number;
  castCount: number;
  seatsLabel: string;
  canJoin: boolean;
  disabled?: boolean;
  onChoose: () => void;
  chooseLabel: string;
  rulesHref: string;
  heading?: "h1" | "h2";
  children?: ReactNode;
}) {
  const Heading = heading;
  const gameLabel = gameKind === "werewolf" ? "Werewolf" : "Influence";
  const openSeats = Math.max(0, playerCount - castCount);
  return (
      <header className="pre-show-hero" data-game-kind={gameKind}>
        <div className="pre-show-hero-copy">
          <p className="pre-show-eyebrow">{eyebrow} <span aria-hidden="true">/</span> {gameLabel}</p>
          <p className="pre-show-status"><span aria-hidden="true" /> {openSeats > 0 ? "Casting open" : "Cast complete"}</p>
          <Heading className="pre-show-title">Before the<br /><em>{gameKind === "werewolf" ? "first night." : "first move."}</em></Heading>
          <p className="pre-show-intro">{intro}</p>
          <div className="pre-show-hero-actions">
            {canJoin && <button type="button" className="pre-show-join" disabled={disabled} onClick={onChoose}>{chooseLabel} <span aria-hidden="true">↗</span></button>}
            <Link href={rulesHref}>How {gameLabel} works <span aria-hidden="true">↗</span></Link>
          </div>
          {children}
        </div>
        <div className="pre-show-poster" aria-hidden="true">
          <Image src="/logo.png" alt="" width={120} height={120} />
          <p>{gameKind === "werewolf" ? "Everyone has a secret." : "Trust is a strategy."}<br /><em>{gameKind === "werewolf" ? "Some have teeth." : "So is betrayal."}</em></p>
          <span>The House / {gameLabel}</span>
        </div>
        <div className="pre-show-admission">
          <div><strong>{castCount.toString().padStart(2, "0")}</strong><span>of {playerCount} agents in the cast</span></div>
          <div className="pre-show-seats" aria-hidden="true">{Array.from({ length: playerCount }, (_, i) => <span key={i} data-filled={i < castCount} />)}</div>
          <p role="status" aria-live="polite">{openSeats > 0 ? seatsLabel : gameKind === "werewolf" ? "Cast complete" : "Waiting for the opening move"}</p>
        </div>
      </header>
  );
}
