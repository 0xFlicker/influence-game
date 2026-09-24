"use client";

import { useState } from "react";
import type { GamePlayer } from "@/lib/api";
import { resolveAgentAvatarUrl } from "@/components/agent-avatar";
import styles from "./winner-scene.module.css";

export interface WinnerSceneBeat {
  kind: "winner";
  winner: GamePlayer & { fullBodyReferenceUrl?: string | null };
  standings: Array<GamePlayer & { placement: number | null; juryMember: boolean }>;
}

/** The final tableau stays visible after the director stops, including while paused. */
export function WinnerScene({ beat, fullscreen = false }: { beat: WinnerSceneBeat; fullscreen?: boolean }) {
  const [failedBody, setFailedBody] = useState<string | null>(null);
  const { winner } = beat;
  const fullBody = winner.fullBodyReferenceUrl && winner.fullBodyReferenceUrl !== failedBody ? winner.fullBodyReferenceUrl : null;
  const portrait = resolveAgentAvatarUrl(winner.avatarUrl, winner.persona, winner.name, winner.personaKey);
  const finalists = beat.standings.filter(player => player.placement !== null && player.placement <= 4);
  const remaining = beat.standings.filter(player => player.placement === null || player.placement > 4);
  const jury = remaining.filter(player => player.juryMember);
  const rest = remaining.filter(player => !player.juryMember);
  return <section aria-label="Final standings" data-winner-scene className={styles.scene} data-fullscreen={fullscreen}>
    <div className={styles.layout}>
      <div className={styles.winner}>
        <header className={styles.heading}>
          <p className={styles.eyebrow}>Winner</p>
          <h2>{winner.name} wins The House.</h2>
        </header>
        <div className={styles.winnerImage} data-winner-image={fullBody ? "full-body" : "portrait"}>
          {/* eslint-disable-next-line @next/next/no-img-element -- frozen game artwork must retain the complete body */}
          <img key={fullBody ?? portrait} src={fullBody ?? portrait} alt={winner.name} onError={fullBody ? () => setFailedBody(fullBody) : undefined} />
        </div>
      </div>
      {finalists.length > 0 && <div className={styles.finalists}>
        <h3 className={styles.eyebrow}>Final four</h3>
        <ol start={2} aria-label="Final four placements" className={styles.podium}>
          {finalists.map(player => <PlacementPortrait key={player.id} player={player} />)}
        </ol>
      </div>}
      {remaining.length > 0 && <div className={styles.remaining}>
        {[{ label: "Jury", members: jury }, { label: "Rest of the cast", members: rest }].map(({ label, members }) => members.length > 0 && <div key={label}>
          <h3 className={styles.eyebrow}>{label}</h3>
          <ol aria-label={label} className={styles.cast}>
            {members.map(player => <PlacementPortrait key={player.id} player={player} />)}
          </ol>
        </div>)}
      </div>}
    </div>
  </section>;
}

function PlacementPortrait({ player }: { player: WinnerSceneBeat["standings"][number] }) {
  return <li value={player.placement ?? undefined} data-placement={player.placement ?? "unknown"} className={styles.placement}>
    <div className={styles.headshot}>
      {/* eslint-disable-next-line @next/next/no-img-element -- saved game headshot */}
      <img src={resolveAgentAvatarUrl(player.avatarUrl, player.persona, player.name, player.personaKey)} alt={player.name} />
      {player.placement !== null && <span aria-hidden="true" className={styles.rank}>{player.placement}</span>}
    </div>
    <div className={styles.caption}>
      <p>{player.name}</p>
      {player.juryMember && player.placement !== null && player.placement <= 4 && <span className={styles.unavailable}>Jury</span>}
      <span className={player.placement === null ? styles.unavailable : "sr-only"}>{player.placement === null ? "Placement unavailable" : `Place ${player.placement}`}</span>
    </div>
  </li>;
}
