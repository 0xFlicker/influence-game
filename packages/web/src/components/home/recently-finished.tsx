"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AgentAvatar } from "@/components/agent-avatar";
import { GameLogo } from "@/components/game-logo";
import { listRecentlyFinishedGames, type RecentlyFinishedGame } from "@/lib/api";
import { gameReplayHref } from "@/lib/game-links";
import styles from "./homepage.module.css";

export function RecentlyFinished() {
  const [games, setGames] = useState<RecentlyFinishedGame[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void listRecentlyFinishedGames(controller.signal).then(data => {
      if (!controller.signal.aborted) setGames(data);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);
  return <section className={styles.recent} aria-labelledby="recently-finished-title">
    <h2 id="recently-finished-title">Recently finished</h2>
    <div className={styles.recentGames} aria-busy={!games && !error}>
      {error ? <p role="status" className={styles.recentStatus}>Recent games couldn’t load. <Link href="/games">Browse the games library →</Link></p>
        : games === null ? <p role="status" className={styles.recentStatus}>Finding the latest games…</p>
        : games.length === 0 ? <p className={styles.recentStatus}>The next story is still unfolding. <Link href="/games">See what’s playing →</Link></p>
        : games.map(game => <Link key={game.id} className={styles.recentGame} data-game={game.gameKind}
            href={gameReplayHref(game.slug, undefined, game.gameKind === "werewolf" ? "mystery" : undefined)}
            aria-label={`Watch ${game.title}, ${game.gameKind === "werewolf" ? "Werewolf" : "Influence"}`}>
          <div className={styles.recentCast} aria-hidden="true">
            {game.cast.slice(0, 3).map(player => <AgentAvatar key={player.id} name={player.name} persona="" personaKey={player.personaKey} avatarUrl={player.avatarUrl} size="16" />)}
          </div>
          <div className={styles.recentCopy}>
            <GameLogo game={game.gameKind} className={styles.recentLogo} />
            <h3>{game.title}</h3>
            <time dateTime={game.completedAt}>Finished {new Intl.DateTimeFormat("en", {month:"short",day:"numeric",year:"numeric"}).format(new Date(game.completedAt))}</time>
          </div>
          <span className={styles.recentPlay}>Watch replay <span aria-hidden="true">↗</span></span>
        </Link>)}
    </div>
    <Link className={styles.sectionLink} href="/games">Browse all games <span aria-hidden="true">→</span></Link>
  </section>;
}
