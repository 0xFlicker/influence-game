"use client";

import {characterImageError} from "@/components/character/image-error";
import { useState } from "react";
import type { GamePlayer } from "@/lib/api";
import { resolveAgentAvatarUrl } from "@/components/agent-avatar";
import styles from "./winner-scene.module.css";
import { WINNER_PAGE_SIZE, winnerScenePage } from "./winner-scene-timing";

export interface WinnerSceneBeat {
  kind: "winner";
  backgroundUrl?: string;
  counts?:Array<{name:string;votes:number}>;
  winner: GamePlayer & { fullBodyReferenceUrl?: string | null };
  standings: Array<GamePlayer & { placement: number | null; juryMember: boolean }>;
}

/** The final tableau stays visible after the director stops, including while paused. */
export function WinnerScene({ beat, elapsedMs }: { beat: WinnerSceneBeat; elapsedMs: number }) {
  const [failedBody, setFailedBody] = useState<string | null>(null);
  const { winner } = beat;
  const fullBody = winner.fullBodyReferenceUrl && winner.fullBodyReferenceUrl !== failedBody ? winner.fullBodyReferenceUrl : null;
  const portrait = resolveAgentAvatarUrl(winner.avatarUrl, winner.persona, winner.name, winner.personaKey);
  const finalists = beat.standings.filter(player => player.placement !== null && player.placement <= 4);
  const remaining = beat.standings.filter(player => player.placement === null || player.placement > 4);
  const jury = remaining.filter(player => player.juryMember);
  const rest = remaining.filter(player => !player.juryMember);
  const ordered = [...finalists, ...jury, ...rest];
  const page = winnerScenePage(elapsedMs, ordered.length);
  const visible = ordered.slice(page * WINNER_PAGE_SIZE, (page + 1) * WINNER_PAGE_SIZE);
  return <section aria-label="Final standings" data-winner-scene className={styles.scene} style={beat.backgroundUrl ? {backgroundImage:`linear-gradient(90deg,rgba(0,0,0,.25),rgba(0,0,0,.45)),url("${beat.backgroundUrl}")`, backgroundSize:"cover",backgroundPosition:"center"} : undefined}>
    <div className={styles.layout}>
      <div className={styles.winner}>
        <header className={styles.heading}>
          <p className={styles.eyebrow}>Winner</p>
          <h2>{winner.name} wins The House.</h2>
        </header>
        <div className={styles.winnerImage} data-winner-image={fullBody ? "full-body" : "portrait"}>
          {/* eslint-disable-next-line @next/next/no-img-element -- frozen game artwork must retain the complete body */}
          <img key={fullBody ?? portrait} src={fullBody ?? portrait} alt={winner.name} onError={fullBody ? event => void characterImageError(event, () => setFailedBody(fullBody)) : undefined} />
        </div>
      </div>
      {(ordered.length > 0 || beat.counts) && <div className={styles.remaining} data-winner-page={page}>
        {beat.counts && <p data-winner-votes className={styles.counts}>Jury vote · {beat.counts.map(row=>`${row.name}: ${row.votes}`).join(" · ")}</p>}
        {[{ label: "Final four", members: visible.filter(player => player.placement !== null && player.placement <= 4) }, { label: "Jury", members: visible.filter(player => (player.placement === null || player.placement > 4) && player.juryMember) }, { label: "Rest of the cast", members: visible.filter(player => (player.placement === null || player.placement > 4) && !player.juryMember) }].map(({ label, members }) => members.length > 0 && <div key={label}>
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
  return <li value={player.placement ?? undefined} data-winner-player={player.id} data-placement={player.placement ?? "unknown"} className={styles.placement}>
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
